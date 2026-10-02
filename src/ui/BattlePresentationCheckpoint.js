import { isCurrentBattleSession } from './BattleSession.js';
import { cantoRuleFor } from '../engine/CantoRule.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { revealSettledVision } from './BattleActionCompletion.js';
import { findBattleEntity, isBattleEntityId } from '../engine/BattleEntityIdentity.js';
import { readActionContinuation } from '../engine/ActionContinuation.js';
import { LevelUpPopup } from './LevelUpPopup.js';
import { gridDistance } from '../engine/Combat.js';
import { levelUpKind } from './growthContent.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';

// Save fields are untrusted; the one definition of the shape lives in the engine.
export { readActionContinuation };

// A confirmed player attack is saved before any roll is revealed. Resume
// replays exactly this attack from the saved RNG state (so the outcome is
// identical) instead of letting a refresh swap it for a different action.
// Save fields are untrusted; validate the shape before replaying anything.
export function readCommittedAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind !== 'attack') return null;
  const id = isBattleEntityId;
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
export function captureResolvedAction(scene, continuation, { session, preserveRng = false } = {}) {
  if (!isCurrentBattleSession(scene, session)) return false;
  if (scene._fatalDecision || scene._fatalCapturePending || scene._defeatDecision) return;
  scene.commitVisionSnapshotIfPending?.();
  scene._pendingActionCompletion = continuation;
  return scene._captureSuspendCheckpoint?.({ session, preserveRng }) === true;
}

export async function presentQueuedLevelUps(scene, continuation = null, { session } = {}) {
  if (!isCurrentBattleSession(scene, session)) return;
  if (scene._fatalDecision || scene._fatalCapturePending || scene._defeatDecision) return;
  const queue = scene._pendingLevelUpPopups || [];
  if (!queue.length) return;
  scene._pendingLevelUpPopups = [];
  if (continuation) captureResolvedAction(scene, continuation, { session });
  for (const { unitName, unitId, levelUp, learnedNames } of queue) {
    if (!isCurrentBattleSession(scene, session)) return;
    const unit = findBattleEntity(scene, { unitId, unitName }, ['playerUnits']);
    if (!unit) continue;
    safeBattlePresentation('level-up sound', () => scene._playLevelUpSfx(levelUpKind(levelUp)), {
      scene,
    });
    safeBattlePresentation('level-up HP', () => scene.updateHPBar(unit), { scene });
    try {
      await safeBattlePresentation(
        'level-up popup',
        () => new LevelUpPopup(scene, unit, levelUp, false, learnedNames).show(),
        { scene },
      );
    } finally {
      if (isCurrentBattleSession(scene, session))
        safeBattlePresentation('level-up sound cleanup', () => scene._stopLevelUpSfx(), { scene });
    }
  }
}

/**
 * A refresh (Gambit, Galeforce) starts the actor's next action, so what finishUnitAction
 * would have cleared about the last one goes too: the chosen art, the combat's roll
 * session, open menus and target lists, and the move's undo point (`preMoveLoc`, the
 * pre-move fog). Not the unit's action: nothing is dimmed or marked acted.
 */
function clearRefreshedActionState(scene) {
  scene._clearCombatRollSession?.();
  scene._clearSelectedWeaponArt?.();
  safeBattlePresentation('refresh menu cleanup', () => scene.hideActionMenu?.(), { scene });
  scene.healTargets = [];
  scene.staffRelocateTargets = [];
  scene.staffRelocateAlly = null;
  scene.staffRelocateTiles = [];
  scene.inEquipMenu = false;
  scene.preMoveLoc = null;
  scene._preFogSnapshot = null;
  scene.cantoRange = null;
  scene._cantoPending = null;
}

export function completeResolvedAction(scene, continuation, { session } = {}) {
  if (!isCurrentBattleSession(scene, session)) return false;
  scene._pendingActionCompletion = null;
  continuation = readActionContinuation(continuation);
  if (!continuation) return;
  if (scene.checkBattleEnd?.()) return;
  const actor = findBattleEntity(scene, continuation, ['playerUnits']);
  const unit = actor?.currentHP <= 0 ? null : actor;
  const gambit =
    continuation.kind === 'combat' &&
    unit &&
    continuation.gambitTriggered &&
    !unit._gambitUsedThisTurn;
  // Galeforce (a kill-move art): the actor alone moves and acts again. Commander's
  // Gambit, which refreshes the actor too, wins when both fire (it is checked first).
  const galeforce = continuation.kind === 'combat' && unit && continuation.refreshActor === true;
  if (gambit) {
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
      safeBattlePresentation('Gambit tint', () => ally.graphic?.clearTint?.(), { scene });
    }
  } else if (galeforce) {
    observeHistoryAction(scene, 'refreshed', unit, unit, 'Galeforce');
    unit.hasActed = false;
    unit.hasMoved = false;
    unit._movementCommitted = false;
    unit._movementSpent = 0;
    safeBattlePresentation('Galeforce tint', () => unit.graphic?.clearTint?.(), { scene });
  } else if (unit) {
    scene.finishUnitAction(unit, {
      session,
      skipCanto:
        continuation.skipCanto === true ||
        (continuation.kind === 'combat' && cantoRuleFor(unit) === 'noncombat'),
    });
    return;
  }
  if (gambit || galeforce) clearRefreshedActionState(scene);
  scene.selectedUnit = null;
  scene.battleState = 'PLAYER_IDLE';
  safeBattlePresentation('resolved action highlights', () => scene.grid.clearAttackHighlights(), {
    scene,
  });
  scene.attackTargets = [];
  scene.commitVisionSnapshotIfPending?.();
  scene._timelineBoundary = 'player_action';
  // (As before Galeforce: a Gambit trigger is noted even when its actor fell.)
  if (continuation.gambitTriggered && (gambit || !galeforce))
    scene._timelineFacts = [
      ...(scene._timelineFacts || []),
      "Commander's Gambit refreshed nearby allies.",
    ];
  else if (galeforce)
    scene._timelineFacts = [...(scene._timelineFacts || []), `${unit.name} can act again.`];
  revealSettledVision(scene);
  scene._captureSuspendCheckpoint?.({ session });
  // The actor may have fallen before resume, or Gambit may have left no one
  // available. Completion still owes the phase check for the surviving roster.
  scene.turnManager.checkPlayerPhaseComplete();
}
