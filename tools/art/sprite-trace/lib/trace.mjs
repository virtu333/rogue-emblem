// The tracer pipeline for one figure:
//   source crop -> grid recovery (native pixel art) -> material segmentation ->
//   pixel-art-aware reduction -> ramp quantisation -> cleanup -> placed IndexedSprite
// plus the figure's own source ramps (identity colours). Pure given the source raster.
import { recoverGrid } from './grid.mjs';
import { largestComponent } from './figures.mjs';
import { segment } from './segment.mjs';
import { prepareNative, reduce, reduceMerge, absorbTextureLines, thinLines } from './reduce.mjs';
import {
  quantize,
  shortenBlade,
  remapSlot,
  tidyEyes,
  stampEyes,
  removeSpecks,
  removeOrphans,
  fillPinholes,
  removeSpurs,
  calmShades,
  pixelPerfect,
  keyLight,
  ensureEyes,
  clearFace,
} from './cleanup.mjs';
import { rampFromSamples, rampLab, nearestStep } from './ramps.mjs';
import { SLOT, SLOTS, BODY_EXCLUDE } from './slots.mjs';
import { fitScale, placement } from './place.mjs';
import { abstractNative, conditionRamp } from './simplify.mjs';

function bbox(w, h, pred) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (pred(y * w + x)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Recover the native pixel art of a figure crop. */
export function recoverFigure(crop, opts = {}) {
  const clean = largestComponent(crop, { alphaMin: 64, join: opts.join ?? 3 });
  const res = recoverGrid(clean, null, opts.grid || {});
  // trim to content
  const b = res.native.alphaBounds(0);
  return { ...res, native: res.native.crop(b.x, b.y, b.width, b.height) };
}

/**
 * Trace a native figure into an IndexedSprite placed in its texture.
 * recipe: segmentation recipe + { kind, scaleBias? } ; opts: { density }
 */
/** Keep only the largest gold-thread cluster (the belt/buckle); the rest becomes leather. */
function muteTrim(sp) {
  const seen = new Uint8Array(sp.w * sp.h);
  let best = null;
  const comps = [];
  for (let i = 0; i < sp.w * sp.h; i++) {
    if (sp.slot[i] !== SLOT.trim || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    for (let k = 0; k < comp.length; k++) {
      const x = comp[k] % sp.w,
        y = (comp[k] / sp.w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = (y + dy) * sp.w + x + dx;
        if (sp.inside(x + dx, y + dy) && !seen[j] && sp.slot[j] === SLOT.trim) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    comps.push(comp);
    if (!best || comp.length > best.length) best = comp;
  }
  const keep = new Set(best || []);
  const tmp = sp.clone();
  remapSlot(tmp, SLOT.trim, SLOT.leather, 0);
  for (let i = 0; i < sp.w * sp.h; i++)
    if (sp.slot[i] === SLOT.trim && !keep.has(i)) {
      sp.slot[i] = tmp.slot[i];
      sp.shade[i] = tmp.shade[i];
    }
}

export function traceNative(native, recipe = {}, { density = 1.5, mode = null, aspect = 1 } = {}) {
  const seg = segment(native, recipe);
  const prep = prepareNative(seg, { peel: recipe.peel !== false, thick: recipe.thick !== false });
  const { w, h } = seg;
  // source ramps per slot (identity colours come from the figure itself)
  const samples = {};
  for (let p = 0; p < w * h; p++) {
    const s = prep.fill[p];
    if (!s || s === SLOT.ink || s === SLOT.eye) continue;
    (samples[s] ||= []).push([seg.lab[p * 3], seg.lab[p * 3 + 1], seg.lab[p * 3 + 2]]);
  }
  const srcRamps = {};
  for (const [s, labs] of Object.entries(samples)) srcRamps[s] = rampFromSamples(labs);
  const rampLabs = Object.fromEntries(Object.entries(srcRamps).map(([s, r]) => [s, rampLab(r)]));
  // eye colour (mean of eye pixels)
  let eye = null;
  {
    const acc = [0, 0, 0, 0];
    for (let p = 0; p < w * h; p++)
      if (seg.slot[p] === SLOT.eye) {
        acc[0] += native.d[p * 4];
        acc[1] += native.d[p * 4 + 1];
        acc[2] += native.d[p * 4 + 2];
        acc[3]++;
      }
    if (acc[3]) eye = acc.slice(0, 3).map((v) => Math.round(v / acc[3]));
  }

  // scale from the body (weapons excluded) so a long lance never shrinks its wielder
  const body =
    bbox(w, h, (p) => prep.fill[p] && !BODY_EXCLUDE.has(prep.fill[p])) ||
    bbox(w, h, (p) => prep.fill[p]);
  const full = bbox(w, h, (p) => prep.fill[p]);
  const kind = recipe.kind || 'infantry';
  // `aspect` = a native pixel's height / width in the reviewed sheet (1 unless the sheet
  // was resized anisotropically): the sprite keeps the proportions the owner reviewed
  const asp = Math.max(0.5, Math.min(2, recipe.aspect ?? aspect ?? 1));
  let s = fitScale(body.height * asp, full.width, full.height * asp, kind, density);
  s *= recipe.scaleBias ?? 1;
  const sxy = Math.abs(asp - 1) < 0.02 ? s : { x: s, y: s * asp };

  if (s < (recipe.textureBelow ?? 0.8)) absorbTextureLines(prep, w, h);
  const abst = abstractNative(seg, prep, s, recipe.abstract || {});
  // Two reducers: near 1:1 the artist's exact pixels survive best (priority-merge
  // decimation); under strong reduction an area vote over abstracted materials is cleaner.
  const heavy = s < (recipe.heavyBelow ?? 0.55);
  // (decimation only removes lines: an enlargement, s >= 1, always uses the area vote)
  const useMode = recipe.mode || mode || (heavy || s >= 1 ? 'area' : 'merge');
  const red = (useMode === 'area' ? reduce : reduceMerge)(
    { ...seg, lab: abst.lab },
    { fill: abst.fill, dark: abst.dark },
    sxy,
    { head: seg.head, ...(recipe.reduce || {}) },
  );
  const sp = quantize(red, rampLabs);
  // trace thin trims, thread and weapon lines as continuous one-pixel lines
  if (recipe.lines !== false && useMode === 'area') {
    const LINE_SLOTS = [SLOT.linen, SLOT.trim, SLOT.metal, SLOT.wood, SLOT.glow];
    const weaponish = new Set([SLOT.metal, SLOT.wood, SLOT.glow]);
    for (const t of thinLines(w, h, abst.fill, abst.lab, sxy, red.mapPoint, LINE_SLOTS)) {
      const cur = sp.at(t.x, t.y);
      if (!sp.inside(t.x, t.y) || cur === SLOT.eye) continue;
      if (!cur && !weaponish.has(t.slot)) continue; // trims never grow the silhouette
      const ramp = rampLabs[t.slot];
      sp.set(t.x, t.y, t.slot, ramp ? nearestStep(ramp, t.lab) : 3);
    }
  }

  // native eye centroids -> target coordinates (at least one eye pixel per face)
  const eyePts = [];
  {
    const seen = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (seg.slot[p] !== SLOT.eye || seen[p]) continue;
      const stack = [p],
        comp = [];
      seen[p] = 1;
      while (stack.length) {
        const q = stack.pop();
        comp.push(q);
        const x = q % w,
          y = (q / w) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx,
              Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const r = Y * w + X;
            if (!seen[r] && seg.slot[r] === SLOT.eye) {
              seen[r] = 1;
              stack.push(r);
            }
          }
      }
      const cx = comp.reduce((a, q) => a + (q % w), 0) / comp.length + 0.5;
      const cy = comp.reduce((a, q) => a + ((q / w) | 0), 0) / comp.length + 0.5;
      let ey0 = Infinity,
        ey1 = -1;
      for (const q of comp) {
        ey0 = Math.min(ey0, (q / w) | 0);
        ey1 = Math.max(ey1, (q / w) | 0);
      }
      eyePts.push([...red.mapPoint(cx - 0.5, cy - 0.5), (ey1 - ey0 + 1) * s * asp >= 1.3]);
    }
  }

  // cleanup (order matters: shapes first, then shading, then line work, light last)
  fillPinholes(sp);
  removeSpurs(sp);
  // cleanup strength follows the reduction: near 1:1 the source's own clusters are kept
  if (recipe.orphans ?? heavy) removeOrphans(sp);
  removeSpecks(sp, recipe.speck ?? (heavy ? 2 : 1));
  calmShades(sp, recipe.calm ?? (heavy ? 2 : 0));
  pixelPerfect(sp, SLOT.ink);
  if (recipe.eyes !== false) {
    ensureEyes(sp, eyePts);
    tidyEyes(sp);
    if (seg.face) {
      const [a, b] = red.mapPoint(seg.head[0], seg.head[1]);
      const [c, d] = red.mapPoint(seg.head[2], seg.head[3]);
      if (recipe.clearFace !== false) clearFace(sp, [a, b, c, d]);
      stampEyes(sp, [a, b, c, d]);
    }
  }
  // art-direction notes on a design (owner review): bring a sword in, mute gold trim
  if (recipe.bladeKeep) shortenBlade(sp, recipe.bladeKeep);
  if (recipe.muteTrim) muteTrim(sp);
  if (recipe.keyLight ?? heavy) keyLight(sp);

  // place into the texture
  const fb = sp.bounds();
  const bb = sp.bounds((sl) => !BODY_EXCLUDE.has(sl)) || fb;
  const { size, dx, dy } = placement(fb, bb, density);
  const placed = sp.placed(size, size, dx, dy);
  placed.meta = {
    kind,
    density,
    scale: s,
    aspect: asp,
    native: { w, h },
    eye,
    slots: [...new Set(placed.slot)].filter(Boolean).map((i) => SLOTS[i]),
  };
  const ramps = {};
  for (const [sl, r] of Object.entries(srcRamps))
    ramps[sl] = recipe.condition === false ? r : conditionRamp(r, +sl);
  return { sprite: placed, ramps, srcRamps, seg, prep, eye };
}
