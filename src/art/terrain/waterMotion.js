// Moving water for the painted battlefield (pure: no DOM, no Phaser, no Math.random).
//
// The painted river is a still image with a few palette-cycled glints (shimmer.js).
// This adds the motion a river needs to read as one: short wave streaks that drift
// along their row, and foam that laps at the banks. Like the shimmer it never repaints
// terrain: each frame recolours water pixels on the same small transparent overlay,
// from the buffers the painter already keeps (`mat` and `idx` for where open water is, `owner` for an
// object over it, the `d*` fields for how near a bank is).
//
// Everything is a function of the pixel, the seed and the time, so the same battle
// shows the same water and nothing here can touch the battle's random stream.
import { G } from './biomes.js';
import { R, PALETTE_RGBA32, rampPosition } from './palette.js';

export const WATER_MOTION = Object.freeze({
  frameMs: 125, // 8 fps, the shimmer's rate
  streakEvery: 3, // about one row in this many carries streaks
  minPeriod: 19,
  periodSpan: 14,
  minLength: 3,
  lengthSpan: 4,
  minSpeed: 5, // art px per second
  speedSpan: 7,
  patchMs: 2600, // how long a patch of streaks stays lit
  foamMs: 1500,
});

/** A 32-bit integer hash of two coordinates and a seed (no state). */
export function hash3(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Collect the pixels of open water: where they are and how far the nearest bank is.
 * @returns {{ count:number, index:Int32Array, x:Uint16Array, y:Uint16Array, shore:Uint8Array, seed:number }}
 */
export function collectWater(state) {
  const { W, H, mat, owner, idx, dU, dD, dL, dR } = state;
  // Open water only: a bridge deck or a decal painted over the river keeps its pixels.
  const open = (i) => mat[i] === G.WATER && !owner[i] && rampPosition(idx[i])?.[0] === 'tide';
  let count = 0;
  for (let i = 0; i < W * H; i++) if (open(i)) count++;
  const out = {
    count,
    index: new Int32Array(count),
    x: new Uint16Array(count),
    y: new Uint16Array(count),
    shore: new Uint8Array(count),
    seed: state.seed | 0,
  };
  let k = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!open(i)) continue;
      out.index[k] = i;
      out.x[k] = x;
      out.y[k] = y;
      out.shore[k] = Math.min(dU[i], dD[i], dL[i], dR[i], 255);
      k++;
    }
  return out;
}

const STREAK = PALETTE_RGBA32[R('tide', 5)];
const CREST = PALETTE_RGBA32[R('tide', 6)];
const FOAM = PALETTE_RGBA32[R('tide', 7)];
const FOAM_SOFT = PALETTE_RGBA32[R('tide', 6)];

/**
 * Write one frame of water into an RGBA overlay (Uint32 view). Every open-water pixel
 * is written: a colour where a streak or foam shows, transparent where the painted
 * water shows through.
 * @returns {number} lit pixels
 */
export function waterFrame(water, out32, timeMs, cfg = WATER_MOTION) {
  const { count, index, x, y, shore, seed } = water;
  const t = Math.max(0, timeMs);
  const patchStep = Math.floor(t / cfg.patchMs);
  const patchMix = (t % cfg.patchMs) / cfg.patchMs;
  const foamStep = t / cfg.foamMs;
  let lit = 0;
  for (let k = 0; k < count; k++) {
    const px = x[k];
    const py = y[k];
    const bank = shore[k];
    let color = 0;
    if (bank <= 2) {
      // Foam laps in and out along the bank, in runs a few pixels long.
      const run = hash3(px >> 2, py >> 2, seed);
      const phase = (foamStep + (run & 1023) / 1024) % 1;
      const reach = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0..1..0
      if (bank === 1 ? reach > 0.3 : reach > 0.78) color = bank === 1 ? FOAM : FOAM_SOFT;
    } else {
      const row = hash3(0, py, seed);
      if (row % cfg.streakEvery === 0) {
        const period = cfg.minPeriod + ((row >>> 4) % cfg.periodSpan);
        const length = cfg.minLength + ((row >>> 9) % cfg.lengthSpan);
        const speed = cfg.minSpeed + ((row >>> 13) % cfg.speedSpan);
        const drift = Math.floor((t * speed) / 1000);
        const at = (((px + drift + (row >>> 18)) % period) + period) % period;
        if (at < length) {
          // Streaks show in slow patches, so the river glitters in places, not in bars.
          const cx = (px + drift) >> 4;
          const a = hash3(cx, py >> 3, seed + patchStep) & 255;
          const b = hash3(cx, py >> 3, seed + patchStep + 1) & 255;
          const glow = a + (b - a) * patchMix;
          if (glow > 146) color = at === length - 1 && glow > 200 ? CREST : STREAK;
        }
      }
    }
    out32[index[k]] = color;
    if (color) lit++;
  }
  return lit;
}
