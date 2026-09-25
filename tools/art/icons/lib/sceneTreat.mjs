// PC-98 treatment for full-frame (non-square, opaque) generated scenes: card paintings
// and service vignettes. Same steps as tools/art/pc98 renderFigure (grade, cel flatten,
// own palette, ordered dither between near colours, despeckle, selective ink), then the
// palette is snapped onto the ART_BIBLE ramps so scenes share the game's colours.
import { toLab, bilateral } from '../../pc98/lib/raster.mjs';
import { choosePalette } from '../../pc98/lib/palette.mjs';
import { assignDithered, despeckle } from '../../pc98/lib/dither.mjs';
import { inkMask, inkColours } from '../../pc98/lib/lineart.mjs';
import { grade, materialMap, paletteWeights, INK } from '../../pc98/lib/pipeline.mjs';
import { rgbToOklab } from '../../pc98/lib/color.mjs';
import { RAMPS, hexToRgb } from './palette.mjs';

const ART = Object.values(RAMPS).flat().map(hexToRgb);
const ART_LAB = ART.map((c) => rgbToOklab(...c));

export function nearestArt(rgb) {
  const l = rgbToOklab(...rgb);
  let best = 0;
  let bd = Infinity;
  ART_LAB.forEach((p, i) => {
    const d = (p[0] - l[0]) ** 2 + 1.5 * ((p[1] - l[1]) ** 2 + (p[2] - l[2]) ** 2);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return ART[best];
}

/**
 * @param {Uint8Array} rgba opaque w*h*4
 * @returns {Uint8Array} treated rgba
 */
export function treatScene(
  rgba,
  w,
  h,
  { colours = 20, snap = true, ink = true, gradeOptions = {} } = {},
) {
  const src = Uint8Array.from(rgba);
  for (let i = 0; i < w * h; i++) src[i * 4 + 3] = 255;
  let img = toLab(src, w, h);
  img = grade(img, { shadowCool: 0.8, highlightWarm: 0.8, contrast: 1.05, ...gradeOptions });
  img = bilateral(img, 1.0, 0.05, 1);
  const { samples, weights } = paletteWeights(img, null);
  let palette = choosePalette(samples, weights, { k: colours, seed: 7 });
  if (snap) {
    const seen = new Set();
    palette = palette
      .map((p) => {
        const rgb = nearestArt(p.rgb);
        return { ...p, rgb, lab: rgbToOklab(...rgb) };
      })
      .filter((p) => {
        const k = p.rgb.join(',');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }
  const materials = materialMap(img, null, 'full');
  const { index, dithered } = assignDithered(img, palette, materials, { nearDist: 0.12 });
  const clean = despeckle(index, dithered, w, h);
  const out = new Uint8Array(w * h * 4);
  let lineIdx;
  if (ink) {
    const full = [{ rgb: INK.slice(), lab: rgbToOklab(...INK) }, ...palette];
    const lines = inkMask(img, { silhouetteLine: false, edgeThreshold: 0.11 });
    lineIdx = inkColours(img, lines, full, 0);
    for (let i = 0; i < w * h; i++) {
      const c = lineIdx[i] >= 0 ? full[lineIdx[i]].rgb : palette[clean[i]].rgb;
      out.set([c[0], c[1], c[2], 255], i * 4);
    }
  } else
    for (let i = 0; i < w * h; i++) {
      const c = palette[clean[i]].rgb;
      out.set([c[0], c[1], c[2], 255], i * 4);
    }
  return out;
}
