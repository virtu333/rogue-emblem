// GridParity.test.js — Anti-drift parity tests: HeadlessGrid vs production Grid.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HeadlessGrid } from './HeadlessGrid.js';
import { Grid } from '../../src/engine/Grid.js';
import { generateBattle } from '../../src/engine/MapGenerator.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

// Minimal Phaser scene stub for production Grid
function createMockScene() {
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: {
      rectangle: () => ({ setDepth: () => ({}), destroy: () => {}, setAlpha: () => {} }),
      image: () => ({ setDisplaySize: () => ({}) }),
      text: () => ({ setOrigin: () => ({ setDepth: () => ({}) }) }),
    },
    textures: { exists: () => false },
  };
}

describe('GridParity', () => {
  let gameData;

  beforeEach(() => {
    gameData = loadGameData();
    installSeed(99999);
  });

  afterEach(() => {
    restoreMathRandom();
  });

  function createGridPair() {
    const bc = generateBattle(
      { act: 'act1', objective: 'rout', row: 2 },
      {
        terrain: gameData.terrain,
        mapSizes: gameData.mapSizes,
        mapTemplates: gameData.mapTemplates,
        enemies: gameData.enemies,
        recruits: gameData.recruits,
        classes: gameData.classes,
        weapons: gameData.weapons,
      }
    );

    const headless = new HeadlessGrid(bc.cols, bc.rows, gameData.terrain, bc.mapLayout);
    const production = new Grid(createMockScene(), bc.cols, bc.rows, gameData.terrain, bc.mapLayout);
    return { headless, production, bc };
  }

  it('getTerrainAt matches for all tiles', () => {
    const { headless, production, bc } = createGridPair();
    for (let r = 0; r < bc.rows; r++) {
      for (let c = 0; c < bc.cols; c++) {
        const h = headless.getTerrainAt(c, r);
        const p = production.getTerrainAt(c, r);
        expect(h?.name).toBe(p?.name);
      }
    }
  });

  it('getMovementRange matches for sample unit positions', () => {
    const { headless, production, bc } = createGridPair();
    // Test 5 starting positions from player spawns + center of map
    const testPositions = [
      ...bc.playerSpawns.slice(0, 2),
      { col: Math.floor(bc.cols / 2), row: Math.floor(bc.rows / 2) },
    ];

    for (const pos of testPositions) {
      if (pos.col >= bc.cols || pos.row >= bc.rows) continue;
      const hRange = headless.getMovementRange(pos.col, pos.row, 5, 'Infantry');
      const pRange = production.getMovementRange(pos.col, pos.row, 5, 'Infantry');

      // Same reachable tiles
      const hKeys = new Set(hRange.keys());
      const pKeys = new Set(pRange.keys());
      expect(hKeys).toEqual(pKeys);

      // Same costs
      for (const [key, val] of hRange) {
        expect(val.cost).toBe(pRange.get(key).cost);
      }
    }
  });

  it('findPath matches for sample start/goal pairs', () => {
    const { headless, production, bc } = createGridPair();
    const pairs = [];
    if (bc.playerSpawns.length >= 1 && bc.enemySpawns.length >= 1) {
      pairs.push([bc.playerSpawns[0], bc.enemySpawns[0]]);
    }
    if (bc.playerSpawns.length >= 2 && bc.enemySpawns.length >= 2) {
      pairs.push([bc.playerSpawns[1], bc.enemySpawns[1]]);
    }
    // Add a center-to-corner path
    pairs.push([
      { col: Math.floor(bc.cols / 2), row: Math.floor(bc.rows / 2) },
      { col: 0, row: 0 },
    ]);

    for (const [start, goal] of pairs) {
      const hPath = headless.findPath(start.col, start.row, goal.col, goal.row, 'Infantry');
      const pPath = production.findPath(start.col, start.row, goal.col, goal.row, 'Infantry');

      if (hPath === null) {
        expect(pPath).toBeNull();
      } else {
        expect(pPath).not.toBeNull();
        // Paths should have same length and same endpoint
        expect(hPath.length).toBe(pPath.length);
        expect(hPath[hPath.length - 1]).toEqual(pPath[pPath.length - 1]);
      }
    }
  });

  it('getAttackRange matches for sample weapon', () => {
    const { headless, production, bc } = createGridPair();
    const weapon = { range: '1-2' };
    const col = Math.floor(bc.cols / 2);
    const row = Math.floor(bc.rows / 2);

    const hTiles = headless.getAttackRange(col, row, weapon);
    const pTiles = production.getAttackRange(col, row, weapon);

    const hSet = new Set(hTiles.map(t => `${t.col},${t.row}`));
    const pSet = new Set(pTiles.map(t => `${t.col},${t.row}`));
    expect(hSet).toEqual(pSet);
  });
});
