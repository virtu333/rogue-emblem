import { describe, it, expect } from 'vitest';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { DEPLOY_LIMITS, ACT_SEQUENCE, ENEMY_COUNT_OFFSET } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

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
      const bosses = config.enemySpawns.filter(e => e.isBoss);
      expect(bosses.length).toBe(1);
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
      const throneIdx = data.terrain.findIndex(t => t.name === 'Throne');
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
        ...config.playerSpawns.map(s => `${s.col},${s.row}`),
        ...config.enemySpawns.map(s => `${s.col},${s.row}`),
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
        const reachable = bfs(config.mapLayout, config.cols, config.rows, data.terrain, config.playerSpawns[0]);

        for (const enemy of config.enemySpawns) {
          expect(reachable.has(`${enemy.col},${enemy.row}`),
            `Enemy at (${enemy.col},${enemy.row}) unreachable on iteration ${i}`
          ).toBe(true);
        }
      }
    });

    it('throne is reachable on seize maps', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'seize' }, data);
        const reachable = bfs(config.mapLayout, config.cols, config.rows, data.terrain, config.playerSpawns[0]);
        const tp = config.thronePos;
        expect(reachable.has(`${tp.col},${tp.row}`),
          `Throne at (${tp.col},${tp.row}) unreachable on iteration ${i}`
        ).toBe(true);
      }
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
        const bosses = config.enemySpawns.filter(e => e.isBoss);
        expect(bosses.length).toBe(1);
        expect(bosses[0].name).toBeTruthy();
      }
    });
  });

  describe('all acts generate without errors', () => {
    for (const act of ['act1', 'act2', 'act3', 'postAct', 'finalBoss']) {
      for (const objective of ['rout', 'seize']) {
        it(`${act} / ${objective}`, () => {
          const config = generateBattle({ act, objective }, data);
          expect(config.mapLayout.length).toBe(config.rows);
          expect(config.enemySpawns.length).toBeGreaterThan(0);
          expect(config.playerSpawns.length).toBeGreaterThanOrEqual(2);
        });
      }
    }
  });

  describe('NPC spawn for recruit battles', () => {
    it('isRecruitBattle produces battleConfig with npcSpawn', () => {
      const config = generateBattle({ act: 'act1', objective: 'rout', isRecruitBattle: true }, data);
      expect(config.npcSpawn).not.toBeNull();
      expect(config.npcSpawn.className).toBeTruthy();
      expect(config.npcSpawn.name).toBeTruthy();
      expect(config.npcSpawn.level).toBeGreaterThanOrEqual(1);
      expect(config.npcSpawn.col).toBeGreaterThanOrEqual(0);
      expect(config.npcSpawn.row).toBeGreaterThanOrEqual(0);
    });

    it('NPC spawn is on a passable tile', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout', isRecruitBattle: true }, data);
        const npc = config.npcSpawn;
        const terrainIdx = config.mapLayout[npc.row][npc.col];
        const t = data.terrain[terrainIdx];
        expect(t.moveCost.Infantry).not.toBe('--');
      }
    });

    it('NPC spawn is not on player or enemy spawn position', () => {
      for (let i = 0; i < 10; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout', isRecruitBattle: true }, data);
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

    it('NPC spawn is biased toward player side of map', () => {
      for (let i = 0; i < 20; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout', isRecruitBattle: true }, data);
        const npc = config.npcSpawn;
        expect(npc.col).toBeLessThan(Math.ceil(config.cols * 0.60));
      }
    });

    it('NPC spawn maintains distance from enemy spawns', () => {
      for (let i = 0; i < 20; i++) {
        const config = generateBattle({ act: 'act1', objective: 'rout', isRecruitBattle: true }, data);
        const npc = config.npcSpawn;
        for (const es of config.enemySpawns) {
          const dist = Math.abs(npc.col - es.col) + Math.abs(npc.row - es.row);
          expect(dist).toBeGreaterThanOrEqual(2);
        }
      }
    });
  });
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
      for (const act of ['act1', 'act2', 'act3', 'finalBoss']) {
        for (let i = 0; i < 10; i++) {
          const deployCount = DEPLOY_LIMITS[act]?.max || 4;
          const config = generateBattle({ act, objective: 'rout', deployCount }, data);
          const nonBossEnemies = config.enemySpawns.filter(e => !e.isBoss).length;
          expect(nonBossEnemies).toBeGreaterThanOrEqual(deployCount);
        }
      }
    });

    it('act1 rows 0-1 produce exactly deployCount enemies (offset [0,0])', () => {
      for (let i = 0; i < 20; i++) {
        const deployCount = 2;
        const config = generateBattle({ act: 'act1', objective: 'rout', deployCount, row: 0 }, data);
        expect(config.enemySpawns.length).toBe(deployCount);
      }
    });

    it('act1 row 4+ produces more enemies (offset [1,2])', () => {
      const counts = new Set();
      for (let i = 0; i < 30; i++) {
        const deployCount = 3;
        const config = generateBattle({ act: 'act1', objective: 'rout', deployCount, row: 4 }, data);
        counts.add(config.enemySpawns.length);
        expect(config.enemySpawns.length).toBeGreaterThanOrEqual(deployCount + 1);
        expect(config.enemySpawns.length).toBeLessThanOrEqual(deployCount + 2);
      }
    });

    it('boss fights use boss offset (higher enemy count)', () => {
      for (let i = 0; i < 10; i++) {
        const deployCount = 4;
        const config = generateBattle({ act: 'act2', objective: 'seize', deployCount, isBoss: true }, data);
        // act2 boss offset is [3,4], so total enemies = 4 + 3..4 = 7..8
        // (seize boss is included in enemySpawns, counted within rollEnemyCount total)
        expect(config.enemySpawns.length).toBeGreaterThanOrEqual(deployCount + 3);
      }
    });

    it('missing row falls back to default offset', () => {
      for (let i = 0; i < 10; i++) {
        const deployCount = 4;
        // act2 row 5 has no specific entry, should use default [2,3]
        const config = generateBattle({ act: 'act2', objective: 'rout', deployCount, row: 5 }, data);
        const count = config.enemySpawns.length;
        expect(count).toBeGreaterThanOrEqual(deployCount + 2);
        expect(count).toBeLessThanOrEqual(deployCount + 3);
      }
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

// Local BFS helper for reachability tests
function bfs(mapLayout, cols, rows, terrainData, start) {
  const visited = new Set();
  const queue = [start];
  visited.add(`${start.col},${start.row}`);
  while (queue.length > 0) {
    const { col, row } = queue.shift();
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const key = `${nc},${nr}`;
      if (visited.has(key)) continue;
      const t = terrainData[mapLayout[nr][nc]];
      if (!t || t.moveCost.Infantry === '--') continue;
      visited.add(key);
      queue.push({ col: nc, row: nr });
    }
  }
  return visited;
}

describe('enemy sunder weapon assignment', () => {
  it('act1 enemies never get sunderWeapon (sunderChance=0)', () => {
    for (let i = 0; i < 50; i++) {
      const config = generateBattle({ act: 'act1', objective: 'rout' }, data);
      const withSunder = config.enemySpawns.filter(e => e.sunderWeapon);
      expect(withSunder.length).toBe(0);
    }
  });

  it('act3 enemies can get sunderWeapon flag', () => {
    let foundSunder = false;
    for (let i = 0; i < 100; i++) {
      const config = generateBattle({ act: 'act3', objective: 'rout' }, data);
      if (config.enemySpawns.some(e => e.sunderWeapon)) {
        foundSunder = true;
        break;
      }
    }
    expect(foundSunder).toBe(true);
  });

  it('boss spawns do not get sunderWeapon', () => {
    for (let i = 0; i < 50; i++) {
      const config = generateBattle({ act: 'act3', objective: 'seize' }, data);
      const bosses = config.enemySpawns.filter(e => e.isBoss);
      for (const boss of bosses) {
        expect(boss.sunderWeapon).toBeFalsy();
      }
    }
  });
});
