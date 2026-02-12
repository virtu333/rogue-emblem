import { beforeEach, describe, it, expect, vi } from 'vitest';
import { __resetSceneLoaderForTests, startSceneLazy } from '../src/utils/sceneLoader.js';

function makeScene({ active = true } = {}) {
  const lifecycleOnce = {};
  return {
    sys: {
      isActive: () => active,
    },
    events: {
      once: vi.fn((event, cb) => {
        lifecycleOnce[event] = cb;
      }),
    },
    scene: {
      get: vi.fn(() => ({})),
      start: vi.fn(),
    },
    __emitLifecycle: (event) => {
      const cb = lifecycleOnce[event];
      if (typeof cb === 'function') cb();
    },
  };
}

describe('sceneLoader.startSceneLazy', () => {
  beforeEach(() => {
    __resetSceneLoaderForTests();
  });

  it('starts scene when source scene is active', async () => {
    const scene = makeScene({ active: true });
    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(true);
    expect(scene.scene.start).toHaveBeenCalledWith('Title', { foo: 1 });
  });

  it('does not start scene when source scene is inactive', async () => {
    const scene = makeScene({ active: false });
    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(false);
    expect(scene.scene.start).not.toHaveBeenCalled();
  });

  it('drops duplicate requests while a transition is already in flight', async () => {
    const scene = makeScene({ active: true });
    scene.__startSceneLazyInFlight = true;

    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(false);
    expect(scene.scene.start).not.toHaveBeenCalled();
  });

  it('enforces global in-flight lock across scenes', async () => {
    vi.useFakeTimers();
    try {
      const sceneA = makeScene({ active: true });
      const sceneB = makeScene({ active: true });

      const first = await startSceneLazy(sceneA, 'Title', { from: 'A' });
      const blocked = await startSceneLazy(sceneB, 'HomeBase', { from: 'B' });

      expect(first).toBe(true);
      expect(blocked).toBe(false);
      expect(sceneA.scene.start).toHaveBeenCalledTimes(1);
      expect(sceneB.scene.start).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(800);
      const afterRelease = await startSceneLazy(sceneB, 'HomeBase', { from: 'B' });
      expect(afterRelease).toBe(true);
      expect(sceneB.scene.start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces global cooldown after a successful scene start', async () => {
    vi.useFakeTimers();
    try {
      const scene = makeScene({ active: true });
      const first = await startSceneLazy(scene, 'Title', { t: 1 });
      expect(first).toBe(true);

      // Simulate source scene shutting down quickly, which releases the global lock
      // before cooldown expires.
      scene.__emitLifecycle('shutdown');
      const blockedByCooldown = await startSceneLazy(scene, 'HomeBase', { t: 2 });
      expect(blockedByCooldown).toBe(false);

      await vi.advanceTimersByTimeAsync(360);
      const afterCooldown = await startSceneLazy(scene, 'NodeMap', { t: 3 });
      expect(afterCooldown).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns false when scene start throws', async () => {
    const scene = makeScene({ active: true });
    scene.scene.start.mockImplementation(() => {
      throw new Error('boom');
    });

    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(false);
  });
});
