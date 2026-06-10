// PromotionController -- Master Seal promotion flow extracted from BattleScene.
// Owns target resolution, the promotion choice panel, applying the promotion,
// and the banner/popup/dropped-skills sequencing. Cross-cutting seams
// (showActionMenu, showBriefBanner, showPromotionBanner, finishUnitAction,
// _recoverUnitActionError, graphics refresh) are invoked via the scene's
// delegating wrappers so tests and other systems can intercept them on the
// scene as before.

import {
  promoteUnit,
  formatDroppedSkillsNotice,
  resolvePromotionTargets,
  addToInventory,
  removeFromConsumables,
} from '../engine/UnitManager.js';
import { LevelUpPopup } from './LevelUpPopup.js';

export class PromotionController {
  constructor(scene) {
    this.scene = scene;
  }

  async executePromotion(unit, promotionItem = null) {
    const scene = this.scene;
    const seal = promotionItem || scene.getPromotionConsumable(unit);
    if (!seal) {
      await scene.showBriefBanner('Master Seal required to promote.', '#ff8888');
      scene.battleState = 'UNIT_ACTION_MENU';
      scene.showActionMenu(unit);
      return false;
    }

    // Once promoteUnit has mutated the unit the promotion is committed; on a
    // later error we must consume the seal + action instead of replaying the menu.
    let promotionApplied = false;
    let sealConsumed = false;
    try {
      return await this._executePromotionFlow(unit, seal, {
        markPromotionApplied: () => {
          promotionApplied = true;
        },
        markSealConsumed: () => {
          sealConsumed = true;
        },
      });
    } catch (err) {
      if (!promotionApplied) {
        console.error('[PromotionController] promotion error:', err);
        if (scene.battleState !== 'BATTLE_END') {
          scene.battleState = 'UNIT_ACTION_MENU';
          try {
            scene.showActionMenu(unit);
          } catch (menuErr) {
            console.error('[PromotionController] promotion recovery error:', menuErr);
            scene._recoverUnitActionError(unit, 'promotion', err);
          }
        }
        return false;
      }
      if (!sealConsumed) {
        try {
          seal.uses = (seal.uses ?? 1) - 1;
          if (seal.uses <= 0) removeFromConsumables(unit, seal);
        } catch (sealErr) {
          console.error('[PromotionController] promotion seal-consume error:', sealErr);
        }
      }
      scene._recoverUnitActionError(unit, 'promotion', err);
      return true;
    }
  }

  async _executePromotionFlow(unit, seal, { markPromotionApplied, markSealConsumed }) {
    const scene = this.scene;
    // Find promotion targets
    const lordData = scene.gameData.lords.find((l) => l.name === unit.name);
    const targets = resolvePromotionTargets(unit, scene.gameData.classes, scene.gameData.lords);
    if (!targets?.length) {
      await scene.showBriefBanner('Promotion to that class is currently unavailable.', '#ff8888');
      scene.battleState = 'UNIT_ACTION_MENU';
      scene.showActionMenu(unit);
      return false;
    }

    let promotedClassData;
    if (targets.length === 1) {
      promotedClassData = targets[0];
    } else {
      scene.battleState = 'COMBAT_RESOLVING'; // block gameplay hotkeys while chooser is open
      // Show promotion choice panel
      const { PromotionChoicePanel } = await import('./PromotionChoicePanel.js');
      const panel = new PromotionChoicePanel(scene, unit, targets, scene.gameData.skills);
      promotedClassData = await panel.show();
      if (!promotedClassData) {
        // Cancelled -- return to action menu
        scene.battleState = 'UNIT_ACTION_MENU';
        scene.showActionMenu(unit);
        return false;
      }
    }

    scene.battleState = 'COMBAT_RESOLVING'; // block input during promotion

    let promotionBonuses, promotionWeapons;

    if (lordData) {
      promotionBonuses = lordData.promotionBonuses;
      promotionWeapons = lordData.promotionWeapons;
    } else {
      promotionBonuses = promotedClassData.promotionBonuses;
    }

    if (!promotionBonuses) {
      await scene.showBriefBanner('Promotion data missing for this unit.', '#ff8888');
      scene.battleState = 'UNIT_ACTION_MENU';
      scene.showActionMenu(unit);
      return false;
    }

    // Track pre-promotion weapon types to detect new proficiencies
    const oldTypes = new Set(unit.proficiencies.map((p) => p.type));

    // Apply promotion
    const promotionResult = promoteUnit(
      unit,
      promotedClassData,
      promotionBonuses,
      scene.gameData.skills,
    );
    markPromotionApplied();

    // Refresh sprite to show promoted class
    scene.removeUnitGraphic(unit);
    scene.addUnitGraphic(unit);

    // Grant Iron weapons for any new weapon proficiencies gained
    if (promotionWeapons) {
      // Lords get specific promotion weapons (e.g. "Lances (P)")
      const newType = promotionWeapons.match(/(\w+)/)?.[1];
      const typeMap = {
        Swords: 'Sword',
        Lances: 'Lance',
        Axes: 'Axe',
        Bows: 'Bow',
        Tomes: 'Tome',
        Staves: 'Staff',
        Light: 'Light',
      };
      const wpnType = typeMap[newType] || newType;
      const newWeapon = scene.gameData.weapons.find((w) => w.type === wpnType && w.tier === 'Iron');
      if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
        addToInventory(unit, newWeapon);
      }
    } else {
      // Non-Lord: grant Iron weapon for each newly gained proficiency type
      for (const prof of unit.proficiencies) {
        if (oldTypes.has(prof.type)) continue;
        const tier = 'Iron';
        const newWeapon = scene.gameData.weapons.find(
          (w) => w.type === prof.type && w.tier === tier,
        );
        if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
          addToInventory(unit, newWeapon);
        }
      }
    }

    // Update HP bar (max HP increased)
    scene.updateHPBar(unit);

    // Show promotion banner
    await scene.showPromotionBanner(unit, promotedClassData.name);

    // Show stat gains as a level-up style popup
    const gains = { gains: { ...promotionBonuses }, newLevel: 1 };
    delete gains.gains.MOV; // MOV isn't shown in level-up popup
    const popup = new LevelUpPopup(
      scene,
      unit,
      gains,
      true,
      [],
      promotedClassData.growthBonuses || null,
    );
    await popup.show();

    // Tell the player about innates lost to the skill cap (never silent)
    const droppedNotice = formatDroppedSkillsNotice(
      unit.name,
      promotionResult?.droppedSkills,
      scene.gameData.skills,
    );
    if (droppedNotice) await scene.showBriefBanner(droppedNotice, '#ff8888');

    // Consume Master Seal on successful promotion
    seal.uses = (seal.uses ?? 1) - 1;
    if (seal.uses <= 0) removeFromConsumables(unit, seal);
    markSealConsumed();

    scene.finishUnitAction(unit);
    return true;
  }

  async showPromotionBanner(unit, newClassName) {
    const scene = this.scene;
    const banner = scene.add
      .text(
        scene.cameras.main.centerX,
        scene.cameras.main.centerY,
        `${unit.name} promoted to ${newClassName}!`,
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#ffdd44',
          backgroundColor: '#000000cc',
          padding: { x: 16, y: 8 },
        },
      )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(500);
    scene._pinToScreen(banner);

    await scene._awaitSceneTween(
      {
        targets: banner,
        alpha: 1,
        duration: 300,
        yoyo: true,
        hold: 1200,
        onComplete: () => {
          banner.destroy();
        },
      },
      {
        label: 'show_promotion_banner',
        onCancel: () => banner.destroy(),
      },
    );
  }

  destroy() {
    this.scene = null;
  }
}
