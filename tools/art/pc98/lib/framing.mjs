// Face framing estimate (eye line + face centre as fractions of the square)
// for portraits without hand-authored framing (pure). Used for the cut-in
// eyes strip and to weight the face when choosing a palette. Hand-authored
// values (src/ui/ceremonyPortraitFraming.json, config overrides) win.
import { toLab, components } from './raster.mjs';
import { isSkinLab } from './skin.mjs';

export const DEFAULT_FRAMING = Object.freeze({ eye: 0.36, cx: 0.52 });

/**
 * @param {Uint8Array} rgba square, straight alpha
 * @returns {{eye:number, cx:number, estimated:boolean}}
 */
export function estimateFraming(rgba, size) {
  const img = toLab(rgba, size, size);
  const skin = new Uint8Array(size * size);
  for (let y = 0; y < Math.floor(size * 0.78); y++)
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      if (img.mask[o] && isSkinLab([img.L[o], img.A[o], img.B[o]])) skin[o] = 1;
    }
  const comp = components(skin, size, size, 1, true);
  if (!comp.sizes.length) return { ...DEFAULT_FRAMING, estimated: false };
  // Prefer the highest sizeable blob (the face, not a bare chest or hands).
  let best = -1;
  let bestScore = -Infinity;
  const tops = new Array(comp.sizes.length).fill(size);
  for (let i = 0; i < skin.length; i++)
    if (skin[i]) tops[comp.labels[i]] = Math.min(tops[comp.labels[i]], Math.floor(i / size));
  comp.sizes.forEach((s, i) => {
    if (s < size * size * 0.012) return;
    const score = s / (size * size) - (tops[i] / size) * 0.08;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best < 0) return { ...DEFAULT_FRAMING, estimated: false };
  const top = tops[best];
  let minX = size;
  let maxX = 0;
  for (let i = 0; i < skin.length; i++)
    if (comp.labels[i] === best && Math.floor(i / size) < top + size * 0.12) {
      const x = i % size;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  const faceW = Math.max(size * 0.12, maxX - minX + 1);
  const band = top + faceW * 0.9;
  let sx = 0;
  let count = 0;
  for (let i = 0; i < skin.length; i++)
    if (comp.labels[i] === best && Math.floor(i / size) <= band) {
      sx += i % size;
      count++;
    }
  const eye = (top + faceW * 0.32) / size;
  const cx = count ? sx / count / size : DEFAULT_FRAMING.cx;
  return {
    eye: Math.round(Math.min(0.6, Math.max(0.2, eye)) * 200) / 200,
    cx: Math.round(Math.min(0.75, Math.max(0.25, cx)) * 200) / 200,
    estimated: true,
  };
}
