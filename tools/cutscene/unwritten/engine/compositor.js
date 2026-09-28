// The page: layers stacked over a procedural sheet of vellum, each at its own paint
// stage. A stage change never cross-fades: each pixel flips when the stage passes its
// threshold, which is a fixed noise field (so paint lifts off, or goes on, in organic
// patches) broken at the edges by an ordered dither (so the edge reads as pixel art).

import { bayer, fbm, hash, hexToRgb, noiseField } from './raster.js';
import { C } from './palette.js';

/** A cool bone-grey vellum sheet, w*h RGBA. */
export function makePaper(w, h, seed = 7) {
  const out = new Uint8ClampedArray(w * h * 4);
  const [r0, g0, b0] = [214, 207, 196];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const cloud = (fbm(x, y, seed, 90, 4) - 0.5) * 16;
      const grain = (hash(x, y, seed + 3) - 0.5) * 5;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const vig = edge < 24 ? (24 - edge) * 0.5 : 0; // the page darkens toward its edge
      out[i] = r0 + cloud + grain - vig;
      out[i + 1] = g0 + cloud + grain - vig;
      out[i + 2] = b0 + cloud * 0.8 + grain - vig * 0.9;
      out[i + 3] = 255;
    }
  return out;
}

const INK = hexToRgb(C.sepia);
const GRAPHITE = hexToRgb(C.graphite);

/**
 * A layer placed on the page.
 * stages: from buildStages. x, y: top-left in page pixels. seed: its dissolve pattern.
 */
export class Layer {
  constructor(stages, x = 0, y = 0, seed = 1, grain = 20) {
    this.st = stages;
    this.x = x;
    this.y = y;
    this.mask = noiseField(stages.w, stages.h, seed, grain);
    this.tintRGB = null; // optional multiply, [r, g, b] 0..1 (lighting a figure for night)
  }
}

/**
 * Draw `layer` into the RGBA frame (fw*fh) at paint stage s (0 wash .. 3 paper).
 * `paper` is the page texture, same size as the frame; offsets are camera-adjusted.
 */
export function drawLayer(frame, fw, fh, paper, layer, s, ox = 0, oy = 0) {
  const { st, mask } = layer;
  if (s >= 3) return; // bare paper: the layer is gone
  s = Math.max(0, s);
  const k = Math.floor(s);
  const f = s - k;
  const x0 = layer.x - ox;
  const y0 = layer.y - oy;
  const tint = layer.tintRGB;
  for (let y = 0; y < st.h; y++) {
    const fy = y0 + y;
    if (fy < 0 || fy >= fh) continue;
    for (let x = 0; x < st.w; x++) {
      const fx = x0 + x;
      if (fx < 0 || fx >= fw) continue;
      const j = y * st.w + x;
      if (!st.alpha[j]) continue;
      const thr = 0.8 * mask[j] + 0.2 * bayer(fx, fy);
      const stage = f > thr ? k + 1 : k;
      if (stage >= 3) continue;
      const o = (fy * fw + fx) * 4;
      if (stage === 0) {
        let r = st.wash[j * 4];
        let g = st.wash[j * 4 + 1];
        let b = st.wash[j * 4 + 2];
        if (tint) {
          r *= tint[0];
          g *= tint[1];
          b *= tint[2];
        }
        frame[o] = r;
        frame[o + 1] = g;
        frame[o + 2] = b;
        continue;
      }
      // lines (1) or pencil (2): ink on paper
      const cov = stage === 1 ? st.line[j] : st.pencil[j];
      const inkOn = cov > bayer(fx + 3, fy + 5) * 0.9 + 0.05;
      if (inkOn) {
        const c = stage === 1 ? INK : GRAPHITE;
        frame[o] = c[0];
        frame[o + 1] = c[1];
        frame[o + 2] = c[2];
      } else if (st.figure) {
        // a figure hides what is behind it, even as a drawing: fill with the page,
        // plus a hint of the wash in the lines stage
        const t = stage === 1 ? st.tint : 0;
        frame[o] = paper[o] * (1 - t) + st.wash[j * 4] * t;
        frame[o + 1] = paper[o + 1] * (1 - t) + st.wash[j * 4 + 1] * t;
        frame[o + 2] = paper[o + 2] * (1 - t) + st.wash[j * 4 + 2] * t;
      } else if (stage === 1 && st.tint > 0) {
        const t = st.tint;
        frame[o] = frame[o] * (1 - t) + st.wash[j * 4] * t;
        frame[o + 1] = frame[o + 1] * (1 - t) + st.wash[j * 4 + 1] * t;
        frame[o + 2] = frame[o + 2] * (1 - t) + st.wash[j * 4 + 2] * t;
      }
    }
  }
}
