import { persistWithTimelineFallback } from '../engine/BattleTimelinePersistence.js';
import { resumeFatalDecision } from './BattleFatalDecision.js';
import { recordBattleTimeline } from './BattleTimelineRecorder.js';
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

import { relinkWeapon } from '../engine/RunManager.js';
import { restoreBattleWorldState } from '../engine/BattleSnapshotState.js';
import { isSleeping } from '../engine/StatusConditionSystem.js';
import { getRating } from '../engine/TurnBonusCalculator.js';
import { hashRewindSeed } from './VisionRewindController.js';
import { showMinorHint } from './HintDisplay.js';
import { completeResolvedAction, readActionContinuation } from './BattlePresentationCheckpoint.js';

import { serializeBattleUnit, restoreEquippedReference } from '../engine/BattleUnitState.js';
import {
  registerBattleEntity,
  resetBattleIdentities,
  BATTLE_UNIT_GROUPS,
} from '../engine/BattleEntityIdentity.js';
import { captureBattleState } from './BattleCheckpointAdapter.js';

export const serializeSuspendUnit = serializeBattleUnit;

export class BattleSuspendController {
  constructor(scene) {
    this.scene = scene;
  }

  /**
   * Capture the current player-stable state into the run save. Failures only
   * degrade the suspend lock, never gameplay.
   * @returns {boolean} true when a checkpoint was captured and persisted
   */
  captureCheckpoint({ preserveRng = false } = {}) {
    const scene = this.scene;
    const rm = scene.runManager;
    if (!rm?.battleInProgress) return false; // tutorial/standalone or battle already settled
    if (
      scene.battleState === 'BATTLE_END' ||
      scene._fatalDecision ||
      scene._fatalCapturePending ||
      scene._defeatDecision
    )
      return false;
    const enemyBoundary =
      scene.turnManager?.currentPhase === 'enemy' && scene._enemyActionCheckpoint === true;
    if (scene.turnManager?.currentPhase !== 'player' && !enemyBoundary) return false;
    try {
      const index = (Number(rm.battleInProgress.checkpoint?.checkpointIndex) || 0) + 1;
      const base = Number.isFinite(scene.visionBaseSeed) ? scene.visionBaseSeed >>> 0 : 0;
      const fixed = scene._battleRewindPolicy === 'fixed-v1';
      const seed = fixed || preserveRng ? Number(rm.rngSeed) >>> 0 : hashRewindSeed(base, index);
      // Reseed at the checkpoint so live play and any resume from it share
      // the exact same RNG stream from this point on.
      if (!fixed && !preserveRng) scene.reseedBattleRng(seed);
      if (fixed) scene._battleDecisionRngState = scene._battleRng?.getState?.() || null;
      const checkpoint = this._buildCheckpoint(index, seed);
      rm.setBattleCheckpoint(checkpoint);
      try {
        // Optional history failure must never prevent the latest recovery save.
        const { visionSnapshot, pendingVisionSnapshot, ...state } = checkpoint;
        recordBattleTimeline(scene, state);
      } catch (error) {
        console.warn('[Timeline] optional history unavailable:', error?.message || error);
      }
      let persisted = scene._persistBattleRunState?.();
      if (persisted?.reason === 'quota' && rm.toJSON && rm.battleInProgress.timeline) {
        const fallback = persistWithTimelineFallback(
          rm.toJSON(),
          (candidate) => scene._persistBattleRunState(candidate),
          persisted,
        );
        persisted = fallback;
        if (fallback.ok) {
          rm.battleInProgress = fallback.candidate.battleInProgress;
          scene._battleTimeline = rm.battleInProgress.timeline;
          scene._timelineCurrentEntryId = rm.battleInProgress.timelineCurrentEntryId;
        }
      }
      return persisted?.ok === true;
    } catch (err) {
      console.warn('[BattleSuspend] checkpoint capture failed:', err?.message || err);
      return false;
    }
  }

  _buildCheckpoint(checkpointIndex, rngSeed) {
    const scene = this.scene;
    return {
      ...captureBattleState(scene, { checkpointIndex, rngSeed }),
      // Compatibility envelope; historical snapshots use captureBattleState directly.
      visionSnapshot: structuredClone(scene.visionSnapshot || null),
      pendingVisionSnapshot: structuredClone(scene.pendingVisionSnapshot || null),
    };
  }

  /**
   * Restore unit arrays (and unit-scoped battle state) from a checkpoint.
   * Called from beginBattle at the point where fresh spawns would be created
   * — the grid exists, HUD/turn manager do not yet.
   */
  applyUnits(checkpoint) {
    const scene = this.scene;
    resetBattleIdentities(
      scene,
      checkpoint.nextEntityId,
      BATTLE_UNIT_GROUPS.flatMap((key) => checkpoint[key] || []),
    );
    const restore = (targetArr, list) => {
      for (const data of Array.isArray(list) ? list : []) {
        const unit = structuredClone(data);
        // The checkpoint crossed a JSON boundary, which breaks the
        // weapon === inventory[i] identity invariant — relink like fromJSON.
        restoreEquippedReference(unit);
        relinkWeapon(unit);
        registerBattleEntity(scene, unit);
        // Build 9 checkpoints saved after a trade retained hasMoved but had
        // no commitment flag. Conservatively keep that movement spent while
        // preserving the unit's remaining attack/item actions. Explicit flags
        // in new saves remain authoritative (including false after a refresh).
        if (unit._movementCommitted === undefined && unit.faction === 'player') {
          unit._movementCommitted = unit.hasMoved === true && unit.hasActed !== true;
        }
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
      restoreEquippedReference(unit);
      relinkWeapon(unit);
      registerBattleEntity(scene, unit);
      return unit;
    });
    for (const unit of scene.playerUnits) {
      if (unit.hasActed || isSleeping(unit)) scene.dimUnit(unit);
    }
    scene.nonDeployedUnits = structuredClone(checkpoint.nonDeployedUnits || []);
    for (const unit of scene.nonDeployedUnits) {
      restoreEquippedReference(unit);
      relinkWeapon(unit);
      registerBattleEntity(scene, unit);
    }
    if (checkpoint.runBattleState && scene.runManager) {
      const domain = checkpoint.runBattleState;
      // This is a rewindable subset, never an arbitrary RunManager assignment.
      if (Array.isArray(domain.convoy?.weapons) && Array.isArray(domain.convoy?.consumables))
        scene.runManager.convoy = structuredClone(domain.convoy);
      if (Array.isArray(domain.accessories))
        scene.runManager.accessories = structuredClone(domain.accessories);
      if (Number.isFinite(domain.gold) && domain.gold >= 0) scene.runManager.gold = domain.gold;
    }
    scene.ballistas = (checkpoint.ballistas || []).map((b) => ({ ...b }));
    scene._zombieTombstones = structuredClone(checkpoint.zombieTombstones || []);
    scene.goldEarned = Number(checkpoint.goldEarned) || 0;
    scene._playerDeathsThisBattle = Number(checkpoint.playerDeathsThisBattle) || 0;
    scene._latePressureWarningShown = checkpoint.latePressureWarningShown === true;
    scene.appliedHybridOverrideTurns = new Set(checkpoint.appliedHybridOverrideTurns || []);
    scene._caravanExited = checkpoint.caravanExited === true;
    scene._villageState = checkpoint.villageState ? { ...checkpoint.villageState } : null;
    restoreBattleWorldState(scene, checkpoint);
  }

  /**
   * Final resume step, after the turn manager / AI controller / HUD exist:
   * restore turn position, Vision snapshots, fog memory and the RNG stream,
   * then hand an exhausted player phase to the (deterministic) enemy replay.
   */
  finalizeResume(checkpoint) {
    const scene = this.scene;
    const enemyResume = checkpoint.phase === 'enemy';
    scene.turnManager.currentPhase = enemyResume ? 'enemy' : 'player';
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

    if (Number.isFinite(checkpoint.visionBaseSeed))
      scene.visionBaseSeed = checkpoint.visionBaseSeed >>> 0;
    if (checkpoint.rngState) scene.reseedBattleRng(checkpoint.rngSeed, checkpoint.rngState);
    else scene.reseedBattleRng(checkpoint.rngSeed);
    scene._battleDecisionRngState = checkpoint.decisionRngState || checkpoint.rngState || null;
    scene.dangerZoneStale = true;
    scene._pinnedThreats?.invalidate();
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
    if (checkpoint.recoveryKind === 'fatal_pending') {
      resumeFatalDecision(scene, checkpoint);
      return;
    }
    if (enemyResume) {
      scene.battleState = 'ENEMY_PHASE';
      const resume = () => scene.startEnemyPhase({ resume: true });
      if (scene._scheduleSafeDelayedAsync)
        scene._scheduleSafeDelayedAsync(0, 'enemy_phase_resume', resume, {
          phase: 'enemy',
          turn: scene.turnManager.turnNumber,
        });
      else return resume();
      return;
    }
    const continuation = readActionContinuation(checkpoint.pendingActionCompletion);
    if (continuation) {
      completeResolvedAction(scene, continuation);
      return;
    }
    try {
      Promise.resolve(showMinorHint(scene, 'Battle resumed.')).catch(() => {});
    } catch (_) {
      /* cosmetic only */
    }

    // An exhausted phase (every living unit acted or sleeps) hands off to the
    // enemy phase — which replays deterministically under the restored seed.
    const allActed =
      scene.playerUnits.length > 0 &&
      scene.playerUnits.every((u) => u.currentHP <= 0 || u.hasActed === true || isSleeping(u));
    if (allActed) scene.turnManager.endPlayerPhase();
  }

  destroy() {
    this.scene = null;
  }
}
