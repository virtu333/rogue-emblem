// Solid "matter" bodies for effects that must read on bright ground as well as at
// night: flames, billows, smoke. An additive glow washes out to a pale disc on a lit
// meadow, so these effects draw their body with normal blending in hand-picked ramp
// bands (dark crimson rim -> orange -> gold -> cream core, like hand-drawn pixel fire)
// and keep the additive layer for their light (core bloom, halo, cinders).
//
// A body is drawn as an intensity field on a scratch frame (the same primitives as the
// glow), then quantized once onto a ramp with explicit band stops, so overlapping
// tongues merge into one silhouette with clean bands instead of stacking outlines.
import { FxFrame, bayer } from './raster.mjs';
import { field, clamp01, lerp, TAU, grain } from './draw.mjs';

/** Scratch intensity frame the size of `f` (draw into it with any glow primitive). */
export function bodyFrame(f) {
  return new FxFrame(f.w, f.h, f.pal);
}

/**
 * Quantize a body's intensity onto solid colours.
 *   ramp   hex colours, dim -> hot
 *   stops  ascending thresholds, one per ramp entry (stops[0] is the silhouette cut)
 *   dither 'low': the dimmest band keeps only an ordered-dither half of its pixels
 *          (a haze edge); number n (0..1): keep a seeded-grain fraction n of the
 *          body's pixels (smoke breaking up into scattered pixels, not a mesh)
 *   block  grain cell size in px for the numeric dither (2: breaks up in 2x2 chunks)
 */
export function paintBody(f, body, ramp, stops, { dither = null, over = true, block = 1 } = {}) {
  const ids = ramp.map((hex) => f.pal.id(hex));
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const v = body.glow[y * f.w + x];
      if (!(v > stops[0])) continue;
      if (typeof dither === 'number' && grain((x / block) | 0, (y / block) | 0, 29) > dither)
        continue;
      let band = 0;
      while (band + 1 < stops.length && v > stops[band + 1]) band++;
      if (dither === 'low' && band === 0 && bayer(x, y) > 0.5) continue;
      const i = y * f.w + x;
      if (!over && f.solid[i]) continue;
      f.solid[i] = ids[band];
    }
}

/**
 * Flame tongue rooted at (bx, by), rising `h` px with half-width `w` at its root.
 * Writes how far inside the silhouette a pixel is: 0 at the edge rising to 1 about
 * `rim` px in, times a tip fade, so every tongue gets the same thin dark rim whatever
 * its width. Colour comes later from a heat map (see paintFlame), which is what makes
 * several tongues read as one fire with a cream core low in the middle.
 * `sway` bends the tip sideways (px at the tip), `wob`/`ph` add a lick along the body.
 * Edges are ragged per row (seeded grain) like drawn pixel fire.
 */
export function flameTongue(
  b,
  bx,
  by,
  h,
  w,
  { sway = 0, wob = 0, ph = 0, rim = 2.2, seed = 1, round = 0.45 } = {},
) {
  if (h <= 0.5 || w <= 0.3) return;
  const pad = w + Math.abs(sway) + Math.abs(wob) + 2;
  field(b, bx - pad, by - h - 2, bx + pad, by + w * round + 1, (px, py, x, y) => {
    const v = (by - py) / h; // 0 at the root, 1 at the tip
    if (v > 1 || v < -round) return 0;
    const cx = bx + sway * v * v + wob * Math.sin(v * TAU * 0.8 + ph) * v;
    let hw;
    if (v < 0) hw = w * Math.sqrt(Math.max(0, 1 - (v / round) ** 2));
    else hw = w * (1 - v) ** 0.9 * (1 + 0.2 * Math.sin(Math.PI * Math.min(1, v * 1.6)));
    hw += (grain(y, seed, 11) - 0.5) * 1.1;
    const d = Math.abs(px - cx);
    if (d > hw) return 0;
    const inside = Math.min(1, (hw - d + 0.5) / rim);
    return inside * (v > 0.55 ? 1 - (v - 0.55) * 0.9 : 1);
  });
}

/**
 * Colour a flame silhouette: v = inside * heat(x, y), where heat falls off from a
 * core point (cx, cy) over an ellipse (rx, ry) and is scaled by `heat`. Returns the
 * frame for chaining. The result goes through paintBody's band stops.
 */
export function heatShade(b, cx, cy, rx, ry, heat = 1) {
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const i = y * b.w + x;
      const v = b.glow[i];
      if (!(v > 0)) continue;
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / (y + 0.5 < cy ? ry : ry * 0.45);
      const hot = clamp01(1 - Math.hypot(dx, dy));
      b.glow[i] = v * heat * (0.34 + 0.72 * hot);
    }
  return b;
}

/**
 * Billow puff (breath, smoke): a disc lit from the upper-left, hottest on its lit
 * side, with a scalloped rim. `lit` 0..1 is how strongly the key light shades it.
 */
export function puff(b, cx, cy, r, v, { lit = 0.35, seed = 1, scallop = 0.12 } = {}) {
  if (r <= 0.4 || v <= 0) return;
  field(b, cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    const a = Math.atan2(dy, dx);
    const rr =
      r * (1 + scallop * Math.sin(a * 5 + seed * 1.7) + scallop * 0.6 * Math.sin(a * 3 - seed));
    const d = Math.hypot(dx, dy);
    if (d > rr) return 0;
    const light = (-dx - dy) / (rr * 1.414); // -1 lower-right .. 1 upper-left
    const edge = d / rr;
    return v * (0.55 + 0.45 * (1 - edge ** 2)) * (1 + lit * light);
  });
}

/** A curled wisp (breaking flame, smoke curl): a tapering stroke along a bent path. */
export function wisp(b, x, y, len, { dir = -Math.PI / 2, curl = 1, w = 2, v = 0.5 } = {}) {
  const steps = Math.max(4, Math.ceil(len * 1.5));
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    const a = dir + curl * s * s * 1.6;
    // integrate the bend
    const px = x + Math.cos(dir) * len * s + Math.cos(a) * len * 0.15 * s;
    const py = y + Math.sin(dir) * len * s + Math.sin(a) * len * 0.15 * s + curl * s * s * 2;
    const r = lerp(w, 0.45, s);
    const val = v * (1 - 0.35 * s);
    field(b, px - r - 1, py - r - 1, px + r + 1, py + r + 1, (qx, qy) =>
      Math.hypot(qx - px, qy - py) <= r ? val : 0,
    );
  }
}

export { clamp01 };
