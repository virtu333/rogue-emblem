// lib.mjs — tiny pixel raster for the app-icon candidates (pure Node + sharp).
//
// Same drawing language as the title key art (src/art/keyart/hollowSun.js): a low-res
// plate painted from the Ink & Ember ramps with ordered (Bayer 4x4) dithering, then
// blown up nearest-neighbour. An icon plate is GRID x GRID art pixels (128 by default),
// shown at 1024 px, so one art pixel is an 8x8 block: pixel heritage up close, a smooth
// premium tile at home-screen size (a 180 px icon averages 1.4 art pixels per device px).

import sharp from 'sharp';
import { PALETTE } from '../../../src/art/keyart/hollowSun.js';

export { PALETTE };
export const INK = PALETTE.ink;
export const EMB = PALETTE.ember;
export const BLD = PALETTE.blood;
export const STL = PALETTE.steel;
export const VER = PALETTE.verdigris;
export const UNL = PALETTE.unlight;

/** The title sky ramp: violet zenith -> mauve -> rose-grey horizon (monotonic value). */
export const SKY = [
  INK[0],
  INK[1],
  UNL[0],
  UNL[1],
  INK[4],
  INK[5],
  INK[6],
  INK[7],
  INK[8],
  INK[9],
  INK[10],
  INK[11],
];
/** Dawn ramp: night ink -> crimson -> ember -> white-hot gold. */
export const DAWN = [
  INK[0],
  INK[1],
  UNL[0],
  BLD[0],
  BLD[1],
  EMB[1],
  EMB[2],
  EMB[3],
  EMB[4],
  EMB[5],
  EMB[6],
];
/** Gold metal ramp (dark to light). */
export const GOLD = [EMB[0], EMB[1], EMB[2], EMB[3], EMB[4], EMB[5], EMB[6]];

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Ordered-dither a continuous ramp position L (0..ramp.length-1) to one ramp colour. */
export function pick(ramp, L, x, y) {
  let i = Math.floor(L);
  if (L - i > bayer(x, y)) i++;
  return ramp[clamp(i, 0, ramp.length - 1)];
}

/** Like pick, but flat bands with a narrow dithered seam (pixel-art metal, not noise). */
export function band(ramp, L, x, y, seam = 0.3) {
  let i = Math.floor(L);
  const f = L - i;
  if (f > 0.5 + seam / 2) i++;
  else if (f > 0.5 - seam / 2 && (f - (0.5 - seam / 2)) / seam > bayer(x, y)) i++;
  return ramp[clamp(i, 0, ramp.length - 1)];
}

export function hash2(ix, iy, s = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise + fbm (deterministic). */
export function noise1(x, s = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, 0, s);
  const b = hash2(i + 1, 0, s);
  return a + (b - a) * u;
}
export function fbm1(x, s = 0, oct = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * noise1(x * f + o * 17.3, s);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

// ---------------------------------------------------------------- geometry (SDF-ish)
export const dist = (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0);

/** Distance from p to segment ab. */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Even-odd point-in-polygon; poly = [[x,y], ...]. */
export function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed angle difference in (-PI, PI]. */
export function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Quadratic bezier sampled into points. */
export function bezier2(p0, p1, p2, steps = 200) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]);
  }
  return out;
}

// ---------------------------------------------------------------- raster
export class Plate {
  constructor(n = 128) {
    this.n = n;
    this.px = new Array(n * n).fill(INK[0]);
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.n && y < this.n;
  }
  set(x, y, hex) {
    x = Math.round(x);
    y = Math.round(y);
    if (hex && this.inside(x, y)) this.px[y * this.n + x] = hex;
  }
  get(x, y) {
    return this.inside(x, y) ? this.px[y * this.n + x] : null;
  }
  /** fn(cx, cy, x, y) -> hex | null, evaluated at pixel centres. */
  paint(fn) {
    const n = this.n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = fn(x + 0.5, y + 0.5, x, y, this.px[y * n + x]);
        if (c) this.px[y * n + x] = c;
      }
    return this;
  }
  /** Stamp a character mask: rows of strings, key maps char -> hex (or fn(x,y)->hex). */
  stamp(rows, ox, oy, key, scale = 1) {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        const v = key[ch];
        if (!v) return;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) {
            const x = ox + i * scale + sx;
            const y = oy + j * scale + sy;
            this.set(x, y, typeof v === 'function' ? v(x, y) : v);
          }
      });
    });
    return this;
  }
  /** Pixel-perfect 1px line (Bresenham) between points. */
  line(x0, y0, x1, y1, color) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, typeof color === 'function' ? color(x0, y0) : color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }
  /** Polyline through sampled points, 1 px, no doubled corners. */
  polyline(pts, color) {
    let last = null;
    for (const [fx, fy] of pts) {
      const x = Math.round(fx);
      const y = Math.round(fy);
      if (last && last[0] === x && last[1] === y) continue;
      if (last && (Math.abs(last[0] - x) > 1 || Math.abs(last[1] - y) > 1))
        this.line(last[0], last[1], x, y, color);
      else this.set(x, y, typeof color === 'function' ? color(x, y) : color);
      last = [x, y];
    }
    return this;
  }
  rgb() {
    const n = this.n;
    const buf = Buffer.alloc(n * n * 3);
    for (let i = 0; i < n * n; i++) {
      const v = parseInt(this.px[i].slice(1), 16);
      buf[i * 3] = (v >> 16) & 255;
      buf[i * 3 + 1] = (v >> 8) & 255;
      buf[i * 3 + 2] = v & 255;
    }
    return buf;
  }
  /** Opaque RGB PNG buffer at `size` px (nearest-neighbour: every art pixel a crisp block). */
  async png(size = 1024) {
    return sharp(this.rgb(), { raw: { width: this.n, height: this.n, channels: 3 } })
      .resize(size, size, { kernel: 'nearest' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  }
}
