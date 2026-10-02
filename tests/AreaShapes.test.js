// AreaShapes: the tiles an area art covers. Expected tile lists are written out by hand
// from the board drawings in each test, never produced by the module under test.
import { describe, expect, it } from 'vitest';
import {
  aroundTiles,
  areaTilesFor,
  centerTiles,
  lineTiles,
  radiusTiles,
  unitsOnTiles,
} from '../src/engine/AreaShapes.js';

const board = (cols = 6, rows = 6, walls = []) => ({
  cols,
  rows,
  isSolid: (col, row) => walls.some(([c, r]) => c === col && r === row),
});
const pairs = (tiles) => tiles.map((t) => [t.col, t.row]);

describe('radius and around', () => {
  it('a radius-1 diamond is the center then its four neighbours, row-major', () => {
    expect(pairs(radiusTiles({ col: 2, row: 2 }, 1, board()))).toEqual([
      [2, 2],
      [2, 1],
      [1, 2],
      [3, 2],
      [2, 3],
    ]);
  });

  it('radius 2 has 13 tiles, nearest first', () => {
    const tiles = pairs(radiusTiles({ col: 3, row: 3 }, 2, board(7, 7)));
    expect(tiles).toHaveLength(13);
    expect(tiles.slice(0, 5)).toEqual([
      [3, 3],
      [3, 2],
      [2, 3],
      [4, 3],
      [3, 4],
    ]);
    // Distance-2 ring, row by row: (3,1) / (2,2),(4,2) / (1,3),(5,3) / (2,4),(4,4) / (3,5)
    expect(tiles.slice(5)).toEqual([
      [3, 1],
      [2, 2],
      [4, 2],
      [1, 3],
      [5, 3],
      [2, 4],
      [4, 4],
      [3, 5],
    ]);
  });

  it('clips at the board corner without wrapping', () => {
    expect(pairs(radiusTiles({ col: 0, row: 0 }, 1, board()))).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    expect(pairs(radiusTiles({ col: 5, row: 5 }, 1, board()))).toEqual([
      [5, 5],
      [5, 4],
      [4, 5],
    ]);
  });

  it('around leaves the origin out', () => {
    expect(pairs(aroundTiles({ col: 1, row: 1 }, 1, board()))).toEqual([
      [1, 0],
      [0, 1],
      [2, 1],
      [1, 2],
    ]);
  });

  it('center tiles honour the minimum range', () => {
    const tiles = pairs(centerTiles({ col: 2, row: 2 }, { min: 2, max: 2 }, board()));
    expect(tiles).toEqual([
      [2, 0],
      [1, 1],
      [3, 1],
      [0, 2],
      [4, 2],
      [1, 3],
      [3, 3],
      [2, 4],
    ]);
  });
});

describe('line', () => {
  it('continues past the target along a row, away from the attacker', () => {
    expect(pairs(lineTiles({ col: 0, row: 2 }, { col: 2, row: 2 }, 2, board()))).toEqual([
      [3, 2],
      [4, 2],
    ]);
    expect(pairs(lineTiles({ col: 3, row: 5 }, { col: 3, row: 4 }, 2, board()))).toEqual([
      [3, 3],
      [3, 2],
    ]);
  });

  it('is empty off a row or column (no diagonal lines)', () => {
    expect(lineTiles({ col: 0, row: 0 }, { col: 1, row: 1 }, 2, board())).toEqual([]);
    expect(lineTiles({ col: 0, row: 0 }, { col: 2, row: 1 }, 2, board())).toEqual([]);
    expect(lineTiles({ col: 1, row: 1 }, { col: 1, row: 1 }, 2, board())).toEqual([]);
  });

  it('stops before a wall and at the edge', () => {
    expect(
      pairs(lineTiles({ col: 0, row: 0 }, { col: 1, row: 0 }, 3, board(6, 6, [[3, 0]]))),
    ).toEqual([[2, 0]]);
    expect(pairs(lineTiles({ col: 3, row: 0 }, { col: 4, row: 0 }, 3, board()))).toEqual([[5, 0]]);
  });

  it('never covers a tile between the attacker and the target', () => {
    const tiles = pairs(lineTiles({ col: 0, row: 1 }, { col: 2, row: 1 }, 2, board()));
    expect(tiles).not.toContainEqual([1, 1]);
  });
});

describe('units on tiles', () => {
  const at = (name, col, row, extra = {}) => ({ name, col, row, ...extra });

  it('returns units in tile order, each once', () => {
    const tiles = radiusTiles({ col: 2, row: 2 }, 1, board());
    const south = at('S', 2, 3);
    const north = at('N', 2, 1);
    const far = at('Far', 5, 5);
    expect(unitsOnTiles(tiles, [south, far, north]).map((u) => u.name)).toEqual(['N', 'S']);
  });

  it('counts an Entity once when any footprint tile is covered, and excludes by identity', () => {
    // A 3x3 Entity anchored at (3,3) covers (3..5, 3..5).
    const entity = at('Entity', 3, 3, { isEntity: true });
    const tiles = [
      { col: 4, row: 4 },
      { col: 3, row: 5 },
    ];
    expect(unitsOnTiles(tiles, [entity])).toEqual([entity]);
    expect(unitsOnTiles(tiles, [entity], { exclude: entity })).toEqual([]);
  });
});

describe('areaTilesFor', () => {
  const attacker = { col: 1, row: 2 };
  const target = { col: 2, row: 2 };
  it('dispatches each shape from the right origin', () => {
    expect(
      pairs(areaTilesFor({ shape: 'line', length: 1 }, { attacker, target }, board())),
    ).toEqual([[3, 2]]);
    expect(
      areaTilesFor({ shape: 'around_attacker', radius: 1 }, { attacker, target }, board()),
    ).toHaveLength(4);
    expect(
      pairs(areaTilesFor({ shape: 'radius', radius: 0 }, { center: { col: 4, row: 4 } }, board())),
    ).toEqual([[4, 4]]);
    expect(areaTilesFor({ shape: 'cone' }, { attacker, target }, board())).toEqual([]);
  });
});
