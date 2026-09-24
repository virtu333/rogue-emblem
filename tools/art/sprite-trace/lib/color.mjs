// Colour science helpers: sRGB <-> CIE Lab (D65), LCh, distances. Pure.

export const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

export const toHex = (c) =>
  `#${c
    .slice(0, 3)
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

const lin = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const gam = (v) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, s * 255));
};
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
const fi = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function rgbToLab([r, g, b]) {
  const R = lin(r),
    G = lin(g),
    B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = f(X),
    fy = f(Y),
    fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([L, a, b]) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const X = fi(fx) * 0.95047,
    Y = fi(fy),
    Z = fi(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return [gam(R), gam(G), gam(B)].map(Math.round);
}

/** Lab -> [L, C, h°]. */
export function lch(lab) {
  const [L, a, b] = lab;
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

export const dLab2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/** Rec.709 luma (0..255). */
export const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const mix = (a, b, t) => [0, 1, 2].map((k) => Math.round(a[k] * (1 - t) + b[k] * t));

/** Hue distance in degrees (0..180). */
export const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Max absolute channel difference including alpha (cheap edge strength). */
export function pixelDiff(d, i, j) {
  const aa = d[i + 3],
    ab = d[j + 3];
  if (aa < 32 && ab < 32) return 0;
  if (aa < 32 || ab < 32) return 255;
  return Math.max(Math.abs(d[i] - d[j]), Math.abs(d[i + 1] - d[j + 1]), Math.abs(d[i + 2] - d[j + 2]));
}
