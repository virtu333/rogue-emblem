import { describe, expect, it } from 'vitest';
import { commandSpans } from '../src/ui/MobileBattleHUD.js';

// The upright rail lays a unit's usable commands on a six-column grid. Ways it can go
// wrong: a row left part-empty (Equip and Item beside a blank cell, build 24), a lone
// command beside empty cells, or rows that overflow six columns.
const rows = (spans) => {
  const out = [];
  let used = 6;
  for (const span of spans) {
    if (used + span > 6) {
      out.push([]);
      used = 0;
    }
    out[out.length - 1].push(span);
    used += span;
  }
  return out;
};

describe('commandSpans', () => {
  it('fills every row for any command count', () => {
    for (let n = 1; n <= 9; n++) {
      const spans = commandSpans(n);
      expect(spans).toHaveLength(n);
      for (const row of rows(spans))
        expect(
          row.reduce((a, b) => a + b, 0),
          `n=${n}`,
        ).toBe(6);
    }
  });

  it('never leaves one command alone on a row unless it is the only one', () => {
    for (let n = 2; n <= 9; n++)
      for (const row of rows(commandSpans(n))) expect(row.length).toBeGreaterThan(1);
  });

  it('reads as the owner expects: two split, three across, four as pairs, five as three and two', () => {
    expect(commandSpans(0)).toEqual([]);
    expect(commandSpans(1)).toEqual([6]);
    expect(commandSpans(2)).toEqual([3, 3]);
    expect(commandSpans(3)).toEqual([2, 2, 2]);
    expect(commandSpans(4)).toEqual([3, 3, 3, 3]);
    expect(commandSpans(5)).toEqual([2, 2, 2, 3, 3]);
    expect(commandSpans(6)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(commandSpans(7)).toEqual([2, 2, 2, 3, 3, 3, 3]);
  });
});
