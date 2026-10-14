// atmosphereConfig — pure act-mood data and resolution (no Phaser, unit-testable).
//
// A battle's mood is chosen from where the run is (act, secret act, final boss) and
// what the map is made of (biome), then scaled by the player's Atmosphere setting.
// AtmosphereFX turns the grade into a camera post-process; BattleLightLayer turns the
// light preset into night darkness with carried light. Presentation only: nothing here
// reads or writes game state, RNG or saves.

export const ATMOSPHERE_MODES = Object.freeze(['full', 'reduced', 'off']);
export const ATMOSPHERE_PREFERENCES = Object.freeze(['auto', ...ATMOSPHERE_MODES]);

// Grades are authored as intent, then converted to shader uniforms (gradeToUniforms).
//   shadow / highlight: hue direction of the split tone
//   split: split-tone strength; sat / contrast / exposure: global trims
//   key: warm upper-left key light strength; vignette / grain: 0..1-ish
//   aberration: chromatic split in framebuffer pixels, confined to the vignette rim
export const ATMOSPHERE_GRADES = Object.freeze({
  act1: {
    label: 'Ember Dusk',
    shadow: '#3b2a5c',
    highlight: '#ffb86a',
    split: 0.7,
    sat: 0.92,
    contrast: 1.06,
    exposure: 0.95,
    key: 0.22,
    vignette: 0.55,
    grain: 0.035,
    aberration: 0,
  },
  act2: {
    label: 'Iron Rain',
    shadow: '#23365c',
    highlight: '#d9e6f2',
    split: 0.5,
    sat: 0.78,
    contrast: 1.06,
    exposure: 0.93,
    key: 0.08,
    vignette: 0.6,
    grain: 0.04,
    aberration: 0,
  },
  act3: {
    label: 'Bleached Rite',
    shadow: '#4a3a5e',
    highlight: '#fff0c8',
    split: 0.45,
    sat: 0.7,
    contrast: 0.98,
    exposure: 1.02,
    key: 0.12,
    vignette: 0.5,
    grain: 0.035,
    aberration: 0,
  },
  act4: {
    label: 'Ashfall',
    // Tuned down from the board study: the night layer already darkens, and a strong
    // red cast swallowed the empire's crimson units on volcanic ground.
    shadow: '#3b1d36',
    highlight: '#ff9a6a',
    split: 0.45,
    sat: 0.84,
    contrast: 1.08,
    exposure: 0.9,
    key: 0.2,
    vignette: 0.75,
    grain: 0.05,
    aberration: 1,
  },
  // Act IV on snow: the warm Ashfall split reads pink on white ground, so the night
  // turns cold. Steel-blue shadows, pale rime highlights, almost no warm key; the
  // only warmth left is the light your units carry.
  rime: {
    label: 'Rime Night',
    shadow: '#101a2e',
    highlight: '#b8d8e6',
    split: 0.55,
    sat: 0.74,
    contrast: 1.08,
    exposure: 0.9,
    key: 0.04,
    vignette: 0.72,
    grain: 0.045,
    aberration: 0.8,
  },
  // Final battle: a torchlit iron hall. Cold iron-violet shadows, ember highlights
  // where the torches reach, heavy frame.
  throne: {
    label: 'The Throne',
    shadow: '#211d2b',
    highlight: '#f3cb6c',
    split: 0.65,
    sat: 0.8,
    contrast: 1.1,
    exposure: 0.9,
    key: 0.16,
    vignette: 0.8,
    grain: 0.045,
    aberration: 0.6,
  },
  // Night variants of the first three acts (resolveTimeOfDay): the same place after dark.
  // Cool moon shadows, pale highlights, no warm key; the warmth is the light units carry.
  act1_night: {
    label: 'Moonrise',
    shadow: '#1a2350',
    highlight: '#d6dcf0',
    split: 0.6,
    sat: 0.78,
    contrast: 1.07,
    exposure: 0.92,
    key: 0.05,
    vignette: 0.68,
    grain: 0.04,
    aberration: 0.4,
  },
  // Iron Rain after dark: the storm keeps falling, slate-blue and colder still.
  act2_night: {
    label: 'Storm Night',
    shadow: '#141e36',
    highlight: '#c4d2e2',
    split: 0.5,
    sat: 0.7,
    contrast: 1.08,
    exposure: 0.9,
    key: 0.02,
    vignette: 0.72,
    grain: 0.045,
    aberration: 0.5,
  },
  // Bleached Rite under a pale moon: chalk highlights, violet shadows.
  act3_night: {
    label: 'Pale Moon',
    shadow: '#2a2448',
    highlight: '#eef0ff',
    split: 0.5,
    sat: 0.66,
    contrast: 1.05,
    exposure: 0.93,
    key: 0.05,
    vignette: 0.66,
    grain: 0.04,
    aberration: 0.4,
  },
  // Dawn and dusk variants of the first three acts (resolveTimeOfDay): a low sun. Dawn is
  // cool lavender shade under rose-peach light, soft and a little hazy; dusk is the sun
  // going down hard, deep violet shade under a burnt-orange key, the lanterns just lit.
  act1_dawn: {
    label: 'Daybreak',
    shadow: '#3c4a8c',
    highlight: '#ffb4b4',
    split: 0.85,
    sat: 0.84,
    contrast: 1.0,
    exposure: 1.0,
    key: 0.2,
    vignette: 0.5,
    grain: 0.035,
    aberration: 0,
  },
  act1_dusk: {
    label: 'Last Light',
    shadow: '#3a1c50',
    highlight: '#ff8248',
    split: 0.85,
    sat: 0.96,
    contrast: 1.08,
    exposure: 0.9,
    key: 0.3,
    vignette: 0.62,
    grain: 0.04,
    aberration: 0.2,
  },
  // Iron Rain's dawn: grey light breaking pink under the storm.
  act2_dawn: {
    label: 'Grey Dawn',
    shadow: '#2c3a62',
    highlight: '#f2c6b8',
    split: 0.6,
    sat: 0.78,
    contrast: 1.03,
    exposure: 0.96,
    key: 0.1,
    vignette: 0.58,
    grain: 0.04,
    aberration: 0,
  },
  // Iron Rain's dusk: a red sun under the cloud's edge.
  act2_dusk: {
    label: 'Red Sky',
    shadow: '#28224a',
    highlight: '#ff9a6a',
    split: 0.7,
    sat: 0.82,
    contrast: 1.07,
    exposure: 0.9,
    key: 0.16,
    vignette: 0.64,
    grain: 0.045,
    aberration: 0.2,
  },
  // Bleached Rite's dawn: chalk going to rose.
  act3_dawn: {
    label: 'Pale Dawn',
    shadow: '#423c70',
    highlight: '#ffdccc',
    split: 0.6,
    sat: 0.74,
    contrast: 0.98,
    exposure: 1.02,
    key: 0.15,
    vignette: 0.5,
    grain: 0.035,
    aberration: 0,
  },
  // Bleached Rite's dusk: gold over the white stone, violet in the hollows.
  act3_dusk: {
    label: 'Vesper',
    shadow: '#3c2456',
    highlight: '#ffae66',
    split: 0.7,
    sat: 0.78,
    contrast: 1.05,
    exposure: 0.93,
    key: 0.22,
    vignette: 0.6,
    grain: 0.04,
    aberration: 0.2,
  },
  deep: {
    label: 'The Deep',
    shadow: '#2c1645',
    highlight: '#dcaaf0',
    split: 0.7,
    sat: 0.55,
    contrast: 1.12,
    exposure: 0.84,
    key: 0,
    vignette: 0.85,
    grain: 0.06,
    aberration: 2,
  },
});

// Biome tunes: small, relative adjustments layered on the act's grade. Biomes change
// material, not tint, so these stay subtle.
export const BIOME_TUNES = Object.freeze({
  // Enclosed stone: a little more contrast and frame, less open-sky key light.
  castle: { contrast: 0.03, vignette: 0.05, keyScale: 0.7 },
  // Wet ground: slightly less saturation, shadows lean toward verdigris-black.
  swamp: { satScale: 0.94, shadow: '#1b4239' },
  // Snow outside the night act: keep the act, drop the warm key and cool the highlights.
  tundra: { keyScale: 0.2, highlight: '#d9e6f2' },
});

// Night light presets (BattleLightLayer). Emitters: terrain name → [radius tiles,
// strength 0..1, glow color]. Colors are art ramps, not UI tokens.
const BASE_EMITTERS = Object.freeze({
  'Lava Crack': [1.5, 0.8, '#ff7a2e'],
  Fort: [1.8, 0.6, '#ffb45a'],
  Village: [1.8, 0.6, '#ffb45a'],
  Throne: [2.2, 0.75, '#ffc870'],
  'Acidic Swamp': [1.1, 0.35, '#9ad06a'],
  'Acidic Bog': [1.1, 0.35, '#9ad06a'],
});

// Indoors: a sconce on the wall every few tiles where a wall faces open floor
// (BattleLightLayer places them from the layout alone, no draw), and one on every pillar.
export const WALL_TORCHES = Object.freeze({
  spacing: 4,
  radius: 2.1,
  strength: 0.75,
  color: '#ffa850',
});
const INDOOR_EMITTERS = Object.freeze({ ...BASE_EMITTERS, Pillar: [1.25, 0.55, '#ffb45a'] });

export const LIGHT_PRESETS = Object.freeze({
  // An Act I-III outdoor battle at night: moonlit blue ink, units carry lanterns,
  // villages and forts keep their windows lit.
  moonlit: {
    darkness: 0.52,
    color: '#0a1230',
    unitRadius: 2.6,
    unitLight: '#ffb064',
    allyLight: '#a8e0b8',
    glowStrength: 0.3,
    emitters: BASE_EMITTERS,
  },
  // Dusk: the light going. A thin violet dusk over the map, lanterns just lit, windows
  // starting to glow; far lighter than a night.
  dusk: {
    darkness: 0.26,
    color: '#2a1238',
    unitRadius: 2.4,
    unitLight: '#ffa458',
    allyLight: '#a8e0b8',
    glowStrength: 0.2,
    emitters: BASE_EMITTERS,
  },
  // Dawn: the last of the night's blue in the shade, a faint warmth where lanterns are
  // still burning.
  dawn: {
    darkness: 0.16,
    color: '#1e2450',
    unitRadius: 2.2,
    unitLight: '#ffc090',
    allyLight: '#a8e0b8',
    glowStrength: 0.12,
    emitters: BASE_EMITTERS,
  },
  // A castle hall by day: no sky indoors, so the hall is dim and the torches carry it.
  // Lighter than any night (the act's own grade stays), so it reads as shade, not dark.
  hall: {
    darkness: 0.4,
    color: '#120e18',
    unitRadius: 2.2,
    unitLight: '#ffc27a',
    allyLight: '#a8e0b8',
    glowStrength: 0.26,
    // The hall's light is its wall sconces (and forts' and thrones' fires); pillars
    // carry none here and throw the sconces' shadows instead.
    emitters: BASE_EMITTERS,
    wallTorches: WALL_TORCHES,
    castShadows: true,
  },
  ashfall: {
    darkness: 0.52,
    color: '#0e0c14',
    unitRadius: 2.6,
    unitLight: '#ffc27a',
    allyLight: '#a8e0b8',
    glowStrength: 0.28,
    emitters: BASE_EMITTERS,
  },
  rime: {
    // Snow is bright: a deeper blue-ink night, and a weaker additive glow so the
    // lantern pools stay warm instead of clipping to white.
    darkness: 0.54,
    color: '#0b1424',
    unitRadius: 2.6,
    unitLight: '#ffb060',
    allyLight: '#a8e0b8',
    glowStrength: 0.15,
    emitters: BASE_EMITTERS,
  },
  throne: {
    darkness: 0.44,
    color: '#0e0c14',
    unitRadius: 2.4,
    unitLight: '#ffc27a',
    allyLight: '#a8e0b8',
    glowStrength: 0.3,
    // Torches in the hall: every pillar carries a sconce.
    emitters: { ...BASE_EMITTERS, Pillar: [1.25, 0.55, '#ffb45a'] },
  },
  deep: {
    darkness: 0.56,
    color: '#170c24',
    unitRadius: 2.4,
    unitLight: '#ffc27a',
    allyLight: '#a8e0b8',
    glowStrength: 0.26,
    emitters: BASE_EMITTERS,
    // The Entity carries no light; it bleeds unlight — a deeper violet-black pool
    // around it (its sprite stays above the darkness, pale against it).
    entityUnlight: '#170c24',
  },
});

const NIGHT_PRESET_BY_GRADE = Object.freeze({
  act1_night: 'moonlit',
  act2_night: 'moonlit',
  act3_night: 'moonlit',
  act4: 'ashfall',
  rime: 'rime',
  throne: 'throne',
  deep: 'deep',
});

// Dawn and dusk carry a light layer too, but they are not night (no night weather or
// night label): a low sun, not the dark.
const TWILIGHT_PRESET_BY_GRADE = Object.freeze({
  act1_dawn: 'dawn',
  act2_dawn: 'dawn',
  act3_dawn: 'dawn',
  act1_dusk: 'dusk',
  act2_dusk: 'dusk',
  act3_dusk: 'dusk',
});

const DEV_OVERRIDE_KEYS = Object.freeze([
  'act1',
  'act2',
  'act3',
  'act1_night',
  'act2_night',
  'act3_night',
  'act1_dawn',
  'act2_dawn',
  'act3_dawn',
  'act1_dusk',
  'act2_dusk',
  'act3_dusk',
  'act4',
  'rime',
  'throne',
  'deep',
]);

// --- Time of day ----------------------------------------------------------------------
// Acts I-III are fought by day. Some outdoor battles fall at night, dusk or dawn instead:
// presentation only (no vision, fog, AI or difficulty change). The pick is hashed from the
// battle's own seed, never Math.random, so a resumed battle keeps its hour. The hash's
// bands: night below NIGHT_CHANCE, then dusk, then dawn, the rest day (so adding the low
// suns moved no battle's night).
export const TIME_OF_DAY = Object.freeze(['day', 'night', 'dawn', 'dusk']);
export const NIGHT_CHANCE = 0.25;
export const DUSK_CHANCE = 0.08;
export const DAWN_CHANCE = 0.08;
const DAY_NIGHT_ACTS = Object.freeze(['act1', 'act2', 'act3']);
const OUTDOOR_BIOMES = Object.freeze(['grassland', 'swamp']);

function hashTimeOfDay(battleSeed) {
  let h = (Number(battleSeed) >>> 0) ^ 0x6e696768; // 'nigh'
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The hour of a battle (pure): day, night, dusk or dawn. Anything but day only falls on an
 * outdoor Act I-III battle with a seed, never a scripted (prologue) battle, never a run's
 * opening map.
 * @param {object} ctx { act, biome, battleSeed, row, isScripted, timeOverride (a TIME_OF_DAY) }
 */
export function resolveTimeOfDay(ctx = {}) {
  if (ctx.isScripted) return 'day';
  const act = String(ctx.act || 'act1');
  const biome = normBiome(ctx.biome);
  if (!DAY_NIGHT_ACTS.includes(act) || !OUTDOOR_BIOMES.includes(biome)) return 'day';
  if (TIME_OF_DAY.includes(ctx.timeOverride)) return ctx.timeOverride;
  if (ctx.battleSeed == null || !Number.isFinite(Number(ctx.battleSeed))) return 'day';
  if (act === 'act1' && Number(ctx.row) === 0) return 'day';
  const h = hashTimeOfDay(ctx.battleSeed);
  if (h < NIGHT_CHANCE) return 'night';
  if (h < NIGHT_CHANCE + DUSK_CHANCE) return 'dusk';
  if (h < NIGHT_CHANCE + DUSK_CHANCE + DAWN_CHANCE) return 'dawn';
  return 'day';
}

function normBiome(biome) {
  const b = String(biome || '')
    .trim()
    .toLowerCase();
  if (b === 'snow' || b === 'ice' || b === 'frozen') return 'tundra';
  if (b === 'volcanic') return 'volcano';
  if (b === 'mire' || b === 'marsh') return 'swamp';
  return b || 'grassland';
}

// The Eclipse darkens the world by run phase (Pale 0 … Hollow 4): small, cumulative
// nudges on top of the act's grade — never a new mood. Index = phase index.
export const ECLIPSE_PHASE_NUDGE = Object.freeze([
  Object.freeze({ exposure: 0, vignette: 0, sat: 1, darkness: 0 }),
  Object.freeze({ exposure: -0.015, vignette: 0.03, sat: 0.98, darkness: 0.02 }),
  Object.freeze({ exposure: -0.035, vignette: 0.07, sat: 0.95, darkness: 0.04 }),
  Object.freeze({ exposure: -0.055, vignette: 0.11, sat: 0.92, darkness: 0.06 }),
  Object.freeze({ exposure: -0.08, vignette: 0.15, sat: 0.88, darkness: 0.08 }),
]);

/** Darken a grade for an Eclipse phase index (pure; 0 returns a copy). */
export function eclipseGrade(grade, phaseIndex = 0) {
  const i = Math.max(0, Math.min(ECLIPSE_PHASE_NUDGE.length - 1, Math.trunc(phaseIndex) || 0));
  const n = ECLIPSE_PHASE_NUDGE[i];
  if (!i) return { ...grade };
  return {
    ...grade,
    exposure: grade.exposure + n.exposure,
    vignette: Math.min(1, grade.vignette + n.vignette),
    sat: grade.sat * n.sat,
  };
}

/** Apply a relative biome tune to a grade (pure). */
export function tuneGrade(grade, tune) {
  if (!tune) return { ...grade };
  const out = { ...grade };
  if (tune.shadow) out.shadow = tune.shadow;
  if (tune.highlight) out.highlight = tune.highlight;
  if (Number.isFinite(tune.satScale)) out.sat = grade.sat * tune.satScale;
  if (Number.isFinite(tune.contrast)) out.contrast = grade.contrast + tune.contrast;
  if (Number.isFinite(tune.vignette)) out.vignette = Math.min(1, grade.vignette + tune.vignette);
  if (Number.isFinite(tune.keyScale)) out.key = grade.key * tune.keyScale;
  return out;
}

/**
 * Pick the battle's mood.
 * @param {object} ctx { act, biome, isBoss, isSecret, isFinalBoss, isScripted, hasEntity, override,
 *   eclipsePhase (0 Pale .. 4 Hollow), battleSeed, row, timeOverride (a TIME_OF_DAY) }
 * @returns {{ gradeKey, label, grade, night:boolean,
 *   lighting:'day'|'night'|'dawn'|'dusk'|'indoor', timeOfDay:'day'|'night'|'dawn'|'dusk',
 *   lightOptions:object|null, biome }}
 */
export function resolveAtmosphere(ctx = {}) {
  const act = String(ctx.act || 'act1');
  const biome = normBiome(ctx.biome);
  const override = DEV_OVERRIDE_KEYS.includes(ctx.override) ? ctx.override : null;
  let gradeKey;
  let tune = null;
  let timeOfDay = 'day';
  if (override) {
    gradeKey = override;
  } else if (ctx.isScripted) {
    // A prologue chapter's clarity first: the plain Act I dusk, never night or corruption.
    gradeKey = 'act1';
  } else if (ctx.isSecret || act === 'secretAct' || ctx.hasEntity) {
    gradeKey = 'deep';
  } else if (ctx.isFinalBoss || act === 'finalBoss') {
    // The final battle's sanctum is tagged 'void', but the owner-approved mood for the
    // last fight is the Throne. Only the Entity (secret/Lunatic) sinks into the Deep.
    gradeKey = 'throne';
  } else if (biome === 'void') {
    gradeKey = 'deep';
  } else if (act === 'act4' || act === 'postAct') {
    gradeKey = biome === 'tundra' ? 'rime' : 'act4';
  } else {
    gradeKey = ATMOSPHERE_GRADES[act] ? act : 'act1';
    timeOfDay = gradeKey === act ? resolveTimeOfDay({ ...ctx, act, biome }) : 'day';
    if (timeOfDay === 'night') gradeKey = `${gradeKey}_night`;
    else if (timeOfDay === 'dawn' || timeOfDay === 'dusk') {
      gradeKey = `${gradeKey}_${timeOfDay}`;
      // Swamp keeps its wet saturation; its verdigris shade would fight the low sun.
      if (biome === 'swamp') tune = { satScale: BIOME_TUNES.swamp.satScale };
    } else tune = BIOME_TUNES[biome] || null;
  }
  if (!override && (gradeKey === 'act4' || gradeKey === 'rime' || gradeKey === 'throne')) {
    if (biome === 'castle') tune = BIOME_TUNES.castle;
    else if (biome === 'swamp') tune = BIOME_TUNES.swamp;
  }
  if (gradeKey.endsWith('_night')) timeOfDay = 'night';
  else if (gradeKey.endsWith('_dawn')) timeOfDay = 'dawn';
  else if (gradeKey.endsWith('_dusk')) timeOfDay = 'dusk';
  const base = ATMOSPHERE_GRADES[gradeKey];
  // The Eclipse phase darkens every mood a little more (never a prologue chapter or a dev
  // override, which exist to show the plain grade).
  const eclipse = override || ctx.isScripted ? 0 : Math.max(0, Math.trunc(ctx.eclipsePhase) || 0);
  const grade = eclipseGrade(tuneGrade(base, tune), eclipse);
  const nightKey = NIGHT_PRESET_BY_GRADE[gradeKey] || null;
  const night = Boolean(nightKey);
  const twilightKey = TWILIGHT_PRESET_BY_GRADE[gradeKey] || null;
  // Indoors (a castle map) by day: the hall's own torchlight. A castle at night keeps
  // its night preset and gains the hall's sconces.
  const indoor = biome === 'castle' && !ctx.isScripted && gradeKey !== 'deep';
  const presetKey = nightKey || twilightKey || (indoor ? 'hall' : null);
  let lightOptions = presetKey ? { ...LIGHT_PRESETS[presetKey] } : null;
  if (lightOptions && indoor && presetKey !== 'hall') {
    lightOptions = {
      ...lightOptions,
      emitters: { ...INDOOR_EMITTERS, ...lightOptions.emitters },
      wallTorches: WALL_TORCHES,
      castShadows: true,
    };
  }
  if (lightOptions && eclipse) {
    const nudge = ECLIPSE_PHASE_NUDGE[Math.min(ECLIPSE_PHASE_NUDGE.length - 1, eclipse)];
    lightOptions.darkness = Math.min(0.7, lightOptions.darkness + nudge.darkness);
  }
  return {
    gradeKey,
    label: base.label,
    grade,
    night,
    lighting: night ? 'night' : twilightKey ? timeOfDay : indoor ? 'indoor' : 'day',
    timeOfDay,
    lightPreset: presetKey,
    lightOptions,
    biome,
    eclipsePhase: eclipse,
  };
}

/**
 * Effective atmosphere mode for this device and settings (pure).
 * @param {string} preference 'auto' | 'full' | 'reduced' | 'off'
 * @param {object} env { mobile, webgl, effectsQuality, reduceMotion }
 * @returns {{ mode, flicker:boolean, animatedGrain:boolean }}
 */
export function resolveAtmosphereMode(preference, env = {}) {
  const pref = ATMOSPHERE_PREFERENCES.includes(preference) ? preference : 'auto';
  let mode = pref === 'auto' ? (env.mobile ? 'reduced' : 'full') : pref;
  if (env.webgl === false) mode = 'off';
  // Low effects quality caps the mood at Reduced; it never turns a chosen Off on.
  if (mode === 'full' && env.effectsQuality === 'low') mode = 'reduced';
  const still = env.reduceMotion === true;
  return {
    mode,
    flicker: mode === 'full' && !still,
    animatedGrain: mode === 'full' && !still,
  };
}

/** Default mode shown for 'auto' on this device (pure). */
export function defaultAtmosphereMode({ mobile = false } = {}) {
  return mobile ? 'reduced' : 'full';
}

/** Night-layer options for a mode: Reduced lightens darkness and stops flicker (pure). */
export function lightOptionsForMode(lightOptions, mode, { flicker = true } = {}) {
  if (!lightOptions || mode === 'off') return null;
  const reduced = mode === 'reduced';
  return {
    ...lightOptions,
    darkness: reduced ? lightOptions.darkness * 0.7 : lightOptions.darkness,
    glowStrength: reduced ? lightOptions.glowStrength * 0.85 : lightOptions.glowStrength,
    flicker: !reduced && flicker,
  };
}

export function hexToRgb01(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function hexToInt(hex) {
  return parseInt(String(hex).replace('#', ''), 16) >>> 0;
}

/** Hue direction of a color with its luminance removed, normalized to unit length. */
function chromaDirection(hex) {
  const [r, g, b] = hexToRgb01(hex);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = [r - l, g - l, b - l];
  const len = Math.hypot(c[0], c[1], c[2]) || 1;
  return c.map((x) => x / len);
}

/** Convert an authored grade into uniform values (pure; unit-testable). */
export function gradeToUniforms(grade, { reduced = false, animatedGrain = true } = {}) {
  const g = grade || ATMOSPHERE_GRADES.act1;
  return {
    shadow: chromaDirection(g.shadow),
    highlight: chromaDirection(g.highlight),
    split: (g.split ?? 0.5) * 0.2,
    sat: g.sat ?? 1,
    contrast: g.contrast ?? 1,
    exposure: g.exposure ?? 1,
    key: g.key ?? 0,
    vignette: reduced ? (g.vignette ?? 0) * 0.6 : (g.vignette ?? 0),
    grain: reduced ? 0 : (g.grain ?? 0),
    aberration: reduced ? 0 : (g.aberration ?? 0),
    animatedGrain: !reduced && animatedGrain,
  };
}
