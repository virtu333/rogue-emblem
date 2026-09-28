// Transitions between two rendered frames A (leaving) and B (arriving), and the page
// tricks that belong to a book: a page turning (forward, or back when Sera rewinds), an
// ink blot that becomes the next painting, a ring of burning paper, the page cracking
// with gold light behind it, and manga panels cut from the page.
//
// All take RGBA buffers the size of the screen and write `out` (which may be A).

import { bayer, clamp, fbm, hash, hexToRgb } from './raster.js';
import { C } from './palette.js';

const SEPIA = hexToRgb(C.sepia);
const INK = hexToRgb(C.ink);
const GOLD = hexToRgb(C.gold);
const GOLD_HI = hexToRgb(C.goldHi);
const GOLD_W = hexToRgb(C.goldWhite);
const PAPER_BACK = [206, 199, 190];

const copyPx = (out, o, src, so, k = 1) => {
  out[o] = src[so] * k;
  out[o + 1] = src[so + 1] * k;
  out[o + 2] = src[so + 2] * k;
  out[o + 3] = src.length > 4 ? src[so + 3] : 255; // (keeps the skin flag)
};

/**
 * A page turn. The leaf carrying A folds over along a line that sweeps across the frame,
 * showing its paper back, and B is the next page underneath.
 *   dir 'fwd'  the leaf lifts from the bottom-right corner and goes left (reading on)
 *   dir 'back' it lifts from the bottom-left corner and goes right (turning back)
 * p: 0..1. The back of the leaf shows A's ink faintly through the paper, mirrored.
 */
export function pageTurn(out, A, B, fw, fh, p, o = {}) {
  const back = o.dir === 'back';
  const tilt = o.tilt ?? 0.32;
  let dx = back ? 1 : -1;
  let dy = -tilt;
  const L = Math.hypot(dx, dy);
  dx /= L;
  dy /= L;
  const ex = back ? 0 : fw;
  const ey = fh;
  // the farthest point of the page from the starting corner
  let qmax = 0;
  for (const [x, y] of [
    [0, 0],
    [fw, 0],
    [0, fh],
    [fw, fh],
  ])
    qmax = Math.max(qmax, (x - ex) * dx + (y - ey) * dy);
  const f = clamp(p) * qmax * 1.02;
  const res = out === A || out === B ? new Uint8ClampedArray(out.length) : out;
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const o2 = (y * fw + x) * 4;
      const q = (x - ex) * dx + (y - ey) * dy;
      if (q < f) {
        // B, in the shadow of the leaf near the fold
        copyPx(res, o2, B, o2, f - q < 9 ? 0.62 + 0.38 * ((f - q) / 9) : 1);
        continue;
      }
      if (q < 2 * f) {
        // the leaf: the paper back of the point of A mirrored across the fold
        const mx = Math.round(x - 2 * (q - f) * dx);
        const my = Math.round(y - 2 * (q - f) * dy);
        if (mx >= 0 && my >= 0 && mx < fw && my < fh) {
          const so = (my * fw + mx) * 4;
          const u = (q - f) / Math.max(1, f); // 0 at the fold .. 1 at the leaf's edge
          // curl shading: dark in the crease, a highlight across the bulge
          const shade =
            0.78 + 0.3 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.9) - (u < 0.04 ? 0.18 : 0);
          const L2 = (0.299 * A[so] + 0.587 * A[so + 1] + 0.114 * A[so + 2]) / 255;
          const bleed = L2 < 0.35 ? 0.16 : 0; // ink shows through the page
          for (let c = 0; c < 3; c++)
            res[o2 + c] = (PAPER_BACK[c] * (1 - bleed) + A[so + c] * bleed) * shade;
          res[o2 + 3] = 255;
          // the leaf's outer edge is a line
          if (2 * f - q < 1.2) copyPx(res, o2, [...SEPIA], 0);
          continue;
        }
      }
      // A, with the leaf's shadow falling on it just past the leaf's edge
      const d = q - 2 * f;
      copyPx(res, o2, A, o2, f > 0 && d < 6 ? 0.8 + 0.2 * (d / 6) : 1);
    }
  if (res !== out) out.set(res);
}

/**
 * An ink blot spreading from (cx, cy): inside it is B, its edge is wet sepia, and drops
 * are flung ahead of it.
 */
export function inkWipe(out, A, B, fw, fh, p, o = {}) {
  const { cx = fw / 2, cy = fh / 2, seed = 3, rough = 0.55 } = o;
  const R = Math.hypot(Math.max(cx, fw - cx), Math.max(cy, fh - cy)) * 1.25;
  const r = R * clamp(p) ** 1.25;
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const o2 = (y * fw + x) * 4;
      const d =
        Math.hypot(x - cx, (y - cy) * 1.2) / Math.max(1, r) +
        (fbm(x, y, seed, 26, 3) - 0.5) * rough;
      if (d < 0.93) copyPx(out, o2, B, o2);
      else if (d < 1) copyPx(out, o2, SEPIA, 0);
      else if (out !== A) copyPx(out, o2, A, o2);
    }
  // drops flung ahead of the blot
  for (let i = 0; i < 60; i++) {
    const a = hash(i, 1, seed) * Math.PI * 2;
    const dist = r * (1.05 + hash(i, 2, seed) * 0.5);
    const x = cx + Math.cos(a) * dist;
    const y = cy + (Math.sin(a) * dist) / 1.2;
    const rr = 0.8 + hash(i, 3, seed) * 2.5 * clamp(1 - p);
    for (let yy = -rr; yy <= rr; yy++)
      for (let xx = -rr; xx <= rr; xx++) {
        const X = (x + xx) | 0;
        const Y = (y + yy) | 0;
        if (xx * xx + yy * yy > rr * rr || X < 0 || Y < 0 || X >= fw || Y >= fh) continue;
        copyPx(out, (Y * fw + X) * 4, SEPIA, 0);
      }
  }
}

/**
 * A ring of the page burning outward from (cx, cy): behind the ring is B. The ring is
 * charred ink with a gold-white ember edge (the thread's fire, the one warm light).
 */
export function burnWipe(out, A, B, fw, fh, p, o = {}) {
  const { cx = fw / 2, cy = fh / 2, seed = 5 } = o;
  const R = Math.hypot(Math.max(cx, fw - cx), Math.max(cy, fh - cy)) * 1.1;
  const r = R * clamp(p);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const o2 = (y * fw + x) * 4;
      const d = Math.hypot(x - cx, y - cy) - r + (fbm(x, y, seed, 18, 3) - 0.5) * 26;
      if (d < -5) copyPx(out, o2, B, o2);
      else if (d < -2) copyPx(out, o2, bayer(x, y) < 0.5 ? GOLD_W : GOLD_HI, 0);
      else if (d < 0) copyPx(out, o2, GOLD, 0);
      else if (d < 5) copyPx(out, o2, d < 2.5 ? INK : SEPIA, 0);
      else if (d < 12) {
        // scorch: A darkening toward the fire
        const k = 1 - 0.45 * (1 - (d - 5) / 7);
        copyPx(out, o2, A, o2, bayer(x, y) < 0.6 ? k : 1);
      } else if (out !== A) copyPx(out, o2, A, o2);
    }
}

// ------------------------------------------------------------------ the page cracks

const shardCache = new Map();

/** Voronoi shards (jittered sites, denser near the impact) for a crack at (ix, iy). */
function shards(fw, fh, ix, iy, n, seed) {
  const key = `${fw}x${fh}:${ix},${iy}:${n}:${seed}`;
  if (shardCache.has(key)) return shardCache.get(key);
  const sites = [];
  for (let i = 0; i < n; i++) {
    const a = hash(i, 1, seed) * Math.PI * 2;
    const r = Math.hypot(fw, fh) * 0.75 * hash(i, 2, seed) ** 1.6;
    sites.push([ix + Math.cos(a) * r, iy + Math.sin(a) * r * 0.7]);
  }
  const id = new Int16Array(fw * fh);
  const lists = sites.map(() => []);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      // jitter the lookup a little so shard edges are ragged, like torn paper
      const jx = x + (fbm(x, y, seed + 9, 7, 2) - 0.5) * 7;
      const jy = y + (fbm(x, y, seed + 19, 7, 2) - 0.5) * 7;
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (jx - sites[i][0]) ** 2 + (jy - sites[i][1]) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      id[y * fw + x] = best;
      lists[best].push(y * fw + x);
    }
  // crack width: 2 near the impact, 1 farther out
  const edge = new Uint8Array(fw * fh);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const i = y * fw + x;
      if ((x + 1 < fw && id[i + 1] !== id[i]) || (y + 1 < fh && id[i + fw] !== id[i])) edge[i] = 2;
    }
  for (let y = 1; y < fh - 1; y++)
    for (let x = 1; x < fw - 1; x++) {
      const i = y * fw + x;
      if (edge[i] || Math.hypot(x - ix, y - iy) > 90) continue;
      if (edge[i - 1] === 2 || edge[i + fw] === 2) edge[i] = 1;
    }
  const s = { sites, id, lists, edge };
  shardCache.set(key, s);
  return s;
}

/**
 * The frozen frame A cracks from the impact point (ix, iy) and falls apart onto `under`.
 *   crack  0..1: how far the cracks have run (gold light shows through them)
 *   fall   seconds since the shards let go (0: still in place)
 *   drain  0..1: the colour going out of the shards
 */
export function shatter(out, A, under, fw, fh, ix, iy, crack, fall, o = {}) {
  const { n = 52, seed = 17 } = o;
  const S = shards(fw, fh, ix, iy, n, seed);
  const R = Math.hypot(fw, fh);
  const src = out === A ? A.slice() : A;
  out.set(under);
  // shards farthest from the impact go first; each drifts out and drops
  for (let i = 0; i < n; i++) {
    const [sx, sy] = S.sites[i];
    const dist = Math.hypot(sx - ix, sy - iy);
    const delay = (dist / R) * 0.5 + hash(i, 5, seed) * 0.25;
    const u = Math.max(0, fall - delay);
    const ang = Math.atan2(sy - iy, sx - ix);
    // once the cracks have run, the pieces part a little (the gaps show the bare page)
    const part = crack >= 1 ? 2 + Math.min(3, fall * 6) : 0;
    const ox = Math.cos(ang) * (u * 40 + part) + (hash(i, 6, seed) - 0.5) * u * 30;
    const oy = Math.sin(ang) * (u * 24 + part * 0.7) + 300 * u * u;
    const dark = 1 - Math.min(0.35, u * 0.5);
    const lst = S.lists[i];
    for (let k = 0; k < lst.length; k++) {
      const p = lst[k];
      const x = (p % fw) + Math.round(ox);
      const y = ((p / fw) | 0) + Math.round(oy);
      if (x < 0 || y < 0 || x >= fw || y >= fh) continue;
      const o2 = (y * fw + x) * 4;
      if (S.edge[p] && Math.hypot((p % fw) - ix, ((p / fw) | 0) - iy) < crack * R) {
        // the crack's lip is ink; for the first moments gold light shows through it
        const g =
          S.edge[p] === 1 || u > 0 || crack >= 1 ? INK : bayer(x, y) < 0.5 ? GOLD_W : GOLD_HI;
        out[o2] = g[0];
        out[o2 + 1] = g[1];
        out[o2 + 2] = g[2];
        out[o2 + 3] = 255;
        continue;
      }
      out[o2] = src[p * 4] * dark;
      out[o2 + 1] = src[p * 4 + 1] * dark;
      out[o2 + 2] = src[p * 4 + 2] * dark;
      out[o2 + 3] = src[p * 4 + 3];
    }
  }
}

// ------------------------------------------------------------------ manga panels

/** Is (x, y) inside the convex polygon pts (clockwise or not)? */
export function inPoly(pts, x, y) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Copy src into out inside polygon pts, with a `border` px ink frame line (a manga
 * panel). Pixels outside are left alone.
 */
export function copyPanel(out, src, fw, fh, pts, border = 2, color = SEPIA) {
  let x0 = fw;
  let y0 = fh;
  let x1 = 0;
  let y1 = 0;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(fw, Math.ceil(x1));
  y1 = Math.min(fh, Math.ceil(y1));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (!inPoly(pts, x + 0.5, y + 0.5)) continue;
      const o2 = (y * fw + x) * 4;
      let edge = false;
      if (border > 0)
        for (const [dx, dy] of [
          [border, 0],
          [-border, 0],
          [0, border],
          [0, -border],
        ])
          if (!inPoly(pts, x + 0.5 + dx, y + 0.5 + dy)) edge = true;
      if (edge) copyPx(out, o2, color, 0);
      else copyPx(out, o2, src, o2);
    }
}
