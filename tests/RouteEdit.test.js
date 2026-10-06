// The Cartographer's `routeEdit` effect (docs/specs/event-nodes-phase2.md §2A): a new road from
// the current node, or one node ahead redrawn as a shop, church or battle.
//
// Ways this goes wrong:
//   - an edit breaks the map: a road to a node two rows on, crossing another road, more than one
//     lane away, a node nobody can reach, a node that cannot reach the boss;
//   - an edit touches a node it must not: the start, the boss, the Ruins, a completed node, the
//     current one, an encounter-locked or fallen one, one with a saved battle config, a recruit,
//     the arena, an event, an ambush village, or any node the player cannot reach from here;
//   - the redrawn node keeps stale params (a shop still carrying a template and fog), is built
//     off the unseeded stream (a refresh would draw a different battle), or its Eclipse threshold
//     moves (the node id is the key);
//   - the pacing rule (no more than two non-combat nodes in a row, none beside its own type)
//     breaks;
//   - with nothing to change the outcome does not fall back, or a failed apply leaves the road
//     half edited;
//   - generating a map is no longer the same map (the shared builders were refactored).
// Map hand-built cases carry their expected answers in the comments.
import { describe, expect, it, vi } from 'vitest';
import { chooseEventOption, eventState } from '../src/engine/EventCommands.js';
import { nodeFallThreshold } from '../src/engine/EclipseSystem.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import {
  REDRAW_TYPES,
  applyRouteEdit,
  checkNodeMapValidity,
  isRedrawable,
  mapRowCount,
  planRouteEdit,
  redrawCandidates,
  roadCandidates,
  serviceStreakProblems,
} from '../src/engine/RouteEdit.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { ACT_CONFIG } from '../src/utils/constants.js';
import { arriveAs, baseData, runWithEvents } from './eventKit.js';

const FALLBACK_GOLD = 7;

const cartographer = (effect) => ({
  id: 'cartographer',
  title: 'The Cartographer',
  weight: 1,
  intro: 'A woman, a table, a map.',
  choices: [
    {
      id: 'go',
      label: 'Ask',
      outcomes: [
        {
          id: 'drawn',
          weight: 100,
          text: 'She draws.',
          effects: [effect],
          fallbackText: 'Nothing to draw.',
          fallback: [{ type: 'gold', value: FALLBACK_GOLD }],
        },
      ],
    },
  ],
});

const ADD_ROAD = { type: 'routeEdit', op: 'addRoad' };
const redraw = (toType) => ({ type: 'routeEdit', op: 'redraw', toType });

/** A run of the given act (0-3) with its map generated for that act. */
function runForAct(seed, act, effect = ADD_ROAD) {
  const run = runWithEvents([cartographer(effect)], { seed });
  run.actSequence = ['act1', 'act2', 'act3', 'act4'];
  run.actIndex = act;
  run.nodeMap = run._withNodeMapSeed(() =>
    generateNodeMap(run.currentAct, run.currentActConfig, run.gameData.mapTemplates, {
      colosseumConfig: run.gameData.colosseum?.nodeGeneration ?? null,
      fogChanceBonus: 0,
    }),
  );
  return run;
}

/**
 * Stand on the first node of `row` that can hold an event without breaking the generator's
 * pacing rule (the test makes the event itself); null when the row offers none.
 */
function standOn(run, row) {
  for (const node of run.nodeMap.nodes.filter(
    (n) => n.row === row && ['battle', 'shop', 'church'].includes(n.type),
  )) {
    const trial = structuredClone(run.nodeMap);
    byId(trial, node.id).type = 'event';
    if (serviceStreakProblems(trial).length === 0) {
      arriveAs(run, 'cartographer', node);
      return node;
    }
  }
  return null;
}

/** The first seed (from 1) whose map offers a node to stand on in `row` that also satisfies `fits`. */
function findStand(act, row, effect, fits = () => true) {
  for (let seed = 1; seed <= 300; seed++) {
    const run = runForAct(seed, act, effect);
    const node = standOn(run, row);
    if (node && fits(run, node)) return { run, node, seed };
  }
  throw new Error('no map offers such a node');
}

const snapshot = (run) => structuredClone(run.nodeMap);
const byId = (map, id) => map.nodes.find((n) => n.id === id);
const changedNodes = (before, after) =>
  after.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(byId(before, n.id)));

describe('generating a map is unchanged by the shared builders', () => {
  it('every generated map is valid and keeps the pacing rule (the checkers agree with the generator)', () => {
    for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
      for (let seed = 1; seed <= 150; seed++) {
        Math.random = createSeededRng(seed * 31 + act.length);
        const map = generateNodeMap(act, ACT_CONFIG[act], baseData.mapTemplates, {
          colosseumConfig: baseData.colosseum?.nodeGeneration ?? null,
        });
        expect(checkNodeMapValidity(map), `${act} seed ${seed}`).toEqual([]);
        expect(serviceStreakProblems(map), `${act} seed ${seed}`).toEqual([]);
      }
    }
  });
});

describe('checkNodeMapValidity', () => {
  const valid = () => {
    Math.random = createSeededRng(99);
    return generateNodeMap('act2', ACT_CONFIG.act2, baseData.mapTemplates, {});
  };

  it('accepts a generated map', () => {
    expect(checkNodeMapValidity(valid())).toEqual([]);
  });

  it.each([
    [
      'an edge that skips a row',
      (m) => m.nodes[0].edges.push(m.nodes.find((n) => n.row === 3).id),
      'skips a row',
    ],
    ['an edge to nowhere', (m) => m.nodes[0].edges.push('ghost'), 'unknown node'],
    ['a repeated edge', (m) => m.nodes[0].edges.push(m.nodes[0].edges[0]), 'duplicate edge'],
    [
      'an edge pointing back',
      (m) => m.nodes.find((n) => n.row === 2).edges.push(m.nodes[0].id),
      'skips a row',
    ],
    [
      'a node nothing leads into',
      (m) => {
        const target = m.nodes.find((n) => n.row === 4);
        for (const n of m.nodes) n.edges = n.edges.filter((id) => id !== target.id);
      },
      'no way in',
    ],
    [
      'a node leading nowhere',
      (m) => {
        m.nodes.find((n) => n.row === 4).edges = [];
      },
      'no way out',
    ],
    [
      'a duplicate id',
      (m) => {
        m.nodes[3].id = m.nodes[2].id;
      },
      'duplicate id',
    ],
    [
      'a missing boss',
      (m) => {
        m.bossNodeId = 'nope';
      },
      'boss node is missing',
    ],
  ])('refuses %s', (_label, plant, needle) => {
    const map = valid();
    plant(map);
    expect(checkNodeMapValidity(map).join('\n')).toContain(needle);
  });

  it('refuses a crossing and a road more than one lane away (between rows with several nodes)', () => {
    const map = valid();
    // find two rows that both have at least two nodes
    const rows = [...new Set(map.nodes.map((n) => n.row))];
    const r = rows.find((row) => {
      const here = map.nodes.filter((n) => n.row === row);
      const next = map.nodes.filter((n) => n.row === row + 1);
      return here.length >= 2 && next.length >= 2;
    });
    const here = map.nodes.filter((n) => n.row === r).sort((a, b) => a.col - b.col);
    const next = map.nodes.filter((n) => n.row === r + 1).sort((a, b) => a.col - b.col);
    // left node -> rightmost, right node -> leftmost: they cross
    here[0].edges = [next.at(-1).id];
    here.at(-1).edges = [next[0].id];
    expect(checkNodeMapValidity(map).join('\n')).toMatch(/crosses|lane away/);
  });

  it('refuses a node the start cannot reach and one that cannot reach the boss', () => {
    const cut = valid();
    const a = cut.nodes.find((n) => n.row === 3);
    cut.nodes.forEach((n) => (n.edges = n.edges.filter((id) => id !== a.id)));
    expect(checkNodeMapValidity(cut).join('\n')).toContain(`${a.id}: not reachable from the start`);
    const dead = valid();
    const b = dead.nodes.find((n) => n.row === 3);
    b.edges = []; // a dead end
    expect(checkNodeMapValidity(dead).join('\n')).toContain(`${b.id}: cannot reach the boss`);
  });
});

describe('roadCandidates on hand-built rows', () => {
  // Rows of lanes: A(1) B(3) above X(0) Y(2) Z(4). Edges: A->Y, B->Z (1->2 and 3->4).
  const map = () => ({
    startNodeId: 's',
    bossNodeId: 'boss',
    nodes: [
      { id: 's', row: 0, col: 2, type: 'battle', edges: ['A', 'B'] },
      { id: 'A', row: 1, col: 1, type: 'battle', edges: ['Y'] },
      { id: 'B', row: 1, col: 3, type: 'battle', edges: ['Z'] },
      { id: 'X', row: 2, col: 0, type: 'battle', edges: ['boss'] },
      { id: 'Y', row: 2, col: 2, type: 'battle', edges: ['boss'] },
      { id: 'Z', row: 2, col: 4, type: 'battle', edges: ['boss'] },
      { id: 'boss', row: 3, col: 2, type: 'boss', edges: [] },
    ],
  });

  it('lanes: A (lane 1) may reach X (lane 0), not Z (lane 4); B (lane 3) may reach Y (lane 2)', () => {
    const m = map();
    // A->X: |1-0| = 1, and the roads (1->2),(3->4) do not cross 1->0: s<1 && t>0? no road starts left of 1
    expect(roadCandidates(m, 'A')).toEqual(['X']);
    // B->Y: |3-2| = 1, but road (1->2) vs (3->2): s=1<3 and t=2>2? no. Equal ends never cross
    expect(roadCandidates(m, 'B')).toEqual(['Y']);
  });

  it('crossing: B (lane 3) -> X (lane 0) is refused as too far; with lanes close, a crossing is refused', () => {
    const m = map();
    // Move X to lane 1 and Y to lane 2: A->Y exists (1->2). B(3) -> X(1) would be 3->1:
    // s=1<3 and t=2>1 -> crosses; and |3-1| = 2 is too far anyway. Make B lane 2, Y lane 2, X lane 1:
    m.nodes.find((n) => n.id === 'B').col = 2;
    m.nodes.find((n) => n.id === 'X').col = 1;
    m.nodes.find((n) => n.id === 'B').edges = ['Z'];
    m.nodes.find((n) => n.id === 'Z').col = 3;
    // roads: A(1)->Y(2), B(2)->Z(3). B(2)->X(1): lane ok (1), crossing with A->Y: s=1<2, t=2>1 -> crosses
    expect(roadCandidates(m, 'B')).not.toContain('X');
    // B(2)->Y(2): no crossing (same column, ends meet)
    expect(roadCandidates(m, 'B')).toContain('Y');
  });

  it('never offers a road it already has, a completed node, or a node in another row', () => {
    const m = map();
    m.nodes.find((n) => n.id === 'A').edges = ['X', 'Y'];
    expect(roadCandidates(m, 'A')).toEqual([]);
    const done = map();
    done.nodes.find((n) => n.id === 'X').completed = true;
    expect(roadCandidates(done, 'A')).toEqual([]);
    expect(roadCandidates(map(), 'boss')).toEqual([]);
    expect(roadCandidates(map(), 'nope')).toEqual([]);
  });

  it('a single-node row relaxes the lane rule, as the generator does: s (the only node) may reach any lane', () => {
    const m = map();
    m.nodes.find((n) => n.id === 's').edges = ['A'];
    expect(roadCandidates(m, 's')).toEqual(['B']); // B is lane 3, s is lane 2: any lane is fine from a lone node
  });

  it('pacing: a link that would make three non-combat nodes in a row, or two of one type side by side, is refused', () => {
    const m = map();
    const set = (id, type) => (m.nodes.find((n) => n.id === id).type = type);
    // s(battle) -> A(shop). From A, X(shop) would sit beside a shop: refused. X(church) fine.
    set('A', 'shop');
    set('X', 'shop');
    expect(roadCandidates(m, 'A')).toEqual([]);
    set('X', 'church');
    expect(roadCandidates(m, 'A')).toEqual(['X']);
    // chain: A(shop) -> church X -> (X's own child is a shop): A + X + that is three in a row
    set('boss', 'shop');
    expect(roadCandidates(m, 'A')).toEqual([]); // X(church) leads on to a shop: 1 (A) + 2 (X, boss) = 3
  });
});

describe('addRoad', () => {
  it('on every map shape: one new road from here to a next-row node it lacked; the map stays valid; nothing else moves', () => {
    let drew = 0;
    let fellBack = 0;
    for (let act = 0; act < 4; act++) {
      for (let seed = 1; seed <= 60; seed++) {
        const run = runForAct(seed, act);
        const row = 2 + (seed % (ACT_CONFIG[run.currentAct].rows - 4));
        const node = standOn(run, row);
        if (!node) continue;
        const before = snapshot(run);
        const edges = [...node.edges];
        const candidates = roadCandidates(run.nodeMap, node.id);
        const result = chooseEventOption(run, node.id, 'go');
        expect(result.ok, `act ${act + 1} seed ${seed}`).toBe(true);
        expect(checkNodeMapValidity(run.nodeMap), `act ${act + 1} seed ${seed}`).toEqual([]);
        expect(serviceStreakProblems(run.nodeMap)).toEqual([]);
        if (candidates.length === 0) {
          // nothing qualifies: the fallback pays, the map is as it was
          fellBack++;
          expect(result.text).toBe('Nothing to draw.');
          expect(result.results).toEqual([
            { kind: 'gold', value: FALLBACK_GOLD, requested: FALLBACK_GOLD },
          ]);
          expect(run.nodeMap).toEqual(before);
          continue;
        }
        drew++;
        const [record] = result.results;
        expect(record).toMatchObject({ kind: 'route', op: 'addRoad', from: node.id });
        expect(candidates).toContain(record.to);
        const target = byId(run.nodeMap, record.to);
        expect(target.row).toBe(node.row + 1);
        expect(node.edges).toEqual([...edges, record.to]);
        // exactly one node changed: the one we stand on (its edge list)
        expect(changedNodes(before, run.nodeMap).map((n) => n.id)).toEqual([node.id]);
        expect(record).toMatchObject({ row: target.row, col: target.col, type: target.type });
      }
    }
    expect(drew).toBeGreaterThan(20);
    expect(fellBack).toBeGreaterThan(5);
  });

  it('is seeded: the same run seed draws the same road; the rng picks among the candidates by position', () => {
    const roadFor = (seed) => {
      const run = runForAct(seed, 1);
      const node = standOn(run, 4);
      return node ? (chooseEventOption(run, node.id, 'go').results[0].to ?? null) : 'no node';
    };
    for (const seed of [12, 13, 14, 15]) expect(roadFor(seed)).toBe(roadFor(seed));
    // by hand: the stream's draw u picks candidate floor(u x n): 0 is the first, 0.999 the last
    const { run, node } = findStand(
      1,
      3,
      ADD_ROAD,
      (r, n) => roadCandidates(r.nodeMap, n.id).length >= 2,
    );
    const candidates = roadCandidates(run.nodeMap, node.id);
    expect(planRouteEdit(run, ADD_ROAD, node.id, () => 0).step.to).toBe(candidates[0]);
    expect(planRouteEdit(run, ADD_ROAD, node.id, () => 0.999).step.to).toBe(candidates.at(-1));
    // and across seeds the road is not always the same one
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) seen.add(roadFor(seed));
    expect(seen.size).toBeGreaterThan(2);
  });

  it('a failed apply leaves the road exactly as it was', () => {
    const { run, node } = findStand(
      1,
      3,
      ADD_ROAD,
      (r, n) => roadCandidates(r.nodeMap, n.id).length > 0,
    );
    run.gameData.events.events[0].choices[0].outcomes[0].effects.push({ type: 'gold', value: 5 });
    const before = snapshot(run);
    const spy = vi.spyOn(run, 'addGold').mockImplementation(() => {
      throw new Error('boom');
    });
    const result = chooseEventOption(run, node.id, 'go');
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(run.nodeMap).toEqual(before);
    expect(eventState(run, node.id).choiceId).toBeUndefined();
  });
});

describe('redraw', () => {
  /** Every node reachable from `id` within two rows. */
  const ahead = (run, id) => {
    const from = byId(run.nodeMap, id);
    const out = new Set();
    for (const childId of from.edges) {
      out.add(childId);
      for (const grand of byId(run.nodeMap, childId).edges) out.add(grand);
    }
    return [...out];
  };

  it.each(REDRAW_TYPES)(
    'to %s: one reachable node changes type, the map stays valid, nothing else moves',
    (toType) => {
      let changed = 0;
      for (let act = 0; act < 4; act++) {
        for (let seed = 1; seed <= 50; seed++) {
          const run = runForAct(seed, act, redraw(toType));
          const row = 2 + (seed % (ACT_CONFIG[run.currentAct].rows - 5));
          const node = standOn(run, row);
          if (!node) continue;
          const before = snapshot(run);
          const candidates = redrawCandidates(run, node.id, toType);
          const reachable = new Set(ahead(run, node.id));
          for (const id of candidates) expect(reachable.has(id)).toBe(true);
          const result = chooseEventOption(run, node.id, 'go');
          expect(result.ok).toBe(true);
          expect(checkNodeMapValidity(run.nodeMap)).toEqual([]);
          expect(serviceStreakProblems(run.nodeMap)).toEqual([]);
          if (candidates.length === 0) {
            expect(run.nodeMap).toEqual(before);
            expect(result.text).toBe('Nothing to draw.');
            continue;
          }
          changed++;
          const [record] = result.results;
          expect(record).toMatchObject({ kind: 'route', op: 'redraw', type: toType });
          expect(candidates).toContain(record.node);
          // only that node changed
          expect(changedNodes(before, run.nodeMap).map((n) => n.id)).toEqual([record.node]);
          const after = byId(run.nodeMap, record.node);
          const was = byId(before, record.node);
          expect(was.type).toBe(record.fromType);
          expect(was.type).not.toBe(toType);
          expect(after.type).toBe(toType);
          expect([after.id, after.row, after.col, after.edges]).toEqual([
            was.id,
            was.row,
            was.col,
            was.edges,
          ]);
          // the Eclipse keys on id and lane: the threshold has not moved
          const ctx = {
            runSeed: run.runSeed,
            rows: mapRowCount(run.nodeMap),
            config: run.gameData.eclipse,
          };
          expect(nodeFallThreshold(after, ctx)).toBe(nodeFallThreshold(was, ctx));
          // pacing: nobody beside it shares a non-combat type
          if (toType !== 'battle') {
            const neighbours = run.nodeMap.nodes.filter(
              (n) => n.edges.includes(after.id) || after.edges.includes(n.id),
            );
            for (const n of neighbours) expect(n.type).not.toBe(toType);
          }
        }
      }
      expect(changed).toBeGreaterThan(30);
    },
  );

  it('a shop or church comes with no battle params, template or fog; a battle comes with fresh ones', () => {
    let sawBattleFrom = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const run = runForAct(seed, 1, redraw('shop'));
      const node = standOn(run, 3);
      if (!node) continue;
      // make every candidate a battle with a template and fog, so stale fields would show
      for (const id of ahead(run, node.id)) {
        const n = byId(run.nodeMap, id);
        if (['battle', 'shop', 'church'].includes(n.type)) {
          n.type = 'battle';
          n.battleParams = {
            act: 'act2',
            objective: 'rout',
            battleSeed: 1,
            templateId: 'old',
            row: n.row,
          };
          n.templateId = 'old';
          n.fogEnabled = true;
        }
      }
      const result = chooseEventOption(run, node.id, 'go');
      const record = result.results[0];
      if (record.kind !== 'route') continue;
      sawBattleFrom++;
      const after = byId(run.nodeMap, record.node);
      expect(after).toMatchObject({ type: 'shop', battleParams: null });
      expect(after.templateId).toBeUndefined();
      expect(after.fogEnabled).toBeUndefined();
    }
    expect(sawBattleFrom).toBeGreaterThan(20);

    // and a battle is built by the generator: act, objective, level range, seed, template
    let built = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const run = runForAct(seed, 0, redraw('battle'));
      const node = standOn(run, 3);
      if (!node) continue;
      for (const id of ahead(run, node.id)) {
        const n = byId(run.nodeMap, id);
        if (n.type === 'battle') {
          n.type = 'church';
          n.battleParams = null;
          delete n.templateId;
          delete n.fogEnabled;
        }
      }
      const record = chooseEventOption(run, node.id, 'go').results[0];
      if (record.kind !== 'route') continue;
      built++;
      const after = byId(run.nodeMap, record.node);
      expect(after.type).toBe('battle');
      expect(after.battleParams).toMatchObject({ act: 'act1', row: after.row });
      expect(['rout', 'seize', 'escape']).toContain(after.battleParams.objective);
      expect(Number.isInteger(after.battleParams.battleSeed)).toBe(true);
      // act 1: row 3 is the default [2, 3] range, row 4 and on too
      expect(after.battleParams.levelRange).toEqual([2, 3]);
      expect(after.battleParams.templateId).toBe(after.templateId);
      if (after.battleParams.objective !== 'rout') expect(after.battleParams.isElite).toBe(true);
    }
    expect(built).toBeGreaterThan(20);
  });

  it('is seeded: the same run seed redraws the same node into the same battle', () => {
    const redrawn = (seed) => {
      const run = runForAct(seed, 1, redraw('battle'));
      const node = standOn(run, 3);
      if (!node) return 'no node';
      for (const id of ahead(run, node.id)) {
        const n = byId(run.nodeMap, id);
        if (n.type === 'battle') {
          n.type = 'shop';
          n.battleParams = null;
          delete n.templateId;
        }
      }
      const record = chooseEventOption(run, node.id, 'go').results[0];
      return record.kind === 'route' ? JSON.stringify(byId(run.nodeMap, record.node)) : 'none';
    };
    expect(redrawn(21)).toBe(redrawn(21));
    const seen = new Set();
    for (let seed = 1; seed <= 30; seed++) seen.add(redrawn(seed));
    expect(seen.size).toBeGreaterThan(10);
  });

  describe('never edits a node it must not', () => {
    /** Mark every node within two rows ahead with `plant`, then redraw: nothing may change. */
    const forbidden = (label, plant) => {
      it(`${label}`, () => {
        let tried = 0;
        for (const toType of REDRAW_TYPES) {
          for (let seed = 1; seed <= 25; seed++) {
            const run = runForAct(seed, 2, redraw(toType));
            const node = standOn(run, 3);
            if (!node) continue;
            for (const id of ahead(run, node.id)) plant(run, byId(run.nodeMap, id));
            const before = snapshot(run);
            const configs = structuredClone(run.battleConfigsByNodeId);
            expect(redrawCandidates(run, node.id, toType)).toEqual([]);
            const result = chooseEventOption(run, node.id, 'go');
            expect(result.ok).toBe(true);
            expect(result.text).toBe('Nothing to draw.'); // the fallback, not a redraw
            expect(run.nodeMap).toEqual(before);
            expect(run.battleConfigsByNodeId).toEqual(configs);
            tried++;
          }
        }
        expect(tried).toBeGreaterThan(50);
      });
    };
    forbidden('completed nodes', (_run, n) => (n.completed = true));
    forbidden('encounter-locked nodes', (_run, n) => (n.encounterLocked = true));
    forbidden('nodes that already fell to the Eclipse', (_run, n) => {
      n.eclipse = { fellAtShadow: 5, fromType: n.type, label: 'Eclipsed battle', seen: false };
      n.type = 'battle';
    });
    forbidden(
      'nodes with a saved battle config',
      (run, n) => (run.battleConfigsByNodeId[n.id] = { locked: true }),
    );
    forbidden('ambush villages', (_run, n) => (n.isAmbush = true));
    forbidden('recruit nodes', (_run, n) => {
      n.type = 'recruit';
      n.recruitPreview = { v: 1, className: 'Archer', name: 'Dov' };
    });
    forbidden('the arena', (_run, n) => (n.type = 'colosseum'));
    forbidden('other events', (_run, n) => (n.type = 'event'));
    forbidden('event fights', (_run, n) => (n.eventBattle = true));

    it('the Ruins and the boss: standing in the last rows, there is nothing to redraw', () => {
      for (const toType of REDRAW_TYPES) {
        const rows = ACT_CONFIG.act2.rows;
        for (const row of [rows - 3, rows - 4]) {
          const run = runForAct(5, 1, redraw(toType));
          const node = run.nodeMap.nodes.find((n) => n.row === row);
          arriveAs(run, 'cartographer', node);
          const ruins = run.nodeMap.nodes.find((n) => n.type === 'ruins');
          const boss = run.nodeMap.nodes.find((n) => n.type === 'boss');
          expect(isRedrawable(run, ruins)).toBe(false);
          expect(isRedrawable(run, boss)).toBe(false);
          const start = run.nodeMap.nodes.find((n) => n.id === run.nodeMap.startNodeId);
          expect(isRedrawable(run, start)).toBe(false);
          expect(
            redrawCandidates(run, node.id, toType).every(
              (id) => !['ruins', 'boss'].includes(byId(run.nodeMap, id).type),
            ),
          ).toBe(true);
          if (row === rows - 3) expect(redrawCandidates(run, node.id, toType)).toEqual([]); // only the Ruins ahead
        }
      }
    });

    it('the current node is never redrawn, and the one node left open is the one that changes', () => {
      let applied = 0;
      for (let seed = 1; seed <= 250; seed++) {
        const run = runForAct(seed, 2, redraw('battle'));
        const node = standOn(run, 3);
        if (!node) continue;
        expect(isRedrawable(run, node)).toBe(false); // the current node
        const open = ahead(run, node.id).filter((id) =>
          ['shop', 'church'].includes(byId(run.nodeMap, id).type),
        );
        if (open.length < 2) continue;
        // forbid every node ahead but the first of them
        for (const id of ahead(run, node.id))
          if (id !== open[0]) byId(run.nodeMap, id).encounterLocked = true;
        expect(redrawCandidates(run, node.id, 'battle')).toEqual([open[0]]);
        const record = chooseEventOption(run, node.id, 'go').results[0];
        expect(record).toMatchObject({ kind: 'route', node: open[0], type: 'battle' });
        applied++;
      }
      expect(applied).toBeGreaterThan(8);
    });

    it('a node the player cannot reach from here is never touched', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const run = runForAct(seed, 1, redraw('battle'));
        const node = standOn(run, 3);
        if (!node) continue;
        const reachable = new Set(ahead(run, node.id));
        const before = snapshot(run);
        chooseEventOption(run, node.id, 'go');
        for (const n of changedNodes(before, run.nodeMap)) expect(reachable.has(n.id)).toBe(true);
      }
    });
  });
});

describe('applyRouteEdit and planRouteEdit directly', () => {
  it('a redraw whose node fell to the dark between planning and applying is left as it was, with a note', () => {
    const run = runForAct(3, 1, redraw('shop'));
    const node = standOn(run, 3);
    const plan = planRouteEdit(run, redraw('shop'), node.id, () => 0);
    if (!plan.step) return; // this seed offers nothing: nothing to test
    const target = byId(run.nodeMap, plan.step.node);
    target.eclipse = {
      fellAtShadow: 9,
      fromType: target.type,
      label: 'Eclipsed battle',
      seen: false,
    };
    const before = JSON.stringify(target);
    const record = applyRouteEdit(run, plan.step, 'k');
    expect(record).toEqual({ kind: 'note', of: 'routeEdit', text: 'The road stays as it was.' });
    expect(JSON.stringify(target)).toBe(before);
  });

  it('planning is pure and refuses what it cannot read', () => {
    const run = runForAct(3, 1);
    const node = standOn(run, 3);
    const before = snapshot(run);
    planRouteEdit(run, ADD_ROAD, node.id, () => 0);
    planRouteEdit(run, redraw('shop'), node.id, () => 0.5);
    expect(run.nodeMap).toEqual(before);
    expect(planRouteEdit(run, { op: 'bend' }, node.id, () => 0)).toEqual({
      error: 'Unknown route edit "bend".',
    });
    expect(planRouteEdit(run, redraw('recruit'), node.id, () => 0)).toEqual({
      error: 'Cannot redraw to "recruit".',
    });
    expect(planRouteEdit({}, ADD_ROAD, node.id, () => 0)).toEqual({
      error: 'There is no map here.',
    });
  });

  it('an effect list holds one route edit (a second is refused with nothing changed)', () => {
    const { run, node } = findStand(
      1,
      3,
      ADD_ROAD,
      (r, n) => roadCandidates(r.nodeMap, n.id).length > 0,
    );
    run.gameData.events.events[0].choices[0].outcomes[0].effects = [ADD_ROAD, redraw('shop')];
    const before = snapshot(run);
    expect(chooseEventOption(run, node.id, 'go')).toEqual({
      ok: false,
      reason: 'One change to the road at a time.',
    });
    expect(run.nodeMap).toEqual(before);
  });
});
