/**
 * screenShake — the pure plan for a camera shake (presentation only).
 *
 * A shake is a precomputed list of whole-pixel x/y offsets, one per SHAKE_STEP_MS, drawn
 * from its own seeded generator and shrinking to nothing: the last sample, and every
 * moment at or after the duration, is exactly (0, 0). It never touches Math.random (during
 * a battle that IS the battle RNG: Phaser's own camera.shake draws it every frame, which
 * is why the engine's shake is not used) and never reads the clock; the controller that
 * plays it (ui/ScreenShakeController.js) samples it by elapsed time.
 *
 * The plan is a pure function of (seed, intensity, durationMs), so the same hit shakes
 * the same way every time it is shown.
 */

import { createSeededRng } from '../../engine/BlessingEngine.js';
import { fxSeed } from './strikePlan.js';

/** One offset per this many milliseconds (a 60 Hz frame). */
export const SHAKE_STEP_MS = 16;

/** Hard ceilings: a shake is a few pixels over a fraction of a second, whatever asks. */
export const MAX_SHAKE_PX = 6;
export const MIN_SHAKE_MS = 60;
export const MAX_SHAKE_MS = 400;

/**
 * The named shakes: peak offset in pixels and length in milliseconds (before the battle
 * speed scales the length). Small for a crit, larger for a stone break or the Entity's
 * splash.
 */
export const SHAKE_KINDS = Object.freeze({
  crit: Object.freeze({ intensity: 2, durationMs: 160 }),
  boss: Object.freeze({ intensity: 3, durationMs: 200 }),
  crash: Object.freeze({ intensity: 3, durationMs: 220 }),
  splash: Object.freeze({ intensity: 4, durationMs: 260 }),
  stone: Object.freeze({ intensity: 4, durationMs: 320 }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** A whole number, and never negative zero. */
function whole(value) {
  return Math.round(value) || 0;
}

/**
 * How much of the peak is left `fraction` (0..1) of the way through: 1 at the start, 0 at
 * the end, falling faster than linear so the tail settles instead of buzzing.
 */
export function shakeEnvelope(fraction) {
  const f = clamp(Number.isFinite(fraction) ? fraction : 1, 0, 1);
  return (1 - f) * (1 - f);
}

/**
 * Plan a shake. `intensity` is the peak offset in pixels (clamped to MAX_SHAKE_PX),
 * `durationMs` its length (clamped to MIN_SHAKE_MS..MAX_SHAKE_MS). Returns
 * `{ seed, intensity, durationMs, stepMs, offsets: [{ x, y }] }`; `offsets` ends with
 * (0, 0). Zero or invalid intensity gives a plan with no offsets (nothing to play).
 */
export function planShake({ seed = 0, intensity = 0, durationMs = 0 } = {}) {
  const peak = clamp(Number.isFinite(intensity) ? intensity : 0, 0, MAX_SHAKE_PX);
  const length = clamp(
    Number.isFinite(durationMs) ? durationMs : 0,
    peak > 0 ? MIN_SHAKE_MS : 0,
    MAX_SHAKE_MS,
  );
  const plan = { seed: seed >>> 0, intensity: peak, durationMs: length, stepMs: SHAKE_STEP_MS };
  if (peak <= 0 || length <= 0) return { ...plan, offsets: [] };
  const rng = createSeededRng(plan.seed);
  const steps = Math.max(2, Math.ceil(length / SHAKE_STEP_MS));
  const offsets = [];
  // Each sample swings against the last on both axes (a jolt, not a drift), by a random
  // share of the envelope, so the camera never wanders to one side.
  let signX = rng() < 0.5 ? -1 : 1;
  let signY = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < steps; i++) {
    const amp = peak * shakeEnvelope(i / steps);
    signX = -signX;
    signY = -signY;
    offsets.push({
      x: whole(signX * amp * (0.5 + 0.5 * rng())),
      y: whole(signY * amp * (0.5 + 0.5 * rng())),
    });
  }
  offsets.push({ x: 0, y: 0 });
  return { ...plan, offsets };
}

/** The offset `elapsedMs` into a plan: the nearest earlier sample, exactly 0 at the end. */
export function shakeOffsetAt(plan, elapsedMs) {
  const offsets = plan?.offsets;
  if (!offsets?.length || !(elapsedMs >= 0) || elapsedMs >= plan.durationMs) return { x: 0, y: 0 };
  const index = Math.min(offsets.length - 1, Math.floor(elapsedMs / plan.stepMs));
  const { x, y } = offsets[index];
  return { x, y };
}

/** A seed for the nth shake of a kind (pure; the controller counts its shakes). */
export function shakeSeed(kind, n = 0) {
  return fxSeed('screen-shake', kind, n);
}
