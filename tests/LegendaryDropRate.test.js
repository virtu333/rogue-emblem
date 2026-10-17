import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';

const data = loadGameData();

// Share of a loot roll that is a legendary weapon card: its weight over the table's total.
function legendaryShare(act) {
  const weights = data.lootTables[act].weights;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return weights.legendaryWeapon / total;
}

describe('legendary weapon drop rate', () => {
  it('stays at none before Act III', () => {
    expect(legendaryShare('act1')).toBe(0);
    expect(legendaryShare('act2')).toBe(0);
  });

  it('is about 5% in Act III and about 8% in Act IV', () => {
    expect(legendaryShare('act3')).toBeGreaterThan(0.04);
    expect(legendaryShare('act3')).toBeLessThan(0.06);
    expect(legendaryShare('act4')).toBeGreaterThan(0.075);
    expect(legendaryShare('act4')).toBeLessThan(0.085);
  });
});
