import { describe, expect, it } from 'vitest';
import { ambushStop, fogMoveCut, pathCostTo } from '../src/engine/FogAmbush.js';

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

  it('within an ice slide the entry is paid, the first tile slid past is free, the rest paid', () => {
    // 0 → 1 (walk) → 2 ice entry, sliding through 3 (free) and onto 4 (paid).
    const slide = [{ startIndex: 2, slidePath: line(5).slice(2) }];
    expect(pathCostTo(line(5), slide, 4, () => 1)).toBe(3);
    expect(pathCostTo(line(5), slide, 3, () => 1)).toBe(2);
    expect(pathCostTo(line(5), slide, 2, () => 1)).toBe(2);
  });
});

// Ice × fog: the real board holds a slide that the seen-only plan let run. Boards are one
// row; the expected paths and costs are worked out by hand from IceMovement's rules: the
// entry tile is paid, the first tile slid past it is free, every later one is paid, a tile
// the slide would slide ONTO that holds a unit stops it before that tile, and a unit on the
// entry tile starts no slide (a normal step; the slide starts on the next ice tile).
describe('ice slides against the real board', () => {
  const cols = (path) => path.map((t) => t.col);
  const one = () => 1;
  const walker = (hiddenCols, { pass = false, allowance, segs, n = 6 } = {}) => {
    const foes = hiddenCols.map((col) => ({ col, row: 0, faction: 'enemy' }));
    const out = fogMoveCut(line(n), segs, n === 6 ? 4 : 1, {
      hiddenAt: at(foes),
      blockedAt: at(foes),
      passes: () => pass,
      costAt: one,
      allowance,
    });
    return { ...out, foes };
  };

  // P I I I I P: the plan slides 1 -> 5. Entry 1 (1), 2 free, 3, 4, 5 (3) = 4.
  const longSlide = [{ startIndex: 1, slidePath: line(6).slice(1) }];

  it.each([false, true])(
    'a hidden unit inside the slide holds it (Pass: %s): the unit rests on the last free ice tile',
    (pass) => {
      // On column 3: the slide stops on column 2. Cost: entry 1 + free 2 = 1.
      const mid = walker([3], { pass, segs: longSlide });
      expect(cols(mid.path)).toEqual([0, 1, 2]);
      expect(mid.ambusher).toBe(mid.foes[0]);
      expect(mid.cost).toBe(1);
      // On column 2, the first tile slid onto: the unit never leaves the entry tile.
      const first = walker([2], { pass, segs: longSlide });
      expect(cols(first.path)).toEqual([0, 1]);
      expect(first.cost).toBe(1);
      // On column 5, the landing (also the last tile): rests on 4. Cost 1 + 0 + 1 + 1 = 3.
      const landing = walker([5], { pass, segs: longSlide });
      expect(cols(landing.path)).toEqual([0, 1, 2, 3, 4]);
      expect(landing.cost).toBe(3);
    },
  );

  it('a clear board slides to the end and pays the plan', () => {
    for (const pass of [false, true]) {
      const clear = walker([], { pass, segs: longSlide });
      expect(cols(clear.path)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(clear.ambusher).toBeNull();
      expect(clear.cost).toBe(4);
    }
  });

  it('a hidden unit on the ice ENTRY tile: stops a unit without Pass; a Pass unit steps through and the slide starts one tile on', () => {
    const plain = walker([1], { pass: false, segs: longSlide });
    expect(cols(plain.path)).toEqual([0]);
    expect(plain.cost).toBe(0);
    expect(plain.ambusher).toBe(plain.foes[0]);
    // Pass: column 1 is a normal step (1), the slide starts at column 2 (entry 1), column 3
    // is free, columns 4 and 5 cost 1 each: 1 + 1 + 0 + 1 + 1 = 4. No ambush; the move is whole.
    const pass = walker([1], { pass: true, segs: longSlide });
    expect(cols(pass.path)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pass.ambusher).toBeNull();
    expect(pass.cost).toBe(4);
    expect(pass.slideSegments).toEqual([{ startIndex: 2, slidePath: line(6).slice(2) }]);
  });

  it('Pass through two hidden units on consecutive ice tiles: both are normal steps', () => {
    // 1 and 2 are normal steps; the slide starts at 3 (entry 1), 4 free, 5 paid: 1+1+1+0+1 = 4.
    const out = walker([1, 2], { pass: true, segs: longSlide });
    expect(cols(out.path)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.cost).toBe(4);
    expect(out.slideSegments).toEqual([{ startIndex: 3, slidePath: line(6).slice(3) }]);
  });

  it('Pass through the entry, then a second hidden unit inside the (shifted) slide holds it', () => {
    // Hidden on 1 and 3: column 1 is a normal step (1), the slide starts at 2 (entry 1);
    // column 3 holds it, so the unit rests on 2 (nobody there). Cost 2.
    const a = walker([1, 3], { pass: true, segs: longSlide });
    expect(cols(a.path)).toEqual([0, 1, 2]);
    expect(a.ambusher).toBe(a.foes[1]);
    expect(a.cost).toBe(2);
    // Hidden on 1 and 4: 1 normal (1), 2 entry (1), 3 free; column 4 holds it: rests on 3. Cost 2.
    const b = walker([1, 4], { pass: true, segs: longSlide });
    expect(cols(b.path)).toEqual([0, 1, 2, 3]);
    expect(b.cost).toBe(2);
  });

  it('a hidden unit beyond the slide, on a walked plain tile: Pass walks through, the rest stops', () => {
    // P I I P P P: the plan slides 1 -> 3 (landing on plain), then walks 4 and 5.
    // Cost: entry 1 + free 2 + landing 3 (1) + 4 (1) + 5 (1) = 4.
    const segs = [{ startIndex: 1, slidePath: line(4).slice(1) }];
    const pass = walker([4], { pass: true, segs });
    expect(cols(pass.path)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pass.ambusher).toBeNull();
    expect(pass.cost).toBe(4);
    const plain = walker([4], { pass: false, segs });
    expect(cols(plain.path)).toEqual([0, 1, 2, 3]);
    expect(plain.cost).toBe(2); // entry 1 + free 0 + landing 1
    // A unit on the (plain) LANDING of a longer path: the slide would slide onto it, so it
    // is held on column 2, even for Pass. Cost 1.
    for (const p of [false, true]) {
      const landing = walker([3], { pass: p, segs });
      expect(cols(landing.path)).toEqual([0, 1, 2]);
      expect(landing.cost).toBe(1);
    }
  });

  it('a hidden unit on a plain walked tile before the ice: Pass walks through, the slide is untouched', () => {
    // P P I I I P: walk 1 (1), entry 2 (1), 3 free, 4 (1), 5 (1) = 4.
    const segs = [{ startIndex: 2, slidePath: line(6).slice(2) }];
    const pass = walker([1], { pass: true, segs });
    expect(cols(pass.path)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pass.ambusher).toBeNull();
    expect(pass.cost).toBe(4);
    expect(pass.slideSegments).toEqual(segs);
    const plain = walker([1], { pass: false, segs });
    expect(cols(plain.path)).toEqual([0]);
    expect(plain.cost).toBe(0);
  });

  it('ambushStop with the slides: the same cut, the path only', () => {
    const foes = [{ col: 3, row: 0 }];
    const probes = { hiddenAt: at(foes), blockedAt: at(foes), passes: () => true };
    const cut = ambushStop(line(6), { ...probes, slideSegments: longSlide });
    expect(cols(cut.path)).toEqual([0, 1, 2]);
    expect(cut.stopIndex).toBe(2);
    // Without the plan's slides every tile is a walked tile: Pass goes through (as before).
    expect(ambushStop(line(6), probes).ambusher).toBeNull();
  });

  it('a Pass unit that can no longer pay for the step through an ice entry is stopped before it', () => {
    // P I P: the plan slides 1 -> 2 for 1 (the landing is a free slid tile). With a unit on
    // column 1 the step onto column 2 is a paid walk: 1 + 1 = 2.
    const segs = [{ startIndex: 1, slidePath: line(3).slice(1) }];
    const rich = walker([1], { pass: true, segs, n: 3, allowance: 2 });
    expect(cols(rich.path)).toEqual([0, 1, 2]);
    expect(rich.cost).toBe(2);
    expect(rich.ambusher).toBeNull();
    // Allowance 1: column 2 is out of reach and column 1 is occupied, so the unit stays on 0
    // and the unit it could not pass is revealed.
    const poor = walker([1], { pass: true, segs, n: 3, allowance: 1 });
    expect(cols(poor.path)).toEqual([0]);
    expect(poor.cost).toBe(0);
    expect(poor.ambusher).toBe(poor.foes[0]);
    // No allowance given: the move is whole.
    const unlimited = walker([1], { pass: true, segs, n: 3 });
    expect(cols(unlimited.path)).toEqual([0, 1, 2]);
  });
});
