import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { __resetSceneLoaderForTests, startSceneLazy, TRANSITION_REASONS } from '../src/utils/sceneLoader.js';

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
    scene.scene.start.mockImplementation(() => { throw new Error('boom'); });

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
});
