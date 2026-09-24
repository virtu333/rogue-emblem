// Figure/background separation for legacy portraits painted on an opaque
// backdrop (pure). Region-grows the backdrop from the frame border in OKLab:
// a pixel joins when it continues its neighbour smoothly (local step) and
// stays close to the dominant border colours (global model), so a figure cut
// by the frame bottom is never swallowed.
import { rgbToLab100 } from './color.mjs';
import { kmeans } from './palette.mjs';
import { cleanMask, components, dilate, erode } from './raster.mjs';

/** Morphological closing (8-connected, radius r) plus filling enclosed holes. */
export function closeAndFill(mask, w, h, radius) {
  let m = Uint8Array.from(mask);
  for (let i = 0; i < radius; i++) m = dilate(m, w, h, true);
  for (let i = 0; i < radius; i++) m = erode(m, w, h, true);
  // Never grow past the original along the frame edges: erode treats the
  // border as inside, so re-intersect edge rows/cols with a dilated original.
  let near = Uint8Array.from(mask);
  for (let i = 0; i < radius; i++) near = dilate(near, w, h, true);
  for (let i = 0; i < m.length; i++) m[i] = m[i] && near[i] ? 1 : 0;
  const holes = components(m, w, h, 0, false);
  for (let i = 0; i < m.length; i++) {
    if (m[i]) continue;
    const t = holes.touches[holes.labels[i]];
    if (!(t.top || t.bottom || t.left || t.right)) m[i] = 1;
  }
  for (let i = 0; i < m.length; i++) if (mask[i]) m[i] = 1;
  return m;
}

export function hasTransparency(rgba, w, h, fraction = 0.02) {
  let count = 0;
  for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] < 128) count++;
  return count / (w * h) >= fraction;
}

function labPlane(rgba, n) {
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = rgbToLab100(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    lab[i * 3] = v[0];
    lab[i * 3 + 1] = v[1];
    lab[i * 3 + 2] = v[2];
  }
  return lab;
}

const dist = (lab, i, c) =>
  Math.hypot(lab[i * 3] - c[0], lab[i * 3 + 1] - c[1], lab[i * 3 + 2] - c[2]);

/**
 * @returns {{mask: Uint8Array, background: number, model: number[][]}}
 *   mask 1 = figure; background = fraction removed
 */
export function segmentBackground(rgba, w, h, options = {}) {
  const {
    step = null,
    global = null,
    seedShare = 0.12,
    edges = ['top', 'left', 'right', 'bottom'],
    seed = 7,
    close = null,
    erode: shrink = 0,
    enclosed = 0,
  } = options;
  const n = w * h;
  const lab = labPlane(rgba, n);
  const border = [];
  const add = (x, y) => border.push(y * w + x);
  for (let x = 0; x < w; x++) {
    if (edges.includes('top')) add(x, 0);
    if (edges.includes('bottom')) add(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    if (edges.includes('left')) add(0, y);
    if (edges.includes('right')) add(w - 1, y);
  }
  const samples = new Float32Array(border.length * 3);
  border.forEach((p, i) => samples.set(lab.subarray(p * 3, p * 3 + 3), i * 3));
  const km = kmeans(samples, new Float32Array(border.length).fill(1), 4, { seed, iterations: 12 });
  const totalMass = km.mass.reduce((s, v) => s + v, 0) || 1;
  const model = km.centres.filter((_, i) => km.mass[i] / totalMass >= seedShare);
  // Tolerances adapt to how flat the backdrop is: a flat fill (#1a1a2e
  // composites) gets tight thresholds so dark armour is never eaten; a
  // painted, noisy backdrop gets looser ones.
  const spread = model.map((c) => {
    const ds = [];
    for (const p of border) {
      let best = Infinity;
      let owner = null;
      for (const m of model) {
        const d = dist(lab, p, m);
        if (d < best) {
          best = d;
          owner = m;
        }
      }
      if (owner === c && best < 0.06) ds.push(best);
    }
    ds.sort((a, b) => a - b);
    return ds.length ? ds[Math.floor(ds.length * 0.85)] : 0;
  });
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const globals = spread.map((sp) => global ?? clamp(3 * sp + 0.014, 0.02, 0.11));
  const stepOf = step ?? clamp(2 * Math.max(0, ...spread) + 0.01, 0.012, 0.035);
  const nearModel = (i) => model.some((c, t) => dist(lab, i, c) < globals[t]);
  const bg = new Uint8Array(n);
  const queue = [];
  for (const p of border)
    if (!bg[p] && nearModel(p)) {
      bg[p] = 1;
      queue.push(p);
    }
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % w;
    const y = (p / w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx;
      if (bg[q]) continue;
      const local = Math.hypot(
        lab[q * 3] - lab[p * 3],
        lab[q * 3 + 1] - lab[p * 3 + 1],
        lab[q * 3 + 2] - lab[p * 3 + 2],
      );
      if (local < stepOf && nearModel(q)) {
        bg[q] = 1;
        queue.push(q);
      }
    }
  }
  // Optionally also drop enclosed backdrop pockets (e.g. white showing
  // between an arm and an axe haft) of at least `enclosed` pixels.
  if (enclosed > 0) {
    const pocket = new Uint8Array(n);
    // Only the dominant backdrop colour forms pockets.
    let dom = 0;
    const kept = km.centres.map((c, i) => [c, km.mass[i]]).filter(([c]) => model.includes(c));
    kept.forEach(([, m], i) => {
      if (m > kept[dom][1]) dom = i;
    });
    for (let i = 0; i < n; i++)
      pocket[i] = !bg[i] && dist(lab, i, model[dom]) < globals[dom] * 0.5 ? 1 : 0;
    const pc = components(pocket, w, h, 1, false);
    for (let i = 0; i < n; i++) if (pocket[i] && pc.sizes[pc.labels[i]] >= enclosed) bg[i] = 1;
  }
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = bg[i] ? 0 : 1;
  mask = cleanMask(mask, w, h, { minIsland: 12, maxHole: 10 });
  // Flat-fill composites (the legacy enemy set) were cut out by an earlier
  // tool that punched backdrop-coloured holes through dark armour. Close the
  // silhouette and fill every enclosed hole: those pixels are dark figure.
  const flat = Math.max(0, ...spread) < 0.012;
  const radius = close ?? (flat ? 3 : 0);
  if (radius > 0) mask = closeAndFill(mask, w, h, radius);
  // Keep only figure parts attached to the main body (largest component).
  const comp = components(mask, w, h, 1, true);
  if (comp.sizes.length > 1) {
    const main = comp.sizes.indexOf(Math.max(...comp.sizes));
    for (let i = 0; i < n; i++)
      if (mask[i] && comp.labels[i] !== main && comp.sizes[comp.labels[i]] < 80) mask[i] = 0;
  }
  // Pale backdrops leave an anti-aliased fringe; shave it off.
  for (let i = 0; i < shrink; i++) mask = erode(mask, w, h, false);
  let removed = 0;
  for (let i = 0; i < n; i++) if (!mask[i]) removed++;
  return { mask, background: removed / n, model, tolerance: { globals, step: stepOf } };
}
