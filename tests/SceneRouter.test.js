import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  transitionToScene,
  restartScene,
  sleepScene,
  wakeScene,
  TRANSITION_REASONS,
} from '../src/utils/SceneRouter.js';
import { __resetSceneLoaderForTests } from '../src/utils/sceneLoader.js';

function makeScene({ active = true, key = 'TestScene' } = {}) {
  const lifecycleOnce = {};
  return {
    sys: {
      isActive: () => active,
      settings: { key },
    },
    events: {
      once: vi.fn((event, cb) => {
        lifecycleOnce[event] = cb;
      }),
    },
    scene: {
      get: vi.fn(() => ({})),
      start: vi.fn(),
      restart: vi.fn(),
      sleep: vi.fn(),
      wake: vi.fn(),
    },
    game: {
      sound: { sounds: [] },
    },
    tweens: { getTweens: () => [] },
    __emitLifecycle: (event) => {
      const cb = lifecycleOnce[event];
      if (typeof cb === 'function') cb();
    },
  };
}

describe('SceneRouter', () => {
  beforeEach(() => {
    __resetSceneLoaderForTests();
    globalThis.__sceneState = { _pendingTransitionMeta: null };
  });

  afterEach(() => {
    delete globalThis.__sceneState;
  });

  it('transitionToScene delegates to sceneLoader with reason metadata', async () => {
    const scene = makeScene({ active: true, key: 'Title' });

    const ok = await transitionToScene(scene, 'SlotPicker', { gameData: {} }, { reason: TRANSITION_REASONS.CONTINUE });

    expect(ok).toBe(true);
    expect(scene.scene.start).toHaveBeenCalledWith('SlotPicker', { gameData: {} });
    expect(globalThis.__sceneState._pendingTransitionMeta?.reason).toBe(TRANSITION_REASONS.CONTINUE);
  });

  it('transitionToScene returns false when source scene is inactive', async () => {
    const scene = makeScene({ active: false, key: 'Title' });

    const ok = await transitionToScene(scene, 'SlotPicker', { gameData: {} }, { reason: TRANSITION_REASONS.CONTINUE });

    expect(ok).toBe(false);
    expect(scene.scene.start).not.toHaveBeenCalled();
  });

  it('transitionToScene returns false and clears metadata when scene start throws', async () => {
    const scene = makeScene({ active: true, key: 'Title' });
    scene.scene.start.mockImplementation(() => {
      throw new Error('boom');
    });

    const ok = await transitionToScene(scene, 'SlotPicker', { gameData: {} }, { reason: TRANSITION_REASONS.CONTINUE });

    expect(ok).toBe(false);
    expect(globalThis.__sceneState._pendingTransitionMeta).toBeNull();
  });

  it('restartScene writes transition metadata and restarts current scene', () => {
    const scene = makeScene({ key: 'Boot' });

    const ok = restartScene(scene, { hardReload: true }, { reason: TRANSITION_REASONS.RETRY });

    expect(ok).toBe(true);
    expect(scene.scene.restart).toHaveBeenCalledWith({ hardReload: true });
    const meta = globalThis.__sceneState._pendingTransitionMeta;
    expect(meta).toBeTruthy();
    expect(meta.reason).toBe(TRANSITION_REASONS.RETRY);
    expect(meta.from).toBe('Boot');
    expect(meta.to).toBe('Boot');
    expect(typeof meta.pre?.sounds).toBe('number');
    expect(typeof meta.pre?.tweens).toBe('number');
  });

  it('restartScene normalizes unknown reason values to null metadata reason', () => {
    const scene = makeScene({ key: 'Boot' });

    const ok = restartScene(scene, { hardReload: true }, { reason: 'typo_reason' });

    expect(ok).toBe(true);
    expect(globalThis.__sceneState._pendingTransitionMeta?.reason).toBeNull();
  });

  it('restartScene clears metadata on restart failure', () => {
    const scene = makeScene({ key: 'Boot' });
    scene.scene.restart.mockImplementation(() => {
      throw new Error('boom');
    });

    const ok = restartScene(scene, undefined, { reason: TRANSITION_REASONS.RETRY });

    expect(ok).toBe(false);
    expect(globalThis.__sceneState._pendingTransitionMeta).toBeNull();
  });

  it('sleepScene sleeps a target scene key and current scene key', () => {
    const scene = makeScene({ key: 'NodeMap' });

    expect(sleepScene(scene, 'Battle')).toBe(true);
    expect(scene.scene.sleep).toHaveBeenCalledWith('Battle');

    scene.scene.sleep.mockClear();
    expect(sleepScene(scene)).toBe(true);
    expect(scene.scene.sleep).toHaveBeenCalledWith();
  });

  it('sleepScene returns false when scene sleep throws', () => {
    const scene = makeScene({ key: 'NodeMap' });
    scene.scene.sleep.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(sleepScene(scene, 'Battle')).toBe(false);
  });

  it('wakeScene wakes a target scene key with optional data', () => {
    const scene = makeScene({ key: 'NodeMap' });

    expect(wakeScene(scene, 'Battle', { resume: true })).toBe(true);
    expect(scene.scene.wake).toHaveBeenCalledWith('Battle', { resume: true });
  });

  it('wakeScene returns false when key is missing or wake throws', () => {
    const scene = makeScene({ key: 'NodeMap' });
    expect(wakeScene(scene)).toBe(false);

    scene.scene.wake.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(wakeScene(scene, 'Battle')).toBe(false);
  });
});
