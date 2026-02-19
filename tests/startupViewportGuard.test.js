import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartupViewportGuard } from '../src/utils/startupViewportGuard.js';

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(eventName, handler) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(handler);
    },
    removeEventListener(eventName, handler) {
      const handlers = listeners.get(eventName);
      if (!handlers) return;
      handlers.delete(handler);
      if (handlers.size === 0) listeners.delete(eventName);
    },
    emit(eventName) {
      const handlers = listeners.get(eventName);
      if (!handlers) return;
      [...handlers].forEach((handler) => handler());
    },
    listenerCount(eventName) {
      return listeners.get(eventName)?.size || 0;
    },
  };
}

function createHarness({ enabled = true, timeoutMs = 200 } = {}) {
  const envEvents = createEventTarget();
  const visualViewportEvents = createEventTarget();
  const documentEvents = createEventTarget();

  const wrapper = { style: { width: '', height: '' } };
  const overlay = { style: { display: '' }, hidden: false };
  const activeInput = { tagName: 'INPUT', blur: vi.fn() };

  const documentRef = {
    ...documentEvents,
    hidden: false,
    activeElement: activeInput,
    getElementById: vi.fn((id) => {
      if (id === 'auth-wrapper') return wrapper;
      if (id === 'auth-overlay') return overlay;
      return null;
    }),
  };

  const env = {
    ...envEvents,
    document: documentRef,
    visualViewport: {
      ...visualViewportEvents,
      width: 390,
      height: 844,
      scale: 1,
    },
    innerWidth: 390,
    innerHeight: 844,
    scrollTo: vi.fn(),
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
  };

  const game = {
    scale: {
      refresh: vi.fn(),
    },
  };

  const mark = vi.fn();
  const guard = createStartupViewportGuard({
    enabled,
    timeoutMs,
    env,
    documentRef,
    mark,
    gameGetter: () => game,
  });

  return {
    guard,
    env,
    documentRef,
    wrapper,
    overlay,
    activeInput,
    game,
    mark,
  };
}

describe('startupViewportGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops when disabled', () => {
    const h = createHarness({ enabled: false });
    expect(h.guard.activate('login_submit')).toBe(false);
    expect(h.guard.isActive()).toBe(false);
    expect(h.mark).not.toHaveBeenCalled();
    expect(h.game.scale.refresh).not.toHaveBeenCalled();
  });

  it('reconciles idempotently and tears down listeners on stop', () => {
    const h = createHarness();
    h.guard.activate('login_submit');
    expect(h.guard.isActive()).toBe(true);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(1);
    expect(h.wrapper.style.width).toBe('390px');
    expect(h.wrapper.style.height).toBe('293px');

    h.env.emit('resize');
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(1);

    h.env.visualViewport.width = 844;
    h.env.visualViewport.height = 390;
    h.env.visualViewport.emit('resize');
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(2);

    h.guard.stop('target_reached');
    expect(h.guard.isActive()).toBe(false);
    expect(h.env.listenerCount('resize')).toBe(0);
    expect(h.env.visualViewport.listenerCount('resize')).toBe(0);
    expect(h.documentRef.listenerCount('visibilitychange')).toBe(0);

    const stopMarker = h.mark.mock.calls.find(([name]) => name === 'startup_viewport_guard_stop');
    expect(stopMarker).toBeDefined();
    expect(stopMarker[1]).toMatchObject({
      reason: 'target_reached',
      scaleRefreshCount: 2,
      authResizeCount: 2,
      listenerAttachCount: 6,
      listenerDetachCount: 6,
    });
    expect(stopMarker[1].unchangedViewportCount).toBeGreaterThanOrEqual(1);
  });

  it('blurs focused auth input before boot', () => {
    const h = createHarness();
    h.guard.activate('login_submit');
    h.guard.beforeBootGame();
    expect(h.activeInput.blur).toHaveBeenCalledTimes(1);
  });

  it('auto-stops on startup timeout', () => {
    vi.useFakeTimers();
    const h = createHarness({ timeoutMs: 50 });
    h.guard.activate('session_restore');
    expect(h.guard.isActive()).toBe(true);

    vi.advanceTimersByTime(60);

    expect(h.guard.isActive()).toBe(false);
    const timeoutMarker = h.mark.mock.calls.find(
      ([name]) => name === 'startup_viewport_guard_timeout',
    );
    const stopMarker = h.mark.mock.calls.find(([name]) => name === 'startup_viewport_guard_stop');
    expect(timeoutMarker).toBeDefined();
    expect(stopMarker).toBeDefined();
    expect(stopMarker[1]).toMatchObject({ reason: 'timeout' });
  });
});
