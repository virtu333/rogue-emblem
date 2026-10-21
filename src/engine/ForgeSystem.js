// ForgeSystem.js — Pure functions for weapon forging.
// No Phaser deps.

import {
  FORGE_MAX_LEVEL,
  FORGE_BONUSES,
  FORGE_COSTS,
  FORGE_STAT_CAP,
  FORGE_TIER_COST_MULTIPLIER,
} from '../utils/constants.js';
import { isWorn } from './WeaponWear.js';

// Item types that cannot be forged
const EXCLUDED_TYPES = new Set(['Staff', 'Scroll', 'Consumable', 'Accessory', 'Whetstone']);

function applyStatBonus(weapon, stat, bonus) {
  if (stat === 'might') {
    weapon.might += bonus;
  } else if (stat === 'crit') {
    weapon.crit += bonus;
  } else if (stat === 'hit') {
    weapon.hit += bonus;
  } else if (stat === 'weight') {
    weapon.weight = Math.max(0, weapon.weight + bonus); // bonus is negative for weight
  }
}

function removeStatBonus(weapon, stat, bonus) {
  if (stat === 'might') {
    weapon.might -= bonus;
  } else if (stat === 'crit') {
    weapon.crit -= bonus;
  } else if (stat === 'hit') {
    weapon.hit -= bonus;
  } else if (stat === 'weight') {
    weapon.weight = Math.max(0, weapon.weight - bonus); // bonus is negative for weight
  }
}

// An NG+ kept weapon's sleeping forges (engine/KeptForges.js). A forge may land on top of them,
// but they count toward every cap, so waking them can never fail.
const dormantSteps = (weapon) =>
  Array.isArray(weapon?._dormantForges) ? weapon._dormantForges : [];
const dormantOf = (weapon, stat) => dormantSteps(weapon).filter((s) => s?.stat === stat).length;

function getLegacyDeforgeStat(weapon) {
  const order = ['weight', 'hit', 'crit', 'might'];
  const bonuses = weapon?._forgeBonuses;
  for (const stat of order) {
    const bonus = FORGE_BONUSES[stat];
    const current = Number(bonuses?.[stat] || 0);
    if (!Number.isFinite(current) || current === 0) continue;
    const steps = Math.abs(current / bonus);
    if (steps > 0) return stat;
  }
  return null;
}

/** True for an item a forge can ever touch (a weapon, not a staff, scroll or stone). */
export function isForgeableType(weapon) {
  return Boolean(weapon) && !EXCLUDED_TYPES.has(weapon.type);
}

/**
 * Check whether a weapon can be forged (has room for at least one more forge, or a sleeping
 * forge a forge would pull forward, and carries no wear: a worn weapon is repaired first).
 * @param {object} weapon
 * @returns {boolean}
 */
export function canForge(weapon) {
  if (!isForgeableType(weapon)) return false;
  // A worn weapon is repaired before it is forged (docs/specs/worn-weapons.md).
  if (isWorn(weapon)) return false;
  const sleeping = dormantSteps(weapon).length;
  return (weapon._forgeLevel || 0) + sleeping < FORGE_MAX_LEVEL || sleeping > 0;
}

/**
 * Check whether a weapon has any forges applied.
 * @param {object} weapon
 * @returns {boolean}
 */
export function isForged(weapon) {
  return (weapon._forgeLevel || 0) > 0;
}

/**
 * Get how many times a specific stat has been forged on this weapon.
 * Derived from _forgeBonuses using the per-forge bonus amount.
 * @param {object} weapon
 * @param {'might'|'crit'|'hit'|'weight'} stat
 * @returns {number}
 */
export function getStatForgeCount(weapon, stat) {
  if (!weapon || !weapon._forgeBonuses) return 0;
  const bonus = FORGE_BONUSES[stat];
  if (!bonus) return 0;
  return Math.abs(weapon._forgeBonuses[stat] / bonus);
}

/**
 * Check whether a specific stat can still be forged on this weapon.
 * Returns false if total forges at cap OR this stat at per-stat cap.
 * @param {object} weapon
 * @param {'might'|'crit'|'hit'|'weight'} stat
 * @returns {boolean}
 */
export function forgeStatBlock(weapon, stat) {
  if (!Object.hasOwn(FORGE_BONUSES, stat)) return 'Invalid forge choice.';
  if (!isForgeableType(weapon)) return 'This item cannot be forged.';
  if (isWorn(weapon)) return 'Repair this weapon before forging it.';
  const room = forgeRoomBlock(weapon, stat);
  if (!room || pullForwardIndex(weapon, stat) >= 0) return '';
  return room;
}

/** Why a new forge of `stat` has no room (the caps, sleeping forges counted), or ''. */
function forgeRoomBlock(weapon, stat) {
  if ((weapon._forgeLevel || 0) + dormantSteps(weapon).length >= FORGE_MAX_LEVEL)
    return forgeFullText(weapon);
  const sleeping = dormantOf(weapon, stat);
  if (stat === 'weight' && !(weapon.weight + sleeping * FORGE_BONUSES.weight > 0))
    return 'Already at minimum weight.';
  if (getStatForgeCount(weapon, stat) + sleeping >= FORGE_STAT_CAP)
    return `${FORGE_STAT_NAMES[stat]} is at its forge limit (${forgeStatProgressText(weapon, stat)}).`;
  return '';
}

/**
 * Pull forward (NG+ kept weapons, docs/specs/ng-plus.md §15.1): a forge of `stat` with no room
 * left wakes the earliest sleeping forge of that stat instead of being refused. The cap stays
 * 15: the forge was already counted, so it is only taken early and never comes again later.
 * Returns that step's index in `_dormantForges`, or -1 (room for a new forge, or none asleep).
 */
function pullForwardIndex(weapon, stat) {
  if (!isForgeableType(weapon) || isWorn(weapon) || !forgeRoomBlock(weapon, stat)) return -1;
  return dormantSteps(weapon).findIndex((step) => step?.stat === stat);
}

/** True when forging `stat` would wake a sleeping forge rather than add a new one. */
export function forgePullsForward(weapon, stat) {
  return Object.hasOwn(FORGE_BONUSES, stat) && pullForwardIndex(weapon, stat) >= 0;
}

const FORGE_STAT_NAMES = { might: 'Might', crit: 'Crit', hit: 'Hit', weight: 'Weight' };
const asleepText = (n) => (n ? ` · ${n} asleep` : '');

/**
 * A weapon's forges as the caps count them: `awake` (on the weapon now), `asleep` (an NG+ kept
 * weapon's sleeping forges, engine/KeptForges.js), their `total` against `max`, and `full`.
 * Sleeping forges take a slot, so a weapon that reads "+2" can be fully forged.
 */
export function forgeSlots(weapon) {
  const awake = weapon?._forgeLevel || 0;
  const asleep = dormantSteps(weapon).length;
  const total = awake + asleep;
  return { awake, asleep, total, max: FORGE_MAX_LEVEL, full: total >= FORGE_MAX_LEVEL };
}

/** "13/15 · 11 asleep", or "4/15" for a weapon with none asleep. */
export function forgeProgressText(weapon) {
  const { asleep, total, max } = forgeSlots(weapon);
  return `${total}/${max}${asleepText(asleep)}`;
}

/** One stat's forges against its cap, sleeping ones included: "5/5 · 2 asleep". */
export function forgeStatProgressText(weapon, stat) {
  const asleep = dormantOf(weapon, stat);
  return `${getStatForgeCount(weapon, stat) + asleep}/${FORGE_STAT_CAP}${asleepText(asleep)}`;
}

/** Why a weapon at its forge limit takes no more: "Fully forged (15/15 · 13 asleep)." */
export function forgeFullText(weapon) {
  if (!isForgeableType(weapon)) return 'This item cannot be forged.';
  return `Fully forged (${forgeProgressText(weapon)}).`;
}

/**
 * The forge line an item view shows for a forged weapon, or '': "Forges 13/15 · 11 asleep",
 * "Fully forged 15/15" once nothing more fits.
 */
export function forgeStatusLine(weapon) {
  if (!isForgeableType(weapon)) return '';
  const slots = forgeSlots(weapon);
  if (!slots.total) return '';
  return `${slots.full ? 'Fully forged' : 'Forges'} ${forgeProgressText(weapon)}`;
}
export function canForgeStat(weapon, stat) {
  return !forgeStatBlock(weapon, stat);
}

/**
 * Get the gold cost for the next forge of a given stat on this weapon.
 * Cost is indexed by per-stat count (not total level).
 * Returns -1 if the weapon is at max total level or stat is at per-stat cap.
 * @param {object} weapon
 * @param {'might'|'crit'|'hit'|'weight'} stat
 * @returns {number}
 */
export function getForgeCost(weapon, stat) {
  if (!canForgeStat(weapon, stat)) return -1;
  const costs = FORGE_COSTS[stat];
  if (!costs) return -1;
  // A pulled-forward forge costs what forging that stat costs the weapon as it stands awake
  // (a shop's wake prices it the same: ShopForgeWake.wakePrice).
  const statCount = forgePullsForward(weapon, stat)
    ? Math.min(getStatForgeCount(weapon, stat), FORGE_STAT_CAP - 1)
    : getStatForgeCount(weapon, stat) + dormantOf(weapon, stat);
  if (statCount >= FORGE_STAT_CAP) return -1;
  const tier = FORGE_TIER_COST_MULTIPLIER[weapon.tier] ?? 1;
  return Math.round((costs[statCount] * tier) / 10) * 10;
}

/** What a shop charges for one forge: the tier's price less the discount, at least 1 gold. */
export function forgePrice(weapon, stat, discountRatio = 0) {
  const base = getForgeCost(weapon, stat);
  if (base < 0) return -1;
  return discountRatio !== 0 ? Math.max(1, Math.floor(base * (1 - discountRatio))) : base;
}

/**
 * Apply one forge level to a weapon, mutating it in place.
 * @param {object} weapon
 * @param {'might'|'crit'|'hit'|'weight'} stat - which stat to boost
 * @param {number} [discountRatio=0] - fraction discount (0–1), e.g. 0.2 = 20% off
 * @param {{ free?: boolean }} [options] - `free`: a forge that costs nothing (Smith's Mark).
 *   It adds nothing to the weapon's resale price (the price only grows with gold paid) and
 *   records a zero-cost history step, so a later deforge refunds nothing for it. The
 *   `forgePrice` floor of 1 gold stays for every discount; only `free` waives it. `credit`: gold
 *   taken off the price after any discount (a shop's first forge under Smith's Mark), never below
 *   0; only the gold paid is added to the price and recorded in the step.
 * @returns {{ success: boolean, cost?: number }}
 */
export function applyForge(weapon, stat, discountRatio = 0, { free = false, credit = 0 } = {}) {
  if (!canForgeStat(weapon, stat)) return { success: false };
  const listed = forgePrice(weapon, stat, discountRatio);
  if (listed < 0) return { success: false };
  const cost = free ? 0 : Math.max(0, listed - Math.max(0, Math.trunc(Number(credit) || 0)));
  const asleep = pullForwardIndex(weapon, stat);
  if (asleep >= 0) {
    // Pull forward: the sleeping forge wakes. Its price was always counted in the weapon's,
    // so the gold paid is not added again.
    if (!wakeDormantForgeAt(weapon, asleep)) return { success: false };
    return { success: true, cost, pulledForward: true };
  }

  const level = weapon._forgeLevel || 0;

  // Initialize forge metadata on first forge
  if (!weapon._baseName) weapon._baseName = weapon.name;
  if (!weapon._forgeBonuses) weapon._forgeBonuses = { might: 0, crit: 0, hit: 0, weight: 0 };
  if (!Array.isArray(weapon._forgeHistory)) weapon._forgeHistory = [];

  // Apply stat bonus
  const bonus = FORGE_BONUSES[stat];
  weapon._forgeBonuses[stat] += bonus;
  applyStatBonus(weapon, stat, bonus);

  // Update forge level, name, price
  weapon._forgeLevel = level + 1;
  weapon.name = `${weapon._baseName} +${weapon._forgeLevel}`;
  weapon.price = (weapon.price || 0) + cost;
  weapon._forgeHistory.push({ stat, cost });

  return { success: true, cost };
}

/** How many forges the weapon rode in with (asleep or awake); legacy: all it has, none run-made. */
export function keptForgeBase(weapon) {
  const base = weapon?._keptForgeBase;
  if (Number.isInteger(base) && base >= 0) return base;
  return (weapon?._forgeLevel || 0) + dormantSteps(weapon).length;
}

/** How many of the weapon's awake forges this run made (never below 0). */
export function runForgeCount(weapon) {
  if (!weapon || typeof weapon !== 'object' || Array.isArray(weapon)) return 0;
  const keptAwake = keptForgeBase(weapon) - dormantSteps(weapon).length;
  return Math.max(0, (weapon._forgeLevel || 0) - keptAwake);
}

/** Take the run's forges off the top (latest first), returning them in the order they were made. */
export function liftRunForges(weapon) {
  const lifted = [];
  for (let n = runForgeCount(weapon); n > 0; n--) {
    const result = deforgeWeapon(weapon);
    if (!result.success) break;
    lifted.unshift({ stat: result.stat, cost: result.refundedCost || 0 });
  }
  return lifted;
}

/**
 * Wake the sleeping forge at `index` (engine/KeptForges.js): it slips in under the run's own
 * forges, so the history stays kept forges first, then the run's. The price is left as it was.
 * Returns false when there is no such step.
 */
export function wakeDormantForgeAt(weapon, index) {
  const steps = dormantSteps(weapon);
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) return false;
  const price = weapon.price;
  const runSteps = liftRunForges(weapon);
  const [step] = weapon._dormantForges.splice(index, 1);
  const woke = reapplyForgeStep(weapon, step);
  for (const s of runSteps) reapplyForgeStep(weapon, s);
  if (price !== undefined) weapon.price = price;
  if (!weapon._dormantForges.length) delete weapon._dormantForges;
  return woke;
}

/**
 * Put back one forge step taken off by deforgeWeapon (an NG+ kept weapon's dormant forge
 * waking, engine/KeptForges.js): the stat, level, name and history as applyForge leaves them,
 * with no gold charged and the price untouched. Returns false for a step that is not a forge.
 */
export function reapplyForgeStep(weapon, step) {
  const stat = step?.stat;
  if (!weapon || !Object.hasOwn(FORGE_BONUSES, stat)) return false;
  if (!weapon._baseName) weapon._baseName = weapon.name;
  if (!weapon._forgeBonuses) weapon._forgeBonuses = { might: 0, crit: 0, hit: 0, weight: 0 };
  if (!Array.isArray(weapon._forgeHistory)) weapon._forgeHistory = [];
  const bonus = FORGE_BONUSES[stat];
  weapon._forgeBonuses[stat] += bonus;
  applyStatBonus(weapon, stat, bonus);
  weapon._forgeLevel = (weapon._forgeLevel || 0) + 1;
  weapon.name = `${weapon._baseName} +${weapon._forgeLevel}`;
  weapon._forgeHistory.push({ stat, cost: Math.max(0, Math.trunc(Number(step.cost) || 0)) });
  return true;
}

/**
 * Remove one forge level from a weapon, mutating it in place.
 * Reverses exact last forge when history exists, otherwise uses safe legacy fallback.
 * @param {object} weapon
 * @returns {{ success: boolean, refundedCost?: number, stat?: string }}
 */
export function deforgeWeapon(weapon) {
  if (!weapon || !isForged(weapon)) return { success: false };
  if (!weapon._forgeBonuses) {
    weapon._forgeBonuses = { might: 0, crit: 0, hit: 0, weight: 0 };
  }

  let step = null;
  if (Array.isArray(weapon._forgeHistory) && weapon._forgeHistory.length > 0) {
    step = weapon._forgeHistory.pop();
  } else {
    const legacyStat = getLegacyDeforgeStat(weapon);
    if (!legacyStat) return { success: false };
    const refundCost =
      FORGE_COSTS[legacyStat]?.[Math.max(0, getStatForgeCount(weapon, legacyStat) - 1)] || 0;
    step = { stat: legacyStat, cost: refundCost };
    if (!Array.isArray(weapon._forgeHistory)) weapon._forgeHistory = [];
  }

  const stat = step?.stat;
  if (!stat || !FORGE_BONUSES[stat]) return { success: false };
  const bonus = FORGE_BONUSES[stat];
  weapon._forgeBonuses[stat] -= bonus;
  removeStatBonus(weapon, stat, bonus);

  const nextLevel = Math.max(0, (weapon._forgeLevel || 0) - 1);
  weapon._forgeLevel = nextLevel;
  weapon.price = Math.max(0, (weapon.price || 0) - Math.max(0, Math.trunc(Number(step.cost) || 0)));

  if (nextLevel <= 0) {
    weapon.name = weapon._baseName || weapon.name;
    delete weapon._forgeLevel;
    delete weapon._baseName;
    delete weapon._forgeBonuses;
    delete weapon._forgeHistory;
  } else {
    const baseName = weapon._baseName || weapon.name;
    weapon.name = `${baseName} +${nextLevel}`;
  }

  return { success: true, refundedCost: Math.max(0, Math.trunc(Number(step.cost) || 0)), stat };
}

/**
 * Get display info for a forged weapon.
 * @param {object} weapon
 * @returns {{ baseName: string, level: number, bonuses: object, statCounts: object }}
 */
export function getForgeDisplayInfo(weapon) {
  return {
    baseName: weapon._baseName || weapon.name,
    level: weapon._forgeLevel || 0,
    bonuses: weapon._forgeBonuses || { might: 0, crit: 0, hit: 0, weight: 0 },
    statCounts: {
      might: getStatForgeCount(weapon, 'might'),
      crit: getStatForgeCount(weapon, 'crit'),
      hit: getStatForgeCount(weapon, 'hit'),
      weight: getStatForgeCount(weapon, 'weight'),
    },
  };
}
