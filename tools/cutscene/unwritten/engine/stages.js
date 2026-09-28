// Paint stages: one generated painting becomes four registered layers,
//
//   0 wash    the painting as generated
//   1 lines   sepia ink lines on paper, with a faint hint of the wash
//   2 pencil  sparser graphite lines on paper
//   3 paper   nothing: the bare page
//
// The lines are found in the painting itself (difference of Gaussians, supersampled),
// so every stage sits exactly on the others. That is what lets the rewind strip a shot
// back to paper, and the next shot ink itself in, without any new art. Figures also
// get their one thicker contour from the silhouette.

import { blur, clamp, smooth } from './raster.js';

export const DEFAULTS = {
  ss: 3, // supersampling for line detection
  sigma: 0.9, // inner blur, in art pixels
  k: 1.8, // outer blur / inner blur
  gain: 22, // DoG response -> ink
  lineLo: 0.18, // ink coverage that starts to count as a line
  lineHi: 0.42,
  pencilLo: 0.34, // pencil keeps only the strongest lines
  pencilHi: 0.6,
  contour: 1, // silhouette contour width in art pixels (figures only)
  tint: 0.14, // how much wash shows in the lines stage
  plateSigma: 1.6, // plates: line width multiplier
  plateLift: 0.12, // plates: raise the line floor
};

/** Draw an image (or a region of it) into a w*h RGBA buffer. */
export function rasterise(img, w, h, crop = null, flip = false) {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  if (flip) {
    g.translate(w, 0);
    g.scale(-1, 1);
  }
  if (crop) g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  else g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/**
 * Build the stages of one layer.
 * @param img     HTMLImageElement / ImageBitmap
 * @param w,h     size in art pixels
 * @param opts    { figure: bool (keyed cut-out: contour + paper fill), crop, flip, ...DEFAULTS }
 * @returns { w, h, wash: Uint8ClampedArray RGBA, alpha: Uint8Array (0/1),
 *            line: Float32Array coverage, pencil: Float32Array coverage, figure }
 */
export function buildStages(img, w, h, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const ss = o.ss;
  const W = w * ss;
  const H = h * ss;
  const hi = rasterise(img, W, H, o.crop, o.flip);
  const lo = rasterise(img, w, h, o.crop, o.flip);

  // luminance and alpha at the supersampled size
  const lum = new Float32Array(W * H);
  const a = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const al = hi[i * 4 + 3] / 255;
    a[i] = al;
    const l = (0.299 * hi[i * 4] + 0.587 * hi[i * 4 + 1] + 0.114 * hi[i * 4 + 2]) / 255;
    // outside a figure, read as paper so the silhouette doesn't make its own DoG edge
    lum[i] = l * al + 0.85 * (1 - al);
  }
  const g1 = blur(lum, W, H, o.sigma * ss);
  const g2 = blur(lum, W, H, o.sigma * o.k * ss);

  // ink response: dark strokes are darker than their surroundings (g1 < g2)
  const inkHi = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) inkHi[i] = clamp((g2[i] - g1[i]) * o.gain) * a[i];

  // down to art pixels: average coverage
  const cov = new Float32Array(w * h);
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let sa = 0;
      for (let dy = 0; dy < ss; dy++)
        for (let dx = 0; dx < ss; dx++) {
          const j = (y * ss + dy) * W + x * ss + dx;
          s += inkHi[j];
          sa += a[j];
        }
      cov[y * w + x] = s / (ss * ss);
      alpha[y * w + x] = sa / (ss * ss) > 0.5 ? 1 : 0;
    }

  // the silhouette contour (figures): alpha pixels next to transparent ones
  const edge = new Float32Array(w * h);
  if (o.figure && o.contour > 0) {
    const r = o.contour;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!alpha[y * w + x]) continue;
        let out = false;
        for (let dy = -r; dy <= r && !out; dy++)
          for (let dx = -r; dx <= r && !out; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !alpha[yy * w + xx]) out = true;
          }
        if (out) edge[y * w + x] = 1;
      }
  }

  const line = new Float32Array(w * h);
  const pencil = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    line[i] = Math.max(smooth(o.lineLo, o.lineHi, cov[i]), edge[i]);
    pencil[i] = Math.max(smooth(o.pencilLo, o.pencilHi, cov[i]), edge[i] * 0.8);
  }

  const wash = new Uint8ClampedArray(lo);
  if (!o.figure) for (let i = 0; i < w * h; i++) alpha[i] = 1;
  return { w, h, wash, alpha, line, pencil, figure: !!o.figure, tint: o.tint };
}
