// ExpectedValue.js — Pure math for growth rate expected values
// No RNG — calculates exact expected stats at any level.

import { XP_STAT_NAMES } from '../../src/utils/constants.js';

/**
 * Parse growth range string "55-70" → midpoint 62.5
 * Returns 0 for missing/invalid ranges.
 */
export function parseGrowthMidpoint(rangeStr) {
  if (!rangeStr) return 0;
  const [min, max] = rangeStr.split('-').map(Number);
  if (isNaN(min) || isNaN(max)) return 0;
  return (min + max) / 2;
}

/**
 * Compute combined growth rates for a lord (class midpoint + personal).
 * Returns { HP: 77.5, STR: 52.5, ... }
 */
export function getLordCombinedGrowths(lordData, classData) {
  const growths = {};
  for (const stat of XP_STAT_NAMES) {
    const classMid = parseGrowthMidpoint(classData?.growthRanges?.[stat]);
    const personal = lordData.personalGrowths?.[stat] || 0;
    growths[stat] = classMid + personal;
  }
  return growths;
}

/**
 * Compute class growth rate midpoints (no personal bonus).
 * Returns { HP: 67.5, STR: 42.5, ... }
 */
export function getClassGrowths(classData) {
  const growths = {};
  for (const stat of XP_STAT_NAMES) {
    growths[stat] = parseGrowthMidpoint(classData?.growthRanges?.[stat]);
  }
  return growths;
}

/**
 * Project stats at a target level using growth rates (deterministic EV).
 * Stats = baseStats + growths% × (levels gained)
 * Note: levelUp guarantees +1 min, but EV calc ignores that (close enough for averages).
 */
export function expectedStatsAtLevel(baseStats, growths, targetLevel) {
  const levelsGained = targetLevel - 1;
  const stats = {};
  for (const stat of XP_STAT_NAMES) {
    const growthPct = (growths[stat] || 0) / 100;
    stats[stat] = baseStats[stat] + growthPct * levelsGained;
  }
  return stats;
}

/**
 * Apply promotion bonuses to stats.
 */
export function applyPromotionBonuses(stats, promotionBonuses) {
  const result = { ...stats };
  for (const stat of XP_STAT_NAMES) {
    result[stat] = (result[stat] || 0) + (promotionBonuses[stat] || 0);
  }
  return result;
}
