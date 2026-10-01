import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { normalizeSpecialCharacter } from '../engine/SpecialCharacterPolicy.js';
import { persistWithTimelineFallback } from '../engine/BattleTimelinePersistence.js';
import { resumeFatalDecision } from './BattleFatalDecision.js';
import { recordBattleTimeline, rewindFingerprint } from './BattleTimelineRecorder.js';
// BattleSuspendController — mid-battle suspend/resume (anti-refresh).
//
// The battle continuously persists a "suspend checkpoint" into the run save
// at player-stable points (turn start after turn-start effects, after every
// completed unit action, after a Vision rewind). Any exit — refresh, crash,
// closed tab, Save & Exit — leads to the same continue choice: Resume battle
// (restore this checkpoint exactly) or Continue from map (sanctioned full
// revert). The battle RNG is reseeded at every capture and the seed stored,
// so a resumed battle replays the identical stream: refreshing can never
// reroll an outcome that already resolved. A confirmed player attack is
// also checkpointed before its rolls (pendingCommittedAction, captured with
// commitIntent so the RNG stream and forecast roll key are untouched); a
// refresh during its animation resumes into that same attack rather than a
// fresh choice made with the result already seen. Other player actions
// (staves, abilities, items) have no hidden rolls, so re-choosing one after
// a refresh reveals nothing new.
//
// State stays on BattleScene (units, fog, HUD); the controller reads/writes
// via scene.* like the other extracted battle controllers.

import { relinkWeapon } from '../engine/RunManager.js';
import { restoreBattleWorldState } from '../engine/BattleSnapshotState.js';
import { isSleeping } from '../engine/StatusConditionSystem.js';
import { getRating } from '../engine/TurnBonusCalculator.js';
import { hashRewindSeed } from './VisionRewindController.js';
import { showMinorHint } from './HintDisplay.js';
import {
  completeResolvedAction,
  readActionContinuation,
  readCommittedAction,
} from './BattlePresentationCheckpoint.js';

import { serializeBattleUnit, restoreEquippedReference } from '../engine/BattleUnitState.js';
import {
  registerBattleEntity,
  resetBattleIdentities,
  BATTLE_UNIT_GROUPS,
} from '../engine/BattleEntityIdentity.js';
import { captureBattleState } from './BattleCheckpointAdapter.js';
import { UI_PALETTE } from '../utils/uiStyles.js';

export const serializeSuspendUnit = serializeBattleUnit;

export class BattleSuspendController {
  constructor(scene) {
    this.scene = scene;
    this.session = battleSession(scene);
    this._retryCheckpoint = null;
  }

  /**
   * Capture the current player-stable state into the run save. Failures only
   * degrade the suspend lock, never gameplay.
   * @returns {boolean} true when a checkpoint was captured and persisted
   */
  /**
   * @param {object} [options]
   * @param {boolean} [options.preserveRng] keep the current RNG stream
   * @param {boolean} [options.commitIntent] save a just-confirmed action
   *   before its rolls: keep the RNG stream and decision key untouched (the
   *   forecast's roll session depends on it) and add no timeline row.
   */
  captureCheckpoint({ preserveRng = false, commitIntent = false, session = this.session } = {}) {
    const scene = this.scene;
    if (!isCurrentBattleSession(scene, session) || session !== this.session)
      return this._captureResult({ ok: false, reason: 'stale_session' });
    const rm = scene.runManager;
    if (!rm?.battleInProgress) return this._captureResult({ ok: false, reason: 'no_battle' }); // tutorial/standalone or battle already settled
    if (
      scene.battleState === 'BATTLE_END' ||
      scene._fatalDecision ||
      scene._fatalCapturePending ||
      scene._defeatDecision
    )
      return this._captureResult({ ok: false, reason: 'unstable_boundary' });
    const enemyBoundary =
      scene.turnManager?.currentPhase === 'enemy' && scene._enemyActionCheckpoint === true;
    if (scene.turnManager?.currentPhase !== 'player' && !enemyBoundary)
      return this._captureResult({ ok: false, reason: 'wrong_phase' });
    // A newer capture owns retry state even if serialization itself fails.
    this._retryCandidate = null;
    this._retryCheckpoint = null;
    try {
      const index = (Number(rm.battleInProgress.checkpoint?.checkpointIndex) || 0) + 1;
      const base = Number.isFinite(scene.visionBaseSeed) ? scene.visionBaseSeed >>> 0 : 0;
      const fixed = scene._battleRewindPolicy === 'fixed-v1';
      const keepRng = preserveRng || commitIntent;
      const seed = fixed || keepRng ? Number(rm.rngSeed) >>> 0 : hashRewindSeed(base, index);
      // Reseed at the checkpoint so live play and any resume from it share
      // the exact same RNG stream from this point on.
      if (!fixed && !keepRng) scene.reseedBattleRng(seed);
      if (fixed && !commitIntent)
        scene._battleDecisionRngState = scene._battleRng?.getState?.() || null;
      const checkpoint = this._buildCheckpoint(index, seed);
      rm.setBattleCheckpoint(checkpoint);
      this._retryCheckpoint = checkpoint;
      if (!commitIntent) {
        try {
          // Optional history failure must never prevent the latest recovery save.
          const { visionSnapshot, pendingVisionSnapshot, ...state } = checkpoint;
          recordBattleTimeline(scene, state);
        } catch (error) {
          console.warn('[Timeline] optional history unavailable:', error?.message || error);
        }
      }
      let candidate = rm.toJSON ? rm.toJSON() : null;
      let persisted = scene._persistBattleRunState?.(candidate, { session });
      if (persisted?.reason === 'quota' && rm.toJSON && rm.battleInProgress.timeline) {
        const fallback = persistWithTimelineFallback(
          candidate,
          (candidate) => scene._persistBattleRunState(candidate, { session }),
          persisted,
        );
        persisted = fallback;
        if (fallback.candidate) candidate = fallback.candidate;
        if (fallback.ok) {
          rm.battleInProgress = fallback.candidate.battleInProgress;
          scene._battleTimeline = rm.battleInProgress.timeline;
          scene._timelineCurrentEntryId = rm.battleInProgress.timelineCurrentEntryId;
        }
      }
      this._retryCandidate = persisted?.ok ? null : candidate && structuredClone(candidate);
      return this._captureResult(persisted || { ok: false, reason: 'missing_persistence' });
    } catch (err) {
      console.warn('[BattleSuspend] checkpoint capture failed:', err?.message || err);
      return this._captureResult({ ok: false, reason: 'capture_error' });
    }
  }

  _captureResult(result) {
    this.lastResult = result;
    if (isCurrentBattleSession(this.scene, this.session))
      this.scene._checkpointPersistenceResult = result;
    return result.ok === true;
  }

  // A storage retry must not recapture, append history or reseed legacy RNG.
  retryCheckpoint() {
    const scene = this.scene;
    if (!isCurrentBattleSession(scene, this.session)) return { ok: false, reason: 'stale_session' };
    if (
      !this._retryCandidate ||
      !this._retryCheckpoint ||
      scene.runManager?.battleInProgress?.checkpoint !== this._retryCheckpoint
    )
      return { ok: false, reason: 'checkpoint_replaced' };
    const result = scene._persistBattleRunState?.(this._retryCandidate, {
      session: this.session,
    }) || {
      ok: false,
      reason: 'missing_persistence',
    };
    if (result.ok) {
      scene.runManager.battleInProgress = this._retryCandidate.battleInProgress;
      scene._battleTimeline = scene.runManager.battleInProgress.timeline;
      scene._timelineCurrentEntryId = scene.runManager.battleInProgress.timelineCurrentEntryId;
      this._retryCandidate = null;
    }
    this._captureResult(result);
    return result;
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
    scene._combatFx?.reset?.();
    resetBattleIdentities(
      scene,
      checkpoint.nextEntityId,
      BATTLE_UNIT_GROUPS.flatMap((key) => checkpoint[key] || []),
    );
    const restore = (targetArr, list) => {
      for (const data of Array.isArray(list) ? list : []) {
        const unit = normalizeSpecialCharacter(structuredClone(data), scene.gameData?.specialChars);
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
      const unit = normalizeSpecialCharacter(structuredClone(data), scene.gameData?.specialChars);
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
      normalizeSpecialCharacter(unit, scene.gameData?.specialChars);
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
      const colors = {
        S: UI_PALETTE.good,
        A: UI_PALETTE.info,
        B: UI_PALETTE.warn,
        C: UI_PALETTE.bad,
      };
      const pressureSuffix = scene.getTurnPressureSummary(scene.turnManager.turnNumber);
      scene.turnCounterText.setText(
        `Turn: ${scene.turnManager.turnNumber} / Par: ${scene.turnPar} (${rating.rating})${pressureSuffix}`,
      );
      scene.turnCounterText.setColor(colors[rating.rating] || UI_PALETTE.text);
    } else if (scene.turnCounterText) {
      const pressureSuffix = scene.getTurnPressureSummary(scene.turnManager.turnNumber);
      scene.turnCounterText.setText(`Turn: ${scene.turnManager.turnNumber}${pressureSuffix}`);
      scene.turnCounterText.setColor(UI_PALETTE.text);
    }
    scene.updateVisionHud();
    scene.refreshEndTurnControl();
    // Resuming exactly on a rewind point: free changes from here are detectable.
    const current = scene._battleTimeline?.entries?.find(
      (entry) => entry.id === scene._timelineCurrentEntryId,
    );
    if (current?.destination && checkpoint.phase === 'player')
      scene._rewindFingerprint = rewindFingerprint(scene);
    if (checkpoint.recoveryKind === 'fatal_pending') {
      resumeFatalDecision(scene, checkpoint);
      return;
    }
    if (enemyResume) {
      scene.battleState = 'ENEMY_PHASE';
      const resume = () => scene.startEnemyPhase({ resume: true });
      const resumeTurn = scene.turnManager.turnNumber;
      if (scene._scheduleSafeDelayedAsync)
        scene._scheduleSafeDelayedAsync(0, 'enemy_phase_resume', resume, {
          phase: 'enemy',
          turn: resumeTurn,
          onError: (err) => scene._recoverEnemyPhaseError?.(resumeTurn, err),
        });
      else return resume();
      return;
    }
    const continuation = readActionContinuation(checkpoint.pendingActionCompletion);
    if (continuation) {
      completeResolvedAction(scene, continuation, { session: this.session });
      return;
    }
    const committed = readCommittedAction(checkpoint.pendingCommittedAction);
    if (committed && scene.resumeCommittedAttack?.(committed)) return;
    try {
      const note = scene._presentationSwitch
        ? scene.grid?.board?.rotated
          ? 'Portrait view.'
          : 'Landscape view.'
        : 'Battle resumed.';
      Promise.resolve(showMinorHint(scene, note)).catch(() => {});
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
