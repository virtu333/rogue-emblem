import { speakSpecialCharacterRefusal } from '../engine/SpecialCharacterDialogue.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
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
  equipIfUnarmed,
  removeFromConsumables,
} from '../engine/UnitManager.js';
import { LevelUpPopup } from './LevelUpPopup.js';
import { captureResolvedAction } from './BattlePresentationCheckpoint.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { replaceUnitGraphic } from './replaceUnitGraphic.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
import { reportAsyncError } from '../utils/errorReporter.js';
import { hasDOMHost } from '../utils/domUI.js';
import { promotionPathContent, projectUnit } from './growthContent.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { applyPromotionOath, promotionOathCandidates } from '../engine/DeedSystem.js';
import { classChangeItemBlock } from '../engine/TwistedBoons.js';

export class PromotionController {
  constructor(scene) {
    this.scene = scene;
    this.pending = new WeakSet();
  }

  async executePromotion(unit, promotionItem = null) {
    if (!unit || unit.hasActed || this.pending.has(unit)) return false;
    this.pending.add(unit);
    try {
      return await this._executePromotion(unit, promotionItem);
    } finally {
      this.pending.delete(unit);
    }
  }

  async _executePromotion(unit, promotionItem = null) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (!isCurrentBattleSession(scene, session)) return false;
    const seal = promotionItem || scene.getPromotionConsumable(unit);
    if (
      !seal ||
      seal.effect !== 'promote' ||
      !unit.consumables?.includes(seal) ||
      !Number.isFinite(seal.uses) ||
      seal.uses <= 0
    ) {
      await scene.showBriefBanner('Master Seal required to promote.', UI_PALETTE.bad);
      if (!isCurrentBattleSession(scene, session)) return false;
      scene.battleState = 'UNIT_ACTION_MENU';
      scene.showActionMenu(unit);
      return false;
    }

    // Kingmaker's Oath: no Master Seal in this run, however it was offered (the item menu, a
    // seal handed in directly).
    const banned = classChangeItemBlock(scene.runManager, seal);
    const refusal =
      banned || speakSpecialCharacterRefusal(scene.gameData, unit, 'promote', scene.runManager);
    if (refusal) {
      await scene.showBriefBanner(refusal, UI_PALETTE.bad);
      if (!isCurrentBattleSession(scene, session)) return false;
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
        session,
        markPromotionApplied: () => {
          promotionApplied = true;
        },
        markSealConsumed: () => {
          sealConsumed = true;
        },
      });
    } catch (err) {
      if (!isCurrentBattleSession(scene, session)) return promotionApplied;
      if (!promotionApplied) {
        console.error('[PromotionController] promotion error:', err);
        if (scene.battleState !== 'BATTLE_END') {
          scene.battleState = 'UNIT_ACTION_MENU';
          try {
            scene.showActionMenu(unit);
          } catch (menuErr) {
            console.error('[PromotionController] promotion recovery error:', menuErr);
            scene._recoverUnitActionError(unit, 'promotion', err, { session });
          }
        }
        return false;
      }
      if (!sealConsumed) {
        try {
          seal.uses = seal.uses - 1;
          if (seal.uses <= 0) removeFromConsumables(unit, seal);
        } catch (sealErr) {
          console.error('[PromotionController] promotion seal-consume error:', sealErr);
        }
      }
      scene._recoverUnitActionError(unit, 'promotion', err, { session });
      return true;
    }
  }

  async _executePromotionFlow(unit, seal, { markPromotionApplied, markSealConsumed, session }) {
    const scene = this.scene;
    // Find promotion targets
    const lordData = scene.gameData.lords.find((l) => l.name === unit.name);
    const targets = resolvePromotionTargets(unit, scene.gameData.classes, scene.gameData.lords);
    if (!targets?.length) {
      await scene.showBriefBanner(
        'Promotion to that class is currently unavailable.',
        UI_PALETTE.bad,
      );
      if (!isCurrentBattleSession(scene, session)) return false;
      scene.battleState = 'UNIT_ACTION_MENU';
      scene.showActionMenu(unit);
      return false;
    }

    let promotedClassData;
    // One path and no Oath to pick: nothing to choose. With two or more Oaths open,
    // the chooser opens anyway so the player picks the deed the unit swears on.
    const oathChoice =
      hasDOMHost() &&
      promotionOathCandidates(unit, scene.gameData.deeds, scene.gameData.skills).length > 1;
    if (targets.length === 1 && !oathChoice) {
      promotedClassData = targets[0];
    } else {
      scene.battleState = 'COMBAT_RESOLVING'; // block gameplay hotkeys while chooser is open
      // Show promotion choice panel
      const { PromotionChoicePanel } = await import('./PromotionChoicePanel.js');
      if (!isCurrentBattleSession(scene, session)) return false;
      const panel = new PromotionChoicePanel(scene, unit, targets, scene.gameData.skills);
      promotedClassData = await panel.show();
      if (!isCurrentBattleSession(scene, session)) return false;
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
      await scene.showBriefBanner('Promotion data missing for this unit.', UI_PALETTE.bad);
      if (!isCurrentBattleSession(scene, session)) return false;
      scene.battleState = 'UNIT_ACTION_MENU';
      scene.showActionMenu(unit);
      return false;
    }

    // Track pre-promotion weapon types to detect new proficiencies
    const oldTypes = new Set(unit.proficiencies.map((p) => p.type));
    // The rite's content is projected before the promotion is applied (same
    // engine rules, a detached copy), so it carries the before values.
    let riteContent = null;
    let beforeUnit = null;
    if (hasDOMHost()) {
      try {
        beforeUnit = projectUnit(unit);
        riteContent = promotionPathContent(unit, promotedClassData, scene.gameData);
      } catch (err) {
        console.warn('[PromotionController] rite preview failed:', err);
      }
    }

    // Apply promotion
    const promotionResult = promoteUnit(
      unit,
      promotedClassData,
      promotionBonuses,
      scene.gameData.skills,
    );
    markPromotionApplied();
    // A deed's Oath, sworn with the promotion (the rite's content projected it).
    const oath = applyPromotionOath(unit, scene.gameData);
    // Skill slots full: the Oath waits in Deeds (the rite's card says so).
    if (oath?.waiting) promotionResult.oathWaiting = oath;
    // Commit the seal with the promotion, before any dismissible/awaited UI.
    seal.uses = seal.uses - 1;
    if (seal.uses <= 0) removeFromConsumables(unit, seal);
    markSealConsumed();

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
        // A unit left with nothing equipped takes up the granted weapon.
        if (addToInventory(unit, newWeapon)) equipIfUnarmed(unit, unit.inventory.at(-1));
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
          if (addToInventory(unit, newWeapon)) equipIfUnarmed(unit, unit.inventory.at(-1));
        }
      }
    }

    try {
      observeHistoryAction(scene, 'promoted', unit, null, promotedClassData.name);
    } catch (error) {
      reportAsyncError('promoted_history_failed', error, { unit: unit.name });
    }
    captureResolvedAction(
      scene,
      {
        kind: 'finish',
        unitName: unit.name,
        ...(unit.battleEntityId ? { unitId: unit.battleEntityId } : {}),
      },
      { session },
    );

    // All class, weapon, Oath and seal changes are already captured. Drawing
    // failures skip the rest of the ceremony and finish the same action once.
    try {
      replaceUnitGraphic(scene, unit);
      scene.updateHPBar(unit);

      // The rite (DOM): portrait in the Hollow Sun, the class burning away,
      // bonuses igniting, ranks and skills sealed in. Everything it shows is
      // already applied and checkpointed above; a refresh never replays it.
      const growth = riteContent ? growthCeremonies(scene) : null;
      let riteShown = false;
      if (growth) {
        riteShown = await growth.showPromotionRite({ unit, content: riteContent, beforeUnit });
        if (!isCurrentBattleSession(scene, session)) return true;
      }
      if (!riteShown) {
        // Canvas fallback: banner, then the gains as a level-up style popup.
        await scene.showPromotionBanner(unit, promotedClassData.name);
        if (!isCurrentBattleSession(scene, session)) return true;
        const gains = { gains: { ...promotionBonuses }, newLevel: 1 };
        const popup = new LevelUpPopup(
          scene,
          unit,
          gains,
          true,
          [],
          promotedClassData.growthBonuses || null,
        );
        scene._playLevelUpSfx?.('promotion');
        try {
          await popup.show();
        } finally {
          if (isCurrentBattleSession(scene, session)) scene._stopLevelUpSfx?.();
        }
        if (!isCurrentBattleSession(scene, session)) return true;
      }

      // Tell the player about innates lost to the skill cap (never silent)
      const droppedNotice = formatDroppedSkillsNotice(
        unit.name,
        promotionResult?.droppedSkills,
        scene.gameData.skills,
      );
      // (the rite lists them in its closing note)
      if (droppedNotice && !riteShown) await scene.showBriefBanner(droppedNotice, UI_PALETTE.bad);
      if (!isCurrentBattleSession(scene, session)) return true;
    } catch (error) {
      if (isCurrentBattleSession(scene, session))
        console.warn('[PromotionController] presentation failed:', error);
    }
    if (!isCurrentBattleSession(scene, session)) return true;
    scene.finishUnitAction(unit, { session });
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
          color: UI_PALETTE.accentText,
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
