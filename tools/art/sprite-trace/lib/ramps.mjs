// Material ramps: five-step colour ramps (darkest first) per slot, built from a
// figure's own pixels (identity: Edric's teal, Sera's red hair) or taken from the
// Art Bible (faction areas, metals, gold thread). Pure.
import { labToRgb, rgbToLab, hex, lch } from './color.mjs';

const R = (s) => s.split(/\s+/).map(hex);

// Art Bible ramps (docs/art-direction/ART_BIBLE.md) as 5-step picks, plus the skin/hair
// families that follow the same hue-shift rule (shadows violet/blue, lights warm).
export const BIBLE_RAMPS = {
  steelCloth: R('#1c2f4f #2c4c77 #4574a0 #77a5c6 #b8d8e6'),
  lacquer: R('#44111c #6e1a28 #9e2632 #cc4038 #ec7a5c'),
  verdigris: R('#1b4239 #2d6450 #4d8b66 #86b27b #c3d69a'),
  unlight: R('#170c24 #2c1645 #4a2270 #763aa0 #a863cc'),
  gold: R('#4f2c16 #80461f #b3702c #dca044 #f3cb6c'),
  ironTrim: R('#1a1a20 #2b2c33 #40414a #5a5b63 #7a7a80'),
  silver: R('#211d2b #403949 #766b77 #bdb0aa #f4ecdb'),
  iron: R('#16131e #2b2c33 #40414a #5a5b63 #7a7a80'),
  bladeP: R('#211d2b #58505e #978b94 #ddd0bd #f4ecdb'),
  bladeE: R('#16131e #40414a #766b77 #bdb0aa #ddd0bd'),
  charcoal: R('#0e0c14 #211d2b #2e293a #403949 #58505e'),
  leather: R('#1d1412 #3b2419 #5e3a22 #865632 #b07c4a'),
  linen: R('#58505e #978b94 #bdb0aa #ddd0bd #f4ecdb'),
  skinFair: R('#4a2530 #8a4a3e #c47f5e #e6b088 #f7dcc0'),
  skinWarm: R('#3e2027 #74402f #b06f4e #d6996c #eec39a'),
  skinOlive: R('#3a2a24 #6a4b37 #9c7452 #c49d74 #e2c49c'),
  skinTan: R('#2f1a1d #5e3426 #8f5638 #b87c52 #d9a878'),
  skinDeep: R('#1f1216 #3e2220 #633826 #8a5536 #b07b54'),
  hairBlack: R('#0e0c14 #1c1822 #2e293a #4a4252 #6f6577'),
  hairBrown: R('#1f1114 #44241e #6e3e28 #9a6238 #c08a50'),
  hairChestnut: R('#1c0f10 #3d1c17 #63301f #8c4a2b #b3703f'),
  hairAuburn: R('#2a0f12 #5e1e1a #8d2f2a #bf4532 #e0704a'),
  hairAsh: R('#3a2a1e #6e5530 #a88a48 #d6bb6e #f2e2a0'),
  hairSilver: R('#2e293a #58505e #978b94 #ddd0bd #f4ecdb'),
  hairSlate: R('#101a2e #1e2638 #343c52 #56607a #8a93aa'),
  // identity accents (headbands): never a faction hue
  rustCloth: R('#22120f #45231a #6b3a26 #93573a #b97d57'),
  oliveCloth: R('#1d1a12 #34301d #4f4a2a #6e6a3b #938c55'),
  ashCloth: R('#16131e #2e293a #403949 #58505e #766b77'),
  plumCloth: R('#1c111a #3e2d39 #5b4552 #7d6270 #a88d98'),
  glowGold: R('#80461f #dca044 #f3cb6c #fff0bd #ffffff'),
  glowUnlight: R('#2c1645 #763aa0 #a863cc #dcaaf0 #f4e4ff'),
};

export const INK = hex('#07060b');

/**
 * Build a 5-step ramp from Lab samples: weighted 1D k-means on lightness, each step the
 * mean colour of its members. Missing steps are interpolated/extrapolated in Lab so a
 * sparse slot still has five shades. Returns [[r,g,b] x5] darkest first.
 */
export function rampFromSamples(labs, steps = 5) {
  if (!labs.length) return null;
  const Ls = labs.map((l) => l[0]).sort((a, b) => a - b);
  // init centres at quantiles
  let centres = Array.from(
    { length: steps },
    (_, k) => Ls[Math.floor(((k + 0.5) / steps) * (Ls.length - 1))],
  );
  let assign = new Int32Array(labs.length);
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < labs.length; i++) {
      let bk = 0,
        bd = Infinity;
      for (let k = 0; k < centres.length; k++) {
        const d = Math.abs(labs[i][0] - centres[k]);
        if (d < bd) {
          bd = d;
          bk = k;
        }
      }
      assign[i] = bk;
    }
    const acc = centres.map(() => [0, 0]);
    for (let i = 0; i < labs.length; i++) {
      acc[assign[i]][0] += labs[i][0];
      acc[assign[i]][1]++;
    }
    centres = centres.map((c, k) => (acc[k][1] ? acc[k][0] / acc[k][1] : c));
  }
  const groups = centres.map((c) => ({ L: c, n: 0, lab: [0, 0, 0] }));
  for (let i = 0; i < labs.length; i++) {
    const g = groups[assign[i]];
    g.n++;
    g.lab[0] += labs[i][0];
    g.lab[1] += labs[i][1];
    g.lab[2] += labs[i][2];
  }
  let filled = groups
    .filter((g) => g.n)
    .map((g) => ({ lab: g.lab.map((v) => v / g.n), n: g.n }))
    .sort((a, b) => a.lab[0] - b.lab[0]);
  // merge steps closer than 4 L (they would read as noise)
  const merged = [];
  for (const g of filled) {
    const last = merged[merged.length - 1];
    if (last && g.lab[0] - last.lab[0] < 4) {
      const n = last.n + g.n;
      last.lab = last.lab.map((v, k) => (v * last.n + g.lab[k] * g.n) / n);
      last.n = n;
    } else merged.push({ ...g });
  }
  filled = merged;
  while (filled.length < steps) {
    // extend toward the wider gap end: darker by 12 L (cooler) or lighter by 12 L (warmer)
    const lo = filled[0].lab,
      hi = filled[filled.length - 1].lab;
    if (lo[0] > 100 - hi[0])
      filled.unshift({ lab: [Math.max(3, lo[0] - 12), lo[1] * 0.85, lo[2] * 0.85 - 3], n: 0 });
    else filled.push({ lab: [Math.min(97, hi[0] + 12), hi[1] * 0.85, hi[2] * 0.85 + 3], n: 0 });
  }
  return filled.slice(0, steps).map((g) => labToRgb(g.lab));
}

/** Index of the ramp step nearest to a Lab colour (lightness-weighted). */
export function nearestStep(rampLab, lab) {
  let best = 0,
    bd = Infinity;
  for (let k = 0; k < rampLab.length; k++) {
    const r = rampLab[k];
    const d = 2 * (r[0] - lab[0]) ** 2 + (r[1] - lab[1]) ** 2 + (r[2] - lab[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

export const rampLab = (ramp) => ramp.map(rgbToLab);

/** Mean hue/chroma of a ramp (to pick the closest Bible family). */
export function rampStats(ramp) {
  const l = ramp.map((c) => lch(rgbToLab(c)));
  return { L: l.map((v) => v[0]), C: l.map((v) => v[1]), h: l.map((v) => v[2]) };
}
