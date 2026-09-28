import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transitionToSceneMock,
  startFirstRunFastPathMock,
  getNextAvailableSlotMock,
  setActiveSlotMock,
  getMetaKeyMock,
  ensureAudioUnlockedMock,
  metaInstances,
  getSlotCountMock,
  getSlotSummaryMock,
  hasDOMHostMock,
} = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(),
  startFirstRunFastPathMock: vi.fn(),
  getNextAvailableSlotMock: vi.fn(),
  setActiveSlotMock: vi.fn(),
  getMetaKeyMock: vi.fn((slot) => `slot_${slot}_meta`),
  ensureAudioUnlockedMock: vi.fn(async () => {}),
  metaInstances: [],
  getSlotCountMock: vi.fn(() => 0),
  getSlotSummaryMock: vi.fn(() => null),
  hasDOMHostMock: vi.fn(() => false),
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
    CONTINUE: 'continue',
  },
  transitionToScene: transitionToSceneMock,
}));

// The fast-path helper is unit-tested separately (firstRunFastPath.test.js);
// here we only assert TitleScene wires into it correctly.
vi.mock('../src/utils/firstRunFastPath.js', () => ({
  startFirstRunFastPath: startFirstRunFastPathMock,
}));

vi.mock('../src/engine/SlotManager.js', () => ({
  MAX_SLOTS: 3,
  getSlotCount: getSlotCountMock,
  getSlotSummary: getSlotSummaryMock,
  getNextAvailableSlot: getNextAvailableSlotMock,
  setActiveSlot: setActiveSlotMock,
  getMetaKey: getMetaKeyMock,
  clearAllSlotData: vi.fn(),
}));

// The New Game dialog as plain nodes (no DOM in unit tests).
vi.mock('../src/utils/domUI.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDOMHost: hasDOMHostMock,
}));
vi.mock('../src/ui/MenuSurface.js', async (importOriginal) => ({
  ...(await importOriginal()),
  element: (tag, text) => ({ tag, text }),
  button: (label, onClick, className = '') => ({ tag: 'button', label, onClick, className }),
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
    getSlotCountMock.mockReturnValue(0);
    getSlotSummaryMock.mockReturnValue(null);
    hasDOMHostMock.mockReturnValue(false);
    metaInstances.length = 0;
  });

  it('returns false and shows message when no slot is available', async () => {
    getNextAvailableSlotMock.mockReturnValue(null);
    const { scene } = makeScene();

    const ok = await TitleScene.prototype.handleNewGame.call(scene);

    expect(ok).toBe(false);
    expect(scene.showMessage).toHaveBeenCalledWith(
      'All 3 save slots are full.\nDelete a slot from Save Slots to free space.',
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

describe('TitleScene NEW GAME: the slot that keeps its upgrades', () => {
  // Slot summaries as SlotManager.getSlotSummary reports them.
  const withRun = (slot) => ({ slot, hasActiveRun: true, upgradesOwned: 4, metaSavedAt: 900 });
  const upgraded = (slot, metaSavedAt = 500) => ({
    slot,
    hasActiveRun: false,
    runCorrupt: false,
    upgradesOwned: 3,
    runsCompleted: 2,
    metaSavedAt,
  });
  function openDialog(slots, nextSlot) {
    hasDOMHostMock.mockReturnValue(true);
    getNextAvailableSlotMock.mockReturnValue(nextSlot);
    getSlotCountMock.mockReturnValue(slots.filter(Boolean).length);
    getSlotSummaryMock.mockImplementation((slot) => slots[slot - 1] || null);
    const { scene } = makeScene();
    const menu = {
      body: { children: [], append: (...nodes) => menu.body.children.push(...nodes) },
    };
    menu.focusContent = vi.fn();
    scene._openTitleMenu = vi.fn(() => menu);
    scene._closeTitleMenu = vi.fn();
    return { scene, menu };
  }
  const buttons = (menu) =>
    menu.body.children.filter((n) => n.tag === 'button').map((n) => [n.label, n.className]);
  const text = (menu) => menu.body.children.find((n) => n.tag === 'p').text;

  beforeEach(() => {
    vi.clearAllMocks();
    transitionToSceneMock.mockResolvedValue(true);
    metaInstances.length = 0;
  });

  it('offers the upgraded slot first, then the empty slot, then the saves', async () => {
    const { scene, menu } = openDialog([withRun(1), upgraded(2), null], 3);
    expect(await TitleScene.prototype.handleNewGame.call(scene)).toBe(false);
    expect(scene._openTitleMenu).toHaveBeenCalledWith('Start another run?');
    expect(buttons(menu)).toEqual([
      ['New run in Slot 2 · keeps upgrades', 're-btn re-btn--primary'],
      ['Start new run in Slot 3', ''],
      ['Keep playing my saves', ''],
    ]);
    expect(text(menu)).toBe(
      'Slot 2 has no run in progress. A new run there keeps its upgrades. Empty Slot 3 starts without them. Your other saves stay as they are.',
    );
    expect(menu.focusContent).toHaveBeenCalled();
    expect(startFirstRunFastPathMock).not.toHaveBeenCalled();
  });

  it("the upgraded slot opens through Save Slots' own load (SlotPicker openSlot)", async () => {
    const { scene, menu } = openDialog([withRun(1), upgraded(2), null], 3);
    await TitleScene.prototype.handleNewGame.call(scene);
    menu.body.children.find((n) => n.label?.startsWith('New run in Slot 2')).onClick();
    await vi.waitFor(() => expect(transitionToSceneMock).toHaveBeenCalledTimes(1));
    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'SlotPicker',
      { gameData: scene.gameData, openSlot: 2 },
      { reason: 'continue', retryBlocked: true },
    );
    // Nothing is staged or started here: SlotPicker.selectSlot owns the load.
    expect(startFirstRunFastPathMock).not.toHaveBeenCalled();
    expect(setActiveSlotMock).not.toHaveBeenCalled();
    expect(metaInstances).toHaveLength(0);
  });

  it('several upgraded slots: the most recently saved is offered', async () => {
    const { scene, menu } = openDialog([upgraded(1, 100), upgraded(2, 700), upgraded(3, 300)], null); // prettier-ignore
    await TitleScene.prototype.handleNewGame.call(scene);
    expect(buttons(menu)[0][0]).toBe('New run in Slot 2 · keeps upgrades');
  });

  it('all slots full: the upgraded slot is offered instead of "slots are full"', async () => {
    const { scene, menu } = openDialog([withRun(1), withRun(2), upgraded(3)], null);
    expect(await TitleScene.prototype.handleNewGame.call(scene)).toBe(false);
    expect(scene.showMessage).not.toHaveBeenCalled();
    expect(buttons(menu)).toEqual([
      ['New run in Slot 3 · keeps upgrades', 're-btn re-btn--primary'],
      ['Keep playing my saves', ''],
    ]);
    expect(text(menu)).toBe(
      'Slot 3 has no run in progress. A new run there keeps its upgrades. Your other saves stay as they are.',
    );
  });

  it('a slot with a run in progress is never offered: the old choice stays', async () => {
    const { scene, menu } = openDialog([withRun(1), null, null], 2);
    await TitleScene.prototype.handleNewGame.call(scene);
    expect(buttons(menu)).toEqual([
      ['Keep playing my saves', 're-btn re-btn--primary'],
      ['Start new run in Slot 2', ''],
    ]);
    expect(text(menu)).toContain('A new run will use Slot 2.');
  });

  it('all slots full with runs in progress: still "slots are full"', async () => {
    const { scene } = openDialog([withRun(1), withRun(2), withRun(3)], null);
    expect(await TitleScene.prototype.handleNewGame.call(scene)).toBe(false);
    expect(scene._openTitleMenu).not.toHaveBeenCalled();
    expect(scene.showMessage).toHaveBeenCalledWith(
      'All 3 save slots are full.\nDelete a slot from Save Slots to free space.',
    );
  });
});
