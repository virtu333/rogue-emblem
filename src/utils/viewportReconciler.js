const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_DELAYED_RECHECK_MS = 120;

function noop() {}

function normalizeDelay(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

export function createViewportReconciler({
  enabled = false,
  env = globalThis,
  documentRef = globalThis?.document || null,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  delayedRecheckMs = DEFAULT_DELAYED_RECHECK_MS,
  gameGetter = () => globalThis?.__emblemRogueGame || null,
  mark = noop,
} = {}) {
  const debounceDelayMs = normalizeDelay(debounceMs, DEFAULT_DEBOUNCE_MS);
  const delayedDelayMs = normalizeDelay(delayedRecheckMs, DEFAULT_DELAYED_RECHECK_MS);

  const setTimer = typeof env?.setTimeout === 'function' ? env.setTimeout.bind(env) : setTimeout;
  const clearTimer =
    typeof env?.clearTimeout === 'function' ? env.clearTimeout.bind(env) : clearTimeout;

  const state = {
    active: false,
    cleanups: [],
    debounceTimer: null,
    delayedTimer: null,
    listenerAttachCount: 0,
    listenerDetachCount: 0,
    reconcileCount: 0,
    scaleRefreshCount: 0,
    scrollResetCount: 0,
  };

  function clearTimerIfSet(key) {
    const timer = state[key];
    if (!timer) return;
    clearTimer(timer);
    state[key] = null;
  }

  function clearTimers() {
    clearTimerIfSet('debounceTimer');
    clearTimerIfSet('delayedTimer');
  }

  function addListener(target, eventName, handler) {
    if (typeof target?.addEventListener !== 'function') return;
    target.addEventListener(eventName, handler);
    state.listenerAttachCount += 1;
    state.cleanups.push(() => {
      target.removeEventListener(eventName, handler);
      state.listenerDetachCount += 1;
    });
  }

  function resetWindowScroll() {
    if (typeof env?.scrollTo !== 'function') return;
    try {
      env.scrollTo(0, 0);
      state.scrollResetCount += 1;
    } catch {
      // Ignore scroll rejections in constrained runtimes.
    }
  }

  function refreshGameScale() {
    const game = gameGetter();
    const refreshFn = game?.scale?.refresh;
    if (typeof refreshFn !== 'function') return false;
    refreshFn.call(game.scale);
    state.scaleRefreshCount += 1;
    return true;
  }

  function reconcile(source = 'unknown') {
    if (!state.active) return false;
    state.reconcileCount += 1;
    resetWindowScroll();
    try {
      refreshGameScale();
    } catch (err) {
      mark('viewport_reconciler_refresh_error', {
        source,
        message: err?.message || String(err || 'unknown'),
      });
      return false;
    }
    return true;
  }

  function scheduleDelayedRecheck(source) {
    clearTimerIfSet('delayedTimer');
    state.delayedTimer = setTimer(() => {
      state.delayedTimer = null;
      reconcile(`${source}_delayed`);
    }, delayedDelayMs);
  }

  function queueReconcile(source) {
    if (!state.active) return false;
    clearTimerIfSet('debounceTimer');
    state.debounceTimer = setTimer(() => {
      state.debounceTimer = null;
      reconcile(source);
      scheduleDelayedRecheck(source);
    }, debounceDelayMs);
    return true;
  }

  function start() {
    if (!enabled) return false;
    if (state.active) return true;
    state.active = true;
    mark('viewport_reconciler_start', {
      debounceMs: debounceDelayMs,
      delayedRecheckMs: delayedDelayMs,
    });

    addListener(env, 'resize', () => queueReconcile('window_resize'));
    addListener(env, 'orientationchange', () => queueReconcile('orientationchange'));
    addListener(env, 'pageshow', () => queueReconcile('pageshow'));
    addListener(documentRef, 'visibilitychange', () => {
      if (documentRef?.hidden) return;
      queueReconcile('visibilitychange');
    });
    addListener(env?.visualViewport, 'resize', () => queueReconcile('visual_viewport_resize'));
    addListener(env?.visualViewport, 'scroll', () => queueReconcile('visual_viewport_scroll'));
    return true;
  }

  function stop(reason = 'manual_stop') {
    if (!state.active) return false;
    clearTimers();
    while (state.cleanups.length > 0) {
      const cleanup = state.cleanups.pop();
      cleanup();
    }
    state.active = false;
    mark('viewport_reconciler_stop', {
      reason,
      listenerAttachCount: state.listenerAttachCount,
      listenerDetachCount: state.listenerDetachCount,
      reconcileCount: state.reconcileCount,
      scaleRefreshCount: state.scaleRefreshCount,
      scrollResetCount: state.scrollResetCount,
    });
    return true;
  }

  function reconcileNow(source = 'manual') {
    if (!state.active) return false;
    clearTimerIfSet('debounceTimer');
    const didReconcile = reconcile(source);
    scheduleDelayedRecheck(source);
    return didReconcile;
  }

  return {
    start,
    stop,
    isActive: () => state.active,
    reconcileNow,
  };
}
