// KeptForges.js - NG+ kept weapons wake their forges act by act (docs/specs/ng-plus.md §13).
//
// A weapon a Barracks record keeps comes back with every forge it earned, but the forges above
// the act's limit lie dormant: they are taken off the weapon (its stats, level and name read
// as the awake forges only, so every reader of a weapon, combat and forecast alike, needs no
// change) and kept on it in order as `_dormantForges: [{ stat, cost }]`. Each act start wakes
// them up to the new act's limit (RunManager.advanceAct); the final act wakes them all. Nothing
// is lost: the price is never lowered, and the run's end reads the weapon fully awake.
//
// The run's own forges (a shop, a whetstone, an event) land on a kept weapon at once, sleeping
// forges or not: `_keptForgeBase` is how many forges the weapon rode in with, so the awake limit
// counts kept forges only, and waking slips them in under the run's forges (the history stays
// kept forges first, then the run's). ForgeSystem counts sleeping forges toward its caps, so a
// wake never fails. A ride carries the kept forges plus at most `ngPlus.keptForgeCarry` of the
// run's (the earliest; the rest are taken off with their price): `carriedCopy`.
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

/** How many forges the weapon rode in with (asleep or awake); legacy: all it has, none run-made. */
export function keptForgeBase(weapon) {
  const base = weapon?._keptForgeBase;
  if (Number.isInteger(base) && base >= 0) return base;
  return (weapon?._forgeLevel || 0) + dormantForgeCount(weapon);
}

/** How many of the weapon's awake forges this run made (never below 0). */
export function runForgeCount(weapon) {
  if (!isWeaponLike(weapon)) return 0;
  const keptAwake = keptForgeBase(weapon) - dormantForgeCount(weapon);
  return Math.max(0, (weapon._forgeLevel || 0) - keptAwake);
}

/** Take the run's forges off the top (latest first), returning them in the order they were made. */
function liftRunForges(weapon) {
  const lifted = [];
  for (let n = runForgeCount(weapon); n > 0; n--) {
    const result = deforgeWeapon(weapon);
    if (!result.success) break;
    lifted.unshift({ stat: result.stat, cost: result.refundedCost || 0 });
  }
  return lifted;
}

/**
 * Wake dormant forges, earliest first, until the weapon's awake kept forges reach `limit` (the
 * run's own forges never count). Returns how many woke.
 */
export function wakeForges(weapon, limit = Infinity) {
  if (!isWeaponLike(weapon) || !hasDormantForges(weapon)) return 0;
  const base = keptForgeBase(weapon);
  const price = weapon.price;
  const runSteps = liftRunForges(weapon);
  let woke = 0;
  while (hasDormantForges(weapon) && base - dormantForgeCount(weapon) < limit) {
    const step = weapon._dormantForges.shift();
    if (reapplyForgeStep(weapon, step)) woke++;
  }
  for (const step of runSteps) reapplyForgeStep(weapon, step);
  if (price !== undefined) weapon.price = price;
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
  weapon._keptForgeBase = weapon._forgeLevel || 0;
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

/** How many of a run's forges a ride carries (difficulty.json `ngPlus.keptForgeCarry`). */
export const DEFAULT_KEPT_FORGE_CARRY = 4;

/**
 * What the Barracks stores of a weapon: every forge awake, the forges it rode in with, and at
 * most `carry` of the run's own (the earliest made; each one dropped takes its price with it).
 * A weapon kept for the first time rode in with none; `kept` marks a Barracks item placed before
 * the run stamped what it rode in with (a save from before the cap), which keeps every forge.
 */
export function carriedCopy(item, carry = DEFAULT_KEPT_FORGE_CARRY, { kept = false } = {}) {
  const copy = structuredClone(item);
  if (!isWeaponLike(copy)) return copy;
  const stamped = Number.isInteger(copy._keptForgeBase);
  const base = stamped || kept ? keptForgeBase(copy) : 0;
  wakeForges(copy, Infinity);
  delete copy._keptForgeBase;
  const keep = base + Math.max(0, Math.floor(Number(carry) || 0));
  const history = Array.isArray(copy._forgeHistory) ? copy._forgeHistory.length : 0;
  // A legacy weapon with no exact history keeps what it has: a step can't be told apart.
  while ((copy._forgeLevel || 0) > keep && history >= (copy._forgeLevel || 0)) {
    if (!deforgeWeapon(copy).success) break;
  }
  return copy;
}

/**
 * Every weapon the army holds that may carry dormant forges: bags, the convoy, and a fallen
 * unit's bag (what a full convoy left with it until a revival).
 */
function armyWeapons(run) {
  const out = [];
  for (const unit of [...(run?.roster || []), ...(run?.fallenUnits || [])])
    for (const item of unit?.inventory || []) out.push(item);
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
