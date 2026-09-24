// Deterministic weighted k-means in CIE Lab over a raster's opaque colours.
// Initialisation is farthest-point (maximin) from the most frequent colour, so the
// same image always yields the same clusters in the same order. Pure.
import { rgbToLab, labToRgb, dLab2, lch } from './color.mjs';

/** Unique opaque colours with counts and pixel positions. */
export function uniqueColors(r, alphaMin = 128) {
  const map = new Map();
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const i = r.idx(x, y);
      if (r.d[i + 3] < alphaMin) continue;
      const key = (r.d[i] << 16) | (r.d[i + 1] << 8) | r.d[i + 2];
      let e = map.get(key);
      if (!e) {
        e = { rgb: [r.d[i], r.d[i + 1], r.d[i + 2]], count: 0, pixels: [] };
        e.lab = rgbToLab(e.rgb);
        map.set(key, e);
      }
      e.count++;
      e.pixels.push(y * r.w + x);
    }
  // stable order: by count desc, then key
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
    .map(([key, e]) => ({ key, ...e }));
}

export function kmeans(colors, K, { iterations = 24 } = {}) {
  if (!colors.length) return { centers: [], assign: [] };
  K = Math.min(K, colors.length);
  const centers = [colors[0].lab.slice()];
  const dmin = colors.map((c) => dLab2(c.lab, centers[0]));
  while (centers.length < K) {
    // farthest point, weighted by sqrt(count) so rare colours still seed
    let best = -1,
      bv = -1;
    for (let i = 0; i < colors.length; i++) {
      const v = dmin[i] * Math.sqrt(colors[i].count);
      if (v > bv) {
        bv = v;
        best = i;
      }
    }
    if (bv <= 0) break;
    centers.push(colors[best].lab.slice());
    for (let i = 0; i < colors.length; i++)
      dmin[i] = Math.min(dmin[i], dLab2(colors[i].lab, centers[centers.length - 1]));
  }
  const assign = new Int32Array(colors.length);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < colors.length; i++) {
      let bk = 0,
        bd = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const d = dLab2(colors[i].lab, centers[k]);
        if (d < bd) {
          bd = d;
          bk = k;
        }
      }
      if (assign[i] !== bk || it === 0) moved++;
      assign[i] = bk;
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < colors.length; i++) {
      const a = acc[assign[i]],
        w = colors[i].count;
      a[0] += colors[i].lab[0] * w;
      a[1] += colors[i].lab[1] * w;
      a[2] += colors[i].lab[2] * w;
      a[3] += w;
    }
    for (let k = 0; k < centers.length; k++)
      if (acc[k][3]) centers[k] = [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]];
    if (!moved) break;
  }
  return { centers, assign };
}

/**
 * Cluster a raster's colours and gather per-cluster statistics used by the
 * material labeller: Lab/LCh centre, representative RGB, pixel count, spatial
 * centroid and extent (normalised to the figure's alpha bounds), and the pixel
 * index list.
 */
export function clusterRaster(r, K = 22) {
  const colors = uniqueColors(r);
  const { centers, assign } = kmeans(colors, K);
  const box = r.alphaBounds(128) || { x: 0, y: 0, width: r.w, height: r.h };
  const clusters = centers.map((lab, k) => ({
    k,
    lab,
    lch: lch(lab),
    rgb: labToRgb(lab),
    count: 0,
    pixels: [],
  }));
  colors.forEach((c, i) => {
    const cl = clusters[assign[i]];
    cl.count += c.count;
    for (const p of c.pixels) cl.pixels.push(p);
  });
  for (const cl of clusters) {
    let sx = 0,
      sy = 0,
      y0 = Infinity,
      y1 = -Infinity,
      x0 = Infinity,
      x1 = -Infinity;
    for (const p of cl.pixels) {
      const x = p % r.w,
        y = (p / r.w) | 0;
      sx += x;
      sy += y;
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    const n = cl.pixels.length || 1;
    cl.cx = (sx / n - box.x) / box.width;
    cl.cy = (sy / n - box.y) / box.height;
    cl.extent = { x0: (x0 - box.x) / box.width, x1: (x1 - box.x) / box.width, y0: (y0 - box.y) / box.height, y1: (y1 - box.y) / box.height };
    cl.pixels.sort((a, b) => a - b);
  }
  return { clusters: clusters.filter((c) => c.count > 0), box };
}
