import { canPromoteSpecial, canReclassSpecial } from './SpecialCharacterPolicy.js';

// Eligibility and rendering read stable text without advancing narrative history.
function refusalPool(gameData, unit, effect) {
  const blocked =
    effect === 'promote'
      ? !canPromoteSpecial(unit)
      : effect === 'reclass' && !canReclassSpecial(unit);
  if (!blocked) return null;
  const pool = gameData?.dialogue?.specialChars?.[unit?.specialCharId]?.[`${effect}Refusal`];
  return Array.isArray(pool) && pool.length ? pool : null;
}

export function specialCharacterRefusalText(gameData, unit, effect) {
  const pool = refusalPool(gameData, unit, effect);
  return pool ? `${unit.name}: ${pool[0]}` : null;
}

// Only an explicit player attempt chooses a fresh line.
export function speakSpecialCharacterRefusal(gameData, unit, effect, run) {
  const pool = refusalPool(gameData, unit, effect);
  if (!pool) return null;
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
