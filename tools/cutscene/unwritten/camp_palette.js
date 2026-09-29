// The camp's palette snap. The opening's master palette is eight ramps; for a night lit by fire
// the earth ramp (olive: 1d1a12 ... b8ae78) is the trouble: every dim warm tone (far ground,
// dry grass, smoke touched by the fire) lands on it and the picture drifts green. Here the snap
// leaves that ramp out, so dim warm tones fall on the ink ramp's violet greys (cool and warm
// ends), the stone greys or the ember browns, and people keep the skin ramp exactly as the
// engine's quantise() gives it. Same dither, same 5-bit lookup; only the ramp list differs.

import { bayer, hexToRgb } from './engine/raster.js';
import { RAMPS, SKIN, SKIN_ALPHA } from './engine/palette.js';

const CAMP_RAMPS = Object.entries(RAMPS)
  .filter(([k]) => k !== 'earth')
  .map(([, v]) => v);

const MASTER = CAMP_RAMPS.join(' ')
  .split(/\s+/)
  .map((h) => hexToRgb(h));
const WITH_SKIN = [...MASTER, ...SKIN.split(' ').map(hexToRgb)];

const LUTS = new Map();
function lut(pal) {
  if (LUTS.has(pal)) return LUTS.get(pal);
  const L = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++)
    for (let g = 0; g < 32; g++)
      for (let b = 0; b < 32; b++) {
        const R = r * 8 + 4;
        const G = g * 8 + 4;
        const B = b * 8 + 4;
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < pal.length; i++) {
          const [pr, pg, pb] = pal[i];
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
        L[(r << 10) | (g << 5) | b] = best;
      }
  LUTS.set(pal, L);
  return L;
}

/** Snap an RGBA buffer in place to the camp's ramps (see engine/palette.js quantise). */
export function quantiseCamp(data, w, h, dither = 0.5) {
  const L0 = lut(MASTER);
  const L1 = lut(WITH_SKIN);
  const amp = dither * 28;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = (bayer(x, y) - 0.5) * amp;
      const r = Math.min(255, Math.max(0, data[i] + o)) >> 3;
      const g = Math.min(255, Math.max(0, data[i + 1] + o)) >> 3;
      const b = Math.min(255, Math.max(0, data[i + 2] + o)) >> 3;
      const k = (r << 10) | (g << 5) | b;
      const c = data[i + 3] === SKIN_ALPHA ? WITH_SKIN[L1[k]] : MASTER[L0[k]];
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
}
