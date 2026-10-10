// NecromancyController — the battle side of the Necromancer (rules: engine/Necromancy.js;
// the headless harness drives the same rules without any of this drawing).
//
//   processRaises   at each enemy-phase start, right after the Zombie remains tick: every
//                   living Necromancer with fewer than two living Skeletons raises one
//   crumble         at a Necromancer's fall (BattleScene.removeUnit): its own Skeletons
//                   leave the board with no killer (no gold, no XP) before the battle-end
//                   check, so a rout completes when it was the last living foe
//
// Nothing here draws from Math.random (the raise has its own keyed stream), and nothing
// leaks the fog: the banner and the effect play only on a tile the player sees, and a
// Skeleton raised in fog is not marked (updateEnemyVisibility hides it as it does any enemy).
// BattleScene owns one instance (lazily made; destroyed with the scene).

import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { CombatFxController } from './CombatFxController.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { crumbleFor, raiseFor, raisers } from '../engine/Necromancy.js';
import { enemyDifficultyConfigFromParams } from '../engine/UnitManager.js';
import { UI_PALETTE } from '../utils/uiStyles.js';

export class NecromancyController {
  constructor(scene) {
    this.scene = scene;
  }

  create() {
    return this;
  }

  destroy() {
    this.scene = null;
  }

  isVisible(col, row) {
    const grid = this.scene?.grid;
    return typeof grid?.isVisible === 'function' ? Boolean(grid.isVisible(col, row)) : true;
  }

  /** Is this Skeleton in the player's view? Its tile's sight, or always under Seer's Eye. */
  seesUnit(unit) {
    return this.scene?.grid?.foesShown === true || this.isVisible(unit.col, unit.row);
  }

  /** The scene's combat effects (made on first use, as removeUnit makes them). */
  _fx() {
    const scene = this.scene;
    return scene ? (scene._combatFx ||= new CombatFxController(scene)) : null;
  }

  /** Enemy-phase start: each Necromancer below its two Skeletons raises one. */
  async processRaises() {
    const scene = this.scene;
    const session = battleSession(scene);
    if (!isCurrentBattleSession(scene, session)) return;
    const turn = scene.turnManager?.turnNumber ?? 1;
    const cols = scene.battleConfig?.cols ?? scene.grid?.cols ?? 0;
    const rows = scene.battleConfig?.rows ?? scene.grid?.rows ?? 0;
    for (const necromancer of raisers(scene.enemyUnits)) {
      // A Necromancer an earlier raise's presentation outlived is not raising any more.
      if (!scene.enemyUnits.includes(necromancer) || necromancer.currentHP <= 0) continue;
      const raised = raiseFor(necromancer, {
        enemyUnits: scene.enemyUnits,
        cols,
        rows,
        // Execution sees every unit; previews never come through here.
        isOccupied: (c, r) => Boolean(scene.getUnitAt(c, r)),
        moveCostAt: (c, r, moveType) => scene.grid.getTerrainAt(c, r)?.moveCost?.[moveType],
        classes: scene.gameData?.classes,
        weapons: scene.gameData?.weapons,
        seed: scene.getReinforcementSeed(),
        turn,
        difficultyConfig: enemyDifficultyConfigFromParams(scene.battleParams),
      });
      if (!raised) continue; // no free tile beside it: nothing is raised
      const { unit } = raised;
      scene.enemyUnits.push(unit);
      scene.addUnitGraphic(unit);
      if (scene.grid?.fogEnabled) scene.updateEnemyVisibility?.();
      scene.dangerZoneStale = true;
      scene._pinnedThreats?.invalidate?.();
      observeHistoryAction(scene, 'raised', necromancer, unit);
      // Seen rising only where the player sees: the fog keeps its secret (no banner, no
      // effect, and the hidden Skeleton stays hidden like any enemy in fog).
      if (this.seesUnit(unit)) {
        await safeBattlePresentation(
          'necromancer raise',
          async () => {
            await scene.showBriefBanner?.(
              `${necromancer.name} raises a ${unit.className}!`,
              UI_PALETTE.rarityEpic,
            );
            if (isCurrentBattleSession(scene, session)) await this._fx()?.raise?.(unit);
          },
          { scene },
        );
        if (!isCurrentBattleSession(scene, session)) return;
      }
    }
    scene.updateObjectiveText?.();
  }

  /**
   * `necromancer` fell (already off the roster): its Skeletons crumble. Returns them.
   * The roster is changed first and in one step (the caller's battle-end check reads it),
   * then each plays its fall where the player can see it.
   */
  async crumble(necromancer) {
    const scene = this.scene;
    const session = battleSession(scene);
    const crumbled = crumbleFor(necromancer, scene.enemyUnits);
    if (crumbled.length === 0) return crumbled;
    scene.dangerZoneStale = true;
    scene._pinnedThreats?.invalidate?.();
    for (const unit of crumbled) {
      unit._removing = true;
      observeHistoryAction(scene, 'crumbled', unit);
    }
    await Promise.all(
      crumbled.map(async (unit) => {
        // Presentation only: a failed fall must never keep a Skeleton on the board.
        if (this.seesUnit(unit))
          await safeBattlePresentation('skeleton crumble', () => this._fx()?.deathFade?.(unit), {
            scene,
          });
        if (isCurrentBattleSession(scene, session))
          safeBattlePresentation('skeleton cleanup', () => scene.removeUnitGraphic(unit), {
            scene,
          });
      }),
    );
    scene.updateObjectiveText?.();
    return crumbled;
  }
}
