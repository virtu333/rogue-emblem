export const BATTLE_UNIT_GROUPS = [
  'playerUnits',
  'enemyUnits',
  'npcUnits',
  'escapedUnits',
  'nonDeployedUnits',
];

// Registration is a spawn/restore operation, never a preview/capture side effect.
export function registerBattleEntity(scene, unit) {
  if (!unit) return null;
  const owners = (scene._battleEntityOwners ||= new Map());
  let next = Math.max(1, Number(scene._nextBattleEntityId) || 1);
  const valid = typeof unit.battleEntityId === 'string' && /^u[1-9]\d*$/.test(unit.battleEntityId);
  if (!valid || (owners.has(unit.battleEntityId) && owners.get(unit.battleEntityId) !== unit)) {
    while (owners.has(`u${next}`)) next++;
    unit.battleEntityId = `u${next++}`;
  } else {
    next = Math.max(next, Number(unit.battleEntityId.slice(1)) + 1);
  }
  owners.set(unit.battleEntityId, unit);
  scene._nextBattleEntityId = next;
  return unit.battleEntityId;
}

export function resetBattleIdentities(scene, next = 1, units = []) {
  scene._battleEntityOwners = new Map();
  scene._nextBattleEntityId = Math.max(1, Number.isSafeInteger(next) ? next : 1);
  // Reserve the whole restored roster before assigning any missing legacy IDs.
  for (const unit of units) {
    const id = Number(unit?.battleEntityId?.slice(1));
    if (/^u[1-9]\d*$/.test(unit?.battleEntityId) && Number.isSafeInteger(id))
      scene._nextBattleEntityId = Math.max(scene._nextBattleEntityId, id + 1);
  }
}

export function findBattleEntity(scene, reference, groups = BATTLE_UNIT_GROUPS) {
  const units = groups.flatMap((key) => scene[key] || []);
  if (reference?.unitId) return units.find((u) => u.battleEntityId === reference.unitId) || null;
  // Legacy continuations have names only. An ambiguous match is not safe.
  const matches = units.filter((u) => u.name === reference?.unitName);
  return matches.length === 1 ? matches[0] : null;
}
