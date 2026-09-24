// Ordered dithering between the two nearest palette colours (pure).
//
// A pixel is dithered only when its two nearest colours are *near* each other
// (short OKLab distance, compatible hue, and the pixel lies close to the
// segment between them); otherwise it snaps to the nearest colour. This keeps
// gradients as checker/25% textures and forbids cross-hue speckle.
// The mix ratio is quantized to PC-98 pattern levels, so only a handful of
// textures ever appear: solid, 25% dots, 50% checker (and their mirrors).
import { bayer } from './raster.mjs';
import { chroma, hue, hueDiff, labDist } from './color.mjs';

export const MATERIAL = Object.freeze({ CLOTH: 0, SKIN: 1, FLAT: 2 });

/** Mix ratio t in [0, 0.5] -> pattern level for a material. */
export function quantizeMix(t, material) {
  if (material === MATERIAL.FLAT) return 0;
  if (material === MATERIAL.SKIN) return t >= 0.36 ? 0.5 : 0;
  if (t < 0.14) return 0;
  if (t < 0.36) return 0.25;
  return 0.5;
}

/** Whether two palette colours may be mixed by a dither pattern. */
export function canMix(p, q, nearDist) {
  const d = labDist(p, q);
  if (d > nearDist) return false;
  const cp = chroma(p);
  const cq = chroma(q);
  if (cp > 0.045 && cq > 0.045 && hueDiff(hue(p), hue(q)) > 38) return false;
  return true;
}

/**
 * Assign every masked pixel a palette index, dithering near pairs.
 *
 * Phase 1 finds each pixel's nearest pair and pattern level; phase 2 makes
 * levels coherent (mode filter among neighbours mixing the same pair) so a
 * gradient becomes clean bands of one texture instead of scattered dots;
 * phase 3 thresholds against the global Bayer grid (patterns of adjacent
 * regions stay in phase, as on real PC-98 screens).
 * @param {{w:number,h:number,L:Float32Array,A:Float32Array,B:Float32Array,mask:Uint8Array}} img
 * @param {Array<{lab:number[]}>} palette candidate colours (ink excluded)
 * @param {Uint8Array} materials per-pixel MATERIAL
 * @returns {{index: Int16Array, dithered: Uint8Array}} index -1 = transparent
 */
export function assignDithered(img, palette, materials, { nearDist = 0.13, coherence = 2 } = {}) {
  const { w, h, L, A, B, mask } = img;
  const n = w * h;
  const lo = new Int16Array(n).fill(-1); // lower palette index of the pair (or the solid colour)
  const hi = new Int16Array(n).fill(-1); // higher index (-1 = solid)
  let mix = new Float32Array(n); // share of `hi` (0 .. 1)
  const labs = palette.map((p) => p.lab);
  const mixable = labs.map((p) => labs.map((q) => canMix(p, q, nearDist)));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (!mask[o]) continue;
      const l = L[o];
      const a = A[o];
      const b = B[o];
      let i1 = 0;
      let i2 = -1;
      let d1 = Infinity;
      let d2 = Infinity;
      for (let c = 0; c < labs.length; c++) {
        const q = labs[c];
        const d = (q[0] - l) ** 2 + (q[1] - a) ** 2 + (q[2] - b) ** 2;
        if (d < d1) {
          d2 = d1;
          i2 = i1;
          d1 = d;
          i1 = c;
        } else if (d < d2) {
          d2 = d;
          i2 = c;
        }
      }
      lo[o] = i1;
      if (i2 < 0 || i2 === i1 || !mixable[i1][i2]) continue;
      const c1 = labs[i1];
      const c2 = labs[i2];
      const v = [c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]];
      const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      if (vv < 1e-9) continue;
      let t = ((l - c1[0]) * v[0] + (a - c1[1]) * v[1] + (b - c1[2]) * v[2]) / vv;
      t = Math.min(1, Math.max(0, t));
      const perp = Math.sqrt(
        (l - c1[0] - t * v[0]) ** 2 + (a - c1[1] - t * v[1]) ** 2 + (b - c1[2] - t * v[2]) ** 2,
      );
      if (perp > 0.7 * Math.sqrt(vv)) continue;
      const level = quantizeMix(Math.min(t, 0.5), materials ? materials[o] : MATERIAL.CLOTH);
      if (level <= 0) continue;
      lo[o] = Math.min(i1, i2);
      hi[o] = Math.max(i1, i2);
      mix[o] = i1 < i2 ? level : 1 - level;
    }
  // Phase 2: coherent levels.
  for (let pass = 0; pass < coherence; pass++) {
    const next = Float32Array.from(mix);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = y * w + x;
        if (hi[o] < 0) continue;
        const counts = new Map();
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = yy * w + xx;
            if (!mask[q]) continue;
            let m = null;
            if (lo[q] === lo[o] && hi[q] === hi[o]) m = mix[q];
            else if (hi[q] < 0 && lo[q] === lo[o]) m = 0;
            else if (hi[q] < 0 && lo[q] === hi[o]) m = 1;
            if (m === null) continue;
            counts.set(m, (counts.get(m) || 0) + (dx === 0 && dy === 0 ? 1.5 : 1));
          }
        let best = mix[o];
        let bestC = counts.get(best) || 0;
        for (const [m, c] of counts)
          if (c > bestC) {
            best = m;
            bestC = c;
          }
        next[o] = best;
      }
    mix = next;
  }
  const index = new Int16Array(n).fill(-1);
  const dithered = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (!mask[o]) continue;
      if (hi[o] < 0 || mix[o] <= 0 || mix[o] >= 1) {
        index[o] = hi[o] >= 0 && mix[o] >= 1 ? hi[o] : lo[o];
        continue;
      }
      dithered[o] = 1;
      index[o] = mix[o] > bayer(x, y) ? hi[o] : lo[o];
    }
  return { index, dithered };
}

/**
 * Remove orphan pixels outside dither zones: a pixel whose colour appears in
 * none of its 4 neighbours, all of which agree, takes their colour.
 */
export function despeckle(index, dithered, w, h) {
  const out = Int16Array.from(index);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const o = y * w + x;
      if (out[o] < 0 || dithered[o]) continue;
      const n = [index[o - 1], index[o + 1], index[o - w], index[o + w]];
      if (n.some((v) => v < 0)) continue;
      if (n.every((v) => v === n[0]) && n[0] !== index[o]) {
        const diag = [index[o - w - 1], index[o - w + 1], index[o + w - 1], index[o + w + 1]];
        // A lone pixel in a checker is part of a pattern; keep those.
        if (diag.every((v) => v === index[o])) continue;
        out[o] = n[0];
      }
    }
  return out;
}
