import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

// Mock SceneRouter — return controllable promises
let transitionPromiseResolve;
vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: vi.fn(
    () =>
      new Promise((resolve) => {
        transitionPromiseResolve = resolve;
      }),
  ),
  TRANSITION_REASONS: { BEGIN_RUN: 'begin_run', BACK: 'back' },
}));

vi.mock('../src/cloud/CloudSync.js', () => ({
  deleteRunSave: vi.fn(),
}));

vi.mock('../src/utils/blessingAnalytics.js', () => ({
  recordBlessingSelection: vi.fn(),
}));

import { BlessingSelectScene } from '../src/scenes/BlessingSelectScene.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { recordBlessingSelection } from '../src/utils/blessingAnalytics.js';

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

  it('confirm -> transition fail -> retry skips blessing commit and analytics', async () => {
    const scene = makeScene();
    scene._confirm();
    expect(scene.runManager.chooseBlessing).toHaveBeenCalledTimes(1);
    expect(recordBlessingSelection).toHaveBeenCalledTimes(1);

    // Simulate transition failure — unlocks isTransitioning
    transitionPromiseResolve(false);
    await Promise.resolve();
    expect(scene.isTransitioning).toBe(false);

    // Retry confirm — blessing commit and analytics must not re-fire
    scene._confirm();
    expect(scene.runManager.chooseBlessing).toHaveBeenCalledTimes(1); // NOT called again
    expect(recordBlessingSelection).toHaveBeenCalledTimes(1); // NOT called again
    expect(transitionToScene).toHaveBeenCalledTimes(2); // transition retried
  });

  it('selection is locked after blessing commit (keyboard and pointer)', async () => {
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

    // Keyboard navigation — should be blocked
    scene._navigate(1);
    expect(scene.selectedIndex).toBe(0);

    // Pointer selection via _select — should also be blocked
    scene._select(1);
    expect(scene.selectedIndex).toBe(0);

    // Skip via _select — should also be blocked
    scene._select(scene.options.length);
    expect(scene.selectedIndex).toBe(0);
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
