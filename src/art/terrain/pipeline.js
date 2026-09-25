// Render pipeline: an ordered list of region passes. A full render runs each
// pass over horizontal bands of the whole map (so it can be time-sliced);
// a repaint runs each pass over the dirty rectangles. Both produce identical
// pixels because every pass reads only earlier passes (or, for the edge
// scans, its own already-final neighbours) within the locality budget.
import { PALETTE_RGBA32 } from './palette.js';
import { ART_CELL as CELL } from './state.js';
import {
  passMaterials,
  passClean1,
  passClean2,
  passEdgesForward,
  passEdgesBackward,
  passGround,
  passDecals,
} from './ground.js';
import { passBridges } from './bridges.js';
import { passObjects } from './objects.js';

export const PASSES = Object.freeze([
  { name: 'materials', run: passMaterials },
  { name: 'clean1', run: passClean1 },
  { name: 'clean2', run: passClean2 },
  { name: 'edges-forward', run: passEdgesForward },
  { name: 'edges-backward', run: passEdgesBackward, bottomUp: true },
  { name: 'ground', run: passGround },
  { name: 'decals', run: passDecals },
  { name: 'bridges', run: passBridges },
  { name: 'objects', run: passObjects },
]);

/**
 * Generator over the work units of a full render. Each step runs one pass
 * over one band of `bandCells` cell rows and yields the pass name.
 */
export function* renderSteps(S, { bandCells = 2 } = {}) {
  const band = Math.max(1, bandCells | 0) * CELL;
  const starts = [];
  for (let y = 0; y < S.H; y += band) starts.push(y);
  const reversed = [...starts].reverse();
  for (const pass of PASSES) {
    for (const y of pass.bottomUp ? reversed : starts) {
      pass.run(S, 0, y, S.W, Math.min(S.H, y + band));
      yield pass.name;
    }
  }
  S.rendered = true;
}

/** Run a full render synchronously. */
export function renderAll(S) {
  for (const step of renderSteps(S, { bandCells: S.rows })) void step;
  return S;
}

/** Art-px rectangles covering the 3x3 neighbourhoods of the given cells, merged until disjoint. */
export function dirtyRects(S, cells) {
  let rects = cells.map(({ col, row }) => ({
    x0: Math.max(0, col - 1) * CELL,
    y0: Math.max(0, row - 1) * CELL,
    x1: Math.min(S.cols, col + 2) * CELL,
    y1: Math.min(S.rows, row + 2) * CELL,
  }));
  // Merge rectangles that overlap or touch: the edge scans read the pixel
  // just outside a rectangle, which must not be pending in another one.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < rects.length; a++)
      for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a],
          B = rects[b];
        if (A.x0 <= B.x1 && B.x0 <= A.x1 && A.y0 <= B.y1 && B.y0 <= A.y1) {
          rects[a] = {
            x0: Math.min(A.x0, B.x0),
            y0: Math.min(A.y0, B.y0),
            x1: Math.max(A.x1, B.x1),
            y1: Math.max(A.y1, B.y1),
          };
          rects.splice(b, 1);
          merged = true;
          break outer;
        }
      }
  }
  return rects;
}

/**
 * Re-render the given art-px rectangles (pass-major so every pass sees the
 * previous pass finished everywhere it reads).
 */
export function renderRects(S, rects) {
  for (const pass of PASSES) for (const k of rects) pass.run(S, k.x0, k.y0, k.x1, k.y1);
}

/**
 * Write palette colours for an art-px rectangle into an RGBA buffer that
 * holds the whole map at `scale` output px per art px.
 */
export function writeRGBA(S, out, scale, rect = null) {
  const { W, idx } = S;
  const x0 = rect ? rect.x0 : 0,
    y0 = rect ? rect.y0 : 0,
    x1 = rect ? rect.x1 : S.W,
    y1 = rect ? rect.y1 : S.H;
  const OW = W * scale;
  const out32 = new Uint32Array(out.buffer, out.byteOffset, out.byteLength >> 2);
  for (let y = y0; y < y1; y++) {
    const row = y * W;
    for (let sy = 0; sy < scale; sy++) {
      let o = (y * scale + sy) * OW + x0 * scale;
      for (let x = x0; x < x1; x++) {
        const v = PALETTE_RGBA32[idx[row + x]];
        for (let sx = 0; sx < scale; sx++) out32[o++] = v;
      }
    }
  }
  return out;
}
