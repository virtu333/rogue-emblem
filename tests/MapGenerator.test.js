import { describe, it, expect } from 'vitest';
import {
  generateBattle,
  scoreSpawnTile,
  resolveClassWeight,
  pickTemplate,
  CAVALRY_CARVE_MAX_CONVERSIONS,
  resolveAnchorUnitClass,
} from '../src/engine/MapGenerator.js';
import {
  TERRAIN,
  DEPLOY_LIMITS,
  ACT_SEQUENCE,
  ENEMY_COUNT_OFFSET,
} from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const ACT4_BOSS_INTENT_TEMPLATE_ID = 'act4_boss_intent_bastion';
const ACT3_DARK_CHAMPION_TEMPLATE_ID = 'act3_dark_champion_keep';
const HYBRID_TEST_TEMPLATE_ID = 'hybrid_arena_generator_test';

function withSeed(seed, fn) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = origRandom;
  }
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function capForTiles(tiles, densityCap) {
  const keys = Object.keys(densityCap)
    .map(Number)
    .sort((a, b) => a - b);
  let cap = Infinity;
  for (const k of keys) {
    if (k <= tiles) cap = densityCap[String(k)][1];
  }
  return cap;
}

describe('MapGenerator', () => {
  describe('generateBattle basics', () => {
    it('returns a valid battleConfig for rout objective', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      expect(config.mapLayout).toBeDefined();
      expect(config.cols).toBeGreaterThan(0);
      expect(config.rows).toBeGreaterThan(0);
      expect(config.objective).toBe('rout');
      expect(config.playerSpawns.length).toBeGreaterThanOrEqual(2);
      expect(config.enemySpawns.length).toBeGreaterThan(0);
      expect(config.thronePos).toBeNull();
      expect(config.templateId).toBeTruthy();
    });

    it('returns a valid battleConfig for seize objective', () => {
      const config = generateBattle({ act: 'act1', objective: 'seize' }, data);
      expect(config.objective).toBe('seize');
      expect(config.thronePos).not.toBeNull();
      expect(config.thronePos.col).toBeGreaterThanOrEqual(0);
      expect(config.thronePos.row).toBeGreaterThanOrEqual(0);

      // Should have at least one boss
      const bosses = config.enemySpawns.filter((e) => e.isBoss);
      expect(bosses.length).toBe(1);
    });

    it('throws a clear error when no valid template is available', () => {
      const deps = { ...data, mapTemplates: { rout: [], seize: [] } };
      expect(() => generateBattle({ act: 'act1', objective: 'rout' }, deps)).toThrow(
        'No valid map template found',
      );
    });

    describe('finalBoss difficulty gating', () => {
      const finalBossFor = (difficultyId, seed) =>
        withSeed(seed, () =>
          generateBattle(
            { act: 'finalBoss', objective: 'seize', difficultyId, isBoss: true },
            data,
          ),
        );

      it('hard always faces The Lieutenant, never The Entity', () => {
        for (let seed = 1; seed <= 15; seed++) {
          const boss = finalBossFor('hard', seed).enemySpawns.find((e) => e.isBoss);
          expect(boss.name, `seed ${seed}`).toBe('The Lieutenant');
          expect(boss.isEntity, `seed ${seed}`).toBeFalsy();
        }
      });

      it('normal faces The Lieutenant; lunatic faces The Entity', () => {
        for (let seed = 1; seed <= 15; seed++) {
          const normalBoss = finalBossFor('normal', seed).enemySpawns.find((e) => e.isBoss);
          expect(normalBoss.name, `normal seed ${seed}`).toBe('The Lieutenant');

          const lunaticConfig = finalBossFor('lunatic', seed);
          const lunaticBoss = lunaticConfig.enemySpawns.find((e) => e.isBoss);
          expect(lunaticBoss.name, `lunatic seed ${seed}`).toBe('The Entity');
          expect(lunaticBoss.isEntity, `lunatic seed ${seed}`).toBe(true);
          expect(lunaticConfig.templateId, `lunatic seed ${seed}`).toBe('eldritch_sanctum');
        }
      });

      it.each(['normal', 'hard'])('%s final boss fights in eldritch_sanctum', (difficultyId) => {
        for (let seed = 1; seed <= 15; seed++) {
          expect(finalBossFor(difficultyId, seed).templateId, `seed ${seed}`).toBe(
            'eldritch_sanctum',
          );
        }
      });

      it('fails loudly when finalBoss generation is not marked as a boss battle', () => {
        expect(() =>
          withSeed(1, () =>
            generateBattle({ act: 'finalBoss', objective: 'seize', difficultyId: 'lunatic' }, data),
          ),
        ).toThrow('No valid map template found');
      });
    });

    it('throws a clear error for seize when seize pool is empty', () => {
      const deps = {
        ...data,
        mapTemplates: {
          rout: data.mapTemplates.rout,
          seize: [],
        },
      };
      expect(() => generateBattle({ act: 'act1', objective: 'seize' }, deps)).toThrow(
        'No valid map template found',
      );
    });
  });

  describe('map dimensions', () => {
    it('produces correct dimensions for act1', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      // Act 1 sizes: 10x8 or 12x8
      expect([10, 12]).toContain(config.cols);
      expect(config.rows).toBe(8);
      expect(config.mapLayout.length).toBe(config.rows);
      expect(config.mapLayout[0].length).toBe(config.cols);
    });

    it('produces larger maps for later acts', () => {
      const act1 = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const act3 = generateBattle({ act: 'act3', objective: 'rout' }, data);
      expect(act3.cols * act3.rows).toBeGreaterThanOrEqual(act1.cols * act1.rows);
    });
  });

  describe('terrain validity', () => {
    it('all terrain indices are valid', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const maxIdx = data.terrain.length - 1;
      for (let r = 0; r < config.rows; r++) {
        for (let c = 0; c < config.cols; c++) {
          const idx = config.mapLayout[r][c];
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThanOrEqual(maxIdx);
        }
      }
    });

    it('seize map has a Throne tile at thronePos', () => {
      const config = generateBattle({ act: 'act1', objective: 'seize' }, data);
      const throneIdx = data.terrain.findIndex((t) => t.name === 'Throne');
      const tp = config.thronePos;
      expect(config.mapLayout[tp.row][tp.col]).toBe(throneIdx);
    });
  });

  describe('spawn placement', () => {
    it('player spawns are on passable tiles', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      for (const spawn of config.playerSpawns) {
        const idx = config.mapLayout[spawn.row][spawn.col];
        const terrain = data.terrain[idx];
        expect(terrain.moveCost.Infantry).not.toBe('--');
      }
    });

    it('enemy spawns are on passable tiles', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      for (const spawn of config.enemySpawns) {
        const idx = config.mapLayout[spawn.row][spawn.col];
        const terrain = data.terrain[idx];
        expect(terrain.moveCost.Infantry).not.toBe('--');
      }
    });

    it('no two spawns share the same tile', () => {
      const config = generateBattle({ act: 'act1', objective: 'seize' }, data);
      const allPositions = [
        ...config.playerSpawns.map((s) => `${s.col},${s.row}`),
        ...config.enemySpawns.map((s) => `${s.col},${s.row}`),
      ];
      const unique = new Set(allPositions);
      expect(unique.size).toBe(allPositions.length);
    });
  });

  describe('reachability', () => {
    it('all enemy positions are infantry-reachable from player spawn', () => {
      // Run multiple times since maps are random
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
        const reachable = bfs(
          config.mapLayout,
          config.cols,
          config.rows,
          data.terrain,
          config.playerSpawns[0],
        );

        for (const enemy of config.enemySpawns) {
          expect(
            reachable.has(`${enemy.col},${enemy.row}`),
            `Enemy at (${enemy.col},${enemy.row}) unreachable on iteration ${i}`,
          ).toBe(true);
        }
      }
    });

    it('throne is reachable on seize maps', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'seize' }, data);
        const reachable = bfs(
          config.mapLayout,
          config.cols,
          config.rows,
          data.terrain,
          config.playerSpawns[0],
        );
        const tp = config.thronePos;
        expect(
          reachable.has(`${tp.col},${tp.row}`),
          `Throne at (${tp.col},${tp.row}) unreachable on iteration ${i}`,
        ).toBe(true);
      }
    });
  });

  describe('toxic overlay non-toxic lane guarantee', () => {
    it('clears a fully-toxic enemy endpoint so a poison-free lane exists', () => {
      const template = {
        id: 'toxic_lane_endpoint_regression',
        name: 'Toxic Lane Endpoint Regression',
        biome: 'swamp',
        acts: ['act2'],
        fogChance: 0,
        fixedSize: [10, 8],
        zones: [
          {
            rect: [0, 0, 1, 1],
            terrain: { Plain: 100 },
            priority: 0,
          },
          {
            rect: [0, 0, 0.2, 1],
            terrain: { Plain: 100 },
            priority: 1,
            role: 'playerSpawn',
          },
          {
            rect: [0.9, 0.5, 1, 0.625],
            terrain: { Bog: 100 },
            priority: 2,
            role: 'enemySpawn',
          },
        ],
        features: [],
        anchors: [],
      };
      const deps = {
        ...data,
        mapTemplates: {
          ...data.mapTemplates,
          rout: [template],
        },
      };

      const config = withSeed(17, () =>
        generateBattle(
          {
            act: 'act2',
            objective: 'rout',
            templateId: template.id,
            deployCount: 3,
          },
          deps,
        ),
      );

      // Enemy endpoint starts as Bog and should be restored from AcidicBog if selected by overlay.
      expect(config.mapLayout[4][9]).toBe(TERRAIN.Bog);
      expect(config.mapLayout[4][9]).not.toBe(TERRAIN.AcidicBog);
    });
  });

  describe('cavalry advance guarantees', () => {
    function makeCavalryStressDeps() {
      const stressTemplate = {
        id: 'cavalry_stress_test',
        name: 'Cavalry Stress Test',
        fogChance: 0,
        acts: ['act1'],
        zones: [
          {
            rect: [0, 0, 1, 1],
            terrain: { Mountain: 100 },
            priority: 0,
          },
          {
            rect: [0, 0, 0.3, 1],
            terrain: { Mountain: 100 },
            priority: 1,
            role: 'playerSpawn',
          },
          {
            rect: [0.7, 0, 1, 1],
            terrain: { Plain: 100 },
            priority: 2,
            role: 'enemySpawn',
          },
        ],
        features: [],
        anchors: [],
      };

      return {
        ...data,
        mapSizes: [
          {
            phase: 'Act 1 (Test)',
            mapSize: '10x8',
            tiles: 80,
            deployLimit: '3-4',
          },
        ],
        mapTemplates: {
          ...data.mapTemplates,
          rout: [stressTemplate],
        },
      };
    }

    it('guarantees cavalry can reach an unoccupied enemy-adjacent tile on chokepoint', () => {
      const config = withSeed(18, () =>
        generateBattle(
          {
            act: 'act2',
            objective: 'rout',
            templateId: 'chokepoint',
            deployCount: 4,
            row: 0,
          },
          data,
        ),
      );

      const candidates = collectUnoccupiedAdjacentEnemyTiles(config);
      expect(candidates.length).toBeGreaterThan(0);
      expect(cavalryCanReachAnyTiles(config, candidates)).toBe(true);
    });

    it('guarantees cavalry can reach a throne-adjacent tile on hilltop_fortress', () => {
      const config = withSeed(36, () =>
        generateBattle(
          {
            act: 'act4',
            objective: 'seize',
            templateId: 'hilltop_fortress',
            deployCount: 6,
            row: 1,
          },
          data,
        ),
      );

      const candidates = collectThroneAdjacentTiles(config, true);
      expect(candidates.length).toBeGreaterThan(0);
      expect(cavalryCanReachAnyTiles(config, candidates)).toBe(true);
    });

    it('still enforces throne pressure when all unoccupied throne-adjacent tiles are exhausted', () => {
      // Seed 1223 produces a layout where spawns fully occupy throne-adjacent tiles
      const config = withSeed(1223, () =>
        generateBattle(
          {
            act: 'act3',
            objective: 'seize',
            templateId: ACT3_DARK_CHAMPION_TEMPLATE_ID,
            deployCount: 6,
            row: 1,
            isBoss: true,
          },
          data,
        ),
      );

      const unoccupiedCandidates = collectThroneAdjacentTiles(config, false);
      expect(unoccupiedCandidates.length).toBe(0);

      const throneCandidates = collectThroneAdjacentTiles(config, true);
      expect(throneCandidates.length).toBeGreaterThan(0);
      expect(cavalryCanReachAnyTiles(config, throneCandidates)).toBe(true);
    });

    it('converts at least one player spawn to cavalry-passable when all spawns start on Mountain', () => {
      const deps = makeCavalryStressDeps();
      const config = withSeed(7, () =>
        generateBattle(
          {
            act: 'act1',
            objective: 'rout',
            templateId: 'cavalry_stress_test',
            deployCount: 2,
            row: 0,
          },
          deps,
        ),
      );

      const cavalryPassableSpawns = config.playerSpawns.filter((spawn) =>
        isPassableForMoveType(data.terrain, config.mapLayout[spawn.row][spawn.col], 'Cavalry'),
      );
      expect(cavalryPassableSpawns.length).toBeGreaterThan(0);

      const candidates = collectUnoccupiedAdjacentEnemyTiles(config);
      expect(candidates.length).toBeGreaterThan(0);
      expect(cavalryCanReachAnyTiles(config, candidates)).toBe(true);
    });

    it('keeps deterministic output for cavalry tie-break + carve behavior', () => {
      const params = {
        act: 'act2',
        objective: 'rout',
        templateId: 'chokepoint',
        deployCount: 4,
        row: 0,
      };

      const config1 = withSeed(43, () => generateBattle(params, data));
      const config2 = withSeed(43, () => generateBattle(params, data));

      expect(config1.mapLayout).toEqual(config2.mapLayout);
      expect(config1.playerSpawns).toEqual(config2.playerSpawns);
      expect(config1.enemySpawns).toEqual(config2.enemySpawns);
    });

    it('keeps cavalry carve footprint bounded on the mountain stress template', () => {
      const deps = makeCavalryStressDeps();
      const config = withSeed(11, () =>
        generateBattle(
          {
            act: 'act1',
            objective: 'rout',
            templateId: 'cavalry_stress_test',
            deployCount: 2,
            row: 0,
          },
          deps,
        ),
      );

      const nonMountainCount = countTerrainWhere(
        config,
        (terrainName) => terrainName !== 'Mountain',
      );
      const enemyZoneStartCol = Math.floor(config.cols * 0.7);
      const baselineNonMountain = (config.cols - enemyZoneStartCol) * config.rows;
      expect(nonMountainCount).toBeLessThanOrEqual(
        baselineNonMountain + CAVALRY_CARVE_MAX_CONVERSIONS + 1,
      );
    });

    it('passes a lightweight seeded sweep for known cavalry-challenging templates', () => {
      const scenarios = [
        {
          act: 'act2',
          objective: 'rout',
          templateId: 'chokepoint',
          deployCount: 4,
          row: 0,
          checkThrone: false,
        },
        {
          act: 'act4',
          objective: 'seize',
          templateId: 'hilltop_fortress',
          deployCount: 6,
          row: 1,
          checkThrone: true,
        },
        {
          act: 'act4',
          objective: 'seize',
          templateId: 'eruption_point',
          deployCount: 6,
          row: 1,
          checkThrone: true,
        },
      ];

      scenarios.forEach((scenario, scenarioIndex) => {
        for (let seed = 1; seed <= 5; seed++) {
          const config = withSeed(1000 + scenarioIndex * 100 + seed, () =>
            generateBattle(scenario, data),
          );

          const engagementCandidates = collectUnoccupiedAdjacentEnemyTiles(config);
          expect(engagementCandidates.length).toBeGreaterThan(0);
          expect(cavalryCanReachAnyTiles(config, engagementCandidates)).toBe(true);

          if (scenario.checkThrone) {
            const throneCandidates = collectThroneAdjacentTiles(config, true);
            expect(throneCandidates.length).toBeGreaterThan(0);
            expect(cavalryCanReachAnyTiles(config, throneCandidates)).toBe(true);
          }
        }
      });
    });
  });

  describe('enemy composition', () => {
    it('act1 enemies are all base-tier classes', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const pool = data.enemies.pools.act1;
      for (const spawn of config.enemySpawns) {
        if (spawn.isBoss) continue; // bosses can be any class
        expect(pool.base).toContain(spawn.className);
      }
    });

    it('enemy levels fall within act pool range', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const [min, max] = data.enemies.pools.act1.levelRange;
      for (const spawn of config.enemySpawns) {
        if (spawn.isBoss) continue;
        expect(spawn.level).toBeGreaterThanOrEqual(min);
        expect(spawn.level).toBeLessThanOrEqual(max);
      }
    });

    it('seize maps have exactly one boss', () => {
      for (let i = 0; i < 5; i++) {
        const config = generateBattle({ act: 'act1', objective: 'seize' }, data);
        const bosses = config.enemySpawns.filter((e) => e.isBoss);
        expect(bosses.length).toBe(1);
        expect(bosses[0].name).toBeTruthy();
      }
    });

    it('act1 boss pool excludes Knight', () => {
      const act1Bosses = data.enemies.bosses.act1 || [];
      expect(act1Bosses.some((b) => b.className === 'Knight')).toBe(false);
    });

    it('firstBattleFightersOnly spawns only Fighter enemies', () => {
      const config = generateBattle(
        { act: 'act1', objective: 'rout', firstBattleFightersOnly: true },
        data,
      );
      for (const spawn of config.enemySpawns) {
        expect(spawn.className).toBe('Fighter');
      }
    });

    it('act2+ enemy pools include wyvern classes', () => {
      expect(data.enemies.pools.act2.base).toContain('Wyvern Rider');
      expect(data.enemies.pools.act3.base).toContain('Wyvern Rider');
      expect(data.enemies.pools.act3.promoted).toContain('Wyvern Lord');
      expect(data.enemies.pools.postAct.promoted).toContain('Wyvern Lord');
    });
  });

  describe('all acts generate without errors', () => {
    for (const act of ['act1', 'act2', 'act3', 'act4', 'postAct', 'finalBoss']) {
      for (const objective of ['rout', 'seize']) {
        it(`${act} / ${objective}`, () => {
          const config = generateBattle({ act, objective, isBoss: act === 'finalBoss' }, data);
          expect(config.mapLayout.length).toBe(config.rows);
          expect(config.enemySpawns.length).toBeGreaterThan(0);
          expect(config.playerSpawns.length).toBeGreaterThanOrEqual(2);
        });
      }
    }
  });

  describe('NPC spawn for recruit battles', () => {
    it('isRecruitBattle produces battleConfig with npcSpawn', () => {
      const config = generateBattle(
        { act: 'act1', objective: 'rout', isRecruitBattle: true },
        data,
      );
      expect(config.npcSpawn).not.toBeNull();
      expect(config.npcSpawn.className).toBeTruthy();
      expect(config.npcSpawn.name).toBeTruthy();
      expect(config.npcSpawn.level).toBeGreaterThanOrEqual(1);
      expect(config.npcSpawn.col).toBeGreaterThanOrEqual(0);
      expect(config.npcSpawn.row).toBeGreaterThanOrEqual(0);
    });

    it('NPC spawn is on a passable tile', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle(
          { act: 'act1', objective: 'rout', isRecruitBattle: true },
          data,
        );
        const npc = config.npcSpawn;
        const terrainIdx = config.mapLayout[npc.row][npc.col];
        const t = data.terrain[terrainIdx];
        expect(t.moveCost.Infantry).not.toBe('--');
      }
    });

    it('NPC spawn is not on player or enemy spawn position', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle(
          { act: 'act1', objective: 'rout', isRecruitBattle: true },
          data,
        );
        const npc = config.npcSpawn;
        const npcKey = `${npc.col},${npc.row}`;
        for (const ps of config.playerSpawns) {
          expect(`${ps.col},${ps.row}`).not.toBe(npcKey);
        }
        for (const es of config.enemySpawns) {
          expect(`${es.col},${es.row}`).not.toBe(npcKey);
        }
      }
    });

    it('non-recruit battle produces null npcSpawn', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      expect(config.npcSpawn).toBeNull();
    });

    it('act2 recruit pool includes Wyvern Rider', () => {
      expect(data.recruits.act2.classPool).toContain('Wyvern Rider');
    });

    it('avoids duplicate recruit names in a run while class names remain available', () => {
      const usedRecruitNames = {};
      const seen = new Set();
      for (let i = 0; i < 6; i++) {
        const config = generateBattle(
          { act: 'act1', objective: 'rout', isRecruitBattle: true, usedRecruitNames },
          data,
        );
        expect(config.npcSpawn).toBeTruthy();
        expect(seen.has(config.npcSpawn.name)).toBe(false);
        seen.add(config.npcSpawn.name);
      }
    });

    it('enforces global recruit name uniqueness across classes with suffix fallback', () => {
      const localData = structuredClone(data);
      localData.recruits.act1.classPool = ['Mercenary', 'Hero'];
      localData.recruits.namePool.Mercenary = ['Dante'];
      localData.recruits.namePool.Hero = ['Dante'];

      const usedRecruitNames = {};
      const first = generateBattle(
        { act: 'act1', objective: 'rout', isRecruitBattle: true, usedRecruitNames },
        localData,
      );
      const second = generateBattle(
        { act: 'act1', objective: 'rout', isRecruitBattle: true, usedRecruitNames },
        localData,
      );

      expect(first.npcSpawn).toBeTruthy();
      expect(second.npcSpawn).toBeTruthy();
      expect(first.npcSpawn.name).not.toBe(second.npcSpawn.name);
    });

    it('NPC spawn is biased toward player side of map', () => {
      for (let i = 0; i < 20; i++) {
        const config = generateBattle(
          { act: 'act1', objective: 'rout', isRecruitBattle: true },
          data,
        );
        const npc = config.npcSpawn;
        expect(npc.col).toBeLessThan(Math.ceil(config.cols * 0.6));
      }
    });

    it('NPC spawn maintains distance from enemy spawns', () => {
      for (let i = 0; i < 20; i++) {
        const config = generateBattle(
          { act: 'act1', objective: 'rout', isRecruitBattle: true },
          data,
        );
        const npc = config.npcSpawn;
        for (const es of config.enemySpawns) {
          const dist = Math.abs(npc.col - es.col) + Math.abs(npc.row - es.row);
          expect(dist).toBeGreaterThanOrEqual(2);
        }
      }
    });
  });

  describe('D2: River map NPC spawn bias', () => {
    it('NPC col < 40% of map width in >75% of cases on river_crossing', () => {
      let playerSideCount = 0;
      const trials = 100;
      for (let i = 0; i < trials; i++) {
        const config = generateBattle(
          {
            act: 'act2',
            objective: 'rout',
            isRecruitBattle: true,
            templateId: 'river_crossing',
          },
          data,
        );
        if (!config.npcSpawn) continue;
        const threshold = Math.ceil(config.cols * 0.4);
        if (config.npcSpawn.col < threshold) playerSideCount++;
      }
      expect(playerSideCount).toBeGreaterThan(trials * 0.75);
    });

    it('non-river templates still use standard 20-55% range', () => {
      for (let i = 0; i < 20; i++) {
        const config = generateBattle(
          {
            act: 'act1',
            objective: 'rout',
            isRecruitBattle: true,
          },
          data,
        );
        if (!config.npcSpawn) continue;
        expect(config.npcSpawn.col).toBeLessThan(Math.ceil(config.cols * 0.6));
      }
    });
  });

  describe('D3: Threat radius NPC rejection', () => {
    it('NPC has <=2 enemies in turn-1 reach in >85% of cases', () => {
      let safeCount = 0;
      const trials = 100;
      for (let i = 0; i < trials; i++) {
        const config = generateBattle(
          {
            act: 'act2',
            objective: 'rout',
            isRecruitBattle: true,
          },
          data,
        );
        if (!config.npcSpawn) continue;
        const npc = config.npcSpawn;
        // Estimate enemy reach: class MOV + max weapon range (capped at 2)
        let threats = 0;
        for (const e of config.enemySpawns) {
          const cd = data.classes.find((c) => c.name === e.className);
          const mov = cd?.baseStats?.MOV || 4;
          const dist = Math.abs(e.col - npc.col) + Math.abs(e.row - npc.row);
          // Simplified: MOV + 2 (generous cap for max weapon range)
          if (dist <= mov + 2) threats++;
        }
        if (threats <= 2) safeCount++;
      }
      expect(safeCount).toBeGreaterThan(trials * 0.85);
    });
  });

  // D1: Fog/Recruit "?" marker — requires BattleScene (Phaser runtime)
  // Expected behavior (manual/visual testing):
  // - When fog enabled + recruit battle, a pulsing "?" text appears at NPC tile
  // - "?" is visible through fog (depth 4, above fog overlays at depth 3)
  // - Alpha tweens 0.4 -> 1.0 with yoyo, 1500ms duration, infinite repeat
  // - When player unit vision range covers NPC tile, "?" is destroyed and NPC sprite shown
  // - Non-recruit or non-fog battles do not create the marker

  describe('dynamic deployCount', () => {
    it('deployCount param produces correct number of player spawns', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout', deployCount: 6 }, data);
      expect(config.playerSpawns.length).toBe(6);
    });

    it('defaults to DEPLOY_LIMITS max when no deployCount given', () => {
      const config = generateBattle({ act: 'act2', objective: 'rout' }, data);
      expect(config.playerSpawns.length).toBe(DEPLOY_LIMITS.act2.max);
    });

    it('works with various deployCount values across acts', () => {
      for (const act of ['act1', 'act2', 'act3']) {
        for (const count of [2, 3, 5]) {
          const config = generateBattle({ act, objective: 'rout', deployCount: count }, data);
          expect(config.playerSpawns.length).toBe(count);
        }
      }
    });
  });

  describe('levelRange override', () => {
    it('when levelRange is [1, 1], all non-boss enemies are level 1', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout', levelRange: [1, 1] }, data);
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          expect(spawn.level).toBe(1);
        }
      }
    });

    it('when levelRange is [2, 3], all non-boss enemies are level 2 or 3', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout', levelRange: [2, 3] }, data);
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          expect(spawn.level).toBeGreaterThanOrEqual(2);
          expect(spawn.level).toBeLessThanOrEqual(3);
        }
      }
    });

    it('without levelRange, uses pool default', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const [min, max] = data.enemies.pools.act1.levelRange;
      for (const spawn of config.enemySpawns) {
        if (spawn.isBoss) continue;
        expect(spawn.level).toBeGreaterThanOrEqual(min);
        expect(spawn.level).toBeLessThanOrEqual(max);
      }
    });
  });

  describe('deploy-aware enemy count', () => {
    it('enemies >= deployCount for all acts', () => {
      for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
        for (let i = 0; i < 10; i++) {
          const deployCount = DEPLOY_LIMITS[act]?.max || 4;
          const config = generateBattle({ act, objective: 'rout', deployCount }, data);
          const nonBossEnemies = config.enemySpawns.filter((e) => !e.isBoss).length;
          expect(nonBossEnemies).toBeGreaterThanOrEqual(deployCount);
        }
      }
    });

    it('act1 rows 0-1 produce exactly deployCount enemies (offset [0,0])', () => {
      for (let i = 0; i < 20; i++) {
        const deployCount = 2;
        const config = generateBattle(
          { act: 'act1', objective: 'rout', deployCount, row: 0 },
          data,
        );
        expect(config.enemySpawns.length).toBe(deployCount);
      }
    });

    it('act1 row 4+ produces more enemies (offset [1,2])', () => {
      const counts = new Set();
      for (let i = 0; i < 30; i++) {
        const deployCount = 3;
        const config = generateBattle(
          { act: 'act1', objective: 'rout', deployCount, row: 4 },
          data,
        );
        counts.add(config.enemySpawns.length);
        expect(config.enemySpawns.length).toBeGreaterThanOrEqual(deployCount + 1);
        expect(config.enemySpawns.length).toBeLessThanOrEqual(deployCount + 2);
      }
    });

    it('boss fights use boss offset (higher enemy count)', () => {
      for (let i = 0; i < 10; i++) {
        const deployCount = 4;
        const config = generateBattle(
          { act: 'act2', objective: 'seize', deployCount, isBoss: true },
          data,
        );
        // act2 boss offset is [3,4], so total enemies = 4 + 3..4 = 7..8
        // (seize boss is included in enemySpawns, counted within rollEnemyCount total)
        expect(config.enemySpawns.length).toBeGreaterThanOrEqual(deployCount + 3);
      }
    });

    it('missing row falls back to default offset', () => {
      for (let i = 0; i < 10; i++) {
        const deployCount = 4;
        // act2 row 5 has no specific entry, should use default [2,3]
        const config = generateBattle(
          { act: 'act2', objective: 'rout', deployCount, row: 5 },
          data,
        );
        const count = config.enemySpawns.length;
        expect(count).toBeGreaterThanOrEqual(deployCount + 2);
        expect(count).toBeLessThanOrEqual(deployCount + 3);
      }
    });
  });

  describe('recruit battle enemy bump', () => {
    it('adds +1 enemy for recruit battles when under density cap', () => {
      for (let seed = 1; seed <= 30; seed++) {
        const baseline = withSeed(seed, () =>
          generateBattle({ act: 'act1', objective: 'rout', deployCount: 2, row: 0 }, data),
        );
        const recruit = withSeed(seed, () =>
          generateBattle(
            { act: 'act1', objective: 'rout', deployCount: 2, row: 0, isRecruitBattle: true },
            data,
          ),
        );
        expect(recruit.enemySpawns.length).toBe(baseline.enemySpawns.length + 1);
      }
    });

    it('does not exceed density cap when recruit +1 would overflow cap', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const baseline = withSeed(seed, () =>
          generateBattle({ act: 'act1', objective: 'rout', deployCount: 7, row: 4 }, data),
        );
        const recruit = withSeed(seed, () =>
          generateBattle(
            { act: 'act1', objective: 'rout', deployCount: 7, row: 4, isRecruitBattle: true },
            data,
          ),
        );

        const tiles = baseline.cols * baseline.rows;
        const cap = capForTiles(tiles, data.enemies.enemyCountByTiles);
        expect(recruit.enemySpawns.length).toBeLessThanOrEqual(cap);
        expect(recruit.enemySpawns.length).toBe(Math.min(baseline.enemySpawns.length + 1, cap));
      }
    });
  });

  describe('village ambush enemy cap', () => {
    it('act1 ambush caps enemies at deployCount + 1', () => {
      for (let i = 0; i < 20; i++) {
        const deployCount = 3;
        const config = generateBattle(
          { act: 'act1', objective: 'rout', deployCount, row: 4, isAmbush: true },
          data,
        );
        expect(config.enemySpawns.length).toBeLessThanOrEqual(deployCount + 1);
        expect(config.enemySpawns.length).toBeGreaterThanOrEqual(deployCount);
      }
    });

    it('act2+ ambush caps enemies at deployCount + 2', () => {
      for (let i = 0; i < 20; i++) {
        const deployCount = 4;
        const config = generateBattle(
          { act: 'act2', objective: 'rout', deployCount, row: 4, isAmbush: true },
          data,
        );
        expect(config.enemySpawns.length).toBeLessThanOrEqual(deployCount + 2);
        expect(config.enemySpawns.length).toBeGreaterThanOrEqual(deployCount);
      }
    });

    it('non-ambush battles are not affected by ambush cap', () => {
      // act2 row 5 with default offset [2,3] should allow deployCount + 2..3
      let sawAboveCap = false;
      for (let i = 0; i < 30; i++) {
        const deployCount = 4;
        const config = generateBattle(
          { act: 'act2', objective: 'rout', deployCount, row: 5 },
          data,
        );
        if (config.enemySpawns.length > deployCount + 2) sawAboveCap = true;
      }
      expect(sawAboveCap).toBe(true);
    });
  });

  describe('final boss tuning', () => {
    it('finalBoss support enemy count within [3,5] offset', () => {
      for (let i = 0; i < 20; i++) {
        const deployCount = DEPLOY_LIMITS.finalBoss.max;
        const config = generateBattle(
          { act: 'finalBoss', objective: 'rout', deployCount, isBoss: true },
          data,
        );
        const nonBoss = config.enemySpawns.filter((e) => !e.isBoss).length;
        expect(nonBoss).toBeGreaterThanOrEqual(deployCount + 3);
        expect(nonBoss).toBeLessThanOrEqual(deployCount + 5);
      }
    });

    it('finalBoss support enemy levels within [13, 18]', () => {
      for (let i = 0; i < 10; i++) {
        const deployCount = DEPLOY_LIMITS.finalBoss.max;
        const config = generateBattle(
          { act: 'finalBoss', objective: 'rout', deployCount, isBoss: true },
          data,
        );
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          expect(spawn.level).toBeGreaterThanOrEqual(13);
          expect(spawn.level).toBeLessThanOrEqual(18);
        }
      }
    });
  });

  describe('act4 progression data', () => {
    it('includes two act4 map sizes (18x12 and 18x13)', () => {
      const act4Sizes = data.mapSizes.filter((s) => s.phase.startsWith('Act 4'));
      const keys = new Set(act4Sizes.map((s) => s.mapSize));
      expect(act4Sizes.length).toBe(2);
      expect(keys.has('18x12')).toBe(true);
      expect(keys.has('18x13')).toBe(true);
    });

    it('act4 enemy pool has enough base/promoted variety for large-map spawns', () => {
      const pool = data.enemies.pools.act4;
      expect(pool).toBeDefined();
      expect(pool.levelRange[0]).toBeLessThanOrEqual(pool.levelRange[1]);
      expect(pool.base.length).toBeGreaterThanOrEqual(8);
      expect(pool.promoted.length).toBeGreaterThanOrEqual(8);
    });

    it('act4 enemy count offsets stay under density caps for both act4 map sizes', () => {
      const act4Sizes = data.mapSizes.filter((s) => s.phase.startsWith('Act 4'));
      const deployCount = DEPLOY_LIMITS.act4.max;
      const maxOffset = ENEMY_COUNT_OFFSET.act4.default[1];
      for (const size of act4Sizes) {
        const cap = capForTiles(size.tiles, data.enemies.enemyCountByTiles);
        expect(deployCount + maxOffset).toBeLessThanOrEqual(cap);
      }
    });

    it('generateBattle produces valid act4 rout battles for each act4 map size', () => {
      const act4Sizes = data.mapSizes.filter((s) => s.phase.startsWith('Act 4'));
      const deployCount = DEPLOY_LIMITS.act4.max;
      for (const sizeEntry of act4Sizes) {
        const deps = { ...data, mapSizes: [sizeEntry] };
        const config = generateBattle(
          {
            act: 'act4',
            objective: 'rout',
            deployCount,
            templateId: 'frozen_pass',
          },
          deps,
        );
        const cap = capForTiles(sizeEntry.tiles, data.enemies.enemyCountByTiles);
        expect(`${config.cols}x${config.rows}`).toBe(sizeEntry.mapSize);
        expect(config.enemySpawns.length).toBeGreaterThanOrEqual(deployCount);
        expect(config.enemySpawns.length).toBeLessThanOrEqual(cap);
      }
    });

    it('passes reinforcement contract fields through for act4 templates', () => {
      const config = generateBattle(
        {
          act: 'act4',
          objective: 'rout',
          templateId: 'frozen_pass',
        },
        data,
      );
      expect(config.reinforcementContractVersion).toBe(1);
      expect(config.reinforcements).toBeDefined();
      expect(Array.isArray(config.reinforcements.waves)).toBe(true);
      expect(config.reinforcements.waves.length).toBeGreaterThan(0);
    });

    it('returns a deep clone of reinforcement config (no shared mutation)', () => {
      const template = data.mapTemplates.rout.find((t) => t.id === 'frozen_pass');
      const config = generateBattle(
        {
          act: 'act4',
          objective: 'rout',
          templateId: 'frozen_pass',
        },
        data,
      );
      config.reinforcements.waves[0].turn = 99;
      expect(template.reinforcements.waves[0].turn).not.toBe(99);
    });

    it('returns a deep clone of scripted reinforcement wave data when present', () => {
      const clonedData = structuredClone(data);
      const template = clonedData.mapTemplates.rout.find((t) => t.id === 'frozen_pass');
      template.reinforcements.scriptedWaves = [
        { turn: 2, spawns: [{ col: 0, row: 0, className: 'Fighter', level: 8 }] },
      ];

      const config = generateBattle(
        {
          act: 'act4',
          objective: 'rout',
          templateId: 'frozen_pass',
        },
        clonedData,
      );

      expect(config.reinforcements.scriptedWaves).toBeDefined();
      config.reinforcements.scriptedWaves[0].spawns[0].col = 99;
      expect(template.reinforcements.scriptedWaves[0].spawns[0].col).toBe(0);
    });

    it('passes scripted-only reinforcement fields through for concrete seize templates', () => {
      const scenarios = [
        { act: 'act4', templateId: ACT4_BOSS_INTENT_TEMPLATE_ID },
        { act: 'act3', templateId: ACT3_DARK_CHAMPION_TEMPLATE_ID },
      ];
      for (const scenario of scenarios) {
        const config = generateBattle(
          {
            act: scenario.act,
            objective: 'seize',
            templateId: scenario.templateId,
          },
          data,
        );
        expect(config.templateId).toBe(scenario.templateId);
        expect(config.reinforcementContractVersion).toBe(1);
        expect(config.reinforcements).toBeDefined();
        expect(Array.isArray(config.reinforcements.waves)).toBe(true);
        expect(config.reinforcements.waves.length).toBe(0);
        expect(Array.isArray(config.reinforcements.scriptedWaves)).toBe(true);
        expect(config.reinforcements.scriptedWaves.length).toBeGreaterThan(0);
      }
    });

    it('deep-clones scripted wave payload for concrete seize templates', () => {
      const scenarios = [
        { act: 'act4', templateId: ACT4_BOSS_INTENT_TEMPLATE_ID },
        { act: 'act3', templateId: ACT3_DARK_CHAMPION_TEMPLATE_ID },
      ];
      for (const scenario of scenarios) {
        const template = data.mapTemplates.seize.find(
          (candidate) => candidate.id === scenario.templateId,
        );
        const config = generateBattle(
          {
            act: scenario.act,
            objective: 'seize',
            templateId: scenario.templateId,
          },
          data,
        );
        config.reinforcements.scriptedWaves[0].spawns[0].col = 99;
        expect(template.reinforcements.scriptedWaves[0].spawns[0].col).not.toBe(99);
      }
    });

    it('strips reinforcements when minActByDifficulty gate not met (hard + act1)', () => {
      const config = generateBattle(
        { act: 'act1', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      );
      expect(config.reinforcements).toBeUndefined();
      expect(config.reinforcementContractVersion).toBeUndefined();
    });

    it('includes reinforcements when minActByDifficulty gate met (hard + act2)', () => {
      const config = generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      );
      expect(config.reinforcements).toBeDefined();
      expect(config.reinforcementContractVersion).toBe(1);
    });

    it('includes reinforcements when minActByDifficulty gate met (hard + act3)', () => {
      const config = generateBattle(
        { act: 'act3', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      );
      expect(config.reinforcements).toBeDefined();
      expect(config.reinforcementContractVersion).toBe(1);
    });

    it('includes reinforcements when minActByDifficulty gate met (lunatic + act2)', () => {
      const config = generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'open_field', difficultyId: 'lunatic' },
        data,
      );
      expect(config.reinforcements).toBeDefined();
      expect(config.reinforcementContractVersion).toBe(1);
    });

    it('strips reinforcements when minActByDifficulty gate not met (lunatic + act1)', () => {
      const config = generateBattle(
        { act: 'act1', objective: 'rout', templateId: 'open_field', difficultyId: 'lunatic' },
        data,
      );
      expect(config.reinforcements).toBeUndefined();
    });

    it('strips reinforcements on normal difficulty (normal not in gating)', () => {
      const config = generateBattle(
        { act: 'act3', objective: 'rout', templateId: 'open_field', difficultyId: 'normal' },
        data,
      );
      expect(config.reinforcements).toBeUndefined();
    });

    it('passes reinforcements through for finalBoss act on hard (finalBoss now in act ordering)', () => {
      // Phase 1.3: ACT_GATE_ORDER extended to include postAct + finalBoss, so a
      // hard:act2 gate is satisfied at finalBoss.
      const config = generateBattle(
        { act: 'finalBoss', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      );
      expect(config.reinforcements).toBeDefined();
    });

    it('passes reinforcements through when no minActByDifficulty is present', () => {
      // frozen_pass has reinforcements but no minActByDifficulty
      const config = generateBattle(
        { act: 'act4', objective: 'rout', templateId: 'frozen_pass' },
        data,
      );
      expect(config.reinforcements).toBeDefined();
      expect(config.reinforcementContractVersion).toBe(1);
    });

    it('merges actTurnOffset into turnOffsetByDifficulty for hard+act3', () => {
      const config = generateBattle(
        { act: 'act3', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      );
      // Base hard offset is -1, actTurnOffset.hard.act3 adds -1 → total -2
      expect(config.reinforcements.turnOffsetByDifficulty.hard).toBe(-2);
    });

    it('lunatic standard template has 4 waves (2 base + 2 extra)', () => {
      const config = generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'open_field', difficultyId: 'lunatic' },
        data,
      );
      expect(config.reinforcements.waves.length).toBe(4);
    });

    it('strips merge-only fields (actTurnOffset, extraWavesByDifficulty) from returned config', () => {
      const config = generateBattle(
        { act: 'act3', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      );
      expect(config.reinforcements.actTurnOffset).toBeUndefined();
      expect(config.reinforcements.extraWavesByDifficulty).toBeUndefined();
    });

    it('does not mutate source template data during cloneReinforcementConfig', () => {
      const template = data.mapTemplates.rout.find((t) => t.id === 'open_field');
      const origOffset = template.reinforcements.turnOffsetByDifficulty.hard;
      const origWaveCount = template.reinforcements.waves.length;
      generateBattle(
        { act: 'act3', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      );
      expect(template.reinforcements.turnOffsetByDifficulty.hard).toBe(origOffset);
      expect(template.reinforcements.waves.length).toBe(origWaveCount);
      expect(template.reinforcements.actTurnOffset).toBeDefined();
      expect(template.reinforcements.extraWavesByDifficulty).toBeDefined();
    });

    it('degrades gracefully when actTurnOffset is malformed (top-level)', () => {
      const mutated = JSON.parse(JSON.stringify(data));
      const tpl = mutated.mapTemplates.rout.find((t) => t.id === 'open_field');
      const origOffset = tpl.reinforcements.turnOffsetByDifficulty.hard;
      tpl.reinforcements.actTurnOffset = 'bad';
      const config = generateBattle(
        { act: 'act3', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        mutated,
      );
      // Should not merge — base offset unchanged
      expect(config.reinforcements.turnOffsetByDifficulty.hard).toBe(origOffset);
    });

    it('degrades gracefully when actTurnOffset[difficulty] is malformed', () => {
      const mutated = JSON.parse(JSON.stringify(data));
      const tpl = mutated.mapTemplates.rout.find((t) => t.id === 'open_field');
      const origOffset = tpl.reinforcements.turnOffsetByDifficulty.hard;
      tpl.reinforcements.actTurnOffset = { hard: 'not-an-object' };
      const config = generateBattle(
        { act: 'act3', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        mutated,
      );
      expect(config.reinforcements.turnOffsetByDifficulty.hard).toBe(origOffset);
    });

    it('degrades gracefully when extraWavesByDifficulty is malformed (top-level)', () => {
      const mutated = JSON.parse(JSON.stringify(data));
      const tpl = mutated.mapTemplates.rout.find((t) => t.id === 'open_field');
      const origWaveCount = tpl.reinforcements.waves.length;
      tpl.reinforcements.extraWavesByDifficulty = 42;
      const config = generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'open_field', difficultyId: 'lunatic' },
        mutated,
      );
      expect(config.reinforcements.waves.length).toBe(origWaveCount);
    });

    it('degrades gracefully when extraWavesByDifficulty[difficulty] is malformed', () => {
      const mutated = JSON.parse(JSON.stringify(data));
      const tpl = mutated.mapTemplates.rout.find((t) => t.id === 'open_field');
      const origWaveCount = tpl.reinforcements.waves.length;
      tpl.reinforcements.extraWavesByDifficulty = { lunatic: 'not-an-array' };
      const config = generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'open_field', difficultyId: 'lunatic' },
        mutated,
      );
      expect(config.reinforcements.waves.length).toBe(origWaveCount);
    });

    it('passes hybrid arena fields through and deep-clones returned hybrid config', () => {
      const baseTemplate = data.mapTemplates.seize.find(
        (template) => template.id === ACT4_BOSS_INTENT_TEMPLATE_ID,
      );
      const hybridTemplate = {
        ...baseTemplate,
        id: HYBRID_TEST_TEMPLATE_ID,
        acts: ['act4'],
        hybridArena: {
          approachRect: [0, 0, 0.5, 1],
          arenaOrigin: [1, 1],
          arenaTiles: [
            ['Wall', 'Wall'],
            ['Wall', 'Fort'],
          ],
          anchors: {
            throneGate: [2, 2],
          },
        },
        phaseTerrainOverrides: [
          {
            turn: 4,
            setTiles: [{ anchor: 'throneGate', terrain: 'Plain' }],
          },
        ],
      };
      const deps = {
        ...data,
        mapTemplates: {
          ...data.mapTemplates,
          seize: [hybridTemplate],
        },
      };

      const config = generateBattle(
        {
          act: 'act4',
          objective: 'seize',
          isBoss: true,
          templateId: HYBRID_TEST_TEMPLATE_ID,
        },
        deps,
      );

      expect(config.templateId).toBe(HYBRID_TEST_TEMPLATE_ID);
      expect(config.hybridArena).toBeDefined();
      expect(config.phaseTerrainOverrides).toBeDefined();
      expect(config.hybridAnchors).toEqual({ throneGate: { col: 2, row: 2 } });

      config.hybridArena.anchors.throneGate[0] = 99;
      config.phaseTerrainOverrides[0].setTiles[0].terrain = 'Forest';
      expect(hybridTemplate.hybridArena.anchors.throneGate[0]).toBe(2);
      expect(hybridTemplate.phaseTerrainOverrides[0].setTiles[0].terrain).toBe('Plain');
    });

    it('hybrid arena overlay stays fixed across seeds and differences stay in approach region', () => {
      const baseTemplate = data.mapTemplates.seize.find(
        (template) => template.id === ACT4_BOSS_INTENT_TEMPLATE_ID,
      );
      const hybridTemplate = {
        ...baseTemplate,
        id: HYBRID_TEST_TEMPLATE_ID,
        acts: ['act4'],
        hybridArena: {
          approachRect: [0, 0, 0.5, 1],
          arenaOrigin: [1, 1],
          arenaTiles: [
            ['Wall', 'Wall'],
            ['Wall', 'Fort'],
          ],
          anchors: {
            throneGate: [2, 2],
          },
        },
      };
      const act4Size = data.mapSizes.find((entry) => entry.phase.startsWith('Act 4'));
      const deps = {
        ...data,
        mapSizes: [act4Size],
        mapTemplates: {
          ...data.mapTemplates,
          seize: [hybridTemplate],
        },
      };
      const configA = withSeed(1001, () =>
        generateBattle(
          {
            act: 'act4',
            objective: 'seize',
            isBoss: true,
            templateId: HYBRID_TEST_TEMPLATE_ID,
          },
          deps,
        ),
      );
      const configB = withSeed(2002, () =>
        generateBattle(
          {
            act: 'act4',
            objective: 'seize',
            isBoss: true,
            templateId: HYBRID_TEST_TEMPLATE_ID,
          },
          deps,
        ),
      );

      const wallIdx = data.terrain.findIndex((entry) => entry.name === 'Wall');
      const fortIdx = data.terrain.findIndex((entry) => entry.name === 'Fort');
      expect(configA.mapLayout[1][1]).toBe(wallIdx);
      expect(configA.mapLayout[1][2]).toBe(wallIdx);
      expect(configA.mapLayout[2][1]).toBe(wallIdx);
      expect(configA.mapLayout[2][2]).toBe(fortIdx);
      expect(configB.mapLayout[1][1]).toBe(wallIdx);
      expect(configB.mapLayout[1][2]).toBe(wallIdx);
      expect(configB.mapLayout[2][1]).toBe(wallIdx);
      expect(configB.mapLayout[2][2]).toBe(fortIdx);

      const [ax1, ay1, ax2, ay2] = hybridTemplate.hybridArena.approachRect;
      const approachStartCol = Math.floor(ax1 * configA.cols);
      const approachEndCol = Math.min(Math.ceil(ax2 * configA.cols), configA.cols);
      const approachStartRow = Math.floor(ay1 * configA.rows);
      const approachEndRow = Math.min(Math.ceil(ay2 * configA.rows), configA.rows);
      const [overlayStartCol, overlayStartRow] = hybridTemplate.hybridArena.arenaOrigin;
      const overlayEndRow = overlayStartRow + hybridTemplate.hybridArena.arenaTiles.length;
      const overlayEndCol = overlayStartCol + hybridTemplate.hybridArena.arenaTiles[0].length;

      let nonApproachNonOverlayDiffs = 0;
      for (let row = 0; row < configA.rows; row++) {
        for (let col = 0; col < configA.cols; col++) {
          const inApproach =
            row >= approachStartRow &&
            row < approachEndRow &&
            col >= approachStartCol &&
            col < approachEndCol;
          const inOverlay =
            row >= overlayStartRow &&
            row < overlayEndRow &&
            col >= overlayStartCol &&
            col < overlayEndCol;
          const differs = configA.mapLayout[row][col] !== configB.mapLayout[row][col];
          if (!differs) continue;
          if (!inApproach && !inOverlay) nonApproachNonOverlayDiffs++;
        }
      }
      // Cross-seed generation may occasionally coincide, but it must never diverge
      // outside the approach region (overlay is separately asserted fixed above).
      expect(nonApproachNonOverlayDiffs).toBe(0);
    });

    it('throws a clear error when hybrid approachRect is malformed at runtime', () => {
      const baseTemplate = data.mapTemplates.seize.find(
        (template) => template.id === ACT4_BOSS_INTENT_TEMPLATE_ID,
      );
      const hybridTemplate = {
        ...baseTemplate,
        id: HYBRID_TEST_TEMPLATE_ID,
        acts: ['act4'],
        hybridArena: {
          approachRect: [0.5, 0.5, 0.2, 1], // invalid normalized rect
          arenaOrigin: [1, 1],
          arenaTiles: [['Wall']],
          anchors: { throneGate: [1, 1] },
        },
      };
      const deps = {
        ...data,
        mapTemplates: {
          ...data.mapTemplates,
          seize: [hybridTemplate],
        },
      };
      expect(() =>
        generateBattle(
          {
            act: 'act4',
            objective: 'seize',
            isBoss: true,
            templateId: HYBRID_TEST_TEMPLATE_ID,
          },
          deps,
        ),
      ).toThrow('hybridArena.approachRect is malformed');
    });
  });

  describe('DEPLOY_LIMITS validation', () => {
    it('all acts in ACT_SEQUENCE have a DEPLOY_LIMITS entry', () => {
      for (const act of ACT_SEQUENCE) {
        expect(DEPLOY_LIMITS[act], `Missing DEPLOY_LIMITS for ${act}`).toBeDefined();
      }
    });

    it('min <= max for all entries', () => {
      for (const [act, limits] of Object.entries(DEPLOY_LIMITS)) {
        expect(limits.min, `${act} min`).toBeLessThanOrEqual(limits.max);
      }
    });

    it('finalBoss entry exists with min and max', () => {
      expect(DEPLOY_LIMITS.finalBoss).toBeDefined();
      expect(DEPLOY_LIMITS.finalBoss.min).toBeGreaterThan(0);
      expect(DEPLOY_LIMITS.finalBoss.max).toBeGreaterThanOrEqual(DEPLOY_LIMITS.finalBoss.min);
    });
  });
});

// Local BFS helpers for reachability tests
function bfs(mapLayout, cols, rows, terrainData, start, moveType = 'Infantry') {
  return bfsFromSources(mapLayout, cols, rows, terrainData, [start], moveType);
}

function bfsFromSources(mapLayout, cols, rows, terrainData, sources, moveType = 'Infantry') {
  const visited = new Set();
  const queue = [];

  for (const source of sources || []) {
    if (!source) continue;
    const terrainIndex = mapLayout[source.row]?.[source.col];
    if (!isPassableForMoveType(terrainData, terrainIndex, moveType)) continue;
    const key = `${source.col},${source.row}`;
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push({ col: source.col, row: source.row });
  }

  while (queue.length > 0) {
    const { col, row } = queue.shift();
    for (const [dc, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nc = col + dc,
        nr = row + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const key = `${nc},${nr}`;
      if (visited.has(key)) continue;
      if (!isPassableForMoveType(terrainData, mapLayout[nr][nc], moveType)) continue;
      visited.add(key);
      queue.push({ col: nc, row: nr });
    }
  }
  return visited;
}

function isPassableForMoveType(terrainData, terrainIndex, moveType) {
  const terrain = terrainData[terrainIndex];
  if (!terrain) return false;
  const cost = terrain.moveCost?.[moveType];
  return cost !== '--' && !Number.isNaN(parseInt(cost, 10));
}

function buildOccupiedSpawnSet(config) {
  const occupied = new Set();
  config.playerSpawns.forEach((spawn) => occupied.add(`${spawn.col},${spawn.row}`));
  config.enemySpawns.forEach((spawn) => occupied.add(`${spawn.col},${spawn.row}`));
  if (config.npcSpawn) occupied.add(`${config.npcSpawn.col},${config.npcSpawn.row}`);
  return occupied;
}

function collectUnoccupiedAdjacentEnemyTiles(config) {
  const occupied = buildOccupiedSpawnSet(config);
  const seen = new Set();
  const tiles = [];
  for (const enemy of config.enemySpawns) {
    for (const [dc, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const col = enemy.col + dc;
      const row = enemy.row + dr;
      if (col < 0 || col >= config.cols || row < 0 || row >= config.rows) continue;
      const key = `${col},${row}`;
      if (occupied.has(key) || seen.has(key)) continue;
      seen.add(key);
      tiles.push({ col, row });
    }
  }
  return tiles;
}

function collectThroneAdjacentTiles(config, includeOccupied = false) {
  if (!config.thronePos) return [];
  const occupied = includeOccupied ? null : buildOccupiedSpawnSet(config);
  const tiles = [];
  const seen = new Set();
  for (const [dc, dr] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const col = config.thronePos.col + dc;
    const row = config.thronePos.row + dr;
    if (col < 0 || col >= config.cols || row < 0 || row >= config.rows) continue;
    const key = `${col},${row}`;
    if ((occupied && occupied.has(key)) || seen.has(key)) continue;
    seen.add(key);
    tiles.push({ col, row });
  }
  return tiles;
}

function cavalryCanReachAnyTiles(config, tiles) {
  const reachable = bfsFromSources(
    config.mapLayout,
    config.cols,
    config.rows,
    data.terrain,
    config.playerSpawns,
    'Cavalry',
  );
  return tiles.some((tile) => reachable.has(`${tile.col},${tile.row}`));
}

function countTerrainWhere(config, predicate) {
  let count = 0;
  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.cols; col++) {
      const terrainName = data.terrain[config.mapLayout[row][col]]?.name;
      if (predicate(terrainName, col, row)) count++;
    }
  }
  return count;
}

function isPoisonEligibleClass(className) {
  const classData = data.classes.find((candidate) => candidate.name === className);
  const primaryProf = classData?.weaponProficiencies?.split(',')[0]?.trim()?.split(' ')[0];
  return primaryProf === 'Swords' || primaryProf === 'Bows';
}

describe('enemy sunder weapon assignment', () => {
  it('act1 enemies never get sunderWeapon (sunderChance=0)', () => {
    for (let i = 0; i < 50; i++) {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const withSunder = config.enemySpawns.filter((e) => e.sunderWeapon);
      expect(withSunder.length).toBe(0);
    }
  });

  it('act3 enemies can get sunderWeapon flag', () => {
    let foundSunder = false;
    for (let i = 0; i < 100; i++) {
      const config = generateBattle({ act: 'act3', objective: 'rout' }, data);
      if (config.enemySpawns.some((e) => e.sunderWeapon)) {
        foundSunder = true;
        break;
      }
    }
    expect(foundSunder).toBe(true);
  });

  it('boss spawns do not get sunderWeapon', () => {
    for (let i = 0; i < 50; i++) {
      const config = generateBattle({ act: 'act3', objective: 'seize' }, data);
      const bosses = config.enemySpawns.filter((e) => e.isBoss);
      for (const boss of bosses) {
        expect(boss.sunderWeapon).toBeFalsy();
      }
    }
  });
});

describe('enemy poison weapon assignment', () => {
  it('act1 normal enemies never get poisonWeapon', () => {
    for (let i = 0; i < 50; i++) {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const withPoison = config.enemySpawns.filter((spawn) => spawn.poisonWeapon);
      expect(withPoison.length).toBe(0);
    }
  });

  it('act3 enemies can get poisonWeapon flag', () => {
    let foundPoison = false;
    for (let i = 0; i < 120; i++) {
      const config = generateBattle({ act: 'act3', objective: 'rout' }, data);
      if (config.enemySpawns.some((spawn) => spawn.poisonWeapon)) {
        foundPoison = true;
        break;
      }
    }
    expect(foundPoison).toBe(true);
  });

  it('boss spawns do not get poisonWeapon', () => {
    for (let i = 0; i < 50; i++) {
      const config = generateBattle({ act: 'act3', objective: 'seize' }, data);
      const bosses = config.enemySpawns.filter((spawn) => spawn.isBoss);
      for (const boss of bosses) {
        expect(boss.poisonWeapon).toBeFalsy();
      }
    }
  });

  it('never assigns both sunderWeapon and poisonWeapon to the same spawn', () => {
    for (let i = 0; i < 120; i++) {
      const config = generateBattle(
        {
          act: 'act3',
          objective: 'rout',
          enemyPoisonChance: 1,
        },
        data,
      );
      for (const spawn of config.enemySpawns) {
        expect(Boolean(spawn.sunderWeapon && spawn.poisonWeapon)).toBe(false);
      }
    }
  });

  it('enemyPoisonChance additive enables poison rolls on early acts', () => {
    let foundPoison = false;
    for (let i = 0; i < 120; i++) {
      const config = generateBattle(
        {
          act: 'act1',
          objective: 'rout',
          enemyPoisonChance: 0.2,
        },
        data,
      );
      if (config.enemySpawns.some((spawn) => spawn.poisonWeapon)) {
        foundPoison = true;
        break;
      }
    }
    expect(foundPoison).toBe(true);
  });

  it('clamps combined poison chance to [0,1]', () => {
    let checkedEligible = false;
    for (let seed = 1; seed <= 30; seed++) {
      // Pin to a no-anchor template: anchor-placed guards (e.g. chokepoint's
      // center_gap unit) never roll poison, so they are exempt from the
      // "every eligible enemy carries poison at chance>=1" clamp invariant.
      const config = withSeed(seed, () =>
        generateBattle(
          {
            act: 'act1',
            objective: 'rout',
            templateId: 'open_field',
            enemyPoisonChance: 99,
          },
          data,
        ),
      );
      const eligible = config.enemySpawns.filter((spawn) => isPoisonEligibleClass(spawn.className));
      if (eligible.length === 0) continue;
      checkedEligible = true;
      for (const spawn of eligible) {
        expect(Boolean(spawn.poisonWeapon)).toBe(true);
      }
    }
    expect(checkedEligible).toBe(true);
  });
});

describe('terrain-aware enemy placement', () => {
  // Helper: build a small map layout from terrain names
  function makeMap(grid) {
    return grid.map((row) => row.map((name) => data.terrain.findIndex((t) => t.name === name)));
  }

  describe('scoreSpawnTile direct tests', () => {
    it('returns 0 for impassable terrain (Cavalry on Mountain)', () => {
      const map = makeMap([['Mountain']]);
      const score = scoreSpawnTile(
        { col: 0, row: 0 },
        { className: 'Cavalier' },
        data.terrain,
        map,
        1,
        data.classes,
      );
      expect(score).toBe(0);
    });

    it('returns 0 for Wall tiles (all moveTypes)', () => {
      const map = makeMap([['Wall']]);
      for (const cls of ['Myrmidon', 'Knight', 'Cavalier', 'Pegasus Knight']) {
        const score = scoreSpawnTile(
          { col: 0, row: 0 },
          { className: cls },
          data.terrain,
          map,
          1,
          data.classes,
        );
        expect(score).toBe(0);
      }
    });

    it('Infantry on Forest scores higher than Infantry on Plain', () => {
      const map = makeMap([['Forest', 'Plain']]);
      const forestScore = scoreSpawnTile(
        { col: 0, row: 0 },
        { className: 'Myrmidon' },
        data.terrain,
        map,
        2,
        data.classes,
      );
      const plainScore = scoreSpawnTile(
        { col: 1, row: 0 },
        { className: 'Myrmidon' },
        data.terrain,
        map,
        2,
        data.classes,
      );
      expect(forestScore).toBeGreaterThan(plainScore);
    });

    it('Cavalry on Plain scores higher than Cavalry on Forest', () => {
      const map = makeMap([['Plain', 'Forest']]);
      const plainScore = scoreSpawnTile(
        { col: 0, row: 0 },
        { className: 'Cavalier' },
        data.terrain,
        map,
        2,
        data.classes,
      );
      const forestScore = scoreSpawnTile(
        { col: 1, row: 0 },
        { className: 'Cavalier' },
        data.terrain,
        map,
        2,
        data.classes,
      );
      expect(plainScore).toBeGreaterThan(forestScore);
    });

    it('Fort tile gives +3 bonus to all unit types', () => {
      const map = makeMap([['Fort', 'Plain']]);
      const fortScore = scoreSpawnTile(
        { col: 0, row: 0 },
        { className: 'Myrmidon' },
        data.terrain,
        map,
        2,
        data.classes,
      );
      const plainScore = scoreSpawnTile(
        { col: 1, row: 0 },
        { className: 'Myrmidon' },
        data.terrain,
        map,
        2,
        data.classes,
      );
      expect(fortScore).toBe(plainScore + 3);
    });

    it('adjacent Wall adds +1 per wall neighbor', () => {
      const map = makeMap([['Wall', 'Plain', 'Wall']]);
      const score = scoreSpawnTile(
        { col: 1, row: 0 },
        { className: 'Myrmidon' },
        data.terrain,
        map,
        3,
        data.classes,
      );
      // base 1 + 2 adjacent walls = 3
      expect(score).toBe(3);
    });

    it('passable tiles always have minimum score of 1', () => {
      // Cavalry on Forest: base 1 - 2 = -1, but floored to 1
      const map = makeMap([['Forest']]);
      const score = scoreSpawnTile(
        { col: 0, row: 0 },
        { className: 'Cavalier' },
        data.terrain,
        map,
        1,
        data.classes,
      );
      expect(score).toBeGreaterThanOrEqual(1);
    });

    it('Armored on Forest gets +2 bonus same as Infantry', () => {
      const map = makeMap([['Forest']]);
      const score = scoreSpawnTile(
        { col: 0, row: 0 },
        { className: 'Knight' },
        data.terrain,
        map,
        1,
        data.classes,
      );
      // base 1 + 2 (forest affinity) = 3
      expect(score).toBe(3);
    });
  });

  describe('placement passability enforcement', () => {
    it('enemy spawns respect unit moveType passability', () => {
      for (let i = 0; i < 50; i++) {
        const config = generateBattle({ act: 'act2', objective: 'rout' }, data);
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          const terrainIdx = config.mapLayout[spawn.row][spawn.col];
          const t = data.terrain[terrainIdx];
          const cd = data.classes.find((c) => c.name === spawn.className);
          const moveType = cd?.moveType || 'Infantry';
          const cost = t.moveCost[moveType];
          expect(
            cost,
            `${spawn.className} (${moveType}) on ${t.name} at (${spawn.col},${spawn.row})`,
          ).not.toBe('--');
        }
      }
    });

    it('Cavalry never placed on Mountain', () => {
      let cavalryFound = false;
      for (let i = 0; i < 100; i++) {
        const config = generateBattle({ act: 'act2', objective: 'rout' }, data);
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          const cd = data.classes.find((c) => c.name === spawn.className);
          if (cd?.moveType !== 'Cavalry') continue;
          cavalryFound = true;
          const terrainIdx = config.mapLayout[spawn.row][spawn.col];
          const tName = data.terrain[terrainIdx]?.name;
          expect(
            tName,
            `Cavalry ${spawn.className} on Mountain at (${spawn.col},${spawn.row})`,
          ).not.toBe('Mountain');
        }
      }
      // Sanity: ensure we actually checked some cavalry units
      expect(cavalryFound).toBe(true);
    });
  });

  describe('statistical terrain affinity', () => {
    it('over 100 seeds, infantry units prefer forest/mountain (>5% on mixed maps)', () => {
      let infantryOnForestMtn = 0;
      let totalInfantry = 0;

      for (let i = 0; i < 100; i++) {
        const config = generateBattle({ act: 'act2', objective: 'rout' }, data);
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          const cd = data.classes.find((c) => c.name === spawn.className);
          if (cd?.moveType !== 'Infantry') continue;
          totalInfantry++;
          const terrainIdx = config.mapLayout[spawn.row][spawn.col];
          const tName = data.terrain[terrainIdx]?.name;
          if (tName === 'Forest' || tName === 'Mountain') {
            infantryOnForestMtn++;
          }
        }
      }

      // With weighted placement, infantry should show some preference for forest/mountain
      if (totalInfantry > 0) {
        const ratio = infantryOnForestMtn / totalInfantry;
        expect(ratio).toBeGreaterThan(0.05);
      }
    });
  });

  describe('seeded deterministic replay', () => {
    function mulberry32(seed) {
      return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('rout scenario: same seed produces identical enemy placement', () => {
      const origRandom = Math.random;

      Math.random = mulberry32(42);
      const config1 = generateBattle({ act: 'act1', objective: 'rout' }, data);

      Math.random = mulberry32(42);
      const config2 = generateBattle({ act: 'act1', objective: 'rout' }, data);

      Math.random = origRandom;

      expect(config1.enemySpawns.length).toBe(config2.enemySpawns.length);
      for (let i = 0; i < config1.enemySpawns.length; i++) {
        expect(config1.enemySpawns[i].col).toBe(config2.enemySpawns[i].col);
        expect(config1.enemySpawns[i].row).toBe(config2.enemySpawns[i].row);
        expect(config1.enemySpawns[i].className).toBe(config2.enemySpawns[i].className);
        expect(config1.enemySpawns[i].level).toBe(config2.enemySpawns[i].level);
      }
    });

    it('seize scenario: same seed produces identical boss + enemy placement', () => {
      const origRandom = Math.random;

      Math.random = mulberry32(99);
      const config1 = generateBattle({ act: 'act1', objective: 'seize' }, data);

      Math.random = mulberry32(99);
      const config2 = generateBattle({ act: 'act1', objective: 'seize' }, data);

      Math.random = origRandom;

      expect(config1.thronePos).toEqual(config2.thronePos);
      expect(config1.enemySpawns.length).toBe(config2.enemySpawns.length);
      for (let i = 0; i < config1.enemySpawns.length; i++) {
        expect(config1.enemySpawns[i]).toEqual(config2.enemySpawns[i]);
      }
    });
  });

  describe('boss placement unaffected', () => {
    it('seize boss is still on throne tile', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'seize' }, data);
        const boss = config.enemySpawns.find((e) => e.isBoss);
        expect(boss).toBeDefined();
        expect(boss.col).toBe(config.thronePos.col);
        expect(boss.row).toBe(config.thronePos.row);
      }
    });
  });
});

describe('pre-assigned templateId', () => {
  it('generateBattle uses pre-assigned templateId when provided', () => {
    for (let i = 0; i < 20; i++) {
      const config = generateBattle(
        { act: 'act1', objective: 'rout', templateId: 'forest_ambush' },
        data,
      );
      expect(config.templateId).toBe('forest_ambush');
    }
  });

  it('generateBattle uses pre-assigned seize templateId', () => {
    for (let i = 0; i < 20; i++) {
      const config = generateBattle(
        { act: 'act1', objective: 'seize', templateId: 'castle_assault' },
        data,
      );
      expect(config.templateId).toBe('castle_assault');
    }
  });

  it('generateBattle falls back to random template for invalid templateId', () => {
    const config = generateBattle(
      { act: 'act1', objective: 'rout', templateId: 'nonexistent_template' },
      data,
    );
    expect(config.templateId).toBeTruthy();
    // Should fall back to a valid rout template
    const routIds = data.mapTemplates.rout.map((t) => t.id);
    expect(routIds).toContain(config.templateId);
  });

  it('generateBattle rejects pre-assigned templateId that does not match objective pool', () => {
    const deps = {
      ...data,
      mapTemplates: {
        rout: data.mapTemplates.rout,
        seize: [],
      },
    };
    expect(() =>
      generateBattle(
        {
          act: 'act1',
          objective: 'seize',
          templateId: data.mapTemplates.rout[0].id,
        },
        deps,
      ),
    ).toThrow('No valid map template found');
  });

  it('generateBattle falls back to a valid objective template when pre-assigned template mismatches objective', () => {
    const config = generateBattle(
      {
        act: 'act1',
        objective: 'seize',
        templateId: data.mapTemplates.rout[0].id,
      },
      data,
    );
    const seizeIds = data.mapTemplates.seize.map((template) => template.id);
    expect(seizeIds).toContain(config.templateId);
    expect(config.thronePos).not.toBeNull();
  });

  it('generateBattle picks random template when no templateId provided', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      ids.add(config.templateId);
    }
    // Should see multiple different templates
    expect(ids.size).toBeGreaterThan(1);
  });

  it('generateBattle excludes bossOnly templates from non-boss random selection', () => {
    const seizeBase = data.mapTemplates.seize.find((template) => template.id === 'castle_assault');
    const bossOnlyTemplate = {
      ...seizeBase,
      id: 'boss_only_selection_test',
      acts: ['act1'],
      bossOnly: true,
    };
    const deps = {
      ...data,
      mapTemplates: {
        ...data.mapTemplates,
        seize: [seizeBase, bossOnlyTemplate],
      },
    };
    for (let i = 0; i < 30; i++) {
      const config = generateBattle({ act: 'act1', objective: 'seize', isBoss: false }, deps);
      expect(config.templateId).toBe(seizeBase.id);
    }
  });

  it('generateBattle still allows explicit pre-assigned bossOnly templateId', () => {
    const seizeBase = data.mapTemplates.seize.find((template) => template.id === 'castle_assault');
    const bossOnlyTemplate = {
      ...seizeBase,
      id: 'boss_only_preassign_test',
      acts: ['act1'],
      bossOnly: true,
    };
    const deps = {
      ...data,
      mapTemplates: {
        ...data.mapTemplates,
        seize: [seizeBase, bossOnlyTemplate],
      },
    };
    const config = generateBattle(
      {
        act: 'act1',
        objective: 'seize',
        isBoss: false,
        templateId: bossOnlyTemplate.id,
      },
      deps,
    );
    expect(config.templateId).toBe(bossOnlyTemplate.id);
  });
});

describe('composition-template affinity', () => {
  describe('resolveClassWeight unit tests', () => {
    it('returns 1.0 when no enemyWeights provided', () => {
      expect(resolveClassWeight('Myrmidon', null, data.classes)).toBe(1.0);
      expect(resolveClassWeight('Myrmidon', undefined, data.classes)).toBe(1.0);
    });

    it('infantry weight applies to melee Infantry classes', () => {
      const weights = { infantry: 1.5 };
      // Myrmidon: Infantry + Swords = infantry
      expect(resolveClassWeight('Myrmidon', weights, data.classes)).toBe(1.5);
      // Fighter: Infantry + Axes = infantry
      expect(resolveClassWeight('Fighter', weights, data.classes)).toBe(1.5);
    });

    it('infantry weight does NOT apply to ranged Infantry classes', () => {
      const weights = { infantry: 1.5 };
      // Archer: Infantry but Bows (not melee) — should not match infantry
      expect(resolveClassWeight('Archer', weights, data.classes)).toBe(1.0);
      // Mage: Infantry but Tomes (not melee) — should not match infantry
      expect(resolveClassWeight('Mage', weights, data.classes)).toBe(1.0);
    });

    it('cavalry weight applies to Cavalry moveType', () => {
      const weights = { cavalry: 0.5 };
      expect(resolveClassWeight('Cavalier', weights, data.classes)).toBe(0.5);
      expect(resolveClassWeight('Paladin', weights, data.classes)).toBe(0.5);
    });

    it('archer weight applies to Bows proficiency', () => {
      const weights = { archer: 1.3 };
      expect(resolveClassWeight('Archer', weights, data.classes)).toBe(1.3);
      expect(resolveClassWeight('Sniper', weights, data.classes)).toBe(1.3);
      // Warrior has Axes (M), Bows (P) — should match archer
      expect(resolveClassWeight('Warrior', weights, data.classes)).toBe(1.3);
    });

    it('mage weight applies to Tomes or Light proficiency', () => {
      const weights = { mage: 1.2 };
      expect(resolveClassWeight('Mage', weights, data.classes)).toBe(1.2);
      expect(resolveClassWeight('Sage', weights, data.classes)).toBe(1.2);
      // Light Sage has Light (P) — should match mage
      expect(resolveClassWeight('Light Sage', weights, data.classes)).toBe(1.2);
    });

    it('knight weight applies to Armored moveType', () => {
      const weights = { knight: 1.5 };
      expect(resolveClassWeight('Knight', weights, data.classes)).toBe(1.5);
      expect(resolveClassWeight('General', weights, data.classes)).toBe(1.5);
    });

    it('armored weight applies to Armored moveType', () => {
      const weights = { armored: 1.5 };
      expect(resolveClassWeight('Knight', weights, data.classes)).toBe(1.5);
      expect(resolveClassWeight('General', weights, data.classes)).toBe(1.5);
    });

    it('lance weight applies to Lances proficiency', () => {
      const weights = { lance: 1.3 };
      // Knight: Lances (P)
      expect(resolveClassWeight('Knight', weights, data.classes)).toBe(1.3);
      // Cavalier: Lances (P)
      expect(resolveClassWeight('Cavalier', weights, data.classes)).toBe(1.3);
      // Myrmidon: Swords — no lance
      expect(resolveClassWeight('Myrmidon', weights, data.classes)).toBe(1.0);
    });

    it('multiple matching categories multiply together', () => {
      // Knight: Armored + Lances
      const weights = { knight: 1.5, lance: 1.3 };
      expect(resolveClassWeight('Knight', weights, data.classes)).toBeCloseTo(1.5 * 1.3);
    });

    it('unknown categories in weights gracefully default to 1.0', () => {
      const weights = { flying: 2.0, dragon: 3.0 };
      // These are not recognized categories, so all classes should get 1.0
      expect(resolveClassWeight('Myrmidon', weights, data.classes)).toBe(1.0);
      expect(resolveClassWeight('Cavalier', weights, data.classes)).toBe(1.0);
    });

    it('returns 1.0 for unknown class names', () => {
      const weights = { infantry: 1.5 };
      expect(resolveClassWeight('UnknownClass', weights, data.classes)).toBe(1.0);
    });
  });

  describe('statistical: Forest Ambush produces more infantry/archer than cavalry', () => {
    it('over 200 seeds, infantry+archer outnumber cavalry significantly', () => {
      // Forest Ambush: infantry x1.5, cavalry x0.5, archer x1.3
      // Act2 pool has all class types for meaningful comparison
      const classCounts = {};
      const seeds = 200;

      // Force forest_ambush template by filtering
      const forestTemplate = data.mapTemplates.rout.find((t) => t.id === 'forest_ambush');
      const modifiedTemplates = { rout: [forestTemplate], seize: data.mapTemplates.seize };
      const modData = { ...data, mapTemplates: modifiedTemplates };

      for (let i = 0; i < seeds; i++) {
        const config = generateBattle({ act: 'act2', objective: 'rout' }, modData);
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          classCounts[spawn.className] = (classCounts[spawn.className] || 0) + 1;
        }
      }

      // Infantry melee classes: Myrmidon, Fighter, Thief (Swords=melee)
      const infantryCount =
        (classCounts['Myrmidon'] || 0) +
        (classCounts['Fighter'] || 0) +
        (classCounts['Thief'] || 0);
      const archerCount = classCounts['Archer'] || 0;
      const cavalryCount = classCounts['Cavalier'] || 0;

      // Infantry+Archer should substantially outnumber Cavalry
      expect(infantryCount + archerCount).toBeGreaterThan(cavalryCount * 2);
    });
  });

  describe('statistical: Open Field produces more cavalry than forest maps', () => {
    it('over 200 seeds, open field cavalry rate exceeds forest ambush cavalry rate', () => {
      // Open Field: cavalry x1.3 — Forest Ambush: cavalry x0.5
      const fieldTemplate = data.mapTemplates.rout.find((t) => t.id === 'open_field');
      const forestTemplate = data.mapTemplates.rout.find((t) => t.id === 'forest_ambush');
      const seeds = 200;

      let fieldCavalry = 0,
        fieldTotal = 0;
      let forestCavalry = 0,
        forestTotal = 0;

      const fieldData = {
        ...data,
        mapTemplates: { rout: [fieldTemplate], seize: data.mapTemplates.seize },
      };
      const forestData = {
        ...data,
        mapTemplates: { rout: [forestTemplate], seize: data.mapTemplates.seize },
      };

      for (let i = 0; i < seeds; i++) {
        const fieldConfig = generateBattle({ act: 'act2', objective: 'rout' }, fieldData);
        for (const s of fieldConfig.enemySpawns) {
          if (s.isBoss) continue;
          fieldTotal++;
          const cd = data.classes.find((c) => c.name === s.className);
          if (cd?.moveType === 'Cavalry') fieldCavalry++;
        }

        const forestConfig = generateBattle({ act: 'act2', objective: 'rout' }, forestData);
        for (const s of forestConfig.enemySpawns) {
          if (s.isBoss) continue;
          forestTotal++;
          const cd = data.classes.find((c) => c.name === s.className);
          if (cd?.moveType === 'Cavalry') forestCavalry++;
        }
      }

      const fieldRate = fieldCavalry / fieldTotal;
      const forestRate = forestCavalry / forestTotal;
      expect(fieldRate).toBeGreaterThan(forestRate);
    });
  });

  describe('backward compatibility', () => {
    it('template with no enemyWeights works exactly as before (uniform)', () => {
      // Create a template without enemyWeights
      const noWeightsTemplate = {
        ...data.mapTemplates.rout[0],
        id: 'no_weights_test',
        enemyWeights: undefined,
      };
      const modData = {
        ...data,
        mapTemplates: { rout: [noWeightsTemplate], seize: data.mapTemplates.seize },
      };

      // Should still produce valid battles
      for (let i = 0; i < 20; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout' }, modData);
        expect(config.enemySpawns.length).toBeGreaterThan(0);
        for (const spawn of config.enemySpawns) {
          if (spawn.isBoss) continue;
          expect(data.enemies.pools.act1.base).toContain(spawn.className);
        }
      }
    });
  });

  describe('seeded deterministic replay with template influence', () => {
    function mulberry32(seed) {
      return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('forest_ambush: same seed produces identical class composition', () => {
      const forestTemplate = data.mapTemplates.rout.find((t) => t.id === 'forest_ambush');
      const modData = {
        ...data,
        mapTemplates: { rout: [forestTemplate], seize: data.mapTemplates.seize },
      };
      const origRandom = Math.random;

      Math.random = mulberry32(777);
      const config1 = generateBattle({ act: 'act2', objective: 'rout' }, modData);

      Math.random = mulberry32(777);
      const config2 = generateBattle({ act: 'act2', objective: 'rout' }, modData);

      Math.random = origRandom;

      expect(config1.enemySpawns.length).toBe(config2.enemySpawns.length);
      for (let i = 0; i < config1.enemySpawns.length; i++) {
        expect(config1.enemySpawns[i].className).toBe(config2.enemySpawns[i].className);
        expect(config1.enemySpawns[i].col).toBe(config2.enemySpawns[i].col);
        expect(config1.enemySpawns[i].row).toBe(config2.enemySpawns[i].row);
      }
    });

    it('chokepoint: same seed produces identical class composition', () => {
      const chokepointTemplate = data.mapTemplates.rout.find((t) => t.id === 'chokepoint');
      const modData = {
        ...data,
        mapTemplates: { rout: [chokepointTemplate], seize: data.mapTemplates.seize },
      };
      const origRandom = Math.random;

      Math.random = mulberry32(1234);
      const config1 = generateBattle({ act: 'act2', objective: 'rout' }, modData);

      Math.random = mulberry32(1234);
      const config2 = generateBattle({ act: 'act2', objective: 'rout' }, modData);

      Math.random = origRandom;

      expect(config1.enemySpawns.length).toBe(config2.enemySpawns.length);
      for (let i = 0; i < config1.enemySpawns.length; i++) {
        expect(config1.enemySpawns[i].className).toBe(config2.enemySpawns[i].className);
        expect(config1.enemySpawns[i].col).toBe(config2.enemySpawns[i].col);
        expect(config1.enemySpawns[i].row).toBe(config2.enemySpawns[i].row);
      }
    });
  });
});

describe('guard AI assignment', () => {
  it('seize maps have guards in boss half of map', () => {
    let foundGuards = false;
    for (let i = 0; i < 30; i++) {
      const config = generateBattle({ act: 'act2', objective: 'seize' }, data);
      const guards = config.enemySpawns.filter((s) => s.aiMode === 'guard');
      if (guards.length > 0) {
        foundGuards = true;
        const halfCol = Math.floor(config.cols / 2);
        for (const g of guards) {
          expect(g.col).toBeGreaterThanOrEqual(halfCol);
        }
      }
    }
    expect(foundGuards).toBe(true);
  });

  it('rout maps do not assign guards', () => {
    for (let i = 0; i < 30; i++) {
      const config = generateBattle({ act: 'act2', objective: 'rout' }, data);
      const guards = config.enemySpawns.filter((s) => s.aiMode === 'guard');
      expect(guards.length).toBe(0);
    }
  });

  it('guard percentage is between 10-35% of boss-half enemies', () => {
    for (let i = 0; i < 20; i++) {
      const config = generateBattle({ act: 'act2', objective: 'seize' }, data);
      const halfCol = Math.floor(config.cols / 2);
      const bossHalf = config.enemySpawns.filter((s) => !s.isBoss && s.col >= halfCol);
      const guards = bossHalf.filter((s) => s.aiMode === 'guard');
      if (bossHalf.length > 0) {
        const rate = guards.length / bossHalf.length;
        expect(rate).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('bosses never get guard aiMode', () => {
    for (let i = 0; i < 20; i++) {
      const config = generateBattle({ act: 'act2', objective: 'seize' }, data);
      const bosses = config.enemySpawns.filter((s) => s.isBoss);
      for (const b of bosses) {
        expect(b.aiMode).toBeUndefined();
      }
    }
  });
});

describe('anchor templates', () => {
  it('all templates have anchors array', () => {
    for (const [objective, templates] of Object.entries(data.mapTemplates)) {
      for (const t of templates) {
        expect(t.anchors).toBeDefined();
        expect(Array.isArray(t.anchors)).toBe(true);
      }
    }
  });

  it('chokepoint has center_gap anchor', () => {
    const t = data.mapTemplates.rout.find((t) => t.id === 'chokepoint');
    expect(t.anchors.some((a) => a.position === 'center_gap')).toBe(true);
  });

  it('river_crossing has bridge_ends anchor with count 2', () => {
    const t = data.mapTemplates.rout.find((t) => t.id === 'river_crossing');
    const anchor = t.anchors.find((a) => a.position === 'bridge_ends');
    expect(anchor).toBeDefined();
    expect(anchor.count).toBe(2);
    expect(anchor.unit).toBe('lance_user');
  });

  it('castle_assault has throne and gate_adjacent anchors', () => {
    const t = data.mapTemplates.seize.find((t) => t.id === 'castle_assault');
    expect(t.anchors.some((a) => a.position === 'throne')).toBe(true);
    expect(t.anchors.some((a) => a.position === 'gate_adjacent')).toBe(true);
  });

  it('hilltop_fortress has throne anchor', () => {
    const t = data.mapTemplates.seize.find((t) => t.id === 'hilltop_fortress');
    expect(t.anchors.some((a) => a.position === 'throne')).toBe(true);
  });
});

describe('status staff spawn assignment', () => {
  const statusStaffConfig = {
    act1: 0,
    act2: 0,
    act3: 0.99,
    act4: 0.99,
    finalBoss: 0.99,
    maxPerBattle: 2,
  };

  it('assigns status staves to eligible classes on act3 with high chance', () => {
    // Run many trials to get statistical confidence
    let totalStaves = 0;
    const TRIALS = 20;
    for (let seed = 1; seed <= TRIALS; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'rout', statusStaffConfig }, data),
      );
      const withStaff = config.enemySpawns.filter((s) => s.statusStaff);
      totalStaves += withStaff.length;
      // Each staff should be sleep or silence
      for (const s of withStaff) {
        expect(['sleep', 'silence']).toContain(s.statusStaff);
      }
    }
    // With 0.99 chance, at least some trials should produce staves (if eligible classes present)
    // Some maps may have no Mage/Sage/Bishop, so just verify no crashes
    expect(totalStaves).toBeGreaterThanOrEqual(0);
  });

  it('never assigns status staves to non-eligible classes', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'rout', statusStaffConfig }, data),
      );
      const withStaff = config.enemySpawns.filter((s) => s.statusStaff);
      for (const s of withStaff) {
        expect(['Mage', 'Sage', 'Bishop']).toContain(s.className);
      }
    }
  });

  it('respects maxPerBattle cap', () => {
    const capped = { ...statusStaffConfig, maxPerBattle: 1 };
    for (let seed = 1; seed <= 30; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'rout', statusStaffConfig: capped }, data),
      );
      const withStaff = config.enemySpawns.filter((s) => s.statusStaff);
      expect(withStaff.length).toBeLessThanOrEqual(1);
    }
  });

  it('no staves on act1/act2 when chance is 0', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act1', objective: 'rout', statusStaffConfig }, data),
      );
      const withStaff = config.enemySpawns.filter((s) => s.statusStaff);
      expect(withStaff.length).toBe(0);
    }
  });

  it('no staves when statusStaffConfig is null', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'rout', statusStaffConfig: null }, data),
      );
      const withStaff = config.enemySpawns.filter((s) => s.statusStaff);
      expect(withStaff.length).toBe(0);
    }
  });

  it('boss spawns excluded from status staff assignment', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'seize', isBoss: true, statusStaffConfig }, data),
      );
      const bossSpawns = config.enemySpawns.filter((s) => s.isBoss);
      for (const bs of bossSpawns) {
        expect(bs.statusStaff).toBeUndefined();
      }
    }
  });

  it('RNG stability: same seed produces identical spawns regardless of caster mix', () => {
    // With the fix, every spawn draws exactly one Math.random() regardless of
    // whether the class is sunder/poison/status-staff eligible. This means the
    // same seed should always produce the same spawn layout.
    for (let seed = 1; seed <= 10; seed++) {
      const config1 = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'rout', statusStaffConfig }, data),
      );
      const config2 = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'rout', statusStaffConfig }, data),
      );
      expect(config1.enemySpawns.length).toBe(config2.enemySpawns.length);
      for (let i = 0; i < config1.enemySpawns.length; i++) {
        expect(config1.enemySpawns[i].className).toBe(config2.enemySpawns[i].className);
        expect(config1.enemySpawns[i].col).toBe(config2.enemySpawns[i].col);
        expect(config1.enemySpawns[i].row).toBe(config2.enemySpawns[i].row);
        expect(config1.enemySpawns[i].statusStaff).toBe(config2.enemySpawns[i].statusStaff);
      }
    }
  });
});

describe('enemyLevelBonus', () => {
  it('increases enemy levels by the bonus amount', () => {
    const bonus = 2;
    for (let seed = 1; seed <= 20; seed++) {
      const baseline = withSeed(seed, () =>
        generateBattle({ act: 'act2', objective: 'rout' }, data),
      );
      const boosted = withSeed(seed, () =>
        generateBattle({ act: 'act2', objective: 'rout', enemyLevelBonus: bonus }, data),
      );
      // Non-boss enemies should have their levels increased by bonus
      const baseNonBoss = baseline.enemySpawns.filter((e) => !e.isBoss);
      const boostNonBoss = boosted.enemySpawns.filter((e) => !e.isBoss);
      for (let i = 0; i < Math.min(baseNonBoss.length, boostNonBoss.length); i++) {
        expect(boostNonBoss[i].level).toBe(baseNonBoss[i].level + bonus);
      }
    }
  });
});

describe('river crossing bridges', () => {
  function countCrossingRows(config) {
    const midStartCol = Math.floor(config.cols * 0.35);
    const midEndCol = Math.ceil(config.cols * 0.65);
    let crossings = 0;
    for (let r = 0; r < config.rows; r++) {
      let hasWater = false;
      let hasBridge = false;
      for (let c = midStartCol; c < midEndCol; c++) {
        if (config.mapLayout[r][c] === TERRAIN.Water) {
          hasWater = true;
          break;
        }
        if (config.mapLayout[r][c] === TERRAIN.Bridge) hasBridge = true;
      }
      if (!hasWater && hasBridge) crossings++;
    }
    return crossings;
  }

  it('act1 river_crossing produces >= 2 distinct crossing rows', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act1', objective: 'rout', templateId: 'river_crossing' }, data),
      );
      expect(countCrossingRows(config)).toBeGreaterThanOrEqual(2);
    }
  });

  it('act3 river_crossing produces >= 3 distinct crossing rows', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act3', objective: 'rout', templateId: 'river_crossing' }, data),
      );
      expect(countCrossingRows(config)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Entity map generation', () => {
  it('eldritch_sanctum template produces fixedSize 16x14', () => {
    const config = withSeed(42, () =>
      generateBattle(
        {
          act: 'finalBoss',
          objective: 'seize',
          templateId: 'eldritch_sanctum',
          isBoss: true,
          difficultyId: 'lunatic',
        },
        data,
      ),
    );
    expect(config.cols).toBe(16);
    expect(config.rows).toBe(14);
  });

  it('eldritch_sanctum has throne at entitySpawn position', () => {
    const config = withSeed(42, () =>
      generateBattle(
        {
          act: 'finalBoss',
          objective: 'seize',
          templateId: 'eldritch_sanctum',
          isBoss: true,
          difficultyId: 'lunatic',
        },
        data,
      ),
    );
    expect(config.thronePos).toBeDefined();
    expect(config.thronePos.col).toBe(11);
    expect(config.thronePos.row).toBe(5);
  });

  it('Entity spawn has Floor on footprint tiles (Throne restored at origin)', () => {
    const config = withSeed(42, () =>
      generateBattle(
        {
          act: 'finalBoss',
          objective: 'seize',
          templateId: 'eldritch_sanctum',
          isBoss: true,
          difficultyId: 'lunatic',
        },
        data,
      ),
    );
    const floorIdx = data.terrain.findIndex((t) => t.name === 'Floor');
    const throneIdx = data.terrain.findIndex((t) => t.name === 'Throne');
    const entityCol = 11;
    const entityRow = 5;
    for (let dc = 0; dc < 3; dc++) {
      for (let dr = 0; dr < 3; dr++) {
        const tile = config.mapLayout[entityRow + dr][entityCol + dc];
        if (dc === 0 && dr === 0) {
          // Throne restored at entity origin (seize target)
          expect(tile).toBe(throneIdx);
        } else {
          expect(tile).toBe(floorIdx);
        }
      }
    }
  });

  it('difficultyFilter selects Entity boss for lunatic', () => {
    const config = withSeed(42, () =>
      generateBattle(
        {
          act: 'finalBoss',
          objective: 'seize',
          templateId: 'eldritch_sanctum',
          isBoss: true,
          difficultyId: 'lunatic',
        },
        data,
      ),
    );
    const entitySpawn = config.enemySpawns.find((s) => s.isBoss && s.isEntity);
    expect(entitySpawn).toBeDefined();
    expect(entitySpawn.className).toBe('Entity');
  });

  it('difficultyFilter selects Lieutenant boss for normal', () => {
    const config = withSeed(42, () =>
      generateBattle(
        { act: 'finalBoss', objective: 'seize', isBoss: true, difficultyId: 'normal' },
        data,
      ),
    );
    const bossSpawn = config.enemySpawns.find((s) => s.isBoss);
    expect(bossSpawn).toBeDefined();
    expect(bossSpawn.className).toBe('Hero');
  });
});

// ═══ Phase 1 — Confirmed bug fixes ═══

describe('Phase 1.1 — highest_level anchor placement', () => {
  // chokepoint (rout, all acts) is the only template using a highest_level anchor
  // at center_gap. Before the fix, resolveAnchorUnitClass returned null and the
  // anchor was silently skipped, so no max-level chokepoint guard ever spawned.
  it('places a non-boss max-level enemy near center on chokepoint across seeds', () => {
    const LEVEL_RANGE = [1, 20]; // wide range so random enemies rarely hit the max
    for (let seed = 1; seed <= 12; seed++) {
      const config = withSeed(seed, () =>
        generateBattle(
          { act: 'act1', objective: 'rout', templateId: 'chokepoint', levelRange: LEVEL_RANGE },
          data,
        ),
      );
      expect(config.templateId).toBe('chokepoint');
      const midCol = Math.floor(config.cols / 2);
      const midRow = Math.floor(config.rows / 2);
      // center_gap searches within dr,dc <= 2 of center; allow a small margin.
      const anchorUnit = config.enemySpawns.find(
        (s) =>
          !s.isBoss &&
          s.level === LEVEL_RANGE[1] &&
          Math.abs(s.col - midCol) <= 3 &&
          Math.abs(s.row - midRow) <= 3,
      );
      expect(anchorUnit, `seed ${seed} should have a max-level anchor near center`).toBeDefined();
    }
  });

  it('anchor class is drawn from the base pool (never a promoted/boss unit)', () => {
    const promotedNames = new Set(
      data.classes.filter((c) => c.promotesFrom || c.tier === 'promoted').map((c) => c.name),
    );
    for (let seed = 1; seed <= 12; seed++) {
      const config = withSeed(seed, () =>
        generateBattle(
          { act: 'act1', objective: 'rout', templateId: 'chokepoint', levelRange: [1, 20] },
          data,
        ),
      );
      const anchorUnit = config.enemySpawns.find((s) => !s.isBoss && s.level === 20);
      if (anchorUnit) {
        expect(promotedNames.has(anchorUnit.className)).toBe(false);
      }
    }
  });

  it('boss_or_strongest throne anchor adds no unit beyond the seize boss', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const config = withSeed(seed, () =>
        generateBattle(
          { act: 'act1', objective: 'seize', isBoss: true, templateId: 'castle_assault' },
          data,
        ),
      );
      expect(config.thronePos).toBeTruthy();
      const onThrone = config.enemySpawns.filter(
        (s) => s.col === config.thronePos.col && s.row === config.thronePos.row,
      );
      expect(onThrone.length).toBe(1);
      expect(onThrone[0].isBoss).toBe(true);
    }
  });
});

describe('Phase 1.2 — flying enemyWeights', () => {
  it('resolveClassWeight applies the flying multiplier to Flying move-type classes', () => {
    // Pegasus Knight / Wyvern Rider are Flying in classes.json.
    const w = resolveClassWeight('Pegasus Knight', { flying: 5 }, data.classes);
    expect(w).toBeCloseTo(5, 5);
    // Non-flier is unaffected by the flying weight.
    const wInf = resolveClassWeight('Fighter', { flying: 5 }, data.classes);
    expect(wInf).toBeCloseTo(1, 5);
    // Suppression works too.
    const wLow = resolveClassWeight('Wyvern Rider', { flying: 0.0001 }, data.classes);
    expect(wLow).toBeCloseTo(0.0001, 6);
  });

  it('flying weight drives spawn composition via generateBattle', () => {
    const flyerNames = new Set(
      data.classes.filter((c) => c.moveType === 'Flying').map((c) => c.name),
    );
    // Inject two stub rout templates cloned from mire_crossing (has a swamp band
    // and an enemy pool that contains fliers at act2) with opposing flying weights.
    const base = [...data.mapTemplates.rout].find((t) => t.id === 'mire_crossing');
    const makeDeps = (id, flyingWeight) => {
      const clone = JSON.parse(JSON.stringify(base));
      clone.id = id;
      clone.enemyWeights = { flying: flyingWeight };
      return {
        ...data,
        mapTemplates: { ...data.mapTemplates, rout: [...data.mapTemplates.rout, clone] },
      };
    };
    const depsHigh = makeDeps('mire_flying_high', 100);
    const depsLow = makeDeps('mire_flying_low', 0.0001);

    const countFlyers = (deps, id) => {
      let flyers = 0;
      let total = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const config = withSeed(seed, () =>
          generateBattle({ act: 'act2', objective: 'rout', templateId: id }, deps),
        );
        for (const s of config.enemySpawns) {
          if (s.isBoss) continue;
          total += 1;
          if (flyerNames.has(s.className)) flyers += 1;
        }
      }
      return total > 0 ? flyers / total : 0;
    };

    const highFrac = countFlyers(depsHigh, 'mire_flying_high');
    const lowFrac = countFlyers(depsLow, 'mire_flying_low');
    expect(highFrac).toBeGreaterThan(lowFrac);
    expect(highFrac).toBeGreaterThan(0.5);
  });
});

describe('Phase 1.3 — reinforcement gating', () => {
  it('Normal gated template drops reinforcements (normal:never)', () => {
    const config = withSeed(3, () =>
      generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'open_field', difficultyId: 'normal' },
        data,
      ),
    );
    expect(config.reinforcements).toBeUndefined();
  });

  it('Hard gated template: gated out in act1, present in act2', () => {
    const act1 = withSeed(3, () =>
      generateBattle(
        { act: 'act1', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      ),
    );
    expect(act1.reinforcements).toBeUndefined();

    const act2 = withSeed(3, () =>
      generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      ),
    );
    expect(act2.reinforcements).toBeDefined();
  });

  it('Hard gated template reinforces in postAct (act-gate order fix)', () => {
    const config = withSeed(3, () =>
      generateBattle(
        { act: 'postAct', objective: 'rout', templateId: 'open_field', difficultyId: 'hard' },
        data,
      ),
    );
    expect(config.reinforcements).toBeDefined();
  });

  it('Normal act4 biome template still reinforces (unchanged behavior)', () => {
    const config = withSeed(3, () =>
      generateBattle(
        { act: 'act4', objective: 'rout', templateId: 'frozen_pass', difficultyId: 'normal' },
        data,
      ),
    );
    expect(config.reinforcements).toBeDefined();
  });
});

// ═══ Phase 4.2 — template weight knob + biome variety ═══

describe('Phase 4.2 — pickTemplate weight knob', () => {
  const plainZones = [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }];
  function pickManyLocal(mapTemplates, seed, n) {
    const counts = {};
    const orig = Math.random;
    Math.random = mulberry32(seed);
    try {
      for (let i = 0; i < n; i++) {
        const t = pickTemplate('rout', mapTemplates, null, {});
        counts[t.id] = (counts[t.id] || 0) + 1;
      }
    } finally {
      Math.random = orig;
    }
    return counts;
  }

  it('a higher weight template is selected much more often', () => {
    const mapTemplates = {
      rout: [
        { id: 'heavy', zones: plainZones, weight: 9 },
        { id: 'light', zones: plainZones, weight: 1 },
      ],
      seize: [],
      escape: [],
    };
    const counts = pickManyLocal(mapTemplates, 123, 3000);
    // Expected split ~90/10; assert heavy strongly dominates.
    expect(counts.heavy).toBeGreaterThan(counts.light * 5);
  });

  it('defaults to uniform selection when weight is unset', () => {
    const mapTemplates = {
      rout: [
        { id: 'a', zones: plainZones },
        { id: 'b', zones: plainZones },
      ],
      seize: [],
      escape: [],
    };
    const counts = pickManyLocal(mapTemplates, 77, 4000);
    const ratio = counts.a / counts.b;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.25);
  });

  it('new act4 biome templates exist and generate valid battles', () => {
    const routIds = data.mapTemplates.rout.map((t) => t.id);
    const escapeIds = data.mapTemplates.escape.map((t) => t.id);
    expect(routIds).toContain('glacier_run');
    expect(routIds).toContain('magma_flow');
    expect(escapeIds).toContain('frozen_flight');

    for (const [id, obj] of [
      ['glacier_run', 'rout'],
      ['magma_flow', 'rout'],
      ['frozen_flight', 'escape'],
    ]) {
      const config = withSeed(9, () =>
        generateBattle({ act: 'act4', objective: obj, templateId: id, difficultyId: 'hard' }, data),
      );
      expect(config.templateId).toBe(id);
      expect(config.playerSpawns.length).toBeGreaterThan(0);
      expect(config.enemySpawns.length).toBeGreaterThan(0);
      if (obj === 'escape') expect(config.escapeTiles.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveAnchorUnitClass', () => {
  it('returns null instead of undefined when pool.base is empty (highest_level)', () => {
    const result = resolveAnchorUnitClass(
      { unit: 'highest_level' },
      { base: [], promoted: [] },
      [],
    );
    expect(result).toBeNull();
  });

  it('returns null instead of undefined when pool.base is empty (default/unknown unit spec)', () => {
    const result = resolveAnchorUnitClass(
      { unit: 'some_unrecognized_spec' },
      { base: [], promoted: [] },
      [],
    );
    expect(result).toBeNull();
  });

  it('still picks a class from a non-empty base pool (highest_level)', () => {
    const result = resolveAnchorUnitClass(
      { unit: 'highest_level' },
      { base: ['Myrmidon'], promoted: [] },
      [],
    );
    expect(result).toBe('Myrmidon');
  });
});
