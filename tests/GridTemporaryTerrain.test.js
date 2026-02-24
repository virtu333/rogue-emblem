import { describe, it, expect } from 'vitest';
import { Grid } from '../src/engine/Grid.js';

function makeMockScene() {
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: {
      rectangle: () => ({
        depth: 0,
        setDepth(v) {
          this.depth = v;
          return this;
        },
        destroy() {},
      }),
      image: () => ({
        depth: 0,
        setDisplaySize() {
          return this;
        },
        setDepth(v) {
          this.depth = v;
          return this;
        },
        destroy() {},
      }),
    },
    textures: { exists: () => false },
  };
}

function makeGrid() {
  const terrain = [
    { name: 'Plain', moveCost: { Infantry: '1' }, avoidBonus: 0, defBonus: 0 },
    { name: 'Wall', moveCost: { Infantry: '--' }, avoidBonus: 0, defBonus: 0 },
  ];
  const mapLayout = Array.from({ length: 4 }, () => Array(4).fill(0));
  return new Grid(makeMockScene(), 4, 4, terrain, mapLayout, false);
}

describe('Grid temporary terrain lifecycle', () => {
  it('spawns temporary wall and expires after duration', () => {
    const grid = makeGrid();
    expect(grid.getTerrainAt(1, 1).name).toBe('Plain');
    expect(grid.setTemporaryTerrain(1, 1, 'Wall', 2)).toBe(true);
    expect(grid.getTerrainAt(1, 1).name).toBe('Wall');
    expect(grid.isTemporaryTerrainAt(1, 1)).toBe(true);

    grid.tickTemporaryTerrains();
    expect(grid.getTerrainAt(1, 1).name).toBe('Wall');

    grid.tickTemporaryTerrains();
    expect(grid.getTerrainAt(1, 1).name).toBe('Plain');
    expect(grid.isTemporaryTerrainAt(1, 1)).toBe(false);
  });

  it('break action can clear temporary terrain immediately', () => {
    const grid = makeGrid();
    grid.setTemporaryTerrain(2, 2, 'Wall', 3);
    expect(grid.getTerrainAt(2, 2).name).toBe('Wall');
    expect(grid.clearTemporaryTerrainAt(2, 2)).toBe(true);
    expect(grid.getTerrainAt(2, 2).name).toBe('Plain');
  });
});

describe('Grid temporary terrain source tracking (B4)', () => {
  it('clearTemporaryTerrainsBySource clears walls owned by a specific unit', () => {
    const grid = makeGrid();
    const unitA = { name: 'Mage', col: 0, row: 0 };
    grid.setTemporaryTerrain(1, 0, 'Wall', 3, unitA);
    grid.setTemporaryTerrain(0, 1, 'Wall', 3, unitA);
    expect(grid.getTerrainAt(1, 0).name).toBe('Wall');
    expect(grid.getTerrainAt(0, 1).name).toBe('Wall');

    const cleared = grid.clearTemporaryTerrainsBySource(unitA);
    expect(cleared).toBe(2);
    expect(grid.getTerrainAt(1, 0).name).toBe('Plain');
    expect(grid.getTerrainAt(0, 1).name).toBe('Plain');
  });

  it('clearTemporaryTerrainsBySource does not clear walls from a different unit object', () => {
    const grid = makeGrid();
    const unitA = { name: 'Mage', col: 0, row: 0 };
    const unitB = { name: 'Mage', col: 3, row: 3 }; // same name, different object
    grid.setTemporaryTerrain(1, 0, 'Wall', 3, unitA);
    grid.setTemporaryTerrain(2, 0, 'Wall', 3, unitB);

    const cleared = grid.clearTemporaryTerrainsBySource(unitA);
    expect(cleared).toBe(1);
    expect(grid.getTerrainAt(1, 0).name).toBe('Plain');
    expect(grid.getTerrainAt(2, 0).name).toBe('Wall'); // unitB's wall untouched
  });

  it('refresh updates sourceUnit to the new caller', () => {
    const grid = makeGrid();
    const unitA = { name: 'Mage', col: 0, row: 0 };
    const unitB = { name: 'Mage', col: 3, row: 3 };
    grid.setTemporaryTerrain(1, 1, 'Wall', 2, unitA);
    // unitB refreshes the same tile
    grid.setTemporaryTerrain(1, 1, 'Wall', 3, unitB);

    // unitA clearing should NOT remove this wall (ownership transferred to unitB)
    const clearedA = grid.clearTemporaryTerrainsBySource(unitA);
    expect(clearedA).toBe(0);
    expect(grid.getTerrainAt(1, 1).name).toBe('Wall');

    // unitB clearing SHOULD remove it
    const clearedB = grid.clearTemporaryTerrainsBySource(unitB);
    expect(clearedB).toBe(1);
    expect(grid.getTerrainAt(1, 1).name).toBe('Plain');
  });

  it('clearTemporaryTerrainsBySource returns 0 for null source', () => {
    const grid = makeGrid();
    grid.setTemporaryTerrain(1, 1, 'Wall', 2);
    expect(grid.clearTemporaryTerrainsBySource(null)).toBe(0);
  });

  it('clearTemporaryTerrainsBySource works with string-ID affixes (death cleanup)', () => {
    // Simulate a unit whose affixes are string IDs (the actual runtime format)
    const grid = makeGrid();
    const wallerUnit = { name: 'Mage', affixes: ['waller'], moveType: 'foot' };
    grid.setTemporaryTerrain(3, 3, 'Wall', 2, wallerUnit);
    expect(grid.temporaryTerrains.length).toBe(1);
    // No affix-object guard needed — clearTemporaryTerrainsBySource uses reference equality
    const cleared = grid.clearTemporaryTerrainsBySource(wallerUnit);
    expect(cleared).toBe(1);
    expect(grid.temporaryTerrains.length).toBe(0);
  });

  it('walls without sourceUnit are not affected by clearTemporaryTerrainsBySource', () => {
    const grid = makeGrid();
    const unitA = { name: 'Mage', col: 0, row: 0 };
    grid.setTemporaryTerrain(1, 1, 'Wall', 3); // no source
    grid.setTemporaryTerrain(2, 2, 'Wall', 3, unitA);

    const cleared = grid.clearTemporaryTerrainsBySource(unitA);
    expect(cleared).toBe(1);
    expect(grid.getTerrainAt(1, 1).name).toBe('Wall'); // no-source wall untouched
    expect(grid.getTerrainAt(2, 2).name).toBe('Plain');
  });
});
