// KeptForges.js - NG+ kept weapons wake their forges act by act (docs/specs/ng-plus.md §13).
//
// A weapon a Barracks record keeps comes back with every forge it earned, but the forges above
// the act's limit lie dormant: they are taken off the weapon (its stats, level and name read
// as the awake forges only, so every reader of a weapon, combat and forecast alike, needs no
// change) and kept on it in order as `_dormantForges: [{ stat, cost }]`. Each act start wakes
// them up to the new act's limit (RunManager.advanceAct); the final act wakes them all. Nothing
// is lost: the price is never lowered, and the run's end reads the weapon fully awake.
//
// Pure: mutates only the weapons it is handed. No Math.random.
import { deforgeWeapon, reapplyForgeStep } from './ForgeSystem.js';

/** The awake forge level per act for a kept weapon (difficulty.json `ngPlus.keptForgeAwake`). */
export const DEFAULT_KEPT_FORGE_AWAKE = Object.freeze({ act1: 2, act2: 4, act3: 6, act4: 8 });

const isWeaponLike = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);

/** How many forges lie dormant on a weapon. */
export function dormantForgeCount(weapon) {
  return Array.isArray(weapon?._dormantForges) ? weapon._dormantForges.length : 0;
}

/** True when a weapon has forges still asleep. */
export function hasDormantForges(weapon) {
  return dormantForgeCount(weapon) > 0;
}

/**
 * The awake forge limit in an act: the table's entry, or no limit (Infinity) for an act it
 * does not name (the final act, and any act past Act IV).
 */
export function keptForgeAwakeLimit(act, table = DEFAULT_KEPT_FORGE_AWAKE) {
  const limit = table?.[act];
  return Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : Infinity;
}

/** Wake dormant forges, earliest first, until the weapon reaches `limit`. Returns how many woke. */
export function wakeForges(weapon, limit = Infinity) {
  if (!isWeaponLike(weapon) || !hasDormantForges(weapon)) return 0;
  let woke = 0;
  while (hasDormantForges(weapon) && (weapon._forgeLevel || 0) < limit) {
    const step = weapon._dormantForges.shift();
    if (reapplyForgeStep(weapon, step)) woke++;
  }
  if (!weapon._dormantForges.length) delete weapon._dormantForges;
  return woke;
}

/**
 * Put a kept weapon's forges above `limit` to sleep (latest first, so they wake in the order
 * they were made). A weapon already holding dormant forges is woken whole first, so the limit
 * is always measured on the weapon's full history. The price is left as it was.
 * Returns how many forges lie dormant afterwards.
 */
export function lullForges(weapon, limit) {
  if (!isWeaponLike(weapon)) return 0;
  wakeForges(weapon, Infinity);
  if (!Number.isFinite(limit)) return 0;
  const sleeping = [];
  const price = weapon.price;
  while ((weapon._forgeLevel || 0) > limit) {
    const result = deforgeWeapon(weapon);
    if (!result.success) break;
    sleeping.unshift({ stat: result.stat, cost: result.refundedCost || 0 });
  }
  if (price !== undefined) weapon.price = price;
  if (sleeping.length) weapon._dormantForges = sleeping;
  return sleeping.length;
}

/** Every weapon the army holds that may carry dormant forges: bags and the convoy. */
function armyWeapons(run) {
  const out = [];
  for (const unit of run?.roster || []) for (const item of unit?.inventory || []) out.push(item);
  for (const item of run?.convoy?.weapons || []) out.push(item);
  return out.filter(isWeaponLike);
}

/** An act begins: every kept weapon in the army wakes up to the act's limit. Returns how many woke. */
export function wakeArmyForges(run, act, table = DEFAULT_KEPT_FORGE_AWAKE) {
  const limit = keptForgeAwakeLimit(act, table);
  let woke = 0;
  for (const weapon of armyWeapons(run)) woke += wakeForges(weapon, limit);
  return woke;
}

/** The detail line a weapon with dormant forges shows, or null. */
export function dormantForgeLine(weapon) {
  const n = dormantForgeCount(weapon);
  if (!n) return null;
  return `${n} kept forge${n === 1 ? '' : 's'} still waking (more each act, all in the last)`;
}
