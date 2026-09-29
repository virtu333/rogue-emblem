// Special characters have their own voice namespace, separate from lord recruitment pools.
export function specialCharacterEntries(gameData, unit, event) {
  const pool = gameData?.dialogue?.specialChars?.[unit?.specialCharId]?.[event];
  if (!Array.isArray(pool)) return [];
  return pool
    .filter((line) => typeof line === 'string' && line.trim())
    .map((line) => ({
      speaker: unit.name,
      portrait: `portrait_special_${unit.specialCharId}`,
      line,
    }));
}
