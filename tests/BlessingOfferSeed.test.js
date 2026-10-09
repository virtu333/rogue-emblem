// The shrine's offer cannot be re-rolled by backing out (docs/specs/blessings-v3.md §3.2): the
// seed of a run offered but not begun is kept in the registry for its slot, so returning shows
// the same cards at the same prices; once the run begins the next one gets a fresh seed.
//
// Ways this can fail, a test each:
//   1. backing out and returning draws a new offer;
//   2. another slot inherits the pending seed;
//   3. a begun run leaves the seed behind, so every later run repeats it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { BlessingSelectScene, PENDING_RUN_SEED_KEY } from '../src/scenes/BlessingSelectScene.js';
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
const offerOf = (scene) => scene.options.map((o) => [o.id, o.rolledCost?.label || null]);

describe('the shrine keeps its offer until the run begins', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('backing out and returning shows the same cards at the same prices', () => {
    const reg = registry({ activeSlot: 1 });
    const first = openShrine(reg);
    const again = openShrine(reg);
    expect(again.runManager.runSeed).toBe(first.runManager.runSeed);
    expect(offerOf(again)).toEqual(offerOf(first));
  });

  it('another slot does not inherit it', () => {
    const reg = registry({ activeSlot: 1 });
    const first = openShrine(reg);
    reg.set('activeSlot', 2);
    reg.set(PENDING_RUN_SEED_KEY, { ...reg.get(PENDING_RUN_SEED_KEY) });
    const other = Object.create(BlessingSelectScene.prototype);
    other.registry = reg;
    other.init({ gameData, difficultyId: 'dusk' });
    expect(other._blessingRunSeed).toBeNull();
    expect(first._blessingRunSeed).not.toBeNull();
  });

  it('beginning the run clears it, so the next run is drawn afresh', async () => {
    const reg = registry({ activeSlot: 1 });
    const scene = openShrine(reg);
    scene.isTransitioning = false;
    scene._blessingCommitted = false;
    scene.selectedIndex = scene.options.length; // no blessing
    scene._confirm();
    await Promise.resolve();
    await Promise.resolve();
    expect(reg.has(PENDING_RUN_SEED_KEY)).toBe(false);
    const next = Object.create(BlessingSelectScene.prototype);
    next.registry = reg;
    next.init({ gameData, difficultyId: 'dusk' });
    expect(next._blessingRunSeed).toBeNull();
  });
});
