import { describe, it, expect } from 'vitest';
import { orderedStatKeys } from '../src/ui/statOrder.js';

// A unit's stats object as saves hold it (Fire Emblem order).
const STATS = { HP: 28, STR: 7, MAG: 3, SKL: 11, SPD: 13, DEF: 11, RES: 4, LCK: 9, MOV: 4 };

describe('orderedStatKeys', () => {
  it('keeps Fire Emblem order for the three-column grid', () => {
    expect(orderedStatKeys(STATS)).toEqual([
      'HP',
      'STR',
      'MAG',
      'SKL',
      'SPD',
      'DEF',
      'RES',
      'LCK',
      'MOV',
    ]);
    expect(orderedStatKeys(STATS, { twoColumn: false })).toEqual(Object.keys(STATS));
  });

  it('two columns: HP/STR/SPD/RES/MOV down the left, MAG/SKL/DEF/LCK down the right', () => {
    const keys = orderedStatKeys(STATS, { twoColumn: true });
    expect(keys).toEqual(['HP', 'MAG', 'STR', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV']);
    // Row-major into two columns: even indices are the left column.
    expect(keys.filter((_, i) => i % 2 === 0)).toEqual(['HP', 'STR', 'SPD', 'RES', 'MOV']);
    expect(keys.filter((_, i) => i % 2 === 1)).toEqual(['MAG', 'SKL', 'DEF', 'LCK']);
  });

  it('does not depend on the order the stats object was built in', () => {
    const shuffled = { MOV: 5, LCK: 1, RES: 2, DEF: 3, SPD: 4, SKL: 6, MAG: 7, STR: 8, HP: 9 };
    expect(orderedStatKeys(shuffled, { twoColumn: true })).toEqual([
      'HP',
      'MAG',
      'STR',
      'SKL',
      'SPD',
      'DEF',
      'RES',
      'LCK',
      'MOV',
    ]);
    expect(orderedStatKeys(shuffled)).toEqual([
      'HP',
      'STR',
      'MAG',
      'SKL',
      'SPD',
      'DEF',
      'RES',
      'LCK',
      'MOV',
    ]);
  });

  it('skips missing stats and never invents one', () => {
    expect(orderedStatKeys({ HP: 1, MAG: 2, MOV: 3 }, { twoColumn: true })).toEqual([
      'HP',
      'MAG',
      'MOV',
    ]);
    expect(orderedStatKeys({ STR: 1, HP: 2 }, { twoColumn: true })).toEqual(['HP', 'STR']);
    expect(orderedStatKeys({}, { twoColumn: true })).toEqual([]);
    expect(orderedStatKeys(undefined)).toEqual([]);
    expect(orderedStatKeys(null, { twoColumn: true })).toEqual([]);
  });

  it('keeps unknown stats (in their own order) and Move last', () => {
    const stats = { HP: 1, CON: 2, STR: 3, MOV: 4, AUR: 5 };
    expect(orderedStatKeys(stats, { twoColumn: true })).toEqual(['HP', 'STR', 'CON', 'AUR', 'MOV']);
    expect(orderedStatKeys(stats)).toEqual(['HP', 'STR', 'CON', 'AUR', 'MOV']);
    for (const twoColumn of [true, false]) {
      const keys = orderedStatKeys({ MOV: 1, ...STATS, ZZZ: 0 }, { twoColumn });
      expect(keys.at(-1)).toBe('MOV');
      expect(keys).toHaveLength(10);
    }
  });
});
