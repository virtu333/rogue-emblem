// The shrine's offer cannot be re-rolled by backing out (docs/specs/blessings-v3.md §3.2): the
// seed of a run offered but not begun is kept in the registry for its slot, so returning shows
// the same cards at the same prices; once the run begins the next one gets a fresh seed.
//
// Ways this can fail, a test each:
//   1. backing out and returning draws a new offer;
//   2. another slot inherits the pending seed;
//   3. opening another slot's shrine replaces this slot's seed, so slot 1 -> slot 2 -> slot 1
//      draws a new offer;
//   4. a begun run leaves the seed behind, so every later run repeats it;
//   5. beginning a run in one slot clears another slot's pending offer;
//   6. a page reload (a fresh registry) draws a new offer and gift (the seed lived only in the
//      registry);
//   7. the slot's stored seed survives the run's start, or a deleted slot, so a new run repeats
//      an old offer;
//   8. a device whose storage refuses loses the offer within the session (no registry fallback);
//   9. the DEV `?runSeed=` pin is read outside the dev routes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: vi.fn(() => Promise.resolve(true)),
  TRANSITION_REASONS: { BEGIN_RUN: 'begin_run', BACK: 'back' },
}));
vi.mock('../src/cloud/CloudSync.js', () => ({ deleteRunSave: vi.fn() }));
vi.mock('../src/utils/blessingAnalytics.js', () => ({ recordBlessingSelection: vi.fn() }));

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  writable: true,
});

import { BlessingSelectScene, devRunSeedParam } from '../src/scenes/BlessingSelectScene.js';
import { deleteSlot } from '../src/engine/SlotManager.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function registry(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => map.set(key, value),
    remove: (key) => map.delete(key),
    has: (key) => map.has(key),
  };
}

/** Open the shrine as the game does: init, then build the offer. */
function openShrine(reg) {
  const scene = Object.create(BlessingSelectScene.prototype);
  scene.registry = reg;
  scene.init({ gameData, difficultyId: 'dusk' });
  BlessingSelectScene.prototype._rebuildRunManager.call(scene);
  return scene;
}
/** Choose no blessing and begin the run, as the shrine's confirm does. */
async function beginRun(scene) {
  scene.isTransitioning = false;
  scene._blessingCommitted = false;
  scene.selectedIndex = scene._skipIndex(); // no blessing (after a gift, if one is offered)
  scene._confirm();
  await Promise.resolve();
  await Promise.resolve();
}
const offerOf = (scene) => scene.options.map((o) => [o.id, o.rolledCost?.label || null]);

describe('the shrine keeps its offer until the run begins', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });
  afterEach(() => vi.restoreAllMocks());

  it('backing out and returning shows the same cards at the same prices', () => {
    const reg = registry({ activeSlot: 1 });
    const first = openShrine(reg);
    const again = openShrine(reg);
    expect(again.runManager.runSeed).toBe(first.runManager.runSeed);
    expect(offerOf(again)).toEqual(offerOf(first));
  });

  it('another slot does not inherit it', () => {
    const reg = registry({ activeSlot: 1 });
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = openShrine(reg);
    reg.set('activeSlot', 2);
    Date.now.mockReturnValue(2000);
    const other = openShrine(reg);
    expect(first.runManager.runSeed).toBe(1000);
    expect(other.runManager.runSeed).toBe(2000);
  });

  it('each slot keeps its own offer through a round trip between slots', () => {
    const reg = registry({ activeSlot: 1 });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = openShrine(reg);
    reg.set('activeSlot', 2);
    now.mockReturnValue(2000);
    const second = openShrine(reg);
    reg.set('activeSlot', 1);
    now.mockReturnValue(3000);
    const back = openShrine(reg);
    expect(back.runManager.runSeed).toBe(1000);
    expect(offerOf(back)).toEqual(offerOf(first));
    reg.set('activeSlot', 2);
    now.mockReturnValue(4000);
    const backTo2 = openShrine(reg);
    expect(backTo2.runManager.runSeed).toBe(2000);
    expect(offerOf(backTo2)).toEqual(offerOf(second));
  });

  it('beginning the run clears it, so the next run is drawn afresh', async () => {
    const reg = registry({ activeSlot: 1 });
    const scene = openShrine(reg);
    await beginRun(scene);
    const next = Object.create(BlessingSelectScene.prototype);
    next.registry = reg;
    next.init({ gameData, difficultyId: 'dusk' });
    expect(next._blessingRunSeed).toBeNull();
  });

  it("beginning a run in one slot leaves another slot's offer standing", async () => {
    const reg = registry({ activeSlot: 1 });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = openShrine(reg);
    reg.set('activeSlot', 2);
    now.mockReturnValue(2000);
    await beginRun(openShrine(reg));
    reg.set('activeSlot', 1);
    now.mockReturnValue(3000);
    const back = openShrine(reg);
    expect(back.runManager.runSeed).toBe(1000);
    expect(offerOf(back)).toEqual(offerOf(first));
  });

  const KEY = 'emblem_rogue_slot_1_pendingSeed';
  function meta(runsStarted = 1) {
    return {
      runsStarted,
      getRunsStarted() {
        return this.runsStarted;
      },
      getActiveEffects: () => null,
      incrementRunsStarted() {
        this.runsStarted += 1;
      },
    };
  }

  it('a page reload shows the same offer and the same gift (the seed is kept on the device)', () => {
    const m = meta(1);
    const now = vi.spyOn(Date, 'now').mockReturnValue(6);
    const first = openShrine(registry({ activeSlot: 1, meta: m }));
    expect(JSON.parse(store[KEY])).toEqual({ seed: 6, runsStarted: 1 });
    // The reload: a new registry (a new session), a new clock.
    now.mockReturnValue(999_999);
    const reloaded = openShrine(registry({ activeSlot: 1, meta: m }));
    expect(reloaded.runManager.runSeed).toBe(first.runManager.runSeed);
    expect(offerOf(reloaded)).toEqual(offerOf(first));
    expect(reloaded.gift?.id ?? null).toBe(first.gift?.id ?? null);
    expect(first.gift).not.toBeNull();
  });

  it("the run's start clears the slot's stored seed, and the next run draws afresh", async () => {
    const m = meta(1);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const scene = openShrine(registry({ activeSlot: 1, meta: m }));
    expect(store[KEY]).toBeDefined();
    await beginRun(scene);
    expect(store[KEY]).toBeUndefined();
    expect(m.runsStarted).toBe(2);
    now.mockReturnValue(2000);
    const next = openShrine(registry({ activeSlot: 1, meta: m }));
    expect(next.runManager.runSeed).toBe(2000);
  });

  it('a seed kept before a run began since is stale: the new run still draws afresh', () => {
    // The clear at the run's start never reached the device (a crash, a refused write).
    const m = meta(3);
    store[KEY] = JSON.stringify({ seed: 1000, runsStarted: 2 });
    vi.spyOn(Date, 'now').mockReturnValue(4000);
    const scene = openShrine(registry({ activeSlot: 1, meta: m }));
    expect(scene.runManager.runSeed).toBe(4000);
    expect(JSON.parse(store[KEY])).toEqual({ seed: 4000, runsStarted: 3 });
  });

  it("deleting the slot clears its stored seed, and no other slot's", () => {
    store[KEY] = JSON.stringify({ seed: 1000, runsStarted: 0 });
    store.emblem_rogue_slot_2_pendingSeed = JSON.stringify({ seed: 2000, runsStarted: 0 });
    deleteSlot(1);
    expect(store[KEY]).toBeUndefined();
    expect(store.emblem_rogue_slot_2_pendingSeed).toBeDefined();
  });

  it('when storage refuses, the registry keeps the offer for the session', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const saved = globalThis.localStorage;
    globalThis.localStorage = throwing;
    try {
      const reg = registry({ activeSlot: 1, meta: meta(1) });
      const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
      const first = openShrine(reg);
      now.mockReturnValue(2000);
      const again = openShrine(reg);
      expect(again.runManager.runSeed).toBe(first.runManager.runSeed);
      expect(offerOf(again)).toEqual(offerOf(first));
    } finally {
      globalThis.localStorage = saved;
    }
  });

  it('the ?runSeed= pin is a dev route only', () => {
    expect(devRunSeedParam('?runSeed=6', { DEV: true })).toBe(6);
    expect(devRunSeedParam('?runSeed=6', { DEV: false, VITE_DEV_ROUTES: 'true' })).toBe(6);
    expect(devRunSeedParam('?runSeed=6', { DEV: false })).toBeNull();
    expect(devRunSeedParam('?runSeed=6', {})).toBeNull();
    expect(devRunSeedParam('?runSeed=x', { DEV: true })).toBeNull();
    expect(devRunSeedParam('', { DEV: true })).toBeNull();
  });
});
