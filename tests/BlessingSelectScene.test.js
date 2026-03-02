import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

// Mock SceneRouter — return controllable promises
let transitionPromiseResolve;
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => {
    store[key] = String(value);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: vi.fn(
    () =>
      new Promise((resolve) => {
        transitionPromiseResolve = resolve;
      }),
  ),
  TRANSITION_REASONS: { BEGIN_RUN: 'begin_run', BACK: 'back' },
}));

vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return {
    RunManager: class {},
    clearSavedRun: vi.fn((deleteCloudRun, slotNumber) =>
      actual.clearSavedRun(deleteCloudRun, slotNumber),
    ),
  };
});

vi.mock('../src/cloud/CloudSync.js', () => ({
  deleteRunSave: vi.fn(),
}));

vi.mock('../src/utils/blessingAnalytics.js', () => ({
  recordBlessingSelection: vi.fn(),
}));

import { BlessingSelectScene } from '../src/scenes/BlessingSelectScene.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { recordBlessingSelection } from '../src/utils/blessingAnalytics.js';
import { clearSavedRun } from '../src/engine/RunManager.js';
import { deleteRunSave } from '../src/cloud/CloudSync.js';

function makeScene() {
  const scene = Object.create(BlessingSelectScene.prototype);
  scene.isTransitioning = false;
  scene._blessingCommitted = false;
  scene.options = [{ id: 'blessing_1', name: 'Test', tier: 1 }];
  scene.selectedIndex = 0;
  scene.runManager = {
    chooseBlessing: vi.fn(() => true),
    blessingSelectionTelemetry: { offeredIds: ['blessing_1'] },
  };
  scene.registry = { get: vi.fn(() => null) };
  scene.children = { removeAll: vi.fn() };
  return scene;
}

describe('BlessingSelectScene No Meta back-navigation', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    vi.clearAllMocks();
    transitionPromiseResolve = null;
  });

  it('init stores noMetaUpgrades from data', () => {
    const scene = Object.create(BlessingSelectScene.prototype);
    scene.init({ gameData: {}, noMetaUpgrades: true });
    expect(scene.noMetaUpgrades).toBe(true);
  });

  it('init defaults noMetaUpgrades to false when absent', () => {
    const scene = Object.create(BlessingSelectScene.prototype);
    scene.init({ gameData: {} });
    expect(scene.noMetaUpgrades).toBe(false);
  });

  it('init rejects non-boolean noMetaUpgrades values', () => {
    for (const bad of ['true', 'false', 1, 0, {}, []]) {
      const scene = Object.create(BlessingSelectScene.prototype);
      scene.init({ gameData: {}, noMetaUpgrades: bad });
      expect(scene.noMetaUpgrades).toBe(false);
    }
  });

  it('_back passes noMetaUpgrades in transition data', () => {
    const scene = makeScene();
    scene.noMetaUpgrades = true;
    scene.gameData = {};
    scene._back();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    const callArgs = transitionToScene.mock.calls[0];
    expect(callArgs[2]).toEqual({ gameData: {}, noMetaUpgrades: true });
  });

  it('_back passes noMetaUpgrades=false when not set', () => {
    const scene = makeScene();
    scene.noMetaUpgrades = false;
    scene.gameData = {};
    scene._back();
    const callArgs = transitionToScene.mock.calls[0];
    expect(callArgs[2]).toEqual({ gameData: {}, noMetaUpgrades: false });
  });
});

describe('BlessingSelectScene transition guards', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    vi.clearAllMocks();
    transitionPromiseResolve = null;
  });

  it('double-confirm calls chooseBlessing exactly once', () => {
    const scene = makeScene();
    scene._confirm();
    scene._confirm();
    expect(scene.runManager.chooseBlessing).toHaveBeenCalledTimes(1);
    expect(transitionToScene).toHaveBeenCalledTimes(1);
  });

  it('_back then failed transition leaves runManager accessible for _confirm', async () => {
    const scene = makeScene();
    scene._back();
    expect(scene.isTransitioning).toBe(true);
    expect(scene.runManager).not.toBeNull();

    // Simulate transition failure
    transitionPromiseResolve(false);
    await Promise.resolve(); // flush microtask

    expect(scene.isTransitioning).toBe(false);
    // runManager still available — _confirm should work
    scene._confirm();
    expect(scene.runManager.chooseBlessing).toHaveBeenCalledTimes(1);
  });

  it('confirm -> transition fail -> retry reattempts commit and records analytics only on success', async () => {
    const scene = makeScene();
    scene._confirm();
    expect(scene.runManager.chooseBlessing).toHaveBeenCalledTimes(1);
    expect(recordBlessingSelection).toHaveBeenCalledTimes(0);

    // Simulate transition failure — unlocks isTransitioning
    transitionPromiseResolve(false);
    await Promise.resolve();
    expect(scene.isTransitioning).toBe(false);

    // Retry confirm — blessing commit is reattempted after rollback
    scene._confirm();
    expect(scene.runManager.chooseBlessing).toHaveBeenCalledTimes(2);
    expect(recordBlessingSelection).toHaveBeenCalledTimes(0);
    expect(transitionToScene).toHaveBeenCalledTimes(2); // transition retried

    // Analytics is recorded only on successful transition.
    transitionPromiseResolve(true);
    await Promise.resolve();
    expect(recordBlessingSelection).toHaveBeenCalledTimes(1);
  });

  it('confirm unlocks after failed transition rollback', async () => {
    const scene = makeScene();
    scene.options = [
      { id: 'blessing_1', name: 'A', tier: 1 },
      { id: 'blessing_2', name: 'B', tier: 1 },
    ];
    scene.selectedIndex = 0;
    scene._confirm();

    // Simulate transition failure
    transitionPromiseResolve(false);
    await Promise.resolve();
    expect(scene.isTransitioning).toBe(false);
    expect(scene._blessingCommitted).toBe(false);

    scene._confirm();
    expect(scene.runManager.chooseBlessing).toHaveBeenCalledTimes(2);
  });

  it('failed transition does not clear saved run', async () => {
    const scene = makeScene();
    scene.registry.get = vi.fn((key) => {
      if (key === 'cloud') return { userId: 'user-1' };
      if (key === 'activeSlot') return 2;
      return null;
    });

    scene._confirm();
    expect(clearSavedRun).not.toHaveBeenCalled();
    expect(deleteRunSave).not.toHaveBeenCalled();

    transitionPromiseResolve(false);
    await Promise.resolve();

    expect(clearSavedRun).not.toHaveBeenCalled();
    expect(deleteRunSave).not.toHaveBeenCalled();
  });

  it('successful transition clears saved run exactly once', async () => {
    const scene = makeScene();
    scene.registry.get = vi.fn((key) => {
      if (key === 'cloud') return { userId: 'user-1' };
      if (key === 'activeSlot') return 2;
      return null;
    });

    scene._confirm();
    expect(clearSavedRun).not.toHaveBeenCalled();
    expect(deleteRunSave).not.toHaveBeenCalled();

    transitionPromiseResolve(true);
    await Promise.resolve();

    expect(clearSavedRun).toHaveBeenCalledTimes(1);
    expect(clearSavedRun).toHaveBeenCalledWith(expect.any(Function), 2);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
    expect(deleteRunSave).toHaveBeenCalledWith('user-1', 2);
  });

  it('successful transition uses resolved clear slot when registry activeSlot is missing', async () => {
    const scene = makeScene();
    localStorage.setItem('emblem_rogue_active_slot', '2');
    scene.registry.get = vi.fn((key) => {
      if (key === 'cloud') return { userId: 'user-1' };
      if (key === 'activeSlot') return undefined;
      return null;
    });

    scene._confirm();
    transitionPromiseResolve(true);
    await Promise.resolve();

    expect(clearSavedRun).toHaveBeenCalledTimes(1);
    expect(clearSavedRun).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
    expect(deleteRunSave).toHaveBeenCalledWith('user-1', 2);
  });

  it('_confirm blocks subsequent _back', () => {
    const scene = makeScene();
    scene._confirm();
    expect(scene.isTransitioning).toBe(true);

    // Reset mock to verify _back doesn't call transitionToScene again
    transitionToScene.mockClear();
    scene._back();
    expect(transitionToScene).not.toHaveBeenCalled();
  });
});
