// The Descent's authored route (docs/specs/act-v-descent.md §2, §9.1): the map each rung builds,
// its edges and reachability, its seeds, the oneOf pick, the switch, and the old 2-node save.
// Failure modes each test catches are named in its title.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  buildDescentNodeMap,
  descentRouteIdFor,
  isAuthoredNode,
  isDescentMap,
  isFinaleBossNode,
  lootActFor,
  pickSlotSpec,
} from '../src/engine/Descent.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { applyGenerationFields, generateSeededBattle } from '../src/engine/BattleScout.js';
import { validateBattleConfig } from '../src/engine/MapGenerator.js';
import { rewardDrawParams } from '../src/engine/PendingBattleRewards.js';
import { nodeFrame } from '../src/ui/RouteGraph.js';

const baseData = loadGameData();

/** Game data with the Descent switched on (or off). */
function descentData(enabled = true, patch = {}) {
  return { ...baseData, descent: { ...structuredClone(baseData.descent), enabled, ...patch } };
}

/** A run on `difficultyId` that has just advanced into the final act. */
function runIntoFinalAct(difficultyId, { runSeed = 7, data = descentData(), acts = null } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed, difficultyId });
  if (acts) rm.actSequence = [...acts];
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}

const shape = (nodeMap) => {
  const rows = [];
  for (const node of nodeMap.nodes) (rows[node.row] ||= []).push(`${node.col}:${node.type}`);
  return rows;
};

const DUSK_ACTS = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];

describe('the Descent per rung (§2.1, §2.2)', () => {
  it('First Light builds the Lieutenant road: stair, fork, Vigil, Ruins, his finale', () => {
    const rm = runIntoFinalAct('normal');
    expect(rm.currentAct).toBe('finalBoss');
    expect(rm.nodeMap.descent).toEqual({ v: 1, routeId: 'lieutenant', finale: 'lieutenant' });
    expect(shape(rm.nodeMap)).toEqual([
      ['2:battle'],
      ['1:battle', '3:event'],
      ['2:battle'],
      ['2:ruins'],
      ['2:boss'],
    ]);
    expect(rm.nodeMap.startNodeId).toBe('finalBoss_0_2');
    expect(rm.nodeMap.bossNodeId).toBe('finalBoss_4_2');
    const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
    expect(boss.battleParams).toMatchObject({
      bossName: 'The Lieutenant',
      bossRole: 'finale',
      objective: 'seize',
      setPiece: 'the_glass',
    });
  });

  it('Dusk (its act list reaching the Descent, as #315 makes it) takes the same road', () => {
    const rm = runIntoFinalAct('dusk', { acts: DUSK_ACTS });
    expect(rm.nodeMap.descent.routeId).toBe('lieutenant');
    expect(rm.nodeMap.nodes.map((n) => n.id)).toEqual([
      'finalBoss_0_2',
      'finalBoss_1_1',
      'finalBoss_1_3',
      'finalBoss_2_2',
      'finalBoss_3_2',
      'finalBoss_4_2',
    ]);
  });

  it.each(['hard', 'lunatic'])(
    '%s builds the Entity road: the Landing, the Lieutenant as gate, the Ruins, the Entity',
    (rung) => {
      const rm = runIntoFinalAct(rung);
      expect(rm.nodeMap.descent).toEqual({ v: 1, routeId: 'entity', finale: 'entity' });
      expect(shape(rm.nodeMap)).toEqual([
        ['2:battle'],
        ['1:battle', '3:event'],
        ['2:battle'],
        ['2:event'],
        ['2:boss'],
        ['2:ruins'],
        ['2:boss'],
      ]);
      expect(rm.nodeMap.bossNodeId).toBe('finalBoss_6_2');
      const gate = rm.nodeMap.nodes.find((n) => n.id === 'finalBoss_4_2');
      expect(gate.battleParams).toMatchObject({
        bossName: 'The Lieutenant',
        bossRole: 'gate',
        objective: 'rout',
        objectives: { version: 1, primary: [{ kind: 'defeat', targets: ['@boss'] }] },
      });
      const finale = rm.nodeMap.nodes.find((n) => n.id === 'finalBoss_6_2');
      // Today's finale: the template, no levelRange (its escorts take the pool's range).
      expect(finale.battleParams).toMatchObject({
        bossName: 'The Entity',
        bossRole: 'finale',
        objective: 'seize',
        templateId: 'eldritch_sanctum',
      });
      expect(finale.battleParams.levelRange).toBeUndefined();
      expect(finale.templateId).toBe('eldritch_sanctum');
    },
  );

  it('stamps every node authored, with its key, title and the event pool or set piece', () => {
    const rm = runIntoFinalAct('hard');
    for (const node of rm.nodeMap.nodes) {
      expect(isAuthoredNode(node), node.id).toBe(true);
      expect(typeof node.descentKey).toBe('string');
      expect(typeof node.title).toBe('string');
      expect(node.completed).toBe(false);
    }
    const byKey = Object.fromEntries(rm.nodeMap.nodes.map((n) => [n.descentKey, n]));
    expect(byKey.side_stair.eventPool).toBe('descent');
    expect(byKey.landing.eventPool).toBe('descent');
    expect(byKey.side_stair.battleParams).toBeNull();
    expect(byKey.column.fallable).toBe(true);
    expect(byKey.stair.fallable).toBeUndefined();
    expect(byKey.vigil.battleParams).toMatchObject({ setPiece: 'the_vigil', isElite: true });
    expect(byKey.gate.bossLine).toBe('The Lieutenant · Hero');
    expect(byKey.entity.bossLine).toBe('The Entity');
  });

  it('set-piece battles fight the act before at the route offset, with no fog roll', () => {
    // First Light's act before is Act III (late rows 11-15), everyone else's Act IV (14-17);
    // the shipped routes add [2, 2] (First Light, Dusk: tuned by sim:descent) and [1, 1].
    const normal = runIntoFinalAct('normal');
    const hard = runIntoFinalAct('hard');
    const stair = (rm) => rm.nodeMap.nodes.find((n) => n.descentKey === 'stair');
    expect(stair(normal).battleParams.levelRange).toEqual([13, 17]);
    expect(stair(hard).battleParams.levelRange).toEqual([15, 18]);
    for (const rm of [normal, hard])
      for (const node of rm.nodeMap.nodes) expect(node.fogEnabled, node.id).toBeUndefined();
  });

  it('every battle on every rung generates a valid map (the gate a defeat of the Lieutenant)', () => {
    for (const [rung, acts] of [
      ['normal', null],
      ['dusk', DUSK_ACTS],
      ['hard', null],
      ['lunatic', null],
    ]) {
      const rm = runIntoFinalAct(rung, { acts });
      for (const node of rm.nodeMap.nodes.filter((n) => n.battleParams)) {
        const params = rm.getBattleParams(node);
        applyGenerationFields(params, { deployCount: 8, isBoss: node.type === 'boss' });
        const config = generateSeededBattle(params, baseData, params.battleSeed);
        expect(validateBattleConfig(config, baseData), `${rung} ${node.id}`).toEqual([]);
        const boss = config.enemySpawns.find((s) => s.isBoss);
        if (node.descentKey === 'gate') {
          expect(boss.name).toBe('The Lieutenant');
          expect(config.objective).toBe('rout');
          expect(config.objectives.primary[0]).toMatchObject({
            kind: 'defeat',
            targets: ['@boss'],
          });
          expect(config.thronePos).toBeNull();
          // No Hunted wave on a boss map.
          expect(config.reinforcements?.hunted).toBeUndefined();
        }
        if (node.descentKey === 'lieutenant') {
          expect(boss.name).toBe('The Lieutenant');
          expect(config.objective).toBe('seize');
          expect(config.objectives).toBeUndefined();
          expect(config.thronePos).toEqual({ col: boss.col, row: boss.row });
        }
        if (node.descentKey === 'entity') {
          expect(boss.name).toBe('The Entity');
          expect(boss.isEntity).toBe(true);
        }
      }
    }
  });

  it('getBattleParams carries the boss by name and its role to the battle', () => {
    const rm = runIntoFinalAct('hard');
    const gate = rm.getBattleParams(rm.nodeMap.nodes.find((n) => n.descentKey === 'gate'));
    expect(gate.bossName).toBe('The Lieutenant');
    expect(gate.bossRole).toBe('gate');
    const finale = rm.getBattleParams(rm.nodeMap.nodes.find((n) => n.descentKey === 'entity'));
    expect(finale.bossName).toBe('The Entity');
    expect(finale.bossRole).toBe('finale');
  });
});

describe('edges and reachability (§9.1)', () => {
  const edges = (nodeMap) =>
    Object.fromEntries(nodeMap.nodes.map((n) => [n.id, [...n.edges].sort()]));

  it('fans out and in around the fork, one road elsewhere', () => {
    expect(edges(runIntoFinalAct('normal').nodeMap)).toEqual({
      finalBoss_0_2: ['finalBoss_1_1', 'finalBoss_1_3'],
      finalBoss_1_1: ['finalBoss_2_2'],
      finalBoss_1_3: ['finalBoss_2_2'],
      finalBoss_2_2: ['finalBoss_3_2'],
      finalBoss_3_2: ['finalBoss_4_2'],
      finalBoss_4_2: [],
    });
  });

  it('every node is reachable from the start and reaches the finale, on both roads', () => {
    for (const rung of ['normal', 'hard']) {
      const { nodes, startNodeId, bossNodeId } = runIntoFinalAct(rung).nodeMap;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const seen = new Set([startNodeId]);
      const queue = [startNodeId];
      while (queue.length)
        for (const id of byId.get(queue.shift()).edges)
          if (!seen.has(id)) {
            seen.add(id);
            queue.push(id);
          }
      expect(seen.size, rung).toBe(nodes.length);
      const reachesBoss = (id) => id === bossNodeId || byId.get(id).edges.some(reachesBoss);
      for (const node of nodes) expect(reachesBoss(node.id), node.id).toBe(true);
    }
  });

  it('two multi-node rows join by the slots’ own edges, never crossing (a fixture route)', () => {
    const config = descentData(true).descent;
    const battle = (key) => ({ key, type: 'battle', setPiece: 'old_kings_stair' });
    config.routes.lieutenant.rows.splice(
      2,
      0,
      {
        nodes: [
          { ...battle('a'), edges: ['c'] },
          { ...battle('b'), edges: ['d', 'e'] },
        ],
      },
      { nodes: [battle('c'), battle('d'), battle('e')] },
    );
    // The fork (two nodes) now meets a two-node row too: name its edges.
    config.routes.lieutenant.rows[1].nodes[0].edges = ['a'];
    config.routes.lieutenant.rows[1].nodes[1].edges = ['b'];
    const map = buildDescentNodeMap(config, {
      runSeed: 3,
      difficultyId: 'normal',
      actSequence: ['act1', 'act2', 'act3', 'finalBoss'],
      gameData: baseData,
    });
    const at = (id) => map.nodes.find((n) => n.id === id).edges;
    expect(at('finalBoss_1_1')).toEqual(['finalBoss_2_1']);
    expect(at('finalBoss_1_3')).toEqual(['finalBoss_2_3']);
    expect(at('finalBoss_2_1')).toEqual(['finalBoss_3_1']);
    expect(at('finalBoss_2_3')).toEqual(['finalBoss_3_2', 'finalBoss_3_3']);
    // Every row-3 node fans into the single Vigil node.
    for (const id of ['finalBoss_3_1', 'finalBoss_3_2', 'finalBoss_3_3'])
      expect(at(id)).toEqual(['finalBoss_4_2']);
  });
});

describe('seeds: keyed, never Math.random, never the node-map stream (§2.3 rule 2)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds without one Math.random draw', () => {
    const spy = vi.spyOn(Math, 'random');
    buildDescentNodeMap(descentData().descent, {
      runSeed: 99,
      difficultyId: 'hard',
      actSequence: ['act1', 'act2', 'act3', 'act4', 'finalBoss'],
      gameData: baseData,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('the run’s act advance builds the Descent without drawing either (its map step)', () => {
    const rm = new RunManager(descentData());
    rm.startRun({ runSeed: 5, difficultyId: 'hard' });
    rm.actIndex = rm.actSequence.indexOf('finalBoss');
    const spy = vi.spyOn(Math, 'random');
    rm.nodeMap = rm._buildActNodeMap();
    expect(spy).not.toHaveBeenCalled();
    expect(isDescentMap(rm.nodeMap)).toBe(true);
  });

  it('the same run seed builds the same route; another seed other battle seeds', () => {
    const a = runIntoFinalAct('hard', { runSeed: 11 }).nodeMap;
    const b = runIntoFinalAct('hard', { runSeed: 11 }).nodeMap;
    const c = runIntoFinalAct('hard', { runSeed: 12 }).nodeMap;
    expect(a).toEqual(b);
    const seeds = (m) =>
      m.nodes.filter((n) => n.battleParams).map((n) => n.battleParams.battleSeed);
    expect(seeds(a)).not.toEqual(seeds(c));
    // Every battle of a route has its own seed.
    expect(new Set(seeds(a)).size).toBe(seeds(a).length);
  });

  it('a node’s seed is the keyed stream of the run seed and its id (descent-node:<id>)', () => {
    // FNV-1a over the key folded with the seed, then one mulberry32 draw (BattleRng's rule),
    // written out here rather than read back from the module.
    const keyed = (seed, key) => {
      let hash = (2166136261 ^ (seed >>> 0)) >>> 0;
      for (const ch of key) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      return Math.trunc(createBattleRng(hash)() * 0x100000000) >>> 0;
    };
    const map = runIntoFinalAct('normal', { runSeed: 21 }).nodeMap;
    for (const node of map.nodes.filter((n) => n.battleParams))
      expect(node.battleParams.battleSeed, node.id).toBe(keyed(21, `descent-node:${node.id}`));
  });
});

describe('a oneOf slot (§9.1)', () => {
  const slot = {
    oneOf: [
      { key: 'left', type: 'battle', setPiece: 'old_kings_stair' },
      { key: 'right', type: 'battle', setPiece: 'mortuary_column' },
    ],
  };
  const pick = (runSeed, s = slot, row = 2, index = 0) =>
    pickSlotSpec(s, { runSeed, routeId: 'lieutenant', row, index }).key;

  it('picks the same node for the same seed and key, and both over many seeds', () => {
    const picks = Array.from({ length: 400 }, (_, seed) => pick(seed));
    expect(Array.from({ length: 400 }, (_, seed) => pick(seed))).toEqual(picks);
    const left = picks.filter((k) => k === 'left').length;
    expect(left).toBeGreaterThan(140);
    expect(left).toBeLessThan(260);
  });

  it('is keyed on its own row and slot: another row draws independently', () => {
    const here = Array.from({ length: 64 }, (_, seed) => pick(seed, slot, 2, 0));
    const there = Array.from({ length: 64 }, (_, seed) => pick(seed, slot, 3, 0));
    expect(there).not.toEqual(here);
  });

  it('honours weights: a zero weight is never picked, a 3:1 split lands near 3:1', () => {
    const never = { ...slot, weights: [0, 1] };
    for (let seed = 0; seed < 100; seed++) expect(pick(seed, never)).toBe('right');
    const heavy = { ...slot, weights: [3, 1] };
    const left = Array.from({ length: 800 }, (_, seed) => pick(seed, heavy)).filter(
      (k) => k === 'left',
    ).length;
    expect(left / 800).toBeGreaterThan(0.68);
    expect(left / 800).toBeLessThan(0.82);
  });

  it('a route with a oneOf builds the picked node, stable across builds', () => {
    const config = descentData(true).descent;
    config.routes.lieutenant.rows[2].nodes[0] = {
      oneOf: [
        { key: 'vigil', type: 'battle', setPiece: 'the_vigil', elite: true },
        { key: 'vigil_b', type: 'battle', setPiece: 'mortuary_column' },
      ],
    };
    const options = {
      difficultyId: 'normal',
      actSequence: ['act1', 'act2', 'act3', 'finalBoss'],
      gameData: baseData,
    };
    const keys = new Set();
    for (let runSeed = 0; runSeed < 30; runSeed++) {
      const first = buildDescentNodeMap(config, { ...options, runSeed });
      const again = buildDescentNodeMap(config, { ...options, runSeed });
      expect(again).toEqual(first);
      const node = first.nodes.find((n) => n.row === 2);
      keys.add(node.descentKey);
      expect(node.battleParams.setPiece).toBe(
        node.descentKey === 'vigil' ? 'the_vigil' : 'mortuary_column',
      );
    }
    expect([...keys].sort()).toEqual(['vigil', 'vigil_b']);
  });
});

describe('the switch and the fallback (§9.1 RunManager)', () => {
  const finalActMap = (data, rung = 'hard', runSeed = 31) =>
    runIntoFinalAct(rung, { data, runSeed }).nodeMap;

  it('switched off, the final act is exactly today’s 2-node map', () => {
    const off = finalActMap(descentData(false));
    const none = finalActMap({ ...baseData, descent: undefined });
    expect(off).toEqual(none);
    expect(off.descent).toBeUndefined();
    expect(off.nodes.map((n) => n.type)).toEqual(['ruins', 'boss']);
  });

  it('a rung with no route, or a route the data lacks, builds today’s map', () => {
    const none = finalActMap({ ...baseData, descent: undefined });
    const routeless = descentData(true);
    delete routeless.descent.routeByRung.hard;
    expect(finalActMap(routeless)).toEqual(none);
    const dangling = descentData(true, { routeByRung: { hard: 'nowhere' } });
    expect(finalActMap(dangling)).toEqual(none);
    expect(descentRouteIdFor(dangling.descent, 'hard')).toBeNull();
  });

  it('Acts I–IV never take the Descent, switched on or not', () => {
    const on = new RunManager(descentData(true));
    on.startRun({ runSeed: 4, difficultyId: 'hard' });
    const off = new RunManager({ ...baseData, descent: undefined });
    off.startRun({ runSeed: 4, difficultyId: 'hard' });
    expect(on.nodeMap).toEqual(off.nodeMap);
    for (let i = 0; i < 3; i++) {
      on.advanceAct();
      off.advanceAct();
      expect(on.nodeMap, on.currentAct).toEqual(off.nodeMap);
    }
  });

  it('a save already in Act V on the old 2-node map keeps it, switched on or not', () => {
    const old = runIntoFinalAct('hard', { data: descentData(false), runSeed: 17 });
    old.markNodeComplete(old.nodeMap.startNodeId); // standing on the Ruins
    const saved = JSON.parse(JSON.stringify(old.toJSON()));
    const loaded = RunManager.fromJSON(saved, descentData(true));
    expect(loaded.nodeMap).toEqual(saved.nodeMap);
    expect(isDescentMap(loaded.nodeMap)).toBe(false);
    expect(loaded.nodeMap.nodes).toHaveLength(2);
    expect(loaded.currentAct).toBe('finalBoss');
    // The legacy boss still draws the Entity on Nightfall (no bossName on the old node).
    const boss = loaded.nodeMap.nodes.find((n) => n.id === loaded.nodeMap.bossNodeId);
    expect(boss.battleParams.bossName).toBeUndefined();
    expect(loaded.isActComplete()).toBe(false);
  });

  it('a Descent save loads its route back as it was', () => {
    const rm = runIntoFinalAct('hard', { runSeed: 23 });
    rm.markNodeComplete(rm.nodeMap.startNodeId);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(RunManager.fromJSON(saved, descentData(true)).nodeMap).toEqual(rm.nodeMap);
    // Switched off later, a run already on the route keeps it (a load never rebuilds).
    expect(RunManager.fromJSON(saved, descentData(false)).nodeMap).toEqual(rm.nodeMap);
  });

  it('the prologue never builds it', () => {
    const rm = new RunManager(descentData(true));
    rm.startPrologue(descentData(true));
    expect(isDescentMap(rm.nodeMap)).toBe(false);
    expect(rm._descentRouteId()).toBeNull();
  });
});

describe('Descent loot (§2.3 rule 3)', () => {
  it('draws from the act before (Act IV; First Light Act III), never the gold-only table', () => {
    expect(lootActFor(runIntoFinalAct('hard'))).toBe('act4');
    expect(lootActFor(runIntoFinalAct('normal'))).toBe('act3');
    expect(lootActFor(runIntoFinalAct('dusk', { acts: DUSK_ACTS }))).toBe('act4');
    const rm = runIntoFinalAct('hard');
    expect(rewardDrawParams(rm, { isBoss: true }).actId).toBe('act4');
  });

  it('keeps the act’s own tables everywhere else, and on an old 2-node Act V', () => {
    const legacy = runIntoFinalAct('hard', { data: descentData(false) });
    expect(lootActFor(legacy)).toBe('finalBoss');
    expect(rewardDrawParams(legacy, {}).actId).toBe('finalBoss');
    const early = new RunManager(descentData(true));
    early.startRun({ runSeed: 1, difficultyId: 'hard' });
    expect(rewardDrawParams(early, {}).actId).toBe('act1');
  });
});

describe('the final-boss art reads the boss role (§9.3)', () => {
  it('the gate wears an act boss’s frame, the finale the final boss’s', () => {
    const rm = runIntoFinalAct('hard');
    const gate = rm.nodeMap.nodes.find((n) => n.descentKey === 'gate');
    const finale = rm.nodeMap.nodes.find((n) => n.descentKey === 'entity');
    expect(isFinaleBossNode(gate, 'finalBoss')).toBe(false);
    expect(isFinaleBossNode(finale, 'finalBoss')).toBe(true);
    expect(nodeFrame(finale, 'finalBoss')).toBe(8);
    expect(nodeFrame(gate, 'finalBoss')).not.toBe(8);
    expect(nodeFrame(gate, 'finalBoss')).toBe(nodeFrame({ type: 'boss' }, 'act2'));
  });

  it('a boss with no role keeps today’s rule (the final act’s boss is the finale)', () => {
    expect(isFinaleBossNode({ type: 'boss', battleParams: {} }, 'finalBoss')).toBe(true);
    expect(isFinaleBossNode({ type: 'boss', battleParams: {} }, 'act4')).toBe(false);
  });
});
