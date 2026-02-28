import { afterEach, describe, expect, it, vi } from 'vitest';

const { showImportantHintMock, showMinorHintMock } = vi.hoisted(() => ({
  showImportantHintMock: vi.fn(async () => {}),
  showMinorHintMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: {
      Clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    },
  },
}));

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: showImportantHintMock,
  showMinorHint: showMinorHintMock,
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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

afterEach(() => {
  vi.clearAllMocks();
});

describe('Async shutdown hardening', () => {
  it('NodeMap finalizeSceneReady does not run post-await startup logic after shutdown', async () => {
    const deferred = createDeferred();
    const scene = {
      _sceneLifecycleGeneration: 1,
      _sceneShuttingDown: false,
      ensureAudioUnlocked: vi.fn(() => deferred.promise),
      input: { enabled: false },
      sys: { isActive: () => true },
      runManager: {
        hasShownDialogue: vi.fn(() => true),
        markDialogueShown: vi.fn(),
      },
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _consumePendingNodeSelection: vi.fn(() => false),
      isSceneReady: false,
    };

    const finalizePromise = NodeMapScene.prototype.finalizeSceneReady.call(scene, 1);
    scene._sceneShuttingDown = true;
    scene._sceneLifecycleGeneration = 2;
    deferred.resolve();
    await finalizePromise;

    expect(scene.input.enabled).toBe(false);
    expect(scene._showPendingNodeMapHints).not.toHaveBeenCalled();
    expect(scene._consumePendingNodeSelection).not.toHaveBeenCalled();
    expect(scene.isSceneReady).toBe(false);
  });

  it('NodeMap _onSceneShutdown clears timers/overlays exactly once', () => {
    const timerA = { remove: vi.fn() };
    const timerB = { remove: vi.fn() };
    const audio = { releaseMusic: vi.fn() };
    const mobileEvents = { off: vi.fn(), emit: vi.fn() };
    const scene = {
      _sceneShutdownCleanedUp: false,
      _sceneTimers: new Set([timerA, timerB]),
      _churchMessageTimer: timerA,
      _transientMessageTimer: timerB,
      registry: { get: vi.fn((key) => (key === 'audio' ? audio : null)) },
      sound: { stopByKey: vi.fn() },
      pauseOverlay: { visible: true, hide: vi.fn() },
      settingsOverlay: { visible: true, hide: vi.fn() },
      rosterOverlay: { visible: true, hide: vi.fn() },
      debugOverlay: { visible: true, hide: vi.fn() },
      shopOverlay: [{}],
      churchOverlay: [{}],
      closeShopOverlay: vi.fn(),
      closeChurchOverlay: vi.fn(),
      transientMessage: { destroy: vi.fn() },
      churchMessage: { destroy: vi.fn() },
      nodeTooltip: { destroy: vi.fn() },
      dialogueOverlay: { destroy: vi.fn() },
      _unbindInputHandlers: vi.fn(),
      _pendingNodeSelection: { nodeId: 'n1' },
      isMobileInput: true,
      _mobileHandlers: {
        cancel: vi.fn(),
        menu: vi.fn(),
      },
      game: { events: mobileEvents },
    };

    NodeMapScene.prototype._onSceneShutdown.call(scene);
    NodeMapScene.prototype._onSceneShutdown.call(scene);

    expect(timerA.remove).toHaveBeenCalledTimes(1);
    expect(timerB.remove).toHaveBeenCalledTimes(1);
    expect(scene.pauseOverlay).toBeNull();
    expect(scene.settingsOverlay).toBeNull();
    expect(scene.rosterOverlay).toBeNull();
    expect(scene.debugOverlay).toBeNull();
    expect(scene.closeShopOverlay).toHaveBeenCalledTimes(1);
    expect(scene.closeChurchOverlay).toHaveBeenCalledTimes(1);
    expect(scene.dialogueOverlay).toBeNull();
    expect(scene._unbindInputHandlers).toHaveBeenCalledTimes(1);
    expect(mobileEvents.off).toHaveBeenCalledTimes(2);
    expect(mobileEvents.emit).toHaveBeenCalledWith('mobile:setContext', {
      context: 'none',
      resetStack: true,
    });
    expect(scene._sceneShutdownCleanedUp).toBe(true);
    expect(scene._sceneShuttingDown).toBe(true);
  });

  it('NodeMap dev backtick listener is detached on shutdown and does not accumulate on re-entry', () => {
    const debugKey = createEmitter();
    const keyboard = {
      off: vi.fn(),
      addKey: vi.fn(() => debugKey),
    };
    const scene = new NodeMapScene();
    scene.registry = {
      get: vi.fn((key) => (key === 'devToolsEnabled' ? true : null)),
    };
    scene.input = {
      keyboard,
      off: vi.fn(),
    };
    scene.debugOverlay = { visible: false, toggle: vi.fn(), hide: vi.fn() };
    scene._sceneShutdownCleanedUp = false;
    scene._sceneShuttingDown = false;
    scene._sceneTimers = new Set();

    scene._bindDebugToggleHandler();
    expect(debugKey.listenerCount('down')).toBe(1);
    debugKey.emit('down');
    expect(scene.debugOverlay.toggle).toHaveBeenCalledTimes(1);

    scene._onSceneShutdown();
    expect(debugKey.listenerCount('down')).toBe(0);
    debugKey.emit('down');
    expect(scene.debugOverlay).toBeNull();

    scene._sceneShutdownCleanedUp = false;
    scene._sceneShuttingDown = false;
    scene.debugOverlay = { visible: false, toggle: vi.fn(), hide: vi.fn() };
    scene._bindDebugToggleHandler();
    expect(debugKey.listenerCount('down')).toBe(1);

    scene._onSceneShutdown();
    expect(debugKey.listenerCount('down')).toBe(0);
    expect(keyboard.addKey).toHaveBeenCalledTimes(2);
  });

  it('HomeBase startup hints do not show follow-up hint after shutdown', async () => {
    const deferred = createDeferred();
    showImportantHintMock.mockImplementationOnce(() => deferred.promise);

    const scene = {
      _sceneLifecycleGeneration: 1,
      _sceneShuttingDown: false,
      sys: { isActive: () => true },
    };
    const hints = {
      shouldShow: (key) => key === 'homebase_intro' || key === 'homebase_begin',
    };

    const hintPromise = HomeBaseScene.prototype._runStartupHints.call(scene, hints, 1);
    scene._sceneShuttingDown = true;
    scene._sceneLifecycleGeneration = 2;
    deferred.resolve();
    await hintPromise;

    expect(showImportantHintMock).toHaveBeenCalledTimes(1);
    expect(showMinorHintMock).not.toHaveBeenCalled();
  });

  it('HomeBase runTransition skips late transition work when shutdown happens mid-await', async () => {
    const deferred = createDeferred();
    const action = vi.fn(async () => true);
    const audio = { playSFX: vi.fn() };
    const scene = {
      _sceneLifecycleGeneration: 1,
      _sceneShuttingDown: false,
      isTransitioning: false,
      input: { enabled: true },
      ensureAudioUnlocked: vi.fn(() => deferred.promise),
      showTransientMessage: vi.fn(),
      registry: { get: vi.fn((key) => (key === 'audio' ? audio : null)) },
      sound: {},
      sys: { isActive: () => true },
    };

    const transitionPromise = HomeBaseScene.prototype.runTransition.call(scene, action);
    scene._sceneShuttingDown = true;
    scene._sceneLifecycleGeneration = 2;
    deferred.resolve();
    const transitioned = await transitionPromise;

    expect(transitioned).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(scene.showTransientMessage).not.toHaveBeenCalled();
    expect(audio.playSFX).not.toHaveBeenCalled();
  });

  it('HomeBase _onSceneShutdown clears timers and detaches listeners exactly once', () => {
    const timer = { remove: vi.fn() };
    const audio = { releaseMusic: vi.fn() };
    const mobileEvents = { off: vi.fn(), emit: vi.fn() };
    const scene = {
      _sceneShutdownCleanedUp: false,
      _sceneTimers: new Set([timer]),
      _transientMessageTimer: timer,
      refundMode: true,
      _hideRefundConfirm: vi.fn(),
      _hideUpgradeTooltip: vi.fn(),
      _destroySkillPicker: vi.fn(),
      _prereqTooltip: { destroy: vi.fn() },
      _tierTooltip: { destroy: vi.fn() },
      transientMessage: { destroy: vi.fn() },
      input: {
        keyboard: { off: vi.fn() },
        off: vi.fn(),
      },
      isMobileInput: true,
      _mobileHandlers: {
        cancel: vi.fn(),
        menu: vi.fn(),
      },
      game: { events: mobileEvents },
      registry: { get: vi.fn((key) => (key === 'audio' ? audio : null)) },
    };

    HomeBaseScene.prototype._onSceneShutdown.call(scene);
    HomeBaseScene.prototype._onSceneShutdown.call(scene);

    expect(timer.remove).toHaveBeenCalledTimes(1);
    expect(scene._hideRefundConfirm).toHaveBeenCalledTimes(1);
    expect(scene._hideUpgradeTooltip).toHaveBeenCalledTimes(1);
    expect(scene._destroySkillPicker).toHaveBeenCalledTimes(1);
    expect(scene.input.keyboard.off).toHaveBeenCalledTimes(1);
    expect(scene.input.off).toHaveBeenCalledTimes(5);
    expect(mobileEvents.off).toHaveBeenCalledTimes(2);
    expect(mobileEvents.emit).toHaveBeenCalledWith('mobile:setContext', {
      context: 'none',
      resetStack: true,
    });
    expect(audio.releaseMusic).toHaveBeenCalledTimes(1);
    expect(scene._sceneShutdownCleanedUp).toBe(true);
    expect(scene._sceneShuttingDown).toBe(true);
  });
});

describe('pointerupoutside binding and cleanup', () => {
  it('NodeMapScene binds pointerupoutside to a dedicated handler separate from pointerup', () => {
    const scene = new NodeMapScene();
    const inputEmitter = createEmitter();
    const keyboard = createEmitter();
    keyboard.addKey = vi.fn(() => createEmitter());
    scene.input = Object.assign(inputEmitter, { keyboard, enabled: false });
    scene.sys = { isActive: () => true };
    scene.registry = { get: vi.fn(() => null) };
    scene._storyDialogueActive = false;
    scene.dialogueOverlay = null;
    scene._sceneShuttingDown = false;
    scene._sceneShutdownCleanedUp = false;
    scene._sceneTimers = new Set();

    scene._bindInputHandlers();

    // Both pointerup and pointerupoutside should have exactly 1 listener each
    expect(inputEmitter.listenerCount('pointerup')).toBe(1);
    expect(inputEmitter.listenerCount('pointerupoutside')).toBe(1);

    // Verify dedicated handlers exist and are distinct references
    expect(scene._onPointerUp).toBeTruthy();
    expect(scene._onPointerUpOutside).toBeTruthy();
    expect(scene._onPointerUp).not.toBe(scene._onPointerUpOutside);

    // Cleanup unbinds both
    scene._unbindInputHandlers();
    expect(inputEmitter.listenerCount('pointerup')).toBe(0);
    expect(inputEmitter.listenerCount('pointerupoutside')).toBe(0);
  });

  it('NodeMapScene _onSceneShutdown unbinds pointerupoutside', () => {
    const inputEmitter = createEmitter();
    const keyboard = createEmitter();
    keyboard.addKey = vi.fn(() => createEmitter());
    const mobileEvents = createEmitter();
    const audio = { releaseMusic: vi.fn() };

    const scene = new NodeMapScene();
    scene.input = Object.assign(inputEmitter, { keyboard, enabled: false });
    scene.sys = { isActive: () => true };
    scene.registry = { get: vi.fn((key) => (key === 'audio' ? audio : null)) };
    scene._storyDialogueActive = false;
    scene.dialogueOverlay = null;
    scene._sceneShuttingDown = false;
    scene._sceneShutdownCleanedUp = false;
    scene._sceneTimers = new Set();
    scene.isMobileInput = false;
    scene.sound = { stopByKey: vi.fn() };

    scene._bindInputHandlers();
    expect(inputEmitter.listenerCount('pointerupoutside')).toBe(1);

    scene._onSceneShutdown();
    expect(inputEmitter.listenerCount('pointerupoutside')).toBe(0);
    expect(inputEmitter.listenerCount('pointerup')).toBe(0);
  });

  it('HomeBaseScene _onSceneShutdown unbinds pointerupoutside', () => {
    const inputEmitter = createEmitter();
    const keyboard = createEmitter();
    const mobileEvents = createEmitter();
    const audio = { releaseMusic: vi.fn() };

    // Simulate the input binding done in HomeBaseScene.create()
    const onPointerUp = vi.fn();
    inputEmitter.on('pointerup', onPointerUp);
    inputEmitter.on('pointerupoutside', onPointerUp);

    expect(inputEmitter.listenerCount('pointerup')).toBe(1);
    expect(inputEmitter.listenerCount('pointerupoutside')).toBe(1);

    // Simulate shutdown cleanup matching HomeBaseScene._onSceneShutdown
    const scene = {
      _sceneShutdownCleanedUp: false,
      _sceneTimers: new Set(),
      _transientMessageTimer: null,
      refundMode: false,
      _hideRefundConfirm: vi.fn(),
      _hideUpgradeTooltip: vi.fn(),
      _destroySkillPicker: vi.fn(),
      input: Object.assign(inputEmitter, { keyboard }),
      _onEsc: vi.fn(),
      _onPointerDown: vi.fn(),
      _onPointerMove: vi.fn(),
      _onPointerUp: onPointerUp,
      _onWheelHandler: vi.fn(),
      isMobileInput: false,
      registry: { get: vi.fn((key) => (key === 'audio' ? audio : null)) },
    };

    HomeBaseScene.prototype._onSceneShutdown.call(scene);

    expect(inputEmitter.listenerCount('pointerup')).toBe(0);
    expect(inputEmitter.listenerCount('pointerupoutside')).toBe(0);
  });
});
