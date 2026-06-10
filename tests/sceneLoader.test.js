import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  __resetSceneLoaderForTests,
  resetTransitionLocks,
  startSceneLazy,
  startSceneLazyDetailed,
  TRANSITION_REASONS,
  TRANSITION_RESULTS,
} from '../src/utils/sceneLoader.js';

function makeScene({ active = true, key = null } = {}) {
  const lifecycleOnce = {};
  return {
    sys: {
      isActive: () => active,
      settings: { key: key || undefined },
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

describe('sceneLoader.startSceneLazy', () => {
  beforeEach(() => {
    __resetSceneLoaderForTests();
    globalThis.__sceneState = { _pendingTransitionMeta: null };
  });

  afterEach(() => {
    delete globalThis.__sceneState;
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

  // --- Chunk 1: Transition metadata tests ---

  it('TRANSITION_REASONS exports known constants', () => {
    expect(TRANSITION_REASONS.BATTLE_COMPLETE).toBe('battle_complete');
    expect(TRANSITION_REASONS.BOOT).toBe('boot');
    expect(TRANSITION_REASONS.BACK).toBe('back');
  });

  it('propagates reason to _pendingTransitionMeta', async () => {
    const scene = makeScene({ active: true, key: 'NodeMap' });
    await startSceneLazy(scene, 'Title', {}, { reason: TRANSITION_REASONS.BACK });

    const meta = globalThis.__sceneState._pendingTransitionMeta;
    expect(meta).not.toBeNull();
    expect(meta.reason).toBe('back');
    expect(meta.from).toBe('NodeMap');
    expect(meta.to).toBe('Title');
  });

  it('normalizes invalid reason values to null', async () => {
    const scene = makeScene({ active: true, key: 'NodeMap' });
    await startSceneLazy(scene, 'Title', {}, { reason: 'typo_reason' });

    const meta = globalThis.__sceneState._pendingTransitionMeta;
    expect(meta).not.toBeNull();
    expect(meta.reason).toBeNull();
  });

  it('pre-snapshot has numeric sounds and tweens fields', async () => {
    const scene = makeScene({ active: true, key: 'Battle' });
    await startSceneLazy(scene, 'NodeMap', {}, { reason: TRANSITION_REASONS.BATTLE_COMPLETE });

    const meta = globalThis.__sceneState._pendingTransitionMeta;
    expect(meta.pre).toBeDefined();
    expect(typeof meta.pre.sounds).toBe('number');
    expect(typeof meta.pre.tweens).toBe('number');
  });

  it('backward-compatible when options omitted', async () => {
    const scene = makeScene({ active: true });
    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(true);
    const meta = globalThis.__sceneState._pendingTransitionMeta;
    expect(meta.reason).toBeNull();
  });

  it('cleans up meta on cooldown block (no stale meta)', async () => {
    vi.useFakeTimers();
    try {
      const firstReason = TRANSITION_REASONS.BACK;
      const blockedReason = TRANSITION_REASONS.BOOT;
      const scene = makeScene({ active: true, key: 'A' });
      await startSceneLazy(scene, 'Title', {}, { reason: firstReason });
      const firstMeta = globalThis.__sceneState._pendingTransitionMeta;
      expect(firstMeta).not.toBeNull();
      expect(firstMeta.reason).toBe(firstReason);

      // Now try a blocked-by-cooldown transition after shutdown
      scene.__emitLifecycle('shutdown');
      const blocked = await startSceneLazy(scene, 'HomeBase', {}, { reason: blockedReason });
      expect(blocked).toBe(false);
      // Meta should still be from the first successful transition, not overwritten
      // (blocked path returns before writing meta)
      const afterMeta = globalThis.__sceneState._pendingTransitionMeta;
      expect(afterMeta).not.toBeNull();
      expect(afterMeta.reason).toBe(firstReason);
      expect(afterMeta.to).toBe('Title');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up meta when scene start throws', async () => {
    const scene = makeScene({ active: true, key: 'A' });
    scene.scene.start.mockImplementation(() => {
      throw new Error('boom');
    });

    await startSceneLazy(scene, 'Title', {}, { reason: TRANSITION_REASONS.BACK });

    expect(globalThis.__sceneState._pendingTransitionMeta).toBeNull();
  });

  it('cleans up meta when source scene is inactive', async () => {
    const scene = makeScene({ active: false, key: 'A' });

    await startSceneLazy(scene, 'Title', {}, { reason: TRANSITION_REASONS.BACK });

    expect(globalThis.__sceneState._pendingTransitionMeta).toBeNull();
  });

  it('meta token prevents stale merges from different transitions', async () => {
    vi.useFakeTimers();
    try {
      const firstReason = TRANSITION_REASONS.BACK;
      const secondReason = TRANSITION_REASONS.SAVE_EXIT;
      const scene = makeScene({ active: true, key: 'A' });
      await startSceneLazy(scene, 'Title', {}, { reason: firstReason });

      const meta1 = globalThis.__sceneState._pendingTransitionMeta;
      expect(typeof meta1.token).toBe('number');
      expect(meta1.token).toBeGreaterThan(0);
      const token1 = meta1.token;

      // Advance past cooldown + lock
      scene.__emitLifecycle('shutdown');
      await vi.advanceTimersByTimeAsync(800);

      // Second transition produces a different token
      const scene2 = makeScene({ active: true, key: 'Title' });
      await startSceneLazy(scene2, 'HomeBase', {}, { reason: secondReason });

      const meta2 = globalThis.__sceneState._pendingTransitionMeta;
      expect(meta2.token).toBeGreaterThan(0);
      expect(meta2.token).not.toBe(token1);
      expect(meta2.reason).toBe(secondReason);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detailed: reports STARTED on success', async () => {
    const scene = makeScene({ active: true });
    const result = await startSceneLazyDetailed(scene, 'Title', { foo: 1 });

    expect(result.status).toBe(TRANSITION_RESULTS.STARTED);
    expect(scene.scene.start).toHaveBeenCalledTimes(1);
  });

  it('detailed: distinguishes cooldown block from failure', async () => {
    vi.useFakeTimers();
    try {
      const scene = makeScene({ active: true });
      await startSceneLazyDetailed(scene, 'Title', {});
      scene.__emitLifecycle('shutdown'); // releases lock, cooldown still active

      const result = await startSceneLazyDetailed(scene, 'HomeBase', {});
      expect(result.status).toBe(TRANSITION_RESULTS.BLOCKED);
      expect(result.blockReason).toBe('cooldown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('detailed: reports scene and global in-flight blocks', async () => {
    const sceneA = makeScene({ active: true });
    sceneA.__startSceneLazyInFlight = true;
    const ownBlock = await startSceneLazyDetailed(sceneA, 'Title', {});
    expect(ownBlock.status).toBe(TRANSITION_RESULTS.BLOCKED);
    expect(ownBlock.blockReason).toBe('scene_inflight');

    __resetSceneLoaderForTests();
    vi.useFakeTimers();
    try {
      const starter = makeScene({ active: true });
      await startSceneLazyDetailed(starter, 'Title', {});
      // Past the 350ms cooldown but inside the 700ms global lock window.
      await vi.advanceTimersByTimeAsync(400);
      const other = makeScene({ active: true });
      const globalBlock = await startSceneLazyDetailed(other, 'HomeBase', {});
      expect(globalBlock.status).toBe(TRANSITION_RESULTS.BLOCKED);
      expect(globalBlock.blockReason).toBe('global_inflight');
    } finally {
      vi.useRealTimers();
    }
  });

  it('detailed: reports inactive source as BLOCKED, start errors as FAILED', async () => {
    const inactive = makeScene({ active: false });
    const inactiveResult = await startSceneLazyDetailed(inactive, 'Title', {});
    expect(inactiveResult.status).toBe(TRANSITION_RESULTS.BLOCKED);
    expect(inactiveResult.blockReason).toBe('inactive_source');

    __resetSceneLoaderForTests();
    const broken = makeScene({ active: true });
    broken.scene.start.mockImplementation(() => {
      throw new Error('boom');
    });
    const failedResult = await startSceneLazyDetailed(broken, 'Title', {});
    expect(failedResult.status).toBe(TRANSITION_RESULTS.FAILED);
    expect(failedResult.blockReason).toBeUndefined();
  });

  it('resetTransitionLocks clears global lock so a blocked transition can proceed', async () => {
    vi.useFakeTimers();
    try {
      const sceneA = makeScene({ active: true });
      const sceneB = makeScene({ active: true });

      // First transition acquires global lock
      const first = await startSceneLazy(sceneA, 'Title', { from: 'A' });
      expect(first).toBe(true);

      // Second is blocked by the lock
      const blocked = await startSceneLazy(sceneB, 'HomeBase', { from: 'B' });
      expect(blocked).toBe(false);

      // Reset locks (the pattern used by bootTransition)
      resetTransitionLocks(sceneA);

      // Now the transition succeeds without waiting for timeout
      const afterReset = await startSceneLazy(sceneB, 'HomeBase', { from: 'B' });
      expect(afterReset).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
