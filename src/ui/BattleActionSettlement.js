import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { captureResolvedAction, presentQueuedLevelUps } from './BattlePresentationCheckpoint.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { reportAsyncError } from '../utils/errorReporter.js';

const RESOLVING = new Set(['HEAL_RESOLVING', 'COMBAT_RESOLVING', 'CANTO_MOVING', 'BATTLE_END']);

/** Settle one accepted action and save its continuation before rendering it. */
export async function settleAndPresent(
  scene,
  {
    unit,
    label,
    state = 'HEAL_RESOLVING',
    validate,
    settle,
    present,
    onInvalid,
    clearHighlights = true,
    continuation,
    session = battleSession(scene),
  },
) {
  if (
    !isCurrentBattleSession(scene, session) ||
    RESOLVING.has(scene.battleState) ||
    scene.turnManager?.currentPhase === 'enemy'
  )
    return false;
  const priorState = scene.battleState;
  scene.battleState = state;
  let facts;
  const recover = async (error) => {
    if (!isCurrentBattleSession(scene, session)) return false;
    reportAsyncError('battle_action_domain_error', error, {
      label,
      battleState: scene.battleState,
      phase: scene.turnManager?.currentPhase,
      turn: scene.turnManager?.turnNumber,
    });
    await scene._recoverUnitActionError(unit, label, error, { session });
    return false;
  };
  try {
    if (validate && !validate()) {
      scene.battleState = priorState;
      onInvalid?.();
      safeBattlePresentation(`${label} invalid selection`, () => scene.showActionMenu?.(unit), {
        scene,
      });
      return false;
    }
    scene.commitVisionSnapshotIfPending?.();
    facts = settle();
    if (facts && typeof facts.then === 'function') {
      Promise.resolve(facts).catch(() => {});
      throw new TypeError('Battle action settlement must be synchronous');
    }
    if (!isCurrentBattleSession(scene, session)) return false;
    const finish = continuation || {
      kind: 'finish',
      unitName: unit.name,
      ...(unit.battleEntityId ? { unitId: unit.battleEntityId } : {}),
      skipCanto: false,
    };
    const saved = captureResolvedAction(scene, finish, { session, preserveRng: true });
    if (
      saved === false &&
      ['quota', 'write_error'].includes(scene._checkpointPersistenceResult?.reason)
    ) {
      const gate = scene._saveRetryGate?.(session);
      if (gate) {
        await gate;
        if (!isCurrentBattleSession(scene, session)) return false;
      }
    }
    if (
      !isCurrentBattleSession(scene, session) ||
      scene._fatalDecision ||
      scene._fatalCapturePending ||
      scene._defeatDecision ||
      scene.battleState === 'BATTLE_END'
    )
      return false;
    if (clearHighlights)
      safeBattlePresentation(`${label} highlights`, () => scene.grid.clearAttackHighlights(), {
        scene,
      });
    await safeBattlePresentation(`${label} presentation`, () => present?.(facts, { session }), {
      scene,
    });
    if (!isCurrentBattleSession(scene, session)) return false;
    await presentQueuedLevelUps(scene, null, { session });
    if (!isCurrentBattleSession(scene, session)) return false;
    scene._pendingActionCompletion = null;
    await scene.finishUnitAction(unit, {
      session,
      ...(finish.skipCanto === true ? { skipCanto: true } : {}),
    });
    return true;
  } catch (error) {
    return recover(error);
  }
}
