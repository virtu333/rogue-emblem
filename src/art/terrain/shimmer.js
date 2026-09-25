// Palette-cycling shimmer for liquids (SNES style). The terrain buffer is
// indexed, so animation never re-renders terrain: a handful of pixels (water
// glints, live lava seams and vents, acid scum) are tagged with a cycle
// class while painting, and each frame only those pixels are recoloured on a
// small transparent overlay that sits directly above the terrain image.
//
// Pure module: no DOM. The browser adapter (canvas.js) owns the overlay
// canvas, the timer and the reduced-motion check.
import { R, PALETTE_RGBA32 } from './palette.js';

export const ANIM = Object.freeze({ NONE: 0, WATER: 1, LAVA: 2, VENT: 3, ACID: 4 });

// Per class: colour cycle (palette indices) and how the phase travels.
// period = ms per step. Phases are offset per pixel so the field ripples
// instead of blinking in unison.
export const CYCLES = Object.freeze({
  [ANIM.WATER]: {
    colors: [R('tide', 5), R('tide', 6), R('tide', 5), R('tide', 4), R('tide', 4)],
    period: 220,
    phase: (x, y) => (x >> 2) + y * 3,
  },
  [ANIM.LAVA]: {
    colors: [R('ember', 3), R('ember', 4), R('ember', 4), R('ember', 3), R('blood', 3)],
    period: 260,
    phase: (x, y) => ((x + y) >> 3) + ((x * 7 + y * 13) & 1),
  },
  [ANIM.VENT]: {
    colors: [R('ember', 5), R('ember', 6), R('ember', 5), R('ember', 4)],
    period: 180,
    phase: (x, y) => (x ^ y) & 3,
  },
  [ANIM.ACID]: {
    colors: [R('acid', 3), R('acid', 4), R('acid', 3), R('acid', 2), R('acid', 2)],
    period: 300,
    phase: (x, y) => ((x * 5 + y * 3) >> 2) & 7,
  },
});

/**
 * Collect the animated pixels of a rendered state.
 * @returns {{count:number, index:Int32Array, cls:Uint8Array, phase:Uint16Array, bounds:{x0,y0,x1,y1}|null}}
 */
export function collectShimmer(state) {
  const { W, H, anim } = state;
  let count = 0;
  for (let i = 0; i < W * H; i++) if (anim[i]) count++;
  const index = new Int32Array(count);
  const cls = new Uint8Array(count);
  const phase = new Uint16Array(count);
  let k = 0,
    x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        a = anim[i];
      if (!a) continue;
      index[k] = i;
      cls[k] = a;
      phase[k] = CYCLES[a].phase(x, y) & 0xffff;
      k++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return { count, index, cls, phase, bounds: count ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null };
}

/**
 * Write one animation frame into an RGBA buffer at art resolution
 * (W x H, one pixel per art pixel). Non-animated pixels are left untouched,
 * so the caller clears the buffer once (transparent) and reuses it.
 * @param {ReturnType<typeof collectShimmer>} shimmer
 * @param {Uint32Array} out32  Uint32 view over the overlay RGBA buffer
 * @param {number} timeMs
 * @returns {number} how many pixels changed colour since the previous frame
 */
export function shimmerFrame(shimmer, out32, timeMs) {
  const steps = {};
  for (const k of Object.keys(CYCLES)) steps[k] = Math.floor(timeMs / CYCLES[k].period);
  let changed = 0;
  const { count, index, cls, phase } = shimmer;
  for (let k = 0; k < count; k++) {
    const c = CYCLES[cls[k]];
    const col = c.colors[(steps[cls[k]] + phase[k]) % c.colors.length];
    const v = PALETTE_RGBA32[col];
    const i = index[k];
    if (out32[i] !== v) {
      out32[i] = v;
      changed++;
    }
  }
  return changed;
}
