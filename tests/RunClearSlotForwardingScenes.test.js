import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: {
      Clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    },
  },
}));

const { transitionToSceneMock, restartSceneMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
  restartSceneMock: vi.fn(async () => true),
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: transitionToSceneMock,
  restartScene: restartSceneMock,
  TRANSITION_REASONS: {
    SAVE_EXIT: 'save_exit',
    ABANDON_RUN: 'abandon_run',
    RETURN_HOME: 'return_home',
    RETURN_TITLE: 'return_title',
    BATTLE_COMPLETE: 'battle_complete',
    ENTER_BATTLE: 'enter_battle',
    VICTORY: 'victory',
    DEFEAT: 'defeat',
    RETRY: 'retry',
    BACK: 'back',
  },
}));

vi.mock('../src/utils/sceneLoader.js', () => ({
  resetTransitionLocks: vi.fn(),
  ensureSceneLoaded: vi.fn(async () => true),
}));

vi.mock('../src/utils/startupTelemetry.js', () => ({
  markStartup: vi.fn(),
}));

vi.mock('../src/utils/errorReporter.js', () => ({
  reportAsyncError: vi.fn(),
}));

vi.mock('../src/utils/blessingAnalytics.js', () => ({
  recordBlessingRunOutcome: vi.fn(),
}));

vi.mock('../src/ui/DialogueOverlay.js', () => ({
  DialogueOverlay: vi.fn(function () {
    this.showSequence = vi.fn(async () => {});
    this.destroy = vi.fn();
  }),
}));

vi.mock('../src/ui/PauseOverlay.js', () => ({
  PauseOverlay: vi.fn(function (_scene, options = {}) {
    this.onResume = options.onResume ?? null;
    this.onSaveAndExit = options.onSaveAndExit ?? null;
    this.onAbandon = options.onAbandon ?? null;
    this.visible = false;
    this.show = vi.fn(() => {
      this.visible = true;
    });
  }),
}));

vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return {
    ...actual,
    clearSavedRun: vi.fn((deleteCloudRun, slotNumber) =>
      actual.clearSavedRun(deleteCloudRun, slotNumber),
    ),
  };
});

vi.mock('../src/cloud/CloudSync.js', async () => {
  const actual = await vi.importActual('../src/cloud/CloudSync.js');
  return {
    ...actual,
    deleteRunSave: vi.fn(),
  };
});

import { RunCompleteScene } from '../src/scenes/RunCompleteScene.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { clearSavedRun } from '../src/engine/RunManager.js';
import { deleteRunSave } from '../src/cloud/CloudSync.js';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => {
    store[key] = String(value);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

function makeUiObject(label = '') {
  const handlers = {};
  return {
    _label: label,
    _handlers: handlers,
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
    setText() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    disableInteractive() {
      return this;
    },
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    destroy() {
      return undefined;
    },
  };
}

function makeBattleSceneForRecoveryTests() {
  const scene = Object.create(BattleScene.prototype);
  scene.gameData = {};
  scene.defeatRecoveryPrompt = null;
  scene.victoryRecoveryPrompt = null;
  scene._victoryBanner = null;
  scene.registry = {
    get: vi.fn((key) => {
      if (key === 'cloud') return { userId: 'user-1' };
      if (key === 'activeSlot') return undefined;
      if (key === 'audio') return null;
      return null;
    }),
  };
  scene.cameras = {
    main: {
      centerX: 320,
      centerY: 240,
      width: 640,
      height: 480,
    },
  };
  scene.add = {
    rectangle: vi.fn(() => makeUiObject()),
    text: vi.fn((_x, _y, label) => makeUiObject(label)),
  };
  scene._pinToScreen = vi.fn();
  scene.scene = { start: vi.fn() };
  return scene;
}

describe('Run clear callback forwarding across scenes', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    vi.clearAllMocks();
    transitionToSceneMock.mockResolvedValue(true);
    restartSceneMock.mockResolvedValue(true);
    delete globalThis.__emblemRogueStartupTelemetry;
  });

  it('RunComplete scene uses resolved clear slot when registry activeSlot is missing', async () => {
    localStorage.setItem('emblem_rogue_active_slot', '2');
    const scene = Object.create(RunCompleteScene.prototype);
    scene.result = 'defeat';
    scene.gameData = {};
    scene.runManager = {
      actIndex: 0,
      completedBattles: 0,
      activeBlessings: [],
      getActiveBlessingIds: vi.fn(() => []),
      settleEndRunRewards: vi.fn(() => ({ valor: 0, supply: 0, currencyMultiplier: 1 })),
    };
    scene.registry = {
      get: vi.fn((key) => {
        if (key === 'cloud') return { userId: 'user-1' };
        if (key === 'activeSlot') return undefined;
        if (key === 'audio') return null;
        if (key === 'meta') return null;
        return null;
      }),
    };
    scene.cameras = { main: { centerX: 320, centerY: 240 } };
    scene.events = { once: vi.fn() };
    scene.add = { text: vi.fn(() => makeUiObject()) };

    await RunCompleteScene.prototype.create.call(scene);

    expect(clearSavedRun).toHaveBeenCalledTimes(1);
    expect(clearSavedRun).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
    expect(deleteRunSave).toHaveBeenCalledWith('user-1', 2);
  });

  it('NodeMap scene abandon callback uses resolved clear slot when registry activeSlot is missing', async () => {
    localStorage.setItem('emblem_rogue_active_slot', '2');
    const scene = Object.create(NodeMapScene.prototype);
    scene.pauseOverlay = null;
    scene.gameData = {};
    scene.registry = {
      get: vi.fn((key) => {
        if (key === 'cloud') return { userId: 'user-1' };
        if (key === 'activeSlot') return undefined;
        if (key === 'audio') return null;
        return null;
      }),
    };
    scene.runManager = { failRun: vi.fn() };
    scene.scene = { start: vi.fn() };
    scene.showNodeMapTransitionRecovery = vi.fn();

    NodeMapScene.prototype.showPauseMenu.call(scene);
    await scene.pauseOverlay.onAbandon();

    expect(clearSavedRun).toHaveBeenCalledTimes(1);
    expect(clearSavedRun).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
    expect(deleteRunSave).toHaveBeenCalledWith('user-1', 2);
  });

  it('Battle scene abandon callback uses resolved clear slot when registry activeSlot is missing', async () => {
    localStorage.setItem('emblem_rogue_active_slot', '2');
    const scene = Object.create(BattleScene.prototype);
    scene.battleState = 'PLAYER_IDLE';
    scene.pauseOverlay = null;
    scene.gameData = {};
    scene.registry = {
      get: vi.fn((key) => {
        if (key === 'cloud') return { userId: 'user-1' };
        if (key === 'activeSlot') return undefined;
        if (key === 'audio') return null;
        if (key === 'meta') return null;
        return null;
      }),
    };
    scene.runManager = {
      failRun: vi.fn(),
      settleEndRunRewards: vi.fn(),
      nodeMap: null,
    };
    scene.playerUnits = [];
    scene.nonDeployedUnits = [];
    scene.clearBattleScopedDeltas = vi.fn();
    scene.refreshEndTurnControl = vi.fn();
    scene.scene = { start: vi.fn() };
    scene.showPauseTransitionRecovery = vi.fn();

    BattleScene.prototype.showPauseMenu.call(scene);
    await scene.pauseOverlay.onAbandon();

    expect(clearSavedRun).toHaveBeenCalledTimes(1);
    expect(clearSavedRun).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
    expect(deleteRunSave).toHaveBeenCalledWith('user-1', 2);
  });

  it('Battle defeat recovery title callback uses resolved clear slot when registry activeSlot is missing', async () => {
    localStorage.setItem('emblem_rogue_active_slot', '2');
    const scene = makeBattleSceneForRecoveryTests();

    BattleScene.prototype.showDefeatTransitionRecovery.call(scene);
    const titleBtn = scene.defeatRecoveryPrompt.find((item) => item?._label === '[ Title ]');
    expect(titleBtn).toBeTruthy();

    titleBtn._handlers.pointerdown?.({ button: 0 });
    await Promise.resolve();

    expect(clearSavedRun).toHaveBeenCalledTimes(1);
    expect(clearSavedRun).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
    expect(deleteRunSave).toHaveBeenCalledWith('user-1', 2);
  });

  it('Battle victory recovery title callback uses resolved clear slot when registry activeSlot is missing', async () => {
    localStorage.setItem('emblem_rogue_active_slot', '2');
    const scene = makeBattleSceneForRecoveryTests();

    BattleScene.prototype.showVictoryTransitionRecovery.call(scene);
    const titleBtn = scene.victoryRecoveryPrompt.find((item) => item?._label === '[ Title ]');
    expect(titleBtn).toBeTruthy();

    titleBtn._handlers.pointerdown?.({ button: 0 });
    await Promise.resolve();

    expect(clearSavedRun).toHaveBeenCalledTimes(1);
    expect(clearSavedRun).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
    expect(deleteRunSave).toHaveBeenCalledWith('user-1', 2);
  });
});
