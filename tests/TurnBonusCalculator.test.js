import { describe, it, expect } from 'vitest';
import {
  calculatePar,
  getRating,
  calculateBonusGold,
  getLatePressureState,
  isBossEnrageActive,
  getParXpMultiplier,
  formatParTooltip,
} from '../src/engine/TurnBonusCalculator.js';
import { loadGameData } from './testData.js';
import { GOLD_PAR_BONUS_MULTIPLIER } from '../src/utils/constants.js';
import { calculateKillGold, calculateBattleGold } from '../src/engine/LootSystem.js';

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
gameData.terrain.forEach((t, i) => {
  TERRAIN_INDEX[t.name] = i;
});

describe('TurnBonusCalculator', () => {
  describe('calculatePar', () => {
    it('calculates par for a small rout map with some difficult terrain', () => {
      // 8×6 = 48 tiles, 6 enemies, ~15% difficult (7 forest tiles)
      const layout = makeMapLayout(8, 6, TERRAIN_INDEX.Plain);
      // Scatter 7 forest tiles (~14.6%)
      const forestIdx = TERRAIN_INDEX.Forest;
      layout[0][0] = forestIdx;
      layout[0][3] = forestIdx;
      layout[1][1] = forestIdx;
      layout[2][5] = forestIdx;
      layout[3][2] = forestIdx;
      layout[4][7] = forestIdx;
      layout[5][4] = forestIdx;

      const par = calculatePar(
        makeMapParams({
          cols: 8,
          rows: 6,
          enemyCount: 6,
          objective: 'rout',
          mapLayout: layout,
        }),
        config,
      );

      // basePar=2 + 6*0.6=3.6 + 48*0.01=0.48 + (7/48)*1.0=0.146 + adj=0 = 6.226 → ceil*0.8 = 5 + inflation 3 = 8
      expect(par).toBe(8);
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
          if ((r + c) % 4 === 0) {
            layout[r][c] = forestIdx;
            placed++;
          }
        }
      }
      placed = 0;
      for (let r = 0; r < 10 && placed < 10; r++) {
        for (let c = 0; c < 12 && placed < 10; c++) {
          if ((r + c) % 6 === 1 && layout[r][c] === TERRAIN_INDEX.Plain) {
            layout[r][c] = mtnIdx;
            placed++;
          }
        }
      }
      // Count actual difficult
      const difficultSet = new Set(config.difficultTerrainTypes);
      let diffCount = 0;
      for (const row of layout)
        for (const idx of row) {
          if (difficultSet.has(gameData.terrain[idx].name)) diffCount++;
        }

      const par = calculatePar(
        makeMapParams({
          cols: 12,
          rows: 10,
          enemyCount: 14,
          objective: 'seize',
          mapLayout: layout,
        }),
        config,
      );

      // sqrt scaling: min(14*0.6=8.4, sqrt(14)*1.3≈4.86) = 4.86
      const linearPenalty = 14 * 0.6;
      const sqrtPenalty = Math.sqrt(14) * 1.3;
      const enemyPenalty = Math.min(linearPenalty, sqrtPenalty);
      const expected = Math.ceil((4 + enemyPenalty + 1.2 + (diffCount / 120) * 1.0 + 1) * 0.8) + 3;
      expect(par).toBe(expected);
    });

    it('returns null for unknown objective types', () => {
      expect(calculatePar(makeMapParams({ objective: 'defend' }), config)).toBeNull();
      expect(calculatePar(makeMapParams({ objective: 'survive' }), config)).toBeNull();
    });

    it('handles 0 enemies', () => {
      const par = calculatePar(
        makeMapParams({
          cols: 8,
          rows: 6,
          enemyCount: 0,
          objective: 'rout',
        }),
        config,
      );
      // basePar=2 + 0 + 48*0.01=0.48 + 0 + adj=0 = 2.48 → ceil*0.8 = 2 + inflation 3 = 5
      expect(par).toBe(5);
    });

    // Phase 4.1 — indoor/hazard terrain now contributes to par.
    it('counts Pillar as difficult terrain (indoor maps)', () => {
      expect(config.difficultTerrainTypes).toContain('Pillar');
      const cols = 8;
      const rows = 6;
      const plain = makeMapLayout(cols, rows, TERRAIN_INDEX.Plain);
      const pillared = makeMapLayout(cols, rows, TERRAIN_INDEX.Plain);
      // Sprinkle 12 Pillar tiles (25% of the map)
      let placed = 0;
      for (let r = 0; r < rows && placed < 12; r++) {
        for (let c = 0; c < cols && placed < 12; c++) {
          if ((r * cols + c) % 4 === 0) {
            pillared[r][c] = TERRAIN_INDEX.Pillar;
            placed++;
          }
        }
      }
      const base = { cols, rows, enemyCount: 8, objective: 'rout' };
      const plainPar = calculatePar(makeMapParams({ ...base, mapLayout: plain }), config);
      const pillarPar = calculatePar(makeMapParams({ ...base, mapLayout: pillared }), config);
      expect(pillarPar).toBeGreaterThanOrEqual(plainPar);
    });

    it('applies template parBonus on top of terrain penalty', () => {
      const base = makeMapParams({ cols: 10, rows: 8, enemyCount: 10, objective: 'rout' });
      const noBonus = calculatePar(base, config);
      const withBonus = calculatePar({ ...base, parBonus: 2 }, config);
      expect(withBonus).toBe(noBonus + 2);
    });

    it('handles all difficult terrain', () => {
      const par = calculatePar(
        makeMapParams({
          cols: 4,
          rows: 4,
          enemyCount: 2,
          objective: 'rout',
          fillIndex: TERRAIN_INDEX.Forest,
        }),
        config,
      );
      // basePar=2 + 2*0.6=1.2 + 16*0.01=0.16 + 1.0*1.0=1.0 + adj=0 = 4.36 → ceil*0.8 = 4 + inflation 3 = 7
      expect(par).toBe(7);
    });

    it('handles minimal map (1x1)', () => {
      const par = calculatePar(
        makeMapParams({
          cols: 1,
          rows: 1,
          enemyCount: 1,
          objective: 'rout',
        }),
        config,
      );
      // basePar=2 + 1*0.6=0.6 + 1*0.01=0.01 + 0 + adj=0 = 2.61 → ceil*0.8 = 3 + inflation 3 = 6
      expect(par).toBe(6);
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
      const par = calculatePar(
        {
          cols: 8,
          rows: 6,
          enemyCount: 4,
          objective: 'rout',
          mapLayout: null,
          terrainData: null,
        },
        config,
      );
      // basePar=2 + 4*0.6=2.4 + 48*0.01=0.48 + 0 + adj=0 = 4.88 → ceil*0.8 = 4 + inflation 3 = 7
      expect(par).toBe(7);
    });
  });

  describe('difficulty par scaling (Q6)', () => {
    it('normal difficulty returns unchanged par', () => {
      const par = calculatePar(
        makeMapParams({ cols: 8, rows: 6, enemyCount: 6, objective: 'rout' }),
        config,
        'normal',
      );
      const parDefault = calculatePar(
        makeMapParams({ cols: 8, rows: 6, enemyCount: 6, objective: 'rout' }),
        config,
      );
      expect(par).toBe(parDefault);
    });

    it('hard difficulty (0.85) tightens par (inflation is post-scale)', () => {
      const params = makeMapParams({ cols: 8, rows: 6, enemyCount: 6, objective: 'rout' });
      const normalPar = calculatePar(params, config, 'normal');
      const hardPar = calculatePar(params, config, 'hard');
      const inflation = config.parInflation || 0;
      // Inflation added after scaling: floor((rawPar) * 0.85) + inflation
      expect(hardPar).toBe(Math.max(1, Math.floor((normalPar - inflation) * 0.85)) + inflation);
      expect(hardPar).toBeLessThan(normalPar);
    });

    it('lunatic difficulty (0.8) tightens par more than hard', () => {
      const params = makeMapParams({ cols: 10, rows: 8, enemyCount: 8, objective: 'rout' });
      const hardPar = calculatePar(params, config, 'hard');
      const lunaticPar = calculatePar(params, config, 'lunatic');
      expect(lunaticPar).toBeLessThanOrEqual(hardPar);
    });

    it('par never goes below 1', () => {
      // Tiny map with 0 enemies → small par, should still be >= 1 after scaling
      const params = makeMapParams({ cols: 1, rows: 1, enemyCount: 0, objective: 'rout' });
      const lunaticPar = calculatePar(params, config, 'lunatic');
      expect(lunaticPar).toBeGreaterThanOrEqual(1);
    });

    it('unknown difficulty ID returns unchanged par', () => {
      const params = makeMapParams({ cols: 8, rows: 6, enemyCount: 6, objective: 'rout' });
      const unknownPar = calculatePar(params, config, 'nightmare');
      const normalPar = calculatePar(params, config, 'normal');
      expect(unknownPar).toBe(normalPar);
    });
  });

  describe('getRating', () => {
    it('returns A when at par (turnsOver=0, A threshold=0)', () => {
      const result = getRating(10, 10, config);
      expect(result.rating).toBe('A');
      expect(result.bonusMultiplier).toBe(0.6);
    });

    it('returns S when 3+ turns under par (turnsOver=-3)', () => {
      const result = getRating(7, 10, config);
      expect(result.rating).toBe('S');
      expect(result.bonusMultiplier).toBe(1.0);
    });

    it('returns B when 1 turn over par (turnsOver=1, B threshold=3)', () => {
      const result = getRating(11, 10, config);
      expect(result.rating).toBe('B');
      expect(result.bonusMultiplier).toBe(0.25);
    });

    it('returns B when 3 turns over par', () => {
      const result = getRating(13, 10, config);
      expect(result.rating).toBe('B');
      expect(result.bonusMultiplier).toBe(0.25);
    });

    it('returns C when 4 turns over par', () => {
      const result = getRating(14, 10, config);
      expect(result.rating).toBe('C');
      expect(result.bonusMultiplier).toBe(0.0);
    });

    it('returns C when 6 turns over par', () => {
      const result = getRating(16, 10, config);
      expect(result.rating).toBe('C');
      expect(result.bonusMultiplier).toBe(0.0);
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

  describe('late pressure', () => {
    it('does not activate at par + 2', () => {
      const pressure = getLatePressureState(12, 10, config);
      expect(pressure.active).toBe(false);
      expect(pressure.xpMultiplier).toBe(1.0);
      expect(pressure.goldMultiplier).toBe(1.0);
    });

    it('activates at par + 3 with first penalty step', () => {
      const pressure = getLatePressureState(13, 10, config);
      expect(pressure.active).toBe(true);
      expect(pressure.step).toBe(1);
      expect(pressure.xpMultiplier).toBe(0.7);
      expect(pressure.goldMultiplier).toBe(0.8);
    });

    it('advances one step every 2 turns over the start threshold', () => {
      const step1 = getLatePressureState(14, 10, config);
      const step2 = getLatePressureState(15, 10, config);
      expect(step1.step).toBe(1);
      expect(step1.xpMultiplier).toBe(0.7);
      expect(step2.step).toBe(2);
      expect(step2.xpMultiplier).toBe(0.5);
      expect(step2.goldMultiplier).toBe(0.6);
    });

    it('clamps to configured floor multipliers', () => {
      const pressure = getLatePressureState(80, 10, config);
      expect(pressure.xpMultiplier).toBe(0.1);
      expect(pressure.goldMultiplier).toBe(0.1);
    });

    it('stays neutral when par is unavailable', () => {
      const pressure = getLatePressureState(20, null, config);
      expect(pressure.active).toBe(false);
      expect(pressure.xpMultiplier).toBe(1.0);
      expect(pressure.goldMultiplier).toBe(1.0);
    });
  });

  describe('boss enrage timing', () => {
    it('uses min(absolute turn, par + offset) when par is present', () => {
      // bossEnrageOverPar=2: min(12, 3+2=5) → enrage at turn 5
      expect(isBossEnrageActive(4, 3, config)).toBe(false);
      expect(isBossEnrageActive(5, 3, config)).toBe(true);
      // min(12, 10+2=12) → enrage at turn 12
      expect(isBossEnrageActive(11, 10, config)).toBe(false);
      expect(isBossEnrageActive(12, 10, config)).toBe(true);
    });

    it('falls back to absolute enrage turn when par is unavailable', () => {
      expect(isBossEnrageActive(11, null, config)).toBe(false);
      expect(isBossEnrageActive(12, null, config)).toBe(true);
    });
  });

  describe('calculateBonusGold', () => {
    it('returns full bonus for S rating in act1', () => {
      const rating = { rating: 'S', bonusMultiplier: 1.0 };
      expect(calculateBonusGold(rating, 'act1', config)).toBe(
        Math.floor(150 * GOLD_PAR_BONUS_MULTIPLIER),
      );
    });

    it('returns 60% bonus for A rating in act2', () => {
      const rating = { rating: 'A', bonusMultiplier: 0.6 };
      expect(calculateBonusGold(rating, 'act2', config)).toBe(
        Math.floor(300 * 0.6 * GOLD_PAR_BONUS_MULTIPLIER),
      );
    });

    it('returns 25% bonus for B rating in act3', () => {
      const rating = { rating: 'B', bonusMultiplier: 0.25 };
      expect(calculateBonusGold(rating, 'act3', config)).toBe(
        Math.floor(500 * 0.25 * GOLD_PAR_BONUS_MULTIPLIER),
      );
    });

    it('returns 0 bonus for C rating', () => {
      const rating = { rating: 'C', bonusMultiplier: 0.0 };
      expect(calculateBonusGold(rating, 'act1', config)).toBe(0);
      expect(calculateBonusGold(rating, 'act3', config)).toBe(0);
    });

    it('returns full bonus for S rating in finalBoss', () => {
      const rating = { rating: 'S', bonusMultiplier: 1.0 };
      expect(calculateBonusGold(rating, 'finalBoss', config)).toBe(
        Math.floor(900 * GOLD_PAR_BONUS_MULTIPLIER),
      );
    });

    it('returns full bonus for S rating in act4', () => {
      const rating = { rating: 'S', bonusMultiplier: 1.0 };
      expect(calculateBonusGold(rating, 'act4', config)).toBe(
        Math.floor(700 * GOLD_PAR_BONUS_MULTIPLIER),
      );
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
      const act4 = calculateBonusGold(rating, 'act4', config);
      const boss = calculateBonusGold(rating, 'finalBoss', config);
      expect(act1).toBeLessThan(act2);
      expect(act2).toBeLessThan(act3);
      expect(act3).toBeLessThan(act4);
      expect(act4).toBeLessThan(boss);
    });
  });

  describe('integration: par → rating → gold', () => {
    it('calculates end-to-end bonus for a battle', () => {
      const par = calculatePar(
        makeMapParams({
          cols: 10,
          rows: 8,
          enemyCount: 5,
          objective: 'rout',
        }),
        config,
      );
      expect(par).toBeGreaterThan(0);

      // Clear at par → A rank (turnsOver=0, A threshold=0)
      const aRating = getRating(par, par, config);
      expect(aRating.rating).toBe('A');
      const aGold = calculateBonusGold(aRating, 'act2', config);
      expect(aGold).toBe(Math.floor(300 * 0.6 * GOLD_PAR_BONUS_MULTIPLIER));

      // Clear 4 turns over → C rank (turnsOver=4, C threshold=999)
      const cRating = getRating(par + 4, par, config);
      expect(cRating.rating).toBe('C');
      const cGold = calculateBonusGold(cRating, 'act2', config);
      expect(cGold).toBe(0);
    });
  });

  describe('payout matrix: par bonus as share of total battle gold', () => {
    // Deterministic validation that par bonuses represent ~50% of S-rank gold
    // and that S-rank earns meaningfully more than C-rank.
    const scenarios = [
      { act: 'act1', enemies: 6, level: 2 },
      { act: 'act2', enemies: 8, level: 6 },
      { act: 'act3', enemies: 10, level: 10 },
      { act: 'act4', enemies: 12, level: 14 },
      { act: 'finalBoss', enemies: 15, level: 18 },
    ];

    for (const { act, enemies, level } of scenarios) {
      it(`${act}: S-rank par bonus is 40-60% of total and S/C ratio >= 1.7×`, () => {
        // Compute kill gold for N enemies at given level
        let killGold = 0;
        for (let i = 0; i < enemies; i++) {
          killGold += calculateKillGold({ level, isBoss: false });
        }
        const baseGold = calculateBattleGold(killGold, 'battle');

        // S-rank par bonus
        const sRating = { rating: 'S', bonusMultiplier: 1.0 };
        const sParBonus = calculateBonusGold(sRating, act, config);
        const sTotal = baseGold + sParBonus;

        // C-rank: no par bonus
        const cTotal = baseGold;

        const parShare = sParBonus / sTotal;
        const scRatio = sTotal / cTotal;

        // Par bonus should be 40-60% of S-rank total
        expect(parShare).toBeGreaterThanOrEqual(0.4);
        expect(parShare).toBeLessThanOrEqual(0.6);

        // S-rank should earn at least 1.7× what C-rank earns
        expect(scRatio).toBeGreaterThanOrEqual(1.7);
      });
    }
  });

  describe('sqrt enemy scaling (min of linear and sqrt)', () => {
    it('uses linear penalty for small enemy counts (≤4)', () => {
      // 3 enemies: linear=1.8, sqrt=sqrt(3)*1.3≈2.25 → min=1.8 (linear)
      const par3 = calculatePar(
        makeMapParams({ cols: 8, rows: 6, enemyCount: 3, objective: 'rout' }),
        config,
      );
      // Same config without sqrt: enemyPenalty=1.8 either way
      const noSqrtConfig = { ...config };
      delete noSqrtConfig.enemyScaling;
      const par3Linear = calculatePar(
        makeMapParams({ cols: 8, rows: 6, enemyCount: 3, objective: 'rout' }),
        noSqrtConfig,
      );
      expect(par3).toBe(par3Linear);
    });

    it('uses sqrt penalty for larger enemy counts', () => {
      // 12 enemies: linear=7.2, sqrt=sqrt(12)*1.3≈4.50 → min=4.50 (sqrt wins)
      const par12 = calculatePar(
        makeMapParams({ cols: 12, rows: 10, enemyCount: 12, objective: 'rout' }),
        config,
      );
      const noSqrtConfig = { ...config };
      delete noSqrtConfig.enemyScaling;
      const par12Linear = calculatePar(
        makeMapParams({ cols: 12, rows: 10, enemyCount: 12, objective: 'rout' }),
        noSqrtConfig,
      );
      expect(par12).toBeLessThan(par12Linear);
    });

    it('never increases par compared to linear-only scaling', () => {
      const noSqrtConfig = { ...config };
      delete noSqrtConfig.enemyScaling;
      for (const count of [1, 2, 3, 4, 5, 8, 12, 15, 20]) {
        const params = makeMapParams({ cols: 10, rows: 8, enemyCount: count, objective: 'rout' });
        const sqrtPar = calculatePar(params, config);
        const linearPar = calculatePar(params, noSqrtConfig);
        expect(sqrtPar).toBeLessThanOrEqual(linearPar);
      }
    });

    it('compresses par significantly for 15 enemies', () => {
      // 15 enemies: linear=9.0, sqrt=sqrt(15)*1.3≈5.03 → saves ~4 turns of penalty
      const par15 = calculatePar(
        makeMapParams({ cols: 13, rows: 20, enemyCount: 15, objective: 'seize' }),
        config,
      );
      const noSqrtConfig = { ...config };
      delete noSqrtConfig.enemyScaling;
      const par15Linear = calculatePar(
        makeMapParams({ cols: 13, rows: 20, enemyCount: 15, objective: 'seize' }),
        noSqrtConfig,
      );
      expect(par15Linear - par15).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getParXpMultiplier', () => {
    it('returns S-rank multiplier when 3+ under par', () => {
      expect(getParXpMultiplier(2, 5, config)).toBe(1.25);
    });

    it('returns A-rank multiplier when at par (turnsOver=0)', () => {
      expect(getParXpMultiplier(5, 5, config)).toBe(1.1);
    });

    it('returns B-rank multiplier when 1-3 turns over par', () => {
      expect(getParXpMultiplier(8, 5, config)).toBe(1.0);
    });

    it('returns C-rank multiplier when 4+ turns over par', () => {
      expect(getParXpMultiplier(10, 5, config)).toBe(0.9);
    });

    it('returns 1 when config has no parXpMultipliers', () => {
      const noXpConfig = { ...config };
      delete noXpConfig.parXpMultipliers;
      expect(getParXpMultiplier(5, 5, noXpConfig)).toBe(1);
    });

    it('returns 1 when par is null or NaN', () => {
      expect(getParXpMultiplier(5, null, config)).toBe(1);
      expect(getParXpMultiplier(5, NaN, config)).toBe(1);
    });

    it('returns 1 when config is null', () => {
      expect(getParXpMultiplier(5, 5, null)).toBe(1);
    });
  });

  describe('formatParTooltip', () => {
    it('shows A-rank values without pressure line when under par', () => {
      // turnsOver = 3-5 = -2, A threshold=0 → A-rank
      const text = formatParTooltip(3, 5, config);
      expect(text).toBe('A-rank \u00b7 XP \u00d71.10 \u00b7 Par Gold \u00d70.60');
      expect(text).not.toContain('Late');
    });

    it('shows C-rank values without pressure when config suppresses pressure', () => {
      // Default config: C-rank at >6 over, pressure at >5 over → always overlap.
      // Use custom config with high startOverPar to isolate C-rank without pressure.
      const noPressureConfig = {
        ...config,
        latePressure: { ...config.latePressure, startOverPar: 999 },
      };
      const text = formatParTooltip(15, 5, noPressureConfig);
      expect(text).toBe('C-rank \u00b7 XP \u00d70.90 \u00b7 Par Gold \u00d70.00');
      expect(text).not.toContain('Late');
    });

    it('shows two-line output with effective combined multipliers under pressure', () => {
      // turn 20, par 5 → 15 over → C-rank + pressure active
      const text = formatParTooltip(20, 5, config);
      const lines = text.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('C-rank \u00b7 XP \u00d70.90 \u00b7 Par Gold \u00d70.00');
      // Pressure step: ceil((15-2)/2) = 7 → clamped to idx 5 → xpMult=0.1, goldMult=0.1
      // eff XP: 0.90*0.1=0.09, eff gold: 0.00*0.1=0.00, kill gold: 0.10
      expect(lines[1]).toContain('eff XP');
      expect(lines[1]).toContain('kill gold');
      expect(lines[1]).toContain('0.10');
    });

    it('returns null when config is missing', () => {
      expect(formatParTooltip(5, 5, null)).toBeNull();
      expect(formatParTooltip(5, 5, undefined)).toBeNull();
    });

    it('returns null when par is not finite', () => {
      expect(formatParTooltip(5, null, config)).toBeNull();
      expect(formatParTooltip(5, NaN, config)).toBeNull();
      expect(formatParTooltip(5, Infinity, config)).toBeNull();
    });
  });
});
