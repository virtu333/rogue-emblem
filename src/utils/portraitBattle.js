// Portrait mode — device-local preference and viewport policy. No Phaser.
//
// The preference only changes how the game is presented on a phone held upright.
// It never touches campaign state, so it lives in its own localStorage key and does
// not sync through cloud settings: a desktop never needs it, and a phone that
// turns it off keeps every save playable in landscape.
//
// Stored values: 'on', 'off', or nothing (the device default: on for a phone, off
// for a tablet or desktop). Only an explicit choice is stored, so a phone that never
// touched the setting follows the default.

import { nativeCapacitor } from './nativeSaveMirror.js';

export const PORTRAIT_BATTLE_STORAGE_KEY = 'emblem_rogue_portrait_battles';
export const PORTRAIT_BATTLE_CLASS = 'portrait-battle';

// A phone's shorter screen side is at most ~440 CSS px (iPhone Pro Max 430, large
// Androids ~412-450); the smallest tablets start near 600 (iPad mini 744).
export const PHONE_MAX_SHORT_SIDE = 600;

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

function coarsePointer(env) {
  try {
    return env?.matchMedia?.('(pointer: coarse)')?.matches === true;
  } catch {
    return false;
  }
}

/**
 * A phone-sized screen: its shorter side is under PHONE_MAX_SHORT_SIDE CSS px. Reads
 * the device screen (which does not change as the page turns), falling back to the
 * viewport.
 */
export function isPhoneSized(env = globalThis) {
  let width = 0;
  let height = 0;
  try {
    width = Number(env?.screen?.width) || 0;
    height = Number(env?.screen?.height) || 0;
  } catch {
    /* no screen */
  }
  if (!(width > 0 && height > 0)) {
    width = Number(env?.innerWidth) || 0;
    height = Number(env?.innerHeight) || 0;
  }
  const short = Math.min(width, height);
  return short > 0 && short < PHONE_MAX_SHORT_SIDE;
}

/** Portrait mode's default on this device: on for a touch phone, off elsewhere. */
export function portraitDefault(env = globalThis) {
  return coarsePointer(env) && isPhoneSized(env);
}

/** The stored choice: true ('on'), false ('off') or null (none: the default applies). */
export function storedPortraitChoice(env = globalThis) {
  try {
    const value = storage(env)?.getItem(PORTRAIT_BATTLE_STORAGE_KEY);
    if (value === 'on') return true;
    if (value === 'off') return false;
    return null;
  } catch {
    return null;
  }
}

/** The player's choice, or the device default when they never made one. */
export function getPortraitBattlePreference(env = globalThis) {
  const stored = storedPortraitChoice(env);
  return stored ?? portraitDefault(env);
}

/**
 * A shell that holds the page in landscape, where an upright screen can never be
 * shown: the iOS app on an iPad. ios/App/App/Info.plist lets the iPhone app turn
 * upright but keeps UISupportedInterfaceOrientations~ipad landscape-only (the upright
 * layouts are built for phone widths). The installed web app is not locked: its
 * manifest asks for any orientation.
 */
export function isLandscapeLockedShell(env = globalThis) {
  return Boolean(nativeCapacitor(env)) && !isPhoneSized(env);
}

/** Whether this page can offer portrait mode at all (phone checks come on top). */
export function portraitBattlesAvailable(env = globalThis) {
  return !isLandscapeLockedShell(env);
}

/**
 * The preference as it applies on this page. A landscape-locked shell ignores a stored
 * "on" without clearing it, so the shell never suppresses the rotate prompt, rewrites
 * its copy or waits for an upright board that cannot come.
 */
export function portraitBattlesEnabled(env = globalThis) {
  return portraitBattlesAvailable(env) && getPortraitBattlePreference(env);
}

/**
 * Settings offers the toggle on every touch device where it can take effect (phones
 * and tablets in a browser or the iPhone app; not the iPad app, which stays in
 * landscape). A desktop never shows it: the upright layouts need a touch screen.
 */
export function showPortraitBattleSetting({ mobile, env = globalThis } = {}) {
  return Boolean(mobile) && portraitBattlesAvailable(env);
}

export const PORTRAIT_BATTLE_CHANGE_EVENT = 'emblem-rogue:portrait-battles';

export function setPortraitBattlePreference(enabled, env = globalThis) {
  try {
    const store = storage(env);
    if (!store) return false;
    store.setItem(PORTRAIT_BATTLE_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    return false;
  }
  // A page the rotate prompt's "Use landscape" button locked sideways can turn again.
  if (enabled) {
    try {
      env?.screen?.orientation?.unlock?.();
    } catch {
      /* not locked, or no Screen Orientation API */
    }
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
 * Apply a `?portrait=` link once at startup: `?portrait=0` is the escape hatch that
 * turns portrait mode off on this device (and `?portrait=1` turns it on). The choice
 * is stored, so it outlives the link. Returns the resulting preference.
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
 * Should a battle starting (or re-presenting) now be drawn upright? Requires portrait
 * mode, the phone battle layout, and an upright viewport.
 */
export function wantsPortraitBattle({ enabled, phoneLayout, portrait }) {
  return Boolean(enabled && phoneLayout && portrait);
}

/**
 * Whether the battle may re-open in the other orientation right now: only on the
 * player's clean idle boundary of a saved run battle (the same point a refresh would
 * resume), never over a menu, dialogue, animation or pending decision, and never
 * while a finger (or button) is still down on the board.
 */
export function canSwitchBattlePresentation(state) {
  return Boolean(
    state &&
    state.hasRunCheckpoint &&
    state.boundary === 'destination' &&
    state.phase === 'player' &&
    state.battleState === 'PLAYER_IDLE' &&
    !state.transitioning &&
    !state.modalOpen &&
    !state.gestureActive,
  );
}

export const PORTRAIT_UI_CLASS = 'portrait-ui';
export const PORTRAIT_UI_CHANGE_EVENT = 'emblem-rogue:portrait-ui';

/**
 * Portrait mode is on for this page right now: the preference (a phone's default, or
 * the player's choice), a touch screen that is not a landscape-locked shell, and held
 * upright. Every portrait layout keys off the
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
