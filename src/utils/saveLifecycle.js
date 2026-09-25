// Save on app backgrounding / page teardown.
//
// Almost every change the player expects kept is written synchronously when it
// happens (battle checkpoints after each action, shop/church/forge/reward/roster
// commands, settings and meta). This covers what is left: when the page is
// hidden, torn down or frozen — or the iOS app resigns active / pauses — the
// active scene gets one chance to persist its in-memory state, then pending
// native-mirror writes are dispatched. On iOS a swipe-kill from the app
// switcher always follows backgrounding, so this runs before it.
//
// Flushers must be synchronous and safe at any moment between tasks: a scene
// registers one only for state that is consistent whenever the event loop is
// idle (the route map), never for mid-resolution battle state (the battle is
// already checkpointed after every action).
import { getNativeSaveMirror, hasNativePlugin, nativeCapacitor } from './nativeSaveMirror.js';

const flushers = new Map();
const DUPLICATE_WINDOW_MS = 250;
let lastFlushAt = -Infinity;
let lastFlush = null;

/**
 * Register a synchronous flusher. Returns an unregister function that only
 * removes this exact registration (a newer one under the same id survives).
 */
export function registerSaveFlusher(id, flush) {
  flushers.set(id, flush);
  return () => {
    if (flushers.get(id) === flush) flushers.delete(id);
  };
}

/** Persist everything now. Returns the ids of flushers that ran. */
export function flushSavesNow(reason = 'manual', { now = Date.now() } = {}) {
  // hidden → pagehide → app pause arrive together; one scene flush covers
  // them. A negative gap is a wall clock set back, not a duplicate.
  const sinceLast = now - lastFlushAt;
  const duplicate = reason !== 'manual' && sinceLast >= 0 && sinceLast < DUPLICATE_WINDOW_MS;
  const ran = [];
  if (!duplicate) {
    lastFlushAt = now;
    for (const [id, flush] of [...flushers]) {
      try {
        flush(reason);
        ran.push(id);
      } catch (error) {
        console.warn(`[SaveLifecycle] ${id} flush failed:`, error?.message || error);
      }
    }
  }
  // Always dispatch native writes (cheap when nothing is pending): a save
  // made between two signals of the burst must not wait for a debounce timer
  // that a suspended page never fires.
  try {
    getNativeSaveMirror()?.flush();
  } catch (error) {
    console.warn('[SaveLifecycle] native mirror flush failed:', error?.message || error);
  }
  if (!duplicate) lastFlush = { reason, at: now, ran };
  return ran;
}

export function getLastSaveFlush() {
  return lastFlush;
}

/**
 * Listen for every signal that the page may stop running: visibility hidden,
 * pagehide, Page Lifecycle freeze, and (native) Capacitor App pause /
 * appStateChange(inactive). Returns an uninstall function.
 */
export function installSaveLifecycle({ win = globalThis.window, doc = globalThis.document } = {}) {
  const removers = [];
  const listen = (target, type, handler) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  };
  listen(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'hidden') flushSavesNow('hidden');
  });
  listen(win, 'pagehide', () => flushSavesNow('pagehide'));
  listen(doc, 'freeze', () => flushSavesNow('freeze'));
  const cap = nativeCapacitor(win);
  if (cap && hasNativePlugin(cap, 'App') && typeof cap.addListener === 'function') {
    for (const [event, handler] of [
      ['pause', () => flushSavesNow('app_pause')],
      [
        'appStateChange',
        (state) => {
          if (state && state.isActive === false) flushSavesNow('app_inactive');
        },
      ],
    ]) {
      try {
        const handle = cap.addListener('App', event, handler);
        removers.push(() => handle?.remove?.());
      } catch (error) {
        console.warn('[SaveLifecycle] App listener unavailable:', error?.message || error);
      }
    }
  }
  return () => {
    for (const remove of removers.splice(0)) remove();
  };
}

/** Test hook. */
export function _resetSaveLifecycleForTests() {
  flushers.clear();
  lastFlushAt = -Infinity;
  lastFlush = null;
}
