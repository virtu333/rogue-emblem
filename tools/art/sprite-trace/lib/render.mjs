// Resolve an IndexedSprite to RGBA: ramp per slot, interior line work tinted by the
// material it separates, and a generated selective exterior outline (selout) — the
// darkest step of the adjacent material pushed toward ink, softer on the lit
// (upper-left) side. Optional grade for corruption / acted states. Pure.
import { Raster } from './raster.mjs';
import { SLOT } from './slots.mjs';
import { INK } from './ramps.mjs';
import { mix, luma } from './color.mjs';

const N4 = [
  [0, 1, true], // fill below: this outline pixel sits on its lit top edge
  [1, 0, true], // fill to the right: lit left edge
  [-1, 0, false],
  [0, -1, false],
];

/**
 * palette: { ramps: { [slotId]: [[r,g,b] x5] }, eye?: [r,g,b], grade?: (rgb, slot, shade) => rgb,
 *            litInk?: number, shadowInk?: number, lineInk?: number, outline?: boolean }
 */
export function render(sp, palette) {
  const out = new Raster(sp.w, sp.h);
  const litInk = palette.litInk ?? 0.5;
  const shadowInk = palette.shadowInk ?? 0.78;
  const lineInk = palette.lineInk ?? 0.55;
  const grade = palette.grade || ((c) => c);
  const ramp = (s) => palette.ramps[s] || palette.ramps[SLOT.sub];
  const base = (s) => {
    if (s === SLOT.ink || s === SLOT.eye) return INK;
    return ramp(s)[0];
  };
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      const i = y * sp.w + x;
      const s = sp.slot[i];
      let c = null;
      if (s === SLOT.eye) c = grade(palette.eye || mix(INK, [60, 50, 80], 0.3), s, 0);
      else if (s === SLOT.ink) {
        // interior line: the darker neighbouring material's shadow, toward ink
        let best = null,
          bl = Infinity;
        for (const [dx, dy] of N4) {
          const t = sp.at(x + dx, y + dy);
          if (!t || t === SLOT.ink || t === SLOT.eye) continue;
          const b = ramp(t)[0];
          const l = luma(b);
          if (l < bl) {
            bl = l;
            best = [b, t];
          }
        }
        c = best ? grade(mix(best[0], INK, lineInk), best[1], 0) : grade(INK, s, 0);
      } else if (s) {
        c = grade(ramp(s)[sp.shade[i]], s, sp.shade[i]);
      } else if (palette.outline !== false) {
        for (const [dx, dy, lit] of N4) {
          const t = sp.at(x + dx, y + dy);
          if (!t) continue;
          const b = base(t);
          c = grade(mix(b, INK, lit ? litInk : shadowInk), t, 0);
          break;
        }
      }
      if (c) out.set(x, y, [c[0], c[1], c[2], 255]);
    }
  return out;
}
