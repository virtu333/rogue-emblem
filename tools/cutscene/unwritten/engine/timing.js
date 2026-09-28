// Anime timing as pure functions of time. Everything else in a shot reads its time
// through these, so one hit can freeze figures, particles and rain together and a hold
// can drop to threes, while the music keeps its own clock.
//
//   hit-stop   On a hit, the action freezes for a few frames, then catches up over a
//              short stretch (tsume). It ends back in sync with the score, so later
//              hits still land on the drum.
//   holds      A drawing held on threes (8 a second) reads heavier than twos: for
//              stillness and tension.

import { clamp } from './raster.js';

const FRAME = 1 / 24;

/**
 * Action time under hit-stops. stops: [{ t, hold = 3 frames, catch = 4 frames }].
 * In [t, t + hold) the action is frozen at t. Over the next `catch` it runs fast
 * (1 + hold/catch times) to make up the lost time, so from t + hold + catch on the
 * action time equals the score time again.
 */
export function hitStop(t, stops) {
  let a = t;
  for (const s of stops) {
    const hold = (s.hold ?? 3) * FRAME;
    const cat = (s.catch ?? 4) * FRAME;
    if (t < s.t || t >= s.t + hold + cat) continue;
    if (t < s.t + hold) a = s.t;
    else {
      const u = (t - s.t - hold) / cat; // 0..1 through the catch-up
      a = s.t + (hold + cat) * u;
    }
  }
  return a;
}

/** True while t is inside a hit-stop's frozen frames (for flash and impact frames). */
export const inStop = (t, stops) => stops.some((s) => t >= s.t && t < s.t + (s.hold ?? 3) * FRAME);

/** t held on ones, twos or threes (drawings per 24). */
export const onN = (t, n = 2) => Math.floor((t * 24) / n) * (n / 24);

/**
 * Slow motion over [t0, t1] at `rate` (0.2 = five times slower), easing in and out over
 * `ease` s so the change doesn't jump. Returns action time; after t1 it keeps the lag,
 * so use it for a shot that ends inside the slow stretch or accepts the offset.
 */
export function slowMo(t, t0, t1, rate, ease = 0.08) {
  if (t <= t0) return t;
  const r = (x) => {
    // the local rate at time x: 1 outside, `rate` inside, eased at the edges
    const kin = clamp((x - t0) / ease);
    const kout = clamp((t1 - x) / ease);
    const k = Math.min(kin, kout);
    return 1 + (rate - 1) * k;
  };
  // integrate the rate from t0 to min(t, t1) (Simpson over small steps: cheap, exact enough)
  const end = Math.min(t, t1);
  const n = Math.max(2, Math.ceil((end - t0) / 0.01) & ~1);
  const h = (end - t0) / n;
  let s = r(t0) + r(end);
  for (let i = 1; i < n; i++) s += r(t0 + i * h) * (i % 2 ? 4 : 2);
  const inside = (s * h) / 3;
  return t0 + inside + Math.max(0, t - t1);
}

/**
 * Anticipation, snap, overshoot, settle: a 0..1 progress for a key-to-key move of
 * duration d starting at t0. The first `ant` of the time pulls back a little; the snap
 * is fast; it overshoots by `over` and settles. Stepped on `n`s (drawings, not tweens).
 */
export function keyMove(t, t0, d, { ant = 0.25, back = 0.08, over = 0.06, n = 2 } = {}) {
  const u = clamp((onN(t, n) - t0) / d);
  if (u < ant) return -back * Math.sin((Math.PI * u) / ant / 2) ** 2;
  const v = (u - ant) / (1 - ant);
  if (v < 0.35) {
    const k = v / 0.35;
    return -back + (1 + over + back) * (1 - (1 - k) ** 3);
  }
  const k = (v - 0.35) / 0.65;
  return 1 + over * (1 - k) ** 2 * Math.cos(k * Math.PI * 1.5);
}
