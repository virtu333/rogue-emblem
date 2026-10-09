import { normalizeSpecialCharacter } from './SpecialCharacterPolicy.js';
import { migrateUnitTraits } from './TraitSystem.js';
import { normalizeBattleRecruits, reconcileRecruitIdentities } from './BattleRecruits.js';
import { normalizeFallenBattleRecords } from './DeedSystem.js';
import { restoreBattleBlessings, snapshotBattleBlessings } from './BattleBlessings.js';
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
    // Mid-battle recruits as they joined: the fallen record for a recruit who
    // dies before the battle ends (see BattleRecruits.js).
    battleRecruits: normalizeBattleRecruits(scene._battleRecruits),
    // What each unit that fell this battle did before it fell (deeds, item use),
    // committed to its fallen record at victory (DeedController).
    fallenBattleRecords: normalizeFallenBattleRecords(scene._fallenBattleRecords),
    // The earned blessings this battle has spent (the Unbroken Banner's hold, the Ember
    // Lantern): only when the run holds one, so a battle without them saves what it did.
    ...(scene._battleBlessings
      ? { battleBlessingsSpent: snapshotBattleBlessings(scene._battleBlessings) }
      : {}),
  };
}

export function restoreBattleWorldState(scene, snapshot) {
  for (const group of [...UNIT_GROUPS, 'escapedUnits', 'nonDeployedUnits']) {
    for (const unit of scene[group] || [])
      migrateUnitTraits(normalizeSpecialCharacter(unit, scene.gameData?.specialChars));
  }
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
  // Older snapshots predate these lists: no mid-battle recruit or fallen record.
  scene._fallenBattleRecords = normalizeFallenBattleRecords(snapshot.fallenBattleRecords);
  scene._battleRecruits = normalizeBattleRecruits(snapshot.battleRecruits);
  reconcileRecruitIdentities(
    scene._battleRecruits,
    [...UNIT_GROUPS, 'escapedUnits', 'nonDeployedUnits'].flatMap((group) => scene[group] || []),
    scene.runManager?.assignUnitUid ? (unit) => scene.runManager.assignUnitUid(unit) : null,
  );
  // The battle's earned blessings keep their numbers (read from the run at its start); what
  // they had spent comes back with the snapshot: a rewind to before a hold readies the banner
  // again. A snapshot from before the field spent nothing.
  if (scene._battleBlessings)
    restoreBattleBlessings(scene._battleBlessings, snapshot.battleBlessingsSpent);
  if ('latePressureWarningShown' in snapshot) {
    scene._latePressureWarningShown = snapshot.latePressureWarningShown === true;
  }
  scene.dangerZoneStale = true;
  scene._pinnedThreats?.invalidate();
  scene.dangerZoneCache = null;
  scene.keepDangerVisible = false;
  scene.dangerZone?.hide?.();
}
