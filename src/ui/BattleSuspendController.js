// BattleSuspendController — mid-battle suspend/resume (anti-refresh).
//
// The battle continuously persists a "suspend checkpoint" into the run save
// at player-stable points (turn start after turn-start effects, after every
// completed unit action, after a Vision rewind). Any exit — refresh, crash,
// closed tab, Save & Exit — leads to the same continue choice: Resume battle
// (restore this checkpoint exactly) or Continue from map (sanctioned full
// revert). The battle RNG is reseeded at every capture and the seed stored,
// so a resumed battle replays the identical stream: refreshing can never
// reroll an outcome that already resolved.
//
// State stays on BattleScene (units, fog, HUD); the controller reads/writes
// via scene.* like the other extracted battle controllers.

import { serializeUnit, relinkWeapon } from '../engine/RunManager.js';
import { isSleeping } from '../engine/StatusConditionSystem.js';
import { getRating } from '../engine/TurnBonusCalculator.js';
import { hashRewindSeed } from './VisionRewindController.js';
import { showMinorHint } from './HintDisplay.js';

/**
 * Serialize a unit for the suspend checkpoint. serializeUnit is the
 * battle-proven clonable form, but it deliberately normalizes mid-battle
 * state away (acted flags, once-per-battle protections, timed weapon-art
 * buffs, movement spent) for between-battle persistence — overlay the live
 * values back on top so a resume is exact.
 */
export function serializeSuspendUnit(unit) {
  const data = serializeUnit(unit);
  data.stats = { ...unit.stats }; // live stats (timed buffs still applied)
  if (Number.isFinite(unit.mov)) data.mov = unit.mov;
  data.hasMoved = unit.hasMoved === true;
  data.hasActed = unit.hasActed === true;
  data._miracleUsed = unit._miracleUsed === true;
  data._phoenixBroochUsed = unit._phoenixBroochUsed === true;
  data._movementSpent = Number(unit._movementSpent) || 0;
  data._conditions = structuredClone(unit._conditions || []);
  for (const field of [
    '_battleDeltas',
    '_battleWeaponArtUsage',
    '_battleTimedWeaponArtBuffs',
    '_battleTimedWeaponArtAppliedStats',
    '_battleTimedWeaponArtAppliedCombatMods',
  ]) {
    if (unit[field] !== undefined) data[field] = structuredClone(unit[field]);
  }
  return data;
}

function cloneCheckpointPayload(payload) {
  try {
    return structuredClone(payload);
  } catch (_) {
    return JSON.parse(JSON.stringify(payload));
  }
}

export class BattleSuspendController {
  constructor(scene) {
    this.scene = scene;
  }

  /**
   * Capture the current player-stable state into the run save. Failures only
   * degrade the suspend lock, never gameplay.
   * @returns {boolean} true when a checkpoint was captured and persisted
   */
  captureCheckpoint() {
    const scene = this.scene;
    const rm = scene.runManager;
    if (!rm?.battleInProgress) return false; // tutorial/standalone or battle already settled
    if (scene.battleState === 'BATTLE_END') return false;
    if (scene.turnManager?.currentPhase !== 'player') return false;
    try {
      const index = (Number(rm.battleInProgress.checkpoint?.checkpointIndex) || 0) + 1;
      const base = Number.isFinite(scene.visionBaseSeed) ? scene.visionBaseSeed >>> 0 : 0;
      const seed = hashRewindSeed(base, index);
      // Reseed at the checkpoint so live play and any resume from it share
      // the exact same RNG stream from this point on.
      scene.reseedBattleRng(seed);
      rm.setBattleCheckpoint(this._buildCheckpoint(index, seed));
      scene._persistBattleRunState?.();
      return true;
    } catch (err) {
      console.warn('[BattleSuspend] checkpoint capture failed:', err?.message || err);
      return false;
    }
  }

  _buildCheckpoint(checkpointIndex, rngSeed) {
    const scene = this.scene;
    const fog = scene.grid?.fogEnabled
      ? {
          visible: [...(scene.grid.visibleSet || new Set())],
          everSeen: [...(scene.grid.everSeenSet || new Set())],
        }
      : null;
    return cloneCheckpointPayload({
      version: 1,
      checkpointIndex,
      rngSeed: rngSeed >>> 0,
      turnNumber: scene.turnManager?.turnNumber || 1,
      turnPar: scene.turnPar ?? null,
      playerUnits: scene.playerUnits.map(serializeSuspendUnit),
      enemyUnits: scene.enemyUnits.map(serializeSuspendUnit),
      npcUnits: scene.npcUnits.map(serializeSuspendUnit),
      escapedUnits: (scene.escapedUnits || []).map(serializeSuspendUnit),
      nonDeployedUnits: scene.nonDeployedUnits || [],
      visionSnapshot: scene.visionSnapshot || null,
      pendingVisionSnapshot: scene.pendingVisionSnapshot || null,
      antiTurtleState: scene.antiTurtleState || {},
      fog,
      ballistas: scene.ballistas?.map((b) => ({ ...b })) || [],
      zombieTombstones: scene._zombieTombstones || [],
      goldEarned: scene.goldEarned || 0,
      playerDeathsThisBattle: scene._playerDeathsThisBattle || 0,
      appliedHybridOverrideTurns: [...(scene.appliedHybridOverrideTurns || [])],
      latePressureWarningShown: scene._latePressureWarningShown === true,
      bossName: scene._bossName || null,
    });
  }

  /**
   * Restore unit arrays (and unit-scoped battle state) from a checkpoint.
   * Called from beginBattle at the point where fresh spawns would be created
   * — the grid exists, HUD/turn manager do not yet.
   */
  applyUnits(checkpoint) {
    const scene = this.scene;
    const restore = (targetArr, list) => {
      for (const data of Array.isArray(list) ? list : []) {
        const unit = structuredClone(data);
        // The checkpoint crossed a JSON boundary, which breaks the
        // weapon === inventory[i] identity invariant — relink like fromJSON.
        relinkWeapon(unit);
        targetArr.push(unit);
        scene.addUnitGraphic(unit);
        for (const cond of Array.isArray(unit._conditions) ? unit._conditions : []) {
          if (cond?.id) scene._addConditionIcon?.(unit, cond.id);
        }
      }
    };
    restore(scene.playerUnits, checkpoint.playerUnits);
    restore(scene.enemyUnits, checkpoint.enemyUnits);
    restore(scene.npcUnits, checkpoint.npcUnits);
    // Escaped units are off the field: no graphics, but the weapon identity
    // invariant still applies when they rejoin the roster at battle end.
    scene.escapedUnits = (
      Array.isArray(checkpoint.escapedUnits) ? checkpoint.escapedUnits : []
    ).map((data) => {
      const unit = structuredClone(data);
      relinkWeapon(unit);
      return unit;
    });
    for (const unit of scene.playerUnits) {
      if (unit.hasActed || isSleeping(unit)) scene.dimUnit(unit);
    }
    scene.nonDeployedUnits = structuredClone(checkpoint.nonDeployedUnits || []);
    scene.ballistas = (checkpoint.ballistas || []).map((b) => ({ ...b }));
    scene._zombieTombstones = structuredClone(checkpoint.zombieTombstones || []);
    scene.goldEarned = Number(checkpoint.goldEarned) || 0;
    scene._playerDeathsThisBattle = Number(checkpoint.playerDeathsThisBattle) || 0;
    scene._latePressureWarningShown = checkpoint.latePressureWarningShown === true;
    scene.appliedHybridOverrideTurns = new Set(checkpoint.appliedHybridOverrideTurns || []);
  }

  /**
   * Final resume step, after the turn manager / AI controller / HUD exist:
   * restore turn position, Vision snapshots, fog memory and the RNG stream,
   * then hand an exhausted player phase to the (deterministic) enemy replay.
   */
  finalizeResume(checkpoint) {
    const scene = this.scene;
    scene.turnManager.currentPhase = 'player';
    scene.turnManager.turnNumber = Math.max(1, Math.trunc(checkpoint.turnNumber) || 1);
    if (checkpoint.turnPar !== null && checkpoint.turnPar !== undefined) {
      scene.turnPar = checkpoint.turnPar;
    }
    scene.visionSnapshot = checkpoint.visionSnapshot || null;
    scene.pendingVisionSnapshot = checkpoint.pendingVisionSnapshot || null;
    scene.antiTurtleState = structuredClone(checkpoint.antiTurtleState || {});
    scene.aiController?.setAggressiveMode?.(Boolean(scene.antiTurtleState.aggressiveMode));

    if (scene.grid.fogEnabled && checkpoint.fog) {
      scene.grid.visibleSet = new Set(checkpoint.fog.visible || []);
      scene.grid.everSeenSet = new Set(checkpoint.fog.everSeen || []);
      for (let row = 0; row < scene.grid.rows; row++) {
        for (let col = 0; col < scene.grid.cols; col++) {
          const key = `${col},${row}`;
          const overlay = scene.grid.fogOverlays[row]?.[col];
          if (!overlay) continue;
          if (scene.grid.visibleSet.has(key)) overlay.setAlpha(0);
          else if (scene.grid.everSeenSet.has(key)) overlay.setAlpha(0.3);
          else overlay.setAlpha(0.7);
        }
      }
      scene.updateEnemyVisibility();
    }

    scene.reseedBattleRng(checkpoint.rngSeed);
    scene.dangerZoneStale = true;
    scene.battleState = 'PLAYER_IDLE';
    scene.updateObjectiveText();
    if (scene.turnCounterText && scene.turnPar !== null) {
      const rating = getRating(scene.turnManager.turnNumber, scene.turnPar, scene.turnBonusConfig);
      const colors = { S: '#44ff44', A: '#88ccff', B: '#ffaa55', C: '#cc3333' };
      const pressureSuffix = scene.getTurnPressureSummary(scene.turnManager.turnNumber);
      scene.turnCounterText.setText(
        `Turn: ${scene.turnManager.turnNumber} / Par: ${scene.turnPar} (${rating.rating})${pressureSuffix}`,
      );
      scene.turnCounterText.setColor(colors[rating.rating] || '#e0e0e0');
    } else if (scene.turnCounterText) {
      const pressureSuffix = scene.getTurnPressureSummary(scene.turnManager.turnNumber);
      scene.turnCounterText.setText(`Turn: ${scene.turnManager.turnNumber}${pressureSuffix}`);
      scene.turnCounterText.setColor('#e0e0e0');
    }
    scene.updateVisionHud();
    scene.refreshEndTurnControl();
    try {
      Promise.resolve(showMinorHint(scene, 'Battle resumed.')).catch(() => {});
    } catch (_) {
      /* cosmetic only */
    }

    // An end-of-turn checkpoint (every unit acted) hands straight off to the
    // enemy phase — which replays deterministically under the restored seed.
    const allActed =
      scene.playerUnits.length > 0 && scene.playerUnits.every((u) => u.hasActed === true);
    if (allActed) scene.turnManager.endPlayerPhase();
  }

  destroy() {
    this.scene = null;
  }
}
