// ForgeSystem.js — Pure functions for weapon forging.
// No Phaser deps.

import { FORGE_MAX_LEVEL, FORGE_BONUSES, FORGE_COSTS, FORGE_STAT_CAP } from '../utils/constants.js';

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

/**
 * Check whether a weapon can be forged (has room for at least one more forge).
 * @param {object} weapon
 * @returns {boolean}
 */
export function canForge(weapon) {
  if (!weapon || EXCLUDED_TYPES.has(weapon.type)) return false;
  return (weapon._forgeLevel || 0) < FORGE_MAX_LEVEL;
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
export function canForgeStat(weapon, stat) {
  if (!canForge(weapon)) return false;
  return getStatForgeCount(weapon, stat) < FORGE_STAT_CAP;
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
  const level = weapon._forgeLevel || 0;
  if (level >= FORGE_MAX_LEVEL) return -1;
  const costs = FORGE_COSTS[stat];
  if (!costs) return -1;
  const statCount = getStatForgeCount(weapon, stat);
  if (statCount >= FORGE_STAT_CAP) return -1;
  return costs[statCount];
}

/**
 * Apply one forge level to a weapon, mutating it in place.
 * @param {object} weapon
 * @param {'might'|'crit'|'hit'|'weight'} stat - which stat to boost
 * @param {number} [discountRatio=0] - fraction discount (0–1), e.g. 0.2 = 20% off
 * @returns {{ success: boolean, cost?: number }}
 */
export function applyForge(weapon, stat, discountRatio = 0) {
  if (!canForgeStat(weapon, stat)) return { success: false };
  const baseCost = getForgeCost(weapon, stat);
  if (baseCost < 0) return { success: false };
  const cost = discountRatio !== 0 ? Math.max(1, Math.floor(baseCost * (1 - discountRatio))) : baseCost;

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
    const refundCost = FORGE_COSTS[legacyStat]?.[Math.max(0, getStatForgeCount(weapon, legacyStat) - 1)] || 0;
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
