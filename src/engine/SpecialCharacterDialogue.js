import { canPromoteSpecial, canReclassSpecial } from './SpecialCharacterPolicy.js';

// Refusals are presentation only; every mutation still validates the policy.
export function specialCharacterRefusal(gameData, unit, effect, run = null) {
  const blocked =
    effect === 'promote'
      ? !canPromoteSpecial(unit)
      : effect === 'reclass' && !canReclassSpecial(unit);
  if (!blocked) return null;
  const pool = gameData?.dialogue?.specialChars?.[unit?.specialCharId]?.[`${effect}Refusal`];
  if (!pool?.length) return null;
  const line = run?.pickNarrativeLine?.(pool, `refusal:${effect}:${unit.specialCharId}`) || pool[0];
  return `${unit.name}: ${line}`;
}

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
