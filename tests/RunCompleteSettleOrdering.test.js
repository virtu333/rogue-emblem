// Regression test for the defeat-flow data-loss window (Wave 1):
// RunCompleteScene must settle end-of-run rewards into meta BEFORE deleting
// the run save. The old order deleted the save first, then awaited the
// user-paced defeat dialogue before settling — closing the tab on the GAME
// OVER dialogue permanently lost the run's valor/supply/milestones.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

const { transitionToSceneMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: transitionToSceneMock,
  TRANSITION_REASONS: { RETURN_HOME: 'return_home', RETURN_TITLE: 'return_title' },
}));

vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: vi.fn() }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
vi.mock('../src/utils/blessingAnalytics.js', () => ({ recordBlessingRunOutcome: vi.fn() }));

const { dialogueShowSequenceMock } = vi.hoisted(() => ({
  dialogueShowSequenceMock: vi.fn(async () => {}),
}));

vi.mock('../src/ui/DialogueOverlay.js', () => ({
  DialogueOverlay: vi.fn(function () {
    this.showSequence = dialogueShowSequenceMock;
    this.destroy = vi.fn();
  }),
}));

vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return { ...actual, clearSavedRun: vi.fn() };
});

vi.mock('../src/cloud/CloudSync.js', async () => {
  const actual = await vi.importActual('../src/cloud/CloudSync.js');
  return { ...actual, deleteRunSave: vi.fn() };
});

import { RunCompleteScene } from '../src/scenes/RunCompleteScene.js';
import { clearSavedRun } from '../src/engine/RunManager.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
  },
  writable: true,
});

function makeUiObject() {
  return {
    setOrigin() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setColor() {
      return this;
    },
    setDepth() {
      return this;
    },
    on() {
      return this;
    },
    destroy() {},
  };
}

function makeScene({ result, dialogueEntries = null }) {
  const callOrder = [];
  const scene = Object.create(RunCompleteScene.prototype);
  scene.result = result;
  scene.gameData = dialogueEntries
    ? { dialogue: { runComplete: { defeat: dialogueEntries } } }
    : {};
  scene.runManager = {
    actIndex: 1,
    completedBattles: 5,
    activeBlessings: [],
    getActiveBlessingIds: vi.fn(() => []),
    settleEndRunRewards: vi.fn(() => {
      callOrder.push('settle');
      return { valor: 120, supply: 80, currencyMultiplier: 1 };
    }),
  };
  scene.registry = {
    get: vi.fn((key) => {
      if (key === 'cloud') return null;
      if (key === 'activeSlot') return 1;
      if (key === 'audio') return null;
      if (key === 'meta') return null;
      return null;
    }),
  };
  scene.cameras = { main: { centerX: 320, centerY: 240 } };
  scene.events = { once: vi.fn() };
  scene.add = { text: vi.fn(() => makeUiObject()) };
  clearSavedRun.mockImplementation(() => {
    callOrder.push('clear');
  });
  return { scene, callOrder };
}

describe('RunCompleteScene reward settlement ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogueShowSequenceMock.mockImplementation(async () => {});
  });

  it('settles rewards before clearing the run save on defeat', async () => {
    const { scene, callOrder } = makeScene({ result: 'defeat' });

    await RunCompleteScene.prototype.create.call(scene);

    expect(callOrder).toEqual(['settle', 'clear']);
  });

  it('settles rewards and clears the save before the defeat dialogue can block', async () => {
    const { scene, callOrder } = makeScene({
      result: 'defeat',
      dialogueEntries: [{ speaker: 'Narrator', text: 'The kingdom falls.' }],
    });

    // Simulate the player abandoning the tab on the GAME OVER dialogue: the
    // sequence promise never resolves. Settlement and clear must already have
    // happened by the time the dialogue is shown.
    let dialogueShown = false;
    dialogueShowSequenceMock.mockImplementation(
      () =>
        new Promise(() => {
          dialogueShown = true;
        }),
    );

    const createPromise = RunCompleteScene.prototype.create.call(scene);
    await Promise.resolve();
    await Promise.resolve();

    expect(dialogueShown).toBe(true);
    expect(callOrder).toEqual(['settle', 'clear']);

    // Never await createPromise — the dialogue intentionally never resolves.
    void createPromise;
  });
});
