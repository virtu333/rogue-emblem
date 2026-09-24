// Battle serialization must not normalize away spent actions, buffs or uses,
// and must never allocate random item IDs merely by reading state.
export const UNIT_PRESENTATION_FIELDS = [
  'graphic',
  'label',
  'hpBar',
  'factionIndicator',
  '_conditionIcons',
  'affixPips',
];

export function serializeBattleUnit(unit) {
  const data = { ...unit };
  delete data._lastAiDecision;
  for (const field of UNIT_PRESENTATION_FIELDS) data[field] = null;
  data.equippedInventoryIndex = (unit.inventory || []).indexOf(unit.weapon);
  data.hasMoved = unit.hasMoved === true;
  data.hasActed = unit.hasActed === true;
  data._movementCommitted = unit._movementCommitted === true;
  data._movementSpent = Number(unit._movementSpent) || 0;
  data._miracleUsed = unit._miracleUsed === true;
  data._phoenixBroochUsed = unit._phoenixBroochUsed === true;
  data._conditions = unit._conditions || [];
  return structuredClone(data);
}

export function restoreEquippedReference(unit) {
  const index = unit.equippedInventoryIndex;
  if (Number.isInteger(index) && index >= 0 && index < (unit.inventory?.length || 0)) {
    unit.weapon = unit.inventory[index];
  }
  delete unit.equippedInventoryIndex;
}
