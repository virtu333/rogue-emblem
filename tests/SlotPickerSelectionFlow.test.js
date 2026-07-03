import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

const mocked = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(),
  startFirstRunFastPathMock: vi.fn(),
  setActiveSlotMock: vi.fn(),
  getMetaKeyMock: vi.fn((slot) => `slot_${slot}_meta`),
  loadRunMock: vi.fn(() => null),
  ensureAudioUnlockedMock: vi.fn(async () => {}),
  metaInstances: [],
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: mocked.transitionToSceneMock,
  TRANSITION_REASONS: { CONTINUE: 'continue', BEGIN_RUN: 'begin_run' },
}));

// Keep the real isFirstRunSlot detection; stub only the run-committing helper.
vi.mock('../src/utils/firstRunFastPath.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, startFirstRunFastPath: mocked.startFirstRunFastPathMock };
});

vi.mock('../src/engine/SlotManager.js', () => ({
  MAX_SLOTS: 3,
  getSlotSummary: vi.fn(() => null),
  deleteSlot: vi.fn(),
  setActiveSlot: mocked.setActiveSlotMock,
  getMetaKey: mocked.getMetaKeyMock,
}));

vi.mock('../src/engine/MetaProgressionManager.js', () => ({
  MetaProgressionManager: class {
    constructor(_upgrades, storageKey) {
      this.storageKey = storageKey;
      this.onSave = null;
      mocked.metaInstances.push(this);
    }
  },
}));

vi.mock('../src/engine/HintManager.js', () => ({
  HintManager: class {
    constructor(slot) {
      this.slot = slot;
    }
  },
}));

vi.mock('../src/engine/RunManager.js', () => ({
  loadRun: mocked.loadRunMock,
}));

vi.mock('../src/cloud/CloudSync.js', () => ({
  pushMeta: vi.fn(),
  deleteSlotCloud: vi.fn(),
}));

vi.mock('../src/utils/audioUnlock.js', () => ({
  ensureAudioUnlocked: mocked.ensureAudioUnlockedMock,
}));

import { SlotPickerScene } from '../src/scenes/SlotPickerScene.js';
import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';

function makeRegistry(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    registry: {
      get: vi.fn((k) => store.get(k)),
      set: vi.fn((k, v) => store.set(k, v)),
      remove: vi.fn((k) => store.delete(k)),
    },
  };
}

function makeScene(initialRegistry = {}) {
  const { store, registry } = makeRegistry(initialRegistry);
  const scene = Object.create(SlotPickerScene.prototype);
  scene.registry = registry;
  scene.gameData = { metaUpgrades: [] };
  scene.input = { enabled: true };
  scene.isTransitioning = false;
  return { scene, store };
}

describe('SlotPickerScene selectSlot transition safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.metaInstances.length = 0;
    mocked.transitionToSceneMock.mockResolvedValue(true);
    mocked.startFirstRunFastPathMock.mockResolvedValue(true);
    mocked.loadRunMock.mockReturnValue(null);
  });

  it('rolls back staged slot state when transition returns false', async () => {
    mocked.transitionToSceneMock.mockResolvedValue(false);
    const previousMeta = { tag: 'meta-old' };
    const previousHints = { tag: 'hints-old' };
    const { scene, store } = makeScene({
      meta: previousMeta,
      hints: previousHints,
      activeSlot: 1,
      audio: { stopMusic: vi.fn() },
    });

    // A used slot (a run has been started) → normal HomeBase continue path.
    await SlotPickerScene.prototype.selectSlot.call(scene, 2, {
      hasActiveRun: false,
      runCorrupt: false,
      runsStarted: 1,
      runsCompleted: 0,
    });

    expect(mocked.transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'HomeBase',
      { gameData: scene.gameData, corruptRunDetected: false },
      { reason: TRANSITION_REASONS.CONTINUE },
    );
    expect(mocked.setActiveSlotMock).not.toHaveBeenCalled();
    expect(store.get('meta')).toBe(previousMeta);
    expect(store.get('hints')).toBe(previousHints);
    expect(store.get('activeSlot')).toBe(1);
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });

  it('persists active slot only after successful transition', async () => {
    const { scene, store } = makeScene({
      activeSlot: 1,
      audio: { stopMusic: vi.fn() },
    });

    await SlotPickerScene.prototype.selectSlot.call(scene, 3, {
      hasActiveRun: false,
      runCorrupt: true,
    });

    expect(mocked.setActiveSlotMock).toHaveBeenCalledTimes(1);
    expect(mocked.setActiveSlotMock).toHaveBeenCalledWith(3);
    expect(store.get('activeSlot')).toBe(3);
    expect(store.get('meta')).toBe(mocked.metaInstances[0]);
    expect(store.get('hints')?.slot).toBe(3);
    expect(mocked.transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'HomeBase',
      { gameData: scene.gameData, corruptRunDetected: true },
      { reason: TRANSITION_REASONS.CONTINUE },
    );
  });

  it('rolls back staged slot state when transition throws', async () => {
    mocked.transitionToSceneMock.mockRejectedValueOnce(new Error('router failed'));
    const previousMeta = { tag: 'meta-old' };
    const previousHints = { tag: 'hints-old' };
    const { scene, store } = makeScene({
      meta: previousMeta,
      hints: previousHints,
      activeSlot: 2,
      audio: { stopMusic: vi.fn() },
    });

    await SlotPickerScene.prototype.selectSlot.call(scene, 3, {
      hasActiveRun: false,
      runCorrupt: false,
      runsStarted: 1,
      runsCompleted: 0,
    });

    expect(mocked.setActiveSlotMock).not.toHaveBeenCalled();
    expect(store.get('meta')).toBe(previousMeta);
    expect(store.get('hints')).toBe(previousHints);
    expect(store.get('activeSlot')).toBe(2);
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });

  it('routes a brand-new slot (no runs yet) through the first-run fast path', async () => {
    const { scene, store } = makeScene({
      activeSlot: 1,
      audio: { stopMusic: vi.fn() },
    });

    await SlotPickerScene.prototype.selectSlot.call(scene, 2, {
      hasActiveRun: false,
      runCorrupt: false,
      runsStarted: 0,
      runsCompleted: 0,
    });

    expect(mocked.startFirstRunFastPathMock).toHaveBeenCalledTimes(1);
    expect(mocked.startFirstRunFastPathMock).toHaveBeenCalledWith(scene, {
      gameData: scene.gameData,
      slot: 2,
    });
    // Fast path took the branch instead of HomeBase.
    expect(mocked.transitionToSceneMock).not.toHaveBeenCalled();
    expect(mocked.setActiveSlotMock).toHaveBeenCalledWith(2);
    expect(store.get('activeSlot')).toBe(2);
  });

  it('does not fast-path a brand-new slot when the fast path is rejected', async () => {
    mocked.startFirstRunFastPathMock.mockResolvedValue(false);
    const previousMeta = { tag: 'meta-old' };
    const { scene, store } = makeScene({
      meta: previousMeta,
      activeSlot: 1,
      audio: { stopMusic: vi.fn() },
    });

    await SlotPickerScene.prototype.selectSlot.call(scene, 2, {
      hasActiveRun: false,
      runCorrupt: false,
      runsStarted: 0,
      runsCompleted: 0,
    });

    expect(mocked.startFirstRunFastPathMock).toHaveBeenCalledTimes(1);
    expect(mocked.setActiveSlotMock).not.toHaveBeenCalled();
    expect(store.get('meta')).toBe(previousMeta);
    expect(store.get('activeSlot')).toBe(1);
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });
});
