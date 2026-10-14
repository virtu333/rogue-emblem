// EntityKitConfig — the shape of the Entity's anti-kiting kit (engine/EntityKit.js has the rules).
// A leaf module: no imports, so DifficultyEngine, MapGenerator and the run format can read it
// without pulling in the battle rules.
//
// difficulty.json `entityKit`, on every rung (a rung without it writes `{ limbs: null,
// undertow: false }`):
//   limbs     null, or { maxAlive, maxSprouted, woundPercent }: the Grasping Limbs. Where the
//             army struck the Entity from in a player phase, a limb rises at the next enemy
//             phase's start (at most `maxAlive` standing, `maxSprouted` in a battle). The Entity
//             strikes anyone beside a living limb; a limb the army cuts down takes
//             `woundPercent` of the Entity's max HP with it.
//   undertow  true: an Entity counter that lands drags its attacker one tile toward the body
//             and roots it (no Canto, Swap, Shove or Pull) until its next phase.
//
// RunManager.getBattleParams carries the rung's kit on a battle's params (only when it holds
// something); MapGenerator writes it into the locked config only when the map seats the Entity,
// so the kit a battle plays is the one its map was generated with.

/** The most limbs a kit may keep standing, and sprout in a battle. */
export const LIMB_ALIVE_CAP = 8;
export const LIMB_SPROUTED_CAP = 32;

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const wholeIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * A kit made whole, or null when it holds nothing (no limbs, no undertow). Anything malformed
 * reads as off, never as a partial rule.
 * @returns {{ limbs: { maxAlive: number, maxSprouted: number, woundPercent: number } | null,
 *   undertow: boolean } | null}
 */
export function sanitizeEntityKit(raw) {
  if (!isRecord(raw)) return null;
  const l = raw.limbs;
  const limbs =
    isRecord(l) &&
    wholeIn(l.maxAlive, 1, LIMB_ALIVE_CAP) &&
    wholeIn(l.maxSprouted, l.maxAlive, LIMB_SPROUTED_CAP) &&
    wholeIn(l.woundPercent, 0, 100)
      ? { maxAlive: l.maxAlive, maxSprouted: l.maxSprouted, woundPercent: l.woundPercent }
      : null;
  const undertow = raw.undertow === true;
  return limbs || undertow ? { limbs, undertow } : null;
}

/** The kit a locked battle config plays (null: the Entity fights as it always has). */
export function entityKitOf(config) {
  return sanitizeEntityKit(config?.entityKit);
}

/** difficulty.json: every rung names `entityKit`, whole (`npm run validate:data`). */
export function validateEntityKitConfig(raw, path) {
  if (!isRecord(raw)) return [`${path}.entityKit must be an object ({ limbs, undertow })`];
  const errors = [];
  for (const key of Object.keys(raw))
    if (key !== 'limbs' && key !== 'undertow') errors.push(`${path}.entityKit.${key} is unknown`);
  if (typeof raw.undertow !== 'boolean') errors.push(`${path}.entityKit.undertow must be boolean`);
  const l = raw.limbs;
  if (l === null) return errors;
  if (!isRecord(l)) return [...errors, `${path}.entityKit.limbs must be null or an object`];
  for (const key of Object.keys(l))
    if (!['maxAlive', 'maxSprouted', 'woundPercent'].includes(key))
      errors.push(`${path}.entityKit.limbs.${key} is unknown`);
  if (!wholeIn(l.maxAlive, 1, LIMB_ALIVE_CAP))
    errors.push(`${path}.entityKit.limbs.maxAlive must be a whole number 1-${LIMB_ALIVE_CAP}`);
  if (!wholeIn(l.maxSprouted, Math.max(1, l.maxAlive || 1), LIMB_SPROUTED_CAP))
    errors.push(
      `${path}.entityKit.limbs.maxSprouted must be a whole number from maxAlive to ${LIMB_SPROUTED_CAP}`,
    );
  if (!wholeIn(l.woundPercent, 0, 100))
    errors.push(`${path}.entityKit.limbs.woundPercent must be a whole number 0-100`);
  return errors;
}

/** The difficulty screen's lines for a rung's kit (none when it holds nothing). */
export function entityKitSummaryLines(raw) {
  const kit = sanitizeEntityKit(raw);
  if (!kit) return [];
  const lines = [];
  if (kit.limbs)
    lines.push(
      `The Entity grows limbs where it is struck from (up to ${kit.limbs.maxAlive} at once)`,
    );
  if (kit.undertow) lines.push("The Entity's counter drags you in and holds you");
  return lines;
}
