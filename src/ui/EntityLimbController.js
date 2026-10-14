// EntityLimbController — the battle side of the Entity's Grasping Limbs (rules:
// engine/EntityKit.js; the headless harness drives the same rules without any of this drawing).
//
//   processPhase   at each enemy-phase start, right after the Vigil's step: a limb rises on each
//                  tile the army struck the Entity from since the last
//   onEnemyFell    at a foe's fall (BattleScene.removeUnit): a limb the army cut wounds the
//                  Entity; the Entity's fall withers every limb (no killer: no gold, no XP)
//
// As VigilController: the state first (the kit's state, each limb on the roster with its battle
// identity and its history record), then the drawing, every piece inside
// safeBattlePresentation, so a failed graphic never costs a limb or the enemy phase. Nothing here
// draws from Math.random (a limb has its own keyed stream), and nothing leaks the fog: the banner
// and the rise play only for a limb the player sees, the wound only for an Entity it sees.
// BattleScene owns one instance (made on first use, destroyed with the scene).

import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { registerBattleEntity } from '../engine/BattleEntityIdentity.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { CombatFxController } from './CombatFxController.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { drawArrivalGraphic } from './arrivalGraphic.js';
import { floatCombatNumber } from './CombatNumberFloat.js';
import { limbPhaseStep, livingEntity, severLimb, witherLimbs } from '../engine/EntityKit.js';
import { entityKitOf } from '../engine/EntityKitConfig.js';
import { isEntity, isEntityLimb } from '../engine/EntitySystem.js';
import { enemyDifficultyConfigFromParams } from '../engine/UnitManager.js';
import { canInspectUnit } from '../engine/BattleInformation.js';
import { UI_PALETTE } from '../utils/uiStyles.js';

export const LIMB_BANNERS = Object.freeze({
  rise: 'It reaches for you.',
  severed: 'Severed! The Entity bleeds.',
});

export class EntityLimbController {
  constructor(scene) {
    this.scene = scene;
  }

  create() {
    return this;
  }

  destroy() {
    this.scene = null;
  }

  get kit() {
    return entityKitOf(this.scene?.battleConfig);
  }

  /** In the player's view? The fog's one rule (canInspectUnit: Seer's Eye shows it). */
  seesUnit(unit) {
    return canInspectUnit(this.scene?.grid, unit);
  }

  _fx() {
    const scene = this.scene;
    return scene ? (scene._combatFx ||= new CombatFxController(scene)) : null;
  }

  /** Enemy-phase start: the limbs the last player phase's strikes earned rise. */
  async processPhase() {
    const scene = this.scene;
    const kit = this.kit;
    if (!scene || !kit?.limbs) return;
    const session = battleSession(scene);
    const step = limbPhaseStep({
      kit,
      state: scene._entityKitState,
      enemyUnits: scene.enemyUnits,
      cols: scene.battleConfig?.cols ?? scene.grid?.cols ?? 0,
      rows: scene.battleConfig?.rows ?? scene.grid?.rows ?? 0,
      // Execution sees every unit; previews never come through here.
      isOccupied: (c, r) => Boolean(scene.getUnitAt(c, r)),
      moveCostAt: (c, r, moveType) => scene.grid.getTerrainAt(c, r)?.moveCost?.[moveType],
      turn: scene.turnManager?.turnNumber ?? 1,
      seed: scene.getReinforcementSeed(),
      classes: scene.gameData?.classes,
      weapons: scene.gameData?.weapons,
      difficultyConfig: enemyDifficultyConfigFromParams(scene.battleParams),
    });
    if (step.skipped) return;

    // The domain first, whole: the state, every limb on the roster with its identity and record.
    scene._entityKitState = step.state;
    const entity = livingEntity(scene.enemyUnits);
    for (const { unit } of step.sprouts) {
      registerBattleEntity(scene, unit);
      scene.enemyUnits.push(unit);
      observeHistoryAction(scene, 'sprouted', entity, unit);
    }
    if (step.sprouts.length === 0) return;
    scene.dangerZoneStale = true;

    // Then the drawing, each piece in its own boundary.
    for (const { unit } of step.sprouts) drawArrivalGraphic(scene, unit, 'entity limb');
    if (scene.grid?.fogEnabled)
      safeBattlePresentation('limb fog', () => scene.updateEnemyVisibility?.(), { scene });
    safeBattlePresentation('limb threats', () => scene._pinnedThreats?.invalidate?.(), { scene });
    const seen = step.sprouts.map((s) => s.unit).filter((unit) => this.seesUnit(unit));
    if (seen.length === 0) return;
    await safeBattlePresentation(
      'limb rise',
      async () => {
        await scene.showBriefBanner?.(LIMB_BANNERS.rise, UI_PALETTE.rarityEpic);
        if (!isCurrentBattleSession(scene, session)) return;
        await Promise.all(
          seen.map((unit) =>
            safeBattlePresentation('limb raise fx', () => this._fx()?.raise?.(unit), { scene }),
          ),
        );
      },
      { scene },
    );
  }

  /**
   * A foe fell (already off the roster). A limb the army cut wounds the Entity; the Entity's
   * fall takes every limb with it, before any battle-end check reads the roster.
   */
  async onEnemyFell(unit, killer) {
    const scene = this.scene;
    const kit = this.kit;
    if (!scene || !kit?.limbs) return;
    if (isEntity(unit)) {
      await this._wither();
      return;
    }
    if (!isEntityLimb(unit)) return;
    const wound = severLimb(unit, {
      kit,
      state: scene._entityKitState,
      enemyUnits: scene.enemyUnits,
      killer,
    });
    if (!wound) return;
    observeHistoryAction(scene, 'bled', wound.entity, null, `−${wound.amount} HP`);
    safeBattlePresentation('limb wound bar', () => scene.updateHPBar?.(wound.entity), { scene });
    if (!this.seesUnit(wound.entity)) return;
    safeBattlePresentation(
      'limb wound',
      () => {
        const pos = scene.grid.gridToPixel(wound.entity.col + 1, wound.entity.row + 1);
        floatCombatNumber(scene, {
          kind: 'strike',
          value: wound.amount,
          x: pos.x,
          y: pos.y - 16,
          reducedMotion: scene._reduceMotion?.(),
        });
        scene.showMinorHintAt?.(pos.x, pos.y - 34, LIMB_BANNERS.severed, UI_PALETTE.good);
      },
      { scene },
    );
  }

  /** The Entity fell: its limbs leave the board with it. */
  async _wither() {
    const scene = this.scene;
    const session = battleSession(scene);
    const withered = witherLimbs(scene.enemyUnits);
    if (withered.length === 0) return;
    scene.dangerZoneStale = true;
    scene._pinnedThreats?.invalidate?.();
    for (const unit of withered) {
      unit._removing = true;
      observeHistoryAction(scene, 'withered', unit);
    }
    await Promise.all(
      withered.map(async (unit) => {
        if (this.seesUnit(unit))
          await safeBattlePresentation('limb wither', () => this._fx()?.deathFade?.(unit), {
            scene,
          });
        if (isCurrentBattleSession(scene, session))
          safeBattlePresentation('limb cleanup', () => scene.removeUnitGraphic(unit), { scene });
      }),
    );
  }
}
