import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transitionToSceneMock,
  startFirstRunFastPathMock,
  getNextAvailableSlotMock,
  setActiveSlotMock,
  getMetaKeyMock,
  ensureAudioUnlockedMock,
  metaInstances,
} = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(),
  startFirstRunFastPathMock: vi.fn(),
  getNextAvailableSlotMock: vi.fn(),
  setActiveSlotMock: vi.fn(),
  getMetaKeyMock: vi.fn((slot) => `slot_${slot}_meta`),
  ensureAudioUnlockedMock: vi.fn(async () => {}),
  metaInstances: [],
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  TRANSITION_REASONS: {
    NEW_GAME: 'new_game',
    BEGIN_RUN: 'begin_run',
  },
  transitionToScene: transitionToSceneMock,
}));

// The fast-path helper is unit-tested separately (firstRunFastPath.test.js);
// here we only assert TitleScene wires into it correctly.
vi.mock('../src/utils/firstRunFastPath.js', () => ({
  startFirstRunFastPath: startFirstRunFastPathMock,
}));

vi.mock('../src/engine/SlotManager.js', () => ({
  getSlotCount: vi.fn(() => 0),
  getNextAvailableSlot: getNextAvailableSlotMock,
  setActiveSlot: setActiveSlotMock,
  getMetaKey: getMetaKeyMock,
  clearAllSlotData: vi.fn(),
}));

vi.mock('../src/utils/audioUnlock.js', () => ({
  ensureAudioUnlocked: ensureAudioUnlockedMock,
}));

vi.mock('../src/cloud/CloudSync.js', () => ({
  pushMeta: vi.fn(),
}));

vi.mock('../src/cloud/supabaseClient.js', () => ({
  signOut: vi.fn(),
}));

vi.mock('../src/engine/HintManager.js', () => ({
  HintManager: class {
    constructor(slot) {
      this.slot = slot;
    }
  },
}));

vi.mock('../src/engine/MetaProgressionManager.js', () => ({
  MetaProgressionManager: class {
    constructor(upgradesData, storageKey) {
      this.upgradesData = upgradesData;
      this.storageKey = storageKey;
      this.onSave = null;
      this._save = vi.fn();
      metaInstances.push(this);
    }
  },
}));

import { TitleScene } from '../src/scenes/TitleScene.js';

function makeRegistry(seed = {}) {
  const store = new Map(Object.entries(seed));
  const api = {
    get: vi.fn((key) => store.get(key)),
    set: vi.fn((key, value) => {
      store.set(key, value);
    }),
    remove: vi.fn((key) => {
      store.delete(key);
    }),
  };
  return { store, api };
}

function makeScene(registrySeed = {}) {
  const scene = new TitleScene();
  const audio = {
    releaseMusic: vi.fn(),
    playMusic: vi.fn(),
  };
  const { store, api } = makeRegistry({ ...registrySeed, audio });
  scene.registry = api;
  scene.gameData = { metaUpgrades: [] };
  scene.input = { enabled: true };
  scene.showMessage = vi.fn();
  scene.isTransitioning = false;
  return { scene, audio, store };
}

describe('TitleScene NEW GAME → first-run fast path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startFirstRunFastPathMock.mockResolvedValue(true);
    getNextAvailableSlotMock.mockReturnValue(1);
    metaInstances.length = 0;
  });

  it('returns false and shows message when no slot is available', async () => {
    getNextAvailableSlotMock.mockReturnValue(null);
    const { scene } = makeScene();

    const ok = await TitleScene.prototype.handleNewGame.call(scene);

    expect(ok).toBe(false);
    expect(scene.showMessage).toHaveBeenCalledWith(
      'All 3 save slots are full.\nDelete a slot from Continue to free space.',
    );
    expect(startFirstRunFastPathMock).not.toHaveBeenCalled();
    expect(setActiveSlotMock).not.toHaveBeenCalled();
    expect(metaInstances).toHaveLength(0);
  });

  it('starts the fast path with the next slot and persists on success', async () => {
    getNextAvailableSlotMock.mockReturnValue(3);
    const { scene, store } = makeScene();

    const ok = await TitleScene.prototype.handleNewGame.call(scene);

    expect(ok).toBe(true);
    expect(startFirstRunFastPathMock).toHaveBeenCalledTimes(1);
    expect(startFirstRunFastPathMock).toHaveBeenCalledWith(scene, {
      gameData: scene.gameData,
      slot: 3,
    });
    expect(setActiveSlotMock).toHaveBeenCalledTimes(1);
    expect(setActiveSlotMock).toHaveBeenCalledWith(3);
    expect(store.get('meta')).toBe(metaInstances[0]);
    expect(store.get('activeSlot')).toBe(3);
    // Hints are staged the same way SlotPicker does.
    expect(store.get('hints')?.slot).toBe(3);
  });

  it('does not persist slot/meta/hints state when the fast path is rejected', async () => {
    startFirstRunFastPathMock.mockResolvedValue(false);
    getNextAvailableSlotMock.mockReturnValue(2);
    const previousMeta = { tag: 'existing-meta' };
    const previousHints = { tag: 'existing-hints' };
    const { scene, store } = makeScene({
      meta: previousMeta,
      hints: previousHints,
      activeSlot: 1,
    });

    const ok = await TitleScene.prototype.handleNewGame.call(scene);

    expect(ok).toBe(false);
    expect(setActiveSlotMock).not.toHaveBeenCalled();
    expect(store.get('meta')).toBe(previousMeta);
    expect(store.get('hints')).toBe(previousHints);
    expect(store.get('activeSlot')).toBe(1);
  });

  it('rolls back staged state when the fast path throws', async () => {
    startFirstRunFastPathMock.mockRejectedValueOnce(new Error('transition exploded'));
    getNextAvailableSlotMock.mockReturnValue(3);
    const previousMeta = { tag: 'existing-meta' };
    const { scene, store } = makeScene({ meta: previousMeta, activeSlot: 2 });

    await expect(TitleScene.prototype.handleNewGame.call(scene)).rejects.toThrow(
      'transition exploded',
    );

    expect(setActiveSlotMock).not.toHaveBeenCalled();
    expect(store.get('meta')).toBe(previousMeta);
    expect(store.get('activeSlot')).toBe(2);
  });

  it('restores menu interactivity when NEW GAME transition is rejected', async () => {
    startFirstRunFastPathMock.mockResolvedValue(false);
    const { scene, audio } = makeScene();

    await TitleScene.prototype.runMenuTransition.call(scene, () =>
      TitleScene.prototype.handleNewGame.call(scene),
    );

    expect(ensureAudioUnlockedMock).toHaveBeenCalledTimes(1);
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
    expect(audio.releaseMusic).toHaveBeenCalledTimes(1);
    expect(audio.playMusic).toHaveBeenCalledTimes(1);
    expect(setActiveSlotMock).not.toHaveBeenCalled();
  });

  it('restores menu interactivity and shows message when NEW GAME transition throws', async () => {
    startFirstRunFastPathMock.mockRejectedValueOnce(new Error('router failed'));
    const { scene, audio } = makeScene();

    await TitleScene.prototype.runMenuTransition.call(scene, () =>
      TitleScene.prototype.handleNewGame.call(scene),
    );

    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
    expect(scene.showMessage).toHaveBeenCalledWith('Transition failed. Please click again.');
    expect(audio.playMusic).toHaveBeenCalledTimes(1);
    expect(setActiveSlotMock).not.toHaveBeenCalled();
  });
});
