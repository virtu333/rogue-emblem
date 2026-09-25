// deathDissolve — "fading to embers" as pure pixel math (no Phaser, unit-testable).
//
// A fallen unit's own sprite pixels break up in small blocks. Each opaque block gets
// a threshold from seeded value noise plus a bias (the top lifts away first; the
// Entity collapses inward from its rim). As progress rises, blocks past their
// threshold vanish and the blocks just ahead of the front burn at the style's edge
// colour. A capped, deterministic subset of blocks leaves as ember motes carrying the
// block's own colour.
import { fxRandom } from './strikePlan.js';

function hash2(x, y, seed) {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, period, seed) {
  const fx = x / period;
  const fy = y / period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  let tx = fx - x0;
  let ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * Build the dissolve for a frame's pixels.
 * @param {Uint8ClampedArray|Uint8Array} rgba  frame pixels (w*h*4)
 * @param {object} opts { block (px), seed, inward (Entity) }
 * @returns {{ w, h, block, bw, bh, thr: Float32Array, blocks: Array }}
 */
export function buildDissolve(rgba, w, h, { block = 2, seed = 1, inward = false } = {}) {
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const thr = new Float32Array(bw * bh).fill(-1);
  const blocks = [];
  let minY = bh;
  let maxY = -1;
  const opaque = new Uint8Array(bw * bh);
  const colors = new Uint32Array(bw * bh);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = by * block; y < Math.min(h, (by + 1) * block); y++)
        for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x++) {
          const i = (y * w + x) * 4;
          if (rgba[i + 3] < 128) continue;
          n++;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
        }
      if (!n) continue;
      const k = by * bw + bx;
      opaque[k] = 1;
      colors[k] = ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
      if (by < minY) minY = by;
      if (by > maxY) maxY = by;
    }
  const span = Math.max(1, maxY - minY);
  const cx = bw / 2;
  const cy = (minY + maxY) / 2;
  const maxR = Math.hypot(bw / 2, span / 2) || 1;
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const k = by * bw + bx;
      if (!opaque[k]) continue;
      const noise = valueNoise(bx, by, 3, seed) * 0.7 + hash2(bx, by, seed + 7) * 0.3;
      let bias;
      if (inward) bias = 1 - Math.min(1, Math.hypot(bx - cx, by - cy) / maxR);
      else bias = (by - minY) / span; // top (0) leaves first
      const t = Math.min(0.98, Math.max(0, noise * 0.55 + bias * 0.45));
      thr[k] = t;
      blocks.push({ k, bx, by, t, color: colors[k] });
    }
  return { w, h, block, bw, bh, thr, blocks };
}

/**
 * Paint the dissolve at `progress` (0..1) into `out` (RGBA, same size as `src`).
 * Blocks within `band` ahead of the front burn with `edge` (0xRRGGBB).
 */
export function paintDissolve(d, src, out, progress, edge, band = 0.12) {
  const { w, h, block, bw, thr } = d;
  const er = (edge >> 16) & 255;
  const eg = (edge >> 8) & 255;
  const eb = edge & 255;
  for (let y = 0; y < h; y++) {
    const by = (y / block) | 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = thr[by * bw + ((x / block) | 0)];
      if (src[i + 3] < 128 || t < 0 || t < progress) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      } else if (t < progress + band && progress > 0) {
        out[i] = er;
        out[i + 1] = eg;
        out[i + 2] = eb;
        out[i + 3] = 255;
      } else {
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = src[i + 3];
      }
    }
  }
}

/**
 * Pick at most `budget` blocks to leave as motes, spread over the dissolve (sorted by
 * the time they burn away). Deterministic for a seed.
 */
export function pickMotes(d, budget, seed) {
  if (budget <= 0 || !d.blocks.length) return [];
  const rand = fxRandom(seed);
  const ranked = d.blocks.map((b) => ({ b, r: rand() })).sort((a, z) => a.r - z.r);
  return ranked
    .slice(0, Math.min(budget, ranked.length))
    .map(({ b }) => b)
    .sort((a, z) => a.t - z.t || a.k - z.k);
}
