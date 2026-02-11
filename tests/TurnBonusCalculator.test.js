import { describe, it, expect } from 'vitest';
import { calculatePar, getRating, calculateBonusGold } from '../src/engine/TurnBonusCalculator.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const config = gameData.turnBonus;

// Helper: build a mapLayout filled with a single terrain index
function makeMapLayout(cols, rows, fillIndex = 0) {
  return Array.from({ length: rows }, () => Array(cols).fill(fillIndex));
}

// Helper: build mapParams with defaults
function makeMapParams(overrides = {}) {
  const cols = overrides.cols || 8;
  const rows = overrides.rows || 6;
  const terrainData = overrides.terrainData || gameData.terrain;
  const fillIndex = overrides.fillIndex != null ? overrides.fillIndex : 0; // Plain
  return {
    cols,
    rows,
    enemyCount: overrides.enemyCount || 0,
    objective: overrides.objective || 'rout',
    mapLayout: overrides.mapLayout || makeMapLayout(cols, rows, fillIndex),
    terrainData,
    ...overrides,
  };
}

// Terrain index lookup from terrain.json
const TERRAIN_INDEX = {};
gameData.terrain.forEach((t, i) => { TERRAIN_INDEX[t.name] = i; });

describe('TurnBonusCalculator', () => {
  describe('calculatePar', () => {
    it('calculates par for a small rout map with some difficult terrain', () => {
      // 8×6 = 48 tiles, 6 enemies, ~15% difficult (7 forest tiles)
      const layout = makeMapLayout(8, 6, TERRAIN_INDEX.Plain);
      // Scatter 7 forest tiles (~14.6%)
      const forestIdx = TERRAIN_INDEX.Forest;
      layout[0][0] = forestIdx; layout[0][3] = forestIdx;
      layout[1][1] = forestIdx; layout[2][5] = forestIdx;
      layout[3][2] = forestIdx; layout[4][7] = forestIdx;
      layout[5][4] = forestIdx;

      const par = calculatePar(makeMapParams({
        cols: 8, rows: 6, enemyCount: 6, objective: 'rout',
        mapLayout: layout,
      }), config);

      // basePar=2 + 6*0.6=3.6 + 48*0.01=0.48 + (7/48)*1.0=0.146 + adj=0 = 6.226 → ceil = 7
      expect(par).toBe(7);
    });

    it('calculates par for a large seize map with difficult terrain', () => {
      // 12×10 = 120 tiles, 14 enemies, 25% difficult (30 tiles)
      const layout = makeMapLayout(12, 10, TERRAIN_INDEX.Plain);
      const forestIdx = TERRAIN_INDEX.Forest;
      const mtnIdx = TERRAIN_INDEX.Mountain;
      // Place 20 forest + 10 mountain = 30 difficult tiles (25%)
      let placed = 0;
      for (let r = 0; r < 10 && placed < 20; r++) {
        for (let c = 0; c < 12 && placed < 20; c++) {
          if ((r + c) % 4 === 0) { layout[r][c] = forestIdx; placed++; }
        }
      }
      placed = 0;
      for (let r = 0; r < 10 && placed < 10; r++) {
        for (let c = 0; c < 12 && placed < 10; c++) {
          if ((r + c) % 6 === 1 && layout[r][c] === TERRAIN_INDEX.Plain) {
            layout[r][c] = mtnIdx; placed++;
          }
        }
      }
      // Count actual difficult
      const difficultSet = new Set(config.difficultTerrainTypes);
      let diffCount = 0;
      for (const row of layout) for (const idx of row) {
        if (difficultSet.has(gameData.terrain[idx].name)) diffCount++;
      }

      const par = calculatePar(makeMapParams({
        cols: 12, rows: 10, enemyCount: 14, objective: 'seize',
        mapLayout: layout,
      }), config);

      // basePar=4 + 14*0.6=8.4 + 120*0.01=1.2 + (diffCount/120)*1.0 + adj=1
      const expected = Math.ceil(4 + 8.4 + 1.2 + (diffCount / 120) * 1.0 + 1);
      expect(par).toBe(expected);
    });

    it('returns null for unknown objective types', () => {
      expect(calculatePar(makeMapParams({ objective: 'defend' }), config)).toBeNull();
      expect(calculatePar(makeMapParams({ objective: 'survive' }), config)).toBeNull();
    });

    it('handles 0 enemies', () => {
      const par = calculatePar(makeMapParams({
        cols: 8, rows: 6, enemyCount: 0, objective: 'rout',
      }), config);
      // basePar=2 + 0 + 48*0.01=0.48 + 0 + adj=0 = 2.48 → ceil = 3
      expect(par).toBe(3);
    });

    it('handles all difficult terrain', () => {
      const par = calculatePar(makeMapParams({
        cols: 4, rows: 4, enemyCount: 2, objective: 'rout',
        fillIndex: TERRAIN_INDEX.Forest,
      }), config);
      // basePar=2 + 2*0.6=1.2 + 16*0.01=0.16 + 1.0*1.0=1.0 + adj=0 = 4.36 → ceil = 5
      expect(par).toBe(5);
    });

    it('handles minimal map (1x1)', () => {
      const par = calculatePar(makeMapParams({
        cols: 1, rows: 1, enemyCount: 1, objective: 'rout',
      }), config);
      // basePar=2 + 1*0.6=0.6 + 1*0.01=0.01 + 0 + adj=0 = 2.61 → ceil = 3
      expect(par).toBe(3);
    });

    it('handles seize objective differently from rout', () => {
      const params = makeMapParams({ cols: 8, rows: 6, enemyCount: 4, objective: 'seize' });
      const parSeize = calculatePar(params, config);

      const paramsRout = makeMapParams({ cols: 8, rows: 6, enemyCount: 4, objective: 'rout' });
      const parRout = calculatePar(paramsRout, config);

      // Seize has higher basePar (4 vs 2) and higher adjustment (1 vs 0)
      expect(parSeize).toBeGreaterThan(parRout);
    });

    it('handles null mapLayout gracefully (no terrain penalty)', () => {
      const par = calculatePar({
        cols: 8, rows: 6, enemyCount: 4, objective: 'rout',
        mapLayout: null, terrainData: null,
      }, config);
      // basePar=2 + 4*0.6=2.4 + 48*0.01=0.48 + 0 + adj=0 = 4.88 → ceil = 5
      expect(par).toBe(5);
    });
  });

  describe('getRating', () => {
    it('returns S when at par', () => {
      const result = getRating(10, 10, config);
      expect(result.rating).toBe('S');
      expect(result.bonusMultiplier).toBe(1.0);
    });

    it('returns S when under par', () => {
      const result = getRating(7, 10, config);
      expect(result.rating).toBe('S');
      expect(result.bonusMultiplier).toBe(1.0);
    });

    it('returns A when 1 turn over par', () => {
      const result = getRating(11, 10, config);
      expect(result.rating).toBe('A');
      expect(result.bonusMultiplier).toBe(0.6);
    });

    it('returns A when 3 turns over par', () => {
      const result = getRating(13, 10, config);
      expect(result.rating).toBe('A');
      expect(result.bonusMultiplier).toBe(0.6);
    });

    it('returns B when 4 turns over par', () => {
      const result = getRating(14, 10, config);
      expect(result.rating).toBe('B');
      expect(result.bonusMultiplier).toBe(0.25);
    });

    it('returns B when 6 turns over par', () => {
      const result = getRating(16, 10, config);
      expect(result.rating).toBe('B');
      expect(result.bonusMultiplier).toBe(0.25);
    });

    it('returns C when 7+ turns over par', () => {
      const result = getRating(17, 10, config);
      expect(result.rating).toBe('C');
      expect(result.bonusMultiplier).toBe(0.0);
    });

    it('returns C when way over par', () => {
      const result = getRating(50, 10, config);
      expect(result.rating).toBe('C');
      expect(result.bonusMultiplier).toBe(0.0);
    });

    it('returns S when way under par', () => {
      const result = getRating(1, 20, config);
      expect(result.rating).toBe('S');
      expect(result.bonusMultiplier).toBe(1.0);
    });
  });

  describe('calculateBonusGold', () => {
    it('returns full bonus for S rating in act1', () => {
      const rating = { rating: 'S', bonusMultiplier: 1.0 };
      expect(calculateBonusGold(rating, 'act1', config)).toBe(100);
    });

    it('returns 60% bonus for A rating in act2', () => {
      const rating = { rating: 'A', bonusMultiplier: 0.6 };
      expect(calculateBonusGold(rating, 'act2', config)).toBe(120);
    });

    it('returns 25% bonus for B rating in act3', () => {
      const rating = { rating: 'B', bonusMultiplier: 0.25 };
      expect(calculateBonusGold(rating, 'act3', config)).toBe(75);
    });

    it('returns 0 bonus for C rating', () => {
      const rating = { rating: 'C', bonusMultiplier: 0.0 };
      expect(calculateBonusGold(rating, 'act1', config)).toBe(0);
      expect(calculateBonusGold(rating, 'act3', config)).toBe(0);
    });

    it('returns full bonus for S rating in finalBoss', () => {
      const rating = { rating: 'S', bonusMultiplier: 1.0 };
      expect(calculateBonusGold(rating, 'finalBoss', config)).toBe(400);
    });

    it('returns 0 for unknown act', () => {
      const rating = { rating: 'S', bonusMultiplier: 1.0 };
      expect(calculateBonusGold(rating, 'act99', config)).toBe(0);
    });

    it('scales with act progression', () => {
      const rating = { rating: 'S', bonusMultiplier: 1.0 };
      const act1 = calculateBonusGold(rating, 'act1', config);
      const act2 = calculateBonusGold(rating, 'act2', config);
      const act3 = calculateBonusGold(rating, 'act3', config);
      const boss = calculateBonusGold(rating, 'finalBoss', config);
      expect(act1).toBeLessThan(act2);
      expect(act2).toBeLessThan(act3);
      expect(act3).toBeLessThan(boss);
    });
  });

  describe('integration: par → rating → gold', () => {
    it('calculates end-to-end bonus for a battle', () => {
      const par = calculatePar(makeMapParams({
        cols: 10, rows: 8, enemyCount: 5, objective: 'rout',
      }), config);
      expect(par).toBeGreaterThan(0);

      // Clear at par → S rank → full gold
      const sRating = getRating(par, par, config);
      expect(sRating.rating).toBe('S');
      const sGold = calculateBonusGold(sRating, 'act2', config);
      expect(sGold).toBe(200);

      // Clear 4 turns over → B rank → 25% gold
      const bRating = getRating(par + 4, par, config);
      expect(bRating.rating).toBe('B');
      const bGold = calculateBonusGold(bRating, 'act2', config);
      expect(bGold).toBe(50);
    });
  });
});
