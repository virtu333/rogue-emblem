// haptics — one call for a touch of feedback: haptic('tick' | 'light' | 'medium' | 'heavy' | 'success').
//
// Native app: the Capacitor Haptics plugin when the shell has registered it
// (`globalThis.Capacitor.Plugins.Haptics`; @capacitor/haptics is not a dependency, so this
// only uses it when it is there). Browser: navigator.vibrate with short patterns. Neither:
// nothing happens. Never throws, never touches Math.random, never reads game state.
//
// The player's switch is Settings -> Vibration (SettingsManager `vibration`, on by
// default). bindHapticSettings(settings) keeps this module's flag in step with it, so a
// caller never passes the setting around; the menu only shows the switch where
// hapticsSupported() is true.

export const HAPTIC_KINDS = Object.freeze(['tick', 'light', 'medium', 'heavy', 'success']);

/** navigator.vibrate patterns, in milliseconds. */
export const VIBRATE_PATTERNS = Object.freeze({
  tick: 5,
  light: 10,
  medium: 20,
  heavy: 35,
  success: Object.freeze([15, 40, 15]),
});

/** A tick (a cursor step) fires at most this often. */
export const TICK_MIN_INTERVAL_MS = 40;

let enabled = true;
let lastTickAt = -Infinity;
let unbindSettings = null;

function now() {
  const t = globalThis.performance?.now?.();
  return Number.isFinite(t) ? t : Date.now();
}

function capacitorHaptics() {
  try {
    const plugin = globalThis.Capacitor?.Plugins?.Haptics;
    return plugin && typeof plugin === 'object' ? plugin : null;
  } catch {
    return null;
  }
}

function canVibrate() {
  try {
    const nav = globalThis.navigator;
    // A desktop browser defines vibrate() with nothing behind it; a touch screen is the
    // sign there is a motor to drive.
    return typeof nav?.vibrate === 'function' && Number(nav.maxTouchPoints) > 0;
  } catch {
    return false;
  }
}

/** Can this device give haptic feedback at all (the Vibration setting is shown only if so). */
export function hapticsSupported() {
  return capacitorHaptics() !== null || canVibrate();
}

export function setHapticsEnabled(value) {
  enabled = value !== false;
}

export function hapticsEnabled() {
  return enabled;
}

/**
 * Follow `settings.getVibration()` (and its changes) from now on. Returns the unsubscribe;
 * binding again replaces the earlier subscription.
 */
export function bindHapticSettings(settings) {
  unbindSettings?.();
  unbindSettings = null;
  if (!settings) return () => {};
  const read = () => setHapticsEnabled(settings.getVibration?.() !== false);
  read();
  const off = settings.onChange?.(read);
  unbindSettings = () => {
    if (typeof off === 'function') off();
  };
  return unbindSettings;
}

function swallow(result) {
  // A plugin call may hand back a promise that rejects (a device without a motor).
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

function viaCapacitor(plugin, kind) {
  if (kind === 'tick') {
    swallow(plugin.selectionChanged?.());
  } else if (kind === 'success') {
    swallow(plugin.notification?.({ type: 'SUCCESS' }));
  } else {
    const style = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' }[kind];
    swallow(plugin.impact?.({ style }));
  }
}

/**
 * Give one haptic. Does nothing when the setting is off, the kind is unknown, a tick
 * comes within TICK_MIN_INTERVAL_MS of the last one, or the device has no haptics.
 */
export function haptic(kind) {
  try {
    if (!enabled || !HAPTIC_KINDS.includes(kind)) return;
    if (kind === 'tick') {
      const t = now();
      if (t - lastTickAt < TICK_MIN_INTERVAL_MS) return;
      lastTickAt = t;
    }
    const plugin = capacitorHaptics();
    if (plugin) {
      viaCapacitor(plugin, kind);
      return;
    }
    if (canVibrate()) {
      const pattern = VIBRATE_PATTERNS[kind];
      globalThis.navigator.vibrate(Array.isArray(pattern) ? [...pattern] : pattern);
    }
  } catch {
    /* feedback is never worth an error */
  }
}

/** Test seam: back to the defaults (on, no tick history, no settings bound). */
export function resetHapticsForTests() {
  unbindSettings?.();
  unbindSettings = null;
  enabled = true;
  lastTickAt = -Infinity;
}
