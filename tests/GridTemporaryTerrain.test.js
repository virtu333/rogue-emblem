import { describe, it, expect } from 'vitest';
import { Grid } from '../src/engine/Grid.js';

function makeMockScene() {
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: {
      rectangle: () => ({
        depth: 0,
        setDepth(v) { this.depth = v; return this; },
        destroy() {},
      }),
      image: () => ({
        depth: 0,
        setDisplaySize() { return this; },
        setDepth(v) { this.depth = v; return this; },
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
