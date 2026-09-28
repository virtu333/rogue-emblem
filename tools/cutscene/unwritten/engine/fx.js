// Effects drawn in code, all on the art-pixel grid and all pure functions of t:
// firelight, embers, the gold thread, the Hollow Sun, the unlight drain, and titles
// set between layers. The gold here is the only warm light in the frame.

import { bayer, clamp, hash, hexToRgb, smooth, valueNoise } from './raster.js';
import { C, RAMPS } from './palette.js';

const GOLD = hexToRgb(C.gold);
const GOLD_HI = hexToRgb(C.goldHi);
const GOLD_W = hexToRgb(C.goldWhite);
const EMBER = hexToRgb(C.ember);
const INK = hexToRgb(C.ink);

const put = (frame, fw, fh, x, y, c, a = 1) => {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= fw || y >= fh) return;
  const o = (y * fw + x) * 4;
  frame[o] = frame[o] * (1 - a) + c[0] * a;
  frame[o + 1] = frame[o + 1] * (1 - a) + c[1] * a;
  frame[o + 2] = frame[o + 2] * (1 - a) + c[2] * a;
};

/** Flicker 0..1 for a fire, smooth but restless. */
export const flicker = (t, seed = 0) =>
  0.55 +
  0.25 * Math.sin(t * 7.3 + seed) +
  0.12 * Math.sin(t * 13.1 + seed * 2) +
  0.25 * (valueNoise(t * 6, seed, 9) - 0.5);

/** Warm additive light around (cx, cy), radius r, strength k (0..1). */
export function fireLight(frame, fw, fh, cx, cy, r, k, t) {
  const f = k * flicker(t);
  const x0 = Math.max(0, (cx - r) | 0);
  const x1 = Math.min(fw, (cx + r) | 0);
  const y0 = Math.max(0, (cy - r) | 0);
  const y1 = Math.min(fh, (cy + r) | 0);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.3) / r;
      if (d >= 1) continue;
      const a = (1 - d) * (1 - d) * f;
      const o = (y * fw + x) * 4;
      frame[o] = Math.min(255, frame[o] + 150 * a);
      frame[o + 1] = Math.min(255, frame[o + 1] + 80 * a);
      frame[o + 2] = Math.min(255, frame[o + 2] + 20 * a);
    }
}

/**
 * Embers rising from (cx, cy). Deterministic: ember i is born every `period` s and
 * lives `life` s, so the field at time t is the same however you got there.
 */
export function embers(frame, fw, fh, cx, cy, t, opts = {}) {
  const { count = 40, period = 0.09, life = 2.6, spread = 14, rise = 34, speed = 1 } = opts;
  const tt = t * speed;
  const first = Math.floor((tt - life) / period);
  const last = Math.floor(tt / period);
  for (let i = Math.max(first, last - count); i <= last; i++) {
    const age = tt - i * period;
    if (age < 0 || age > life) continue;
    const u = age / life;
    const sx = (hash(i, 1, 5) - 0.5) * spread;
    const sway = Math.sin(age * (2 + hash(i, 2, 5) * 2) + i) * (3 + 5 * u);
    const x = cx + sx + sway + (hash(i, 3, 5) - 0.5) * 20 * u;
    const y = cy - age * rise * (0.7 + 0.6 * hash(i, 4, 5));
    const c = u < 0.25 ? GOLD_W : u < 0.6 ? GOLD_HI : EMBER;
    const a = 1 - smooth(0.7, 1, u);
    if (a > bayer(x | 0, y | 0)) put(frame, fw, fh, x, y, c);
  }
}

/**
 * The gold thread along y = y0 + amp*sin(...) from x0 to x1, drawn to fraction `p`.
 * A 1 px bright core with a dithered gold halo. It is never paint: it survives the
 * rewind because it is the one thing on the page that was not drawn by the painter.
 */
export function thread(frame, fw, fh, x0, x1, y0, amp, t, p = 1, phase = 0) {
  if (p <= 0) return;
  const xe = x0 + (x1 - x0) * clamp(p);
  const dir = x1 >= x0 ? 1 : -1;
  for (let x = x0; dir > 0 ? x <= xe : x >= xe; x += dir * 0.5) {
    const y =
      y0 + amp * Math.sin((x - x0) * 0.025 + phase + t * 0.8) + 2 * Math.sin(x * 0.11 + t * 2);
    put(frame, fw, fh, x, y, GOLD_W);
    if (bayer(x | 0, y | 0) < 0.6) put(frame, fw, fh, x, y - 1, GOLD_HI, 0.8);
    if (bayer((x | 0) + 2, y | 0) < 0.35) put(frame, fw, fh, x, y + 1, GOLD, 0.7);
  }
  // a spark at the drawing end
  if (p < 1) {
    const y = y0 + amp * Math.sin((xe - x0) * 0.025 + phase + t * 0.8);
    for (let d = -2; d <= 2; d++) {
      put(frame, fw, fh, xe + d, y, GOLD_W);
      put(frame, fw, fh, xe, y + d, GOLD_W);
    }
  }
}

/** The Hollow Sun: a black disc with a thin gold ring, and a dithered corona. */
export function hollowSun(frame, fw, fh, cx, cy, r, t, k = 1) {
  const R = r + 7;
  for (let y = (cy - R) | 0; y <= cy + R; y++)
    for (let x = (cx - R) | 0; x <= cx + R; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r - 1) put(frame, fw, fh, x, y, INK, k);
      else if (d <= r + 0.6) put(frame, fw, fh, x, y, GOLD_W, k);
      else if (d <= r + 1.6) put(frame, fw, fh, x, y, GOLD_HI, k);
      else if (d <= R) {
        const ang = Math.atan2(y - cy, x - cx);
        const flare = 0.5 + 0.5 * Math.sin(ang * 7 + t * 0.9) * Math.sin(ang * 3 - t * 0.4);
        const a = (1 - (d - r - 1.6) / (R - r - 1.6)) * (0.35 + 0.45 * flare) * k;
        if (a > bayer(x, y)) put(frame, fw, fh, x, y, GOLD);
      }
    }
}

// the unlight ramp, by brightness, for draining colour toward violet
const UNLIGHT = RAMPS.unlight.split(' ').map(hexToRgb);
const INKR = RAMPS.ink.split(' ').map(hexToRgb);

/** Drain colour toward the unlight/ink ramps by k (0..1): the hymn's stillness. */
export function drain(frame, fw, fh, k) {
  if (k <= 0) return;
  for (let i = 0; i < fw * fh; i++) {
    const o = i * 4;
    const L = (0.299 * frame[o] + 0.587 * frame[o + 1] + 0.114 * frame[o + 2]) / 255;
    // mostly the grey-violet ink ramp, leaning toward unlight in the shadows
    const a = INKR[Math.min(INKR.length - 1, Math.floor(L * INKR.length))];
    const u = UNLIGHT[Math.min(UNLIGHT.length - 1, Math.floor(L * 0.8 * UNLIGHT.length))];
    const w = 0.35 * (1 - L);
    const c = [a[0] * (1 - w) + u[0] * w, a[1] * (1 - w) + u[1] * w, a[2] * (1 - w) + u[2] * w];
    // keep gold: anything strongly warm and bright is the thread or the fire
    const warm = frame[o] > 200 && frame[o] - frame[o + 2] > 90;
    const kk = warm ? k * 0.2 : k;
    frame[o] = frame[o] * (1 - kk) + c[0] * kk;
    frame[o + 1] = frame[o + 1] * (1 - kk) + c[1] * kk;
    frame[o + 2] = frame[o + 2] * (1 - kk) + c[2] * kk;
  }
}

/** Multiply the whole frame toward a colour (a grade). */
export function grade(frame, fw, fh, mul) {
  for (let i = 0; i < fw * fh; i++) {
    const o = i * 4;
    frame[o] *= mul[0];
    frame[o + 1] *= mul[1];
    frame[o + 2] *= mul[2];
  }
}

/**
 * A title in Cinzel, snapped to the grid (no anti-aliasing), with a 1 px ink shadow.
 * Returns a mask object; draw it with drawTitle. Letters reveal left to right by `p`.
 */
export function makeTitle(text, px, spacing = 0.18) {
  const c = new OffscreenCanvas(8, 8);
  let g = c.getContext('2d');
  const font = `600 ${px}px Cinzel, serif`;
  g.font = font;
  const letters = [...text];
  const widths = letters.map((ch) => g.measureText(ch).width);
  const gap = px * spacing;
  const w = Math.ceil(widths.reduce((s, v) => s + v + gap, 0));
  const h = Math.ceil(px * 1.3);
  const cv = new OffscreenCanvas(w, h);
  g = cv.getContext('2d', { willReadFrequently: true });
  g.font = font;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  const starts = [];
  let x = 0;
  letters.forEach((ch, i) => {
    starts.push(x);
    g.fillText(ch, x, Math.round(px * 1.05));
    x += widths[i] + gap;
  });
  const d = g.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  return { w, h, mask, starts, count: letters.length };
}

/** Draw a title at (x, y); letter n appears as p passes n/count, with a dither-in. */
export function drawTitle(frame, fw, fh, title, x0, y0, p, color = C.paperHi, shadow = true) {
  const col = hexToRgb(color);
  const n = title.count;
  const letterAt = (x) => {
    let i = 0;
    while (i + 1 < n && title.starts[i + 1] <= x) i++;
    return i;
  };
  for (let y = 0; y < title.h; y++)
    for (let x = 0; x < title.w; x++) {
      if (!title.mask[y * title.w + x]) continue;
      const li = letterAt(x);
      const lp = clamp(p * n - li); // this letter's own reveal
      if (lp <= bayer(x0 + x, y0 + y)) continue;
      if (shadow) put(frame, fw, fh, x0 + x + 1, y0 + y + 1, INK);
      put(frame, fw, fh, x0 + x, y0 + y, col);
    }
}
