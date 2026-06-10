// Continue routing: a save suspended mid-battle offers Resume-or-Revert; a
// settled defeat routes to the RunComplete game-over flow; everything else
// resumes on the NodeMap.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

const { transitionToSceneMock, loadRunMock, clearBattleInProgressInSaveMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
  loadRunMock: vi.fn(),
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
    clearBattleInProgressInSave: clearBattleInProgressInSaveMock,
  };
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
      };
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
        { reason: TRANSITION_REASONS.CONTINUE },
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
      expect(rm.clearBattleInProgress).toHaveBeenCalledTimes(1);
      expect(clearBattleInProgressInSaveMock).toHaveBeenCalledWith(null, 2);
      expect(transitionToSceneMock).toHaveBeenCalledWith(
        scene,
        'NodeMap',
        expect.objectContaining({ runManager: rm }),
        { reason: TRANSITION_REASONS.CONTINUE },
      );
    });
  });
});
