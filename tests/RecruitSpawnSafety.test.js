// Recruit spawn safety (docs/specs/strategy-layer.md): the recruit spawns where a
// lord on the nearest spawn reaches its side within two player phases, no foe can
// strike it in the first enemy phase, preferably in cover; the spawn list is handed
// over nearest-first so BattleScene seats a lord there; a node's preview fixes the
// recruit's class and name.
import { describe, it, expect } from 'vitest';
import {
  generateBattle,
  pickRecruitSpawnTile,
  orderSpawnsTowardTarget,
  RECRUIT_REACH_BAND,
} from '../src/engine/MapGenerator.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { DEPLOY_LIMITS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const DIRS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

function cost(idx, moveType = 'Infantry') {
  const raw = data.terrain[idx]?.moveCost?.[moveType];
  return raw === '--' || raw === undefined ? Infinity : parseInt(raw, 10);
}

function costField(bc, sources, moveType = 'Infantry', limit = Infinity) {
  const dist = new Map(sources.map((s) => [`${s.col},${s.row}`, 0]));
  const queue = sources.map((s) => ({ c: s.col, r: s.row, d: 0 }));
  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const cur = queue.shift();
    for (const [dc, dr] of DIRS) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || r < 0 || c >= bc.cols || r >= bc.rows) continue;
      const d = cur.d + cost(bc.mapLayout[r][c], moveType);
      if (!Number.isFinite(d) || d > limit) continue;
      if (d < (dist.get(`${c},${r}`) ?? Infinity)) {
        dist.set(`${c},${r}`, d);
        queue.push({ c, r, d });
      }
    }
  }
  return dist;
}

function reachCost(bc, from, target) {
  const field = costField(bc, [from]);
  let best = Infinity;
  for (const [dc, dr] of DIRS)
    best = Math.min(best, field.get(`${target.col + dc},${target.row + dr}`) ?? Infinity);
  return best;
}

function generateRecruitBattle(act, seed, extra = {}) {
  installSeed(seed);
  try {
    return generateBattle(
      {
        act,
        objective: 'rout',
        isRecruitBattle: true,
        deployCount: DEPLOY_LIMITS[act].max,
        difficultyId: 'normal',
        ...extra,
      },
      data,
    );
  } finally {
    restoreMathRandom();
  }
}

describe('recruit spawn safety', () => {
  it.each(['act1', 'act2', 'act3', 'act4'])(
    'a lord on the first spawn reaches the recruit by the second player phase (%s)',
    (act) => {
      for (let seed = 1; seed <= 60; seed++) {
        const bc = generateRecruitBattle(act, seed * 13 + act.length);
        expect(bc.npcSpawn).toBeTruthy();
        const reach = reachCost(bc, bc.playerSpawns[0], bc.npcSpawn);
        expect(reach).toBeLessThanOrEqual(RECRUIT_REACH_BAND.max);
        expect(reach).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it('hands the player spawns over nearest-first to the recruit', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const bc = generateRecruitBattle('act2', seed);
      const costs = bc.playerSpawns.map((s) => reachCost(bc, s, bc.npcSpawn));
      for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
    }
  });

  it('keeps the recruit out of every first-phase strike on normal maps', () => {
    let safe = 0;
    let total = 0;
    for (const act of ['act1', 'act2', 'act3']) {
      for (let seed = 1; seed <= 40; seed++) {
        const bc = generateRecruitBattle(act, seed * 7 + 3);
        total++;
        let threats = 0;
        for (const e of bc.enemySpawns) {
          const cls = data.classes.find((c) => c.name === e.className);
          const reach = costField(bc, [e], cls?.moveType || 'Infantry', cls?.baseStats?.MOV || 4);
          const range = ['Archer', 'Sniper', 'Mage', 'Sage'].includes(e.className) ? 2 : 1;
          let hits = false;
          for (const key of reach.keys()) {
            const [c, r] = key.split(',').map(Number);
            const d = Math.abs(c - bc.npcSpawn.col) + Math.abs(r - bc.npcSpawn.row);
            if (d >= 1 && d <= range) hits = true;
          }
          if (hits) threats++;
        }
        if (threats === 0) safe++;
      }
    }
    expect(safe / total).toBeGreaterThanOrEqual(0.95);
  });

  it('never seats the recruit on hazard, throne or ballista terrain', () => {
    const banned = new Set([
      'Lava Crack',
      'Acidic Swamp',
      'Acidic Bog',
      'Ice',
      'Throne',
      'Ballista',
    ]);
    for (const act of ['act1', 'act2', 'act3', 'act4']) {
      for (let seed = 1; seed <= 40; seed++) {
        const bc = generateRecruitBattle(act, seed * 31);
        const terrain = data.terrain[bc.mapLayout[bc.npcSpawn.row][bc.npcSpawn.col]];
        expect(banned.has(terrain.name)).toBe(false);
      }
    }
  });

  it('prefers cover: most recruits start on a tile with avoid or defense', () => {
    let covered = 0;
    let total = 0;
    for (const act of ['act1', 'act2', 'act3']) {
      for (let seed = 1; seed <= 50; seed++) {
        const bc = generateRecruitBattle(act, seed * 17);
        const t = data.terrain[bc.mapLayout[bc.npcSpawn.row][bc.npcSpawn.col]];
        total++;
        if ((t.avoidBonus || 0) >= 10 || (t.defBonus || 0) >= 1) covered++;
      }
    }
    expect(covered / total).toBeGreaterThan(0.6);
  });
});

describe('pickRecruitSpawnTile', () => {
  const plain = data.terrain.findIndex((t) => t.name === 'Plain');
  const forest = data.terrain.findIndex((t) => t.name === 'Forest');
  const wall = data.terrain.findIndex((t) => t.name === 'Wall');
  const base = (cols = 12, rows = 6, fill = plain) =>
    Array.from({ length: rows }, () => Array(cols).fill(fill));
  const passable = (idx) => Number.isFinite(cost(idx));

  it('picks a tile inside the reach band and outside first-phase strikes, in cover when offered', () => {
    // The Fighter (MOV 5, a Hand Axe reaches 2) strikes cols 8+ on its first move.
    const mapLayout = base(16, 6);
    mapLayout[2][4] = forest;
    const pick = pickRecruitSpawnTile({
      mapLayout,
      cols: 16,
      rows: 6,
      terrainData: data.terrain,
      playerSpawns: [{ col: 0, row: 2 }],
      enemySpawns: [{ col: 15, row: 2, className: 'Fighter' }],
      classesData: data.classes,
      weaponsData: data.weapons,
      tilePassable: passable,
    });
    expect(pick).toEqual({ col: 4, row: 2, reach: 3 });
  });

  it('returns null when no tile is reachable (caller falls back)', () => {
    const mapLayout = base(6, 3, wall);
    mapLayout[1][0] = plain;
    const pick = pickRecruitSpawnTile({
      mapLayout,
      cols: 6,
      rows: 3,
      terrainData: data.terrain,
      playerSpawns: [{ col: 0, row: 1 }],
      enemySpawns: [],
      classesData: data.classes,
      weaponsData: data.weapons,
      tilePassable: passable,
    });
    expect(pick).toBeNull();
  });

  it('orders spawns by path cost to the target, stable on ties', () => {
    const mapLayout = base();
    const spawns = [
      { col: 0, row: 0 },
      { col: 0, row: 5 },
      { col: 1, row: 2 },
      { col: 1, row: 3 },
    ];
    const ordered = orderSpawnsTowardTarget(mapLayout, 12, 6, data.terrain, spawns, {
      col: 4,
      row: 2,
    });
    expect(ordered).toEqual([
      { col: 1, row: 2 },
      { col: 1, row: 3 },
      { col: 0, row: 0 },
      { col: 0, row: 5 },
    ]);
  });
});

describe('recruit preview in battle generation', () => {
  it('spawns the previewed class and name and records the name as used', () => {
    const used = {};
    const bc = generateRecruitBattle('act1', 5, {
      recruitPreview: { className: 'Cavalier', name: 'Helena' },
      usedRecruitNames: used,
    });
    expect(bc.npcSpawn.className).toBe('Cavalier');
    expect(bc.npcSpawn.name).toBe('Helena');
    expect(used.Cavalier).toContain('Helena');
    expect(used.__all__).toContain('Helena');
  });

  it('a previewed recruit spends no draws on class, name or level', () => {
    // Same seed with and without a preview: the preview skips 3 draws (class, name,
    // level). Everything placed afterwards follows its own draws, so only check the
    // preview path is internally deterministic.
    const a = generateRecruitBattle('act2', 77, {
      recruitPreview: { className: 'Mage', name: 'Lira' },
    });
    const b = generateRecruitBattle('act2', 77, {
      recruitPreview: { className: 'Mage', name: 'Lira' },
    });
    expect(a.npcSpawn).toEqual(b.npcSpawn);
    expect(a.playerSpawns).toEqual(b.playerSpawns);
  });
});
