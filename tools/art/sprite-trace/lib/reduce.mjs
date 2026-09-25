// Pixel-art-aware reduction of a segmented native figure to map size.
//
// Not an image resize: the native is first split into what a pixel artist would
// redraw rather than shrink —
//   * the exterior outline is peeled (it is regenerated at the target size),
//   * thick near-black areas are shading of the material under them (they become
//     that material's darkest step), thin ones are line work,
// then every target pixel takes the slot with the highest coverage x priority in
// its exact footprint (eyes, gold thread, faces, weapon lines win small contests),
// its colour is the mean of that slot's pixels there, and the sampling phase is
// chosen to keep edges crisp. Pure and deterministic.
import { SLOT, PRIORITY, WEAPON_SLOTS } from './slots.mjs';

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Split ink into exterior outline (peeled), thick dark fill (absorbed into the
 * neighbouring material) and line work. Returns { fill: Uint8Array slot per pixel
 * (0 = transparent or peeled), dark: Uint8Array (1 = absorbed ink shade) }.
 */
export function prepareNative(seg, { peel = true, thick = true } = {}) {
  const { w, h } = seg;
  const n = w * h;
  const fill = Uint8Array.from(seg.slot);
  const dark = new Uint8Array(n);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : fill[y * w + x]);
  // 1) peel the exterior ink ring (one layer, plus a second where the ring is doubled)
  for (let pass = 0; pass < (peel ? 2 : 0); pass++) {
    const peelList = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (fill[p] !== SLOT.ink) continue;
        const outside = N4.some(([dx, dy]) => at(x + dx, y + dy) === 0);
        if (!outside) continue;
        // second pass only peels ink that has no non-ink neighbour (a doubled ring)
        if (pass === 1 && N4.some(([dx, dy]) => (at(x + dx, y + dy) || SLOT.ink) !== SLOT.ink))
          continue;
        peelList.push(p);
      }
    for (const p of peelList) fill[p] = 0;
  }
  // 2) thick ink (distance to non-ink >= 2 inside the fill) is dark material, not a line
  const dist = new Float32Array(n).fill(0);
  for (let p = 0; p < n; p++) dist[p] = fill[p] === SLOT.ink ? 99 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!dist[p]) continue;
      if (x > 0) dist[p] = Math.min(dist[p], dist[p - 1] + 1);
      if (y > 0) dist[p] = Math.min(dist[p], dist[p - w] + 1);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (!dist[p]) continue;
      if (x < w - 1) dist[p] = Math.min(dist[p], dist[p + 1] + 1);
      if (y < h - 1) dist[p] = Math.min(dist[p], dist[p + w] + 1);
    }
  const thickOn = thick;
  thick = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (thickOn && fill[p] === SLOT.ink && dist[p] >= 2) thick[p] = 1;
  // grow cores by one pixel (the core's rim is part of the same dark mass)
  const core = thick.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (fill[p] !== SLOT.ink || core[p]) continue;
      const nearCore = N4.some(([dx, dy]) => {
        const X = x + dx,
          Y = y + dy;
        return X >= 0 && Y >= 0 && X < w && Y < h && core[Y * w + X];
      });
      if (nearCore) thick[p] = 1;
    }
  // absorb thick ink into the nearest non-ink material (multi-source BFS)
  const queue = [];
  const owner = new Uint8Array(n);
  for (let p = 0; p < n; p++)
    if (fill[p] && fill[p] !== SLOT.ink) {
      owner[p] = fill[p];
      queue.push(p);
    }
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % w,
      y = (p / w) | 0;
    for (const [dx, dy] of N4) {
      const X = x + dx,
        Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const q = Y * w + X;
      if (owner[q] || !thick[q]) continue;
      owner[q] = owner[p];
      queue.push(q);
    }
  }
  for (let p = 0; p < n; p++)
    if (thick[p] && owner[p] && owner[p] !== SLOT.eye) {
      fill[p] = owner[p];
      dark[p] = 1;
    }
  return { fill, dark };
}

/**
 * Texture line work: a thin ink line with the same material on both sides is a fold,
 * strap or seam drawn *inside* one material. Under a strong reduction it cannot stay a
 * line (it would become black confetti), so it becomes that material's darkest step.
 * Contours between different materials stay ink. Mutates prep; returns count.
 */
export function absorbTextureLines(prep, w, h, passes = 2) {
  let count = 0;
  for (let pass = 0; pass < passes; pass++) {
    const snap = prep.fill.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (snap[p] !== SLOT.ink) continue;
        const seen = new Set();
        let transparent = false;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const X = x + dx,
              Y = y + dy;
            const t = X < 0 || Y < 0 || X >= w || Y >= h ? 0 : snap[Y * w + X];
            if (!t) transparent = true;
            else if (t !== SLOT.ink) seen.add(t);
          }
        if (transparent || seen.size !== 1) continue;
        const [only] = seen;
        if (only === SLOT.eye) continue;
        prep.fill[p] = only;
        prep.dark[p] = 1;
        count++;
      }
  }
  return count;
}

/**
 * Reduce to a target scale `s` (target px per native px). Returns
 * { w, h, slot: Uint8Array, lab: Float32Array(3n), dark: Float32Array, offset }
 * where lab is the mean Lab of the winning slot's pixels in each footprint and
 * dark is the fraction of those that were absorbed ink (drives shade 0).
 */
export function reduce(seg, prep, s, opts = {}) {
  const { w, h } = seg;
  // s may be anisotropic ({ x, y }) when a sheet's fake pixels were not square
  const sx = typeof s === 'number' ? s : s.x,
    sy = typeof s === 'number' ? s : s.y;
  const W = Math.ceil(w * sx) + 2,
    H = Math.ceil(h * sy) + 2;
  const alphaMin = opts.alphaMin ?? 0.5;
  const thinMin = opts.thinMin ?? 0.3;
  const invx = 1 / sx,
    invy = 1 / sy;
  const head = opts.head || null; // native head box: skin there wins close contests (faces read)
  const faceBoost = opts.faceBoost ?? 1.6;

  const sample = (ox, oy, full) => {
    const slot = new Uint8Array(W * H);
    const lab = full ? new Float32Array(W * H * 3) : null;
    const darkF = full ? new Float32Array(W * H) : null;
    let crisp = 0;
    const cov = new Float64Array(32);
    const score = new Float64Array(32);
    const acc = full ? new Float64Array(32 * 4) : null;
    for (let Y = 0; Y < H; Y++)
      for (let X = 0; X < W; X++) {
        const ax = (X - 1) * invx - ox,
          bx = ax + invx,
          ay = (Y - 1) * invy - oy,
          by = ay + invy;
        cov.fill(0);
        score.fill(0);
        if (acc) acc.fill(0);
        let total = 0;
        for (let y = Math.max(0, Math.floor(ay)); y < Math.min(h, Math.ceil(by)); y++) {
          const fy = Math.min(by, y + 1) - Math.max(ay, y);
          if (fy <= 0) continue;
          for (let x = Math.max(0, Math.floor(ax)); x < Math.min(w, Math.ceil(bx)); x++) {
            const fx = Math.min(bx, x + 1) - Math.max(ax, x);
            if (fx <= 0) continue;
            const p = y * w + x;
            const sl = prep.fill[p];
            if (!sl) continue;
            const a = (fx * fy) / (invx * invy);
            cov[sl] += a;
            const inHead = head && x >= head[0] && x < head[2] && y >= head[1] && y < head[3];
            score[sl] += a * (inHead && (sl === SLOT.skin || sl === SLOT.eye) ? faceBoost : 1);
            total += a;
            if (acc) {
              acc[sl * 4] += seg.lab[p * 3] * a;
              acc[sl * 4 + 1] += seg.lab[p * 3 + 1] * a;
              acc[sl * 4 + 2] += seg.lab[p * 3 + 2] * a;
              acc[sl * 4 + 3] += prep.dark[p] * a;
            }
          }
        }
        let thin = 0;
        for (const t of WEAPON_SLOTS) thin += cov[t];
        crisp += Math.abs(2 * Math.min(1, total) - 1);
        const opaque = total >= alphaMin || thin >= thinMin || cov[SLOT.eye] > 0.2;
        if (!opaque) continue;
        let best = 0,
          bv = 0;
        for (let sl = 1; sl < 32; sl++) {
          const v = score[sl] * (PRIORITY[sl] ?? 1);
          if (v > bv) {
            bv = v;
            best = sl;
          }
        }
        const t = Y * W + X;
        slot[t] = best;
        if (full && cov[best] > 0) {
          lab[t * 3] = acc[best * 4] / cov[best];
          lab[t * 3 + 1] = acc[best * 4 + 1] / cov[best];
          lab[t * 3 + 2] = acc[best * 4 + 2] / cov[best];
          darkF[t] = acc[best * 4 + 3] / cov[best];
        }
      }
    return { slot, lab, dark: darkF, crisp };
  };

  // choose the sampling phase that keeps the silhouette crispest
  let bestPhase = [0, 0],
    bestCrisp = -1;
  const phases = opts.phases ?? 4;
  for (let i = 0; i < phases; i++)
    for (let j = 0; j < phases; j++) {
      const ox = (i / phases) * invx,
        oy = (j / phases) * invy;
      const { crisp } = sample(ox, oy, false);
      if (crisp > bestCrisp + 1e-9) {
        bestCrisp = crisp;
        bestPhase = [ox, oy];
      }
    }
  const out = sample(bestPhase[0], bestPhase[1], true);
  return {
    w: W,
    h: H,
    slot: out.slot,
    lab: out.lab,
    dark: out.dark,
    offset: bestPhase,
    scale: s,
    mapPoint: (x, y) => [(x + bestPhase[0]) * sx + 1, (y + bestPhase[1]) * sy + 1],
  };
}

// ---------------------------------------------------------------------------------
// Priority-merge decimation: the reduction keeps the artist's exact pixels. Each
// target row is one to four consecutive source rows merged pixel by pixel (the most
// important member survives: eyes > weapon lines > gold thread > faces > line work
// > cloth; within a material the more extreme value survives, keeping highlights and
// definition). Which rows merge is chosen by dynamic programming: merges go where
// neighbouring rows are most alike (a flat tabard, not the eyes), with a mild pull
// toward uniform spacing so proportions hold. Then the same for columns.
// ---------------------------------------------------------------------------------

function importance(slot, L, meanL) {
  if (!slot) return 0;
  return (PRIORITY[slot] ?? 1) + 0.12 * (Math.abs(L - meanL) / 20);
}

function dissimilar(sa, La, sb, Lb) {
  if (!sa !== !sb) return 1;
  if (!sa) return 0;
  if (sa !== sb) return 0.7 * (PRIORITY[sa] ?? 1);
  return Math.min(1, Math.abs(La - Lb) / 35);
}

/** Merge `g` lines starting at `i` along an axis; returns member choice per cross position. */
function mergeLine(img, axis, i, g) {
  const { w, h } = img;
  const cross = axis === 'y' ? w : h;
  const pick = new Int32Array(cross);
  let cost = 0;
  for (let t = 0; t < cross; t++) {
    const idx = (k) => (axis === 'y' ? (i + k) * w + t : t * w + (i + k));
    let opaque = 0,
      meanL = 0;
    for (let k = 0; k < g; k++)
      if (img.slot[idx(k)]) {
        opaque++;
        meanL += img.L[idx(k)];
      }
    meanL = opaque ? meanL / opaque : 0;
    let best = -1,
      bv = -1;
    if (opaque * 2 >= g) {
      for (let k = 0; k < g; k++) {
        const p = idx(k);
        const v = importance(img.slot[p], img.L[p], meanL);
        if (v > bv) {
          bv = v;
          best = k;
        }
      }
    } else {
      // mostly transparent: keep a weapon / eye pixel if present, else transparent
      for (let k = 0; k < g; k++) {
        const s = img.slot[idx(k)];
        if (s && (WEAPON_SLOTS.has(s) || s === SLOT.eye)) {
          const v = importance(s, img.L[idx(k)], meanL);
          if (v > bv) {
            bv = v;
            best = k;
          }
        }
      }
    }
    pick[t] = best;
    const keep = best >= 0 ? idx(best) : -1;
    for (let k = 0; k < g; k++) {
      if (k === best) continue;
      const p = idx(k);
      const d =
        keep >= 0
          ? dissimilar(img.slot[p], img.L[p], img.slot[keep], img.L[keep])
          : img.slot[p]
            ? 1
            : 0;
      cost += d * (img.slot[p] ? (PRIORITY[img.slot[p]] ?? 1) : 1);
    }
  }
  return { pick, cost };
}

function decimateAxis(img, axis, s, { lambda = 0.35, maxGroup = 4 } = {}) {
  const N = axis === 'y' ? img.h : img.w;
  const cross = axis === 'y' ? img.w : img.h;
  const K = Math.max(1, Math.round(N * s));
  const G = Math.min(maxGroup, Math.max(2, Math.ceil(N / K) + 1));
  const costs = [];
  for (let i = 0; i < N; i++) {
    costs.push([]);
    for (let g = 1; g <= G && i + g <= N; g++)
      costs[i][g] = g === 1 ? 0 : mergeLine(img, axis, i, g).cost / Math.max(1, cross / 16);
  }
  const INF = 1e18;
  const dp = Array.from({ length: N + 1 }, () => new Float64Array(K + 1).fill(INF));
  const from = Array.from({ length: N + 1 }, () => new Int8Array(K + 1));
  dp[0][0] = 0;
  const ratio = N / K;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < K; j++) {
      if (dp[i][j] >= INF) continue;
      for (let g = 1; g <= G && i + g <= N; g++) {
        const centre = i + g / 2,
          ideal = (j + 0.5) * ratio;
        const v = dp[i][j] + costs[i][g] + lambda * ((centre - ideal) / ratio) ** 2;
        if (v < dp[i + g][j + 1]) {
          dp[i + g][j + 1] = v;
          from[i + g][j + 1] = g;
        }
      }
    }
  const groups = [];
  for (let i = N, j = K; j > 0; j--) {
    const g = from[i][j];
    i -= g;
    groups.unshift([i, g]);
  }
  const W = axis === 'y' ? img.w : K,
    H = axis === 'y' ? K : img.h;
  const out = {
    w: W,
    h: H,
    slot: new Uint8Array(W * H),
    L: new Float32Array(W * H),
    lab: new Float32Array(W * H * 3),
    dark: new Float32Array(W * H),
    src: new Int32Array(W * H).fill(-1),
  };
  groups.forEach(([i, g], j) => {
    const { pick } = mergeLine(img, axis, i, g);
    for (let t = 0; t < cross; t++) {
      if (pick[t] < 0) continue;
      const p = axis === 'y' ? (i + pick[t]) * img.w + t : t * img.w + (i + pick[t]);
      const q = axis === 'y' ? j * W + t : t * W + j;
      out.slot[q] = img.slot[p];
      out.L[q] = img.L[p];
      out.lab[q * 3] = img.lab[p * 3];
      out.lab[q * 3 + 1] = img.lab[p * 3 + 1];
      out.lab[q * 3 + 2] = img.lab[p * 3 + 2];
      out.dark[q] = img.dark[p];
      out.src[q] = img.src ? img.src[p] : p;
    }
  });
  return { img: out, groups };
}

/**
 * Priority-merge reduction (see above). Same output shape as reduce(), with a
 * one-pixel transparent margin so the regenerated outline fits.
 */
export function reduceMerge(seg, prep, s, opts = {}) {
  const { w, h } = seg;
  const base = {
    w,
    h,
    slot: prep.fill,
    L: Float32Array.from({ length: w * h }, (_, p) => seg.lab[p * 3]),
    lab: seg.lab,
    dark: Float32Array.from(prep.dark),
    src: null,
  };
  const sx = typeof s === 'number' ? s : s.x,
    sy = typeof s === 'number' ? s : s.y;
  const rows = decimateAxis(base, 'y', sy, opts);
  const cols = decimateAxis(rows.img, 'x', sx, opts);
  const r = cols.img;
  const W = r.w + 2,
    H = r.h + 2;
  const out = {
    w: W,
    h: H,
    slot: new Uint8Array(W * H),
    lab: new Float32Array(W * H * 3),
    dark: new Float32Array(W * H),
    offset: [0, 0],
    scale: s,
    rowGroups: rows.groups,
    colGroups: cols.groups,
  };
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const p = y * r.w + x,
        q = (y + 1) * W + x + 1;
      out.slot[q] = r.slot[p];
      out.lab[q * 3] = r.lab[p * 3];
      out.lab[q * 3 + 1] = r.lab[p * 3 + 1];
      out.lab[q * 3 + 2] = r.lab[p * 3 + 2];
      out.dark[q] = r.dark[p];
    }
  // map a native coordinate to the target (for eye placement)
  const mapAxis = (groups, v) => {
    for (let j = 0; j < groups.length; j++) {
      const [i, g] = groups[j];
      if (v < i + g) return j + 1;
    }
    return groups.length;
  };
  out.mapPoint = (x, y) => [mapAxis(cols.groups, x), mapAxis(rows.groups, y)];
  return out;
}

/**
 * Thin structures (at most two native pixels wide) of line-like materials — trims,
 * hems, gold thread, blades, shafts — lose area contests and come out as broken
 * blotches. Trace them instead: every pixel of a long thin run is mapped to the target
 * grid (`mapPoint`), giving a continuous one-pixel line. Returns [{ x, y, slot, lab }].
 */
export function thinLines(w, h, fill, lab, s, mapPoint, slots, { minLength = null } = {}) {
  const n = w * h;
  const out = [];
  const sm = typeof s === 'number' ? s : Math.min(s.x, s.y);
  const minLen = minLength ?? Math.max(4, Math.ceil(2.2 / sm));
  for (const slot of slots) {
    const M = new Uint8Array(n);
    let any = false;
    for (let p = 0; p < n; p++)
      if (fill[p] === slot) {
        M[p] = 1;
        any = true;
      }
    if (!any) continue;
    // chamfer distance to the outside of M
    const d = new Float32Array(n);
    for (let p = 0; p < n; p++) d[p] = M[p] ? 99 : 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!d[p]) continue;
        d[p] = Math.min(d[p], x > 0 ? d[p - 1] + 1 : 1, y > 0 ? d[p - w] + 1 : 1);
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const p = y * w + x;
        if (!d[p]) continue;
        d[p] = Math.min(d[p], x < w - 1 ? d[p + 1] + 1 : 1, y < h - 1 ? d[p + w] + 1 : 1);
      }
    // thin: no pixel of the run within 1 px is 2+ deep
    const thin = new Uint8Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!M[p]) continue;
        let deep = false;
        for (let dy = -1; dy <= 1 && !deep; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx,
              Y = y + dy;
            if (X >= 0 && Y >= 0 && X < w && Y < h && d[Y * w + X] >= 2) {
              deep = true;
              break;
            }
          }
        if (!deep) thin[p] = 1;
      }
    // long runs only (8-connected)
    const seen = new Uint8Array(n);
    for (let p0 = 0; p0 < n; p0++) {
      if (!thin[p0] || seen[p0]) continue;
      const comp = [p0];
      seen[p0] = 1;
      for (let k = 0; k < comp.length; k++) {
        const x = comp[k] % w,
          y = (comp[k] / w) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx,
              Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const q = Y * w + X;
            if (thin[q] && !seen[q]) {
              seen[q] = 1;
              comp.push(q);
            }
          }
      }
      if (comp.length < minLen) continue;
      for (const p of comp) {
        const [X, Y] = mapPoint((p % w) + 0.5, ((p / w) | 0) + 0.5);
        out.push({
          x: Math.floor(X),
          y: Math.floor(Y),
          slot,
          lab: [lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]],
        });
      }
    }
  }
  return out;
}
