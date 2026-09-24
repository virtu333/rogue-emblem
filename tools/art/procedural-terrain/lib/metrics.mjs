// Readability metrics at phone scale (34 CSS px per cell), computed the same
// way for every renderer so "before", "after" and the weathered atlases are
// directly comparable. All values use CIE L* (0..100) from sRGB.
//
//   groundL      mean L* of the terrain in the crop
//   groundStd    global L* spread of the terrain (value range in use)
//   micro        ground micro-contrast: RMS of L* minus its 5x5 box mean
//                (local texture energy the eye must filter out)
//   edge         mean |dL*| across unit silhouettes: sprite pixel vs the
//                terrain pixel just outside it (4-neighbours)
//   edgeVisible  share of those silhouette pairs with |dL*| >= 15
//   pop          edge / micro: silhouette signal over ground noise
//   local        mean |L*(sprite) - L*(ground in the unit's 3x3 cells)|

const lin = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const LIN = Float32Array.from({ length: 256 }, (_, v) => lin(v));
export function lstar(r, g, b) {
  const Y = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
  return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
}

export function lumaImage({ data, w, h }) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lstar(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return L;
}

function boxMean(L, w, h, rad) {
  // separable box blur with edge clamping
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += L[y * w + Math.max(0, Math.min(w - 1, x + k))];
      tmp[y * w + x] = s / (2 * rad + 1);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x];
      out[y * w + x] = s / (2 * rad + 1);
    }
  return out;
}

/**
 * @param ground   phone-scale terrain only (no overlays, rings or units)
 * @param composed the same view with rings / sprites / bars drawn
 * @param mask     sprite alpha per pixel (from drawUnits)
 * @param units    staged units, origin = crop origin [c0, r0], cell = px per cell
 */
export function readabilityMetrics(ground, composed, mask, units, origin, cell = 34) {
  const { w, h } = ground;
  const Lg = lumaImage(ground),
    Lc = lumaImage(composed);
  let sum = 0,
    sum2 = 0;
  for (let i = 0; i < w * h; i++) {
    sum += Lg[i];
    sum2 += Lg[i] * Lg[i];
  }
  const groundL = sum / (w * h);
  const groundStd = Math.sqrt(Math.max(0, sum2 / (w * h) - groundL * groundL));
  const blur = boxMean(Lg, w, h, 2);
  let e2 = 0;
  for (let i = 0; i < w * h; i++) e2 += (Lg[i] - blur[i]) ** 2;
  const micro = Math.sqrt(e2 / (w * h));

  let edgeSum = 0,
    edgeN = 0,
    edgeVis = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] < 0.5) continue;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (mask[j] >= 0.1) continue;
        const d = Math.abs(Lc[i] - Lg[j]);
        edgeSum += d;
        edgeN++;
        if (d >= 15) edgeVis++;
      }
    }
  const edge = edgeN ? edgeSum / edgeN : 0;

  let localSum = 0,
    localN = 0;
  const [c0, r0] = origin;
  for (const u of units) {
    const x0 = Math.max(0, (u.col - c0 - 1) * cell),
      x1 = Math.min(w, (u.col - c0 + 2) * cell);
    const y0 = Math.max(0, (u.row - r0 - 1) * cell),
      y1 = Math.min(h, (u.row - r0 + 2) * cell);
    let su = 0,
      nu = 0,
      sg = 0,
      ng = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        if (mask[i] >= 0.5) {
          su += Lc[i];
          nu++;
        } else if (mask[i] < 0.1) {
          sg += Lg[i];
          ng++;
        }
      }
    if (nu && ng) {
      localSum += Math.abs(su / nu - sg / ng);
      localN++;
    }
  }
  const round = (v) => Math.round(v * 10) / 10;
  return {
    groundL: round(groundL),
    groundStd: round(groundStd),
    micro: round(micro),
    edge: round(edge),
    edgeVisible: Math.round((edgeN ? edgeVis / edgeN : 0) * 1000) / 10,
    pop: Math.round((micro ? edge / micro : 0) * 100) / 100,
    local: round(localN ? localSum / localN : 0),
  };
}
