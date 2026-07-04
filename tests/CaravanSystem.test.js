import { describe, it, expect } from 'vitest';
import {
  rollCaravanSpawn,
  pickCaravanSpawnTile,
  createCaravanUnit,
  computeCaravanStep,
  isCaravanAtEdge,
} from '../src/engine/CaravanSystem.js';
import { CARAVAN_SPAWN_CHANCE } from '../src/utils/constants.js';

// Minimal 2-terrain set: index 0 passable for everyone, index 1 impassable.
const terrainData = [
  { name: 'Plain', moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } },
  { name: 'Mountain', moveCost: { Infantry: '--', Armored: '--', Cavalry: '--', Flying: '1' } },
];

function flatMap(cols, rows, fill = 0) {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

describe('CaravanSystem', () => {
  describe('rollCaravanSpawn', () => {
    const baseParams = { act: 'act2', objective: 'rout' };

    it('never spawns on act1', () => {
      const rng = () => 0; // would always trigger if allowed
      expect(rollCaravanSpawn({ ...baseParams, act: 'act1' }, 0, rng)).toBe(false);
    });

    it('excludes recruit battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isRecruitBattle: true }, 0, rng)).toBe(false);
    });

    it('excludes boss battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isBoss: true }, 0, rng)).toBe(false);
    });

    it('excludes escape objective', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, objective: 'escape' }, 0, rng)).toBe(false);
    });

    it('excludes ambush battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isAmbush: true }, 0, rng)).toBe(false);
    });

    it('excludes tutorial battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, tutorialMode: true }, 0, rng)).toBe(false);
    });

    it('excludes colosseum battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isColosseum: true }, 0, rng)).toBe(false);
    });

    it('allows a normal BATTLE/rout node on act2+', () => {
      const rng = () => 0; // below any positive chance
      expect(rollCaravanSpawn(baseParams, 0, rng)).toBe(true);
    });

    it('allows a seize (elite) node on act2+', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, objective: 'seize', isElite: true }, 0, rng)).toBe(
        true,
      );
    });

    it('honors the base chance boundary (seeded rng)', () => {
      const justUnder = () => CARAVAN_SPAWN_CHANCE - 0.001;
      const justOver = () => CARAVAN_SPAWN_CHANCE + 0.001;
      expect(rollCaravanSpawn(baseParams, 0, justUnder)).toBe(true);
      expect(rollCaravanSpawn(baseParams, 0, justOver)).toBe(false);
    });

    it('honors the meta caravanChanceBonus', () => {
      // Roll sits above base chance but below base+bonus.
      const roll = CARAVAN_SPAWN_CHANCE + 0.05;
      const rng = () => roll;
      expect(rollCaravanSpawn(baseParams, 0, rng)).toBe(false);
      expect(rollCaravanSpawn(baseParams, 0.1, rng)).toBe(true);
    });

    it('returns false for null params', () => {
      expect(rollCaravanSpawn(null)).toBe(false);
    });
  });

  describe('pickCaravanSpawnTile', () => {
    it('picks an open, passable tile near the enemy half', () => {
      const cols = 10;
      const rows = 6;
      const mapLayout = flatMap(cols, rows, 0);
      const playerSpawns = [{ col: 1, row: 3 }];
      const enemySpawns = [
        { col: 8, row: 2 },
        { col: 8, row: 3 },
      ];
      const tile = pickCaravanSpawnTile(
        mapLayout,
        cols,
        rows,
        terrainData,
        playerSpawns,
        enemySpawns,
      );
      expect(tile).toBeTruthy();
      expect(tile.col).toBeGreaterThanOrEqual(0);
      expect(tile.col).toBeLessThan(cols);
      // Should not collide with any spawn tile.
      const occupied = new Set([...playerSpawns, ...enemySpawns].map((s) => `${s.col},${s.row}`));
      expect(occupied.has(`${tile.col},${tile.row}`)).toBe(false);
    });

    it('returns null when the map has no open tiles', () => {
      const cols = 2;
      const rows = 1;
      const mapLayout = [[1, 1]]; // all impassable
      const tile = pickCaravanSpawnTile(mapLayout, cols, rows, terrainData, [], []);
      expect(tile).toBeNull();
    });
  });

  describe('createCaravanUnit', () => {
    it('creates an unarmed, MOV 1, flagged NPC unit scaled by act', () => {
      const unit = createCaravanUnit('act2', { col: 3, row: 4 });
      expect(unit.isCaravan).toBe(true);
      expect(unit.faction).toBe('npc');
      expect(unit.weapon).toBeNull();
      expect(unit.mov).toBe(1);
      expect(unit.stats.MOV).toBe(1);
      expect(unit.col).toBe(3);
      expect(unit.row).toBe(4);
      expect(unit.currentHP).toBeGreaterThan(0);
    });

    it('scales HP up with act number', () => {
      const act2 = createCaravanUnit('act2', { col: 0, row: 0 });
      const act4 = createCaravanUnit('act4', { col: 0, row: 0 });
      expect(act4.stats.HP).toBeGreaterThan(act2.stats.HP);
    });
  });

  describe('computeCaravanStep', () => {
    it('steps toward the nearest column edge (left)', () => {
      const cols = 10;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 1, row: 1, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toEqual({ col: 0, row: 1 });
    });

    it('steps toward the nearest column edge (right)', () => {
      const cols = 10;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 8, row: 1, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toEqual({ col: 9, row: 1 });
    });

    it('skips the step when the adjacent tile is impassable', () => {
      const cols = 5;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      mapLayout[1][0] = 1; // impassable for Infantry
      const unit = { col: 1, row: 1, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toBeNull();
    });

    it('skips the step when the adjacent tile is occupied', () => {
      const cols = 5;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 1, row: 1, moveType: 'Infantry' };
      const occupied = new Set(['0,1']);
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, occupied);
      expect(step).toBeNull();
    });

    it('returns null when already at the edge', () => {
      const cols = 5;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 0, row: 1, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toBeNull();
    });
  });

  describe('isCaravanAtEdge', () => {
    it('true at col 0 or cols-1', () => {
      expect(isCaravanAtEdge({ col: 0 }, 10)).toBe(true);
      expect(isCaravanAtEdge({ col: 9 }, 10)).toBe(true);
      expect(isCaravanAtEdge({ col: 5 }, 10)).toBe(false);
    });
  });
});
