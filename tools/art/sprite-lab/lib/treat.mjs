// Post treatments on resolved RGBA (64x64): corruption split, hit flash,
// the game's current contrast halo and acted tint, and review diagnostics.
import { mulberry32 } from './rng.mjs';
import { RAMPS } from './palette.mjs';

const U = RAMPS.unlightCloth;
const UL = RAMPS.glowUnlight;

// "The Entity has no words … the image splits." Two thin horizontal slices of
// the figure are displaced sideways, the tear edge lit in unlight violet, and a
// faint violet after-image trails one pixel behind. Deterministic per seed.
export function splitImage(rgba, w, h, seed = 1) {
  const rnd = mulberry32(seed * 7919 + 13);
  const out = new Uint8ClampedArray(rgba.length);
  // bounds
  let y0 = h,
    y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (rgba[(y * w + x) * 4 + 3]) {
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  // after-image: whole figure, offset (-1, 0), unlight tint, 45% alpha
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) {
      const s = (y * w + x) * 4;
      if (!rgba[s + 3]) continue;
      const d = (y * w + x - 1) * 4;
      out[d] = U[2][0];
      out[d + 1] = U[2][1];
      out[d + 2] = U[2][2];
      out[d + 3] = 115;
    }
  const span = y1 - y0;
  const bands = [
    [y0 + Math.floor(span * (0.28 + rnd() * 0.1)), 2, 1],
    [y0 + Math.floor(span * (0.58 + rnd() * 0.12)), 1, -1],
  ];
  const shiftOf = (y) => {
    for (const [by, bh, dx] of bands) if (y >= by && y < by + bh) return dx;
    return 0;
  };
  for (let y = 0; y < h; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= w) continue;
      const s = (y * w + sx) * 4;
      if (!rgba[s + 3]) continue;
      const d = (y * w + x) * 4;
      out[d] = rgba[s];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2];
      out[d + 3] = 255;
    }
    if (dx) {
      // light the tear: the first opaque pixel on the trailing side
      for (let x = dx > 0 ? 0 : w - 1; dx > 0 ? x < w : x >= 0; x += dx > 0 ? 1 : -1) {
        const d = (y * w + x) * 4;
        if (out[d + 3] === 255) {
          out[d] = UL[2][0];
          out[d + 1] = UL[2][1];
          out[d + 2] = UL[2][2];
          break;
        }
      }
    }
  }
  return out;
}

// Hit flash: every opaque pixel to paper white except the outline-dark ones,
// which go crimson so the silhouette survives the flash.
export function hitFlash(rgba) {
  const out = Uint8ClampedArray.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    if (!out[i + 3]) continue;
    const l = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
    const c = l < 40 ? [110, 26, 40] : [244, 236, 219];
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
  }
  return out;
}

// BattleContrast.contrastSpriteKey: 1px rgba(24,34,35,0.82) halo behind the sprite.
export function gameHalo(img, Img) {
  const out = new Img(img.w, img.h);
  const halo = img.map(([, , , a]) => (a ? [24, 34, 35, 209] : [0, 0, 0, 0]));
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ])
    out.draw(halo, dx, dy);
  return out.draw(img, 0, 0);
}

// BattleScene acted state on mobile: multiplicative tint 0xb8b8b8.
export const acted = ([r, g, b, a]) => [(r * 0xb8) / 255, (g * 0xb8) / 255, (b * 0xb8) / 255, a];
export const grayscale = ([r, g, b, a]) => {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [l, l, l, a];
};
export const silhouette = ([, , , a]) => (a ? [16, 14, 20, 255] : [0, 0, 0, 0]);
// Machado et al. 2009 deuteranopia, severity 1.0.
export const deutan = ([r, g, b, a]) => [
  0.367 * r + 0.861 * g - 0.228 * b,
  0.28 * r + 0.673 * g + 0.047 * b,
  -0.012 * r + 0.043 * g + 0.969 * b,
  a,
];
