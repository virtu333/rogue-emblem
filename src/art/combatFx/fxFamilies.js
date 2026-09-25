// fxFamilies — the one table that maps weapons, statuses, terrain and units to combat
// effect families (pure, no Phaser). Everything the choreography draws is chosen here,
// never by scattered conditionals: add a weapon to data/weapons.json and it picks its
// family from its type, then its name, then its lore.
import { MOTE_COLORS } from './fxPalette.js';

/**
 * Effect families. `impact` plays on the target at contact; `projectile` (optional)
 * travels from striker to target first:
 *   kind 'arc'    ballistic arc (height reads the distance); `spin` rotates frames
 *   kind 'line'   straight flight
 *   kind 'bolt'   jagged bolt segments chained caster -> target (thunder)
 *   kind 'motes'  a stream of pooled motes (healing, holy light)
 *   kind 'stream' puffs rolling out of the mouth (breath)
 * `light` tints the transient impact glow on night maps ('unlight' darkens instead).
 */
export const FX_FAMILIES = Object.freeze({
  sword: { impact: 'fx_slash', ghost: MOTE_COLORS.steel },
  axe: { impact: 'fx_chop', heavy: true, ghost: MOTE_COLORS.crimson },
  lance: { impact: 'fx_thrust', extra: 'fx_shock_small', ghost: MOTE_COLORS.steel },
  bow: {
    impact: 'fx_arrow',
    projectile: { key: 'fx_proj_arrow', kind: 'arc', arc: 1, trail: MOTE_COLORS.pale },
  },
  thrownLance: {
    impact: 'fx_thrust',
    projectile: { key: 'fx_proj_javelin', kind: 'arc', arc: 0.75 },
  },
  thrownAxe: {
    impact: 'fx_chop',
    heavy: true,
    projectile: { key: 'fx_proj_axe', kind: 'arc', arc: 0.85, spin: true },
  },
  bladeWave: {
    impact: 'fx_slash',
    projectile: { key: 'fx_proj_blade', kind: 'line', trail: MOTE_COLORS.steel },
  },
  fire: {
    impact: 'fx_magic',
    magic: true,
    light: MOTE_COLORS.emberMid,
    projectile: { key: 'fx_proj_fire', kind: 'arc', arc: 0.35, trail: MOTE_COLORS.ember },
  },
  thunder: {
    impact: 'fx_thunder',
    magic: true,
    light: MOTE_COLORS.emberHot,
    projectile: { key: 'fx_bolt_seg', kind: 'bolt' },
  },
  wind: {
    impact: 'fx_wind',
    magic: true,
    projectile: { key: 'fx_proj_wind', kind: 'line', trail: MOTE_COLORS.verdigrisPale },
  },
  light: {
    impact: 'fx_light',
    magic: true,
    light: MOTE_COLORS.gilt,
    projectile: { key: 'fx_proj_light', kind: 'line', trail: MOTE_COLORS.ember },
  },
  dark: {
    impact: 'fx_dark',
    magic: true,
    light: 'unlight',
    projectile: { key: 'fx_proj_dark', kind: 'line', slow: true, trail: MOTE_COLORS.violetDim },
  },
  breath: {
    impact: 'fx_breath',
    magic: true,
    light: MOTE_COLORS.emberMid,
    projectile: { key: 'fx_proj_breath', kind: 'stream' },
  },
  breathToxic: {
    impact: 'fx_breath_toxic',
    magic: true,
    projectile: { key: 'fx_proj_breath_toxic', kind: 'stream' },
  },
  breathAncient: {
    impact: 'fx_breath_ancient',
    magic: true,
    projectile: { key: 'fx_proj_breath_ancient', kind: 'stream' },
  },
  staff: {
    impact: 'fx_heal',
    magic: true,
    projectile: { key: 'fx_mote', kind: 'motes', mote: MOTE_COLORS.verdigrisPale },
  },
  ballista: {
    impact: 'fx_arrow',
    heavy: true,
    projectile: { key: 'fx_proj_bolt', kind: 'line', trail: MOTE_COLORS.pale },
  },
});

/**
 * Weapon -> family rules, in priority order:
 *   byName     exact weapon names (legendaries and oddities); an object picks by
 *              melee/ranged distance
 *   elements   name (then lore) patterns for elemental weapon types
 *   byType     the weapon type's default; `ranged` applies at distance >= 2
 */
export const WEAPON_FX_RULES = Object.freeze({
  byName: {
    Excalibur: 'wind',
    Bolting: 'thunder',
    'Twisting Vortex': 'dark',
    'Eldritch Grasp': 'dark',
    'Levin Sword': { melee: 'sword', ranged: 'thunder' },
    'Wind Sword': { melee: 'sword', ranged: 'wind' },
    'Tempest Blade': { melee: 'sword', ranged: 'wind' },
    'Fire Breath': 'breath',
    'Toxic Breath': 'breathToxic',
    'Ancient Breath': 'breathAncient',
  },
  // Only these types read an element from the weapon's words.
  elementTypes: ['Tome', 'Breath', 'Scroll'],
  elements: [
    ['thunder', /\b(thunder|bolt\w*|lightning|levin|storm|spark)\b/i],
    ['wind', /\b(wind|gale|gust|cyclone|tempest|excalibur)\b/i],
    ['dark', /\b(dark|vortex|flux|nosferatu|ruin|unlight|shadow|stillness)\b/i],
    ['fire', /\b(fire|elfire|bolganone|flame|blaze|burn\w*|witchfire|ember)\b/i],
    ['light', /\b(light|shine|aura|holy|sun\w*|luce)\b/i],
  ],
  byType: {
    Sword: { melee: 'sword', ranged: 'bladeWave' },
    Axe: { melee: 'axe', ranged: 'thrownAxe' },
    Lance: { melee: 'lance', ranged: 'thrownLance' },
    Bow: 'bow',
    Tome: 'fire',
    Light: 'light',
    Breath: 'breath',
    Staff: 'staff',
    Scroll: 'fire',
  },
});

function pickRange(rule, distance) {
  if (!rule || typeof rule === 'string') return rule || null;
  return distance >= 2 ? rule.ranged || rule.melee : rule.melee || rule.ranged;
}

/**
 * Family id for a strike.
 * @param {object|null} weapon  a weapons.json entry (name, type, lore)
 * @param {{ distance?: number, entity?: boolean }} ctx
 */
export function fxFamilyIdForWeapon(weapon, { distance = 1, entity = false } = {}) {
  if (entity) return 'dark';
  if (!weapon) return 'sword';
  const byName = WEAPON_FX_RULES.byName[weapon.name];
  if (byName) return pickRange(byName, distance);
  if (WEAPON_FX_RULES.elementTypes.includes(weapon.type)) {
    for (const source of [weapon.name, weapon.lore]) {
      if (!source) continue;
      for (const [family, pattern] of WEAPON_FX_RULES.elements) {
        if (pattern.test(source)) return family;
      }
    }
  }
  return pickRange(WEAPON_FX_RULES.byType[weapon.type], distance) || 'sword';
}

export function fxFamily(id) {
  return FX_FAMILIES[id] || FX_FAMILIES.sword;
}

/** Status condition -> overlay (unknown conditions get the generic ailment swirl). */
export const STATUS_FX = Object.freeze({
  sleep: 'fx_status_sleep',
  silence: 'fx_status_silence',
  acid: 'fx_status_acid',
  poison: 'fx_status_acid',
  root: 'fx_status_root',
});

export function statusFxKey(conditionId) {
  return STATUS_FX[conditionId] || 'fx_status';
}

/** Ground reaction under a knocked-back unit: terrain first, then the biome's ground. */
export const DUST_BY_TERRAIN = Object.freeze({
  Water: 'fx_dust_splash',
  Swamp: 'fx_dust_mire',
  Bog: 'fx_dust_mire',
  'Acidic Swamp': 'fx_dust_mire',
  'Acidic Bog': 'fx_dust_mire',
  Ice: 'fx_dust_snow',
  Sand: 'fx_dust_sand',
  'Lava Crack': 'fx_dust_sparks',
  Mountain: 'fx_dust_stone',
  Wall: 'fx_dust_stone',
  Floor: 'fx_dust_stone',
  Pillar: 'fx_dust_stone',
  Throne: 'fx_dust_stone',
  Fort: 'fx_dust_stone',
  Forest: 'fx_dust_leaves',
});

export const DUST_BY_BIOME = Object.freeze({
  tundra: 'fx_dust_snow',
  snow: 'fx_dust_snow',
  volcano: 'fx_dust_ash',
  volcanic: 'fx_dust_ash',
  void: 'fx_dust_ash',
  castle: 'fx_dust_stone',
  swamp: 'fx_dust',
});

export function dustKeyFor(terrainName, biome) {
  const byTerrain = DUST_BY_TERRAIN[terrainName];
  // Forest on snow or ash is still that biome's ground, not leaf litter.
  if (byTerrain && !(terrainName === 'Forest' && DUST_BY_BIOME[biome])) return byTerrain;
  return DUST_BY_BIOME[String(biome || '').toLowerCase()] || 'fx_dust';
}

/**
 * Death styles: player units' light goes out as gilt embers; enemies (who carry no
 * light) crumble into crimson cinders and ash; allies into verdigris; bosses burn
 * bigger; the Entity collapses into unlight.
 */
export const DEATH_STYLES = Object.freeze({
  player: {
    heat: [MOTE_COLORS.emberHot, MOTE_COLORS.ember, MOTE_COLORS.emberDim, MOTE_COLORS.emberDeep],
    edge: MOTE_COLORS.emberHot,
    motes: 44,
    rise: [18, 34],
    lifeMs: [520, 880],
    dissolveMs: 380,
    blend: 'add',
  },
  npc: {
    heat: [
      MOTE_COLORS.verdigrisPale,
      MOTE_COLORS.verdigris,
      MOTE_COLORS.verdigrisDim,
      MOTE_COLORS.ashDim,
    ],
    edge: MOTE_COLORS.verdigrisPale,
    motes: 40,
    rise: [16, 30],
    lifeMs: [500, 820],
    dissolveMs: 380,
    blend: 'add',
  },
  enemy: {
    heat: [MOTE_COLORS.ember, MOTE_COLORS.crimson, MOTE_COLORS.crimsonDim, MOTE_COLORS.ashDim],
    edge: MOTE_COLORS.crimsonHot,
    motes: 40,
    rise: [14, 28],
    lifeMs: [480, 800],
    dissolveMs: 360,
    blend: 'add',
  },
  boss: {
    heat: [
      MOTE_COLORS.emberHot,
      MOTE_COLORS.crimsonHot,
      MOTE_COLORS.crimson,
      MOTE_COLORS.crimsonDeep,
    ],
    edge: MOTE_COLORS.emberHot,
    motes: 60,
    rise: [26, 52],
    lifeMs: [700, 1200],
    dissolveMs: 560,
    blend: 'add',
    ring: true,
  },
  entity: {
    heat: [MOTE_COLORS.violetPale, MOTE_COLORS.violet, MOTE_COLORS.violetDim, MOTE_COLORS.unlight],
    edge: MOTE_COLORS.violet,
    motes: 60,
    rise: [-10, 6],
    lifeMs: [600, 1000],
    dissolveMs: 620,
    blend: 'normal',
    inward: true,
  },
});

export function deathStyleFor(unit) {
  if (unit?.isEntity === true) return 'entity';
  if (unit?.isBoss) return 'boss';
  if (unit?.faction === 'enemy') return 'enemy';
  if (unit?.faction === 'npc') return 'npc';
  return 'player';
}
