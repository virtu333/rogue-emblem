// The art bible's ramps (docs/art-direction/ART_BIBLE.md) and a fast snap to them.
// The final frame is quantised to these colours with an ordered dither, which is what
// makes the page read as 16-bit pixel art rather than a scaled-down painting.

import { bayer, hexToRgb } from './raster.js';

export const RAMPS = {
  ink: '07060b 0e0c14 16131e 211d2b 2e293a 403949 58505e 766b77 978b94 bdb0aa ddd0bd f4ecdb',
  ember: '2a170e 4f2c16 80461f b3702c dca044 f3cb6c fff0bd',
  blood: '22090f 44111c 6e1a28 9e2632 cc4038 ec7a5c',
  steel: '101a2e 1c2f4f 2c4c77 4574a0 77a5c6 b8d8e6',
  verdigris: '0f2622 1b4239 2d6450 4d8b66 86b27b c3d69a',
  unlight: '170c24 2c1645 4a2270 763aa0 a863cc dcaaf0',
  earth: '1d1a12 34301d 4f4a2a 6e6a3b 938c55 b8ae78',
  stone: '1a1a20 2b2c33 40414a 5a5b63 7a7a80 a09e9f',
};

/** Named colours used by the effects (all on the ramps above). */
export const C = {
  ink: '#07060b',
  sepia: '#2e293a',
  graphite: '#766b77',
  paper: '#ddd0bd',
  paperHi: '#f4ecdb',
  gold: '#dca044',
  goldHi: '#f3cb6c',
  goldWhite: '#fff0bd',
  ember: '#b3702c',
  emberDark: '#80461f',
  crimson: '#cc4038',
  violet: '#4a2270',
};

export const MASTER = Object.values(RAMPS)
  .join(' ')
  .split(/\s+/)
  .map((h) => hexToRgb(h));

// 32x32x32 lookup: each 5-bit RGB cell -> nearest ramp colour (weighted RGB distance).
let LUT = null;
function lut() {
  if (LUT) return LUT;
  LUT = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++)
    for (let g = 0; g < 32; g++)
      for (let b = 0; b < 32; b++) {
        const R = r * 8 + 4;
        const G = g * 8 + 4;
        const B = b * 8 + 4;
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < MASTER.length; i++) {
          const [pr, pg, pb] = MASTER[i];
          const rm = (R + pr) / 2;
          const dr = R - pr;
          const dg = G - pg;
          const db = B - pb;
          const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        LUT[(r << 10) | (g << 5) | b] = best;
      }
  return LUT;
}

/**
 * Snap an RGBA buffer in place to the ramps. `dither` (0..1) spreads each pixel by an
 * ordered-dither offset first, so gradients (skies, glow) break into pattern instead of
 * banding.
 */
export function quantise(data, w, h, dither = 0.5) {
  const L = lut();
  const amp = dither * 28;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = (bayer(x, y) - 0.5) * amp;
      const r = Math.min(255, Math.max(0, data[i] + o)) >> 3;
      const g = Math.min(255, Math.max(0, data[i + 1] + o)) >> 3;
      const b = Math.min(255, Math.max(0, data[i + 2] + o)) >> 3;
      const c = MASTER[L[(r << 10) | (g << 5) | b]];
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
}
