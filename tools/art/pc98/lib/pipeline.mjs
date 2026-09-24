// The PC-98 portrait pass for one figure at one size (pure).
//
// source RGBA (already resampled to size) ->
//   binary mask -> dark-palette grade -> de-pixelize (Gaussian) + cel flatten
//   (bilateral) -> perceptual 12-bit palette -> ordered dither between near
//   colours (material aware) -> despeckle -> selective ink.
import { rgbToOklab, chroma, hue, hueDiff, parseHex, snap12, labDist } from './color.mjs';
import { toLab, blurMasked, bilateral, cleanMask } from './raster.mjs';
import { choosePalette, nearestCentre } from './palette.mjs';
import { assignDithered, despeckle, MATERIAL } from './dither.mjs';
import { inkMask, inkColours, inFace } from './lineart.mjs';
import { isSkinLab } from './skin.mjs';

/** The shared line colour: the art-bible ink (#0e0c14) snapped to 12-bit. */
export const INK = Object.freeze(snap12(parseHex('#0e0c14')));

export function inkColour() {
  return INK.slice();
}

/** Hue-shifted grade: shadows lean violet/blue, highlights warm (art bible). */
export function grade(
  img,
  { shadowCool = 1, highlightWarm = 1, contrast = 1.04, saturation = 1 } = {},
) {
  const { L, A, B, mask } = img;
  const nL = Float32Array.from(L);
  const nA = Float32Array.from(A);
  const nB = Float32Array.from(B);
  for (let i = 0; i < L.length; i++) {
    if (!mask[i]) continue;
    const l = 0.5 + (L[i] - 0.5) * contrast;
    let a = A[i] * saturation;
    let b = B[i] * saturation;
    if (l < 0.42) {
      const k = ((0.42 - l) / 0.42) * shadowCool;
      a += 0.01 * k;
      b -= 0.022 * k;
    } else if (l > 0.7) {
      const k = ((l - 0.7) / 0.3) * highlightWarm;
      a += 0.003 * k;
      b += 0.01 * k;
    }
    nL[i] = Math.min(1, Math.max(0, l));
    nA[i] = a;
    nB[i] = b;
  }
  return { ...img, L: nL, A: nA, B: nB };
}

/** Skin-like pixels dither sparsely (faces stay smooth). */
export const isSkin = isSkinLab;

/**
 * Per-pixel material: skin (sparse checker only), cloth/metal (full pattern
 * levels) or flat (no dither). `mode` 'soft' keeps only checker on cloth and
 * none on skin; 'none' flattens everything (tiny thumbnails).
 */
export function materialMap(img, face, mode = 'full') {
  const { w, h, L, A, B, mask } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (!mask[o]) continue;
      if (mode === 'none') {
        out[o] = MATERIAL.FLAT;
        continue;
      }
      const lab = [L[o], A[o], B[o]];
      const skin = isSkin(lab) || (inFace(face, x, y) && lab[0] > 0.35 && chroma(lab) < 0.2);
      if (mode === 'soft') out[o] = skin ? MATERIAL.FLAT : MATERIAL.SKIN;
      else out[o] = skin ? MATERIAL.SKIN : MATERIAL.CLOTH;
    }
  return out;
}

export function paletteWeights(img, face) {
  const { w, h, L, A, B, mask } = img;
  const samples = [];
  const weights = [];
  const accents = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (!mask[o]) continue;
      const lab = [L[o], A[o], B[o]];
      let wt = 1 + 2 * Math.min(1, chroma(lab) / 0.12);
      if (inFace(face, x, y)) {
        wt += 2.5;
        accents.push(lab[0], lab[1], lab[2]);
      }
      if (lab[0] < 0.16) wt *= 0.4; // mostly becomes ink
      samples.push(lab[0], lab[1], lab[2]);
      weights.push(wt);
    }
  return {
    samples: Float32Array.from(samples),
    weights: Float32Array.from(weights),
    accentSamples: Float32Array.from(accents),
  };
}

/**
 * Keep the k colours of a master palette that matter most at this size
 * (greedy removal of the colour whose loss costs least), so thumbnails keep
 * the master's identity colours instead of inventing new ones. A colour that
 * is the last of its hue family costs extra to remove.
 */
export function reducePalette(palette, samples, weights, k, { protectFamilies = true } = {}) {
  let pal = palette.slice();
  const n = weights.length;
  while (pal.length > k && pal.some((p) => !p.keep)) {
    const labs = pal.map((p) => p.lab);
    const owner = new Int16Array(n);
    for (let i = 0; i < n; i++)
      owner[i] = nearestCentre(labs, samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2])[0];
    let best = -1;
    let bestCost = Infinity;
    for (let r = 0; r < pal.length; r++) {
      if (pal[r].keep) continue;
      const rest = labs.filter((_, i) => i !== r);
      let cost = 0;
      for (let i = 0; i < n; i++) {
        if (owner[i] !== r) continue;
        const p = [samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]];
        const [, d2] = nearestCentre(rest, p[0], p[1], p[2]);
        cost += weights[i] * (Math.sqrt(d2) - labDist(p, labs[r]));
      }
      if (protectFamilies && chroma(labs[r]) > 0.05) {
        const sameFamily = rest.some(
          (q) => chroma(q) > 0.035 && hueDiff(hue(q), hue(labs[r])) < 28,
        );
        if (!sameFamily) cost *= 4;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = r;
      }
    }
    pal = pal.filter((_, i) => i !== best);
  }
  return pal;
}

/**
 * Render one figure.
 * @param {Uint8Array|Uint8ClampedArray} rgba size*size*4, straight alpha
 * @returns {{w:number,h:number,indices:Uint8Array,palette:number[][],alpha:number[],
 *   colours:number, figurePalette:number[][]}}
 *   indices: 0 = transparent, 1.. = palette entries (ink included when used);
 *   figurePalette: the chosen colours without ink (reusable for smaller sizes)
 */
export function renderFigure(rgba, size, options = {}) {
  const {
    colours = 13,
    palette: masterPalette = null,
    keepPalette = [],
    keep = [],
    smooth = 0,
    cel = { sigmaS: 1.1, sigmaR: 0.045, iterations: 1 },
    gradeOptions = {},
    face = null,
    nearDist = 0.13,
    dither = 'full',
    line = {},
    seed = 1,
    minIsland = 4,
    maxHole = 6,
  } = options;
  let img = toLab(rgba, size, size);
  img.mask = cleanMask(img.mask, size, size, { minIsland, maxHole });
  img = grade(img, gradeOptions);
  if (smooth > 0.05) {
    const [L, A, B] = blurMasked(img, [img.L, img.A, img.B], smooth);
    img = { ...img, L, A, B };
  }
  if (cel && cel.sigmaS > 0) img = bilateral(img, cel.sigmaS, cel.sigmaR, cel.iterations || 1);

  const { samples, weights, accentSamples } = paletteWeights(img, face);
  let palette;
  if (masterPalette) {
    const kept = new Set(keepPalette.map((c) => c.join(',')));
    const labs = masterPalette.map((rgb) => ({
      rgb,
      lab: rgbToOklab(rgb[0], rgb[1], rgb[2]),
      keep: kept.has(rgb.join(',')),
    }));
    palette = reducePalette(labs, samples, weights, colours);
  } else {
    palette = choosePalette(samples, weights, { k: colours, keep, seed, accentSamples });
  }
  const ink = inkColour();
  const inkLab = rgbToOklab(...ink);
  // Colours indistinguishable from ink fold into it.
  palette = palette.filter((p) => labDist(p.lab, inkLab) > 0.035);

  const materials = materialMap(img, face, dither);
  const { index, dithered } = assignDithered(img, palette, materials, { nearDist });
  const clean = despeckle(index, dithered, size, size);

  const full = [{ rgb: ink, lab: inkLab }, ...palette];
  const lines = inkMask(img, { face, ...line });
  const lineIdx = inkColours(img, lines, full, 0);

  const n = size * size;
  const chosen = new Int16Array(n).fill(-1);
  const used = new Set();
  for (let i = 0; i < n; i++) {
    if (!img.mask[i]) continue;
    const v = lineIdx[i] >= 0 ? lineIdx[i] : clean[i] + 1; // +1: ink is entry 0 of `full`
    chosen[i] = v;
    used.add(v);
  }
  // Compact the palette to the colours actually used; index 0 is transparent.
  const order = [...used].sort((a, b) => a - b);
  const remap = new Map(order.map((v, i) => [v, i + 1]));
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (chosen[i] >= 0) indices[i] = remap.get(chosen[i]);
  const paletteRgb = order.map((v) => full[v].rgb.slice());
  return {
    w: size,
    h: size,
    indices,
    palette: [[0, 0, 0], ...paletteRgb],
    alpha: [0, ...paletteRgb.map(() => 255)],
    colours: paletteRgb.length,
    figurePalette: palette.map((p) => p.rgb.slice()),
    keepPalette: palette.filter((p) => p.keep).map((p) => p.rgb.slice()),
    mask: img.mask,
  };
}

/**
 * Composite a figure over a two-tone plate into one opaque indexed image.
 * @param {{indices:Uint8Array, palette:number[][]}} figure
 * @param {Uint8Array} plate 0/1 per pixel
 * @param {{top:number[], bottom:number[]}} tones
 */
export function bake(figure, plate, tones) {
  const palette = [tones.top, tones.bottom, ...figure.palette.slice(1)];
  const indices = new Uint8Array(figure.indices.length);
  for (let i = 0; i < indices.length; i++)
    indices[i] = figure.indices[i] ? figure.indices[i] + 1 : plate[i];
  // Merge duplicate colours (a figure colour equal to a plate tone).
  const key = (c) => c.join(',');
  const first = new Map();
  const remap = palette.map((c) => {
    if (!first.has(key(c))) first.set(key(c), first.size);
    return first.get(key(c));
  });
  const unique = [...first.keys()].map((k) => k.split(',').map(Number));
  for (let i = 0; i < indices.length; i++) indices[i] = remap[indices[i]];
  return compactIndexed({ w: figure.w, h: figure.h, indices, palette: unique });
}

/** Drop palette entries no pixel uses (keeps order). */
export function compactIndexed(img) {
  const used = new Uint8Array(img.palette.length);
  for (const v of img.indices) used[v] = 1;
  const map = new Int16Array(img.palette.length).fill(-1);
  const palette = [];
  img.palette.forEach((c, i) => {
    if (used[i]) {
      map[i] = palette.length;
      palette.push(c);
    }
  });
  const indices = img.indices.map((v) => map[v]);
  return { ...img, indices, palette };
}
