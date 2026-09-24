// Normal's opening party should meet cavalry only after help has joined.
// Fallen members still count; deployment choices and later casualties do not
// re-enable this protection. Both arrays are already persisted in old saves.
export function restrictOpeningCavaliers(run) {
  return (
    (run.difficultyId || 'normal') === 'normal' &&
    run.currentAct === 'act1' &&
    (run.roster?.length || 0) + (run.fallenUnits?.length || 0) < 3
  );
}
export function earlyEnemyAllowed(className, params) {
  return !(params?.excludeOpeningCavaliers && className === 'Cavalier');
}
