// Shared world-state contract for Vision and suspend. Unit arrays are restored
// in snapshot order; references into that table survive JSON and duplicate names.
const UNIT_GROUPS = ['playerUnits', 'enemyUnits', 'npcUnits'];

export function captureBattleWorldState(scene) {
  const references = new Map();
  for (const group of UNIT_GROUPS) {
    (scene[group] || []).forEach((unit, index) => references.set(unit, { group, index }));
  }
  return {
    mapLayout: scene.grid?.mapLayout?.map((row) => [...row]) || null,
    temporaryTerrains: (scene.grid?.temporaryTerrains || []).map(({ sourceUnit, ...entry }) => ({
      ...entry,
      sourceRef: references.get(sourceUnit) || null,
    })),
    playerDeathsThisBattle: scene._playerDeathsThisBattle || 0,
    appliedHybridOverrideTurns: [...(scene.appliedHybridOverrideTurns || [])],
    latePressureWarningShown: scene._latePressureWarningShown === true,
  };
}

export function restoreBattleWorldState(scene, snapshot) {
  const grid = scene.grid;
  // Older saves have no terrain snapshot. Preserve their existing fallback
  // behavior instead of replacing a map with an empty/unknown layout.
  if (grid && Array.isArray(snapshot.mapLayout)) {
    for (let row = 0; row < snapshot.mapLayout.length; row++) {
      for (let col = 0; col < snapshot.mapLayout[row].length; col++) {
        const value = snapshot.mapLayout[row][col];
        if (grid.mapLayout?.[row]?.[col] === value) continue;
        grid.setTerrainAt?.(col, row, value);
      }
    }
    grid.temporaryTerrains = (snapshot.temporaryTerrains || []).map(({ sourceRef, ...entry }) => ({
      ...entry,
      sourceUnit: UNIT_GROUPS.includes(sourceRef?.group)
        ? scene[sourceRef.group]?.[sourceRef.index] || null
        : null,
    }));
  }
  if (Number.isFinite(snapshot.playerDeathsThisBattle)) {
    scene._playerDeathsThisBattle = snapshot.playerDeathsThisBattle;
  }
  if (Array.isArray(snapshot.appliedHybridOverrideTurns)) {
    scene.appliedHybridOverrideTurns = new Set(snapshot.appliedHybridOverrideTurns);
  }
  if ('latePressureWarningShown' in snapshot) {
    scene._latePressureWarningShown = snapshot.latePressureWarningShown === true;
  }
  scene.dangerZoneStale = true;
  scene.dangerZoneCache = null;
  scene.dangerZone?.hide?.();
}
