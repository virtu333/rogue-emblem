import { commitHistoryPath, observeHistoryAction } from './BattleHistoryRecorder.js';
import { settleAccessoryHpOwed } from '../engine/UnitManager.js';
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
  if (!skipDim) scene.dimUnit(unit);
  scene._villageController?.handleUnitActionEnd(unit);
  scene.selectedUnit = null;
  scene.preMoveLoc = null;
  scene._preFogSnapshot = null;
  scene.cantoRange = null;
  scene.battleState = 'PLAYER_IDLE';
  scene._timelineBoundary = 'player_action';
  scene._timelineFacts = [...(scene._timelineFacts || []), `${unit.name} finished their action.`];
  revealSettledVision(scene);
  // Before the save: an ally healed to full this action owes no HP accessory debt.
  for (const ally of scene.playerUnits || []) settleAccessoryHpOwed(ally);
  scene._captureSuspendCheckpoint?.();
  scene.turnManager.unitActed(unit);
}
