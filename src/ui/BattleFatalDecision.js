import { persistWithTimelineFallback } from '../engine/BattleTimelinePersistence.js';
import { captureBattleState } from './BattleCheckpointAdapter.js';
import { recordBattleTimeline } from './BattleTimelineRecorder.js';

// Terminal decision is a durable recovery kind, never a playable destination.
// A failed write freezes the settled board and retries the same candidate.
export function persistFatalDecision(scene) {
  const rm = scene.runManager;
  if (!rm?.battleInProgress) return { ok: false, reason: 'missing_battle' };
  if (scene._fatalDecision?.durable) return { ok: true };
  scene.battleState = 'PAUSED';
  if (!scene._fatalDecision) {
    scene._enemyPhaseEpoch = (scene._enemyPhaseEpoch || 0) + 1;
    scene._pendingActionCompletion = null;
    scene._pendingLevelUpPopups = [];
    scene._fatalCapturePending = true;
    try {
      const state = captureBattleState(scene, {
        rngSeed: rm.rngSeed,
        checkpointIndex: (rm.battleInProgress.checkpoint?.checkpointIndex || 0) + 1,
      });
      state.recoveryKind = 'fatal_pending';
      state.commanderEntityId = scene._battleCommanderId || null;
      state.commanderKillerName = scene._commanderKillerName || null;
      state.pendingActionCompletion = null;
      scene._timelineBoundary = 'recovery';
      scene._timelineFacts = [
        ...(scene._timelineFacts || []),
        'The commander fell. Choose whether to rewind or accept defeat.',
      ];
      try {
        recordBattleTimeline(scene, state);
      } catch (error) {
        console.warn('[Timeline] fatal report unavailable:', error);
      }
      const candidate = structuredClone(rm.toJSON());
      candidate.battleInProgress.checkpoint = {
        ...state,
        visionSnapshot: structuredClone(scene.visionSnapshot || null),
        pendingVisionSnapshot: null,
      };
      scene._fatalDecision = { candidate, durable: false };
      scene._fatalCapturePending = false;
    } catch (error) {
      console.warn('[Timeline] fatal checkpoint capture failed:', error);
      return { ok: false, reason: 'capture_error' };
    }
  }
  scene.battleState = 'PAUSED';
  const result = persistWithTimelineFallback(scene._fatalDecision.candidate, (candidate) =>
    scene._persistBattleRunState(candidate),
  );
  scene._fatalDecision.candidate = result.candidate;
  if (result?.ok) {
    rm.battleInProgress = scene._fatalDecision.candidate.battleInProgress;
    scene._fatalDecision.durable = true;
    scene._battleTimeline = rm.battleInProgress.timeline;
    scene._timelineCurrentEntryId = rm.battleInProgress.timelineCurrentEntryId;
  }
  return result || { ok: false, reason: 'write_error' };
}

export function resumeFatalDecision(scene, checkpoint) {
  scene._battleCommanderId = checkpoint.commanderEntityId;
  scene._commanderKillerName = checkpoint.commanderKillerName || null;
  scene._fatalDecision = { durable: true, candidate: null };
  scene._pendingActionCompletion = null;
  scene._pendingLevelUpPopups = [];
  scene._enemyPhaseEpoch = (scene._enemyPhaseEpoch || 0) + 1;
  scene.battleState = 'PAUSED';
  if (!scene.showLordDeathVisionPrompt()) scene.onDefeat();
}

// Prepare defeat without publishing it. Rewards and scene transitions are
// permitted only after this same record has reached durable storage.
export function persistBattleDefeat(scene, context) {
  const rm = scene.runManager;
  if (!scene._defeatDecision) {
    const candidate = Object.assign(
      Object.create(Object.getPrototypeOf(rm)),
      structuredClone(rm.toJSON()),
    );
    candidate.failRun(context);
    scene._defeatDecision = { candidate: candidate.toJSON(), durable: false };
    scene._enemyPhaseEpoch = (scene._enemyPhaseEpoch || 0) + 1;
  }
  scene.battleState = 'PAUSED';
  const decision = scene._defeatDecision;
  if (!decision.durable) {
    let result;
    try {
      result = scene._persistBattleRunState(decision.candidate);
    } catch {
      result = { ok: false, reason: 'write_error' };
    }
    if (result?.reason === 'quota' && decision.candidate.lastBattleReport) {
      decision.candidate.lastBattleReport = null;
      try {
        result = scene._persistBattleRunState(decision.candidate);
      } catch {
        result = { ok: false, reason: 'write_error' };
      }
    }
    if (result?.ok !== true) return result || { ok: false, reason: 'write_error' };
    decision.durable = true;
    rm.lastBattleReport = decision.candidate.lastBattleReport;
    rm.failRun(context);
  }
  return { ok: true };
}
