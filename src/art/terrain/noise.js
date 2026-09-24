// Deterministic hashing and noise. Everything is keyed on world-space integer
// art-pixel coordinates plus a seed, so any region can be repainted in
// isolation and match its neighbours exactly (no seams, no per-cell
// repetition). Nothing here touches Math.random.

export function hash2(x, y, seed = 0) {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Uniform float in [0, 1) for an integer lattice point. */
export function rand2(x, y, seed = 0) {
  return hash2(x, y, seed) / 4294967296;
}

/** Seeded PRNG (used by tools/tests to seed the map generator, never by painting). */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0, 1) with the given period in art pixels. */
export function valueNoise(x, y, period, seed = 0) {
  const fx = x / period,
    fy = y / period;
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy);
  let tx = fx - x0,
    ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = rand2(x0, y0, seed),
    b = rand2(x0 + 1, y0, seed),
    c = rand2(x0, y0 + 1, seed),
    d = rand2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal noise in [0, 1) (default two octaves). */
export function fbm(x, y, period, seed = 0, octaves = 2) {
  let sum = 0,
    amp = 1,
    norm = 0,
    p = period;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, p, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    p /= 2;
  }
  return sum / norm;
}

/**
 * Jittered-grid feature points (a cheap blue-noise stand-in). Returns the
 * points that fall inside the pixel rectangle [x0,x1)x[y0,y1), in lattice
 * order (row-major), which is the same relative order for any sub-rectangle.
 */
export function jitteredPoints(x0, y0, x1, y1, spacing, seed, jitter = 0.8) {
  const pts = [];
  const gx0 = Math.floor(x0 / spacing) - 1,
    gy0 = Math.floor(y0 / spacing) - 1;
  const gx1 = Math.floor(x1 / spacing) + 1,
    gy1 = Math.floor(y1 / spacing) + 1;
  for (let gy = gy0; gy <= gy1; gy++)
    for (let gx = gx0; gx <= gx1; gx++) {
      const jx = (rand2(gx, gy, seed) - 0.5) * jitter + 0.5;
      const jy = (rand2(gx, gy, seed + 7) - 0.5) * jitter + 0.5;
      const x = Math.floor((gx + jx) * spacing),
        y = Math.floor((gy + jy) * spacing);
      if (x >= x0 && x < x1 && y >= y0 && y < y1)
        pts.push({ x, y, r: rand2(gx, gy, seed + 13), gx, gy });
    }
  return pts;
}

/**
 * Worley / Voronoi: distance to the nearest and second-nearest feature
 * point on a jittered lattice. Used for lava crust plates, ice cracks and
 * rock facets. Returns a shared scratch object (no allocation per call):
 * read its fields before the next call.
 */
const WORLEY = { d1: 0, d2: 0, id: 0 };
export function worley(x, y, spacing, seed) {
  const gx = Math.floor(x / spacing),
    gy = Math.floor(y / spacing);
  let d1 = 1e9,
    d2 = 1e9,
    id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i,
        cy = gy + j;
      const px = (cx + 0.15 + rand2(cx, cy, seed) * 0.7) * spacing;
      const py = (cy + 0.15 + rand2(cx, cy, seed + 3) * 0.7) * spacing;
      const dx = px - x,
        dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(cx, cy, seed + 5);
      } else if (d < d2) d2 = d;
    }
  WORLEY.d1 = d1;
  WORLEY.d2 = d2;
  WORLEY.id = id;
  return WORLEY;
}

/**
 * Memoised value noise for one map. Lattice values are pure functions of the
 * lattice coordinate and seed, so caching them changes nothing but speed:
 * `vn` / `fbm` return exactly what `valueNoise` / `fbm` return.
 */
export function createNoiseCache(maxDim) {
  const lattices = new Map();
  const PAD = 4;
  function lattice(period, seed) {
    let bySeed = lattices.get(period);
    if (!bySeed) lattices.set(period, (bySeed = new Map()));
    let L = bySeed.get(seed);
    if (!L) {
      // Covers the map (twice over for long periods, which stretched noise
      // uses) plus a margin; anything outside falls back to hashing, with
      // the same float32 rounding so both paths agree bit for bit.
      const n = Math.ceil((maxDim * (period >= 8 ? 2 : 1.05)) / period) + 2 * PAD + 2;
      const v = new Float32Array(n * n);
      for (let gy = 0; gy < n; gy++)
        for (let gx = 0; gx < n; gx++) v[gy * n + gx] = rand2(gx - PAD, gy - PAD, seed);
      L = { n, v };
      bySeed.set(seed, L);
    }
    return L;
  }
  function vn(x, y, period, seed = 0) {
    const L = lattice(period, seed);
    const fx = x / period,
      fy = y / period;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const ix = x0 + PAD,
      iy = y0 + PAD,
      n = L.n;
    let a, b, c, d;
    if (ix < 0 || iy < 0 || ix + 1 >= n || iy + 1 >= n) {
      a = Math.fround(rand2(x0, y0, seed));
      b = Math.fround(rand2(x0 + 1, y0, seed));
      c = Math.fround(rand2(x0, y0 + 1, seed));
      d = Math.fround(rand2(x0 + 1, y0 + 1, seed));
    } else {
      const k = iy * n + ix,
        v = L.v;
      a = v[k];
      b = v[k + 1];
      c = v[k + n];
      d = v[k + n + 1];
    }
    let tx = fx - x0,
      ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  function fbmCached(x, y, period, seed = 0, octaves = 2) {
    if (octaves === 2)
      return (vn(x, y, period, seed) + vn(x, y, period / 2, seed + 101) * 0.5) / 1.5;
    let sum = 0,
      amp = 1,
      norm = 0,
      p = period;
    for (let o = 0; o < octaves; o++) {
      sum += vn(x, y, p, seed + o * 101) * amp;
      norm += amp;
      amp *= 0.5;
      p /= 2;
    }
    return sum / norm;
  }
  return { vn, fbm: fbmCached };
}

/** Stable 32-bit seed from any string or number (for callers' convenience). */
export function seedFrom(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value | 0;
  const s = String(value ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}
