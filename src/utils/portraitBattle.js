// Portrait battles (beta) — device-local preference and viewport policy. No Phaser.
//
// The preference only changes how a battle is presented on a phone held upright.
// It never touches campaign state, so it lives in its own localStorage key and does
// not sync through cloud settings: a desktop never needs it, and a phone that
// disables it keeps every save playable in landscape.

import { nativeCapacitor } from './nativeSaveMirror.js';

export const PORTRAIT_BATTLE_STORAGE_KEY = 'emblem_rogue_portrait_battles';
export const PORTRAIT_BATTLE_CLASS = 'portrait-battle';

function storage(env) {
  try {
    return env?.localStorage || null;
  } catch {
    return null;
  }
}

/** Read `?portrait=1|0` (also on|off|true|false). Returns null when absent. */
export function portraitQueryOverride(search = '') {
  const raw = new URLSearchParams(search || '').get('portrait');
  if (raw == null) return null;
  const value = raw.trim().toLowerCase();
  if (['1', 'on', 'true', 'yes'].includes(value)) return true;
  if (['0', 'off', 'false', 'no'].includes(value)) return false;
  return null;
}

export function getPortraitBattlePreference(env = globalThis) {
  try {
    return storage(env)?.getItem(PORTRAIT_BATTLE_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

// Display modes of an installed web app (a browser tab is `browser`). A tab in
// fullscreen may also report `fullscreen`; this page only goes fullscreen through the
// rotate prompt's button, which locks the screen to landscape, so that counts too.
const INSTALLED_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui'];

/**
 * A shell that holds the page in landscape, where an upright battle can never be
 * shown: the iOS app (Capacitor; ios/App/App/Info.plist allows landscape only) and
 * the installed web app (public/manifest.webmanifest asks for landscape). iOS
 * home-screen apps ignore the manifest's orientation, but they are treated the same:
 * the beta is for a browser tab, and one rule for every installed shell keeps it
 * predictable.
 */
export function isLandscapeLockedShell(env = globalThis) {
  if (nativeCapacitor(env)) return true;
  try {
    if (env?.navigator?.standalone === true) return true;
    return INSTALLED_DISPLAY_MODES.some(
      (mode) => env?.matchMedia?.(`(display-mode: ${mode})`)?.matches === true,
    );
  } catch {
    return false;
  }
}

/** Whether this page can offer portrait battles at all (phone checks come on top). */
export function portraitBattlesAvailable(env = globalThis) {
  return !isLandscapeLockedShell(env);
}

/**
 * The preference as it applies on this page. A landscape-locked shell ignores a stored
 * "on" (the installed web app shares its storage with the browser tab that set it, and
 * the tab must keep it), so the shell never suppresses the rotate prompt, rewrites its
 * copy or waits for an upright board that cannot come.
 */
export function portraitBattlesEnabled(env = globalThis) {
  return portraitBattlesAvailable(env) && getPortraitBattlePreference(env);
}

/**
 * Settings shows the toggle on phones, only where it can take effect, and only to a
 * player who opted in with a `?portrait=1` link: while only battles turn upright the
 * beta is not offered to everyone, but a tester can always switch it off again.
 */
export function showPortraitBattleSetting({ mobile, env = globalThis } = {}) {
  return Boolean(mobile) && portraitBattlesAvailable(env) && getPortraitBattlePreference(env);
}

export const PORTRAIT_BATTLE_CHANGE_EVENT = 'emblem-rogue:portrait-battles';

export function setPortraitBattlePreference(enabled, env = globalThis) {
  try {
    const store = storage(env);
    if (!store) return false;
    if (enabled) store.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'on');
    else store.removeItem(PORTRAIT_BATTLE_STORAGE_KEY);
  } catch {
    return false;
  }
  // A live battle follows the change at its next safe moment.
  try {
    env?.dispatchEvent?.(new Event(PORTRAIT_BATTLE_CHANGE_EVENT));
  } catch {
    /* no DOM events (tests) */
  }
  return true;
}

/**
 * Apply a `?portrait=` link once at startup so a phone can opt in (or out) from a
 * shared URL. Returns the resulting preference.
 */
export function applyPortraitQuery(env = globalThis) {
  const override = portraitQueryOverride(env?.location?.search || '');
  if (override !== null) setPortraitBattlePreference(override, env);
  return getPortraitBattlePreference(env);
}

/** Portrait means taller than wide; a square viewport stays landscape. */
export function isPortraitSize(width, height) {
  return Number(height) > Number(width) && Number(width) > 0;
}

export function isPortraitViewport(env = globalThis) {
  const vv = env?.visualViewport;
  const width = Number(env?.innerWidth) || Number(vv?.width) || 0;
  const height = Number(env?.innerHeight) || Number(vv?.height) || 0;
  return isPortraitSize(width, height);
}

/**
 * Should a battle starting (or re-presenting) now be drawn upright? Requires the
 * opt-in, the phone battle layout, and an upright viewport.
 */
export function wantsPortraitBattle({ enabled, phoneLayout, portrait }) {
  return Boolean(enabled && phoneLayout && portrait);
}

/**
 * Whether the battle may re-open in the other orientation right now: only on the
 * player's clean idle boundary of a saved run battle (the same point a refresh would
 * resume), never over a menu, dialogue, animation or pending decision.
 */
export function canSwitchBattlePresentation(state) {
  return Boolean(
    state &&
    state.hasRunCheckpoint &&
    state.boundary === 'destination' &&
    state.phase === 'player' &&
    state.battleState === 'PLAYER_IDLE' &&
    !state.transitioning &&
    !state.modalOpen,
  );
}

export const PORTRAIT_UI_CLASS = 'portrait-ui';
export const PORTRAIT_UI_CHANGE_EVENT = 'emblem-rogue:portrait-ui';

function coarsePointer(env) {
  try {
    return env?.matchMedia?.('(pointer: coarse)')?.matches === true;
  } catch {
    return false;
  }
}

/**
 * Portrait mode is on for this page right now: opted in, a phone browser tab (not a
 * landscape-locked shell) and held upright. Every portrait layout keys off the
 * `portrait-ui` class this sets on <html>; without it the page is the landscape game.
 */
export function portraitUiActive(env = globalThis) {
  return portraitBattlesEnabled(env) && coarsePointer(env) && isPortraitViewport(env);
}

/** Set or clear the class; announces a change with PORTRAIT_UI_CHANGE_EVENT. */
export function syncPortraitUi(env = globalThis) {
  const root = env?.document?.documentElement;
  if (!root?.classList) return false;
  const active = portraitUiActive(env);
  if (root.classList.contains(PORTRAIT_UI_CLASS) !== active) {
    root.classList.toggle(PORTRAIT_UI_CLASS, active);
    const Event = env.CustomEvent || globalThis.CustomEvent;
    if (Event) env.dispatchEvent?.(new Event(PORTRAIT_UI_CHANGE_EVENT, { detail: { active } }));
  }
  return active;
}

/** Keep the class in step with the phone, the preference and the viewport. */
export function installPortraitUi(env = globalThis) {
  const sync = () => syncPortraitUi(env);
  const sources = [
    [env, 'resize'],
    [env, 'orientationchange'],
    [env, PORTRAIT_BATTLE_CHANGE_EVENT],
    [env?.visualViewport, 'resize'],
  ].filter(([target]) => typeof target?.addEventListener === 'function');
  for (const [target, type] of sources) target.addEventListener(type, sync);
  sync();
  return () => {
    for (const [target, type] of sources) target.removeEventListener(type, sync);
  };
}
