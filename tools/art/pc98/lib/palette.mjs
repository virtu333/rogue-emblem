// Perceptual palette selection for one portrait (pure, deterministic).
//
// 1. weighted k-means++ in OKLab over the figure's pixels (over-segmented, k0);
// 2. greedy Ward merging down to k, where a merge that would erase a whole
//    hue family (Edric's teal, Sera's red, an iris colour) or the highlight
//    extreme is heavily penalised: identity colours survive even when small;
// 3. weighted Lloyd refinement, then snap to 12-bit (4 bits per channel) and
//    drop duplicates. Forced `keep` colours (art-direction identity swatches)
//    are always present.
import { rgbToOklab, oklabToRgb, snap12, labDist, chroma, hue, hueDiff } from './color.mjs';
import { mulberry32 } from './raster.mjs';

function nearest(centres, l, a, b) {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < centres.length; c++) {
    const q = centres[c];
    const d = (q[0] - l) ** 2 + (q[1] - a) ** 2 + (q[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return [best, bestD];
}

/** Weighted k-means++ seeding + Lloyd iterations. samples: Float32Array n*3. */
export function kmeans(samples, weights, k, { seed = 1, iterations = 10 } = {}) {
  const n = weights.length;
  if (n === 0) return { centres: [], mass: [] };
  const rand = mulberry32(seed);
  const centres = [];
  // First centre: weighted draw.
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i];
  let pick = rand() * total;
  let first = 0;
  for (let i = 0; i < n; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      first = i;
      break;
    }
  }
  centres.push([samples[first * 3], samples[first * 3 + 1], samples[first * 3 + 2]]);
  const d2 = new Float64Array(n).fill(Infinity);
  while (centres.length < k) {
    const c = centres[centres.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d =
        (samples[i * 3] - c[0]) ** 2 +
        (samples[i * 3 + 1] - c[1]) ** 2 +
        (samples[i * 3 + 2] - c[2]) ** 2;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i] * weights[i];
    }
    if (sum <= 1e-12) break;
    let r = rand() * sum;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i] * weights[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centres.push([samples[chosen * 3], samples[chosen * 3 + 1], samples[chosen * 3 + 2]]);
  }
  let mass = new Float64Array(centres.length);
  for (let it = 0; it < iterations; it++) {
    const acc = centres.map(() => [0, 0, 0]);
    mass = new Float64Array(centres.length);
    for (let i = 0; i < n; i++) {
      const [c] = nearest(centres, samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]);
      const wt = weights[i];
      acc[c][0] += samples[i * 3] * wt;
      acc[c][1] += samples[i * 3 + 1] * wt;
      acc[c][2] += samples[i * 3 + 2] * wt;
      mass[c] += wt;
    }
    for (let c = 0; c < centres.length; c++)
      if (mass[c] > 0) centres[c] = acc[c].map((v) => v / mass[c]);
  }
  return { centres, mass: Array.from(mass) };
}

const NEUTRAL = 0.024;

/**
 * Colour families: all near-neutrals form one family (steel, bone, grey
 * hair); chromatic colours chain by hue (single linkage, gaps < 26 deg).
 * @returns {number[]} family id per centre
 */
export function families(centres) {
  const fam = new Array(centres.length).fill(0);
  const chromatic = [];
  centres.forEach((c, i) => {
    if (chroma(c) < NEUTRAL) fam[i] = 0;
    else chromatic.push({ i, h: hue(c) });
  });
  if (!chromatic.length) return fam;
  chromatic.sort((p, q) => p.h - q.h);
  // Start the chain after the widest hue gap so wrap-around is handled.
  let widest = 0;
  let start = 0;
  for (let t = 0; t < chromatic.length; t++) {
    const next = chromatic[(t + 1) % chromatic.length];
    const gap = (next.h - chromatic[t].h + 360) % 360 || (chromatic.length === 1 ? 360 : 0);
    if (gap > widest) {
      widest = gap;
      start = (t + 1) % chromatic.length;
    }
  }
  let id = 1;
  for (let t = 0; t < chromatic.length; t++) {
    const cur = chromatic[(start + t) % chromatic.length];
    if (t > 0) {
      const prev = chromatic[(start + t - 1) % chromatic.length];
      if ((cur.h - prev.h + 360) % 360 >= 26) id++;
    }
    fam[cur.i] = id;
  }
  return fam;
}

function isExtreme(centres, i) {
  let maxL = -Infinity;
  let second = -Infinity;
  for (let t = 0; t < centres.length; t++) {
    const L = centres[t][0];
    if (L > maxL) {
      second = maxL;
      maxL = L;
    } else if (L > second) second = L;
  }
  return centres[i][0] === maxL && maxL - second > 0.08;
}

/**
 * Merge clusters (Ward) down to k. Merges stay inside a colour family, so
 * every family with a real share of the figure keeps a representative (a
 * small teal scarf or steel pauldron is never averaged into skin); only
 * negligible families may fold into their nearest neighbour.
 */
export function mergeClusters(centres, mass, k, { minShare = 0.012, protect = 8 } = {}) {
  const C = centres.map((c) => c.slice());
  const M = mass.slice();
  const F = families(C);
  const total = M.reduce((s, v) => s + v, 0) || 1;
  const famMass = new Map();
  F.forEach((f, i) => famMass.set(f, (famMass.get(f) || 0) + M[i]));
  const weak = (f) => famMass.get(f) / total < minShare;
  // Too many families for k: the smallest ones lose protection.
  const ranked = [...famMass.keys()].sort((p, q) => famMass.get(q) - famMass.get(p));
  const protectedFams = new Set(ranked.filter((f) => !weak(f)).slice(0, k));
  while (C.length > k) {
    let best = null;
    let bestCost = Infinity;
    for (let pass = 0; pass < 2 && !best; pass++)
      for (let i = 0; i < C.length; i++)
        for (let j = 0; j < C.length; j++) {
          if (i === j) continue;
          const sameFamily = F[i] === F[j];
          if (pass === 0 && !sameFamily && protectedFams.has(F[i])) continue;
          const wi = Math.max(M[i], 1e-6);
          const wj = Math.max(M[j], 1e-6);
          let cost = ((wi * wj) / (wi + wj)) * labDist(C[i], C[j]) ** 2;
          if (isExtreme(C, i)) cost *= protect;
          if (cost < bestCost) {
            bestCost = cost;
            best = [i, j];
          }
        }
    const [i, j] = best;
    const wi = M[i];
    const wj = M[j];
    const w = wi + wj || 1;
    if (F[i] === F[j]) C[j] = C[j].map((v, t) => (v * wj + C[i][t] * wi) / w);
    // Cross-family (negligible family folding away): the survivor keeps its colour.
    M[j] = wi + wj;
    C.splice(i, 1);
    M.splice(i, 1);
    F.splice(i, 1);
  }
  return { centres: C, mass: M, families: F };
}

function refine(samples, weights, centres, fixed, iterations) {
  for (let it = 0; it < iterations; it++) {
    const acc = centres.map(() => [0, 0, 0]);
    const mass = new Float64Array(centres.length);
    for (let i = 0; i < weights.length; i++) {
      const p = [samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]];
      const [c] = nearest(centres, p[0], p[1], p[2]);
      // Refinement never drags a centre across families (keeps steel grey grey).
      const cc = centres[c];
      const sameFamily =
        chroma(cc) < NEUTRAL
          ? chroma(p) < NEUTRAL * 1.6
          : chroma(p) >= NEUTRAL * 0.6 && hueDiff(hue(p), hue(cc)) < 30;
      if (!sameFamily) continue;
      acc[c][0] += samples[i * 3] * weights[i];
      acc[c][1] += samples[i * 3 + 1] * weights[i];
      acc[c][2] += samples[i * 3 + 2] * weights[i];
      mass[c] += weights[i];
    }
    for (let c = 0; c < centres.length; c++)
      if (!fixed[c] && mass[c] > 0) centres[c] = acc[c].map((v) => v / mass[c]);
  }
  return centres;
}

/**
 * Choose at most `k` 12-bit colours for the samples.
 * @returns {Array<{rgb:number[], lab:number[]}>} sorted dark -> light
 */
/**
 * Small, saturated details the clusters missed (irises, gems, a lip tint):
 * accent samples far from every centre in both distance and hue.
 */
export function findAccents(
  accentSamples,
  centres,
  { maxAccents = 2, minCount = 5, seed = 3 } = {},
) {
  const far = [];
  for (let i = 0; i < accentSamples.length / 3; i++) {
    const p = [accentSamples[i * 3], accentSamples[i * 3 + 1], accentSamples[i * 3 + 2]];
    if (chroma(p) < 0.05 || p[0] < 0.3) continue;
    let bestD = Infinity;
    let best = null;
    for (const c of centres) {
      const d = labDist(p, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (bestD > 0.075 && (chroma(best) < 0.03 || hueDiff(hue(best), hue(p)) > 30)) far.push(...p);
  }
  const count = far.length / 3;
  if (count < minCount) return [];
  const groups = Math.min(maxAccents, Math.floor(count / minCount));
  const km = kmeans(Float32Array.from(far), new Float32Array(count).fill(1), groups, {
    seed,
    iterations: 8,
  });
  return km.centres.filter((_, i) => km.mass[i] >= minCount);
}

export function choosePalette(samples, weights, options = {}) {
  const {
    k = 13,
    k0 = 28,
    seed = 1,
    keep = [],
    protect = 10,
    iterations = 10,
    accentSamples = null,
    maxAccents = 2,
    minAccent = 5,
  } = options;
  const forced = keep.map((rgb) => snap12(rgb));
  const free = Math.max(1, k - forced.length);
  const km = kmeans(samples, weights, Math.max(free, Math.min(k0, weights.length)), {
    seed,
    iterations,
  });
  let merged = mergeClusters(km.centres, km.mass, free, { protect });
  let accentCount = 0;
  if (accentSamples && accentSamples.length) {
    const accents = findAccents(accentSamples, merged.centres, {
      maxAccents,
      minCount: minAccent,
    });
    if (accents.length) {
      merged = mergeClusters(km.centres, km.mass, Math.max(1, free - accents.length), { protect });
      merged = {
        centres: [...merged.centres, ...accents],
        mass: [...merged.mass, ...accents.map(() => 0)],
      };
      accentCount = accents.length;
    }
  }
  let centres = [...merged.centres];
  // Accents are exact detail colours: never refined toward larger regions.
  const fixed = centres.map((_, i) => i >= centres.length - accentCount);
  for (const rgb of forced) {
    centres.push(rgbToOklab(rgb[0], rgb[1], rgb[2]));
    fixed.push(true);
  }
  centres = refine(samples, weights, centres, fixed, 3);
  const out = [];
  const seen = new Set();
  centres.forEach((lab, idx) => {
    const forcedIdx = idx - merged.centres.length;
    const rgb = forcedIdx >= 0 ? forced[forcedIdx] : snap12(oklabToRgb(...lab));
    const key = rgb.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ rgb, lab: rgbToOklab(rgb[0], rgb[1], rgb[2]) });
  });
  out.sort((p, q) => p.lab[0] - q.lab[0] || p.rgb.join().localeCompare(q.rgb.join()));
  return out.slice(0, Math.max(k, forced.length));
}

export { nearest as nearestCentre };
