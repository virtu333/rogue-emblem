import { findBattleEntity } from '../engine/BattleEntityIdentity.js';
import { LevelUpPopup } from './LevelUpPopup.js';
import { gridDistance } from '../engine/Combat.js';

// Save fields are untrusted; only these two resolved-action continuations exist.
export function readActionContinuation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['combat', 'finish'].includes(value.kind)) return null;
  if (
    value.unitId !== undefined &&
    (typeof value.unitId !== 'string' || !/^u[1-9]\d*$/.test(value.unitId))
  )
    return null;
  if (typeof value.unitName !== 'string' || !value.unitName.trim()) return null;
  if (value.skipCanto !== undefined && typeof value.skipCanto !== 'boolean') return null;
  if (value.gambitTriggered !== undefined && typeof value.gambitTriggered !== 'boolean')
    return null;
  return {
    kind: value.kind,
    unitName: value.unitName,
    ...(value.unitId ? { unitId: value.unitId } : {}),
    ...(value.skipCanto !== undefined ? { skipCanto: value.skipCanto } : {}),
    ...(value.gambitTriggered !== undefined ? { gambitTriggered: value.gambitTriggered } : {}),
  };
}

// Presentation must never be the only thing preventing a resolved action from
// reaching storage. Resume runs this small continuation, never combat or XP.
export function captureResolvedAction(scene, continuation) {
  if (scene._fatalDecision || scene._fatalCapturePending || scene._defeatDecision) return;
  scene.commitVisionSnapshotIfPending?.();
  scene._pendingActionCompletion = continuation;
  scene._captureSuspendCheckpoint?.();
}

export async function presentQueuedLevelUps(scene, continuation = null) {
  if (scene._fatalDecision || scene._fatalCapturePending || scene._defeatDecision) return;
  const queue = scene._pendingLevelUpPopups || [];
  if (!queue.length) return;
  scene._pendingLevelUpPopups = [];
  if (continuation) captureResolvedAction(scene, continuation);
  for (const { unitName, unitId, levelUp, learnedNames } of queue) {
    if (scene._sceneShutdownCleanedUp || scene.sys?.isActive?.() === false) return;
    const unit = findBattleEntity(scene, { unitId, unitName }, ['playerUnits']);
    if (!unit) continue;
    scene._playLevelUpSfx();
    scene.updateHPBar(unit);
    try {
      await new LevelUpPopup(scene, unit, levelUp, false, learnedNames).show();
    } finally {
      scene._stopLevelUpSfx();
    }
  }
}

export function completeResolvedAction(scene, continuation) {
  scene._pendingActionCompletion = null;
  continuation = readActionContinuation(continuation);
  if (!continuation) return;
  const unit = findBattleEntity(scene, continuation, ['playerUnits']);
  if (scene.checkBattleEnd?.()) return;
  if (
    continuation.kind === 'combat' &&
    unit &&
    continuation.gambitTriggered &&
    !unit._gambitUsedThisTurn
  ) {
    unit._gambitUsedThisTurn = true;
    for (const ally of scene.playerUnits) {
      if (
        ally.currentHP <= 0 ||
        (ally !== unit && gridDistance(unit.col, unit.row, ally.col, ally.row) > 1)
      )
        continue;
      ally.hasActed = false;
      ally.hasMoved = false;
      ally._movementCommitted = false;
      ally._movementSpent = 0;
      ally.graphic?.clearTint?.();
    }
  } else if (unit) {
    scene.finishUnitAction(unit, { skipCanto: continuation.skipCanto === true });
    return;
  }
  scene.selectedUnit = null;
  scene.battleState = 'PLAYER_IDLE';
  scene.grid.clearAttackHighlights();
  scene.attackTargets = [];
  scene.commitVisionSnapshotIfPending?.();
  scene._timelineBoundary = 'player_action';
  if (continuation.gambitTriggered)
    scene._timelineFacts = [
      ...(scene._timelineFacts || []),
      "Commander's Gambit refreshed nearby allies.",
    ];
  scene._captureSuspendCheckpoint?.();
}
