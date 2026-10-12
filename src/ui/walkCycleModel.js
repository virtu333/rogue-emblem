// walkCycleModel — the rules of a unit's walk on the battle map (pure, no Phaser).
//
// Map sprites have no walk cycle (idle0..idle3, windup, strike), so a unit that moves
// is dressed as walking instead: the idle frames run at a step cadence, the sprite hops
// a pixel or two on each tile it crosses, and it lands in a small puff of the ground it
// stands on. A flier glides (a slow, gentle bob and no hop); a slide across Ice is a
// glide too. All of it is presentation: nothing here reads battle state or Math.random
// (the puff's variation comes from a generator the caller seeds), and a unit's rest
// frame and height are put back when the move ends however it ends.
//
// Used by WalkCycleController; the tests read the numbers from here.
import { MOTE_COLORS, ART_RAMPS } from '../art/combatFx/fxPalette.js';
import { dustKeyFor } from '../art/combatFx/fxFamilies.js';

/** A walked tile's tween at Normal speed (BattleScene.moveUnit, EnemyPhasePacing). */
export const WALK_STEP_MS = 80;
/** Below this a step is not drawn as a walk (Instant plays a step in 1 ms). */
export const WALK_MIN_STEP_MS = 24;
/** A step's grace past its time before the unit counts as standing (the next step is due). */
export const WALK_GRACE_MS = 48;
/** No step for this long: the walk is over (a stall or a cut the scene never reported). */
export const WALK_STALE_MS = 3000;
/** The longest time one frame update may advance the cycle by (a pause, a long frame). */
export const WALK_MAX_DT_MS = 120;
const CADENCE_RANGE = [30, 160];
const hexInt = (hex) => parseInt(hex.slice(1), 16) >>> 0;

/**
 * Gait by move type (data/classes.json `moveType`): how often the idle frame changes at
 * Normal step speed (`cadenceMs`), and how high the hop (`bobPx`) or glide goes. A flier
 * has a slow `periodMs` swell instead of a hop; heavy armour lands lower, a mount quicker.
 */
export const WALK_PROFILES = Object.freeze({
  Infantry: Object.freeze({ gait: 'step', cadenceMs: 100, bobPx: 1.5 }),
  Armored: Object.freeze({ gait: 'step', cadenceMs: 110, bobPx: 1 }),
  Cavalry: Object.freeze({ gait: 'step', cadenceMs: 90, bobPx: 1 }),
  Flying: Object.freeze({ gait: 'glide', cadenceMs: 110, bobPx: 1, periodMs: 520 }),
});

export function walkProfile(moveType) {
  return WALK_PROFILES[moveType] || WALK_PROFILES.Infantry;
}

/**
 * Does a step of `stepMs` get the walk treatment? Not under reduced motion, not at Instant
 * battle speed (a player's or Canto's tile tween keeps its 80 ms at every speed, so the
 * step's time alone cannot tell), and not when the step is too short to read.
 */
export function walkAllowed({ reduced = false, stepMs = WALK_STEP_MS, speed = 'normal' } = {}) {
  return !reduced && speed !== 'instant' && Number.isFinite(stepMs) && stepMs >= WALK_MIN_STEP_MS;
}

/**
 * Milliseconds per idle frame while a step takes `stepMs`: the profile's cadence scaled
 * with the step's own time, so Fast (half-length steps) cycles twice as quickly.
 */
export function stepCadenceMs(stepMs, profile = WALK_PROFILES.Infantry) {
  const scaled = (profile.cadenceMs * stepMs) / WALK_STEP_MS;
  return Math.round(Math.min(CADENCE_RANGE[1], Math.max(CADENCE_RANGE[0], scaled)));
}

/** The cycle's phase (in frames) after `dtMs` more at `cadenceMs` per frame. */
export function advanceWalkPhase(phase, dtMs, cadenceMs) {
  if (!(dtMs > 0) || !(cadenceMs > 0)) return phase;
  return phase + Math.min(dtMs, WALK_MAX_DT_MS) / cadenceMs;
}

/** The idle frame a phase shows (`frames`: the sprite's idle frame names, in order). */
export function walkFrameName(phase, frames) {
  if (!frames?.length) return null;
  const n = frames.length;
  const i = Math.floor(Number.isFinite(phase) ? phase : 0);
  return frames[((i % n) + n) % n];
}

const clamp01 = (v) => (v <= 0 || !Number.isFinite(v) ? 0 : v >= 1 ? 1 : v);

/** The hop's lift in whole world px at `progress` (0..1) of one tile: an arch, 0 at both ends. */
export function stepLift(progress, bobPx) {
  if (!(bobPx > 0)) return 0;
  return Math.round(bobPx * Math.sin(Math.PI * clamp01(progress)));
}

/** A flier's glide lift in whole world px: a slow swell about the flight line. */
export function glideLift(elapsedMs, bobPx, periodMs) {
  if (!(bobPx > 0) || !(periodMs > 0) || !Number.isFinite(elapsedMs)) return 0;
  return Math.round(bobPx * Math.sin((2 * Math.PI * elapsedMs) / periodMs));
}

/** Is the unit between steps' ends (walking), or past the last step's time (standing)? */
export function isStriding(now, stepStart, stepMs) {
  return now - stepStart <= stepMs + WALK_GRACE_MS;
}

/** Has the walk gone quiet: no step began for WALK_STALE_MS? */
export function isStale(now, stepStart) {
  return now - stepStart > WALK_STALE_MS;
}

/**
 * The pose at a moment of a walk: whether the idle cycle runs (`cycling`) and the lift in
 * world px. A slide is a glide (no hop, no cycle); a unit past its step's end stands still.
 * @param {{profile: object, now: number, startMs: number, stepStart: number, stepMs: number, slide?: boolean}} s
 */
export function walkPose({ profile, now, startMs, stepStart, stepMs, slide = false }) {
  if (slide || !isStriding(now, stepStart, stepMs)) return { cycling: false, lift: 0 };
  if (profile.gait === 'glide')
    return { cycling: true, lift: glideLift(now - startMs, profile.bobPx, profile.periodMs) };
  const progress = stepMs > 0 ? (now - stepStart) / stepMs : 1;
  return { cycling: true, lift: stepLift(progress, profile.bobPx) };
}

/**
 * May the landing puff be drawn? Not under reduced motion, on low effects quality, at
 * Instant speed, for a flier, or on a tile the player cannot see.
 */
export function puffAllowed({ reduced, quality, speed, gait, seen }) {
  return !reduced && quality !== 'low' && speed !== 'instant' && gait === 'step' && Boolean(seen);
}

// ------------------------------------------------------------------ landing puff --

const R = ART_RAMPS;
const ramp = (name, ...at) => at.map((i) => hexInt(R[name][i]));

/**
 * Puff families. Every one is a handful of pooled motes (`count`) thrown `spread` px
 * sideways and `rise` px up (negative `rise` falls), over `lifeMs`; `colors` is the
 * mote's colour ramp (young -> old), `ring` places them on a ring that widens (a splash).
 */
export const PUFF_STYLES = Object.freeze({
  dust: {
    count: 5,
    colors: ramp('earth', 5, 4, 3),
    blend: 'normal',
    size: 1,
    spread: 11,
    rise: 4,
    lifeMs: 340,
    alpha: [0.75, 0],
  },
  sand: {
    count: 5,
    colors: [hexInt(R.earth[5]), hexInt(R.ember[3]), hexInt(R.earth[3])],
    blend: 'normal',
    size: 1,
    spread: 12,
    rise: 4,
    lifeMs: 340,
    alpha: [0.8, 0],
  },
  stone: {
    count: 4,
    colors: ramp('stone', 5, 4, 3),
    blend: 'normal',
    size: 0,
    spread: 9,
    rise: 3,
    lifeMs: 300,
    alpha: [0.75, 0],
  },
  ash: {
    count: 5,
    colors: [MOTE_COLORS.ash, MOTE_COLORS.ashDim, MOTE_COLORS.ink],
    blend: 'normal',
    size: 1,
    spread: 10,
    rise: 6,
    lifeMs: 380,
    alpha: [0.7, 0],
  },
  snow: {
    count: 6,
    colors: [R.ink[11], R.ink[10], R.steel[5]].map(hexInt),
    blend: 'normal',
    size: 1,
    spread: 11,
    rise: 6,
    lifeMs: 420,
    alpha: [0.95, 0],
  },
  leaves: {
    count: 4,
    colors: [R.verdigris[5], R.verdigris[4], R.earth[3]].map(hexInt),
    blend: 'normal',
    size: 0,
    spread: 9,
    rise: -7,
    lifeMs: 560,
    alpha: [1, 0],
    sway: 3,
  },
  splash: {
    count: 6,
    colors: [R.steel[5], R.steel[4], R.steel[3]].map(hexInt),
    blend: 'normal',
    size: 0,
    spread: 13,
    rise: 1,
    lifeMs: 380,
    alpha: [0.95, 0],
    ring: true,
  },
  mire: {
    count: 5,
    colors: [R.earth[4], R.verdigris[2], R.earth[2]].map(hexInt),
    blend: 'normal',
    size: 0,
    spread: 12,
    rise: 1,
    lifeMs: 400,
    alpha: [0.9, 0],
    ring: true,
  },
  sparks: {
    count: 3,
    colors: [MOTE_COLORS.emberHot, MOTE_COLORS.ember, MOTE_COLORS.emberDim],
    blend: 'add',
    size: 0,
    spread: 6,
    rise: 10,
    lifeMs: 360,
    alpha: [1, 0],
  },
});

/** The knock-back ground reaction (fxFamilies.dustKeyFor) each puff family agrees with. */
const FAMILY_BY_DUST_KEY = Object.freeze({
  fx_dust: 'dust',
  fx_dust_sand: 'sand',
  fx_dust_stone: 'stone',
  fx_dust_ash: 'ash',
  fx_dust_snow: 'snow',
  fx_dust_leaves: 'leaves',
  fx_dust_splash: 'splash',
  fx_dust_mire: 'mire',
  fx_dust_sparks: 'sparks',
});

/**
 * The puff family for the terrain a unit lands on (data/terrain.json `name`) in a map's
 * biome: dust on plains, roads and villages, leaf bits in forest, a splash ring in water,
 * a mire ring in swamp and bog, a snow puff on ice and on a tundra's ground. It is the
 * ground the knock-back dust already reads (fxFamilies.dustKeyFor), so the two agree.
 */
export function puffFamilyFor(terrainName, biome = null) {
  return FAMILY_BY_DUST_KEY[dustKeyFor(terrainName, biome)] || 'dust';
}

/**
 * The motes of one puff at (x, y) (the unit's feet), as FxMotePool spawn specs. `rand` is
 * a seeded generator (never Math.random); `lifeScale` scales lifetimes (battle speed).
 */
export function puffMotes(family, x, y, rand, lifeScale = 1) {
  const style = PUFF_STYLES[family] || PUFF_STYLES.dust;
  const motes = [];
  const start = rand() * Math.PI * 2;
  for (let i = 0; i < style.count; i++) {
    let angle;
    let radius = 0;
    if (style.ring) {
      angle = start + (i / style.count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      radius = 3;
    } else {
      // fan out to both sides of the feet, never straight up
      const side = i % 2 === 0 ? -1 : 1;
      angle = side < 0 ? Math.PI * (0.78 + 0.18 * rand()) : Math.PI * (0.04 + 0.18 * rand());
    }
    const reach = style.spread * (0.55 + 0.45 * rand());
    const rise = style.rise * (0.6 + 0.8 * rand());
    motes.push({
      x: x + Math.cos(angle) * radius,
      y: y + Math.sin(angle) * radius * 0.5,
      dx: Math.cos(angle) * reach,
      // a ring is a flat ellipse on the ground; a fan lifts and settles
      dy: style.ring ? Math.sin(angle) * reach * 0.5 : -rise,
      curve: 1,
      sway: style.sway ? style.sway * (0.6 + 0.8 * rand()) : 0,
      cycles: style.sway ? 1 + rand() : 0,
      phase: rand() * Math.PI * 2,
      lifeMs: Math.max(1, Math.round(style.lifeMs * (0.8 + 0.4 * rand()) * lifeScale)),
      size: style.size,
      colors: style.colors,
      alpha: style.alpha,
      blend: style.blend,
    });
  }
  return motes;
}
