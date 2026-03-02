import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return {
    ...actual,
    RunManager: class {
      startRun() {}
      getBlessingOptions() {
        return [];
      }
    },
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { BlessingSelectScene } from '../src/scenes/BlessingSelectScene.js';
import { DifficultySelectScene } from '../src/scenes/DifficultySelectScene.js';
import { SlotPickerScene } from '../src/scenes/SlotPickerScene.js';

function createEmitter() {
  const listeners = new Map();
  return {
    on(eventName, handler) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(handler);
      return this;
    },
    off(eventName, handler) {
      const handlers = listeners.get(eventName);
      if (!handlers) return this;
      if (handler) handlers.delete(handler);
      else handlers.clear();
      if (handlers.size === 0) listeners.delete(eventName);
      return this;
    },
    emit(eventName, payload) {
      for (const handler of Array.from(listeners.get(eventName) || [])) {
        handler(payload);
      }
    },
    listenerCount(eventName) {
      return listeners.get(eventName)?.size || 0;
    },
  };
}

function createKeyboardEmitter() {
  const keyboard = createEmitter();
  const keys = new Map();
  keyboard.addKey = vi.fn((keyCode) => {
    if (!keys.has(keyCode)) keys.set(keyCode, createEmitter());
    return keys.get(keyCode);
  });
  keyboard.keyListenerCount = (keyCode, eventName = 'down') =>
    keys.get(keyCode)?.listenerCount(eventName) || 0;
  return keyboard;
}

function setupBattleShortcutContext(scene, keyboard) {
  scene.registry = { get: vi.fn(() => null) };
  scene.input = { keyboard };
  scene.isStoryInputLocked = () => false;
  scene.inspectionPanel = { visible: false, _unit: null };
  scene.unitDetailOverlay = { visible: false };
  scene.requestCancel = vi.fn();
  scene.requestVisionRewind = vi.fn();
  scene._onRosterClick = vi.fn();
  scene._onDangerClick = vi.fn();
  scene.forceEndTurn = vi.fn();
  scene.refreshEndTurnControl = vi.fn();
  scene.hideLootRoster = vi.fn();
  scene.showLootRoster = vi.fn();
  scene._hideLootTooltip = vi.fn();
  scene._cycleForecastWeapon = vi.fn();
  scene.grid = { clearHighlights: vi.fn() };
  scene.turnManager = { unitActed: vi.fn() };
  scene.dimUnit = vi.fn();
  scene.selectedUnit = null;
  scene.lootGroup = null;
  scene.runManager = {};
  scene.battleState = 'PLAYER_IDLE';
}

function createDisplayObject() {
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
    on() {
      return this;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BattleScene shutdown/input lifecycle hotfix', () => {
  it('registers shutdown cleanup in create before beginBattle startup starts and keeps cleanup idempotent', () => {
    const scene = new BattleScene();
    scene.init({ gameData: { skills: [] }, battleParams: { act: 'act1' } });

    let shutdownHandler = null;
    scene.events = {
      once: vi.fn((eventName, handler) => {
        if (eventName === 'shutdown') shutdownHandler = handler;
      }),
    };
    scene.beginBattle = vi.fn(() => new Promise(() => {}));
    scene.registry = { get: vi.fn(() => null) };
    scene._stopLevelUpSfx = vi.fn();
    scene._clearTutorialGuideHighlights = vi.fn();
    scene.cancelTouchInspectHold = vi.fn();
    scene._hideMenuTooltip = vi.fn();
    scene._restoreBattleRng = vi.fn();
    scene._clearPostLootTransitionFallback = vi.fn();
    scene._unbindGameplayKeyboardHandlers = vi.fn();
    scene._teardownBattleCameraSystem = vi.fn();

    scene.create();

    expect(scene.events.once).toHaveBeenCalledWith('shutdown', expect.any(Function));
    expect(scene.events.once.mock.invocationCallOrder[0]).toBeLessThan(
      scene.beginBattle.mock.invocationCallOrder[0],
    );
    expect(typeof shutdownHandler).toBe('function');

    shutdownHandler();
    shutdownHandler();
    expect(scene._sceneShutdownCleanedUp).toBe(true);
    expect(scene._unbindGameplayKeyboardHandlers).toHaveBeenCalledTimes(1);
    expect(scene._teardownBattleCameraSystem).toHaveBeenCalledTimes(1);
  });

  it('detaches keyboard handlers and clears native timers on shutdown so post-shutdown keypress is safe', async () => {
    vi.useFakeTimers();

    const keyboard = createKeyboardEmitter();
    const scene = new BattleScene();
    scene.init({ gameData: { skills: [] }, battleParams: { act: 'act1' } });
    setupBattleShortcutContext(scene, keyboard);

    scene._bindGameplayKeyboardHandlers();
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);

    keyboard.emit('keydown-ESC', { key: 'Escape' });
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);

    let postLootFired = false;
    let lootCleanupFired = false;
    scene._postLootTransitionTimer = setTimeout(() => {
      postLootFired = true;
    }, 100);
    scene._lootCleanupTimeout = setTimeout(() => {
      lootCleanupFired = true;
    }, 100);

    scene._runSceneShutdownCleanup();
    expect(scene._sceneShutdownCleanedUp).toBe(true);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);
    expect(keyboard.listenerCount('keydown-R')).toBe(0);
    expect(keyboard.listenerCount('keydown-V')).toBe(0);

    keyboard.emit('keydown-ESC', { key: 'Escape' });
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(110);
    expect(postLootFired).toBe(false);
    expect(lootCleanupFired).toBe(false);
  });

  it('does not increase gameplay keyboard listener count across repeated enter/exit cycles', () => {
    const keyboard = createKeyboardEmitter();
    const scene = new BattleScene();
    scene.init({ gameData: { skills: [] }, battleParams: { act: 'act1' } });
    setupBattleShortcutContext(scene, keyboard);

    scene._bindGameplayKeyboardHandlers();
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);

    scene._runSceneShutdownCleanup();
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);

    scene.init({ gameData: { skills: [] }, battleParams: { act: 'act1' } });
    setupBattleShortcutContext(scene, keyboard);
    scene._bindGameplayKeyboardHandlers();
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
  });
});

describe('Menu scene keyboard listener lifecycle', () => {
  it('BlessingSelectScene detaches keyboard listeners on shutdown and re-entry does not leak listeners', () => {
    const keyboard = createKeyboardEmitter();
    let shutdownHandler = null;
    const scene = {
      registry: { get: vi.fn(() => null) },
      events: {
        once: vi.fn((eventName, handler) => {
          if (eventName === 'shutdown') shutdownHandler = handler;
        }),
      },
      input: { keyboard },
      gameData: { weaponArts: { arts: [] } },
      _draw: vi.fn(),
      _navigate: vi.fn(),
      _confirm: vi.fn(),
      _back: vi.fn(),
    };

    BlessingSelectScene.prototype.create.call(scene);
    expect(keyboard.listenerCount('keydown-UP')).toBe(1);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
    shutdownHandler();
    expect(keyboard.listenerCount('keydown-UP')).toBe(0);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);

    BlessingSelectScene.prototype.create.call(scene);
    expect(keyboard.listenerCount('keydown-UP')).toBe(1);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
  });

  it('DifficultySelectScene detaches keyboard listeners on shutdown and re-entry does not leak listeners', () => {
    const keyboard = createKeyboardEmitter();
    let shutdownHandler = null;
    const scene = {
      registry: {
        get: vi.fn((key) => {
          if (key === 'meta') return { hasMilestone: () => false };
          return null;
        }),
      },
      events: {
        once: vi.fn((eventName, handler) => {
          if (eventName === 'shutdown') shutdownHandler = handler;
        }),
      },
      input: { keyboard, on: vi.fn(), off: vi.fn() },
      gameData: { difficulty: { modes: { normal: {}, hard: {}, lunatic: {} } } },
      _draw: vi.fn(),
      _navigate: vi.fn(),
      _confirm: vi.fn(),
      _back: vi.fn(),
      _buildModes: vi.fn(() => [{ id: 'normal', locked: false }]),
    };

    DifficultySelectScene.prototype.create.call(scene);
    expect(keyboard.listenerCount('keydown-LEFT')).toBe(1);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
    shutdownHandler();
    expect(keyboard.listenerCount('keydown-LEFT')).toBe(0);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);

    DifficultySelectScene.prototype.create.call(scene);
    expect(keyboard.listenerCount('keydown-LEFT')).toBe(1);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
  });

  it('SlotPickerScene detaches keyboard and pointer listeners on shutdown and re-entry does not leak listeners', () => {
    const keyboard = createKeyboardEmitter();
    const inputEmitter = createEmitter();
    let shutdownHandler = null;
    const scene = {
      cameras: { main: { centerX: 320 } },
      add: {
        text: vi.fn(() => createDisplayObject()),
      },
      events: {
        once: vi.fn((eventName, handler) => {
          if (eventName === 'shutdown') shutdownHandler = handler;
        }),
      },
      input: {
        keyboard,
        on: inputEmitter.on.bind(inputEmitter),
        off: inputEmitter.off.bind(inputEmitter),
      },
      requestCancel: vi.fn(),
      drawSlots: vi.fn(),
      runTransition: vi.fn(),
      gameData: {},
    };

    SlotPickerScene.prototype.create.call(scene);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
    expect(inputEmitter.listenerCount('pointerdown')).toBe(1);
    expect(inputEmitter.listenerCount('pointerup')).toBe(1);

    shutdownHandler();
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);
    expect(inputEmitter.listenerCount('pointerdown')).toBe(0);
    expect(inputEmitter.listenerCount('pointerup')).toBe(0);

    SlotPickerScene.prototype.create.call(scene);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
    expect(inputEmitter.listenerCount('pointerdown')).toBe(1);
    expect(inputEmitter.listenerCount('pointerup')).toBe(1);
  });
});
