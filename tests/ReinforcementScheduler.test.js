import { describe, expect, it } from 'vitest';
import {
  collectEdgeSpawnCandidates,
  getReinforcementTurnJitter,
  getDueReinforcementWaves,
  resolveScheduledTurn,
  rollWaveTurnJitter,
  scheduleReinforcementsForTurn,
} from '../src/engine/ReinforcementScheduler.js';

const TERRAIN = {
  Plain: 0,
  Wall: 1,
};

const terrainData = [
  {
    name: 'Plain',
    moveCost: { Infantry: '1' },
  },
  {
    name: 'Wall',
    moveCost: { Infantry: '--' },
  },
];

describe('ReinforcementScheduler', () => {
  describe('turn jitter helpers', () => {
    it('normalizes absent turnJitter to [0,0]', () => {
      expect(getReinforcementTurnJitter({})).toEqual([0, 0]);
    });

    it('rolls deterministic per-wave jitter for same seed and wave index', () => {
      const a = rollWaveTurnJitter({ seed: 777, waveIndex: 1, turnJitter: [-1, 1] });
      const b = rollWaveTurnJitter({ seed: 777, waveIndex: 1, turnJitter: [-1, 1] });
      expect(a).toBe(b);
    });

    it('varies due-turn timing across seed samples when jitter range is non-zero', () => {
      const observed = new Set();
      for (let seed = 1; seed <= 16; seed++) {
        observed.add(resolveScheduledTurn({
          baseTurn: 5,
          totalOffset: 0,
          seed,
          waveIndex: 0,
          turnJitter: [-1, 1],
        }));
      }
      expect(observed.size).toBeGreaterThan(1);
    });
  });

  describe('getDueReinforcementWaves', () => {
    it('applies template and global turn offsets deterministically', () => {
      const reinforcements = {
        spawnEdges: ['right'],
        waves: [
          { turn: 3, count: [2, 3] },
          { turn: 5, count: [2, 4] },
        ],
        difficultyScaling: true,
        turnOffsetByDifficulty: { normal: 0, hard: -1, lunatic: -1 },
        xpDecay: [1.0, 0.75, 0.5],
      };

      const hardTurn2 = getDueReinforcementWaves({
        turn: 2,
        reinforcements,
        difficultyId: 'hard',
      });
      expect(hardTurn2.map((w) => w.waveIndex)).toEqual([0]);
      expect(hardTurn2[0].scheduledTurn).toBe(2);

      const hardTurn3WithGlobal = getDueReinforcementWaves({
        turn: 3,
        reinforcements,
        difficultyId: 'hard',
        difficultyTurnOffset: -1,
      });
      expect(hardTurn3WithGlobal.map((w) => w.waveIndex)).toEqual([1]);
      expect(hardTurn3WithGlobal[0].scheduledTurn).toBe(3);
    });

    it('keeps legacy fixed-turn behavior when turnJitter is absent', () => {
      const reinforcements = {
        spawnEdges: ['right'],
        waves: [{ turn: 3, count: [1, 1] }],
        difficultyScaling: true,
        turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
        xpDecay: [1.0],
      };
      const dueAt3 = getDueReinforcementWaves({
        turn: 3,
        seed: 999,
        reinforcements,
        difficultyId: 'normal',
      });
      const dueAt2 = getDueReinforcementWaves({
        turn: 2,
        seed: 999,
        reinforcements,
        difficultyId: 'normal',
      });

      expect(dueAt3.map((w) => w.waveIndex)).toEqual([0]);
      expect(dueAt3[0].scheduledTurn).toBe(3);
      expect(dueAt2).toEqual([]);
    });

    it('resolves identical due turns for same seed and jitter config', () => {
      const reinforcements = {
        spawnEdges: ['right'],
        waves: [{ turn: 4, count: [1, 1] }],
        difficultyScaling: true,
        turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
        turnJitter: [-1, 1],
        xpDecay: [1.0],
      };
      const passA = [];
      const passB = [];
      for (let turn = 1; turn <= 8; turn++) {
        if (getDueReinforcementWaves({ turn, seed: 321, reinforcements }).length > 0) passA.push(turn);
        if (getDueReinforcementWaves({ turn, seed: 321, reinforcements }).length > 0) passB.push(turn);
      }
      expect(passA).toEqual(passB);
      expect(passA).toHaveLength(1);
    });

    it('does not apply template difficulty offset when difficultyScaling is disabled', () => {
      const reinforcements = {
        spawnEdges: ['right'],
        waves: [{ turn: 3, count: [1, 1] }],
        difficultyScaling: false,
        turnOffsetByDifficulty: { normal: 0, hard: -2, lunatic: -2 },
        xpDecay: [1.0],
      };

      const turn1 = getDueReinforcementWaves({
        turn: 1,
        reinforcements,
        difficultyId: 'hard',
      });
      expect(turn1).toEqual([]);

      const turn3 = getDueReinforcementWaves({
        turn: 3,
        reinforcements,
        difficultyId: 'hard',
      });
      expect(turn3.map((w) => w.waveIndex)).toEqual([0]);
    });
  });

  describe('collectEdgeSpawnCandidates', () => {
    it('filters occupied and path-blocked edge tiles', () => {
      const mapLayout = [
        [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
        [TERRAIN.Wall, TERRAIN.Wall, TERRAIN.Wall, TERRAIN.Plain],
        [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
      ];

      const candidates = collectEdgeSpawnCandidates({
        edge: 'top',
        mapLayout,
        terrain: terrainData,
        occupied: [{ col: 0, row: 0 }],
      });

      // (0,0) occupied; (1,0)/(2,0) blocked by inward walls; only (3,0) remains.
      expect(candidates).toEqual([{ col: 3, row: 0 }]);
    });
  });

  describe('scheduleReinforcementsForTurn', () => {
    it('returns deterministic output for same seed', () => {
      const mapLayout = Array.from({ length: 6 }, () => Array(6).fill(TERRAIN.Plain));
      const reinforcements = {
        spawnEdges: ['left', 'right', 'top', 'bottom'],
        waves: [{ turn: 2, count: [4, 4], edges: ['left', 'right', 'top', 'bottom'] }],
        difficultyScaling: true,
        turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
        xpDecay: [1.0],
      };

      const runA = scheduleReinforcementsForTurn({
        turn: 2,
        seed: 12345,
        reinforcements,
        mapLayout,
        terrain: terrainData,
      });
      const runB = scheduleReinforcementsForTurn({
        turn: 2,
        seed: 12345,
        reinforcements,
        mapLayout,
        terrain: terrainData,
      });
      const runC = scheduleReinforcementsForTurn({
        turn: 2,
        seed: 54321,
        reinforcements,
        mapLayout,
        terrain: terrainData,
      });

      expect(runA).toEqual(runB);
      expect(runA.spawns).not.toEqual(runC.spawns);
    });

    it('accounts for blocked spawns and applies xpDecay fallback for later waves', () => {
      const mapLayout = [
        [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
        [TERRAIN.Wall, TERRAIN.Wall, TERRAIN.Wall, TERRAIN.Plain],
        [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
      ];
      const reinforcements = {
        spawnEdges: ['top'],
        waves: [
          { turn: 1, count: [4, 4], edges: ['top'] },
          { turn: 2, count: [1, 1], edges: ['top'] },
          { turn: 3, count: [1, 1], edges: ['top'] },
        ],
        difficultyScaling: true,
        turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
        xpDecay: [1.0, 0.75],
      };

      const turn1 = scheduleReinforcementsForTurn({
        turn: 1,
        seed: 7,
        reinforcements,
        mapLayout,
        terrain: terrainData,
        occupied: [{ col: 0, row: 0 }],
      });
      expect(turn1.spawns).toEqual([
        expect.objectContaining({ col: 3, row: 0, waveIndex: 0, xpMultiplier: 1.0 }),
      ]);
      expect(turn1.blockedSpawns).toBe(3);
      expect(turn1.dueWaves[0].blockedCount).toBe(3);

      const turn3 = scheduleReinforcementsForTurn({
        turn: 3,
        seed: 7,
        reinforcements,
        mapLayout,
        terrain: terrainData,
      });
      expect(turn3.dueWaves[0].xpMultiplier).toBe(0.75);
    });

    it('applies enemyCountBonus only when difficultyScaling is enabled', () => {
      const mapLayout = Array.from({ length: 4 }, () => Array(4).fill(TERRAIN.Plain));
      const base = {
        spawnEdges: ['right'],
        waves: [{ turn: 1, count: [2, 2], edges: ['right'] }],
        turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
        xpDecay: [1.0],
      };

      const scaled = scheduleReinforcementsForTurn({
        turn: 1,
        seed: 1,
        reinforcements: { ...base, difficultyScaling: true },
        mapLayout,
        terrain: terrainData,
        enemyCountBonus: 2,
      });
      expect(scaled.dueWaves[0].requestedCount).toBe(4);

      const unscaled = scheduleReinforcementsForTurn({
        turn: 1,
        seed: 1,
        reinforcements: { ...base, difficultyScaling: false },
        mapLayout,
        terrain: terrainData,
        enemyCountBonus: 2,
      });
      expect(unscaled.dueWaves[0].requestedCount).toBe(2);
    });

    it('revalidates inward-neighbor legality within a wave after each spawn', () => {
      const mapLayout = [
        [TERRAIN.Plain, TERRAIN.Plain],
        [TERRAIN.Plain, TERRAIN.Plain],
      ];
      const reinforcements = {
        spawnEdges: ['top', 'bottom'],
        waves: [{ turn: 1, count: [2, 2], edges: ['top', 'bottom'] }],
        difficultyScaling: false,
        turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
        xpDecay: [1.0],
      };

      const result = scheduleReinforcementsForTurn({
        turn: 1,
        seed: 9,
        reinforcements,
        mapLayout,
        terrain: terrainData,
        occupied: [{ col: 1, row: 0 }, { col: 1, row: 1 }],
      });

      // Only one of (0,0) top and (0,1) bottom may spawn:
      // whichever spawns first occupies the other's inward tile.
      expect(result.spawns).toHaveLength(1);
      expect(result.blockedSpawns).toBe(1);
      expect(result.dueWaves[0].blockedCount).toBe(1);
    });
  });
});
