import { describe, it, expect } from 'vitest';
import {
  FORMATION_MIN_UNITS,
  autoFill,
  canEnter,
  clearTile,
  createFormation,
  createStandingRules,
  formationActive,
  formationCushion,
  isComplete,
  pickFormationSpares,
  placeUnit,
  placedCount,
  playerSpawnBounds,
  tileKey,
} from '../src/engine/FormationPlacement.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));

// Build a map from rows of letters: . plain, M mountain, W wall, L lava crack, ~ water.
function map(rowsText) {
  const code = { '.': T.Plain, M: T.Mountain, W: T.Wall, L: T['Lava Crack'], '~': T.Water };
  const mapLayout = rowsText.map((line) => [...line].map((ch) => code[ch]));
  return {
    mapLayout,
    cols: mapLayout[0].length,
    rows: mapLayout.length,
    terrainData: data.terrain,
  };
}
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0;
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

describe('formation rules', () => {
  it('opens at three deployed units, never in the tutorial or on resume', () => {
    expect(FORMATION_MIN_UNITS).toBe(3);
    expect(formationActive({ deployCount: 2 })).toBe(false);
    expect(formationActive({ deployCount: 3 })).toBe(true);
    expect(formationActive({ deployCount: 5, tutorialMode: true })).toBe(false);
    expect(formationActive({ deployCount: 5, resuming: true })).toBe(false);
    expect(formationActive({ deployCount: 5, disabled: true })).toBe(false);
  });

  it('offers at least two spare tiles, more as the army grows', () => {
    expect([3, 4, 5, 6, 8, 10].map(formationCushion)).toEqual([2, 2, 3, 3, 4, 5]);
  });

  it('rounds the spawn zone like the generator', () => {
    const template = { zones: [{ role: 'playerSpawn', rect: [0, 0.25, 0.12, 0.7] }] };
    // 16×10: cols floor(0)…ceil(1.92)=2, rows floor(2.5)=2…ceil(7)=7
    expect(playerSpawnBounds(template, 16, 10)).toEqual({
      startCol: 0,
      endCol: 2,
      startRow: 2,
      endRow: 7,
    });
    expect(playerSpawnBounds(null, 10, 8)).toEqual({
      startCol: 0,
      endCol: 3,
      startRow: 0,
      endRow: 8,
    });
  });
});

describe('spare tiles', () => {
  const base = map([
    '..L.......', //
    '..........',
    '.W........',
    '..........',
    '....~~~~~~',
    '....~.....',
  ]);
  const bounds = { startCol: 0, endCol: 4, startRow: 0, endRow: 6 };
  const spawns = [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
    { col: 0, row: 3 },
  ];

  it('are walkable, reachable, in the zone, off hazards and never on a taken tile', () => {
    const spares = pickFormationSpares({
      ...base,
      spawns,
      bounds,
      blocked: [{ col: 3, row: 3 }],
      count: 30,
      rng: seeded(3),
    });
    const keys = spares.map(tileKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of spares) {
      expect(t.col).toBeLessThan(4);
      expect(canEnter(base, t.col, t.row, 'Infantry')).toBe(true);
    }
    expect(keys).not.toContain('2,0'); // lava crack
    expect(keys).not.toContain('1,2'); // wall
    expect(keys).not.toContain('3,3'); // blocked
    for (const s of spawns) expect(keys).not.toContain(tileKey(s));
    // Every in-zone plain tile that is free is eligible: 24 cells − 3 spawns − wall − lava − blocked.
    expect(spares).toHaveLength(24 - 3 - 3);
  });

  it('keep two steps clear of enemies', () => {
    const spares = pickFormationSpares({
      ...base,
      spawns,
      bounds,
      enemies: [{ col: 3, row: 1 }],
      count: 30,
      rng: seeded(4),
    });
    for (const t of spares) expect(Math.abs(t.col - 3) + Math.abs(t.row - 1)).toBeGreaterThan(2);
  });

  it('are the same for the same seed and differ for another', () => {
    const args = { ...base, spawns, bounds, count: 3 };
    const a = pickFormationSpares({ ...args, rng: seeded(9) });
    expect(pickFormationSpares({ ...args, rng: seeded(9) })).toEqual(a);
    const others = [10, 11, 12, 13].map((s) => pickFormationSpares({ ...args, rng: seeded(s) }));
    expect(others.some((o) => JSON.stringify(o) !== JSON.stringify(a))).toBe(true);
  });

  it('first cover a move type the spawns cannot hold', () => {
    const hills = map(['MM....', 'MM....', 'M.....']);
    const spares = pickFormationSpares({
      ...hills,
      spawns: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
      bounds: { startCol: 0, endCol: 3, startRow: 0, endRow: 3 },
      moveTypes: ['Cavalry', 'Cavalry'],
      count: 2,
      rng: seeded(1),
    });
    // Both mounted units need a non-mountain tile; the only ones in the zone are
    // (2,0),(2,1),(1,2),(2,2).
    for (const t of spares) expect(canEnter(hills, t.col, t.row, 'Cavalry')).toBe(true);
  });

  it('widen around the spawns when the zone is full', () => {
    const spares = pickFormationSpares({
      ...base,
      spawns: [{ col: 0, row: 0 }],
      bounds: { startCol: 0, endCol: 1, startRow: 0, endRow: 1 },
      count: 2,
      rng: seeded(2),
    });
    expect(spares).toHaveLength(2);
    for (const t of spares) expect(Math.max(t.col, t.row)).toBeLessThanOrEqual(2);
  });
});

describe('standing rules', () => {
  it('rejects impassable tiles and boxed-in pockets for that move type only', () => {
    const m = map([
      '.MMM....', //
      'MM.M....',
      '.MMM....',
      '........',
    ]);
    const tiles = [
      { col: 2, row: 1 }, // a plain ringed by mountains: horses are stuck
      { col: 1, row: 0 }, // mountain
      { col: 5, row: 3 }, // open plain
    ];
    const rules = createStandingRules(m, tiles);
    expect(rules.issue('Cavalry', 0)).toMatch(/boxed in/);
    expect(rules.issue('Cavalry', 1)).toMatch(/can't stand on Mountain/);
    expect(rules.issue('Cavalry', 2)).toBe('');
    expect(rules.issue('Infantry', 0)).toBe('');
    expect(rules.issue('Infantry', 1)).toBe('');
    expect(rules.issue('Flying', 0)).toBe('');
  });
});

describe('assignment', () => {
  const tiles = [
    { col: 0, row: 0 },
    { col: 0, row: 1 },
    { col: 0, row: 2 },
    { col: 0, row: 3 },
  ];

  it('places, swaps with the occupant, and returns a displaced unit to the bench', () => {
    let f = createFormation(3, tiles);
    f = placeUnit(f, 0, 0);
    f = placeUnit(f, 1, 1);
    expect(f.at).toEqual([0, 1, null]);
    f = placeUnit(f, 0, 1); // unit 0 onto unit 1's tile: they swap
    expect(f.at).toEqual([1, 0, null]);
    f = placeUnit(f, 2, 0); // an unplaced unit onto an occupied tile: occupant is benched
    expect(f.at).toEqual([1, null, 0]);
    f = clearTile(f, 1);
    expect(f.at).toEqual([null, null, 0]);
    expect(placedCount(f)).toBe(1);
    expect(isComplete(f)).toBe(false);
  });

  it('auto-fill keeps placements and finds a full fill when greedy order would fail', () => {
    // Unit 0 may stand anywhere; unit 1 only on tile 0. Greedy in order would put
    // unit 0 on tile 0 and strand unit 1; matching moves unit 0 along.
    const allowed = (u, t) => (u === 1 ? t === 0 : t <= 1);
    const f = autoFill(createFormation(2, tiles.slice(0, 2)), allowed);
    expect(f.at).toEqual([1, 0]);
    expect(isComplete(f)).toBe(true);
    // A player's placement is never moved.
    const kept = autoFill(placeUnit(createFormation(3, tiles), 2, 3), () => true);
    expect(kept.at[2]).toBe(3);
    expect(isComplete(kept)).toBe(true);
  });

  it('auto-fill honours tile preference and leaves a unit out when nothing fits', () => {
    const f = autoFill(createFormation(2, tiles), () => true, { tileOrder: [3, 2, 1, 0] });
    expect(f.at).toEqual([3, 2]);
    const none = autoFill(createFormation(2, tiles), (u) => u === 0);
    expect(none.at[1]).toBeNull();
  });
});
