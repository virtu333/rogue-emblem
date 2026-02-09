// ForgeSystem.js — Pure functions for weapon forging.
// No Phaser deps.

import { FORGE_MAX_LEVEL, FORGE_BONUSES, FORGE_COSTS } from '../utils/constants.js';

// Item types that cannot be forged
const EXCLUDED_TYPES = new Set(['Staff', 'Scroll', 'Consumable', 'Accessory', 'Whetstone']);

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
 * Get the gold cost for the next forge of a given stat on this weapon.
 * Returns -1 if the weapon is at max forge level.
 * @param {object} weapon
 * @param {'might'|'crit'|'hit'|'weight'} stat
 * @returns {number}
 */
export function getForgeCost(weapon, stat) {
  const level = weapon._forgeLevel || 0;
  if (level >= FORGE_MAX_LEVEL) return -1;
  const costs = FORGE_COSTS[stat];
  if (!costs) return -1;
  return costs[level];
}

/**
 * Apply one forge level to a weapon, mutating it in place.
 * @param {object} weapon
 * @param {'might'|'crit'|'hit'|'weight'} stat - which stat to boost
 * @returns {{ success: boolean, cost?: number }}
 */
export function applyForge(weapon, stat) {
  if (!canForge(weapon)) return { success: false };
  const cost = getForgeCost(weapon, stat);
  if (cost < 0) return { success: false };

  const level = weapon._forgeLevel || 0;

  // Initialize forge metadata on first forge
  if (!weapon._baseName) weapon._baseName = weapon.name;
  if (!weapon._forgeBonuses) weapon._forgeBonuses = { might: 0, crit: 0, hit: 0, weight: 0 };

  // Apply stat bonus
  const bonus = FORGE_BONUSES[stat];
  weapon._forgeBonuses[stat] += bonus;

  if (stat === 'might') {
    weapon.might += bonus;
  } else if (stat === 'crit') {
    weapon.crit += bonus;
  } else if (stat === 'hit') {
    weapon.hit += bonus;
  } else if (stat === 'weight') {
    weapon.weight = Math.max(0, weapon.weight + bonus); // bonus is negative for weight
  }

  // Update forge level, name, price
  weapon._forgeLevel = level + 1;
  weapon.name = `${weapon._baseName} +${weapon._forgeLevel}`;
  weapon.price = (weapon.price || 0) + cost;

  return { success: true, cost };
}

/**
 * Get display info for a forged weapon.
 * @param {object} weapon
 * @returns {{ baseName: string, level: number, bonuses: object }}
 */
export function getForgeDisplayInfo(weapon) {
  return {
    baseName: weapon._baseName || weapon.name,
    level: weapon._forgeLevel || 0,
    bonuses: weapon._forgeBonuses || { might: 0, crit: 0, hit: 0, weight: 0 },
  };
}
