import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewportReconciler } from '../src/utils/viewportReconciler.js';

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

function createHarness({ enabled = true, hasGame = true } = {}) {
  const envEvents = createEventTarget();
  const visualViewportEvents = createEventTarget();
  const documentEvents = createEventTarget();

  const documentRef = {
    ...documentEvents,
    hidden: false,
  };

  const env = {
    ...envEvents,
    document: documentRef,
    visualViewport: {
      ...visualViewportEvents,
    },
    scrollTo: vi.fn(),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  };

  const game = hasGame
    ? {
        scale: {
          refresh: vi.fn(),
        },
      }
    : null;

  const mark = vi.fn();
  const reconciler = createViewportReconciler({
    enabled,
    env,
    documentRef,
    gameGetter: () => game,
    mark,
  });

  return {
    reconciler,
    env,
    documentRef,
    game,
    mark,
  };
}

describe('viewportReconciler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops when disabled', () => {
    const h = createHarness({ enabled: false });
    expect(h.reconciler.start()).toBe(false);
    expect(h.reconciler.isActive()).toBe(false);
    expect(h.env.listenerCount('resize')).toBe(0);
    expect(h.game.scale.refresh).not.toHaveBeenCalled();
  });

  it('attaches and removes listeners correctly', () => {
    const h = createHarness();
    expect(h.reconciler.start()).toBe(true);

    expect(h.env.listenerCount('resize')).toBe(1);
    expect(h.env.listenerCount('orientationchange')).toBe(1);
    expect(h.env.listenerCount('pageshow')).toBe(1);
    expect(h.documentRef.listenerCount('visibilitychange')).toBe(1);
    expect(h.env.visualViewport.listenerCount('resize')).toBe(1);
    expect(h.env.visualViewport.listenerCount('scroll')).toBe(1);

    h.reconciler.stop('test');
    expect(h.env.listenerCount('resize')).toBe(0);
    expect(h.env.listenerCount('orientationchange')).toBe(0);
    expect(h.env.listenerCount('pageshow')).toBe(0);
    expect(h.documentRef.listenerCount('visibilitychange')).toBe(0);
    expect(h.env.visualViewport.listenerCount('resize')).toBe(0);
    expect(h.env.visualViewport.listenerCount('scroll')).toBe(0);
  });

  it('is event-driven and does not reconcile on start', () => {
    vi.useFakeTimers();
    const h = createHarness();
    h.reconciler.start();

    expect(h.game.scale.refresh).toHaveBeenCalledTimes(0);
    expect(h.env.scrollTo).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(500);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(0);
    expect(h.env.scrollTo).toHaveBeenCalledTimes(0);
  });

  it('calls game.scale.refresh on resize', () => {
    vi.useFakeTimers();
    const h = createHarness();
    h.reconciler.start();
    h.game.scale.refresh.mockClear();
    h.env.scrollTo.mockClear();

    h.env.emit('resize');
    vi.advanceTimersByTime(50);

    expect(h.game.scale.refresh).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid events into one reconcile pass', () => {
    vi.useFakeTimers();
    const h = createHarness();
    h.reconciler.start();
    h.game.scale.refresh.mockClear();

    h.env.emit('resize');
    h.env.emit('orientationchange');
    h.env.emit('pageshow');

    vi.advanceTimersByTime(49);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(1);
  });

  it('runs a delayed re-check after 120ms', () => {
    vi.useFakeTimers();
    const h = createHarness();
    h.reconciler.start();
    h.game.scale.refresh.mockClear();

    h.env.emit('resize');
    vi.advanceTimersByTime(50);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(119);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(2);
  });

  it('calls scrollTo(0, 0) for each reconcile pass', () => {
    vi.useFakeTimers();
    const h = createHarness();
    h.reconciler.start();
    h.env.scrollTo.mockClear();

    h.env.emit('resize');
    vi.advanceTimersByTime(170);

    expect(h.env.scrollTo).toHaveBeenCalledTimes(2);
    expect(h.env.scrollTo).toHaveBeenNthCalledWith(1, 0, 0);
    expect(h.env.scrollTo).toHaveBeenNthCalledWith(2, 0, 0);
  });

  it('handles visibilitychange only when document is visible', () => {
    vi.useFakeTimers();
    const h = createHarness();
    h.reconciler.start();
    h.game.scale.refresh.mockClear();

    h.documentRef.hidden = true;
    h.documentRef.emit('visibilitychange');
    vi.advanceTimersByTime(200);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(0);

    h.documentRef.hidden = false;
    h.documentRef.emit('visibilitychange');
    vi.advanceTimersByTime(50);
    expect(h.game.scale.refresh).toHaveBeenCalledTimes(1);
  });

  it('handles missing game safely', () => {
    vi.useFakeTimers();
    const h = createHarness({ hasGame: false });
    h.reconciler.start();
    h.env.scrollTo.mockClear();

    h.env.emit('resize');
    vi.advanceTimersByTime(170);

    expect(h.env.scrollTo).toHaveBeenCalledTimes(2);
  });
});
