// weatherConfig — pure weather data, mood → weather resolution and the particle
// simulation (no Phaser, unit-testable).
//
// Weather is presentation over the act mood (atmosphereConfig): rain under Iron Rain,
// ash under Ashfall, snow on tundra and in the Rime Night, embers rising over volcanic
// ground, dust motes in castle halls and the Throne, a few specks of unlight in the
// Deep. Ember Dusk and Bleached Rite stay clear, and so does every scripted battle (the
// prologue keeps the plain dusk, as its grade does).
//
// The simulation is a fixed set of particle records rewritten in place: nothing is
// allocated per step. Every random value comes from the field's own seeded generator,
// never Math.random (during a battle Math.random IS the battle RNG). Velocities are in
// screen pixels per second and converted to world units by the camera zoom, so a
// particle keeps its on-screen speed and size at any zoom; positions are world units,
// so panning shows the weather staying put over the map. The camera is never rotated
// (portrait battles turn the board through the Grid, not the camera), so world +y is
// screen down on either orientation.

import { createSeededRng } from '../engine/BlessingEngine.js';
import { resolveAtmosphere, resolveAtmosphereMode } from './atmosphereConfig.js';

export const WEATHER_KINDS = Object.freeze([
  'none',
  'rain',
  'snow',
  'ash',
  'embers',
  'motes',
  'unlight',
  'fireflies',
]);

// Pool caps per mode (the owner's performance budget).
export const WEATHER_MAX_PARTICLES = Object.freeze({ full: 120, reduced: 40 });

// Reduced: about a third of the particles, slower, no flicker.
export const REDUCED_DENSITY = 1 / 3;
export const REDUCED_SPEED = 0.65;

// A delta longer than this is a stall (hidden tab, pause, a slow frame): the field steps
// this far at most, so nothing bursts to catch up.
export const WEATHER_MAX_STEP_MS = 50;

// Screen area (px²) at which a kind shows its full count; a smaller visible map shows
// proportionally fewer (never under WEATHER_MIN_AREA_SHARE), so density reads the same.
export const WEATHER_REFERENCE_AREA = 640 * 400;
export const WEATHER_MIN_AREA_SHARE = 0.3;

const TAU = Math.PI * 2;

// Kinds. Speeds are screen px/s; vy > 0 falls, vy < 0 rises. `shape` names the tiny
// generated texture (WeatherController): streak (1x12 fading line), dot (2x2), soft
// (4x4 rounded speck). `lifeMs` kinds fade in and out where they float and respawn
// anywhere in view; the others enter at the top (or bottom) edge and recycle on exit.
// Colours are art ramps, not UI tokens.
export const WEATHER_SPECS = Object.freeze({
  rain: Object.freeze({
    label: 'Rain',
    count: 110,
    shape: 'streak',
    blend: 'normal',
    colors: Object.freeze([0xc8d8ea, 0xaebfd6, 0xdbe6f0]),
    alpha: Object.freeze([0.2, 0.38]),
    scale: Object.freeze([0.7, 1.2]),
    vx: Object.freeze([-95, -60]),
    vy: Object.freeze([520, 680]),
    sway: 0,
    swayHz: Object.freeze([0, 0]),
    lifeMs: null,
    flicker: false,
    alignToVelocity: true,
  }),
  snow: Object.freeze({
    label: 'Snow',
    count: 90,
    shape: 'soft',
    blend: 'normal',
    colors: Object.freeze([0xffffff, 0xe6f0f8, 0xd4e4f0]),
    alpha: Object.freeze([0.45, 0.8]),
    scale: Object.freeze([0.45, 0.95]),
    vx: Object.freeze([-10, 6]),
    vy: Object.freeze([24, 50]),
    sway: 9,
    swayHz: Object.freeze([0.15, 0.45]),
    lifeMs: null,
    flicker: false,
    alignToVelocity: false,
  }),
  ash: Object.freeze({
    label: 'Ash',
    count: 70,
    shape: 'dot',
    blend: 'normal',
    colors: Object.freeze([0x8a8590, 0x6f6a74, 0xa9a2a6]),
    alpha: Object.freeze([0.3, 0.55]),
    scale: Object.freeze([0.75, 1.4]),
    vx: Object.freeze([6, 18]),
    vy: Object.freeze([14, 32]),
    sway: 7,
    swayHz: Object.freeze([0.12, 0.32]),
    lifeMs: null,
    flicker: false,
    alignToVelocity: false,
  }),
  embers: Object.freeze({
    label: 'Embers',
    count: 46,
    shape: 'soft',
    blend: 'add',
    colors: Object.freeze([0xffb45a, 0xff7a2e, 0xffd27a]),
    alpha: Object.freeze([0.45, 0.85]),
    scale: Object.freeze([0.35, 0.75]),
    vx: Object.freeze([-8, 10]),
    vy: Object.freeze([-46, -22]),
    sway: 6,
    swayHz: Object.freeze([0.3, 0.7]),
    lifeMs: Object.freeze([1800, 3600]),
    flicker: true,
    alignToVelocity: false,
  }),
  motes: Object.freeze({
    label: 'Dust motes',
    count: 34,
    shape: 'soft',
    blend: 'add',
    colors: Object.freeze([0xf3d79a, 0xffe6b0, 0xe8c886]),
    alpha: Object.freeze([0.1, 0.26]),
    scale: Object.freeze([0.3, 0.6]),
    vx: Object.freeze([-6, 6]),
    vy: Object.freeze([-8, 4]),
    sway: 5,
    swayHz: Object.freeze([0.06, 0.18]),
    lifeMs: Object.freeze([4000, 8000]),
    flicker: true,
    alignToVelocity: false,
  }),
  // A clear Act I or III night: a few slow green-gold sparks blinking over the grass.
  fireflies: Object.freeze({
    label: 'Fireflies',
    count: 22,
    shape: 'soft',
    blend: 'add',
    colors: Object.freeze([0xd8f08a, 0xf0e27a, 0xb8e070]),
    alpha: Object.freeze([0.35, 0.75]),
    scale: Object.freeze([0.35, 0.6]),
    vx: Object.freeze([-7, 7]),
    vy: Object.freeze([-6, 5]),
    sway: 8,
    swayHz: Object.freeze([0.08, 0.22]),
    lifeMs: Object.freeze([2600, 5200]),
    flicker: true,
    alignToVelocity: false,
  }),
  // The Deep: a few dark specks rising like ash falling upward. Restrained on purpose.
  unlight: Object.freeze({
    label: 'Unlight',
    count: 26,
    shape: 'soft',
    blend: 'normal',
    colors: Object.freeze([0x2c1645, 0x3d2160, 0x170c24]),
    alpha: Object.freeze([0.22, 0.4]),
    scale: Object.freeze([0.5, 1]),
    vx: Object.freeze([-4, 4]),
    vy: Object.freeze([-14, -6]),
    sway: 4,
    swayHz: Object.freeze([0.08, 0.2]),
    lifeMs: Object.freeze([3500, 7000]),
    flicker: false,
    alignToVelocity: false,
  }),
});

/**
 * The weather for a mood (pure).
 * @param {object} mood { gradeKey, biome (normalized, as resolveAtmosphere returns it),
 *   isScripted, override (dev `?weather=`) }
 * @returns {string} a WEATHER_KINDS entry
 */
export function weatherKindFor({ gradeKey, biome, isScripted = false, override = null } = {}) {
  if (override && WEATHER_KINDS.includes(override)) return override;
  // A prologue chapter's clarity first, as its grade: no weather.
  if (isScripted) return 'none';
  if (gradeKey === 'deep') return 'unlight';
  if (gradeKey === 'throne') return 'motes';
  // Indoors no sky reaches the floor: dust in the hall's light, whatever the act.
  if (biome === 'castle') return 'motes';
  if (biome === 'tundra' || gradeKey === 'rime') return 'snow';
  if (biome === 'volcano') return 'embers';
  if (gradeKey === 'act2' || gradeKey === 'act2_night') return 'rain';
  // A clear night outdoors: fireflies over the grass and the mire.
  if (gradeKey === 'act1_night' || gradeKey === 'act3_night') return 'fireflies';
  if (gradeKey === 'act4') return 'ash';
  // Ember Dusk and Bleached Rite stay clear.
  return 'none';
}

/** Resolve a battle's weather from the atmosphere context (pure; see resolveAtmosphere). */
export function resolveWeather(ctx = {}) {
  const mood = resolveAtmosphere(ctx);
  return weatherKindFor({
    gradeKey: mood.gradeKey,
    biome: mood.biome,
    isScripted: Boolean(ctx.isScripted),
    override: ctx.weatherOverride || null,
  });
}

/**
 * Effective weather mode (pure). Follows the Atmosphere mode (resolveAtmosphereMode:
 * auto → Reduced on phones, Low effects quality caps at Reduced, no WebGL → Off), and
 * Reduce motion turns weather off entirely (falling particles are motion).
 * @returns {{ mode:'full'|'reduced'|'off', density:number, speed:number, flicker:boolean }}
 */
export function resolveWeatherMode(preference, env = {}) {
  const info = resolveAtmosphereMode(preference, env);
  const mode = env.reduceMotion === true ? 'off' : info.mode;
  if (mode === 'off') return { mode, density: 0, speed: 0, flicker: false };
  if (mode === 'reduced') {
    return { mode, density: REDUCED_DENSITY, speed: REDUCED_SPEED, flicker: false };
  }
  return { mode, density: 1, speed: 1, flicker: info.flicker };
}

/** Pool size for a kind in a mode (pure; capped by WEATHER_MAX_PARTICLES). */
export function weatherParticleCount(kind, mode) {
  const spec = WEATHER_SPECS[kind];
  if (!spec || mode === 'off' || !WEATHER_MAX_PARTICLES[mode]) return 0;
  const density = mode === 'reduced' ? REDUCED_DENSITY : 1;
  return Math.max(1, Math.min(WEATHER_MAX_PARTICLES[mode], Math.round(spec.count * density)));
}

/** A stable presentation seed for a battle and kind (pure; reads nothing from the RNG). */
export function weatherSeed(battleSeed, kind) {
  let h = (Number(battleSeed) >>> 0) ^ 0x77656174; // 'weat'
  const s = String(kind || '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

// --- Simulation ---------------------------------------------------------------------

const lerp = (range, t) => range[0] + (range[1] - range[0]) * t;

function blankParticle() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    alpha: 1,
    scale: 1,
    color: 0xffffff,
    swayAmp: 0,
    swayHz: 0,
    phase: 0,
    flickerHz: 0,
    life: 0,
    age: 0,
    rotation: 0,
    // Read by the renderer each frame:
    drawX: 0,
    drawY: 0,
    drawAlpha: 0,
    visible: false,
    // Bumped when colour/rotation change (the renderer restyles only then).
    styleRev: 0,
  };
}

/**
 * A weather field: a fixed pool of particle records and its own seeded generator.
 * @param {object} opts { kind, mode ('full'|'reduced'), seed, flicker }
 */
export function createWeatherField({ kind, mode = 'full', seed = 1, flicker = false } = {}) {
  const spec = WEATHER_SPECS[kind] || null;
  const count = spec ? weatherParticleCount(kind, mode) : 0;
  const particles = [];
  for (let i = 0; i < count; i++) particles.push(blankParticle());
  return {
    kind: spec ? kind : 'none',
    spec,
    mode,
    speed: mode === 'reduced' ? REDUCED_SPEED : 1,
    flicker: Boolean(flicker && spec?.flicker && mode === 'full'),
    rng: createSeededRng(seed >>> 0),
    particles,
    count,
    active: 0,
    time: 0,
    scattered: false,
    recycled: 0,
  };
}

function rollTraits(field, p) {
  const { spec, rng } = field;
  p.vx = lerp(spec.vx, rng());
  p.vy = lerp(spec.vy, rng());
  p.alpha = lerp(spec.alpha, rng());
  p.scale = lerp(spec.scale, rng());
  p.color = spec.colors[Math.floor(rng() * spec.colors.length) % spec.colors.length];
  p.swayAmp = spec.sway ? spec.sway * (0.5 + 0.5 * rng()) : 0;
  p.swayHz = lerp(spec.swayHz, rng());
  p.phase = rng() * TAU;
  p.flickerHz = 1.5 + rng() * 2.5;
  p.life = spec.lifeMs ? lerp(spec.lifeMs, rng()) : 0;
  p.age = 0;
  // Texture runs along +y; turn it to point along the (screen) velocity.
  p.rotation = spec.alignToVelocity ? Math.atan2(-p.vx, p.vy) : 0;
  p.styleRev++;
}

/** Place a particle anywhere in the view (first scatter, and life kinds' respawn). */
function placeAnywhere(field, p, view) {
  rollTraits(field, p);
  p.x = view.x + field.rng() * view.w;
  p.y = view.y + field.rng() * view.h;
  // Start a life kind part-way through so the first frame isn't one synchronized fade-in.
  if (p.life) p.age = field.scattered ? 0 : field.rng() * p.life;
}

function wrap(value, start, span) {
  const rel = value - start;
  return start + (rel - Math.floor(rel / span) * span);
}

/**
 * How many of the pool show for this view (pure): the full count at the reference
 * screen area, proportionally fewer on a smaller visible map.
 */
export function activeParticleCount(count, view) {
  if (!count || !view) return 0;
  const zoom = view.zoom || 1;
  const area = view.w * view.h * zoom * zoom;
  const share = Math.max(WEATHER_MIN_AREA_SHARE, Math.min(1, area / WEATHER_REFERENCE_AREA));
  return Math.max(1, Math.min(count, Math.round(count * share)));
}

/**
 * Advance the field by dtMs over a view and write each particle's draw values.
 * @param {object} field createWeatherField's result (mutated in place; no allocation)
 * @param {number} dtMs frame delta; clamped to WEATHER_MAX_STEP_MS
 * @param {{ x, y, w, h, zoom }|null} view visible map region in world units + camera zoom
 */
export function stepWeather(field, dtMs, view) {
  const { particles, spec } = field;
  if (!spec || !particles.length) return field;
  if (!view || !(view.w >= 8) || !(view.h >= 8)) {
    for (let i = 0; i < particles.length; i++) particles[i].visible = false;
    field.active = 0;
    return field;
  }
  const zoom = view.zoom > 0 ? view.zoom : 1;
  if (!field.scattered) {
    for (let i = 0; i < particles.length; i++) placeAnywhere(field, particles[i], view);
    field.scattered = true;
  }
  const dtClamped = Math.max(0, Math.min(WEATHER_MAX_STEP_MS, Number(dtMs) || 0));
  const dt = dtClamped / 1000;
  field.time += dt;
  const move = (field.speed * dt) / zoom;
  const margin = 16 / zoom;
  const x0 = view.x - margin;
  const y0 = view.y - margin;
  const spanX = view.w + margin * 2;
  const spanY = view.h + margin * 2;
  const t = field.time;
  field.active = activeParticleCount(particles.length, view);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (i >= field.active) {
      p.visible = false;
      continue;
    }
    p.x += p.vx * move;
    p.y += p.vy * move;
    if (p.life) {
      p.age += dtClamped * field.speed;
      if (p.age >= p.life) {
        placeAnywhere(field, p, view);
        field.recycled++;
      }
    }
    const relY = p.y - y0;
    if (relY >= spanY || relY < 0) {
      // Left through the edge it travels toward: re-enter at the other edge as a fresh
      // particle. Any other way out (a pan, a zoom) folds it back in unchanged.
      const exited = (p.vy > 0 && relY >= spanY) || (p.vy < 0 && relY < 0);
      p.y = wrap(p.y, y0, spanY);
      if (exited && !p.life) {
        rollTraits(field, p);
        p.x = view.x + field.rng() * view.w;
        field.recycled++;
      }
    }
    if (p.x < x0 || p.x >= x0 + spanX) p.x = wrap(p.x, x0, spanX);
    const sway = p.swayAmp ? (Math.sin(p.phase + t * p.swayHz * TAU) * p.swayAmp) / zoom : 0;
    p.drawX = p.x + sway;
    p.drawY = p.y;
    let alpha = p.alpha;
    if (p.life) alpha *= Math.sin(Math.PI * Math.min(1, p.age / p.life));
    if (field.flicker) alpha *= 0.7 + 0.3 * Math.sin(p.phase * 3 + t * p.flickerHz * TAU);
    p.drawAlpha = alpha > 0 ? alpha : 0;
    p.visible = p.drawAlpha > 0.01;
  }
  return field;
}
