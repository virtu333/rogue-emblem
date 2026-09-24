// Colour science for the PC-98 pass: sRGB <-> OKLab (perceptual distances),
// 12-bit snapping (the PC-98's 4096-colour analogue palette: 4 bits per
// channel, so every channel is a multiple of 17) and small helpers.
// Pure: no I/O, no randomness.

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function srgbToLinear(v) {
  if (Number.isInteger(v) && v >= 0 && v <= 255) return LIN[v];
  const c = Math.min(1, Math.max(0, v / 255));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c) {
  const x = Math.max(0, c);
  return (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255;
}

/** sRGB (0-255 floats) -> OKLab [L, a, b] (L in 0..1). */
export function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab -> sRGB (0-255 floats, unclamped). */
export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

/** Snap one channel to 4 bits (0, 17, 34 ... 255). */
export function q4(v) {
  return Math.round(Math.min(255, Math.max(0, v)) / 17) * 17;
}

export function is12bit(rgb) {
  return rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255 && v % 17 === 0);
}

export function labDist(p, q) {
  const dL = p[0] - q[0];
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Nearest 12-bit colour to an sRGB colour, judged in OKLab among the 8
 * floor/ceil corners of its 4-bit cell (plain per-channel rounding can shift
 * hue on dark, saturated colours). Gaining chroma costs extra, so pale skin
 * and bone never snap toward yellow.
 */
export function snap12(rgb) {
  const target = rgbToOklab(rgb[0], rgb[1], rgb[2]);
  const targetC = Math.hypot(target[1], target[2]);
  const lo = rgb.map((v) => Math.floor(Math.min(255, Math.max(0, v)) / 17) * 17);
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < 8; i++) {
    const c = [0, 1, 2].map((k) => Math.min(255, lo[k] + ((i >> k) & 1) * 17));
    const lab = rgbToOklab(c[0], c[1], c[2]);
    const d = labDist(target, lab) + 0.5 * Math.max(0, Math.hypot(lab[1], lab[2]) - targetC);
    if (d < bestD - 1e-12) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function hex(rgb) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function parseHex(value) {
  const s = String(value).replace('#', '');
  const full =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function chroma(lab) {
  return Math.hypot(lab[1], lab[2]);
}

/** Hue angle in degrees (0..360). */
export function hue(lab) {
  const h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

export function hueDiff(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Ottosson's OKLab lightness toe (Lr): matches CIE L* near black, where raw
 * OKLab L exaggerates differences (rgb 0 vs 1 would be 0.028 apart).
 */
export function toe(L) {
  const k1 = 0.206;
  const k2 = 0.03;
  const k3 = (1 + k1) / (1 + k2);
  const t = k3 * L - k1;
  return 0.5 * (t + Math.sqrt(t * t + 4 * k2 * k3 * L));
}

/**
 * CIELAB (D65) scaled by 1/100 so distances sit near OKLab's. Linear near
 * black, which OKLab is not: used where backdrops are near-black fills.
 */
export function rgbToLab100(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [(116 * fy - 16) / 100, (500 * (fx - fy)) / 100, (200 * (fy - fz)) / 100];
}
