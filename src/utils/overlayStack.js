// overlayStack — per-scene LIFO stack of open modal overlays.
//
// Retires the ESC-ordering bug class: previously each overlay bound its own
// keydown-ESC handler and raced the scene-level handler via consume flags,
// so priority depended on listener registration order and hand-maintained
// guard fields (e.g. _promotionChoicePanelOpen counters). With the stack:
//
//   - Overlays push themselves on open and remove themselves on close.
//   - An overlay's ESC handler acts only when it is top-of-stack
//     (isTopOverlay), making "most recently opened wins" structural.
//   - Scene-level ESC handlers defer entirely while any overlay is open
//     (hasOpenOverlay), so legacy requestCancel chains only run for
//     non-overlay UI.
//
// The stack is keyed by scene instance (WeakMap) and auto-clears on the
// scene's shutdown event — Phaser reuses scene instances across restarts, so
// a leaked entry must never outlive the scene's UI.

const SCENE_OVERLAY_STATE = new WeakMap();
let nextOverlayToken = 1;

function getState(scene) {
  if (!scene || typeof scene !== 'object') return null;
  let state = SCENE_OVERLAY_STATE.get(scene);
  if (!state) {
    state = { entries: [], shutdownHooked: false };
    SCENE_OVERLAY_STATE.set(scene, state);
  }
  return state;
}

function ensureShutdownHook(scene, state) {
  if (state.shutdownHooked) return;
  if (typeof scene?.events?.once !== 'function') return;
  state.shutdownHooked = true;
  try {
    scene.events.once('shutdown', () => {
      state.entries.length = 0;
      state.shutdownHooked = false;
    });
  } catch (_) {
    state.shutdownHooked = false;
  }
}

/**
 * Register an overlay as open. Returns a token to pass to removeOverlay /
 * isTopOverlay, or null when no stack can be attached to the scene.
 * @param {object} scene
 * @param {{ name?: string, onCancel?: function }} entry
 */
export function pushOverlay(scene, { name = 'overlay', onCancel = null } = {}) {
  const state = getState(scene);
  if (!state) return null;
  ensureShutdownHook(scene, state);
  const token = nextOverlayToken++;
  state.entries.push({ token, name, onCancel });
  return token;
}

/** Unregister an overlay (idempotent; tolerates out-of-order close). */
export function removeOverlay(scene, token) {
  if (token == null) return false;
  const state = scene && typeof scene === 'object' ? SCENE_OVERLAY_STATE.get(scene) : null;
  if (!state) return false;
  const idx = state.entries.findIndex((e) => e.token === token);
  if (idx === -1) return false;
  state.entries.splice(idx, 1);
  return true;
}

/** True when the given token is the most recently opened overlay. */
export function isTopOverlay(scene, token) {
  if (token == null) return false;
  const state = scene && typeof scene === 'object' ? SCENE_OVERLAY_STATE.get(scene) : null;
  const top = state?.entries[state.entries.length - 1];
  return Boolean(top && top.token === token);
}

/** True when any overlay is registered for the scene. */
export function hasOpenOverlay(scene) {
  const state = scene && typeof scene === 'object' ? SCENE_OVERLAY_STATE.get(scene) : null;
  return Boolean(state && state.entries.length > 0);
}

/** Name of the top overlay (diagnostics), or null. */
export function getTopOverlayName(scene) {
  const state = scene && typeof scene === 'object' ? SCENE_OVERLAY_STATE.get(scene) : null;
  const top = state?.entries[state.entries.length - 1];
  return top ? top.name : null;
}

/**
 * Ask the top overlay to cancel itself (for callers that route cancel
 * centrally, e.g. mobile back buttons). Returns true when an overlay
 * accepted the cancel. The overlay's onCancel is responsible for closing
 * (which removes it from the stack); a broken handler is force-removed so it
 * can never wedge the stack.
 */
export function cancelTopOverlay(scene, event = null) {
  const state = scene && typeof scene === 'object' ? SCENE_OVERLAY_STATE.get(scene) : null;
  const top = state?.entries[state.entries.length - 1];
  if (!top) return false;
  if (typeof top.onCancel !== 'function') return false;
  try {
    return top.onCancel(event) !== false;
  } catch (err) {
    console.error('[overlayStack] onCancel threw for overlay:', top.name, err);
    removeOverlay(scene, top.token);
    return true;
  }
}

/** Drop every entry for the scene (scene teardown). */
export function clearOverlayStack(scene) {
  const state = scene && typeof scene === 'object' ? SCENE_OVERLAY_STATE.get(scene) : null;
  if (state) state.entries.length = 0;
}
