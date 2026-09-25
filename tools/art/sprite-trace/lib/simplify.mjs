// Abstraction before reduction, and ramp conditioning after it.
//
// abstractNative: when the reduction is strong (s < ~0.6), detail smaller than a target
// pixel cannot survive anyway, and letting it compete produces confetti. A slot mode
// filter removes material specks thinner than the target pixel (eyes, weapon lines,
// line work and gold thread are protected) and a same-material Gaussian flattens
// texture noise inside each material while keeping its shading bands.
//
// conditionRamp: "lit actors" — a sprite's ramps are lifted out of pure black and
// kept off pure white (except metal highlights and eyes), steps are spaced so each
// reads, and the Art Bible hue shift is applied (shadows lean violet-blue, lights warm).
// Pure.
import { SLOT } from './slots.mjs';
import { rgbToLab, labToRgb, lch } from './color.mjs';

const PROTECT = new Set([SLOT.eye, SLOT.metal, SLOT.wood, SLOT.glow, SLOT.ink, SLOT.trim]);

export function abstractNative(seg, prep, s, { strength = 1 } = {}) {
  const { w, h } = seg;
  const n = w * h;
  const r = Math.max(0, Math.round((0.5 / s - 0.45) * strength));
  const fill = Uint8Array.from(prep.fill);
  const lab = Float32Array.from(seg.lab);
  if (r <= 0) return { fill, lab, dark: prep.dark, radius: 0 };
  // 1) slot mode filter (two passes)
  for (let pass = 0; pass < 2; pass++) {
    const snap = fill.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const own = snap[p];
        if (!own || PROTECT.has(own)) continue;
        const count = new Map();
        let total = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const X = x + dx,
              Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const t = snap[Y * w + X];
            if (!t || t === SLOT.ink) continue;
            const wt = dx || dy ? 1 : 2;
            count.set(t, (count.get(t) || 0) + wt);
            total += wt;
          }
        const mine = count.get(own) || 0;
        if (mine / total >= 0.34) continue;
        const [top, c] = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        if (top === own || c / total < 0.5 || PROTECT.has(top)) continue;
        fill[p] = top;
        // colour: mean of that material around
        const acc = [0, 0, 0, 0];
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const X = x + dx,
              Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const q = Y * w + X;
            if (snap[q] !== top) continue;
            acc[0] += seg.lab[q * 3];
            acc[1] += seg.lab[q * 3 + 1];
            acc[2] += seg.lab[q * 3 + 2];
            acc[3]++;
          }
        lab[p * 3] = acc[0] / acc[3];
        lab[p * 3 + 1] = acc[1] / acc[3];
        lab[p * 3 + 2] = acc[2] / acc[3];
      }
  }
  // 1b) gold specks smaller than half a target pixel cannot survive as thread
  {
    const minArea = 0.5 / (s * s);
    const seen = new Uint8Array(n);
    for (let p0 = 0; p0 < n; p0++) {
      if (fill[p0] !== SLOT.trim || seen[p0]) continue;
      const comp = [p0];
      seen[p0] = 1;
      for (let k = 0; k < comp.length; k++) {
        const p = comp[k],
          x = p % w,
          y = (p / w) | 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const X = x + dx,
            Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const q = Y * w + X;
          if (!seen[q] && fill[q] === SLOT.trim) {
            seen[q] = 1;
            comp.push(q);
          }
        }
      }
      if (comp.length >= minArea) continue;
      for (const p of comp) {
        const x = p % w,
          y = (p / w) | 0;
        const count = new Map();
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx,
              Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const t = fill[Y * w + X];
            if (t && t !== SLOT.trim && t !== SLOT.ink) count.set(t, (count.get(t) || 0) + 1);
          }
        if (!count.size) continue;
        const top = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        fill[p] = top;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ]) {
          const X = x + dx,
            Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h || fill[Y * w + X] !== top) continue;
          const q = Y * w + X;
          lab[p * 3] = lab[q * 3];
          lab[p * 3 + 1] = lab[q * 3 + 1];
          lab[p * 3 + 2] = lab[q * 3 + 2];
          break;
        }
      }
    }
  }
  // 2) same-material Gaussian on Lab (normalised convolution), sigma ~ half a target pixel
  const sigma = 0.45 / s;
  const R = Math.ceil(sigma * 2);
  const kern = [];
  for (let d = -R; d <= R; d++) kern.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  const tmp = new Float32Array(n * 4);
  const out = Float32Array.from(lab);
  // horizontal
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const sl = fill[p];
      if (!sl || PROTECT.has(sl)) continue;
      let a = 0,
        b = 0,
        c = 0,
        wsum = 0;
      for (let d = -R; d <= R; d++) {
        const X = x + d;
        if (X < 0 || X >= w) continue;
        const q = y * w + X;
        if (fill[q] !== sl) continue;
        const k = kern[d + R];
        a += lab[q * 3] * k;
        b += lab[q * 3 + 1] * k;
        c += lab[q * 3 + 2] * k;
        wsum += k;
      }
      tmp[p * 4] = a;
      tmp[p * 4 + 1] = b;
      tmp[p * 4 + 2] = c;
      tmp[p * 4 + 3] = wsum;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const sl = fill[p];
      if (!sl || PROTECT.has(sl)) continue;
      let a = 0,
        b = 0,
        c = 0,
        wsum = 0;
      for (let d = -R; d <= R; d++) {
        const Y = y + d;
        if (Y < 0 || Y >= h) continue;
        const q = Y * w + x;
        if (fill[q] !== sl || !tmp[q * 4 + 3]) continue;
        const k = kern[d + R];
        a += (tmp[q * 4] / tmp[q * 4 + 3]) * k;
        b += (tmp[q * 4 + 1] / tmp[q * 4 + 3]) * k;
        c += (tmp[q * 4 + 2] / tmp[q * 4 + 3]) * k;
        wsum += k;
      }
      if (wsum) {
        out[p * 3] = a / wsum;
        out[p * 3 + 1] = b / wsum;
        out[p * 3 + 2] = c / wsum;
      }
    }
  return { fill, lab: out, dark: prep.dark, radius: r };
}

// Per-slot lightness range for display ramps (L*).
const RANGE = {
  [SLOT.skin]: [24, 90],
  [SLOT.hair]: [14, 82],
  [SLOT.main]: [16, 78],
  [SLOT.sub]: [14, 62],
  [SLOT.leather]: [14, 68],
  [SLOT.metal]: [20, 97],
  [SLOT.armor]: [18, 94],
  [SLOT.trim]: [26, 90],
  [SLOT.linen]: [34, 94],
  [SLOT.wood]: [16, 72],
  [SLOT.mount]: [16, 90],
  [SLOT.mane]: [14, 88],
  [SLOT.glow]: [40, 99],
  [SLOT.accent]: [16, 80],
};

const hueToward = (h, target, t) => {
  let d = ((target - h + 540) % 360) - 180;
  return (h + d * t + 360) % 360;
};

/**
 * Condition a 5-step display ramp (mild, the default): the reference artist's values are
 * kept; only a near-black darkest step is lifted off pure black (so dark cloth still
 * reads against the outline and the acted/corrupted grades have room) and a blown top
 * step is capped, with a minimum step spacing so every shade reads. `{ strong: true }`
 * also stretches the ramp into the slot's range and applies the Art Bible hue shift
 * (shadows toward violet-blue, lights toward warm) — used by the earlier study and kept
 * for comparison; it flattens detailed references, so it is off by default.
 */
export function conditionRamp(ramp, slot, { strong = false, shift = 1 } = {}) {
  const l = ramp.map((c) => lch(rgbToLab(c)));
  if (!strong) {
    const lo = slot === SLOT.skin ? 30 : 9;
    const hi = slot === SLOT.metal || slot === SLOT.glow || slot === SLOT.armor ? 98 : 95;
    const Ls = l.map((v) => Math.min(hi, Math.max(lo, v[0])));
    for (let k = 1; k < Ls.length; k++) Ls[k] = Math.max(Ls[k], Ls[k - 1] + 4);
    return l.map(([, C, h], k) => {
      const rad = (h * Math.PI) / 180;
      return labToRgb([Math.min(99, Ls[k]), C * Math.cos(rad), C * Math.sin(rad)]);
    });
  }
  const [lo, hi] = RANGE[slot] || [14, 88];
  let Ls = l.map((v) => v[0]);
  // stretch into [lo, hi] keeping order, then enforce spacing >= 7
  const a = Ls[0],
    b = Ls[Ls.length - 1];
  const tgtLo = Math.max(lo, Math.min(a, hi - 30)),
    tgtHi = Math.min(hi, Math.max(b, lo + 30));
  Ls = Ls.map((v) => (b > a ? tgtLo + ((v - a) / (b - a)) * (tgtHi - tgtLo) : (tgtLo + tgtHi) / 2));
  for (let k = 1; k < Ls.length; k++) Ls[k] = Math.max(Ls[k], Ls[k - 1] + 7);
  if (Ls[Ls.length - 1] > hi + 4) {
    const over = Ls[Ls.length - 1] - (hi + 4);
    Ls = Ls.map((v, k) => v - (over * k) / (Ls.length - 1));
  }
  return l.map(([, C, h], k) => {
    const t = (k - 2) / 2; // -1 shadow .. +1 light
    let hh = h,
      cc = C;
    if (C > 4) {
      if (t < 0) hh = hueToward(h, 285, 0.12 * -t * shift);
      if (t > 0) hh = hueToward(h, 75, 0.1 * t * shift);
    } else if (t < 0) {
      // neutrals: shadows get a hint of violet, lights a hint of warmth
      hh = 290;
      cc = C + 3 * -t * shift;
    } else if (t > 0) {
      hh = 80;
      cc = C + 2 * t * shift;
    }
    const rad = (hh * Math.PI) / 180;
    return labToRgb([Ls[k], cc * Math.cos(rad), cc * Math.sin(rad)]);
  });
}
