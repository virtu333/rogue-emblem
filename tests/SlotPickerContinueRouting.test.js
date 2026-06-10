// Continue routing: a loaded run whose interrupted-battle settlement ended in
// defeat (Edric fell, no Vision charge) must route to the RunComplete
// game-over flow — never resume on the NodeMap.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

const { transitionToSceneMock, loadRunMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
  loadRunMock: vi.fn(),
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: transitionToSceneMock };
});
vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return { ...actual, loadRun: loadRunMock };
});
vi.mock('../src/utils/audioUnlock.js', () => ({
  ensureAudioUnlocked: vi.fn(async () => {}),
}));

import { SlotPickerScene } from '../src/scenes/SlotPickerScene.js';
import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';

// Mock localStorage (MetaProgressionManager / HintManager / setActiveSlot)
const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = val;
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  writable: true,
});

function makeScene() {
  const map = new Map();
  const scene = Object.create(SlotPickerScene.prototype);
  scene.registry = {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
    remove: (key) => map.delete(key),
  };
  scene.gameData = { metaUpgrades: [] };
  scene.input = null;
  scene.isTransitioning = false;
  return scene;
}

describe('SlotPickerScene continue routing', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
    transitionToSceneMock.mockResolvedValue(true);
  });

  it('routes a settled defeat (Edric fell on reload) to RunComplete', async () => {
    const scene = makeScene();
    const rm = { status: 'defeat' };
    loadRunMock.mockReturnValue(rm);

    await scene.selectSlot(2, { hasActiveRun: true });

    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'RunComplete',
      expect.objectContaining({ runManager: rm, result: 'defeat' }),
      { reason: TRANSITION_REASONS.CONTINUE },
    );
  });

  it('resumes an active run on the NodeMap', async () => {
    const scene = makeScene();
    const rm = { status: 'active' };
    loadRunMock.mockReturnValue(rm);

    await scene.selectSlot(1, { hasActiveRun: true });

    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'NodeMap',
      expect.objectContaining({ runManager: rm }),
      { reason: TRANSITION_REASONS.CONTINUE },
    );
  });

  it('falls back to HomeBase when the run data is corrupt', async () => {
    const scene = makeScene();
    loadRunMock.mockReturnValue(null);

    await scene.selectSlot(1, { hasActiveRun: true });

    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'HomeBase',
      expect.objectContaining({ corruptRunDetected: true }),
      { reason: TRANSITION_REASONS.CONTINUE },
    );
  });
});
