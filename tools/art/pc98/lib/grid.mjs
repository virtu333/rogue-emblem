// Native pixel-grid estimate for upscaled "pixel art" references (pure).
// The rebuilt portraits are ~1254px renders of a ~90-140px pixel grid; the
// period of their column/row luminance steps tells us how soft the source
// really is, which sets how much de-pixelizing blur a target size needs.

function stepEnergy(rgba, w, h, axis) {
  const len = axis === 'x' ? w - 1 : h - 1;
  const e = new Float64Array(len);
  const lum = (i) => 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  for (let y = 0; y < (axis === 'x' ? h : h - 1); y++)
    for (let x = 0; x < (axis === 'x' ? w - 1 : w); x++) {
      const i = y * w + x;
      const j = axis === 'x' ? i + 1 : i + w;
      if (rgba[i * 4 + 3] < 128 || rgba[j * 4 + 3] < 128) continue;
      e[axis === 'x' ? x : y] += Math.abs(lum(i) - lum(j));
    }
  return e;
}

function bestPeriod(e, minP, maxP) {
  let total = 0;
  for (const v of e) total += v;
  let best = { period: 0, score: 0 };
  if (total <= 0) return best;
  for (let p = minP; p <= maxP; p += 0.02) {
    let re = 0;
    let im = 0;
    for (let x = 0; x < e.length; x++) {
      const t = (2 * Math.PI * x) / p;
      re += e[x] * Math.cos(t);
      im += e[x] * Math.sin(t);
    }
    const score = Math.hypot(re, im) / total;
    if (score > best.score) best = { period: p, score };
  }
  return best;
}

/**
 * @returns {{period:number, native:number, confident:boolean}} period in
 *   source pixels (1 = already native), native = width / period
 */
export function estimateGrid(rgba, w, h) {
  if (w <= 256) return { period: 1, native: w, confident: true };
  const minP = Math.max(3, w / 220);
  const maxP = w / 60;
  const px = bestPeriod(stepEnergy(rgba, w, h, 'x'), minP, maxP);
  const py = bestPeriod(stepEnergy(rgba, w, h, 'y'), minP, maxP);
  const pick = px.score >= py.score ? px : py;
  const agree = Math.abs(px.period - py.period) / Math.max(px.period, py.period) < 0.08;
  const period = agree ? (px.period + py.period) / 2 : pick.period;
  return {
    period: Math.round(period * 100) / 100,
    native: Math.round(w / period),
    confident: agree && pick.score > 0.08,
  };
}
