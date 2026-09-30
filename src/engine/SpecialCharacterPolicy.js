import defaults from '../../data/specialChars.json' with { type: 'json' };

export function specialCharacterDefinition(unit, definitions = defaults) {
  return definitions?.find((entry) => entry.id === unit?.specialCharId) || null;
}

export function canReclassSpecial(unit) {
  return specialCharacterDefinition(unit)?.canReclass !== false;
}

export function canPromoteSpecial(unit) {
  return specialCharacterDefinition(unit)?.canPromote !== false;
}

export function contributesToTeamLevel(unit) {
  return specialCharacterDefinition(unit)?.countsTowardRosterLevel !== false;
}

export function skipsClassProgression(unit) {
  return specialCharacterDefinition(unit)?.classProgression === false;
}

export function metaGrowthScale(unit, definitions = defaults) {
  return specialCharacterDefinition(unit, definitions)?.metaGrowthScale ?? 1;
}

// Traits describe policy; the skill migration runs once so earned Canto stays earned.
export function normalizeSpecialCharacter(unit, definitions = defaults) {
  const def = specialCharacterDefinition(unit, definitions);
  if (!def) return unit;
  unit.traits = [...new Set([...(unit.traits || []), ...(def.traits || [])])];
  if ((unit.specialRulesVersion || 0) < (def.rulesVersion || 1)) {
    unit.skills = [...new Set((unit.skills || []).map((id) => def.legacySkills?.[id] || id))];
    unit.specialRulesVersion = def.rulesVersion || 1;
  }
  return unit;
}
