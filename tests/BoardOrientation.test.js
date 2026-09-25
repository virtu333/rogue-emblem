import { describe, it, expect } from 'vitest';
import {
  createBoardTransform,
  displayLayout,
  rotationForPlayerSide,
} from '../src/utils/boardOrientation.js';
import { Grid } from '../src/engine/Grid.js';
import { TILE_SIZE } from '../src/utils/constants.js';

function allCells(cols, rows) {
  const cells = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) cells.push({ col, row });
  return cells;
}

describe('board orientation transform', () => {
  for (const rotation of ['none', 'ccw', 'cw']) {
    it(`${rotation}: every cell maps to a unique display cell and back`, () => {
      const t = createBoardTransform(18, 13, rotation);
      const seen = new Set();
      for (const { col, row } of allCells(18, 13)) {
        const d = t.toDisplay(col, row);
        expect(d.col).toBeGreaterThanOrEqual(0);
        expect(d.row).toBeGreaterThanOrEqual(0);
        expect(d.col).toBeLessThan(t.displayCols);
        expect(d.row).toBeLessThan(t.displayRows);
        seen.add(`${d.col},${d.row}`);
        expect(t.fromDisplay(d.col, d.row)).toEqual({ col, row });
      }
      expect(seen.size).toBe(18 * 13);
    });

    it(`${rotation}: grid neighbors stay display neighbors (distances unchanged)`, () => {
      const t = createBoardTransform(7, 5, rotation);
      for (const { col, row } of allCells(7, 5)) {
        const a = t.toDisplay(col, row);
        for (const [dc, dr] of [
          [1, 0],
          [0, 1],
        ]) {
          if (col + dc >= 7 || row + dr >= 5) continue;
          const b = t.toDisplay(col + dc, row + dr);
          expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1);
        }
      }
    });

    it(`${rotation}: screen arrows move one drawn cell in that direction`, () => {
      const t = createBoardTransform(9, 6, rotation);
      const start = { col: 4, row: 2 };
      const origin = t.toDisplay(start.col, start.row);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const { dc, dr } = t.displayDeltaToGrid(dx, dy);
        const moved = t.toDisplay(start.col + dc, start.row + dr);
        expect({ x: moved.col - origin.col, y: moved.row - origin.row }).toEqual({ x: dx, y: dy });
      }
    });
  }

  it('ccw draws the left (player) edge along the bottom and swaps dimensions', () => {
    const t = createBoardTransform(16, 10, 'ccw');
    expect([t.displayCols, t.displayRows]).toEqual([10, 16]);
    for (let row = 0; row < 10; row++) expect(t.toDisplay(0, row).row).toBe(15);
    for (let row = 0; row < 10; row++) expect(t.toDisplay(15, row).row).toBe(0);
    // A rotation, not a mirror: the top edge goes to the left edge.
    for (let col = 0; col < 16; col++) expect(t.toDisplay(col, 0).col).toBe(0);
  });

  it('cw draws the right edge along the bottom', () => {
    const t = createBoardTransform(16, 10, 'cw');
    for (let row = 0; row < 10; row++) expect(t.toDisplay(15, row).row).toBe(15);
    for (let col = 0; col < 16; col++) expect(t.toDisplay(col, 0).col).toBe(9);
  });

  it('picks the rotation that puts the player side at the bottom', () => {
    expect(rotationForPlayerSide([{ col: 0 }, { col: 2 }], 16)).toBe('ccw');
    expect(rotationForPlayerSide([{ col: 14 }, { col: 15 }], 16)).toBe('cw');
    expect(rotationForPlayerSide([], 16)).toBe('ccw');
  });

  it('displayLayout reindexes terrain by drawn cell', () => {
    const layout = [
      [0, 1, 2],
      [3, 4, 5],
    ];
    const t = createBoardTransform(3, 2, 'ccw');
    const out = displayLayout(layout, t);
    expect(out.length).toBe(3);
    expect(out[0].length).toBe(2);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const d = t.toDisplay(col, row);
        expect(out[d.row][d.col]).toBe(layout[row][col]);
      }
    }
    expect(displayLayout(layout, createBoardTransform(3, 2, 'none'))).toBe(layout);
  });
});

function mockScene() {
  const obj = () => ({
    setDepth() {
      return this;
    },
    setDisplaySize() {
      return this;
    },
    destroy() {},
  });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: obj, image: obj },
    textures: { exists: () => false },
  };
}

describe('Grid presentation rotation', () => {
  const terrain = [{ name: 'Plain', moveCost: { Infantry: '1' }, avoidBonus: 0, defBonus: 0 }];
  const layout = Array.from({ length: 10 }, () => Array(16).fill(0));

  it('an unrotated grid keeps its historical pixel mapping', () => {
    const grid = new Grid(mockScene(), 16, 10, terrain, layout);
    expect(grid.mapPixelWidth).toBe(16 * TILE_SIZE);
    expect(grid.gridToPixel(3, 4)).toEqual({
      x: grid.offsetX + 3 * TILE_SIZE + TILE_SIZE / 2,
      y: grid.offsetY + 4 * TILE_SIZE + TILE_SIZE / 2,
    });
  });

  it('taps on a rotated board resolve to the drawn cell for every tile', () => {
    const grid = new Grid(mockScene(), 16, 10, terrain, layout, false, null, {
      rotation: 'ccw',
    });
    expect([grid.mapPixelWidth, grid.mapPixelHeight]).toEqual([10 * TILE_SIZE, 16 * TILE_SIZE]);
    for (const { col, row } of allCells(16, 10)) {
      const { x, y } = grid.gridToPixel(col, row);
      expect(grid.pixelToGrid(x, y)).toEqual({ col, row });
      // Tile edges: anywhere inside the drawn square selects the same tile.
      expect(grid.pixelToGrid(x - TILE_SIZE / 2, y - TILE_SIZE / 2)).toEqual({ col, row });
      expect(grid.pixelToGrid(x + TILE_SIZE / 2 - 0.01, y + TILE_SIZE / 2 - 0.01)).toEqual({
        col,
        row,
      });
    }
    // Outside the drawn board (camera padding) is never a tile.
    expect(grid.pixelToGrid(grid.offsetX - 1, grid.offsetY + 5)).toBeNull();
    expect(grid.pixelToGrid(grid.offsetX + grid.mapPixelWidth, grid.offsetY + 5)).toBeNull();
    expect(grid.pixelToGrid(grid.offsetX + 5, grid.offsetY + grid.mapPixelHeight)).toBeNull();
  });

  it('keeps movement rules in game coordinates', () => {
    const plain = new Grid(mockScene(), 16, 10, terrain, layout);
    const turned = new Grid(mockScene(), 16, 10, terrain, layout, false, null, {
      rotation: 'ccw',
    });
    const a = [...plain.getMovementRange(4, 5, 5, 'Infantry').keys()].sort();
    const b = [...turned.getMovementRange(4, 5, 5, 'Infantry').keys()].sort();
    expect(b).toEqual(a);
  });

  it('reports the right-edge side in drawn space', () => {
    const turned = new Grid(mockScene(), 16, 10, terrain, layout, false, null, {
      rotation: 'ccw',
    });
    // Row 9 (bottom edge of the game map) is drawn along the right edge.
    expect(turned.isNearDisplayRightEdge(0, 9)).toBe(true);
    expect(turned.isNearDisplayRightEdge(15, 0)).toBe(false);
  });
});
