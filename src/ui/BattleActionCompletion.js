// Complete an action only after its final location is settled, including Canto.
// Keep rewards and the suspend save ahead of the possible phase transition.
export function completeBattleAction(scene, unit, { skipDim = false } = {}) {
  unit.hasActed = true;
  if (!skipDim) scene.dimUnit(unit);
  scene._villageController?.handleUnitActionEnd(unit);
  scene.selectedUnit = null;
  scene.preMoveLoc = null;
  scene._preFogSnapshot = null;
  scene.cantoRange = null;
  scene.battleState = 'PLAYER_IDLE';
  scene._captureSuspendCheckpoint?.();
  scene.turnManager.unitActed(unit);
}
