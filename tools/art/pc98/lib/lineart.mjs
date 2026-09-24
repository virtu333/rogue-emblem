// Selective ink line art (pure).
//
// Three sources, all thinned to 1px:
//  - the silhouette (figure against transparency/backdrop);
//  - the reference's own dark line work (pixels clearly darker than their
//    neighbourhood), unified into one ink;
//  - strong luminance edges, inked on their darker side only and only where
//    that side is already mid-dark (bright/bright boundaries stay unlined).
// Chromatic mid-tones in the face (irises) are protected so eyes keep their
// colour. Lines through light materials (white hair, pale cloth) take a dark
// shade of the local hue instead of black: selective, not everything black.
import { sobel, silhouette, blurMasked } from './raster.mjs';
import { hue, hueDiff, chroma } from './color.mjs';

export function inFace(face, x, y) {
  if (!face) return false;
  const dx = (x - face.cx) / face.rx;
  const dy = (y - face.cy) / face.ry;
  return dx * dx + dy * dy <= 1;
}

/**
 * @returns {Uint8Array} 0 = no line, 1 = ink line, 2 = silhouette
 */
export function inkMask(img, options = {}) {
  const {
    edgeThreshold = 0.075,
    edgeMaxL = 0.52,
    lineContrast = 0.1,
    lineMaxL = 0.24,
    face = null,
    silhouetteLine = true,
    edges = true,
    sourceLines = true,
  } = options;
  const { w, h, L, A, B, mask } = img;
  const n = w * h;
  const out = new Uint8Array(n);
  const [local] = blurMasked(img, [L], 1.6);
  if (sourceLines)
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (L[i] < lineMaxL && local[i] - L[i] > lineContrast) out[i] = 1;
    }
  if (edges) {
    const { gx, gy, mag } = sobel(L, w, h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const o = y * w + x;
        if (!mask[o] || mag[o] < edgeThreshold || L[o] > edgeMaxL) continue;
        // Step one pixel along the gradient (towards the lighter side).
        const ux = gx[o] / mag[o];
        const uy = gy[o] / mag[o];
        const sx = Math.round(ux);
        const sy = Math.round(uy);
        const ahead = (y + sy) * w + (x + sx);
        const behind = (y - sy) * w + (x - sx);
        // Non-maximum suppression across the edge keeps lines 1px.
        if (mag[ahead] > mag[o] * 1.02 || mag[behind] > mag[o] * 1.02) {
          // Allow the darker pixel of a two-pixel ridge.
          if (!(L[o] < L[ahead] && L[o] < L[behind] && mag[o] > edgeThreshold * 1.6)) continue;
        }
        // Ink only the darker side of the edge.
        if (L[o] >= L[ahead]) continue;
        if (face && inFace(face, x, y)) {
          const lab = [L[o], A[o], B[o]];
          if (chroma(lab) > 0.06 && L[o] > 0.28) continue; // iris colour
        }
        out[o] = 1;
      }
  }
  // Lone ink dots read as dirt, except in the face (pupils, nostrils).
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const o = y * w + x;
      if (out[o] !== 1 || (face && inFace(face, x, y))) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && out[o + dy * w + dx]) neighbours++;
      if (!neighbours) out[o] = 0;
    }
  if (silhouetteLine) {
    const ring = silhouette(mask, w, h, false);
    for (let i = 0; i < n; i++) if (ring[i]) out[i] = 2;
  }
  return out;
}

/**
 * Pick the line colour for each inked pixel: the shared ink, or for light
 * surroundings a dark palette shade of the same hue.
 * @returns {Int16Array} palette index per pixel (-1 where no line)
 */
export function inkColours(img, lines, palette, inkIndex, options = {}) {
  const { lightSurround = 0.7 } = options;
  const { w, h, L, A, B } = img;
  const [local] = blurMasked(img, [L], 1.2);
  const [la, lb] = blurMasked(img, [A, B], 1.2);
  const out = new Int16Array(w * h).fill(-1);
  for (let i = 0; i < out.length; i++) {
    if (!lines[i]) continue;
    out[i] = inkIndex;
    if (local[i] < lightSurround) continue;
    const surround = [local[i], la[i], lb[i]];
    const hs = hue(surround);
    let best = -1;
    let bestL = Infinity;
    for (let c = 0; c < palette.length; c++) {
      if (c === inkIndex) continue;
      const lab = palette[c].lab;
      if (lab[0] > 0.5 || lab[0] > local[i] - 0.3) continue;
      if (chroma(surround) > 0.03 && chroma(lab) > 0.02 && hueDiff(hue(lab), hs) > 45) continue;
      if (lab[0] < bestL) {
        bestL = lab[0];
        best = c;
      }
    }
    if (best >= 0) out[i] = best;
  }
  return out;
}
