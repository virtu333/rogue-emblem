// Boot and the packaging gate share the SFX catalog, including deferred loads.
// The coded cues (sfx_miss onward) are synthesized by tools/sfx/build.py.

/** Loaded at boot on every device: the menus' cursor, confirm and cancel blips, and gold. */
export const ESSENTIAL_SFX = ['sfx_cursor', 'sfx_confirm', 'sfx_cancel', 'sfx_gold'];

/** Battle sounds: loaded at boot, or warmed after the title on a reduced preload. */
export const COMBAT_SFX = [
  'sfx_sword',
  'sfx_lance',
  'sfx_axe',
  'sfx_bow',
  'sfx_fire',
  'sfx_thunder',
  'sfx_ice',
  'sfx_light',
  'sfx_dark',
  'sfx_heal',
  'sfx_hit',
  'sfx_crit',
  'sfx_death',
  'sfx_levelup',
  'sfx_miss',
  'sfx_nodamage',
  'sfx_shatter',
  'sfx_steal',
  'sfx_turn',
  'sfx_ward_break',
];

/**
 * Menu and service cues: never waited on at boot. The title's warm-up fetches them
 * (utils/assetWarmup.js); until it has, each plays its fallback below, or nothing.
 */
export const UI_SFX = [
  'sfx_purchase',
  'sfx_equip',
  'sfx_menu_open',
  'sfx_menu_close',
  'sfx_chime',
  'sfx_loot',
  'sfx_page',
];

export const ALL_SFX = Object.freeze([...ESSENTIAL_SFX, ...COMBAT_SFX, ...UI_SFX]);

/**
 * What a cue plays while its own file is not loaded (still warming, or failed): the sound
 * that spot made before the cue existed. A cue with no entry stays silent, as that spot was.
 */
export const SFX_FALLBACKS = Object.freeze({
  sfx_nodamage: 'sfx_hit',
  sfx_shatter: 'sfx_heal',
  sfx_ward_break: 'sfx_crit',
  sfx_steal: 'sfx_confirm',
  sfx_purchase: 'sfx_gold',
  sfx_equip: 'sfx_confirm',
  sfx_chime: 'sfx_heal',
  sfx_loot: 'sfx_confirm',
});

/**
 * Soft cues: a menu's whoosh gives way to any other sound on the same press. It waits for
 * the press's other handlers (a microtask) and stays silent if another sound effect
 * played within SOFT_SFX_YIELD_MS before it or since. Of two soft cues on one press only
 * the higher ranked plays (listed first): a menu replaced by another opens, in either
 * order of the two calls.
 */
export const SOFT_SFX = Object.freeze(['sfx_menu_open', 'sfx_menu_close']);
export const SOFT_SFX_YIELD_MS = 150;

/** The key to play for `key` given what is loaded (`has(key)`), or null for silence. */
export function resolveSfxKey(key, has) {
  if (has(key)) return key;
  const fallback = SFX_FALLBACKS[key];
  return fallback && has(fallback) ? fallback : null;
}

/** A strike's contact sound: armour that turned the blow, a critical, or a plain hit. */
export function strikeContactSfx(event) {
  if (!event || event.miss) return null;
  if (!(event.damage > 0) && !event.stoneBroken && !event.bannerHeld) return 'sfx_nodamage';
  return event.isCrit ? 'sfx_crit' : 'sfx_hit';
}
