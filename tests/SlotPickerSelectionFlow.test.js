import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

const mocked = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(),
  startFirstRunFastPathMock: vi.fn(),
  startPrologueRunMock: vi.fn(),
  skipPrologueToFirstRunMock: vi.fn(),
  setActiveSlotMock: vi.fn(),
  getMetaKeyMock: vi.fn((slot) => `slot_${slot}_meta`),
  loadRunMock: vi.fn(() => null),
  ensureAudioUnlockedMock: vi.fn(async () => {}),
  metaInstances: [],
  summary: vi.fn(() => null),
  showRecovery: vi.fn(),
  deleteSlot: vi.fn(),
  domHost: vi.fn(() => false),
  dialogActions: [],
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: mocked.transitionToSceneMock,
  TRANSITION_REASONS: { CONTINUE: 'continue', BEGIN_RUN: 'begin_run' },
}));

// Keep the real isFirstRunSlot detection; stub only the run-committing helper.
vi.mock('../src/utils/firstRunFastPath.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    startFirstRunFastPath: mocked.startFirstRunFastPathMock,
    startPrologueRun: mocked.startPrologueRunMock,
    skipPrologueToFirstRun: mocked.skipPrologueToFirstRunMock,
  };
});

vi.mock('../src/engine/SlotManager.js', async (importActual) => ({
  ...(await importActual()),
  MAX_SLOTS: 3,
  getSlotSummary: mocked.summary,
  deleteSlot: mocked.deleteSlot,
  setActiveSlot: mocked.setActiveSlotMock,
  getMetaKey: mocked.getMetaKeyMock,
}));

vi.mock('../src/ui/SlotRecoveryDialog.js', () => ({ showSlotRecovery: mocked.showRecovery }));
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: mocked.domHost }));
vi.mock('../src/ui/RunFlowMenus.js', async (importActual) => ({
  ...(await importActual()),
  slotDialog: (_scene, _title, _copy, actions) => {
    mocked.dialogActions = actions;
    return { destroyed: false, destroy: vi.fn() };
  },
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
    mocked.summary.mockReturnValue(null);
    mocked.domHost.mockReturnValue(false);
  });

  it.each([null, 'account-a'])(
    'offers a preserved cloud choice with missing progression for owner %s',
    async (owner) => {
      const values = new Map([
        [
          'emblem_rogue_slot_1_cloud_conflict',
          JSON.stringify({
            localRun: { gold: 10 },
            cloudRun: { gold: 20 },
            cloudMeta: { totalValor: 90 },
          }),
        ],
      ]);
      if (owner)
        values.set(
          'emblem_rogue_slot_1_recovery_owner',
          JSON.stringify({ version: 1, userId: owner }),
        );
      vi.stubGlobal('localStorage', { getItem: (key) => values.get(key) ?? null });
      mocked.domHost.mockReturnValue(true);
      mocked.summary.mockReturnValue({
        recoveryRequired: true,
        slotStatus: owner ? 'recovery-required' : 'damaged',
      });
      const { scene } = makeScene({ cloud: { userId: 'account-a' } });
      scene._showCloudChoice = vi.fn();
      await scene.selectSlot(1, { recoveryRequired: true });
      expect(scene._showCloudChoice).toHaveBeenCalledOnce();
      expect(mocked.showRecovery).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    },
  );

  it.each(['account-b', 'malformed'])(
    'refuses another or unknown recovery owner (%s)',
    async (owner) => {
      const values = new Map([
        [
          'emblem_rogue_slot_1_cloud_conflict',
          JSON.stringify({
            localRun: { gold: 10 },
            cloudRun: { gold: 20 },
            cloudMeta: { totalValor: 90 },
          }),
        ],
        [
          'emblem_rogue_slot_1_recovery_owner',
          owner === 'malformed' ? '{bad' : JSON.stringify({ version: 1, userId: owner }),
        ],
      ]);
      vi.stubGlobal('localStorage', { getItem: (key) => values.get(key) ?? null });
      mocked.domHost.mockReturnValue(true);
      mocked.summary.mockReturnValue({ recoveryRequired: true, slotStatus: 'recovery-required' });
      const { scene } = makeScene({ cloud: { userId: 'account-a' } });
      scene._showCloudChoice = vi.fn();
      const before = new Map(values);
      await scene.selectSlot(1, { recoveryRequired: true });
      expect(scene._showCloudChoice).not.toHaveBeenCalled();
      expect(mocked.showRecovery).toHaveBeenCalledWith(scene, 1);
      expect(values).toEqual(before);
      vi.unstubAllGlobals();
    },
  );

  it('does not offer cloud versions from an unfinished exported-discard sentinel', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key) =>
        key.endsWith('_cloud_conflict') ? JSON.stringify({ _exportDiscardPending: true }) : null,
    });
    const { scene } = makeScene({ cloud: { userId: 'account-a' } });
    expect(scene._canChooseCloudSave(1)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('rechecks a formerly healthy slot before confirming deletion', () => {
    mocked.domHost.mockReturnValue(true);
    const { scene } = makeScene();
    scene.confirmDelete(1);
    mocked.summary.mockReturnValue({ recoveryRequired: true });
    mocked.dialogActions.find(([label]) => label === 'Delete save')[1]();
    expect(mocked.deleteSlot).not.toHaveBeenCalled();
    expect(mocked.showRecovery).toHaveBeenCalledWith(scene, 1);
  });

  it('ignores an old DOM delete callback after another dialog opens', () => {
    mocked.domHost.mockReturnValue(true);
    const { scene } = makeScene();
    scene.confirmDelete(1);
    const oldDelete = mocked.dialogActions.find(([label]) => label === 'Delete save')[1];
    scene.confirmDelete(2);
    oldDelete();
    expect(mocked.deleteSlot).not.toHaveBeenCalled();
  });

  it.each(['became damaged', 'another dialog opened'])(
    'guards canvas deletion when %s',
    (reason) => {
      const { scene } = makeScene();
      const display = (copy) => {
        const object = { copy, handlers: {}, destroy: vi.fn() };
        for (const method of [
          'setDepth',
          'setInteractive',
          'setStrokeStyle',
          'setOrigin',
          'setColor',
          'setResolution',
        ])
          object[method] = () => object;
        object.on = (event, callback) => {
          object.handlers[event] = callback;
          return object;
        };
        return object;
      };
      scene.cameras = { main: { centerX: 320, centerY: 240 } };
      scene.add = { rectangle: () => display(), text: (_x, _y, copy) => display(copy) };
      scene._setDialogFocus = vi.fn();
      scene.confirmDelete(1);
      const oldDelete = scene.confirmDialog.find((object) => object.copy === '[ Delete ]').handlers
        .pointerdown;
      if (reason === 'became damaged') mocked.summary.mockReturnValue({ recoveryRequired: true });
      else scene.confirmDelete(2);
      oldDelete();
      expect(mocked.deleteSlot).not.toHaveBeenCalled();
      if (reason === 'became damaged') expect(mocked.showRecovery).toHaveBeenCalledWith(scene, 1);
    },
  );

  it('refuses stale healthy selection when the current slot needs recovery', async () => {
    mocked.summary.mockReturnValue({ recoveryRequired: true });
    const { scene, store } = makeScene({ activeSlot: 1, meta: { totalValor: 900 } });
    const before = new Map(store);
    await scene.selectSlot(2, { hasActiveRun: true });
    expect(store).toEqual(before);
    expect(mocked.metaInstances).toHaveLength(0);
    expect(mocked.transitionToSceneMock).not.toHaveBeenCalled();
    expect(mocked.startFirstRunFastPathMock).not.toHaveBeenCalled();
    expect(mocked.setActiveSlotMock).not.toHaveBeenCalled();
    expect(mocked.showRecovery).toHaveBeenCalledWith(scene, 2);
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
      { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
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
      { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
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

describe('SlotPickerScene selectSlot: the prologue offer (docs/specs/prologue-chapter.md §4)', () => {
  const withPrologue = (scene) => {
    scene.gameData = { metaUpgrades: [], prologue: { route: { nodes: [] } } };
    return scene;
  };
  const fresh = (prologue = 'none') => ({
    slot: 1,
    hasActiveRun: false,
    runCorrupt: false,
    runsStarted: 0,
    runsCompleted: 0,
    prologue,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.metaInstances.length = 0;
    mocked.dialogActions = [];
    mocked.transitionToSceneMock.mockResolvedValue(true);
    mocked.startFirstRunFastPathMock.mockResolvedValue(true);
    mocked.startPrologueRunMock.mockResolvedValue(true);
    mocked.skipPrologueToFirstRunMock.mockResolvedValue(true);
    mocked.loadRunMock.mockReturnValue(null);
    mocked.summary.mockReturnValue(null);
    mocked.domHost.mockReturnValue(true);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  });

  it('an empty slot is asked: Play the Prologue first, then Skip; nothing starts yet', async () => {
    const { scene, store } = makeScene();
    withPrologue(scene);
    await scene.selectSlot(1, null);
    expect(mocked.dialogActions.map(([label, , primary]) => [label, primary])).toEqual([
      ['Play the Prologue · about 30 minutes', true],
      ['Skip to the first run', false],
    ]);
    expect(mocked.startPrologueRunMock).not.toHaveBeenCalled();
    expect(mocked.skipPrologueToFirstRunMock).not.toHaveBeenCalled();
    expect(mocked.startFirstRunFastPathMock).not.toHaveBeenCalled();
    expect(mocked.transitionToSceneMock).not.toHaveBeenCalled();
    expect(mocked.setActiveSlotMock).not.toHaveBeenCalled();
    // Nothing is staged until a start is chosen; the picker stays usable.
    expect(store.has('activeSlot')).toBe(false);
    expect(store.has('meta')).toBe(false);
    expect(store.has('hints')).toBe(false);
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });

  it('Esc on the offer leaves the picker as it was: registry untouched, music playing', async () => {
    const audio = { stopMusic: vi.fn(), playMusic: vi.fn() };
    const prevMeta = { slot: 'previous' };
    const prevHints = { slot: 'previous' };
    const { scene, store } = makeScene({ audio, meta: prevMeta, hints: prevHints, activeSlot: 3 });
    withPrologue(scene);
    await scene.selectSlot(1, null);
    expect(scene.requestCancel()).toBe(true);
    expect(scene.nativeDialog).toBe(null);
    expect(store.get('meta')).toBe(prevMeta);
    expect(store.get('hints')).toBe(prevHints);
    expect(store.get('activeSlot')).toBe(3);
    expect(mocked.metaInstances).toHaveLength(0);
    expect(audio.stopMusic).not.toHaveBeenCalled();
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });

  it('the chosen start stages the slot, and stops the music, before it begins', async () => {
    const audio = { stopMusic: vi.fn(), playMusic: vi.fn() };
    const { scene, store } = makeScene({ audio });
    withPrologue(scene);
    let staged = null;
    mocked.startPrologueRunMock.mockImplementationOnce(async () => {
      staged = {
        activeSlot: store.get('activeSlot'),
        metaKey: store.get('meta')?.storageKey,
        hintsSlot: store.get('hints')?.slot,
        musicStopped: audio.stopMusic.mock.calls.length > 0,
      };
      return true;
    });
    await scene.selectSlot(2, null);
    await mocked.dialogActions[0][1]();
    expect(staged).toEqual({
      activeSlot: 2,
      metaKey: 'slot_2_meta',
      hintsSlot: 2,
      musicStopped: true,
    });
    expect(mocked.setActiveSlotMock).toHaveBeenCalledWith(2);
  });

  it.each([
    ['refused', () => mocked.startPrologueRunMock.mockResolvedValueOnce(false)],
    ['thrown', () => mocked.startPrologueRunMock.mockRejectedValueOnce(new Error('boom'))],
  ])('a %s start rolls the staged slot back and brings the music back', async (_, arrange) => {
    arrange();
    const audio = { stopMusic: vi.fn(), playMusic: vi.fn() };
    const prevMeta = { slot: 'previous' };
    const { scene, store } = makeScene({ audio, meta: prevMeta });
    withPrologue(scene);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await scene.selectSlot(1, null);
    await mocked.dialogActions[0][1]();
    error.mockRestore();
    expect(store.get('meta')).toBe(prevMeta);
    expect(store.has('hints')).toBe(false);
    expect(store.has('activeSlot')).toBe(false);
    expect(audio.stopMusic).toHaveBeenCalled();
    expect(audio.playMusic).toHaveBeenCalledWith('music_title', scene, 300);
    expect(mocked.setActiveSlotMock).not.toHaveBeenCalled();
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });

  it('Play starts the prologue run and persists the slot on success', async () => {
    const { scene } = makeScene();
    withPrologue(scene);
    await scene.selectSlot(1, null);
    await mocked.dialogActions[0][1]();
    expect(mocked.startPrologueRunMock).toHaveBeenCalledWith(scene, {
      gameData: scene.gameData,
      slot: 1,
    });
    expect(mocked.setActiveSlotMock).toHaveBeenCalledWith(1);
  });

  it("Skip takes today's fast path through the skip record", async () => {
    const { scene } = makeScene();
    withPrologue(scene);
    await scene.selectSlot(2, null);
    await mocked.dialogActions[1][1]();
    expect(mocked.skipPrologueToFirstRunMock).toHaveBeenCalledWith(scene, {
      gameData: scene.gameData,
      slot: 2,
    });
    expect(mocked.startPrologueRunMock).not.toHaveBeenCalled();
    expect(mocked.setActiveSlotMock).toHaveBeenCalledWith(2);
  });

  it('a refused start keeps the picker usable and the slot unpersisted', async () => {
    mocked.startPrologueRunMock.mockResolvedValue(false);
    const { scene } = makeScene();
    withPrologue(scene);
    await scene.selectSlot(1, null);
    await mocked.dialogActions[0][1]();
    expect(mocked.setActiveSlotMock).not.toHaveBeenCalled();
    expect(scene.isTransitioning).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });

  it('on a device that finished the prologue, Skip is the highlighted default', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k === 'emblem_rogue_tutorial_completed' ? '1' : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const { scene } = makeScene();
    withPrologue(scene);
    await scene.selectSlot(1, null);
    expect(mocked.dialogActions.map(([label, , primary]) => [label, primary])).toEqual([
      ['Skip to the first run', true],
      ['Play the Prologue · about 30 minutes', false],
    ]);
  });

  it('without a DOM the offer is the skip', async () => {
    mocked.domHost.mockReturnValue(false);
    const { scene } = makeScene();
    withPrologue(scene);
    await scene.selectSlot(1, null);
    expect(mocked.skipPrologueToFirstRunMock).toHaveBeenCalledTimes(1);
    expect(mocked.startFirstRunFastPathMock).not.toHaveBeenCalled();
    expect(mocked.setActiveSlotMock).toHaveBeenCalledWith(1);
  });

  it("a skipped prologue takes today's fast path; a completed one opens Home Base", async () => {
    mocked.summary.mockReturnValue(fresh('skipped'));
    const { scene } = makeScene();
    withPrologue(scene);
    await scene.selectSlot(1, fresh('skipped'));
    expect(mocked.startFirstRunFastPathMock).toHaveBeenCalledTimes(1);
    expect(mocked.dialogActions).toEqual([]);

    vi.clearAllMocks();
    mocked.transitionToSceneMock.mockResolvedValue(true);
    mocked.summary.mockReturnValue(fresh('complete'));
    const second = makeScene();
    withPrologue(second.scene);
    await second.scene.selectSlot(1, fresh('complete'));
    expect(mocked.transitionToSceneMock).toHaveBeenCalledWith(
      second.scene,
      'HomeBase',
      { gameData: second.scene.gameData, corruptRunDetected: false },
      { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
    );
    expect(mocked.startFirstRunFastPathMock).not.toHaveBeenCalled();
  });

  it('a build without prologue data keeps the first-run fast path', async () => {
    const { scene } = makeScene();
    await scene.selectSlot(1, null);
    expect(mocked.startFirstRunFastPathMock).toHaveBeenCalledTimes(1);
    expect(mocked.dialogActions).toEqual([]);
  });
});
