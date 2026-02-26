import { describe, it, expect } from 'vitest';
import {
  createBallistaState,
  isBallistaTile,
  getBallistaRange,
  selectBallistaTarget,
  resolveBallistaStrike,
} from '../src/engine/BallistaEngine.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { TERRAIN } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = origRandom;
  }
}

function makeUnit(col, row, currentHP, stats = {}) {
  return { col, row, currentHP, stats: { RES: 0, ...stats } };
}

describe('BallistaEngine', () => {
  describe('createBallistaState', () => {
    it('returns correct shape with enemy owner', () => {
      const state = createBallistaState(5, 3);
      expect(state).toEqual({ col: 5, row: 3, owner: 'enemy', captured: false });
    });
  });

  describe('isBallistaTile', () => {
    it('returns true for TERRAIN.Ballista (14)', () => {
      expect(isBallistaTile(TERRAIN.Ballista)).toBe(true);
      expect(isBallistaTile(14)).toBe(true);
    });

    it('returns false for other terrain indices', () => {
      expect(isBallistaTile(TERRAIN.Plain)).toBe(false);
      expect(isBallistaTile(TERRAIN.Forest)).toBe(false);
      expect(isBallistaTile(TERRAIN.Wall)).toBe(false);
      expect(isBallistaTile(TERRAIN.Throne)).toBe(false);
      expect(isBallistaTile(0)).toBe(false);
      expect(isBallistaTile(13)).toBe(false);
      expect(isBallistaTile(undefined)).toBe(false);
    });
  });

  describe('getBallistaRange', () => {
    it('returns 3', () => {
      expect(getBallistaRange()).toBe(3);
    });
  });

  describe('selectBallistaTarget', () => {
    const ballista = { col: 5, row: 5 };

    it('selects nearest in-range target', () => {
      const targets = [
        makeUnit(5, 7, 20), // dist 2
        makeUnit(5, 8, 20), // dist 3
        makeUnit(5, 9, 20), // dist 4, out of range
      ];
      const result = selectBallistaTarget(ballista, targets);
      expect(result).toBe(targets[0]);
    });

    it('tiebreaks by lowest HP when distances are equal', () => {
      const targets = [
        makeUnit(6, 5, 15), // dist 1, HP 15
        makeUnit(5, 6, 10), // dist 1, HP 10
        makeUnit(4, 5, 20), // dist 1, HP 20
      ];
      const result = selectBallistaTarget(ballista, targets);
      expect(result).toBe(targets[1]); // HP 10 wins tiebreak
    });

    it('returns null if no targets in range', () => {
      const targets = [
        makeUnit(5, 9, 20), // dist 4, out of range
        makeUnit(9, 5, 20), // dist 4, out of range
      ];
      const result = selectBallistaTarget(ballista, targets);
      expect(result).toBeNull();
    });

    it('returns null for empty target list', () => {
      expect(selectBallistaTarget(ballista, [])).toBeNull();
    });

    it('skips dead units', () => {
      const targets = [
        makeUnit(5, 6, 0), // dist 1, dead
        makeUnit(5, 7, 10), // dist 2, alive
      ];
      const result = selectBallistaTarget(ballista, targets);
      expect(result).toBe(targets[1]);
    });

    it('returns null when all targets are dead', () => {
      const targets = [makeUnit(5, 6, 0), makeUnit(6, 5, 0)];
      expect(selectBallistaTarget(ballista, targets)).toBeNull();
    });

    it('excludes targets at distance 0 (same tile as ballista)', () => {
      const targets = [
        makeUnit(5, 5, 20), // dist 0, same tile
        makeUnit(5, 7, 15), // dist 2
      ];
      const result = selectBallistaTarget(ballista, targets);
      expect(result).toBe(targets[1]);
    });
  });

  describe('resolveBallistaStrike', () => {
    const ballista = { col: 5, row: 5, owner: 'enemy', captured: false };

    it('damage = max(1, 10 - target RES)', () => {
      const target = makeUnit(5, 7, 20, { RES: 3 });
      // Force hit with rng returning 0 (0 < 85)
      const result = resolveBallistaStrike(ballista, target, () => 0);
      expect(result.damage).toBe(7); // 10 - 3
      expect(result.didHit).toBe(true);
    });

    it('damage floors at 1 when RES >= MIGHT', () => {
      const target = makeUnit(5, 7, 20, { RES: 15 });
      const result = resolveBallistaStrike(ballista, target, () => 0);
      expect(result.damage).toBe(1); // max(1, 10 - 15)
      expect(result.didHit).toBe(true);
    });

    it('damage is 0 on miss', () => {
      const target = makeUnit(5, 7, 20, { RES: 3 });
      // Force miss with rng returning 0.90 (90 >= 85)
      const result = resolveBallistaStrike(ballista, target, () => 0.9);
      expect(result.damage).toBe(0);
      expect(result.didHit).toBe(false);
    });

    it('returns hit rate of 85', () => {
      const target = makeUnit(5, 7, 20, { RES: 0 });
      const result = resolveBallistaStrike(ballista, target, () => 0);
      expect(result.hit).toBe(85);
    });

    it('respects hit roll boundary via rng', () => {
      const target = makeUnit(5, 7, 20, { RES: 0 });
      // Roll of 0.849 → 84.9 < 85 → hit
      const hitResult = resolveBallistaStrike(ballista, target, () => 0.849);
      expect(hitResult.didHit).toBe(true);
      expect(hitResult.damage).toBe(10);

      // Roll of 0.85 → 85 >= 85 → miss
      const missResult = resolveBallistaStrike(ballista, target, () => 0.85);
      expect(missResult.didHit).toBe(false);
      expect(missResult.damage).toBe(0);
    });

    it('handles target with no stats.RES gracefully', () => {
      const target = { col: 5, row: 7, currentHP: 20, stats: {} };
      const result = resolveBallistaStrike(ballista, target, () => 0);
      expect(result.damage).toBe(10); // max(1, 10 - 0)
    });
  });

  describe('MapGenerator difficulty gating', () => {
    it('Ballista terrain NOT placed on Normal', () => {
      // Run several seeds to account for randomness
      for (let seed = 1; seed <= 10; seed++) {
        const config = withSeed(seed, () =>
          generateBattle(
            { act: 'act2', objective: 'rout', templateId: 'chokepoint', difficultyId: 'normal' },
            data,
          ),
        );
        // Verify no Ballista terrain in mapLayout
        for (let r = 0; r < config.rows; r++) {
          for (let c = 0; c < config.cols; c++) {
            expect(config.mapLayout[r][c]).not.toBe(TERRAIN.Ballista);
          }
        }
        // ballistas should be undefined (not populated)
        expect(config.ballistas).toBeUndefined();
      }
    });

    it('Ballista terrain IS placed on Hard', () => {
      // The chokepoint template has a Ballista feature — on hard it should appear
      let foundBallista = false;
      for (let seed = 1; seed <= 10; seed++) {
        const config = withSeed(seed, () =>
          generateBattle(
            { act: 'act2', objective: 'rout', templateId: 'chokepoint', difficultyId: 'hard' },
            data,
          ),
        );
        if (config.ballistas && config.ballistas.length > 0) {
          foundBallista = true;
          // Verify the ballista position matches a Ballista tile in the map
          for (const b of config.ballistas) {
            expect(config.mapLayout[b.row][b.col]).toBe(TERRAIN.Ballista);
            expect(b.owner).toBe('enemy');
            expect(b.captured).toBe(false);
          }
          break;
        }
      }
      expect(foundBallista).toBe(true);
    });

    it('Ballista terrain IS placed on Lunatic', () => {
      let foundBallista = false;
      for (let seed = 1; seed <= 10; seed++) {
        const config = withSeed(seed, () =>
          generateBattle(
            { act: 'act2', objective: 'rout', templateId: 'chokepoint', difficultyId: 'lunatic' },
            data,
          ),
        );
        if (config.ballistas && config.ballistas.length > 0) {
          foundBallista = true;
          for (const b of config.ballistas) {
            expect(config.mapLayout[b.row][b.col]).toBe(TERRAIN.Ballista);
          }
          break;
        }
      }
      expect(foundBallista).toBe(true);
    });
  });
});
