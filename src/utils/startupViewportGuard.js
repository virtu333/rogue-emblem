const DEFAULT_TIMEOUT_MS = 14_000;
const TARGET_ASPECT = 640 / 480;
const AUTH_WRAPPER_ID = 'auth-wrapper';
const AUTH_OVERLAY_ID = 'auth-overlay';

function nowMs(env) {
  if (typeof env?.performance?.now === 'function') {
    return env.performance.now();
  }
  return Date.now();
}

function readViewport(env) {
  const visualViewport = env?.visualViewport || null;
  const width = Math.max(
    1,
    Math.round(
      Number.isFinite(visualViewport?.width) ? visualViewport.width : (env?.innerWidth || 0),
    ),
  );
  const height = Math.max(
    1,
    Math.round(
      Number.isFinite(visualViewport?.height) ? visualViewport.height : (env?.innerHeight || 0),
    ),
  );
  const scale = Number.isFinite(visualViewport?.scale)
    ? Math.round(visualViewport.scale * 100) / 100
    : 1;
  return { width, height, scale };
}

function buildViewportKey(viewport) {
  return `${viewport.width}x${viewport.height}@${viewport.scale}`;
}

function shouldBlurElement(el) {
  const tagName = String(el?.tagName || '').toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function isVisible(el) {
  if (!el) return false;
  if (el.hidden) return false;
  if (el.style?.display === 'none') return false;
  return true;
}

function fitToAspect(viewportWidth, viewportHeight, aspect = TARGET_ASPECT) {
  if (!viewportWidth || !viewportHeight) return { width: 1, height: 1 };
  if (viewportWidth / viewportHeight > aspect) {
    const height = Math.max(1, Math.round(viewportHeight));
    return {
      width: Math.max(1, Math.round(height * aspect)),
      height,
    };
  }
  const width = Math.max(1, Math.round(viewportWidth));
  return {
    width,
    height: Math.max(1, Math.round(width / aspect)),
  };
}

function noop() {}

export function createStartupViewportGuard({
  enabled = false,
  env = globalThis,
  documentRef = globalThis?.document || null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  mark = noop,
  gameGetter = () => globalThis?.__emblemRogueGame || null,
} = {}) {
  const state = {
    active: false,
    activationReason: null,
    startedAt: 0,
    timeoutId: null,
    cleanups: [],
    lastViewportKey: '',
    listenerAttachCount: 0,
    listenerDetachCount: 0,
    reconcileCount: 0,
    unchangedViewportCount: 0,
    authResizeCount: 0,
    scaleRefreshCount: 0,
    inputBlurCount: 0,
    lastGameRefreshViewportKey: '',
  };

  function resetCounters() {
    state.listenerAttachCount = 0;
    state.listenerDetachCount = 0;
    state.reconcileCount = 0;
    state.unchangedViewportCount = 0;
    state.authResizeCount = 0;
    state.scaleRefreshCount = 0;
    state.inputBlurCount = 0;
    state.lastGameRefreshViewportKey = '';
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

  function applyAuthWrapperFit(viewport) {
    if (!documentRef?.getElementById) return;
    const overlay = documentRef.getElementById(AUTH_OVERLAY_ID);
    if (!isVisible(overlay)) return;
    const wrapper = documentRef.getElementById(AUTH_WRAPPER_ID);
    if (!wrapper?.style) return;

    const fitted = fitToAspect(viewport.width, viewport.height);
    const width = `${fitted.width}px`;
    const height = `${fitted.height}px`;
    let changed = false;
    if (wrapper.style.width !== width) {
      wrapper.style.width = width;
      changed = true;
    }
    if (wrapper.style.height !== height) {
      wrapper.style.height = height;
      changed = true;
    }
    if (changed) state.authResizeCount += 1;
  }

  function refreshScaleIfAvailable(game, viewportKey) {
    const refreshFn = game?.scale?.refresh;
    if (typeof refreshFn !== 'function') return false;
    refreshFn.call(game.scale);
    state.scaleRefreshCount += 1;
    state.lastGameRefreshViewportKey = viewportKey;
    return true;
  }

  function reconcile(source = 'unknown') {
    if (!state.active) return false;
    state.reconcileCount += 1;

    const viewport = readViewport(env);
    const viewportKey = buildViewportKey(viewport);
    const game = gameGetter();
    const gameScaleReady = typeof game?.scale?.refresh === 'function';
    const needsFirstGameRefresh = gameScaleReady && state.lastGameRefreshViewportKey !== viewportKey;

    if (viewportKey === state.lastViewportKey && !needsFirstGameRefresh) {
      state.unchangedViewportCount += 1;
      return false;
    }
    state.lastViewportKey = viewportKey;

    applyAuthWrapperFit(viewport);
    refreshScaleIfAvailable(game, viewportKey);
    if (typeof env?.scrollTo === 'function') {
      try {
        env.scrollTo(0, 0);
      } catch (_) {
        // Ignore scroll rejections in constrained runtimes.
      }
    }
    return true;
  }

  function clearTimeoutIfSet() {
    if (!state.timeoutId) return;
    const clearTimer = (typeof env?.clearTimeout === 'function') ? env.clearTimeout.bind(env) : clearTimeout;
    clearTimer(state.timeoutId);
    state.timeoutId = null;
  }

  function stop(reason = 'manual_stop') {
    if (!state.active) return false;
    clearTimeoutIfSet();
    while (state.cleanups.length > 0) {
      const cleanup = state.cleanups.pop();
      cleanup();
    }
    state.active = false;
    mark('startup_viewport_guard_stop', {
      reason,
      activationReason: state.activationReason,
      durationMs: Math.max(0, Math.round(nowMs(env) - state.startedAt)),
      listenerAttachCount: state.listenerAttachCount,
      listenerDetachCount: state.listenerDetachCount,
      reconcileCount: state.reconcileCount,
      unchangedViewportCount: state.unchangedViewportCount,
      authResizeCount: state.authResizeCount,
      scaleRefreshCount: state.scaleRefreshCount,
      inputBlurCount: state.inputBlurCount,
    });
    return true;
  }

  function activate(reason = 'unknown') {
    if (!enabled) return false;
    if (state.active) return true;

    resetCounters();
    state.active = true;
    state.activationReason = reason;
    state.startedAt = nowMs(env);
    state.lastViewportKey = '';
    mark('startup_viewport_guard_activate', { reason, timeoutMs });

    const onResize = () => reconcile('window_resize');
    const onOrientation = () => reconcile('orientationchange');
    const onPageShow = () => reconcile('pageshow');
    const onVisibility = () => {
      if (documentRef?.hidden) return;
      reconcile('visibilitychange');
    };
    const onVisualResize = () => reconcile('visual_viewport_resize');
    const onVisualScroll = () => reconcile('visual_viewport_scroll');

    addListener(env, 'resize', onResize);
    addListener(env, 'orientationchange', onOrientation);
    addListener(env, 'pageshow', onPageShow);
    addListener(documentRef, 'visibilitychange', onVisibility);
    addListener(env?.visualViewport, 'resize', onVisualResize);
    addListener(env?.visualViewport, 'scroll', onVisualScroll);

    reconcile('activate');

    const setTimer = (typeof env?.setTimeout === 'function') ? env.setTimeout.bind(env) : setTimeout;
    state.timeoutId = setTimer(() => {
      mark('startup_viewport_guard_timeout', {
        timeoutMs,
        activationReason: state.activationReason,
      });
      stop('timeout');
    }, timeoutMs);
    return true;
  }

  function beforeBootGame() {
    if (!state.active) return false;
    const activeEl = documentRef?.activeElement;
    if (shouldBlurElement(activeEl) && typeof activeEl.blur === 'function') {
      activeEl.blur();
      state.inputBlurCount += 1;
    }
    return reconcile('before_boot_game');
  }

  return {
    activate,
    stop,
    beforeBootGame,
    reconcileNow: (source = 'manual') => reconcile(source),
    isActive: () => state.active,
  };
}
