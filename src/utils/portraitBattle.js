// Portrait battles (beta) — device-local preference and viewport policy. No Phaser.
//
// The preference only changes how a battle is presented on a phone held upright.
// It never touches campaign state, so it lives in its own localStorage key and does
// not sync through cloud settings: a desktop never needs it, and a phone that
// disables it keeps every save playable in landscape.

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

const PROMPT_DEFAULT = '\u21bb Rotate your device to landscape';
const PROMPT_PORTRAIT_ON =
  '\u21bb Rotate to landscape for the map and menus. Battles can be played upright.';

/** Keep the rotate prompt's wording in step with the preference. */
export function syncRotatePromptCopy(env = globalThis) {
  const text = env?.document?.querySelector?.('#rotate-prompt p');
  if (!text) return;
  text.textContent = getPortraitBattlePreference(env) ? PROMPT_PORTRAIT_ON : PROMPT_DEFAULT;
}
