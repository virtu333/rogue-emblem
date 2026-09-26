import { describe, it, expect } from 'vitest';
import { growthRows, growthsNote } from '../src/ui/growthsCard.js';
import { levelUp, levelUpFallbackStat } from '../src/engine/UnitManager.js';

const growths = { HP: 92, STR: 75, MAG: 9, SKL: 39, SPD: 49, DEF: 31, RES: 10, LCK: 21 };

describe('growths card', () => {
  it('rows follow level-up order with tiers at 60 / 30', () => {
    const rows = growthRows(growths);
    expect(rows.map((r) => r.stat)).toEqual([
      'HP',
      'STR',
      'MAG',
      'SKL',
      'SPD',
      'DEF',
      'RES',
      'LCK',
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.stat, r.tier]))).toEqual({
      HP: 'high',
      STR: 'high',
      MAG: 'low',
      SKL: 'mid',
      SPD: 'mid',
      DEF: 'mid',
      RES: 'low',
      LCK: 'low',
    });
    expect(growthRows({ HP: 60, STR: 59, MAG: 30, SKL: 29 }).map((r) => r.tier)).toEqual([
      'high',
      'mid',
      'mid',
      'low',
    ]);
  });

  it('bars clamp to 0–100 but the text keeps the real value', () => {
    const [over, under] = growthRows({ HP: 115, STR: -5 });
    expect([over.fill, over.value]).toEqual([100, 115]);
    expect([under.fill, under.value]).toEqual([0, -5]);
  });

  it('marks the stat a failed level-up falls back to, and names it', () => {
    expect(
      growthRows(growths)
        .filter((r) => r.fallback)
        .map((r) => r.stat),
    ).toEqual(['HP']);
    expect(growthsNote({ ...growths, HP: 40 })).toContain('Strength ◆ still gains +1');
  });
});

describe('level-up fallback stat', () => {
  it('is the highest growth, the earlier stat on a tie, HP when nothing is positive', () => {
    expect(levelUpFallbackStat({ HP: 40, STR: 70, SPD: 70 })).toBe('STR');
    expect(levelUpFallbackStat({ HP: 0, STR: 0 })).toBe('HP');
    expect(levelUpFallbackStat({ HP: 10, LCK: 11 })).toBe('LCK');
  });

  it('is the stat levelUp grants when every roll fails', () => {
    const unit = { level: 1, tier: 'base', growths: { ...growths, HP: 40 } };
    const result = levelUp(unit, () => 0.999);
    expect(Object.entries(result.gains).filter(([, v]) => v)).toEqual([['STR', 1]]);
  });
});
