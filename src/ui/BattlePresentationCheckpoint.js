import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { findBattleEntity } from '../engine/BattleEntityIdentity.js';
import { LevelUpPopup } from './LevelUpPopup.js';
import { gridDistance } from '../engine/Combat.js';
import { levelUpKind } from './growthContent.js';

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

// A confirmed player attack is saved before any roll is revealed. Resume
// replays exactly this attack from the saved RNG state (so the outcome is
// identical) instead of letting a refresh swap it for a different action.
// Save fields are untrusted; validate the shape before replaying anything.
export function readCommittedAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind !== 'attack') return null;
  const id = (v) => typeof v === 'string' && /^u[1-9]\d*$/.test(v);
  if (!id(value.unitId) || !id(value.targetId) || value.unitId === value.targetId) return null;
  if (typeof value.unitName !== 'string' || !value.unitName.trim()) return null;
  let weaponArt = null;
  if (value.weaponArt != null) {
    const art = value.weaponArt;
    if (
      typeof art !== 'object' ||
      typeof art.artId !== 'string' ||
      !art.artId ||
      !Number.isInteger(art.weaponIndex) ||
      art.weaponIndex < -1
    )
      return null;
    weaponArt = { artId: art.artId, weaponIndex: art.weaponIndex };
    // Optional (newer saves): the art weapon's uid survives the equipped-first
    // reorder on confirm. Legacy intents resolve by index as before.
    if (typeof art.weaponUid === 'string' && art.weaponUid && art.weaponUid.length <= 64)
      weaponArt.weaponUid = art.weaponUid;
  }
  // Gambler's Coin modifiers the forecast already rolled (null = not rolled).
  let gamblerAtkDelta = null;
  if (value.gamblerAtkDelta != null) {
    const g = value.gamblerAtkDelta;
    const side = (v) => v === null || v === undefined || (Number.isInteger(v) && Math.abs(v) <= 99);
    if (typeof g !== 'object' || Array.isArray(g) || !side(g.attacker) || !side(g.defender))
      return null;
    const pick = (v) => (Number.isInteger(v) ? v : null);
    if (pick(g.attacker) !== null || pick(g.defender) !== null)
      gamblerAtkDelta = { attacker: pick(g.attacker), defender: pick(g.defender) };
  }
  return {
    kind: 'attack',
    unitId: value.unitId,
    unitName: value.unitName,
    targetId: value.targetId,
    weaponArt,
    ...(gamblerAtkDelta ? { gamblerAtkDelta } : {}),
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
    scene._playLevelUpSfx(levelUpKind(levelUp));
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
      observeHistoryAction(scene, 'refreshed', unit, ally, `Commander's Gambit`);
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
