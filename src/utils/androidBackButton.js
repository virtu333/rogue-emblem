// The Android system Back button / gesture in the packaged (Capacitor) app.
//
// Capacitor's default Back navigates the WebView's history and, with none, closes
// the app, which would drop a player out of a battle mid-turn. Registering an App
// `backButton` listener replaces that default. Back becomes the game's own Cancel
// action on the input bus, the same one the gamepad's B button sends, so whatever
// holds input focus (a scene, an overlay, a menu) handles it as it already does.
// The one exception is the title screen's root menu, which has nothing to go back
// to: there Back sends the app to the background, as Android apps do, without
// ending it (the save lifecycle flushes on the pause that follows).
//
// The web game, the iOS app and the PWA never install it (no Android bridge).

import { hasNativePlugin, nativeCapacitor } from './nativeSaveMirror.js';
import { InputAction } from './InputActions.js';
import { activeInputOwner } from './inputFocus.js';

/** The Capacitor bridge when running in the Android app with the App plugin, else null. */
export function androidCapacitor(win = globalThis) {
  const cap = nativeCapacitor(win);
  if (!cap) return null;
  try {
    if (cap.getPlatform?.() !== 'android') return null;
  } catch {
    return null;
  }
  if (!hasNativePlugin(cap, 'App') || typeof cap.addListener !== 'function') return null;
  return cap;
}

/**
 * What Back does now: 'minimize' at the title's root menu, else 'cancel'.
 * A focus owner opts into the first by exposing `isAtRootMenu()`.
 */
export function backButtonOutcome(owner = activeInputOwner()) {
  try {
    if (typeof owner?.isAtRootMenu === 'function' && owner.isAtRootMenu() === true) {
      return 'minimize';
    }
  } catch {
    // fall through: Cancel never leaves the app
  }
  return 'cancel';
}

/**
 * Listen for Back in the Android app. `dispatch(action)` puts an InputAction on the
 * game's input bus. Returns an uninstall function (a no-op off Android).
 */
export function installAndroidBackButton({
  win = globalThis.window,
  dispatch,
  getOwner = activeInputOwner,
} = {}) {
  const cap = androidCapacitor(win);
  if (!cap || typeof dispatch !== 'function') return () => {};
  const onBack = () => {
    if (backButtonOutcome(getOwner()) === 'minimize') {
      Promise.resolve()
        .then(() => cap.nativePromise('App', 'minimizeApp', {}))
        .catch((error) => console.warn('[AndroidBack] minimize failed:', error?.message || error));
      return;
    }
    dispatch(InputAction.CANCEL);
  };
  let handle = null;
  try {
    handle = cap.addListener('App', 'backButton', onBack);
  } catch (error) {
    console.warn('[AndroidBack] backButton listener unavailable:', error?.message || error);
    return () => {};
  }
  return () => {
    Promise.resolve(handle)
      .then((h) => h?.remove?.())
      .catch(() => {});
  };
}
