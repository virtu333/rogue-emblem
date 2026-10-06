// The Event node on the route map (docs/specs/event-nodes.md §1: rows, node-type weights,
// generation passes). Ways it can go wrong, one test each:
//   - a threshold is off (an event slice too fat or thin, a boundary on the wrong side);
//   - pickNodeType draws twice (every later draw of the node-map stream shifts) or draws
//     on a pinned row;
//   - an event lands in row 0/1, the Ruins row or the boss row;
//   - an event carries battle params / a template / fog before a choice starts a battle;
//   - the streak repair ignores events (event above event, event beside event, three
//     non-combat nodes in a row) or converts one into something other than a battle;
//   - the recruit guarantee converts an event;
//   - a conflicting event or service falls straight to a battle instead of trying another
//     non-combat type (the extra row then adds fights);
//   - the per-path counts drift: the extra row must keep the fights, shops and churches a
//     path met on the 8/9-row maps and add about one event.
// Expected cut points are written out by hand from the table; the per-path baselines were
// measured on the 8/9-row generator (main, 2026-10-06), not read from this code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateNodeMap, pickNodeType } from '../src/engine/NodeMapGenerator.js';
import { ACT_CONFIG, NODE_TYPES, NODE_TYPE_WEIGHTS } from '../src/utils/constants.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const ACTS = ['act1', 'act2', 'act3', 'act4'];

afterEach(() => vi.restoreAllMocks());

/** A map generated the way a run generates one (colosseum rule on), under a seeded stream. */
function mapFor(act, seed, options = {}) {
  vi.spyOn(Math, 'random').mockImplementation(createSeededRng(seed));
  try {
    return generateNodeMap(act, ACT_CONFIG[act], data.mapTemplates, {
      colosseumConfig: data.colosseum?.nodeGeneration ?? null,
      ...options,
    });
  } finally {
    vi.restoreAllMocks();
  }
}

/** Run `fn` with one act's thresholds replaced (restored even on failure). */
function withWeights(act, weights, fn) {
  const prev = NODE_TYPE_WEIGHTS[act];
  NODE_TYPE_WEIGHTS[act] = weights;
  try {
    return fn();
  } finally {
    NODE_TYPE_WEIGHTS[act] = prev;
  }
}

const isMixedRow = (node, act) => node.row >= 2 && node.row <= ACT_CONFIG[act].rows - 3;

describe('rows per act', () => {
  it('act 1 has 9 rows, acts 2-4 have 10, the final battle is unchanged', () => {
    expect(ACT_CONFIG.act1.rows).toBe(9);
    expect(ACT_CONFIG.act2.rows).toBe(10);
    expect(ACT_CONFIG.act3.rows).toBe(10);
    expect(ACT_CONFIG.act4.rows).toBe(10);
    expect(ACT_CONFIG.finalBoss.rows).toBe(2);
  });

  it('generated maps span exactly that many rows, ending Ruins then boss', () => {
    const expected = { act1: 9, act2: 10, act3: 10, act4: 10 };
    for (const act of ACTS) {
      for (let seed = 1; seed <= 20; seed++) {
        const map = mapFor(act, seed);
        const rows = expected[act];
        expect(Math.max(...map.nodes.map((n) => n.row)) + 1, `${act}/${seed}`).toBe(rows);
        expect(map.nodes.find((n) => n.row === rows - 2).type).toBe(NODE_TYPES.RUINS);
        expect(map.nodes.find((n) => n.row === rows - 1).type).toBe(NODE_TYPES.BOSS);
      }
    }
  });

  it('act 1 seize maps open at row 5 (ceil(9 / 2)), never earlier', () => {
    const seizeRows = new Set();
    for (let seed = 1; seed <= 150; seed++) {
      for (const n of mapFor('act1', seed).nodes) {
        if (n.battleParams?.objective === 'seize' && n.type === NODE_TYPES.BATTLE)
          seizeRows.add(n.row);
      }
    }
    expect([...seizeRows].sort()).toEqual([5, 6]);
  });
});

describe('pickNodeType: thresholds and the single draw', () => {
  /** What one mixed-row pick returns for a scripted roll, and how many draws it took. */
  function pickAt(roll, act, row = 2, rows = ACT_CONFIG[act]?.rows ?? 10) {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(roll);
    const type = pickNodeType(row, rows, act);
    const draws = spy.mock.calls.length;
    spy.mockRestore();
    return { type, draws };
  }

  // Cumulative cut points straight from the spec table: [roll, expected type].
  const ACT1 = [
    [0, 'battle'],
    [0.5199, 'battle'],
    [0.52, 'shop'],
    [0.5799, 'shop'],
    [0.58, 'church'],
    [0.6599, 'church'],
    [0.66, 'event'],
    [0.9999, 'event'],
  ];
  const LATER = [
    [0, 'battle'],
    [0.4399, 'battle'],
    [0.44, 'shop'],
    [0.5699, 'shop'],
    [0.57, 'church'],
    [0.7299, 'church'],
    [0.73, 'event'],
    [0.9999, 'event'],
  ];

  it('act 1 cuts at .52 / .58 / .66, with exactly one draw per mixed node', () => {
    for (const [roll, type] of ACT1) {
      expect(pickAt(roll, 'act1'), `roll ${roll}`).toEqual({ type, draws: 1 });
    }
  });

  it('acts 2-4 cut at .44 / .57 / .73, with exactly one draw per mixed node', () => {
    for (const act of ['act2', 'act3', 'act4']) {
      for (const [roll, type] of LATER) {
        expect(pickAt(roll, act), `${act} roll ${roll}`).toEqual({ type, draws: 1 });
      }
    }
  });

  it('every mixed row of every act can draw an event; the pinned rows draw nothing', () => {
    for (const act of ACTS) {
      const rows = ACT_CONFIG[act].rows;
      for (let row = 2; row <= rows - 3; row++) {
        expect(pickAt(0.99, act, row, rows)).toEqual({ type: 'event', draws: 1 });
      }
      expect(pickAt(0.99, act, 0, rows)).toEqual({ type: 'battle', draws: 0 });
      expect(pickAt(0.99, act, 1, rows)).toEqual({ type: 'battle', draws: 0 });
      expect(pickAt(0.99, act, rows - 2, rows)).toEqual({ type: 'ruins', draws: 0 });
      expect(pickAt(0.99, act, rows - 1, rows)).toEqual({ type: 'boss', draws: 0 });
    }
  });

  it('the raw draw follows the table over many seeded rolls', () => {
    // Hand-derived raw shares (battle, shop, church, event) in percent; sigma is about 0.2.
    const expected = {
      act1: { battle: 52, shop: 6, church: 8, event: 34 },
      act2: { battle: 44, shop: 13, church: 16, event: 27 },
    };
    for (const [act, shares] of Object.entries(expected)) {
      const rng = createSeededRng(4242);
      vi.spyOn(Math, 'random').mockImplementation(rng);
      const counts = { battle: 0, shop: 0, church: 0, event: 0 };
      const N = 60000;
      for (let i = 0; i < N; i++) counts[pickNodeType(3, 9, act)]++;
      vi.restoreAllMocks();
      for (const [type, pct] of Object.entries(shares)) {
        expect(Math.abs((counts[type] / N) * 100 - pct), `${act} ${type}`).toBeLessThan(0.9);
      }
    }
  });
});

describe('where events appear', () => {
  it('only in rows 2..rows-3: never row 0, row 1, the Ruins or the boss', () => {
    let seen = 0;
    for (const act of ACTS) {
      for (let seed = 1; seed <= 250; seed++) {
        const map = mapFor(act, seed, { villageAmbushChance: 0.5 });
        for (const n of map.nodes) {
          if (n.type !== NODE_TYPES.EVENT) continue;
          seen++;
          expect(isMixedRow(n, act), `${act}/${seed}/${n.id}`).toBe(true);
        }
        expect(map.nodes.filter((n) => n.row < 2).every((n) => n.type === NODE_TYPES.BATTLE)).toBe(
          true,
        );
      }
    }
    expect(seen).toBeGreaterThan(500); // the test saw events at all
  });

  it('an event has no battle params, template or fog at generation', () => {
    for (const act of ACTS) {
      for (let seed = 1; seed <= 150; seed++) {
        for (const n of mapFor(act, seed).nodes.filter((x) => x.type === NODE_TYPES.EVENT)) {
          expect(n.battleParams, `${act}/${seed}/${n.id}`).toBeNull();
          expect(n).not.toHaveProperty('templateId');
          expect(n).not.toHaveProperty('fogEnabled');
          expect(n.completed).toBe(false);
        }
      }
    }
  });
});

describe('service-streak repair with events', () => {
  // An event-heavy table so the repair has plenty to fix: 5% battle, 5% shop, 5% church.
  const HEAVY = { battle: 0.05, shop: 0.1, church: 0.15 };
  const NON_COMBAT = new Set([
    NODE_TYPES.SHOP,
    NODE_TYPES.CHURCH,
    NODE_TYPES.COLOSSEUM,
    NODE_TYPES.EVENT,
  ]);

  it('never puts an event above, beside (same parent) or in a three-node chain with another', () => {
    let survivors = 0;
    withWeights('act1', HEAVY, () => {
      for (let seed = 1; seed <= 250; seed++) {
        const map = mapFor('act1', seed, {
          colosseumConfig: { spawnChance: 1, preferredRows: [2, 3, 4] },
        });
        const byId = new Map(map.nodes.map((n) => [n.id, n]));
        const streak = new Map();
        for (const node of map.nodes) {
          const kids = node.edges.map((id) => byId.get(id));
          const kidEvents = kids.filter((k) => k.type === NODE_TYPES.EVENT);
          if (node.type === NODE_TYPES.EVENT) {
            survivors++;
            expect(kidEvents.length, `${seed}/${node.id} event above event`).toBe(0);
          }
          expect(kidEvents.length, `${seed}/${node.id} events side by side`).toBeLessThanOrEqual(1);
          const parents = map.nodes.filter((n) => n.edges.includes(node.id));
          const count = NON_COMBAT.has(node.type)
            ? 1 + Math.max(0, ...parents.map((p) => streak.get(p.id)))
            : 0;
          streak.set(node.id, count);
          expect(count, `${seed}/${node.id} streak`).toBeLessThanOrEqual(2);
        }
      }
    });
    expect(survivors).toBeGreaterThan(100); // events still exist: the repair is not a purge
  });

  it('a repaired event becomes a full battle: params, seed, template and level range', () => {
    let converted = 0;
    withWeights('act1', HEAVY, () => {
      for (let seed = 1; seed <= 100; seed++) {
        const map = mapFor('act1', seed);
        for (const n of map.nodes.filter((x) => isMixedRow(x, 'act1'))) {
          if (n.type !== NODE_TYPES.BATTLE) continue;
          // With 5% battles drawn, most mixed battles here were events or services.
          converted++;
          expect(n.battleParams.act).toBe('act1');
          expect(n.battleParams.row).toBe(n.row);
          expect(Number.isInteger(n.battleParams.battleSeed)).toBe(true);
          expect(n.battleParams.levelRange).toEqual(n.row === 2 ? [1, 3] : [2, 3]);
          expect(n.templateId).toBe(n.battleParams.templateId);
          expect(typeof n.templateId).toBe('string');
        }
      }
    });
    expect(converted).toBeGreaterThan(300);
  });

  it('the recruit guarantee never converts an event (battle/shop only)', () => {
    // Nothing but events and nothing to convert before the repair: no recruit may appear.
    withWeights('act1', { battle: 0, shop: 0, church: 0 }, () => {
      let events = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const map = mapFor('act1', seed);
        expect(map.nodes.filter((n) => n.type === NODE_TYPES.RECRUIT)).toHaveLength(0);
        events += map.nodes.filter((n) => n.type === NODE_TYPES.EVENT).length;
      }
      expect(events).toBeGreaterThan(60);
    });
  });

  it('with the normal table recruits still come from battles: 2-3 per act, none on an event row', () => {
    for (const act of ACTS) {
      for (let seed = 1; seed <= 100; seed++) {
        const n = mapFor(act, seed).nodes.filter((x) => x.type === NODE_TYPES.RECRUIT).length;
        expect(n, `${act}/${seed}`).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('what a path meets', () => {
  // Per path (one node per row, a seeded random walk from the start), measured on the
  // 8/9-row generator before events (main, 2026-10-06, 1500 maps x 4 walks per act):
  //   act 1:    fights (battle + recruit + boss) 5.84, shops 0.57, churches 0.43
  //   acts 2-4: fights 6.19-6.21,                  shops 0.83-0.86, churches 0.74
  // The extra row must keep those and add about one event.
  const BASELINE = {
    act1: { fights: 5.84, shop: 0.57, church: 0.43 },
    later: { fights: 6.2, shop: 0.85, church: 0.74 },
  };
  const TOLERANCE = { fights: 0.15, shop: 0.1, church: 0.08 };

  function perPath(act, maps = 1500, walks = 4) {
    const rng = createSeededRng(9001);
    const totals = {};
    let paths = 0;
    for (let seed = 1; seed <= maps; seed++) {
      const map = mapFor(act, seed);
      const byId = new Map(map.nodes.map((n) => [n.id, n]));
      for (let w = 0; w < walks; w++) {
        let node = map.nodes.find((n) => n.row === 0);
        while (node) {
          totals[node.type] = (totals[node.type] || 0) + 1;
          const next = node.edges.map((id) => byId.get(id));
          node = next.length ? next[Math.floor(rng() * next.length)] : null;
        }
        paths++;
      }
    }
    const per = (type) => (totals[type] || 0) / paths;
    return {
      fights: per('battle') + per('recruit') + per('boss'),
      shop: per('shop'),
      church: per('church'),
      event: per('event'),
    };
  }

  for (const act of ACTS) {
    it(`${act}: the same fights, shops and churches as before, plus about one event`, () => {
      const got = perPath(act);
      const base = BASELINE[act === 'act1' ? 'act1' : 'later'];
      for (const key of Object.keys(base)) {
        expect(
          Math.abs(got[key] - base[key]),
          `${act} ${key} ${got[key].toFixed(2)} vs ${base[key]}`,
        ).toBeLessThan(TOLERANCE[key]);
      }
      expect(got.event, `${act} events ${got.event.toFixed(2)}`).toBeGreaterThan(0.85);
      expect(got.event, `${act} events ${got.event.toFixed(2)}`).toBeLessThan(1.15);
    });
  }

  it('a conflicting event becomes a shop or church before it becomes a battle', () => {
    // Nothing but events: every repair has a non-combat alternative to try first, so
    // repaired mixed nodes include shops and churches, not only battles.
    withWeights('act1', { battle: 0, shop: 0, church: 0 }, () => {
      const counts = {};
      for (let seed = 1; seed <= 200; seed++) {
        for (const n of mapFor('act1', seed).nodes.filter((x) => isMixedRow(x, 'act1')))
          counts[n.type] = (counts[n.type] || 0) + 1;
      }
      expect(counts.shop || 0).toBeGreaterThan(50);
      expect(counts.church || 0).toBeGreaterThan(50);
      expect(counts.event || 0).toBeGreaterThan(200);
    });
  });
});
