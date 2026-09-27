// Pilot cutscene player: a frame is a pure function of time.
//
// Two layers, as the spec (docs/specs/cutscenes.md) describes:
//   - the pixel layer, drawn at art resolution (640×360) with no smoothing and
//     integer-scaled to the output;
//   - the type layer (the three hands: ceremony, speech, pen), drawn at output
//     resolution so letters stay crisp.
// No Math.random, no wall clock: randomness is a hash of ids, flicker is keyed to a
// 12 fps frame index, and time comes from the caller (the music's position when
// playing, the frame number when exporting).

export const ART_W = 640;
export const ART_H = 360;
export const SCALE = 2;
export const OUT_W = ART_W * SCALE;
export const OUT_H = ART_H * SCALE;
// The plate window: a 21:9 painting framed by ink bands (type lives in the bands).
export const WIN = { x: 16, y: 50, w: 608, h: 260 };
export const BOIL_FPS = 12;

// Art-bible ramps (docs/art-direction/ART_BIBLE.md → Palette).
export const INK = {
  ink0: '#07060b',
  ink1: '#0e0c14',
  ink3: '#211d2b',
  ink7: '#766b77',
  ink8: '#978b94',
  ink10: '#ddd0bd',
  ink11: '#f4ecdb',
  ember2: '#80461f',
  ember3: '#b3702c',
  ember4: '#dca044',
  ember5: '#f3cb6c',
  ember6: '#fff0bd',
  blood3: '#9e2632',
  blood4: '#cc4038',
  blood5: '#ec7a5c',
  unlight3: '#763aa0',
};

// ---------------------------------------------------------------- pure helpers

export function hash(n) {
  // integer hash → [0, 1)
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export const hash2 = (a, b) => hash(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const lerp = (a, b, k) => a + (b - a) * k;
export const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
export const easeOut = (k) => 1 - Math.pow(1 - k, 3);
export const boilFrame = (t) => Math.floor(t * BOIL_FPS);

/** Cue-sheet clock: bar/beat → seconds, from tools/cutscene/cuesheet.py output. */
export function makeClock(cue) {
  const bpb = cue.beatsPerBar;
  const beatTime = (idx) => {
    const i = Math.floor(idx);
    const f = idx - i;
    const b = cue.beats;
    if (i >= b.length - 1)
      return b[b.length - 1] + (idx - (b.length - 1)) * (b[b.length - 1] - b[b.length - 2]);
    return b[i] + (b[i + 1] - b[i]) * f;
  };
  /** Start of bar `bar` (1-based), plus `beat` beats (1-based, may be fractional). */
  const T = (bar, beat = 1) => beatTime((bar - 1) * bpb + (beat - 1));
  const beatAt = (t) => {
    const b = cue.beats;
    let lo = 0;
    let hi = b.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (b[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const span = (b[lo + 1] ?? b[lo] + 1) - b[lo];
    return lo + clamp((t - b[lo]) / span, 0, 1);
  };
  /** 1 on a beat, decaying after it. */
  const pulse = (t, k = 6) => Math.exp(-(beatAt(t) % 1) * k);
  return { T, beatAt, pulse, cue };
}

// ---------------------------------------------------------------- plates

/**
 * A treated plate: its pixels as a palette index buffer, so effects rotate colours
 * instead of painting over the art (palette cycling, as PC-98 and SNES games did).
 */
export function indexPlate(img) {
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, img.width, img.height);
  const map = new Map();
  const palette = [];
  const idx = new Uint16Array(img.width * img.height);
  for (let i = 0; i < idx.length; i++) {
    const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    let k = map.get(key);
    if (k === undefined) {
      k = palette.length;
      map.set(key, k);
      palette.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    }
    idx[i] = k;
  }
  // Warm ramp: the ember/gold colours ordered dark → light (what water, fire and the
  // corona are painted in). Effects step pixels up and down this ramp.
  const lum = ([r, g2, b]) => 0.299 * r + 0.587 * g2 + 0.114 * b;
  const warm = palette
    .map((p, i) => ({ i, p }))
    .filter(({ p: [r, g2, b] }) => r > b + 24 && r >= g2 && lum([r, g2, b]) > 70)
    .sort((a, b) => lum(a.p) - lum(b.p))
    .map(({ i }) => i);
  const warmRank = new Int16Array(palette.length).fill(-1);
  warm.forEach((pi, r) => (warmRank[pi] = r));
  return { w: img.width, h: img.height, idx, palette, warm, warmRank };
}

/**
 * Draw a plate into an ImageData at (ox, oy) inside WIN, applying palette effects.
 * effects: [{ kind: 'shimmer'|'flicker', rect: [x, y, w, h], amp, speed }]
 */
export function drawPlate(dst, plate, ox, oy, t, effects = []) {
  const { w, h, idx, palette, warm, warmRank } = plate;
  const f = boilFrame(t);
  const out = dst.data;
  const fx = effects.map((e, n) => ({ ...e, n }));
  for (let y = 0; y < WIN.h; y++) {
    const py = y + oy;
    if (py < 0 || py >= h) continue;
    for (let x = 0; x < WIN.w; x++) {
      const px = x + ox;
      if (px < 0 || px >= w) continue;
      let pi = idx[py * w + px];
      const r = warmRank[pi];
      if (r >= 0 && fx.length) {
        for (const e of fx) {
          const [rx, ry, rw, rh] = e.rect;
          if (px < rx || py < ry || px >= rx + rw || py >= ry + rh) continue;
          let step = 0;
          if (e.kind === 'shimmer') {
            // water: short horizontal glints that drift with the current and re-form
            // a few times a second (streak length L, drift in px per boil frame)
            const L = e.streak ?? 5;
            const drift = (e.speed ?? 1) * 0.6;
            const phase = Math.floor(f / 3);
            const n = hash2(Math.floor((px + f * drift) / L) * 7 + phase * 131, py);
            const amp = e.amp ?? 1.4;
            step = n > 0.82 ? Math.round(amp) : n < 0.12 ? -1 : 0;
          } else if (e.kind === 'flicker') {
            // fire: one random step per region per boil frame, brighter at the top
            const k = hash2(e.n * 131 + Math.floor(px / 6), f);
            step = Math.round((k - 0.45) * 2 * (e.amp ?? 1.5));
          } else if (e.kind === 'pulse') {
            step = Math.round(e.value ?? 0);
          }
          if (step) {
            const nr = clamp(r + step, 0, warm.length - 1);
            pi = warm[nr];
          }
        }
      }
      const c = palette[pi];
      const o = ((y + WIN.y) * ART_W + (x + WIN.x)) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
    }
  }
}

// 8×8 Bayer matrix, for ordered-dither dissolves (no alpha blends on pixel art).
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
export const bayer = (x, y) => (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64;

/** Replace pixels of `a` by `b` where the Bayer threshold is under k (0..1), inside WIN. */
export function ditherMix(a, b, k) {
  const A = a.data;
  const B = b.data;
  for (let y = WIN.y; y < WIN.y + WIN.h; y++) {
    for (let x = WIN.x; x < WIN.x + WIN.w; x++) {
      if (bayer(x, y) < k) {
        const o = (y * ART_W + x) * 4;
        A[o] = B[o];
        A[o + 1] = B[o + 1];
        A[o + 2] = B[o + 2];
      }
    }
  }
}

/** Fade the window toward ink by ordered dither (k = 1: all ink). */
export function ditherToInk(a, k, color = [7, 6, 11]) {
  const A = a.data;
  for (let y = WIN.y; y < WIN.y + WIN.h; y++) {
    for (let x = WIN.x; x < WIN.x + WIN.w; x++) {
      if (bayer(x, y) < k) {
        const o = (y * ART_W + x) * 4;
        A[o] = color[0];
        A[o + 1] = color[1];
        A[o + 2] = color[2];
      }
    }
  }
}

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function putPx(img, x, y, rgb) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < WIN.x || y < WIN.y || x >= WIN.x + WIN.w || y >= WIN.y + WIN.h) return;
  const o = (y * ART_W + x) * 4;
  img.data[o] = rgb[0];
  img.data[o + 1] = rgb[1];
  img.data[o + 2] = rgb[2];
  img.data[o + 3] = 255;
}

/**
 * Deterministic particles on the art grid. Particle i is born at a hashed time inside
 * [t0, t1) and lives `life` seconds; its path is a pure function of its age.
 */
export function particles(img, t, o) {
  const { seed = 1, n, t0, t1, life, spawn, vel, colors, wobble = 0, grav = 0 } = o;
  for (let i = 0; i < n; i++) {
    const born = t0 + hash2(seed, i) * (t1 - t0);
    const age = t - born;
    if (age < 0 || age > life) continue;
    const [sx, sy] = spawn(i);
    const vx = vel[0] * (0.6 + hash2(seed + 7, i) * 0.8);
    const vy = vel[1] * (0.6 + hash2(seed + 9, i) * 0.8);
    const x = sx + vx * age + Math.sin(age * 2.3 + i) * wobble;
    const y = sy + vy * age + 0.5 * grav * age * age;
    const lifeK = age / life;
    const ci = Math.min(colors.length - 1, Math.floor(lifeK * colors.length));
    // twinkle on the boil clock
    if (hash2(seed + i, boilFrame(t)) < 0.12) continue;
    putPx(img, WIN.x + x, WIN.y + y, colors[ci]);
  }
}
