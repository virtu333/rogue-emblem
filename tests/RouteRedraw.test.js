// Redraw road (engine/RouteRedraw.js, ui/RouteRedrawController.js; docs/specs/route-redraw.md):
// a Valor sink that buys choice, never power. Each test catches one way it could go wrong:
//   - the rows behind the party or the boss change (a redraw rewrites the past);
//   - the redraw draws from Math.random or differs between two copies of a run (the run's own
//     streams would shift, or a reload would show another road);
//   - the price or the cap of 5 slips, or a refused state still redraws;
//   - the new road holds more recruits or arenas than the old (power, not choice);
//   - a locked battle or other node-keyed state of the old road ahead lingers under a reused id,
//     or state behind is lost;
//   - Pilgrim's Road or the Old Sanctum is lost or doubled, or the dark spares the new road;
//   - the count is lost on save, or a refused spend or save leaves the road changed or the Valor
//     spent.
// Real RunManager and MetaProgressionManager on the shipped data.

import { beforeEach, describe, expect, it } from 'vitest';

const store = {};
let failMetaWrites = false;
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      if (failMetaWrites && k.endsWith('_meta')) throw new Error('QuotaExceededError');
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import { checkNodeMapValidity, mapRowCount } from '../src/engine/RouteEdit.js';
import {
  ROUTE_REDRAW_MAX,
  ROUTE_REDRAW_PRICES,
  redrawRoute,
  routeRedrawBlock,
  routeRedrawPrice,
  sanitizeRouteRedraws,
} from '../src/engine/RouteRedraw.js';
import {
  commitRouteRedraw,
  routeRedrawDoneText,
  routeRedrawPauseEntry,
} from '../src/ui/RouteRedrawController.js';
import { routeRedrawView } from '../src/ui/routeRedrawModel.js';

const data = loadGameData();
const META_KEY = getMetaKey(1);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  failMetaWrites = false;
});

/** A fresh run on `seed`, walked `steps` nodes into Act I (0: standing before the start node). */
function runAt(seed, steps = 1) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false });
  for (let i = 0; i < steps; i++) rm.markNodeComplete(rm.getAvailableNodes()[0].id);
  return rm;
}

const rowsOf = (rm) => mapRowCount(rm.nodeMap);
const keptRow = (rm) => rm.nodeMap.nodes.find((n) => n.id === rm.currentNodeId)?.row ?? 0;
const aheadOf = (rm, row = keptRow(rm)) =>
  rm.nodeMap.nodes.filter((n) => n.row > row && n.row < rowsOf(rm) - 1);
const behindOf = (rm, row = keptRow(rm)) => rm.nodeMap.nodes.filter((n) => n.row <= row);
const bossOf = (rm) => rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
/** A node without its edges (the seam row's edges are the one thing behind a redraw rewrites). */
const withoutEdges = ({ edges: _edges, ...rest }) => rest;
const roadSignature = (rm) =>
  JSON.stringify(aheadOf(rm).map((n) => [n.id, n.type, n.edges, n.battleParams?.templateId]));

describe('the road behind and the boss', () => {
  it('keeps every row up to the party and the boss, and changes the road ahead', () => {
    let changed = 0;
    for (const [seed, steps] of [
      [3, 0],
      [4, 1],
      [11, 2],
      [17, 3],
      [23, 4],
      [29, 5],
    ]) {
      const rm = runAt(seed, steps);
      const row = keptRow(rm);
      const behind = JSON.parse(JSON.stringify(behindOf(rm)));
      const boss = JSON.parse(JSON.stringify(bossOf(rm)));
      const before = roadSignature(rm);
      const result = redrawRoute(rm);
      expect(result.ok).toBe(true);
      const after = JSON.parse(JSON.stringify(behindOf(rm, row)));
      expect(after.map(withoutEdges)).toEqual(behind.map(withoutEdges));
      // Rows before the seam keep their edges too.
      expect(after.filter((n) => n.row < row)).toEqual(behind.filter((n) => n.row < row));
      expect(JSON.parse(JSON.stringify(bossOf(rm)))).toEqual(boss);
      expect(checkNodeMapValidity(rm.nodeMap)).toEqual([]);
      // The party can still walk on: every seam node leads into the new road.
      const firstRow = new Set(
        aheadOf(rm, row)
          .filter((n) => n.row === row + 1)
          .map((n) => n.id),
      );
      if (rm.currentNodeId) {
        const next = rm.getAvailableNodes();
        expect(next.length).toBeGreaterThan(0);
        for (const node of next) expect(firstRow.has(node.id)).toBe(true);
      }
      if (roadSignature(rm) !== before) changed += 1;
    }
    expect(changed).toBeGreaterThanOrEqual(5);
  });

  it('is offered from the start node before the first step, keeping the start node', () => {
    const rm = runAt(8, 0);
    expect(routeRedrawBlock(rm)).toBe('');
    const start = JSON.stringify(withoutEdges(bossOf(rm)));
    const startNode = withoutEdges(rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId));
    expect(redrawRoute(rm).ok).toBe(true);
    expect(withoutEdges(rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId))).toEqual(
      startNode,
    );
    expect(JSON.stringify(withoutEdges(bossOf(rm)))).toBe(start);
  });
});

describe('streams', () => {
  it('never draws from Math.random', () => {
    const rm = runAt(41, 2);
    const real = Math.random;
    let calls = 0;
    Math.random = () => {
      calls += 1;
      return real();
    };
    try {
      expect(redrawRoute(rm).ok).toBe(true);
    } finally {
      Math.random = real;
    }
    expect(calls).toBe(0);
  });

  it('draws the same road for two copies of a run, and another for the next redraw', () => {
    const one = runAt(52, 2);
    const two = runAt(52, 2);
    redrawRoute(one);
    redrawRoute(two);
    expect(roadSignature(one)).toBe(roadSignature(two));
    const first = roadSignature(one);
    redrawRoute(one);
    expect(roadSignature(one)).not.toBe(first);
  });
});

describe('price and cap', () => {
  it('charges 300/400/500/650/800 and refuses a sixth', () => {
    const rm = runAt(61, 1);
    const prices = [];
    for (let i = 0; i < ROUTE_REDRAW_MAX; i++) {
      expect(routeRedrawPrice(rm)).toBe(ROUTE_REDRAW_PRICES[i]);
      const result = redrawRoute(rm);
      expect(result).toMatchObject({ ok: true, n: i + 1 });
      prices.push(result.price);
    }
    expect(prices).toEqual([300, 400, 500, 650, 800]);
    expect(routeRedrawPrice(rm)).toBeNull();
    const map = JSON.stringify(rm.nodeMap);
    expect(redrawRoute(rm)).toEqual({ ok: false, reason: 'spent' });
    expect(JSON.stringify(rm.nodeMap)).toBe(map);
    // A new act does not hand any back: the cap is the run's.
    expect(rm.routeRedraws).toBe(5);
  });

  it('counts across the run, not the act', () => {
    const rm = runAt(62, 1);
    redrawRoute(rm);
    redrawRoute(rm);
    rm.markNodeComplete(bossOf(rm).id);
    rm.advanceAct();
    rm.markNodeComplete(rm.getAvailableNodes()[0].id);
    expect(routeRedrawPrice(rm)).toBe(500);
  });
});

describe('refusals', () => {
  it('is never offered in the prologue or a run without upgrades', () => {
    const prologue = new RunManager(data);
    prologue.startPrologue(data, data.prologue);
    expect(routeRedrawBlock(prologue)).toBe('not_offered');
    expect(routeRedrawView(prologue, 10000)).toBeNull();
    const plain = runAt(70, 1);
    plain.noMetaMode = true;
    expect(redrawRoute(plain)).toEqual({ ok: false, reason: 'not_offered' });
  });

  it('waits while a battle is under way or the party is held at its node', () => {
    const rm = runAt(71, 1);
    const next = rm.getAvailableNodes()[0];
    rm.battleInProgress = { nodeId: next.id };
    expect(redrawRoute(rm)).toEqual({ ok: false, reason: 'busy' });
    rm.battleInProgress = null;
    // Arrived at the next node and not done with it: it is the only way on.
    rm.currentNodeId = next.id;
    expect(redrawRoute(rm)).toEqual({ ok: false, reason: 'held' });
    rm.markNodeComplete(next.id);
    expect(routeRedrawBlock(rm)).toBe('');
  });

  it('has nothing to redraw with only the boss ahead', () => {
    const rm = runAt(72, 1);
    while (keptRow(rm) < rowsOf(rm) - 2) rm.markNodeComplete(rm.getAvailableNodes()[0].id);
    expect(redrawRoute(rm)).toEqual({ ok: false, reason: 'no_road' });
    expect(routeRedrawView(rm, 10000)).toBeNull();
  });
});

describe('no power from a redraw', () => {
  it('never adds a recruit or an arena to the road ahead', () => {
    let lost = 0;
    for (let seed = 100; seed < 160; seed++) {
      const rm = runAt(seed, seed % 4);
      const count = (type) => aheadOf(rm).filter((n) => n.type === type).length;
      const before = { recruit: count('recruit'), colosseum: count('colosseum') };
      for (let i = 0; i < 3; i++) {
        if (!redrawRoute(rm).ok) break;
        expect(count('recruit')).toBeLessThanOrEqual(before.recruit);
        expect(count('colosseum')).toBeLessThanOrEqual(before.colosseum);
      }
      if (count('recruit') < before.recruit) lost += 1;
    }
    // The cap bites only from above: some roads come back with fewer (the player's gamble).
    expect(lost).toBeGreaterThan(0);
  });

  it('lets the dark fall on the new road and marks those falls seen', () => {
    const rm = runAt(81, 1);
    expect(rm.isEclipseActive()).toBe(true);
    rm.eclipse = { ...rm.eclipse, actShadow: 500 };
    rm.applyEclipseNow();
    expect(redrawRoute(rm).ok).toBe(true);
    const fallen = aheadOf(rm).filter((n) => n.eclipse);
    expect(fallen.length).toBeGreaterThan(0);
    for (const node of fallen) expect(node.eclipse.seen).toBe(true);
    // Every fall the dark owes the new road has landed.
    expect(rm.applyEclipseNow()).toEqual([]);
  });

  it("moves Pilgrim's Road's shop to the new road, never adding one", () => {
    const ahead = runAt(90, 1);
    ahead.getExtraShopsPerAct = () => 1;
    ahead._stampExtraShops({ fromRow: keptRow(ahead) + 1, currentNodeId: ahead.currentNodeId });
    expect(aheadOf(ahead).filter((n) => n.pilgrimShop)).toHaveLength(1);
    expect(redrawRoute(ahead).ok).toBe(true);
    expect(ahead.nodeMap.nodes.filter((n) => n.pilgrimShop)).toHaveLength(1);
    expect(aheadOf(ahead).filter((n) => n.pilgrimShop)).toHaveLength(1);

    // A shop the party already passed is the act's one: the new road gets none.
    const passed = runAt(90, 1);
    passed.getExtraShopsPerAct = () => 1;
    const here = passed.nodeMap.nodes.find((n) => n.id === passed.currentNodeId);
    here.pilgrimShop = true;
    expect(redrawRoute(passed).ok).toBe(true);
    expect(passed.nodeMap.nodes.filter((n) => n.pilgrimShop)).toHaveLength(1);
  });

  it('moves an Old Sanctum ahead to a church on the new road, never adding one', () => {
    let moved = 0;
    for (let seed = 200; seed < 230; seed++) {
      const rm = runAt(seed, 1);
      const church = aheadOf(rm).find((n) => n.type === 'church');
      if (!church) continue;
      church.sanctum = true;
      expect(redrawRoute(rm).ok).toBe(true);
      const sanctums = rm.nodeMap.nodes.filter((n) => n.sanctum);
      expect(sanctums.length).toBeLessThanOrEqual(1);
      if (aheadOf(rm).some((n) => n.type === 'church')) {
        expect(sanctums).toHaveLength(1);
        expect(sanctums[0].type).toBe('church');
        moved += 1;
      }
      // Without a sanctum ahead, a redraw stamps none.
      const none = runAt(seed, 1);
      redrawRoute(none);
      expect(none.nodeMap.nodes.some((n) => n.sanctum)).toBe(false);
    }
    expect(moved).toBeGreaterThan(5);
  });
});

describe('state keyed by node', () => {
  it('drops what the old road ahead held and keeps what lies behind', () => {
    const rm = runAt(95, 2);
    const ahead = aheadOf(rm)[0].id;
    const here = rm.currentNodeId;
    rm.battleConfigsByNodeId = { [ahead]: { locked: 'old' }, [here]: { locked: 'here' } };
    rm.shopStateByNodeId = { [ahead]: { stock: [] }, [here]: { stock: ['kept'] } };
    rm.eventStateByNodeId = { [ahead]: { eventId: 'old' } };
    expect(redrawRoute(rm).ok).toBe(true);
    expect(rm.battleConfigsByNodeId).toEqual({ [here]: { locked: 'here' } });
    expect(rm.shopStateByNodeId).toEqual({ [here]: { stock: ['kept'] } });
    expect(rm.eventStateByNodeId).toEqual({});
  });
});

describe('saves', () => {
  it('keeps the count and the new road through a save', () => {
    const rm = runAt(97, 1);
    redrawRoute(rm);
    redrawRoute(rm);
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(loaded.routeRedraws).toBe(2);
    expect(routeRedrawPrice(loaded)).toBe(500);
    expect(roadSignature(loaded)).toBe(roadSignature(rm));
  });

  it('reads a save from before it, or a tampered count, as a whole number within the cap', () => {
    expect(sanitizeRouteRedraws(undefined)).toBe(0);
    expect(sanitizeRouteRedraws('3')).toBe(3);
    expect(sanitizeRouteRedraws(-2)).toBe(0);
    expect(sanitizeRouteRedraws(99)).toBe(5);
    const saved = runAt(98, 1).toJSON();
    delete saved.routeRedraws;
    expect(RunManager.fromJSON(JSON.parse(JSON.stringify(saved)), data).routeRedraws).toBe(0);
  });

  it('undo puts the road, the count and the node tables back exactly', () => {
    const rm = runAt(99, 2);
    rm.battleConfigsByNodeId = { [aheadOf(rm)[0].id]: { locked: 'old' } };
    const before = JSON.stringify(rm.toJSON());
    const result = redrawRoute(rm);
    expect(JSON.stringify(rm.toJSON())).not.toBe(before);
    result.undo();
    expect(JSON.stringify(rm.toJSON())).toBe(before);
  });
});

describe('paying for it', () => {
  const meta = (valor) => {
    const m = new MetaProgressionManager(data.metaUpgrades, META_KEY);
    if (valor) m.addValor(valor);
    return m;
  };
  const sceneFor = (run, m, persist = () => ({ ok: true })) => ({
    runManager: run,
    registry: { get: (key) => (key === 'meta' ? m : undefined) },
    persistRunSave: persist,
  });

  it('spendValor takes the Valor on disk, and refuses a short or failed spend', () => {
    const m = meta(1000);
    expect(m.spendValor(300)).toMatchObject({ ok: true });
    expect(m.getTotalValor()).toBe(700);
    expect(JSON.parse(store[META_KEY]).totalValor).toBe(700);
    expect(m.spendValor(701)).toEqual({ ok: false, reason: 'short' });
    expect(m.getTotalValor()).toBe(700);
    failMetaWrites = true;
    expect(m.spendValor(100).ok).toBe(false);
    expect(m.getTotalValor()).toBe(700);
  });

  it('redraws, pays and saves together', () => {
    const run = runAt(120, 1);
    const m = meta(1000);
    let saves = 0;
    const result = commitRouteRedraw(
      sceneFor(run, m, () => {
        saves += 1;
        return { ok: true };
      }),
    );
    expect(result).toMatchObject({ ok: true, n: 1, left: 4 });
    expect(m.getTotalValor()).toBe(700);
    expect(run.routeRedraws).toBe(1);
    expect(saves).toBe(1);
  });

  it('changes nothing when the Valor is short', () => {
    const run = runAt(121, 1);
    const before = JSON.stringify(run.toJSON());
    const m = meta(299);
    expect(routeRedrawView(run, 299)).toMatchObject({
      disabled: true,
      reason: 'Need 300 Valor (you have 299).',
    });
    expect(commitRouteRedraw(sceneFor(run, m)).ok).toBe(false);
    expect(JSON.stringify(run.toJSON())).toBe(before);
    expect(m.getTotalValor()).toBe(299);
  });

  it('undoes the redraw when the Valor cannot be written', () => {
    const run = runAt(122, 1);
    const before = JSON.stringify(run.toJSON());
    const m = meta(1000);
    failMetaWrites = true;
    expect(commitRouteRedraw(sceneFor(run, m))).toEqual({
      ok: false,
      reason: 'Could not save. Nothing was spent.',
    });
    expect(JSON.stringify(run.toJSON())).toBe(before);
    expect(m.getTotalValor()).toBe(1000);
  });

  it('undoes the redraw and hands the Valor back when the run cannot be saved', () => {
    const run = runAt(123, 1);
    const before = JSON.stringify(run.toJSON());
    const m = meta(1000);
    const result = commitRouteRedraw(sceneFor(run, m, () => ({ ok: false, reason: 'quota' })));
    expect(result).toEqual({ ok: false, reason: 'Could not save. Nothing was spent.' });
    expect(JSON.stringify(run.toJSON())).toBe(before);
    expect(m.getTotalValor()).toBe(1000);
    expect(JSON.parse(store[META_KEY]).totalValor).toBe(1000);
  });

  it('the pause menu entry says the price and what is left, or why it is greyed', () => {
    const run = runAt(124, 1);
    const held = (valor) => ({ getTotalValor: () => valor });
    expect(routeRedrawPauseEntry(sceneFor(run, held(1000)))).toMatchObject({
      label: 'Redraw road',
      detail: '300 Valor · 5 left',
      disabled: false,
    });
    expect(routeRedrawPauseEntry(sceneFor(run, held(120)))).toMatchObject({
      detail: 'Need 300 Valor (you have 120).',
      disabled: true,
    });
    run.routeRedraws = ROUTE_REDRAW_MAX;
    expect(routeRedrawPauseEntry(sceneFor(run, held(5000)))).toMatchObject({
      detail: 'No redraws left this run.',
      disabled: true,
    });
    run.noMetaMode = true;
    expect(routeRedrawPauseEntry(sceneFor(run, held(5000)))).toBeNull();
    expect(routeRedrawDoneText({ left: 1 })).toBe('The road ahead is redrawn. 1 redraw left.');
    expect(routeRedrawDoneText({ left: 0 })).toBe(
      'The road ahead is redrawn. No redraws left this run.',
    );
  });
});
