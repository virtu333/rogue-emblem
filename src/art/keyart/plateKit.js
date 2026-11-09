// plateKit.js — shared low-level helpers for the code-drawn key art plates (hollowSun.js,
// actVista.js, campPlate.js): palette packing, seeded RNG and value noise, ordered dithering,
// a Uint32 raster and pixel-perfect curve helpers. Pure: no Phaser; the only DOM use is
// makeCanvas(). Never calls Math.random.
/** The Ink & Ember ramps: the only colours a key art plate may emit. */
export const PALETTE = {
  ink: [
    '#07060b',
    '#0e0c14',
    '#16131e',
    '#211d2b',
    '#2e293a',
    '#403949',
    '#58505e',
    '#766b77',
    '#978b94',
    '#bdb0aa',
    '#ddd0bd',
    '#f4ecdb',
  ],
  ember: ['#2a170e', '#4f2c16', '#80461f', '#b3702c', '#dca044', '#f3cb6c', '#fff0bd'],
  blood: ['#22090f', '#44111c', '#6e1a28', '#9e2632', '#cc4038', '#ec7a5c'],
  steel: ['#101a2e', '#1c2f4f', '#2c4c77', '#4574a0', '#77a5c6', '#b8d8e6'],
  verdigris: ['#0f2622', '#1b4239', '#2d6450', '#4d8b66', '#86b27b', '#c3d69a'],
  unlight: ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'],
};

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Pack '#rrggbb' as an opaque pixel for a Uint32 view over ImageData (RGBA bytes). */
export function pack(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return LITTLE_ENDIAN
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix, iy, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function makeNoise(seed) {
  const s = seed | 0;
  const sm = (f) => f * f * (3 - 2 * f);
  const n1 = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash2(i, 0, s);
    const b = hash2(i + 1, 0, s);
    return a + (b - a) * sm(f);
  };
  const n2 = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = sm(x - ix);
    const fy = sm(y - iy);
    const a = hash2(ix, iy, s);
    const b = hash2(ix + 1, iy, s);
    const c = hash2(ix, iy + 1, s);
    const d = hash2(ix + 1, iy + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm1 = (x, oct = 4) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      v += amp * n1(x * f + o * 17.3);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return v / norm;
  };
  const fbm2 = (x, y, oct = 4) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      v += amp * n2(x * f + o * 11.1, y * f - o * 7.7);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return v / norm;
  };
  // Ridged 1D noise: sharp peaks, soft valleys.
  const ridge1 = (x, oct = 4) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      const r = 1 - Math.abs(n1(x * f + o * 5.1) * 2 - 1);
      v += amp * r * r;
      norm += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return v / norm;
  };
  return { n1, n2, fbm1, fbm2, ridge1 };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Ordered-dither a continuous ramp position L onto a discrete ramp. */
export function pick(ramp, L, x, y) {
  let i = Math.floor(L);
  if (L - i > bayer(x, y)) i++;
  return ramp[clamp(i, 0, ramp.length - 1)];
}

// ---------------------------------------------------------------------------
// Raster: a Uint32 pixel buffer that becomes an offscreen canvas.
// ---------------------------------------------------------------------------
export function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h);
  }
  set(x, y, c) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x, y) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  toCanvas() {
    const cv = makeCanvas(this.w, this.h);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.px);
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

/** Pixel-perfect polyline along a sampled curve (no doubled L-corners). */
export function curvePixels(fn, steps = 600) {
  const out = [];
  let last = null;
  for (let i = 0; i <= steps; i++) {
    const [fx, fy] = fn(i / steps);
    const x = Math.round(fx);
    const y = Math.round(fy);
    if (last && last[0] === x && last[1] === y) continue;
    // fill gaps with a simple DDA if the sampler skipped
    if (last && (Math.abs(x - last[0]) > 1 || Math.abs(y - last[1]) > 1)) {
      const n = Math.max(Math.abs(x - last[0]), Math.abs(y - last[1]));
      for (let k = 1; k < n; k++) {
        out.push([
          Math.round(last[0] + ((x - last[0]) * k) / n),
          Math.round(last[1] + ((y - last[1]) * k) / n),
        ]);
      }
    }
    out.push([x, y]);
    last = [x, y];
  }
  // remove L-corners
  const clean = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const a = clean[clean.length - 1];
    const b = out[i + 1];
    if (
      a &&
      b &&
      Math.abs(a[0] - b[0]) === 1 &&
      Math.abs(a[1] - b[1]) === 1 &&
      (p[0] === a[0] || p[1] === a[1])
    )
      continue;
    clean.push(p);
  }
  return clean;
}

/** Clean 1px midpoint circle, as offsets from the centre (8-connected, no doubles). */
export function circlePixels(r) {
  const seen = new Set();
  const out = [];
  const add = (x, y) => {
    const k = `${x},${y}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push([x, y]);
    }
  };
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [a, b] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ])
      add(a, b);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
  return out;
}

export const angDiff = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

export function bezier(p0, p1, p2, p3) {
  return (t) => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
  };
}

const INK = PALETTE.ink.map(pack);
const EMB = PALETTE.ember.map(pack);

// ---------------------------------------------------------------------------
// Painting helpers shared by the vistas and the camp plate
// ---------------------------------------------------------------------------

/** Fill the whole plate from a ramp: `level(x, y)` is a continuous ramp position. */
export function fillSky(R, ramp, level) {
  for (let y = 0; y < R.h; y++)
    for (let x = 0; x < R.w; x++) R.px[y * R.w + x] = pick(ramp, level(x, y), x, y);
}

/**
 * A silhouette layer: everything under `top[x]` down to `bottom`. `base` is the ramp
 * position of its body; `rim` is added to the top pixel(s) on slopes facing `light`
 * (-1 left, +1 right, 0 both); `haze` lifts it toward the ramp's far end with depth.
 */
export function fillLayer(R, top, ramp, o = {}) {
  const {
    base = 0,
    rim = 0,
    rimDepth = 1,
    light = 0,
    haze = 0,
    hazeSpan = 30,
    bottom = R.h,
    grain = 0,
    seed = 0,
  } = o;
  for (let x = 0; x < R.w; x++) {
    const y0 = Math.round(top[x]);
    const slope = top[Math.min(R.w - 1, x + 1)] - top[Math.max(0, x - 1)];
    const lit = light === 0 || slope * light > 0.15 ? 1 : slope * light < -0.15 ? 0 : 0.5;
    for (let y = Math.max(0, y0); y < bottom; y++) {
      const d = y - y0;
      let L = base + haze * smooth(0, hazeSpan, d);
      if (d < rimDepth) L += rim * lit;
      if (grain) L += (hash2(x, y, seed) - 0.5) * grain;
      R.px[y * R.w + x] = pick(ramp, L, x, y);
    }
  }
}

/** Draw rows of characters; `map` gives a packed colour per character ('.' and ' ' skip). */
export function stamp(R, rows, x0, y0, map) {
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < rows[j].length; i++) {
      const c = map[rows[j][i]];
      if (c !== undefined) R.set(x0 + i, y0 + j, c);
    }
}

/** The Hollow Sun: a black disc, a thin ring, and a dithered corona with streamers. */
export function hollowSun(R, noise, cx, cy, r, o = {}) {
  const { ring = EMB[4], hot = EMB[5], corona = [INK[9], INK[10]], reach = r * 1.6 } = o;
  const span = Math.ceil(r + reach + 2);
  for (let y = cy - span; y <= cy + span; y++)
    for (let x = cx - span; x <= cx + span; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r - 0.5) {
        R.set(x, y, INK[0]);
        continue;
      }
      const a = Math.atan2(y - cy, x - cx);
      const stream = 0.35 + 0.9 * noise.n1(a * 2.6 + 9) ** 2;
      const v = Math.exp(-(d - r) / (reach * 0.42 * stream));
      if (v > bayer(x, y) * 1.15 + 0.08) R.set(x, y, v > 0.62 ? corona[1] : corona[0]);
    }
  for (const [dx, dy] of circlePixels(r)) R.set(cx + dx, cy + dy, ring);
  // The diamond-ring bead on the lower-left rim.
  const bx = Math.round(cx + Math.cos(2.5) * r);
  const by = Math.round(cy + Math.sin(2.5) * r);
  R.set(bx, by, hot);
  R.set(bx - 1, by, hot);
  R.set(bx, by + 1, hot);
}

/** A few dim stars where the sky is dark (never inside the title zone's centre line). */
export function stars(R, rng, count, yMax, colours) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * R.w);
    const y = Math.floor(rng() * yMax);
    R.set(x, y, colours[i % colours.length]);
  }
}

export const profile = (W, fn) => {
  const out = new Float32Array(W);
  for (let x = 0; x < W; x++) out[x] = fn(x);
  return out;
};
