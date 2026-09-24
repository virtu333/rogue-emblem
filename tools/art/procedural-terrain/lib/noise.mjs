// Deterministic hashing / noise. Everything is keyed on world-space integer
// coordinates plus a seed, so any cell can be repainted in isolation and will
// match its neighbours exactly (no seams, no per-cell repetition).

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

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1) with the given period in pixels. */
export function valueNoise(x, y, period, seed = 0) {
  const fx = x / period,
    fy = y / period;
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy);
  const tx = smooth(fx - x0),
    ty = smooth(fy - y0);
  const a = rand2(x0, y0, seed),
    b = rand2(x0 + 1, y0, seed),
    c = rand2(x0, y0 + 1, seed),
    d = rand2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Two-octave fractal noise in [0, 1). */
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
 * points whose lattice cell overlaps the pixel rectangle [x0,x1)x[y0,y1).
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
 * Worley / Voronoi: distance to nearest and second-nearest feature point on a
 * jittered lattice. Used for lava crust plates and ice cracks.
 */
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
      const d = Math.hypot(px - x, py - y);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(cx, cy, seed + 5);
      } else if (d < d2) d2 = d;
    }
  return { d1, d2, id };
}
