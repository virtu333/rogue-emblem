// Continue routing: a save suspended mid-battle offers Resume-or-Revert; a
// settled defeat routes to the RunComplete game-over flow; everything else
// resumes on the NodeMap.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

const { transitionToSceneMock, loadRunMock, saveRunMock, clearBattleInProgressInSaveMock } =
  vi.hoisted(() => ({
    transitionToSceneMock: vi.fn(async () => true),
    loadRunMock: vi.fn(),
    saveRunMock: vi.fn(() => ({ ok: true })),
    clearBattleInProgressInSaveMock: vi.fn(() => ({ ok: true })),
  }));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: transitionToSceneMock };
});
vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return {
    ...actual,
    loadRun: loadRunMock,
    saveRun: saveRunMock,
    clearBattleInProgressInSave: clearBattleInProgressInSaveMock,
  };
});
vi.mock('../src/utils/audioUnlock.js', () => ({
  ensureAudioUnlocked: vi.fn(async () => {}),
}));

import { SlotPickerScene } from '../src/scenes/SlotPickerScene.js';
import { RunManager } from '../src/engine/RunManager.js';
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

function makeDisplayObject() {
  const obj = {
    setOrigin: () => obj,
    setDepth: () => obj,
    setStrokeStyle: () => obj,
    setAlpha: () => obj,
    setInteractive: () => obj,
    setColor: () => obj,
    handlers: {},
    on(event, cb) {
      obj.handlers[event] = cb;
      return obj;
    },
    destroy: vi.fn(),
  };
  return obj;
}

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
  scene.confirmDialog = null;
  scene.cameras = { main: { centerX: 320, centerY: 240, width: 640, height: 480 } };
  scene._dialogObjects = [];
  scene.add = {
    rectangle: () => {
      const obj = makeDisplayObject();
      scene._dialogObjects.push(obj);
      return obj;
    },
    text: (x, y, content) => {
      const obj = makeDisplayObject();
      obj.text = content;
      scene._dialogObjects.push(obj);
      return obj;
    },
  };
  return scene;
}

describe('SlotPickerScene continue routing', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
    transitionToSceneMock.mockResolvedValue(true);
  });

  it('routes a settled defeat to RunComplete', async () => {
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

  describe('suspended battle', () => {
    function makeSuspendedRm() {
      return {
        status: 'active',
        currentAct: 'act2',
        visionChargesRemaining: 0,
        visionCount: 2,
        rngSeed: 999,
        battleInProgress: {
          nodeId: 'node_7',
          battleParams: { act: 'act2', objective: 'seize', battleSeed: 42 },
          isBoss: true,
          isElite: false,
          visionChargesAtEntry: 1,
          visionCountAtEntry: 1,
          rngSeedAtEntry: 555,
          checkpoint: { checkpointIndex: 3, rngSeed: 4242, turnNumber: 5 },
        },
        getRoster: vi.fn(() => [{ name: 'Edric' }]),
        clearBattleInProgress: vi.fn(function () {
          this.battleInProgress = null;
        }),
        revertBattleInProgressToEntry: vi.fn(function () {
          return RunManager.prototype.revertBattleInProgressToEntry.call(this);
        }),
        removeFromConvoyByUid: vi.fn(),
        failRun: vi.fn(function () {
          this.status = 'defeat';
          this.battleInProgress = null;
        }),
      };
    }

    function dialogButtons(scene) {
      return scene._dialogObjects
        .map((o) => o.text)
        .filter((t) => typeof t === 'string' && t.startsWith('[ '));
    }

    it('shows the Resume-or-Revert choice instead of transitioning', async () => {
      const scene = makeScene();
      loadRunMock.mockReturnValue(makeSuspendedRm());

      await scene.selectSlot(2, { hasActiveRun: true });

      expect(transitionToSceneMock).not.toHaveBeenCalled();
      expect(scene.confirmDialog).toBeTruthy();
      expect(scene.isTransitioning).toBe(false);
    });

    it('Resume Battle transitions to Battle with the stored entry data + checkpoint', async () => {
      const scene = makeScene();
      const rm = makeSuspendedRm();

      await scene._continueSuspendedRun(2, rm, 'battle');

      expect(transitionToSceneMock).toHaveBeenCalledWith(
        scene,
        'Battle',
        expect.objectContaining({
          runManager: rm,
          nodeId: 'node_7',
          isBoss: true,
          isElite: false,
          battleParams: rm.battleInProgress.battleParams,
          resumeCheckpoint: rm.battleInProgress.checkpoint,
        }),
        { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
      );
      expect(rm.clearBattleInProgress).not.toHaveBeenCalled();
    });

    it('Continue from Map refunds entry values, scrubs the save, and goes to NodeMap', async () => {
      const scene = makeScene();
      const rm = makeSuspendedRm();

      await scene._continueSuspendedRun(2, rm, 'map');

      expect(rm.visionChargesRemaining).toBe(1);
      expect(rm.visionCount).toBe(1);
      expect(rm.rngSeed).toBe(555);
      expect(rm.battleInProgress).toBeNull();
      expect(clearBattleInProgressInSaveMock).toHaveBeenCalledWith(null, 2);
      expect(transitionToSceneMock).toHaveBeenCalledWith(
        scene,
        'NodeMap',
        expect.objectContaining({ runManager: rm }),
        { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
      );
    });

    it('offers Continue from Map (not Resume) for a checkpoint saved by an older build', async () => {
      const scene = makeScene();
      const rm = makeSuspendedRm();
      rm._battleRecoveryInvalid = true;
      rm._battleRecoveryLegacy = true;

      scene._showSuspendedBattleChoice(2, rm);
      expect(dialogButtons(scene)).toEqual(['[ Continue from Map ]']);
      expect(scene._dialogObjects.some((o) => /older version/.test(o.text || ''))).toBe(true);

      await scene._continueSuspendedRun(2, rm, 'battle');
      expect(transitionToSceneMock).not.toHaveBeenCalled();

      await scene._continueSuspendedRun(2, rm, 'map');
      expect(rm.visionChargesRemaining).toBe(1);
      expect(rm.rngSeed).toBe(555);
      expect(rm.battleInProgress).toBeNull();
      expect(transitionToSceneMock).toHaveBeenCalledWith(
        scene,
        'NodeMap',
        expect.objectContaining({ runManager: rm }),
        { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
      );
    });

    it('offers Continue from Map for an unreadable non-fatal checkpoint', () => {
      const scene = makeScene();
      const rm = makeSuspendedRm();
      rm._battleRecoveryInvalid = true;

      scene._showSuspendedBattleChoice(2, rm);
      expect(dialogButtons(scene)).toEqual(['[ Continue from Map ]']);
    });

    it('settles an unreadable fatal checkpoint as a defeat, never a free map revert', async () => {
      const scene = makeScene();
      const rm = makeSuspendedRm();
      rm._battleRecoveryInvalid = true;
      rm.battleInProgress.checkpoint.recoveryKind = 'fatal_pending';

      scene._showSuspendedBattleChoice(2, rm);
      expect(dialogButtons(scene)).toEqual(['[ Accept defeat ]']);

      await scene._continueSuspendedRun(2, rm, 'map');
      expect(clearBattleInProgressInSaveMock).not.toHaveBeenCalled();
      expect(transitionToSceneMock).not.toHaveBeenCalled();

      await scene._continueSuspendedRun(2, rm, 'defeat');
      expect(rm.failRun).toHaveBeenCalledTimes(1);
      expect(saveRunMock).toHaveBeenCalledWith(rm, null, 2);
      expect(transitionToSceneMock).toHaveBeenCalledWith(
        scene,
        'RunComplete',
        expect.objectContaining({ runManager: rm, result: 'defeat' }),
        { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
      );
    });

    it('keeps the fatal choice when the defeat cannot be saved', async () => {
      const scene = makeScene();
      const rm = makeSuspendedRm();
      rm._battleRecoveryInvalid = true;
      rm.battleInProgress.checkpoint.recoveryKind = 'fatal_pending';
      saveRunMock.mockReturnValueOnce({ ok: false, reason: 'quota' });
      const reloaded = makeSuspendedRm();
      reloaded._battleRecoveryInvalid = true;
      reloaded.battleInProgress.checkpoint.recoveryKind = 'fatal_pending';
      loadRunMock.mockReturnValue(reloaded);

      await scene._continueSuspendedRun(2, rm, 'defeat');

      expect(transitionToSceneMock).not.toHaveBeenCalled();
      expect(scene.isTransitioning).toBe(false);
      expect(dialogButtons(scene)).toContain('[ Accept defeat ]');
    });

    it('never offers a map revert for a readable fatal checkpoint', () => {
      const scene = makeScene();
      const rm = makeSuspendedRm();
      rm.battleInProgress.checkpoint.recoveryKind = 'fatal_pending';

      scene._showSuspendedBattleChoice(2, rm);
      expect(dialogButtons(scene)).toEqual(['[ Resume Battle ]']);
    });
  });
});
