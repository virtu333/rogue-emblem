import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transitionToSceneMock, resetTransitionLocksMock, clearSavedRunMock, deleteRunSaveMock } =
  vi.hoisted(() => ({
    transitionToSceneMock: vi.fn(async () => true),
    resetTransitionLocksMock: vi.fn(),
    clearSavedRunMock: vi.fn(),
    deleteRunSaveMock: vi.fn(),
  }));

vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: transitionToSceneMock,
  };
});

vi.mock('../src/utils/sceneLoader.js', async () => {
  const actual = await vi.importActual('../src/utils/sceneLoader.js');
  return {
    ...actual,
    resetTransitionLocks: resetTransitionLocksMock,
  };
});

vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return {
    ...actual,
    clearSavedRun: clearSavedRunMock,
  };
});

vi.mock('../src/cloud/CloudSync.js', async () => {
  const actual = await vi.importActual('../src/cloud/CloudSync.js');
  return {
    ...actual,
    deleteRunSave: deleteRunSaveMock,
  };
});

import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';
import { TransitionRecoveryController } from '../src/ui/TransitionRecoveryController.js';

function makeUiObject(label = '') {
  const handlers = {};
  return {
    _label: label,
    _handlers: handlers,
    active: true,
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    disableInteractive() {
      return this;
    },
    setColor() {
      return this;
    },
    setText(text) {
      this._label = text;
      return this;
    },
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    destroy() {
      this.active = false;
    },
  };
}

function makeScene() {
  const scene = {
    gameData: {},
    runManager: {},
    defeatRecoveryPrompt: null,
    victoryRecoveryPrompt: null,
    _victoryBanner: null,
    cameras: {
      main: {
        centerX: 320,
        centerY: 240,
        width: 640,
        height: 480,
      },
    },
    add: {
      rectangle: vi.fn(() => makeUiObject()),
      text: vi.fn((_x, _y, label) => makeUiObject(label)),
    },
    registry: {
      get: vi.fn((key) => {
        if (key === 'cloud') return { userId: 'user-1' };
        if (key === 'activeSlot') return undefined;
        if (key === 'audio') return { stopMusic: vi.fn() };
        return null;
      }),
    },
    transitionToRunCompleteWithRetry: vi.fn(async () => true),
    _pinToScreen: vi.fn(),
    scene: {
      start: vi.fn(),
      isActive: vi.fn(() => true),
    },
  };
  return scene;
}

describe('TransitionRecoveryController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transitionToSceneMock.mockResolvedValue(true);
    clearSavedRunMock.mockImplementation((callback) => {
      if (typeof callback === 'function') callback(2);
    });
  });

  it('builds defeat recovery UI once (dedup guard)', () => {
    const scene = makeScene();
    const controller = new TransitionRecoveryController(scene);

    controller.showDefeatRecovery();
    const firstPrompt = scene.defeatRecoveryPrompt;
    controller.showDefeatRecovery();

    expect(firstPrompt).toBeTruthy();
    expect(firstPrompt.length).toBe(6);
    expect(scene.defeatRecoveryPrompt).toBe(firstPrompt);
    expect(scene.add.rectangle).toHaveBeenCalledTimes(2);
    expect(scene.add.text).toHaveBeenCalledTimes(4);
  });

  it('defeat retry button delegates to transitionToRunCompleteWithRetry(defeat)', async () => {
    const scene = makeScene();
    const controller = new TransitionRecoveryController(scene);

    controller.showDefeatRecovery();
    const retryBtn = scene.defeatRecoveryPrompt.find((obj) => obj?._label === '[ Retry ]');
    expect(retryBtn).toBeTruthy();

    await retryBtn._handlers.pointerdown({ button: 0 });

    expect(resetTransitionLocksMock).toHaveBeenCalledWith(scene);
    expect(scene.transitionToRunCompleteWithRetry).toHaveBeenCalledWith('defeat');
  });

  it('victory title button clears run and transitions to Title with RETURN_TITLE reason', async () => {
    const scene = makeScene();
    const banner = { destroy: vi.fn() };
    scene._victoryBanner = banner;
    const controller = new TransitionRecoveryController(scene);

    controller.showVictoryRecovery();
    const titleBtn = scene.victoryRecoveryPrompt.find((obj) => obj?._label === '[ Title ]');
    expect(titleBtn).toBeTruthy();
    expect(banner.destroy).toHaveBeenCalledTimes(1);

    titleBtn._handlers.pointerdown({ button: 0 });
    await Promise.resolve();

    expect(clearSavedRunMock).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(deleteRunSaveMock).toHaveBeenCalledWith('user-1', 2);
    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'Title',
      { gameData: scene.gameData },
      { reason: TRANSITION_REASONS.RETURN_TITLE },
    );
  });
});
