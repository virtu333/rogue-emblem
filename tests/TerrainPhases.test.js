import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDueHybridOverrides,
  applyTerrainSetTiles,
  canStandOnTerrain,
  normalizePendingTerrainTiles,
} from '../src/engine/TerrainPhases.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { loadGameData } from './testData.js';

const { terrain } = loadGameData();
const T = Object.fromEntries(terrain.map((t, i) => [t.name, i]));

// A 5x4 board of Plain (no generated map: every expected tile is written out here).
function board() {
  const layout = Array.from({ length: 4 }, () => Array(5).fill(T.Plain));
  return new HeadlessGrid(5, 4, terrain, layout, false);
}
const unitAt = (col, row, moveType = 'Infantry', extra = {}) => ({
  name: `${moveType}@${col},${row}`,
  col,
  row,
  moveType,
  currentHP: 10,
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('canStandOnTerrain', () => {
  it('reads the move cost table: Wall holds nobody, Water only fliers', () => {
    const byName = Object.fromEntries(terrain.map((t) => [t.name, t]));
    for (const moveType of ['Infantry', 'Armored', 'Cavalry', 'Flying']) {
      expect(canStandOnTerrain(byName.Wall, moveType)).toBe(false);
      expect(canStandOnTerrain(byName.Plain, moveType)).toBe(true);
    }
    expect(canStandOnTerrain(byName.Water, 'Flying')).toBe(true);
    expect(canStandOnTerrain(byName.Water, 'Infantry')).toBe(false);
    expect(canStandOnTerrain(byName.Mountain, 'Armored')).toBe(false);
    expect(canStandOnTerrain(byName.Mountain, 'Infantry')).toBe(true);
  });
});

describe('applyTerrainSetTiles', () => {
  it('writes free tiles and refuses a tile whose occupant could not stand on the result', () => {
    const grid = board();
    const knight = unitAt(1, 1);
    const out = applyTerrainSetTiles(
      grid,
      [
        { coord: [1, 1], terrain: 'Wall' },
        { coord: [2, 1], terrain: 'Wall' },
      ],
      {},
      { occupants: [knight] },
    );
    expect(grid.mapLayout[1][1]).toBe(T.Plain);
    expect(grid.mapLayout[1][2]).toBe(T.Wall);
    expect(out.refused).toHaveLength(1);
    expect(out.refused[0]).toMatchObject({ col: 1, row: 1, terrain: 'Wall' });
    expect(out.refused[0].occupants).toEqual([knight]);
    expect(out.applied.map((e) => [e.col, e.row])).toEqual([[2, 1]]);
    expect(out.changedTiles).toBe(1);
  });

  it('judges by the occupant move type: a flier may have water raised under it, a soldier may not', () => {
    const grid = board();
    const flier = unitAt(0, 0, 'Flying');
    const soldier = unitAt(3, 0, 'Infantry');
    const out = applyTerrainSetTiles(
      grid,
      [
        { coord: [0, 0], terrain: 'Water' },
        { coord: [3, 0], terrain: 'Water' },
        { coord: [3, 0], terrain: 'Forest' },
      ],
      {},
      { occupants: [flier, soldier] },
    );
    expect(grid.mapLayout[0][0]).toBe(T.Water);
    // The water is refused under the soldier; the later forest he can stand in.
    expect(grid.mapLayout[0][3]).toBe(T.Forest);
    expect(out.refused.map((e) => e.terrain)).toEqual(['Water']);
  });

  it('a fallen or departing unit holds nothing', () => {
    const grid = board();
    const out = applyTerrainSetTiles(
      grid,
      [
        { coord: [1, 1], terrain: 'Wall' },
        { coord: [2, 2], terrain: 'Wall' },
      ],
      {},
      {
        occupants: [
          unitAt(1, 1, 'Infantry', { currentHP: 0 }),
          unitAt(2, 2, 'Infantry', { _removing: true }),
        ],
      },
    );
    expect(out.refused).toEqual([]);
    expect(grid.mapLayout[1][1]).toBe(T.Wall);
    expect(grid.mapLayout[2][2]).toBe(T.Wall);
  });

  it('every tile of a multi-tile body counts', () => {
    const grid = board();
    // Entity footprint is 3x3 from its anchor: (1,1) covers cols 1..3, rows 1..3.
    const entity = unitAt(1, 1, 'Infantry', { isEntity: true });
    const out = applyTerrainSetTiles(
      grid,
      [
        { coord: [3, 3], terrain: 'Wall' },
        { coord: [4, 3], terrain: 'Wall' },
      ],
      {},
      { occupants: [entity] },
    );
    expect(grid.mapLayout[3][3]).toBe(T.Plain);
    expect(grid.mapLayout[3][4]).toBe(T.Wall);
    expect(out.refused.map((e) => [e.col, e.row])).toEqual([[3, 3]]);
  });

  it('resolves anchors and skips what it cannot resolve without touching the board', () => {
    const grid = board();
    const before = grid.mapLayout.map((r) => [...r]);
    const out = applyTerrainSetTiles(
      grid,
      [
        { anchor: 'nowhere', terrain: 'Wall' },
        { coord: [9, 9], terrain: 'Wall' },
        { coord: [1, 1], terrain: 'Lava Lake' },
      ],
      { gate: { col: 4, row: 0 } },
    );
    expect(out.skipped).toHaveLength(3);
    expect(grid.mapLayout).toEqual(before);
    applyTerrainSetTiles(grid, [{ anchor: 'gate', terrain: 'Fort' }], { gate: { col: 4, row: 0 } });
    expect(grid.mapLayout[0][4]).toBe(T.Fort);
  });

  it('a tile under a temporary wall keeps it; the override is what the wall expires back to', () => {
    const grid = board();
    grid.setTemporaryTerrain(2, 2, 'Wall', 1);
    const out = applyTerrainSetTiles(grid, [{ coord: [2, 2], terrain: 'Forest' }], {});
    expect(out.applied[0]).toMatchObject({ col: 2, row: 2, underTemporary: true });
    expect(grid.mapLayout[2][2]).toBe(T.Wall);
    grid.tickTemporaryTerrains();
    expect(grid.mapLayout[2][2]).toBe(T.Forest);
  });

  it('draws no random numbers', () => {
    const spy = vi.spyOn(Math, 'random');
    applyTerrainSetTiles(
      board(),
      [{ coord: [1, 1], terrain: 'Wall' }],
      {},
      { occupants: [unitAt(1, 1)] },
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('applyDueHybridOverrides (deferral)', () => {
  const config = {
    hybridAnchors: { gate: { col: 2, row: 1 } },
    phaseTerrainOverrides: [
      {
        turn: 2,
        setTiles: [
          { anchor: 'gate', terrain: 'Wall' },
          { coord: [3, 1], terrain: 'Wall' },
        ],
      },
      { turn: 4, setTiles: [{ coord: [2, 1], terrain: 'Fort' }] },
    ],
  };

  function run(grid, state, turn, occupants, battleConfig = config) {
    const out = applyDueHybridOverrides({
      grid,
      battleConfig,
      turn,
      occupants,
      appliedTurns: state.applied,
      pendingTiles: state.pending,
    });
    state.pending = out.pendingTiles;
    return out.result;
  }

  it('defers an occupied tile and walls it at the first later enemy phase it is free', () => {
    const grid = board();
    const state = { applied: new Set(), pending: [] };
    const guard = unitAt(2, 1);

    expect(run(grid, state, 1, [guard])).toMatchObject({ dueOverrides: 0, changedTiles: 0 });
    const t2 = run(grid, state, 2, [guard]);
    expect(t2).toMatchObject({
      dueOverrides: 1,
      changedTiles: 1,
      deferredTiles: 1,
      pendingTiles: 1,
    });
    expect(grid.mapLayout[1][2]).toBe(T.Plain); // never under the guard
    expect(grid.mapLayout[1][3]).toBe(T.Wall);
    expect(state.pending).toEqual([{ turn: 2, col: 2, row: 1, terrain: 'Wall' }]);
    expect([...state.applied]).toEqual([2]);

    // Still standing there next enemy phase: retried, refused again.
    const t3 = run(grid, state, 3, [guard]);
    expect(t3).toMatchObject({
      retriedTiles: 1,
      deferredTiles: 1,
      changedTiles: 0,
      pendingTiles: 1,
    });
    expect(grid.mapLayout[1][2]).toBe(T.Plain);

    // He steps off during the player phase; the wall goes up as the next enemy phase starts.
    guard.col = 1;
    const wallsOnly = {
      ...config,
      phaseTerrainOverrides: config.phaseTerrainOverrides.slice(0, 1),
    };
    expect(run(grid, state, 4, [guard], wallsOnly)).toMatchObject({
      retriedTiles: 1,
      changedTiles: 1,
      pendingTiles: 0,
    });
    expect(grid.mapLayout[1][2]).toBe(T.Wall);
    expect(state.pending).toEqual([]);
  });

  it('a later override of the same tile replaces the waiting one, so a retry never undoes it', () => {
    const grid = board();
    const state = { applied: new Set(), pending: [] };
    const guard = unitAt(2, 1);
    run(grid, state, 2, [guard]);
    run(grid, state, 3, [guard]);
    // Turn 4 writes Fort, which he can stand on: applied under him, the Wall is dropped.
    const t4 = run(grid, state, 4, [guard]);
    expect(t4).toMatchObject({ retriedTiles: 1, dueOverrides: 1, pendingTiles: 0 });
    expect(grid.mapLayout[1][2]).toBe(T.Fort);
    guard.col = 0;
    run(grid, state, 5, [guard]);
    expect(grid.mapLayout[1][2]).toBe(T.Fort);
  });

  it('an override turn applies once, and a pending tile is not retried in the phase that deferred it', () => {
    const grid = board();
    const state = { applied: new Set(), pending: [] };
    const guard = unitAt(2, 1);
    run(grid, state, 2, [guard]);
    guard.col = 0;
    // A second call for the same turn: no override re-applies and the tile waits for turn 3.
    expect(run(grid, state, 2, [guard])).toMatchObject({ dueOverrides: 0, retriedTiles: 0 });
    expect(grid.mapLayout[1][2]).toBe(T.Plain);
    expect(run(grid, state, 3, [guard])).toMatchObject({ retriedTiles: 1, changedTiles: 1 });
    expect(grid.mapLayout[1][2]).toBe(T.Wall);
  });

  it('a saved pending list survives JSON and drops malformed entries', () => {
    const list = [
      { turn: 2, col: 2, row: 1, terrain: 'Wall', extra: true },
      { turn: 0, col: 2, row: 1, terrain: 'Wall' },
      { turn: 2, col: '2', row: 1, terrain: 'Wall' },
      null,
    ];
    expect(normalizePendingTerrainTiles(JSON.parse(JSON.stringify(list)))).toEqual([
      { turn: 2, col: 2, row: 1, terrain: 'Wall' },
    ]);
    expect(normalizePendingTerrainTiles(undefined)).toEqual([]);
  });
});
