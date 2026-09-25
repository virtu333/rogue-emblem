// Effect frame raster: two layers per frame, both palette-pure by construction.
//
//   glow   float intensity field (0..1+), quantized onto the effect family's
//          additive ramp at output. Shapes composite with max(), so overlapping
//          strokes stay crisp instead of muddying into a sum.
//   solid  palette colour per pixel (normal blend): ink line work, unlight bodies,
//          physical debris. 0 = empty.
//
// Every primitive samples its analytic shape at pixel centres. No anti-aliasing,
// no Math.random: hard pixel edges, identical output on every run.

export class Palette {
  constructor() {
    this.hex = [null]; // index 0 = transparent
    this.map = new Map();
  }
  id(hex) {
    const key = hex.toLowerCase();
    let i = this.map.get(key);
    if (i === undefined) {
      i = this.hex.length;
      this.hex.push(key);
      this.map.set(key, i);
    }
    return i;
  }
}

export class FxFrame {
  constructor(w, h, palette) {
    this.w = w;
    this.h = h;
    this.pal = palette;
    this.glow = new Float32Array(w * h);
    this.solid = new Uint16Array(w * h);
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Max-composite an intensity at integer pixel (x, y). */
  g(x, y, v) {
    x |= 0;
    y |= 0;
    if (!(v > 0) || !this.inside(x, y)) return;
    const i = y * this.w + x;
    if (v > this.glow[i]) this.glow[i] = v;
  }

  /** Add intensity (clamped) — for deliberately hot overlaps (cores, crossings). */
  gAdd(x, y, v) {
    x |= 0;
    y |= 0;
    if (!(v > 0) || !this.inside(x, y)) return;
    const i = y * this.w + x;
    this.glow[i] = Math.min(1.25, this.glow[i] + v);
  }

  /** Cut glow out (for crescents carved by an inner circle, hollow stars...). */
  gClear(x, y) {
    if (this.inside(x | 0, y | 0)) this.glow[(y | 0) * this.w + (x | 0)] = 0;
  }

  s(x, y, hex) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    this.solid[y * this.w + x] = hex ? this.pal.id(hex) : 0;
  }

  sAt(x, y) {
    if (!this.inside(x | 0, y | 0)) return 0;
    return this.solid[(y | 0) * this.w + (x | 0)];
  }

  gAt(x, y) {
    if (!this.inside(x | 0, y | 0)) return 0;
    return this.glow[(y | 0) * this.w + (x | 0)];
  }
}

// 4x4 Bayer matrix, normalized to (0, 1).
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export function bayer(x, y) {
  return BAYER4[(y & 3) * 4 + (x & 3)];
}

/**
 * Quantize a frame's glow field onto a ramp (dim -> hot). Returns palette ids.
 *   cut    intensity below which a pixel stays transparent
 *   halo   'dither': the dimmest band is drawn on an ordered-dither pattern so a
 *          soft outer glow reads as sparse pixels; 'solid': drawn flat; 'none': dropped
 */
export function quantizeGlow(frame, ramp, { cut = 0.1, halo = 'dither' } = {}) {
  const ids = ramp.map((hex) => frame.pal.id(hex));
  const n = ids.length;
  const out = new Uint16Array(frame.w * frame.h);
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const i = y * frame.w + x;
      const v = frame.glow[i];
      if (!(v > cut)) continue;
      const u = Math.min(0.9999, (v - cut) / (1 - cut));
      const band = Math.floor(u * n);
      if (band === 0) {
        if (halo === 'none') continue;
        if (halo === 'dither') {
          const within = u * n; // 0..1 inside the dimmest band
          if (bayer(x, y) > 0.25 + within * 0.75) continue;
        }
      }
      out[i] = ids[band];
    }
  }
  return out;
}

/** Any non-empty pixel? */
export function isEmpty(ids) {
  for (let i = 0; i < ids.length; i++) if (ids[i]) return false;
  return true;
}
