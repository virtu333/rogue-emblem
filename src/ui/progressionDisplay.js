import { XP_STAT_NAMES } from '../utils/constants.js';

// XP is already applied. Reconstruct intermediate displays without changing units.
export function levelUpDisplayResults(finalStats, levelUps) {
  const stats = { ...finalStats };
  const results = [];
  for (let i = levelUps.length - 1; i >= 0; i--) {
    const result = levelUps[i];
    results.unshift({ ...result, displayStats: { ...stats } });
    for (const [stat, gain] of Object.entries(result.gains || {})) {
      if (Number.isFinite(stats[stat])) stats[stat] -= gain;
    }
  }
  return results;
}

export function progressionRows(unit, result, promotion = false) {
  const stats = result.displayStats || unit.stats;
  const names = promotion && result.gains?.MOV ? [...XP_STAT_NAMES, 'MOV'] : XP_STAT_NAMES;
  return names.map((stat, index) => {
    const gain = result.gains?.[stat] || 0;
    return { stat, gain, before: stats[stat] - gain, after: stats[stat], at: (index + 1) * 120 };
  });
}
