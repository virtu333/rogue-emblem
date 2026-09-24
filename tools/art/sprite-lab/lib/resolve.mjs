// Resolve a Figure (slot, shade, part) into RGBA, applying:
//   1. the ramp alias chain (identity -> faction treatment)
//   2. an optional grade (the corrupted "unlight" drain)
//   3. a lit-edge rim (key light upper-left)
//   4. a selective exterior outline (selout): dark and hue-tinted on the
//      shadow side, one ramp step lighter on the lit side.
import { RAMPS, INK, EYE, SPARK, UNLIGHT_EYE, mix, luma } from './palette.mjs';

const FIXED = { eye: EYE, spark: SPARK, ink: INK };

export function resolve(fig, alias, opts = {}) {
  const { grade = null, rim = true, outline = 'selout' } = opts;
  const out = new Uint8ClampedArray(fig.w * fig.h * 4);
  const rampOf = (slot) => {
    const name = alias[slot];
    const r = RAMPS[name];
    if (!r) throw new Error(`No ramp for slot '${slot}' (alias '${name}')`);
    return r;
  };
  const empty = (x, y) => !fig.inside(x, y) || !fig.slot[y * fig.w + x];
  const colorAt = (i, x, y) => {
    const slot = fig.slot[i];
    if (FIXED[slot]) {
      if (slot === 'eye' && grade?.eyes) return grade.eyes;
      return FIXED[slot];
    }
    let s = fig.shade[i];
    const part = fig.parts[fig.pid[i]];
    if (
      rim &&
      part?.rim &&
      slot !== 'skin' &&
      (empty(x, y - 1) || empty(x - 1, y)) &&
      !empty(x + 1, y)
    )
      s = Math.min(4, s + 1);
    if (grade?.cap != null && slot !== 'glow') s = Math.min(grade.cap, s);
    let c = rampOf(slot)[s];
    if (grade?.fn) c = grade.fn(c, slot, s);
    return c;
  };
  for (let y = 0; y < fig.h; y++)
    for (let x = 0; x < fig.w; x++) {
      const i = y * fig.w + x;
      let c = null;
      if (fig.slot[i]) c = colorAt(i, x, y);
      else if (outline) {
        // exterior outline, 4-connected. Probe order: below/right first (shadow side).
        for (const [dx, dy, lit] of [
          [0, 1, true], // filled pixel below => this outline pixel is on its lit top edge
          [1, 0, true],
          [0, -1, false],
          [-1, 0, false],
        ]) {
          const X = x + dx,
            Y = y + dy;
          if (empty(X, Y)) continue;
          const j = Y * fig.w + X;
          const part = fig.parts[fig.pid[j]];
          if (part && !part.outline) continue;
          const slot = fig.slot[j];
          const base = FIXED[slot] ? INK : rampOf(slot)[0];
          if (outline === 'ink') c = INK;
          else
            c = lit ? mix(base, INK, opts.litInk ?? 0.45) : mix(base, INK, opts.shadowInk ?? 0.72);
          if (grade?.fn && !FIXED[slot]) c = grade.fn(c, slot, 0);
          break;
        }
      }
      if (c) {
        out[i * 4] = c[0];
        out[i * 4 + 1] = c[1];
        out[i * 4 + 2] = c[2];
        out[i * 4 + 3] = 255;
      }
    }
  return out;
}

// Proposed acted state as a palette operation (possible because sprites are
// indexed): applied per material before the outline is built, so the
// outline and eyes stay put: colour drains (35% saturation left) and value drops
// ~14%, so the unit reads as spent without sinking into the ground.
export function actedGrade() {
  return {
    fn: (c) => {
      const l = luma(c);
      const g = mix(c, [l, l, l], 0.65);
      return g.map((v) => v * 0.86 + 6);
    },
  };
}

// The corrupted-enemy "unlight" grade: colour drains toward violet-black,
// highlights are capped (no light of their own), eyes take the unlight tint.
export function unlightGrade(strength = 0.5) {
  // bible unlight ramp, 6 steps, plus paper for the very top
  const U = ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'].map((h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]);
  const UL = U.map(luma);
  return {
    eyes: UNLIGHT_EYE,
    fn: (c, slot, shade) => {
      if (slot === 'glow') return c;
      const l = luma(c);
      // colour drains: 25% of the original saturation survives
      // the crimson faction area keeps a wine undertone so it still reads as the empire
      const g = mix(c, [l, l, l], slot === 'main' ? 0.4 : 0.75);
      // unlight colour at the same value
      let k = 0;
      while (k < U.length - 2 && UL[k + 1] < l) k++;
      const t = Math.max(0, Math.min(1, (l - UL[k]) / (UL[k + 1] - UL[k] || 1)));
      const u = mix(U[k], U[k + 1], t);
      // shadows lean harder into violet than lights; no warm highlights survive
      const w = strength * (l < 70 ? 1.2 : 0.8) * (slot === 'main' ? 0.45 : 1);
      let out = mix(g, u, Math.min(1, w));
      const target = l * (shade >= 4 ? 0.82 : 0.94);
      const ol = luma(out) || 1;
      out = out.map((v) => Math.max(0, Math.min(255, (v * target) / ol)));
      return out;
    },
  };
}
