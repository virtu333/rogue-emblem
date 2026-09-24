// Planar raster helpers for the PC-98 pass (pure, deterministic).
// Images are { w, h } plus Float32Array planes; masks are Uint8Array (0/1).
import { rgbToOklab, oklabToRgb } from './color.mjs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** RGBA bytes -> OKLab planes + binary mask (alpha >= threshold). */
export function toLab(rgba, w, h, alphaThreshold = 128) {
  const n = w * h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [l, a, b] = rgbToOklab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    L[i] = l;
    A[i] = a;
    B[i] = b;
    mask[i] = rgba[i * 4 + 3] >= alphaThreshold ? 1 : 0;
  }
  return { w, h, L, A, B, mask };
}

export function labAt(img, i) {
  return [img.L[i], img.A[i], img.B[i]];
}

export function labToRgbBytes(img) {
  const n = img.w * img.h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const rgb = oklabToRgb(img.L[i], img.A[i], img.B[i]);
    out[i * 4] = rgb[0];
    out[i * 4 + 1] = rgb[1];
    out[i * 4 + 2] = rgb[2];
    out[i * 4 + 3] = img.mask[i] ? 255 : 0;
  }
  return out;
}

function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + r];
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, r };
}

/**
 * Gaussian blur of the given planes restricted to the mask (normalized
 * convolution: background never bleeds into the figure). Returns new planes.
 */
export function blurMasked(img, planes, sigma) {
  const { w, h, mask } = img;
  if (!(sigma > 0.05)) return planes.map((p) => Float32Array.from(p));
  const { k, r } = gaussKernel(sigma);
  const n = w * h;
  const wt = new Float32Array(n);
  const tmpW = new Float32Array(n);
  const src = planes.map((p) => {
    const q = new Float32Array(n);
    for (let i = 0; i < n; i++) q[i] = mask[i] ? p[i] : 0;
    return q;
  });
  for (let i = 0; i < n; i++) wt[i] = mask[i];
  const tmp = src.map(() => new Float32Array(n));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sw = 0;
      const acc = src.map(() => 0);
      for (let j = -r; j <= r; j++) {
        const xx = x + j;
        if (xx < 0 || xx >= w) continue;
        const idx = y * w + xx;
        const kk = k[j + r];
        sw += kk * wt[idx];
        for (let p = 0; p < src.length; p++) acc[p] += kk * src[p][idx];
      }
      const o = y * w + x;
      tmpW[o] = sw;
      for (let p = 0; p < src.length; p++) tmp[p][o] = acc[p];
    }
  const out = src.map(() => new Float32Array(n));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sw = 0;
      const acc = src.map(() => 0);
      for (let j = -r; j <= r; j++) {
        const yy = y + j;
        if (yy < 0 || yy >= h) continue;
        const idx = yy * w + x;
        const kk = k[j + r];
        sw += kk * tmpW[idx];
        for (let p = 0; p < src.length; p++) acc[p] += kk * tmp[p][idx];
      }
      const o = y * w + x;
      for (let p = 0; p < src.length; p++)
        out[p][o] = mask[o] && sw > 1e-6 ? acc[p] / sw : planes[p][o];
    }
  return out;
}

/**
 * Edge-preserving bilateral filter in OKLab over masked pixels: flattens
 * painterly texture into cel-like regions before quantization.
 */
export function bilateral(img, sigmaS, sigmaR, iterations = 1) {
  let { L, A, B } = img;
  const { w, h, mask } = img;
  if (!(sigmaS > 0.05) || !(sigmaR > 0)) return { ...img };
  const r = Math.max(1, Math.ceil(sigmaS * 2));
  const spatial = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      spatial.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS))]);
  const inv = 1 / (2 * sigmaR * sigmaR);
  for (let it = 0; it < iterations; it++) {
    const nL = new Float32Array(L.length);
    const nA = new Float32Array(A.length);
    const nB = new Float32Array(B.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = y * w + x;
        if (!mask[o]) {
          nL[o] = L[o];
          nA[o] = A[o];
          nB[o] = B[o];
          continue;
        }
        let sw = 0;
        let sl = 0;
        let sa = 0;
        let sb = 0;
        for (const [dx, dy, ws] of spatial) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (!mask[q]) continue;
          const dl = L[q] - L[o];
          const da = A[q] - A[o];
          const db = B[q] - B[o];
          const wt = ws * Math.exp(-(dl * dl + da * da + db * db) * inv);
          sw += wt;
          sl += wt * L[q];
          sa += wt * A[q];
          sb += wt * B[q];
        }
        nL[o] = sl / sw;
        nA[o] = sa / sw;
        nB[o] = sb / sw;
      }
    L = nL;
    A = nA;
    B = nB;
  }
  return { ...img, L, A, B };
}

/** Sobel gradient of a plane (edges clamp). */
export function sobel(plane, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  const at = (x, y) => plane[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = at(x - 1, y - 1);
      const b = at(x, y - 1);
      const c = at(x + 1, y - 1);
      const d = at(x - 1, y);
      const f = at(x + 1, y);
      const g = at(x - 1, y + 1);
      const hh = at(x, y + 1);
      const ii = at(x + 1, y + 1);
      const sx = (c + 2 * f + ii - (a + 2 * d + g)) / 8;
      const sy = (g + 2 * hh + ii - (a + 2 * b + c)) / 8;
      const o = y * w + x;
      gx[o] = sx;
      gy[o] = sy;
      mag[o] = Math.hypot(sx, sy);
    }
  return { gx, gy, mag };
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function neighbours(eight = false) {
  return eight ? N8 : N4;
}

/** Connected components of mask==value. Returns { labels, sizes }. */
export function components(mask, w, h, value = 1, eight = false) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const touches = [];
  const stack = [];
  const nb = neighbours(eight);
  for (let s = 0; s < w * h; s++) {
    if (mask[s] !== value || labels[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const touch = { top: false, bottom: false, left: false, right: false };
    labels[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      if (y === 0) touch.top = true;
      if (y === h - 1) touch.bottom = true;
      if (x === 0) touch.left = true;
      if (x === w - 1) touch.right = true;
      for (const [dx, dy] of nb) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (mask[q] === value && labels[q] < 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
    touches.push(touch);
  }
  return { labels, sizes, touches };
}

/**
 * Clean a figure mask: drop specks smaller than minIsland, fill enclosed
 * holes smaller than maxHole (holes touching the border are real background).
 */
export function cleanMask(mask, w, h, { minIsland = 4, maxHole = 6 } = {}) {
  const out = Uint8Array.from(mask);
  const fg = components(out, w, h, 1, true);
  for (let i = 0; i < out.length; i++) if (out[i] && fg.sizes[fg.labels[i]] < minIsland) out[i] = 0;
  const bg = components(out, w, h, 0, false);
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    const id = bg.labels[i];
    const t = bg.touches[id];
    const enclosed = !(t.top || t.bottom || t.left || t.right);
    if (enclosed && bg.sizes[id] <= maxHole) out[i] = 1;
  }
  return out;
}

export function erode(mask, w, h, eight = false) {
  const out = new Uint8Array(w * h);
  const nb = neighbours(eight);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (!mask[o]) continue;
      let keep = 1;
      for (const [dx, dy] of nb) {
        const xx = x + dx;
        const yy = y + dy;
        // Image borders count as inside: a bust cut by the frame keeps its edge.
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (!mask[yy * w + xx]) {
          keep = 0;
          break;
        }
      }
      out[o] = keep;
    }
  return out;
}

export function dilate(mask, w, h, eight = false) {
  const out = Uint8Array.from(mask);
  const nb = neighbours(eight);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (mask[o]) continue;
      for (const [dx, dy] of nb) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (mask[yy * w + xx]) {
          out[o] = 1;
          break;
        }
      }
    }
  return out;
}

/** Figure pixels that touch transparency (the silhouette ring, 1px). */
export function silhouette(mask, w, h, eight = false) {
  const inner = erode(mask, w, h, eight);
  const ring = new Uint8Array(w * h);
  for (let i = 0; i < ring.length; i++) ring[i] = mask[i] && !inner[i] ? 1 : 0;
  return ring;
}

// Ordered dither thresholds. BAYER4 at 50% is a checkerboard, at 25% the
// classic every-other-pixel-every-other-row PC-98 texture.
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function bayer(x, y) {
  return (BAYER4[y & 3][x & 3] + 0.5) / 16;
}
