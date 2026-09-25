// Render animation definitions into palette-indexed layer frames.
import { FxFrame, quantizeGlow, isEmpty } from './raster.mjs';
import { rngFor } from './rng.mjs';
import { GLOW_RAMPS } from '../../../../src/art/combatFx/fxPalette.js';

/**
 * @returns {{ def, frames: Array<{ glow: Uint16Array|null, solid: Uint16Array|null }>,
 *            layers: string[] }}
 */
export function renderAnim(def, palette) {
  const [w, h] = def.size;
  const n = def.durations.length;
  const rng = rngFor(def.key);
  const params = def.setup ? def.setup(rng) : null;
  const ramp = GLOW_RAMPS[def.ramp] || null;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = new FxFrame(w, h, palette);
    def.draw(f, i, { n, t: n > 1 ? i / (n - 1) : 0, p: params, rng });
    const glow = ramp
      ? quantizeGlow(f, ramp, { cut: def.cut ?? 0.1, halo: def.halo ?? 'dither' })
      : null;
    frames.push({
      glow: glow && !isEmpty(glow) ? glow : null,
      solid: isEmpty(f.solid) ? null : new Uint16Array(f.solid),
    });
  }
  const layers = [];
  if (frames.some((fr) => fr.glow)) layers.push('glow');
  if (frames.some((fr) => fr.solid)) layers.push('solid');
  return { def, frames, layers, w, h };
}

/** Composite a rendered frame over an RGB ground (for previews and review sheets). */
export function compositeFrame(dst, dw, dh, ox, oy, rendered, i, palette, { add = true } = {}) {
  const { w, h, def } = rendered;
  const fr = rendered.frames[i];
  const rgb = palette.hex.map((hex) =>
    hex ? [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) : null,
  );
  const paintSolid = () => {
    if (!fr.solid) return;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const id = fr.solid[y * w + x];
        if (!id) continue;
        const X = ox + x;
        const Y = oy + y;
        if (X < 0 || Y < 0 || X >= dw || Y >= dh) continue;
        const d = (Y * dw + X) * 4;
        const c = rgb[id];
        dst[d] = c[0];
        dst[d + 1] = c[1];
        dst[d + 2] = c[2];
      }
  };
  const paintGlow = () => {
    if (!fr.glow) return;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const id = fr.glow[y * w + x];
        if (!id) continue;
        const X = ox + x;
        const Y = oy + y;
        if (X < 0 || Y < 0 || X >= dw || Y >= dh) continue;
        const d = (Y * dw + X) * 4;
        const c = rgb[id];
        if (add) {
          dst[d] = Math.min(255, dst[d] + c[0]);
          dst[d + 1] = Math.min(255, dst[d + 1] + c[1]);
          dst[d + 2] = Math.min(255, dst[d + 2] + c[2]);
        } else {
          dst[d] = c[0];
          dst[d + 1] = c[1];
          dst[d + 2] = c[2];
        }
      }
  };
  if (def.solidOnTop) {
    paintGlow();
    paintSolid();
  } else {
    paintSolid();
    paintGlow();
  }
}
