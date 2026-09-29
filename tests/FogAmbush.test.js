import { describe, expect, it } from 'vitest';
import { ambushStop, pathCostTo } from '../src/engine/FogAmbush.js';

const line = (n) => Array.from({ length: n }, (_, col) => ({ col, row: 0 }));
const at = (units) => (col, row) => units.find((u) => u.col === col && u.row === row) || null;

describe('ambushStop', () => {
  it('a clear path is walked as planned', () => {
    const path = line(5);
    expect(ambushStop(path, { hiddenAt: () => null, blockedAt: () => false })).toEqual({
      path,
      ambusher: null,
      stopIndex: 4,
    });
  });

  it('stops on the tile before the first hidden enemy', () => {
    const foe = { col: 3, row: 0 };
    const cut = ambushStop(line(6), { hiddenAt: at([foe]), blockedAt: () => false });
    expect(cut.ambusher).toBe(foe);
    expect(cut.path).toEqual(line(3));
    expect(cut.stopIndex).toBe(2);
  });

  it('backs off tiles it may only pass (an ally stands there)', () => {
    const foe = { col: 4, row: 0 };
    const allies = [
      { col: 3, row: 0 },
      { col: 2, row: 0 },
    ];
    const cut = ambushStop(line(6), {
      hiddenAt: at([foe]),
      blockedAt: (c, r) => !!at(allies)(c, r),
    });
    expect(cut.path).toEqual(line(2));
  });

  it('a foe on the first step stops the unit where it stands', () => {
    const foe = { col: 1, row: 0 };
    const cut = ambushStop(line(4), { hiddenAt: at([foe]), blockedAt: () => false });
    expect(cut.path).toEqual(line(1));
    expect(cut.stopIndex).toBe(0);
  });
});

describe('pathCostTo', () => {
  it('pays each walked tile up to the stop', () => {
    const costs = { 1: 1, 2: 2, 3: 1 };
    expect(pathCostTo(line(4), [], 2, (col) => costs[col])).toBe(3);
  });

  it('within an ice slide only the entry tile is paid', () => {
    // 0 → 1 (walk) → 2 ice entry, sliding through 3, 4.
    const slide = [{ startIndex: 2, slidePath: line(5).slice(2) }];
    expect(pathCostTo(line(5), slide, 4, () => 1)).toBe(2);
    expect(pathCostTo(line(5), slide, 3, () => 1)).toBe(2);
  });
});
