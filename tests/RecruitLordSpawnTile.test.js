// A recruit node's lord roll can replace the previewed class (external review,
// 2026-09-25): "A preview Myrmidon can resolve to Rowan/Chevalier after placement was
// validated for Infantry. A real generated case places Cavalry on Mountain."
//
// The map generator seated the recruit on a tile checked for the preview's move type;
// BattleScene then built the unit (RecruitNodeSystem) and a 15% lord roll could make
// it Rowan, a Cavalry Chevalier, on a Swamp or Mountain tile Cavalry cannot enter.
// Now RunManager resolves the class that will spawn first (same seeded stream as the
// build) and the generator seats that unit; locked encounters from older builds and
// any other caller are re-seated deterministically at spawn.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  generateBattle,
  reconcileRecruitSpawnTile,
  validateBattleConfig,
  RECRUIT_REACH_BAND,
} from '../src/engine/MapGenerator.js';
import {
  buildRecruitNodeUnit,
  resolveRecruitNodeSpawnClass,
} from '../src/engine/RecruitNodeSystem.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const DIRS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

function moveTypeOf(className) {
  return data.classes.find((c) => c.name === className)?.moveType || 'Infantry';
}

function canStand(bc, tile, moveType) {
  const t = data.terrain[bc.mapLayout[tile.row][tile.col]];
  const ok = (m) => t.moveCost[m] !== '--';
  return ok('Infantry') && ok(moveType);
}

function runAt(seed, act) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'normal', applyBlessingsAtStart: false });
  while (rm.currentAct !== act) rm.advanceAct();
  return rm;
}

function generateAt(battleSeed, params) {
  installSeed(battleSeed);
  try {
    return generateBattle(structuredClone(params), data);
  } finally {
    restoreMathRandom();
  }
}

/** Infantry path cost from the nearest player spawn to a tile beside `target`. */
function reachCost(bc, target) {
  const dist = new Map(bc.playerSpawns.map((s) => [`${s.col},${s.row}`, 0]));
  const queue = bc.playerSpawns.map((s) => ({ c: s.col, r: s.row, d: 0 }));
  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const cur = queue.shift();
    for (const [dc, dr] of DIRS) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || r < 0 || c >= bc.cols || r >= bc.rows) continue;
      const raw = data.terrain[bc.mapLayout[r][c]].moveCost.Infantry;
      if (raw === '--') continue;
      const d = cur.d + Number(raw);
      if (d < (dist.get(`${c},${r}`) ?? Infinity)) {
        dist.set(`${c},${r}`, d);
        queue.push({ c, r, d });
      }
    }
  }
  let best = Infinity;
  for (const [dc, dr] of DIRS)
    best = Math.min(best, dist.get(`${target.col + dc},${target.row + dr}`) ?? Infinity);
  return best;
}

describe('the class a recruit node spawns is known before the map is made', () => {
  it('resolveRecruitNodeSpawnClass agrees with the unit the battle builds (acts 1–3)', () => {
    let lordsThatChangeMoveType = 0;
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const act of ['act1', 'act2', 'act3']) {
        const rm = runAt(seed, act);
        for (const node of rm.nodeMap.nodes.filter((n) => n.type === 'recruit')) {
          const ctx = { preview: node.recruitPreview, gameData: data };
          const opts = { ...ctx, ...rm.getRecruitBattleContext(node) };
          const resolved = resolveRecruitNodeSpawnClass(opts);
          const built = buildRecruitNodeUnit(opts);
          expect(resolved.className).toBe(built.unit.className);
          expect(resolved.isLord).toBe(built.isLord);
          expect(resolved.moveType).toBe(built.unit.moveType);
          expect(rm.getRecruitNodeSpawnClass(node)).toBe(built.unit.className);
          if (built.isLord && built.unit.moveType !== moveTypeOf(node.recruitPreview.className))
            lordsThatChangeMoveType++;
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(250);
    expect(lordsThatChangeMoveType).toBeGreaterThan(0);
  });

  it('never draws from Math.random', () => {
    const rm = runAt(22, 'act2');
    const node = rm.nodeMap.nodes.find((n) => n.type === 'recruit');
    const prev = Math.random;
    let draws = 0;
    Math.random = () => {
      draws++;
      return 0.5;
    };
    try {
      rm.getRecruitNodeSpawnClass(node);
    } finally {
      Math.random = prev;
    }
    expect(draws).toBe(0);
  });
});

describe('regression: a Dancer preview that spawns Rowan (Cavalry) on a Swamp', () => {
  // Found by search over generated runs: run seed 22, act 2, node act2_6_3 previews
  // the Dancer Esme; the lord roll makes it Rowan, a Chevalier. On the mire_crossing
  // map rolled with battle seed 31 the old code seated the recruit on a Swamp tile
  // (Infantry 3, Cavalry "--"): checked for the Dancer's Infantry, not for Rowan.
  const SEED = 22;
  const NODE_ID = 'act2_6_3';
  const BATTLE_SEED = 31;

  function setup() {
    const rm = runAt(SEED, 'act2');
    const node = rm.nodeMap.nodes.find((n) => n.id === NODE_ID);
    return { rm, node, params: rm.getBattleParams(node) };
  }

  it('battle params carry the class that will spawn', () => {
    const { rm, node, params } = setup();
    expect(node.recruitPreview).toMatchObject({ className: 'Dancer', name: 'Esme' });
    const built = rm.getRecruitNodeUnit(node);
    expect(built.isLord).toBe(true);
    expect(built.unit.name).toBe('Rowan');
    expect(built.unit.moveType).toBe('Cavalry');
    expect(params.recruitPreview).toEqual({
      className: 'Dancer',
      name: 'Esme',
      spawnClassName: built.unit.className,
    });
  });

  it('old placement (preview class only) put the Cavalry lord on a Swamp', () => {
    const { params } = setup();
    const old = structuredClone(params);
    delete old.recruitPreview.spawnClassName;
    const bc = generateAt(BATTLE_SEED, old);
    expect(bc.templateId).toBe('mire_crossing');
    expect(data.terrain[bc.mapLayout[bc.npcSpawn.row][bc.npcSpawn.col]].name).toBe('Swamp');
    expect(canStand(bc, bc.npcSpawn, 'Cavalry')).toBe(false);
  });

  it('now the recruit stands where Rowan can, under the same safety rules', () => {
    const { params } = setup();
    const bc = generateAt(BATTLE_SEED, params);
    expect(bc.npcSpawn).toMatchObject({ className: 'Dancer', name: 'Esme' });
    expect(bc.npcSpawn.spawnClassName).toBe(params.recruitPreview.spawnClassName);
    expect(canStand(bc, bc.npcSpawn, 'Cavalry')).toBe(true);
    const reach = reachCost(bc, bc.npcSpawn);
    expect(reach).toBeGreaterThanOrEqual(RECRUIT_REACH_BAND.min);
    expect(reach).toBeLessThanOrEqual(RECRUIT_REACH_BAND.max);
    for (const e of bc.enemySpawns)
      expect(Math.abs(e.col - bc.npcSpawn.col) + Math.abs(e.row - bc.npcSpawn.row)).toBeGreaterThan(
        1,
      );
    // The validator checks the recruit's tile for the class that spawns.
    expect(validateBattleConfig(bc, data)).toEqual([]);
  });

  it('an encounter locked by an older build is re-seated for Rowan on entry', () => {
    const { rm, node, params } = setup();
    const old = structuredClone(params);
    delete old.recruitPreview.spawnClassName;
    const legacy = generateAt(BATTLE_SEED, old);
    delete legacy.npcSpawn.spawnClassName;
    rm.lockBattleConfig(node.id, legacy);
    const saved = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    const locked = saved.getLockedBattleConfig(node.id);
    expect(canStand(locked, locked.npcSpawn, 'Cavalry')).toBe(true);
    expect(locked.npcSpawn).toMatchObject({ className: 'Dancer', name: 'Esme' });
    // Lords still start nearest the recruit, and the fix is stable.
    const nearest = reachCost(
      { ...locked, playerSpawns: [locked.playerSpawns[0]] },
      locked.npcSpawn,
    );
    for (const s of locked.playerSpawns)
      expect(reachCost({ ...locked, playerSpawns: [s] }, locked.npcSpawn)).toBeGreaterThanOrEqual(
        nearest,
      );
    expect(saved.getLockedBattleConfig(node.id)).toEqual(locked);
    expect(saved.battleConfigsByNodeId[node.id].npcSpawn).toMatchObject({
      col: locked.npcSpawn.col,
      row: locked.npcSpawn.row,
    });
  });
});

describe('reconcileRecruitSpawnTile', () => {
  function board() {
    const mapLayout = Array.from({ length: 6 }, () => Array(10).fill(T.Plain));
    mapLayout[2][4] = T.Mountain;
    return {
      cols: 10,
      rows: 6,
      mapLayout,
      playerSpawns: [
        { col: 0, row: 2 },
        { col: 0, row: 3 },
      ],
      enemySpawns: [{ col: 9, row: 2 }],
      npcSpawn: { className: 'Myrmidon', name: 'Kenji', col: 4, row: 2 },
    };
  }
  const deps = { terrainData: data.terrain, classesData: data.classes, weaponsData: data.weapons };

  it('keeps a tile the unit can stand on', () => {
    const bc = board();
    expect(reconcileRecruitSpawnTile(bc, { ...deps, moveType: 'Infantry' })).toBe(false);
    expect(bc.npcSpawn).toMatchObject({ col: 4, row: 2 });
    expect(reconcileRecruitSpawnTile(bc, { ...deps, moveType: 'Flying' })).toBe(false);
  });

  it('moves a Cavalry recruit off a Mountain without touching Math.random', () => {
    const bc = board();
    const prev = Math.random;
    let draws = 0;
    Math.random = () => {
      draws++;
      return 0.5;
    };
    let moved;
    try {
      moved = reconcileRecruitSpawnTile(bc, { ...deps, moveType: 'Cavalry' });
    } finally {
      Math.random = prev;
    }
    expect(draws).toBe(0);
    expect(moved).toBe(true);
    expect(canStand(bc, bc.npcSpawn, 'Cavalry')).toBe(true);
    const reach = reachCost(bc, bc.npcSpawn);
    expect(reach).toBeGreaterThanOrEqual(RECRUIT_REACH_BAND.min);
    expect(reach).toBeLessThanOrEqual(RECRUIT_REACH_BAND.max);
    // Deterministic: the same input gives the same tile.
    const again = board();
    reconcileRecruitSpawnTile(again, { ...deps, moveType: 'Cavalry' });
    expect(again.npcSpawn).toEqual(bc.npcSpawn);
  });

  it('with no tile in the reach band, takes the nearest free tile the unit can stand on', () => {
    const bc = board();
    // Only the Mountain column is open near the players; everything else is Wall.
    for (let r = 0; r < 6; r++) for (let c = 2; c < 10; c++) bc.mapLayout[r][c] = T.Wall;
    bc.mapLayout[2][4] = T.Mountain;
    bc.mapLayout[2][5] = T.Plain;
    bc.enemySpawns = [];
    expect(reconcileRecruitSpawnTile(bc, { ...deps, moveType: 'Cavalry' })).toBe(true);
    expect(canStand(bc, bc.npcSpawn, 'Cavalry')).toBe(true);
    expect(bc.playerSpawns).toHaveLength(2);
  });
});
