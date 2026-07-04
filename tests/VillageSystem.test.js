// VillageSystem: pure logic for the village & bandit secondary objective —
// spawn roll gating, neutral-band tile placement, bandit race calibration,
// and the intact/visited/razed state machine.

import { describe, it, expect } from 'vitest';
import {
  rollVillageSpawn,
  pickVillageTile,
  calibrateBanditSpawn,
  pickBanditClass,
  buildBanditScriptedWave,
  createVillageState,
  isUnitOnIntactVillage,
  visitVillage,
  razeVillage,
  clearSeekTileBandits,
  getVillageGoldReward,
  rollVillageRewardItem,
  VILLAGE_STATUS,
} from '../src/engine/VillageSystem.js';
import {
  VILLAGE_SPAWN_CHANCE,
  VILLAGE_GOLD_BY_ACT,
  VILLAGE_BANDIT_XP_MULTIPLIER,
  VILLAGE_BANDIT_DISTANCE_MARGIN,
} from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

// Minimal 2-terrain set: index 0 open plain, index 1 impassable.
const terrainData = [
  { name: 'Plain', moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } },
  { name: 'Mountain', moveCost: { Infantry: '--', Armored: '--', Cavalry: '--', Flying: '1' } },
];

function flatMap(cols, rows, fill = 0) {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

describe('VillageSystem', () => {
  describe('rollVillageSpawn', () => {
    const baseParams = { act: 'act1', objective: 'rout' };
    const always = () => 0;

    it('allows a BATTLE rout node on act1 with a low roll', () => {
      expect(rollVillageSpawn(baseParams, always)).toBe(true);
    });

    it('allows seize objectives', () => {
      expect(rollVillageSpawn({ ...baseParams, objective: 'seize' }, always)).toBe(true);
    });

    it('allows every act act1-act4 and rejects finalBoss', () => {
      for (const act of ['act1', 'act2', 'act3', 'act4']) {
        expect(rollVillageSpawn({ ...baseParams, act }, always)).toBe(true);
      }
      expect(rollVillageSpawn({ ...baseParams, act: 'finalBoss' }, always)).toBe(false);
    });

    it('rejects escape objectives', () => {
      expect(rollVillageSpawn({ ...baseParams, objective: 'escape' }, always)).toBe(false);
    });

    it('rejects recruit, boss, ambush, tutorial, and colosseum battles', () => {
      expect(rollVillageSpawn({ ...baseParams, isRecruitBattle: true }, always)).toBe(false);
      expect(rollVillageSpawn({ ...baseParams, isBoss: true }, always)).toBe(false);
      expect(rollVillageSpawn({ ...baseParams, isAmbush: true }, always)).toBe(false);
      expect(rollVillageSpawn({ ...baseParams, tutorialMode: true }, always)).toBe(false);
      expect(rollVillageSpawn({ ...baseParams, isColosseum: true }, always)).toBe(false);
    });

    it('is mutually exclusive with the caravan (max one micro-objective per map)', () => {
      expect(rollVillageSpawn({ ...baseParams, act: 'act2', hasCaravan: true }, always)).toBe(
        false,
      );
    });

    it('respects the spawn chance boundary', () => {
      expect(rollVillageSpawn(baseParams, () => VILLAGE_SPAWN_CHANCE - 0.001)).toBe(true);
      expect(rollVillageSpawn(baseParams, () => VILLAGE_SPAWN_CHANCE)).toBe(false);
      expect(rollVillageSpawn(baseParams, () => 0.999)).toBe(false);
    });

    it('handles null params defensively', () => {
      expect(rollVillageSpawn(null, always)).toBe(false);
    });
  });

  describe('pickVillageTile', () => {
    it('places the tile in the middle third of columns and an outer row quarter', () => {
      const cols = 12;
      const rows = 8;
      const mapLayout = flatMap(cols, rows);
      // Armies fight along the top rows -> village should go to the bottom quarter.
      const playerSpawns = [{ col: 0, row: 0 }];
      const enemySpawns = [{ col: 11, row: 0 }];
      for (let i = 0; i < 25; i++) {
        const tile = pickVillageTile(mapLayout, cols, rows, terrainData, playerSpawns, enemySpawns);
        expect(tile).not.toBeNull();
        expect(tile.col).toBeGreaterThanOrEqual(Math.floor(cols / 3));
        expect(tile.col).toBeLessThanOrEqual(Math.ceil((2 * cols) / 3) - 1);
        // bottom quarter (rows 6-7 for rows=8)
        expect(tile.row).toBeGreaterThanOrEqual(rows - Math.ceil(rows / 4));
      }
    });

    it('biases to the top quarter when armies start on the bottom rows', () => {
      const cols = 12;
      const rows = 8;
      const mapLayout = flatMap(cols, rows);
      const playerSpawns = [{ col: 0, row: 7 }];
      const enemySpawns = [{ col: 11, row: 7 }];
      const tile = pickVillageTile(mapLayout, cols, rows, terrainData, playerSpawns, enemySpawns);
      expect(tile.row).toBeLessThanOrEqual(Math.ceil(rows / 4) - 1);
    });

    it('never picks an occupied or impassable tile', () => {
      const cols = 6;
      const rows = 4;
      const mapLayout = flatMap(cols, rows, 1); // all impassable...
      // ...except one open tile.
      mapLayout[2][3] = 0;
      const tile = pickVillageTile(mapLayout, cols, rows, terrainData, [], []);
      expect(tile).toEqual({ col: 3, row: 2 });

      const occupied = pickVillageTile(
        mapLayout,
        cols,
        rows,
        terrainData,
        [{ col: 3, row: 2 }],
        [],
      );
      expect(occupied).toBeNull();
    });

    it('refuses feature/hazard terrain even when passable', () => {
      const cols = 6;
      const rows = 4;
      const featureTerrain = [
        ...terrainData,
        { name: 'Throne', moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } },
      ];
      const mapLayout = flatMap(cols, rows, 1);
      mapLayout[1][2] = 2; // Throne — passable but not placeable
      expect(pickVillageTile(mapLayout, cols, rows, featureTerrain, [], [])).toBeNull();
    });

    it('returns null on a fully blocked map', () => {
      const mapLayout = flatMap(5, 5, 1);
      expect(pickVillageTile(mapLayout, 5, 5, terrainData, [], [])).toBeNull();
    });
  });

  describe('calibrateBanditSpawn', () => {
    it('satisfies banditDistance >= playerDistance + margin when the map allows it', () => {
      const cols = 20;
      const rows = 12;
      const mapLayout = flatMap(cols, rows);
      const villageTile = { col: 10, row: 9 };
      const playerSpawns = [{ col: 6, row: 6 }]; // path distance 7
      const enemySpawns = [{ col: 18, row: 1 }];
      const { spawns, playerDistance } = calibrateBanditSpawn({
        mapLayout,
        cols,
        rows,
        terrainData,
        villageTile,
        playerSpawns,
        enemySpawns,
      });
      expect(playerDistance).toBe(7);
      expect(spawns.length).toBe(2);
      for (const s of spawns) {
        // all spawns on the map edge
        expect(s.col === 0 || s.col === cols - 1 || s.row === 0 || s.row === rows - 1).toBe(true);
        const dist = Math.abs(s.col - villageTile.col) + Math.abs(s.row - villageTile.row);
        // On an open map BFS distance equals manhattan distance.
        expect(dist).toBeGreaterThanOrEqual(playerDistance + VILLAGE_BANDIT_DISTANCE_MARGIN);
      }
      // "≈": the first pick hugs the target distance rather than maxing it out.
      const firstDist =
        Math.abs(spawns[0].col - villageTile.col) + Math.abs(spawns[0].row - villageTile.row);
      expect(firstDist).toBeLessThanOrEqual(playerDistance + VILLAGE_BANDIT_DISTANCE_MARGIN + 2);
    });

    it('prefers the enemy-side half of the map', () => {
      const cols = 20;
      const rows = 12;
      const mapLayout = flatMap(cols, rows);
      const { spawns } = calibrateBanditSpawn({
        mapLayout,
        cols,
        rows,
        terrainData,
        villageTile: { col: 10, row: 10 },
        playerSpawns: [{ col: 1, row: 1 }],
        enemySpawns: [{ col: 18, row: 2 }],
      });
      for (const s of spawns) {
        expect(s.col).toBeGreaterThanOrEqual(cols / 2);
      }
    });

    it('gives the player the benefit (max distance) when the inequality cannot hold', () => {
      // Tiny map: no edge tile can be player distance + margin away.
      const cols = 5;
      const rows = 4;
      const mapLayout = flatMap(cols, rows);
      const villageTile = { col: 2, row: 2 };
      const { spawns, playerDistance } = calibrateBanditSpawn({
        mapLayout,
        cols,
        rows,
        terrainData,
        villageTile,
        playerSpawns: [{ col: 2, row: 1 }], // distance 1
        enemySpawns: [{ col: 4, row: 0 }],
      });
      expect(playerDistance).toBe(1);
      expect(spawns.length).toBeGreaterThan(0);
      // Farthest-available fallback on the enemy half: col 4 corner-ish tiles.
      const dists = spawns.map(
        (s) => Math.abs(s.col - villageTile.col) + Math.abs(s.row - villageTile.row),
      );
      const maxEdgeDist = Math.max(...dists);
      expect(maxEdgeDist).toBeGreaterThanOrEqual(3);
    });

    it('returns no spawns when the village is unreachable from every player spawn', () => {
      const cols = 8;
      const rows = 5;
      const mapLayout = flatMap(cols, rows);
      for (let r = 0; r < rows; r++) mapLayout[r][4] = 1; // wall bisects the map
      const { spawns } = calibrateBanditSpawn({
        mapLayout,
        cols,
        rows,
        terrainData,
        villageTile: { col: 6, row: 2 },
        playerSpawns: [{ col: 1, row: 2 }],
        enemySpawns: [],
      });
      expect(spawns).toEqual([]);
    });

    it('only uses edge tiles that can actually walk to the village', () => {
      const cols = 10;
      const rows = 6;
      const mapLayout = flatMap(cols, rows);
      // Wall off the right column except a village-side pocket that stays connected.
      for (let r = 0; r < rows; r++) mapLayout[r][8] = 1;
      mapLayout[5][8] = 0; // gap keeps col 9 connected via the bottom row
      const { spawns } = calibrateBanditSpawn({
        mapLayout,
        cols,
        rows,
        terrainData,
        villageTile: { col: 5, row: 5 },
        playerSpawns: [{ col: 0, row: 0 }],
        enemySpawns: [{ col: 9, row: 0 }],
      });
      expect(spawns.length).toBeGreaterThan(0);
      // Verify each spawn is BFS-connected (finite manhattan walk exists through the gap).
      for (const s of spawns) {
        expect(mapLayout[s.row][s.col]).toBe(0);
      }
    });
  });

  describe('pickBanditClass', () => {
    it('picks an axe-wielding base class from the act pool (Fighter in act1)', () => {
      const pool = gameData.enemies.pools.act1;
      expect(pickBanditClass(pool, gameData.classes)).toBe('Fighter');
    });

    it('picks an axe class for every eligible act pool', () => {
      for (const act of ['act1', 'act2', 'act3', 'act4']) {
        const className = pickBanditClass(gameData.enemies.pools[act], gameData.classes);
        const classData = gameData.classes.find((c) => c.name === className);
        expect(classData).toBeTruthy();
        expect(classData.weaponProficiencies).toContain('Axe');
      }
    });

    it('falls back to the first base class when the pool has no axe user', () => {
      const pool = { base: ['Myrmidon', 'Archer'] };
      expect(pickBanditClass(pool, gameData.classes)).toBe('Myrmidon');
    });

    it('falls back to Fighter when the pool is empty', () => {
      expect(pickBanditClass({ base: [] }, gameData.classes)).toBe('Fighter');
    });
  });

  describe('buildBanditScriptedWave', () => {
    it('builds a turn-1 wave with seek_tile spawns targeting the village', () => {
      const wave = buildBanditScriptedWave({
        spawnTiles: [
          { col: 0, row: 3 },
          { col: 0, row: 4 },
        ],
        className: 'Fighter',
        level: 2,
        villageTile: { col: 5, row: 6 },
      });
      expect(wave.turn).toBe(1);
      expect(wave.xpMultiplier).toBe(VILLAGE_BANDIT_XP_MULTIPLIER);
      expect(wave.spawns).toHaveLength(2);
      for (const spawn of wave.spawns) {
        expect(spawn.className).toBe('Fighter');
        expect(spawn.level).toBe(2);
        expect(spawn.aiMode).toBe('seek_tile');
        expect(spawn.aiTargetTile).toEqual({ col: 5, row: 6 });
      }
    });

    it('returns null without spawn tiles, class, or village tile', () => {
      expect(
        buildBanditScriptedWave({
          spawnTiles: [],
          className: 'Fighter',
          level: 1,
          villageTile: { col: 0, row: 0 },
        }),
      ).toBeNull();
      expect(
        buildBanditScriptedWave({
          spawnTiles: [{ col: 0, row: 0 }],
          className: null,
          level: 1,
          villageTile: { col: 0, row: 0 },
        }),
      ).toBeNull();
      expect(
        buildBanditScriptedWave({
          spawnTiles: [{ col: 0, row: 0 }],
          className: 'Fighter',
          level: 1,
          villageTile: null,
        }),
      ).toBeNull();
    });
  });

  describe('state machine', () => {
    it('createVillageState starts intact at the tile', () => {
      const state = createVillageState({ col: 4, row: 7 });
      expect(state).toEqual({ col: 4, row: 7, status: VILLAGE_STATUS.INTACT });
      expect(createVillageState(null)).toBeNull();
    });

    it('isUnitOnIntactVillage matches position and intact status only', () => {
      const state = createVillageState({ col: 4, row: 7 });
      expect(isUnitOnIntactVillage(state, { col: 4, row: 7 })).toBe(true);
      expect(isUnitOnIntactVillage(state, { col: 4, row: 6 })).toBe(false);
      visitVillage(state);
      expect(isUnitOnIntactVillage(state, { col: 4, row: 7 })).toBe(false);
    });

    it('visit transitions intact -> visited exactly once', () => {
      const state = createVillageState({ col: 1, row: 1 });
      expect(visitVillage(state)).toBe(true);
      expect(state.status).toBe(VILLAGE_STATUS.VISITED);
      expect(visitVillage(state)).toBe(false);
      expect(razeVillage(state)).toBe(false); // resolved states never re-trigger
    });

    it('raze transitions intact -> razed exactly once', () => {
      const state = createVillageState({ col: 1, row: 1 });
      expect(razeVillage(state)).toBe(true);
      expect(state.status).toBe(VILLAGE_STATUS.RAZED);
      expect(razeVillage(state)).toBe(false);
      expect(visitVillage(state)).toBe(false);
    });

    it('clearSeekTileBandits reverts survivors to chase and strips the target', () => {
      const bandit1 = { aiMode: 'seek_tile', aiTargetTile: { col: 1, row: 1 } };
      const bandit2 = { aiMode: 'seek_tile', aiTargetTile: { col: 1, row: 1 } };
      const regular = { aiMode: 'guard' };
      expect(clearSeekTileBandits([bandit1, bandit2, regular])).toBe(2);
      expect(bandit1.aiMode).toBe('chase');
      expect(bandit1.aiTargetTile).toBeUndefined();
      expect(bandit2.aiMode).toBe('chase');
      expect(regular.aiMode).toBe('guard');
    });
  });

  describe('rewards', () => {
    it('gold scales by act with an act1 fallback', () => {
      for (const act of ['act1', 'act2', 'act3', 'act4']) {
        expect(getVillageGoldReward(act)).toBe(VILLAGE_GOLD_BY_ACT[act]);
      }
      expect(getVillageGoldReward('unknown')).toBe(VILLAGE_GOLD_BY_ACT.act1);
    });

    it('rolls an item from the act healing + statBooster loot pools', () => {
      // act2 has both pools populated; rig the rng to hit a statBooster.
      const table = gameData.lootTables.act2;
      const poolSize = table.healing.length + table.statBooster.length;
      const lastIndexRng = () => (poolSize - 1) / poolSize + 1e-9;
      const item = rollVillageRewardItem(
        'act2',
        gameData.lootTables,
        gameData.consumables,
        lastIndexRng,
      );
      expect(item).toBeTruthy();
      expect(item.name).toBe(table.statBooster[table.statBooster.length - 1]);
    });

    it('act1 (no statBooster pool) still yields a healing item', () => {
      const item = rollVillageRewardItem(
        'act1',
        gameData.lootTables,
        gameData.consumables,
        () => 0,
      );
      expect(item?.name).toBe(gameData.lootTables.act1.healing[0]);
    });

    it('falls back to a Vulnerary when the pools are empty', () => {
      const item = rollVillageRewardItem('act1', {}, gameData.consumables, () => 0);
      expect(item?.name).toBe('Vulnerary');
    });

    it('returns a clone, not the catalog entry', () => {
      const item = rollVillageRewardItem(
        'act1',
        gameData.lootTables,
        gameData.consumables,
        () => 0,
      );
      const catalogEntry = gameData.consumables.find((c) => c.name === item.name);
      expect(item).not.toBe(catalogEntry);
      expect(item).toEqual(structuredClone(catalogEntry));
    });
  });
});
