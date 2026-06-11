/**
 * Commander = the unit whose death ends the run (the permadeath anchor).
 *
 * Today the commander is always Edric; the flag exists so future features
 * (commander choice, campaigns) can move the anchor without touching the
 * rules that depend on it. Two lookups with deliberately different fallbacks:
 *
 * - findCommander: flag -> Edric by name, and nothing further. Scaling
 *   anchors (RecruitScaling, Colosseum) must keep their existing defaults
 *   for rosters that contain neither, so this never promotes another lord.
 * - stampCommanderFlag: flag -> Edric -> first lord. Healing for unit pools
 *   that predate the flag or never pass through createInitialRoster
 *   (legacy saves, suspend checkpoints, tutorial/standalone/harness
 *   rosters). Flag-strict checks (defeat/escape/deploy lock) are only safe
 *   after a pool has been stamped.
 */

export const DEFAULT_STARTING_LORD_NAMES = ['Edric', 'Sera'];

/** Default partner slot for a given commander: Sera, unless Sera leads. */
export function defaultPartnerFor(commanderName) {
  return commanderName === 'Sera' ? 'Edric' : 'Sera';
}

/**
 * Starting pair as a name array, from metaEffects.startingLords when the
 * commander-choice upgrade emitted one, else the default pair. No-meta runs
 * (metaEffects null) and legacy saves fall through to Edric + Sera.
 */
export function resolveStartingLordNames(metaEffects) {
  const selection = metaEffects?.startingLords;
  if (
    selection &&
    typeof selection.commander === 'string' &&
    typeof selection.partner === 'string' &&
    selection.commander !== selection.partner
  ) {
    return [selection.commander, selection.partner];
  }
  return [...DEFAULT_STARTING_LORD_NAMES];
}

function isEdricByName(unit) {
  return typeof unit?.name === 'string' && unit.name.trim().toLowerCase() === 'edric';
}

/** Locate the commander in a unit pool: isCommander flag, else Edric by name. */
export function findCommander(units) {
  const pool = Array.isArray(units) ? units : [];
  return pool.find((u) => u?.isCommander === true) || pool.find(isEdricByName) || null;
}

/**
 * Ensure exactly one unit in the pool carries the commander flag.
 * Mutates units in place; returns the commander (null if the pool has no
 * flagged unit, no Edric, and no lord).
 */
export function stampCommanderFlag(units) {
  const pool = Array.isArray(units) ? units : [];
  const commander = findCommander(pool) || pool.find((u) => u?.isLord) || null;
  if (!commander) return null;
  commander.isCommander = true;
  for (const unit of pool) {
    if (unit && unit !== commander && unit.isCommander) unit.isCommander = false;
  }
  return commander;
}
