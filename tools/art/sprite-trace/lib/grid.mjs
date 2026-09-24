// Grid recovery for "fake pixel art": images drawn as blocks of roughly p×p screen
// pixels (p not necessarily an integer, and drifting slightly across the image), with
// blended block edges. Recovers the native pixel art:
//
//   1. edgeProfile   — per-boundary edge energy along one axis
//   2. estimatePitch — comb search over pitch and phase (fundamental wins: a comb at
//                      p/2 pays for its interior teeth, one at 2p finds half the edges)
//   3. trackCuts     — dynamic programming picks the actual cut positions near the
//                      estimated rhythm (absorbs drift and 6/7-px alternation)
//   4. sampleCells   — each logical pixel = medoid of its cell interior (blended edges
//                      ignored), alpha by majority
//
// Pure functions over Raster; deterministic.
import { Raster } from './raster.mjs';
import { pixelDiff } from './color.mjs';

/**
 * Edge energy at each boundary along an axis inside a box. For axis 'x', entry k
 * (box.x+1 .. box.x+width-1) is the energy between column k-1 and k.
 * Returns { lo, E } where E[k - lo] is the energy at boundary k.
 */
export function edgeProfile(r, axis = 'x', box = null, { cap = 96, floor = 10 } = {}) {
  const b = box || { x: 0, y: 0, width: r.w, height: r.h };
  const along = axis === 'x' ? b.width : b.height;
  const across = axis === 'x' ? b.height : b.width;
  const lo = axis === 'x' ? b.x : b.y;
  const E = new Float64Array(along + 1);
  for (let k = 1; k < along; k++) {
    let sum = 0;
    for (let t = 0; t < across; t++) {
      const x1 = axis === 'x' ? b.x + k : b.x + t;
      const y1 = axis === 'x' ? b.y + t : b.y + k;
      const x0 = axis === 'x' ? x1 - 1 : x1;
      const y0 = axis === 'x' ? y1 : y1 - 1;
      const v = pixelDiff(r.d, r.idx(x0, y0), r.idx(x1, y1));
      if (v > floor) sum += Math.min(cap, v);
    }
    E[k] = sum;
  }
  return { lo, E };
}

/**
 * Normalised autocorrelation of a mean-removed profile, lags 0..maxLag.
 */
export function autocorr(E, maxLag = 28) {
  const n = E.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += E[i];
  mean /= n || 1;
  let z = 0;
  for (let i = 0; i < n; i++) z += (E[i] - mean) ** 2;
  const out = new Float64Array(maxLag + 1);
  for (let l = 0; l <= maxLag; l++) {
    let s = 0;
    for (let i = 0; i + l < n; i++) s += (E[i] - mean) * (E[i + l] - mean);
    out[l] = z ? s / z : 0;
  }
  return out;
}

function peakNear(ac, center, radius) {
  // highest local maximum within [center-radius, center+radius], parabolic refined
  let best = null;
  for (let l = Math.max(2, Math.floor(center - radius)); l <= Math.min(ac.length - 2, Math.ceil(center + radius)); l++) {
    if (ac[l] < ac[l - 1] || ac[l] < ac[l + 1]) continue;
    if (best && ac[l] <= ac[best]) continue;
    best = l;
  }
  if (best == null) return null;
  const a = ac[best - 1],
    b = ac[best],
    c = ac[best + 1];
  const den = a - 2 * b + c;
  const off = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return { lag: best + off, value: b };
}

/**
 * Estimate the block pitch from an autocorrelation (one axis, or the mean of both
 * axes: fake pixels are square). The fundamental is the first prominent peak after
 * the dip that edge blending leaves at short lags; harmonics refine it.
 * Returns { pitch, confidence } — confidence = peak - dip (~0 for illustrations).
 */
export function pitchFromAutocorr(ac, { min = 2, max = 26 } = {}) {
  let dip = Infinity,
    dipLag = 1;
  for (let l = 1; l < ac.length - 1; l++) {
    if (ac[l] < dip) {
      dip = ac[l];
      dipLag = l;
    }
    // first prominent local maximum after a dip
    if (l >= min && l <= max && ac[l] >= ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] - dip > 0.12) {
      const p1 = peakNear(ac, l, 0.5) || { lag: l, value: ac[l] };
      let num = p1.lag * p1.value,
        den = p1.value;
      for (let k = 2; k <= 3; k++) {
        const pk = peakNear(ac, p1.lag * k, Math.max(1, p1.lag * 0.2));
        if (pk && pk.value > 0) {
          num += (pk.lag / k) * pk.value * k;
          den += pk.value * k;
        }
      }
      return { pitch: num / den, confidence: Math.max(0, Math.min(1, p1.value - dip)), dipLag };
    }
  }
  return { pitch: 0, confidence: 0, dipLag };
}

/** Back-compat single-axis estimate. */
export function estimatePitch(E, opts = {}) {
  return pitchFromAutocorr(autocorr(E, Math.min(40, Math.floor(E.length / 3))), opts);
}

/**
 * Track cut positions with DP: maximise edge energy at cuts minus a penalty on
 * deviation from the pitch. Returns boundary indices (profile coordinates, i.e.
 * relative to `lo`), strictly increasing, spanning the profile.
 */
export function trackCuts(E, pitch, { slack = null, lambda = null } = {}) {
  const n = E.length; // boundaries 0..n-1
  const d = slack ?? Math.max(1, Math.round(pitch * 0.3));
  const pmin = Math.max(1, Math.floor(pitch - d)),
    pmax = Math.ceil(pitch + d);
  let edgeMean = 0,
    cnt = 0;
  for (let i = 0; i < n; i++)
    if (E[i] > 0) {
      edgeMean += E[i];
      cnt++;
    }
  edgeMean = cnt ? edgeMean / cnt : 1;
  const lam = lambda ?? 0.35 * edgeMean;
  const dp = new Float64Array(n).fill(-Infinity);
  const from = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    if (c <= pmax) dp[c] = E[c]; // free start within the first period
    for (let step = pmin; step <= pmax; step++) {
      const c0 = c - step;
      if (c0 < 0) break;
      if (dp[c0] === -Infinity) continue;
      const v = dp[c0] + E[c] - lam * (step - pitch) ** 2;
      if (v > dp[c]) {
        dp[c] = v;
        from[c] = c0;
      }
    }
  }
  // free end within the last period
  let end = n - 1;
  for (let c = Math.max(0, n - 1 - pmax); c < n; c++) if (dp[c] > dp[end]) end = c;
  const cuts = [];
  for (let c = end; c >= 0; c = from[c]) cuts.push(c);
  cuts.reverse();
  // extend to cover the whole span with the nominal pitch
  while (cuts[0] > 0) cuts.unshift(Math.max(0, Math.round(cuts[0] - pitch)));
  while (cuts[cuts.length - 1] < n - 1)
    cuts.push(Math.min(n - 1, Math.round(cuts[cuts.length - 1] + pitch)));
  // dedupe (clamping can produce zero-width cells)
  return cuts.filter((c, i) => i === 0 || c > cuts[i - 1]);
}

function medoid(px) {
  // px: array of [r,g,b]; returns the member minimising summed L1 distance.
  if (px.length <= 2) return px[0];
  let best = px[0],
    bd = Infinity;
  for (const a of px) {
    let s = 0;
    for (const b of px) s += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    if (s < bd) {
      bd = s;
      best = a;
    }
  }
  return best;
}

/**
 * Sample each grid cell (between consecutive cuts) to one logical pixel.
 * Returns { native: Raster, purity } — purity is the mean L1 distance of interior
 * pixels to their cell's medoid (0 = perfectly flat blocks).
 */
export function sampleCells(r, xs, ys, { alphaMin = 128, coverage = 0.5 } = {}) {
  const W = xs.length - 1,
    H = ys.length - 1;
  const out = new Raster(W, H);
  let dev = 0,
    devN = 0;
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const x0 = xs[cx],
        x1 = xs[cx + 1],
        y0 = ys[cy],
        y1 = ys[cy + 1];
      const mx = x1 - x0 >= 5 ? 1 : 0,
        my = y1 - y0 >= 5 ? 1 : 0;
      const opaque = [];
      let total = 0;
      for (let y = y0 + my; y < y1 - my; y++)
        for (let x = x0 + mx; x < x1 - mx; x++) {
          if (!r.inside(x, y)) continue;
          total++;
          const i = r.idx(x, y);
          if (r.d[i + 3] >= alphaMin) opaque.push([r.d[i], r.d[i + 1], r.d[i + 2]]);
        }
      if (!total || opaque.length / total < coverage) continue;
      const m = medoid(opaque);
      out.set(cx, cy, [m[0], m[1], m[2], 255]);
      for (const p of opaque) {
        dev += Math.abs(p[0] - m[0]) + Math.abs(p[1] - m[1]) + Math.abs(p[2] - m[2]);
        devN++;
      }
    }
  return { native: out, purity: devN ? dev / devN / 3 : 0 };
}

/**
 * Full grid recovery of one figure. `box` should be the figure's alpha bounds.
 * Returns { native, pitch: {x, y}, confidence, cuts: {xs, ys}, purity, mode }.
 * When confidence is low the image is treated as an illustration and area-
 * downscaled to the nominal pitch instead (mode 'downscale').
 */
export function recoverGrid(r, box = null, opts = {}) {
  const b = box || r.alphaBounds(10) || { x: 0, y: 0, width: r.w, height: r.h };
  const pad = 2;
  const bb = {
    x: Math.max(0, b.x - pad),
    y: Math.max(0, b.y - pad),
    width: Math.min(r.w - Math.max(0, b.x - pad), b.width + pad * 2),
    height: Math.min(r.h - Math.max(0, b.y - pad), b.height + pad * 2),
  };
  const px = edgeProfile(r, 'x', bb);
  const py = edgeProfile(r, 'y', bb);
  const lags = Math.min(40, Math.floor(Math.min(px.E.length, py.E.length) / 3));
  const acx = autocorr(px.E, lags),
    acy = autocorr(py.E, lags);
  // Fake pixels are usually square, but review sheets were sometimes resized
  // anisotropically after generation (e.g. myrmidon: 6.8 x 5.4 screen px), so each
  // axis keeps its own pitch unless the two agree within 8% (then they are pooled).
  const ex = pitchFromAutocorr(acx, opts),
    ey = pitchFromAutocorr(acy, opts);
  let pX = ex.pitch,
    pY = ey.pitch;
  if (!pX || ex.confidence < 0.15) pX = pY;
  if (!pY || ey.confidence < 0.15) pY = pX;
  if (pX && pY && Math.abs(pX - pY) / Math.max(pX, pY) < 0.08) {
    const joint = pitchFromAutocorr(
      acx.map((v, i) => (v + acy[i]) / 2),
      opts,
    );
    if (joint.pitch) pX = pY = joint.pitch;
  }
  const confidence = Math.max(ex.confidence, ey.confidence);
  if (opts.forcePitch) pX = pY = opts.forcePitch;
  if (confidence < (opts.minConfidence ?? 0.25) && !opts.forcePitch) {
    const p = opts.fallbackPitch || Math.max(2, (pX + pY) / 2 || 4);
    const W = Math.max(1, Math.round(bb.width / p)),
      H = Math.max(1, Math.round(bb.height / p));
    const native = r.crop(bb.x, bb.y, bb.width, bb.height).resizeArea(W, H);
    for (let i = 3; i < native.d.length; i += 4) native.d[i] = native.d[i] >= 128 ? 255 : 0;
    return { native, pitch: { x: p, y: p }, confidence, cuts: null, purity: null, mode: 'downscale' };
  }
  const cx = trackCuts(px.E, pX, opts).map((c) => c + px.lo);
  const cy = trackCuts(py.E, pY, opts).map((c) => c + py.lo);
  const { native, purity } = sampleCells(r, cx, cy, opts);
  return {
    native,
    pitch: { x: pX, y: pY },
    confidence,
    cuts: { xs: cx, ys: cy },
    purity,
    mode: 'grid',
  };
}

/** Render recovered native pixels back onto the source grid (for error checks). */
export function reproject(native, cuts, w, h) {
  const out = new Raster(w, h);
  const { xs, ys } = cuts;
  for (let cy = 0; cy < ys.length - 1; cy++)
    for (let cx = 0; cx < xs.length - 1; cx++) {
      const c = native.get(cx, cy);
      if (!c[3]) continue;
      out.fillRect(xs[cx], ys[cy], xs[cx + 1] - xs[cx], ys[cy + 1] - ys[cy], c);
    }
  return out;
}
