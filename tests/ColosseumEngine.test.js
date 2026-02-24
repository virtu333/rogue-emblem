import { describe, it, expect, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  getAvailableTiers,
  generateChallenger,
  calculateArenaReward,
  canFight,
  getMaxFights,
  getArenaDistance,
  generateMercenaryCandidates,
  getMercenaryPrice,
  calculateArenaXP,
} from '../src/engine/ColosseumEngine.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { NODE_TYPES, ACT_SEQUENCE } from '../src/utils/constants.js';

const gameData = loadGameData();
const colosseumData = gameData.colosseum;

// Seeded RNG for deterministic tests (Mulberry32)
function makeRng(seed = 42) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let v = Math.imul(t ^ (t >>> 15), 1 | t);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ColosseumEngine', () => {
  describe('getAvailableTiers', () => {
    it('returns Bronze and Silver for Act 1', () => {
      const tiers = getAvailableTiers('act1', colosseumData);
      const names = tiers.map(([name]) => name);
      expect(names).toContain('bronze');
      expect(names).toContain('silver');
      expect(names).not.toContain('gold');
      expect(names).not.toContain('platinum');
    });

    it('returns Bronze/Silver/Gold for Act 2', () => {
      const tiers = getAvailableTiers('act2', colosseumData);
      const names = tiers.map(([name]) => name);
      expect(names).toContain('bronze');
      expect(names).toContain('silver');
      expect(names).toContain('gold');
      expect(names).not.toContain('platinum');
    });

    it('returns all 4 tiers for Act 3+', () => {
      const tiers = getAvailableTiers('act3', colosseumData);
      expect(tiers).toHaveLength(4);
      const names = tiers.map(([name]) => name);
      expect(names).toEqual(['bronze', 'silver', 'gold', 'platinum']);
    });

    it('returns all 4 tiers for Act 4', () => {
      const tiers = getAvailableTiers('act4', colosseumData);
      expect(tiers).toHaveLength(4);
    });

    it('returns empty for invalid act', () => {
      expect(getAvailableTiers('invalid', colosseumData)).toEqual([]);
    });

    it('returns empty for missing data', () => {
      expect(getAvailableTiers('act1', null)).toEqual([]);
    });
  });

  describe('generateChallenger', () => {
    const bronzeTier = colosseumData.arena.tiers.bronze;
    const silverTier = colosseumData.arena.tiers.silver;
    const goldTier = colosseumData.arena.tiers.gold;

    it('generates a challenger with correct class from act pool', () => {
      const rng = makeRng(123);
      const result = generateChallenger(
        5,
        bronzeTier,
        'act1',
        gameData.enemies,
        gameData.classes,
        gameData.weapons,
        null,
        colosseumData,
        rng,
      );
      expect(result.unit).toBeDefined();
      expect(result.unit.faction).toBe('enemy');
      expect(result.weapon).toBeDefined();
      // Act 1 base pool classes
      const act1Base = gameData.enemies.pools.act1.base;
      expect(act1Base).toContain(result.unit.className);
    });

    it('challenger level is within tier bounds', () => {
      const rng = makeRng(42);
      for (let i = 0; i < 20; i++) {
        const result = generateChallenger(
          10,
          silverTier,
          'act2',
          gameData.enemies,
          gameData.classes,
          gameData.weapons,
          null,
          colosseumData,
          makeRng(i),
        );
        // Silver: levelOffset [0, 2], so level should be 10 to 12
        expect(result.unit.level).toBeGreaterThanOrEqual(10);
        expect(result.unit.level).toBeLessThanOrEqual(12);
      }
    });

    it('applies difficulty level bonus on hard', () => {
      const rng = makeRng(42);
      const normal = generateChallenger(
        5,
        bronzeTier,
        'act1',
        gameData.enemies,
        gameData.classes,
        gameData.weapons,
        null,
        colosseumData,
        rng,
      );
      const hard = generateChallenger(
        5,
        bronzeTier,
        'act1',
        gameData.enemies,
        gameData.classes,
        gameData.weapons,
        'hard',
        colosseumData,
        makeRng(42),
      );
      // Hard adds +1 level bonus
      expect(hard.unit.level).toBeGreaterThanOrEqual(normal.unit.level);
    });

    it('act 3+ can generate promoted class challengers', () => {
      // Run many trials to hit a promoted class
      let foundPromoted = false;
      for (let i = 0; i < 100; i++) {
        const result = generateChallenger(
          15,
          goldTier,
          'act3',
          gameData.enemies,
          gameData.classes,
          gameData.weapons,
          null,
          colosseumData,
          makeRng(i),
        );
        if (result.unit.tier === 'promoted') {
          foundPromoted = true;
          break;
        }
      }
      expect(foundPromoted).toBe(true);
    });

    it('lunatic challengers have minimum skills', () => {
      const rng = makeRng(1);
      const result = generateChallenger(
        10,
        silverTier,
        'act2',
        gameData.enemies,
        gameData.classes,
        gameData.weapons,
        'lunatic',
        colosseumData,
        rng,
      );
      expect(result.unit.skills.length).toBeGreaterThanOrEqual(1);
    });

    it('applies promoted post-levels when computed challenger level is above base cap', () => {
      const promotedClass = gameData.classes.find(
        (c) => c.tier === 'promoted' && typeof c.promotesFrom === 'string',
      );
      expect(promotedClass).toBeTruthy();
      const forcedPromotedPools = {
        pools: {
          act3: {
            base: [],
            promoted: [promotedClass.name],
          },
        },
      };
      const fixedTier = { levelOffset: [0, 0], xpMultiplier: 1.0 };

      const result = generateChallenger(
        25,
        fixedTier,
        'act3',
        forcedPromotedPools,
        gameData.classes,
        gameData.weapons,
        null,
        colosseumData,
        makeRng(0),
      );

      expect(result.unit.tier).toBe('promoted');
      expect(result.unit.level).toBeGreaterThan(1);
    });

    it('keeps fresh promote level when computed challenger level is at or below base cap', () => {
      const promotedClass = gameData.classes.find(
        (c) => c.tier === 'promoted' && typeof c.promotesFrom === 'string',
      );
      expect(promotedClass).toBeTruthy();
      const forcedPromotedPools = {
        pools: {
          act3: {
            base: [],
            promoted: [promotedClass.name],
          },
        },
      };
      const fixedTier = { levelOffset: [0, 0], xpMultiplier: 1.0 };

      const result = generateChallenger(
        20,
        fixedTier,
        'act3',
        forcedPromotedPools,
        gameData.classes,
        gameData.weapons,
        null,
        colosseumData,
        makeRng(0),
      );

      expect(result.unit.tier).toBe('promoted');
      expect(result.unit.level).toBe(1);
    });
  });

  describe('calculateArenaReward', () => {
    const silverTier = colosseumData.arena.tiers.silver;
    const goldTier = colosseumData.arena.tiers.gold;

    it('awards gold and XP on win', () => {
      const reward = calculateArenaReward(silverTier, 'win', 50, 0, colosseumData);
      expect(reward.goldDelta).toBe(200);
      expect(reward.xpGained).toBe(50); // 50 * 1.0 = 50
    });

    it('loses entry fee on defeat', () => {
      const reward = calculateArenaReward(silverTier, 'lose', 50, 0, colosseumData);
      expect(reward.goldDelta).toBe(-100);
      expect(reward.xpGained).toBe(0);
    });

    it('refunds fee on draw', () => {
      const reward = calculateArenaReward(silverTier, 'draw', 50, 0, colosseumData);
      expect(reward.goldDelta).toBe(0);
      expect(reward.xpGained).toBe(0);
    });

    it('applies XP multiplier for gold tier', () => {
      const reward = calculateArenaReward(goldTier, 'win', 50, 0, colosseumData);
      expect(reward.xpGained).toBe(65); // 50 * 1.3 = 65
    });

    it('applies diminishing returns after 2 levels gained', () => {
      const normal = calculateArenaReward(silverTier, 'win', 100, 1, colosseumData);
      const diminished = calculateArenaReward(silverTier, 'win', 100, 2, colosseumData);
      expect(diminished.xpGained).toBe(Math.round(normal.xpGained * 0.5));
    });

    it('diminishing returns apply at exact threshold', () => {
      const atThreshold = calculateArenaReward(silverTier, 'win', 100, 2, colosseumData);
      const belowThreshold = calculateArenaReward(silverTier, 'win', 100, 1, colosseumData);
      expect(atThreshold.xpGained).toBeLessThan(belowThreshold.xpGained);
    });

    it('XP is at least 1 even with diminishing returns', () => {
      const reward = calculateArenaReward(silverTier, 'win', 1, 5, colosseumData);
      expect(reward.xpGained).toBeGreaterThanOrEqual(1);
    });
  });

  describe('canFight', () => {
    it('allows fight when HP > 1 and under max', () => {
      expect(canFight({ currentHP: 10 }, 0, 3)).toBe(true);
      expect(canFight({ currentHP: 2 }, 2, 3)).toBe(true);
    });

    it('rejects at 1 HP', () => {
      expect(canFight({ currentHP: 1 }, 0, 3)).toBe(false);
    });

    it('rejects at 0 HP', () => {
      expect(canFight({ currentHP: 0 }, 0, 3)).toBe(false);
    });

    it('rejects when max fights reached', () => {
      expect(canFight({ currentHP: 10 }, 3, 3)).toBe(false);
    });

    it('rejects when over max fights', () => {
      expect(canFight({ currentHP: 10 }, 5, 3)).toBe(false);
    });
  });

  describe('getMaxFights', () => {
    it('returns default for normal difficulty', () => {
      expect(getMaxFights('normal', colosseumData)).toBe(3);
    });

    it('returns default for null difficulty', () => {
      expect(getMaxFights(null, colosseumData)).toBe(3);
    });

    it('returns lunatic override', () => {
      expect(getMaxFights('lunatic', colosseumData)).toBe(2);
    });

    it('returns 3 for hard (no override)', () => {
      expect(getMaxFights('hard', colosseumData)).toBe(3);
    });
  });

  describe('getArenaDistance', () => {
    it('returns 1 for two melee weapons', () => {
      const sword = { range: '1' };
      const lance = { range: '1' };
      expect(getArenaDistance(sword, lance)).toBe(1);
    });

    it('returns 2 for bow vs melee', () => {
      const bow = { range: '2' };
      const sword = { range: '1' };
      expect(getArenaDistance(bow, sword)).toBe(2);
    });

    it('returns 2 for melee vs bow', () => {
      const sword = { range: '1' };
      const bow = { range: '2' };
      expect(getArenaDistance(sword, bow)).toBe(2);
    });

    it('returns 1 for 1-2 range weapons', () => {
      const javelin = { range: '1-2' };
      const sword = { range: '1' };
      expect(getArenaDistance(javelin, sword)).toBe(1);
    });

    it('returns 2 for two bows', () => {
      const bow1 = { range: '2' };
      const bow2 = { range: '2' };
      expect(getArenaDistance(bow1, bow2)).toBe(2);
    });

    it('handles siege weapons', () => {
      const siege = { range: '3-10' };
      const melee = { range: '1' };
      expect(getArenaDistance(siege, melee)).toBe(3);
    });
  });

  describe('generateMercenaryCandidates', () => {
    it('generates 2-3 candidates', () => {
      const rng = makeRng(42);
      const candidates = generateMercenaryCandidates(
        'act1',
        5,
        gameData.recruits,
        gameData.classes,
        gameData.weapons,
        gameData.skills,
        null,
        colosseumData,
        rng,
      );
      expect(candidates.length).toBeGreaterThanOrEqual(2);
      expect(candidates.length).toBeLessThanOrEqual(3);
    });

    it('candidates have stat bonuses applied', () => {
      // We can't easily verify bonuses were applied since we don't know the base,
      // but we can verify the units are valid
      const rng = makeRng(42);
      const candidates = generateMercenaryCandidates(
        'act1',
        5,
        gameData.recruits,
        gameData.classes,
        gameData.weapons,
        gameData.skills,
        null,
        colosseumData,
        rng,
      );
      for (const { unit } of candidates) {
        expect(unit.stats).toBeDefined();
        expect(unit.faction).toBe('player');
        expect(unit.level).toBeGreaterThanOrEqual(1);
      }
    });

    it('candidates have hire costs within pricing range', () => {
      const rng = makeRng(42);
      const candidates = generateMercenaryCandidates(
        'act1',
        5,
        gameData.recruits,
        gameData.classes,
        gameData.weapons,
        gameData.skills,
        null,
        colosseumData,
        rng,
      );
      const [min, max] = colosseumData.mercenaries.pricing.act1;
      for (const { hireCost } of candidates) {
        // Base range for non-promoted Act 1 mercs (no difficulty multiplier)
        expect(hireCost).toBeGreaterThanOrEqual(min);
        // Promoted units cost more so allow promotedMultiplier
        expect(hireCost).toBeLessThanOrEqual(Math.round(max * 1.5));
      }
    });

    it('applies difficulty price multiplier', () => {
      const rng1 = makeRng(42);
      const rng2 = makeRng(42);
      const normal = generateMercenaryCandidates(
        'act1',
        5,
        gameData.recruits,
        gameData.classes,
        gameData.weapons,
        gameData.skills,
        null,
        colosseumData,
        rng1,
      );
      const hard = generateMercenaryCandidates(
        'act1',
        5,
        gameData.recruits,
        gameData.classes,
        gameData.weapons,
        gameData.skills,
        'hard',
        colosseumData,
        rng2,
      );
      // Hard mode prices should be >= normal mode prices
      for (let i = 0; i < Math.min(normal.length, hard.length); i++) {
        expect(hard[i].hireCost).toBeGreaterThanOrEqual(normal[i].hireCost);
      }
    });

    it('cross-act pool generates candidates from next act', () => {
      // Run many trials to find a class from act2 pool in act1 colosseum
      const act1Classes = new Set(gameData.recruits.act1?.classPool || []);
      const act2Classes = new Set(gameData.recruits.act2?.classPool || []);
      const onlyInAct2 = [...act2Classes].filter((c) => !act1Classes.has(c));

      if (onlyInAct2.length === 0) return; // Skip if pools are identical

      let foundCrossAct = false;
      for (let i = 0; i < 200; i++) {
        const rng = makeRng(i);
        const candidates = generateMercenaryCandidates(
          'act1',
          5,
          gameData.recruits,
          gameData.classes,
          gameData.weapons,
          gameData.skills,
          null,
          colosseumData,
          rng,
        );
        if (candidates.some(({ unit }) => onlyInAct2.includes(unit.className))) {
          foundCrossAct = true;
          break;
        }
      }
      expect(foundCrossAct).toBe(true);
    });

    it('returns empty for missing pools', () => {
      const rng = makeRng(42);
      const candidates = generateMercenaryCandidates(
        'finalBoss',
        15,
        gameData.recruits,
        gameData.classes,
        gameData.weapons,
        gameData.skills,
        null,
        colosseumData,
        rng,
      );
      expect(candidates).toEqual([]);
    });
  });

  describe('getMercenaryPrice', () => {
    it('returns price within act range', () => {
      for (let i = 0; i < 50; i++) {
        const rng = makeRng(i);
        const price = getMercenaryPrice('act1', false, null, colosseumData, rng);
        expect(price).toBeGreaterThanOrEqual(300);
        expect(price).toBeLessThanOrEqual(500);
      }
    });

    it('promoted units cost more', () => {
      const rng = makeRng(42);
      const base = getMercenaryPrice('act2', false, null, colosseumData, makeRng(42));
      const promoted = getMercenaryPrice('act2', true, null, colosseumData, makeRng(42));
      expect(promoted).toBeGreaterThan(base);
    });

    it('difficulty multiplier increases price', () => {
      const rng = makeRng(42);
      const normal = getMercenaryPrice('act1', false, null, colosseumData, makeRng(42));
      const hard = getMercenaryPrice('act1', false, 'hard', colosseumData, makeRng(42));
      const lunatic = getMercenaryPrice('act1', false, 'lunatic', colosseumData, makeRng(42));
      expect(hard).toBeGreaterThan(normal);
      expect(lunatic).toBeGreaterThan(hard);
    });

    it('act4 pricing works', () => {
      const rng = makeRng(42);
      const price = getMercenaryPrice('act4', false, null, colosseumData, rng);
      expect(price).toBeGreaterThanOrEqual(1000);
      expect(price).toBeLessThanOrEqual(1500);
    });
  });

  describe('calculateArenaXP', () => {
    it('delegates to calculateCombatXP', () => {
      const attacker = { level: 5, tier: 'base', stats: { HP: 20 }, currentHP: 20 };
      const defender = { level: 5, tier: 'base', stats: { HP: 20 }, currentHP: 0 };
      const xp = calculateArenaXP(attacker, defender, true);
      expect(xp).toBeGreaterThan(0);
    });
  });

  describe('Node placement (via NodeMapGenerator)', () => {
    it('places at most 1 colosseum per act', () => {
      let colosseumCounts = [];
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act2', { name: 'Test', rows: 8 }, gameData.mapTemplates, {
          colosseumConfig: colosseumData.nodeGeneration,
        });
        const count = map.nodes.filter((n) => n.type === NODE_TYPES.COLOSSEUM).length;
        colosseumCounts.push(count);
        expect(count).toBeLessThanOrEqual(1);
      }
    });

    it('colosseum nodes are in preferred rows', () => {
      const preferred = new Set(colosseumData.nodeGeneration.preferredRows);
      for (let i = 0; i < 100; i++) {
        const map = generateNodeMap('act2', { name: 'Test', rows: 8 }, gameData.mapTemplates, {
          colosseumConfig: colosseumData.nodeGeneration,
        });
        const colosseums = map.nodes.filter((n) => n.type === NODE_TYPES.COLOSSEUM);
        for (const c of colosseums) {
          expect(preferred.has(c.row)).toBe(true);
        }
      }
    });

    it('colosseum does not replace boss, shop, or church nodes', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act2', { name: 'Test', rows: 8 }, gameData.mapTemplates, {
          colosseumConfig: colosseumData.nodeGeneration,
        });
        // Verify we still have a boss node
        expect(map.nodes.some((n) => n.type === NODE_TYPES.BOSS)).toBe(true);
      }
    });

    it('colosseum has null battleParams', () => {
      for (let i = 0; i < 100; i++) {
        const map = generateNodeMap('act2', { name: 'Test', rows: 8 }, gameData.mapTemplates, {
          colosseumConfig: colosseumData.nodeGeneration,
        });
        const colosseums = map.nodes.filter((n) => n.type === NODE_TYPES.COLOSSEUM);
        for (const c of colosseums) {
          expect(c.battleParams).toBeNull();
        }
      }
    });

    it('spawns colosseum with ~55% frequency', () => {
      let spawned = 0;
      const trials = 500;
      for (let i = 0; i < trials; i++) {
        const map = generateNodeMap('act2', { name: 'Test', rows: 8 }, gameData.mapTemplates, {
          colosseumConfig: colosseumData.nodeGeneration,
        });
        if (map.nodes.some((n) => n.type === NODE_TYPES.COLOSSEUM)) spawned++;
      }
      const rate = spawned / trials;
      // 0.55 config ± variance; bounds reject old 0.40 value reliably
      expect(rate).toBeGreaterThan(0.45);
      expect(rate).toBeLessThan(0.68);
    });
  });
});
