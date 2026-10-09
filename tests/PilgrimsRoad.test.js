// Pilgrim's Road (`pilgrim_coin`, docs/specs/blessings-v3.md §4): each act's route gains one
// more shop, made by converting one event or church node in a post-pass on its own seeded
// stream (engine/ExtraShopPass.js). The node-map generator and its stream are untouched.
//
// Ways it can fail, a test each:
//   - a battle, recruit, Colosseum, Ruins, boss or shop is converted, or a node the party
//     already left or finished
//   - the pass uses Math.random (the node-map and battle streams move) or picks a different
//     node for the same seed
//   - another node on the map changes, or a second shop appears (reload, a second call)
//   - two shops end up side by side when a quieter node was free
//   - no eligible node makes it throw or leave a half-converted map
//   - a later act gets no shop, the prologue gets one, a church vow converts a node behind
//     the party, or a reload stamps again
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  extraShopCandidates,
  pilgrimShopCount,
  stampExtraShops,
} from '../src/engine/ExtraShopPass.js';
import { SAFE_BLESSING_BOON_TYPES } from '../src/engine/EventSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => vi.restoreAllMocks());

// --- synthetic maps ---------------------------------------------------------

/** { id: [type, row, edges?, extra?] } -> a node map. */
function mapOf(spec, actId = 'act2') {
  const nodes = Object.entries(spec).map(([id, [type, row, edges = [], extra = {}]], i) => ({
    id,
    row,
    col: i,
    type,
    edges,
    battleParams: type === 'battle' ? { act: actId, objective: 'rout' } : null,
    completed: false,
    ...extra,
  }));
  return { actId, nodes, startNodeId: nodes[0].id, bossNodeId: nodes.at(-1).id };
}
const typeOf = (map, id) => map.nodes.find((n) => n.id === id).type;
const snapshot = (map) => JSON.stringify(map);

describe('who may become a shop', () => {
  it('converts an event or a church only, and leaves every other node byte for byte alone', () => {
    const map = mapOf({
      start: ['battle', 0, ['ev', 'ch', 'rc', 'co']],
      ev: ['event', 1, ['ru']],
      ch: ['church', 1, ['ru']],
      rc: ['recruit', 1, ['ru']],
      co: ['colosseum', 1, ['ru']],
      ru: ['ruins', 2, ['boss']],
      boss: ['boss', 3],
    });
    const before = JSON.parse(snapshot(map));
    const converted = stampExtraShops(map, { runSeed: 5 });
    expect(converted).toHaveLength(1);
    expect(['ev', 'ch']).toContain(converted[0]);
    const node = map.nodes.find((n) => n.id === converted[0]);
    expect(node).toMatchObject({ type: 'shop', battleParams: null, pilgrimShop: true });
    for (const was of before.nodes) {
      if (was.id === converted[0]) continue;
      expect(map.nodes.find((n) => n.id === was.id)).toEqual(was);
    }
  });

  it('never takes a battle, recruit, Colosseum, Ruins, boss or existing shop: no candidates, no change, no throw', () => {
    const map = mapOf({
      start: ['battle', 0, ['rc', 'co', 'sh']],
      rc: ['recruit', 1, ['ru']],
      co: ['colosseum', 1, ['ru']],
      sh: ['shop', 1, ['ru']],
      ru: ['ruins', 2, ['boss']],
      boss: ['boss', 3],
    });
    const before = snapshot(map);
    expect(() => stampExtraShops(map, { runSeed: 1 })).not.toThrow();
    expect(stampExtraShops(map, { runSeed: 1 })).toEqual([]);
    expect(snapshot(map)).toBe(before);
  });

  it('skips completed nodes, the node the party stands on, rows already behind it and eclipsed nodes', () => {
    const map = mapOf({
      done: ['event', 2, [], { completed: true }],
      here: ['church', 3],
      behind: ['event', 1],
      swallowed: ['event', 4, [], { eclipse: { fromType: 'event', label: 'Swallowed road' } }],
      omen: ['event', 4, [], { darkOmen: true }],
      ahead: ['church', 5],
    });
    expect(
      extraShopCandidates(map, { fromRow: 3, currentNodeId: 'here' }).map((n) => n.id),
    ).toEqual(['ahead']);
    expect(stampExtraShops(map, { runSeed: 9, fromRow: 3, currentNodeId: 'here' })).toEqual([
      'ahead',
    ]);
    for (const id of ['done', 'here', 'behind', 'swallowed', 'omen'])
      expect(typeOf(map, id)).not.toBe('shop');
  });
});

describe('preferring quiet nodes (no shop beside it)', () => {
  // x1's sibling x2 is a shop; y1 (a church) and z1 (an event) have quiet neighbours.
  const build = (patch = {}) =>
    mapOf({
      p1: ['battle', 0, ['x1', 'x2']],
      x1: ['event', 1, ['w']],
      x2: ['shop', 1, ['w']],
      p2: ['battle', 0, ['y1', 'y2']],
      y1: ['church', 1, ['w']],
      y2: ['battle', 1, ['w']],
      p3: ['battle', 0, ['z1']],
      z1: ['event', 1, ['w']],
      w: ['battle', 2],
      ...patch,
    });

  it('an event with no shop beside it comes first', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = build();
      expect(stampExtraShops(map, { runSeed: seed })).toEqual(['z1']);
    }
  });

  it('then a quiet church, before an event that would sit beside a shop', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = build({ z1: ['event', 1, ['w'], { completed: true }] });
      expect(stampExtraShops(map, { runSeed: seed })).toEqual(['y1']);
    }
  });

  it('then any event, then any church', () => {
    const noQuiet = (spec) => {
      const map = build(spec);
      return stampExtraShops(map, { runSeed: 3 });
    };
    expect(noQuiet({ z1: ['event', 1, ['w'], { completed: true }], y1: ['church', 1, ['w'], { completed: true }] })).toEqual(['x1']); // prettier-ignore
    // Only a church beside a shop is left: it still becomes the shop rather than nothing.
    expect(
      noQuiet({
        x1: ['church', 1, ['w']],
        z1: ['event', 1, ['w'], { completed: true }],
        y1: ['church', 1, ['w'], { completed: true }],
      }),
    ).toEqual(['x1']);
  });

  it('counts a shop parent and a shop child as beside it, as well as a shop sibling', () => {
    const parentShop = mapOf({
      sh: ['shop', 0, ['a']],
      a: ['event', 1, ['m']],
      q: ['battle', 0, ['b']],
      b: ['event', 1, ['m']],
      m: ['battle', 2],
    });
    expect(stampExtraShops(parentShop, { runSeed: 1 })).toEqual(['b']);
    const childShop = mapOf({
      p: ['battle', 0, ['a', 'q']],
      a: ['event', 1, ['sh']],
      sh: ['shop', 2],
      q: ['battle', 1, ['b']],
      b: ['event', 2, ['m']],
      m: ['battle', 3],
    });
    expect(stampExtraShops(childShop, { runSeed: 1 })).toEqual(['b']);
  });
});

describe('determinism and the node-map stream', () => {
  const crowded = () => {
    const spec = { start: ['battle', 0, ['e0', 'e1', 'e2', 'e3', 'e4', 'e5']] };
    for (let i = 0; i < 6; i++) spec[`e${i}`] = ['event', 1, ['end']];
    spec.end = ['battle', 2];
    return mapOf(spec);
  };

  it('the same seed and act always pick the same node, and different seeds spread across them', () => {
    const picks = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const first = stampExtraShops(crowded(), { runSeed: seed });
      expect(stampExtraShops(crowded(), { runSeed: seed })).toEqual(first);
      picks.add(first[0]);
    }
    expect(picks.size).toBeGreaterThanOrEqual(4);
  });

  it('each act draws its own node from the same layout', () => {
    const picks = (actId) =>
      Array.from({ length: 40 }, (_, i) => {
        const map = crowded();
        map.actId = actId;
        return stampExtraShops(map, { runSeed: i + 1 })[0];
      });
    expect(picks('act2')).not.toEqual(picks('act3'));
  });

  it('draws nothing from Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    stampExtraShops(crowded(), { runSeed: 77 });
    expect(random).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call on the same map changes nothing', () => {
    const map = crowded();
    const first = stampExtraShops(map, { runSeed: 4 });
    const after = snapshot(map);
    expect(stampExtraShops(map, { runSeed: 4 })).toEqual([]);
    expect(snapshot(map)).toBe(after);
    expect(pilgrimShopCount(map)).toBe(1);
    expect(first).toHaveLength(1);
  });

  it('a larger count adds only the missing shops', () => {
    const map = crowded();
    stampExtraShops(map, { runSeed: 4, count: 1 });
    const more = stampExtraShops(map, { runSeed: 4, count: 2 });
    expect(more).toHaveLength(1);
    expect(pilgrimShopCount(map)).toBe(2);
  });
});

// --- the card and the run ---------------------------------------------------

function runWith(seed, { withCard = true, difficultyId = 'dusk' } = {}) {
  const run = new RunManager(data);
  run.startRun({ runSeed: seed, difficultyId });
  if (withCard) {
    run.activeBlessings = [{ id: 'pilgrim_coin', rolledCost: null }];
    run._runStartBlessingsApplied = false;
    run.applyRunStartBlessingEffects();
  }
  return run;
}
const pilgrims = (run) => run.nodeMap.nodes.filter((n) => n.pilgrimShop);

describe("Pilgrim's Road: the card", () => {
  it('is the data row the brief names, and an event may still hand it out', () => {
    const row = data.blessings.blessings.find((b) => b.id === 'pilgrim_coin');
    expect(row.name).toBe("Pilgrim's Road");
    expect(row.tier).toBe(2);
    expect(row.tags).toEqual(['shop']);
    expect(row.boons).toEqual([{ type: 'extra_shop_per_act', params: { value: 1 } }]);
    expect(row.description.length).toBeLessThanOrEqual(90);
    expect(row.lore.length).toBeLessThanOrEqual(85);
    expect(SAFE_BLESSING_BOON_TYPES).toContain('extra_shop_per_act');
  });

  it('gives no stock or price change any more', () => {
    const run = runWith(21);
    expect(run.getShopItemCountDelta()).toBe(0);
    expect(run.getShopPriceDiscount()).toBe(0);
    expect(run.getExtraShopsPerAct()).toBe(1);
  });
});

describe("Pilgrim's Road on a real run", () => {
  it('Act 1 holds exactly one extra shop from the shrine, an event or church made a shop', () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const plain = runWith(seed, { withCard: false });
      const run = runWith(seed);
      const made = pilgrims(run);
      expect(made).toHaveLength(1);
      expect(['event', 'church']).toContain(
        plain.nodeMap.nodes.find((n) => n.id === made[0].id).type,
      );
    }
  });

  it('changes nothing else on the map: every other node is identical to the map without the card', () => {
    for (const seed of [31, 32, 33, 34]) {
      const plain = runWith(seed, { withCard: false });
      const run = runWith(seed);
      const [made] = pilgrims(run);
      expect(run.nodeMap.nodes).toHaveLength(plain.nodeMap.nodes.length);
      for (const node of run.nodeMap.nodes) {
        if (node.id === made.id) continue;
        expect(node).toEqual(plain.nodeMap.nodes.find((n) => n.id === node.id));
      }
      // The node-map stream is where it was: the next act's map is the same too (bar its shop).
      plain.advanceAct();
      run.advanceAct();
      const [next] = pilgrims(run);
      for (const node of run.nodeMap.nodes) {
        if (node.id === next?.id) continue;
        expect(node).toEqual(plain.nodeMap.nodes.find((n) => n.id === node.id));
      }
    }
  });

  it('every later act gets its own shop; the final act, which has no event or church, gets none', () => {
    for (const difficultyId of ['normal', 'dusk', 'hard', 'lunatic']) {
      const run = runWith(1234, { difficultyId });
      for (let guard = 0; guard < 8; guard++) {
        const expected = run.currentAct === 'finalBoss' ? 0 : 1;
        expect(pilgrims(run).length, `${difficultyId} ${run.currentAct}`).toBe(expected);
        if (run.actIndex >= run.actSequence.length - 1) break;
        run.advanceAct();
      }
    }
  });

  it('a save and load keeps the shop, stamps nothing twice and still adds one to the next act', () => {
    const run = runWith(41);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    const loaded = RunManager.fromJSON(saved, data);
    expect(pilgrims(loaded).map((n) => n.id)).toEqual(pilgrims(run).map((n) => n.id));
    expect(loaded._stampExtraShops()).toEqual([]);
    expect(pilgrims(loaded)).toHaveLength(1);
    run.advanceAct();
    loaded.advanceAct();
    expect(pilgrims(loaded).map((n) => n.id)).toEqual(pilgrims(run).map((n) => n.id));
    expect(pilgrims(loaded)).toHaveLength(1);
  });

  it('a church vow mid-act converts only a node still ahead of the party', () => {
    // The party stands on a row-4 node. Event and church nodes on the rows behind it that it
    // never visited are not "completed", but they are behind it all the same.
    const isService = (n) => n.type === 'event' || n.type === 'church';
    let checked = 0;
    for (let seed = 51; seed < 400 && checked < 10; seed++) {
      const run = runWith(seed, { withCard: false });
      run.advanceAct();
      const here = run.nodeMap.nodes.find((n) => n.row === 4);
      const nodes = run.nodeMap.nodes;
      if (!here || !nodes.some((n) => n.row < 4 && isService(n))) continue;
      if (!nodes.some((n) => n.row > 4 && isService(n))) continue;
      checked++;
      run.currentNodeId = here.id;
      const before = JSON.parse(JSON.stringify(nodes));
      expect(run.addBlessingMidRun('pilgrim_coin')).toBe(true);
      const made = pilgrims(run);
      expect(made, `seed ${seed}`).toHaveLength(1);
      expect(made[0].row, `seed ${seed}`).toBeGreaterThan(4);
      expect(made[0].completed).toBe(false);
      for (const was of before) {
        if (was.id === made[0].id) continue;
        expect(run.nodeMap.nodes.find((n) => n.id === was.id)).toEqual(was);
      }
      // The next act still gets its own.
      run.advanceAct();
      expect(pilgrims(run)).toHaveLength(1);
    }
    expect(checked).toBe(10);
  });

  it('with nothing ahead to convert, taking the vow changes no node and does not throw', () => {
    const run = runWith(52, { withCard: false });
    const last = run.nodeMap.nodes.filter((n) => n.type !== 'boss').at(-1);
    run.currentNodeId = last.id;
    for (const node of run.nodeMap.nodes) if (node.type === 'event' || node.type === 'church') node.completed = true; // prettier-ignore
    const before = JSON.stringify(run.nodeMap);
    expect(() => run.addBlessingMidRun('pilgrim_coin')).not.toThrow();
    expect(JSON.stringify(run.nodeMap)).toBe(before);
    expect(run.getExtraShopsPerAct()).toBe(1);
  });

  it('the prologue never gains a shop, even with the field set', () => {
    const run = new RunManager(data);
    run.startPrologue(data);
    run.blessingRuntimeModifiers.extraShopsPerAct = 1;
    const before = JSON.stringify(run.nodeMap);
    expect(run._stampExtraShops()).toEqual([]);
    expect(JSON.stringify(run.nodeMap)).toBe(before);
  });

  it('a save from before the card loads with no extra shops, and a damaged value loads whole', () => {
    const run = runWith(61);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.blessingRuntimeModifiers.extraShopsPerAct;
    expect(RunManager.fromJSON(saved, data).getExtraShopsPerAct()).toBe(0);
    saved.blessingRuntimeModifiers.extraShopsPerAct = -3.2;
    expect(RunManager.fromJSON(saved, data).getExtraShopsPerAct()).toBe(0);
    saved.blessingRuntimeModifiers.extraShopsPerAct = 2.9;
    expect(RunManager.fromJSON(saved, data).getExtraShopsPerAct()).toBe(2);
  });
});

describe('how often no node is eligible (seed sweep)', () => {
  // Every rung, 150 seeds, every act of the run. The final act has no event or church by
  // construction (rows 0-1 battles, then the Ruins and the boss), so it never gains a shop.
  const SEEDS = 150;
  const rungs = ['normal', 'dusk', 'hard', 'lunatic'];

  it('an ordinary act with a route always finds a node', () => {
    const misses = [];
    let maps = 0;
    for (const difficultyId of rungs) {
      for (let i = 1; i <= SEEDS; i++) {
        const run = runWith(i * 7919 + 13, { difficultyId });
        for (let guard = 0; guard < 8; guard++) {
          if (run.currentAct !== 'finalBoss') {
            maps++;
            if (pilgrims(run).length !== 1) misses.push(`${difficultyId}/${run.currentAct}#${i}`);
          }
          if (run.actIndex >= run.actSequence.length - 1) break;
          run.advanceAct();
        }
      }
    }
    expect(maps).toBeGreaterThan(2000);
    // Measured at 1500 seeds per rung, no ordinary map missed; allow a rare miss, never a trend.
    expect(misses.length / maps).toBeLessThan(0.002);
  });
});
