import { commitHistoryPath, observeHistoryAction } from './BattleHistoryRecorder.js';
import { settleAccessoryHpOwed } from '../engine/UnitHealth.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
/**
 * Fog of war shows what settled units see. A move reveals nothing on its own: the
 * fog lifts from a unit's new tile only once its action there is committed (Wait,
 * an attack, a staff, End Turn...), so backing out of a move can never have shown
 * what lay past the fog. Every path that settles a unit's turn calls this before
 * its suspend checkpoint, which saves fog as it stands.
 */
export function revealSettledVision(scene) {
  if (!scene.grid?.fogEnabled) return;
  scene.grid.updateFogOfWar(scene.playerUnits);
  scene.updateEnemyVisibility?.();
}

// Complete an action only after its final location is settled, including Canto.
// Keep rewards and the suspend save ahead of the possible phase transition.
export function completeBattleAction(scene, unit, { skipDim = false } = {}) {
  commitHistoryPath(scene, unit);
  if (!(scene._historyBeats || []).some((b) => b.actorId === unit.battleEntityId))
    observeHistoryAction(
      scene,
      scene._battleTimeline?.presentation?.records.at(-1)?.parents?.[unit.battleEntityId]
        ? 'finished their action'
        : 'waited',
      unit,
    );
  scene._historyActor = unit.battleEntityId;
  unit.hasActed = true;
  scene._villageController?.handleUnitActionEnd(unit);
  scene.selectedUnit = null;
  scene.preMoveLoc = null;
  scene._preFogSnapshot = null;
  scene.cantoRange = null;
  scene._cantoPending = null;
  scene.battleState = 'PLAYER_IDLE';
  scene._timelineBoundary = 'player_action';
  scene._timelineFacts = [...(scene._timelineFacts || []), `${unit.name} finished their action.`];
  revealSettledVision(scene);
  // Before the save: reconcile HP accessory debt (UnitHealth settles it on every HP
  // change; this also covers state loaded from before it did).
  for (const ally of scene.playerUnits || []) settleAccessoryHpOwed(ally);
  scene._captureSuspendCheckpoint?.();
  if (!skipDim) safeBattlePresentation('action dim', () => scene.dimUnit(unit), { scene });
  if (scene.playerUnits.includes(unit)) scene.turnManager.unitActed(unit);
  else scene.turnManager.checkPlayerPhaseComplete();
}
