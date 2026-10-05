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

/**
 * A veteran who joined already grown (promoted, fixed class, no class progression):
 * strong now, earns little XP and barely levels (Gaspar). Policy flags in
 * data/specialChars.json decide, never a name. Used by the Guidance field note that
 * tells new players to let others take the kills.
 */
export function isLowGrowthVeteran(unit, definitions = defaults) {
  const def = specialCharacterDefinition(unit, definitions);
  return Boolean(def) && def.classProgression === false && def.canPromote === false;
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
