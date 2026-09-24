import { commitHistoryPath, observeHistoryAction } from './BattleHistoryRecorder.js';
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
  scene._captureSuspendCheckpoint?.();
  scene.turnManager.unitActed(unit);
}
