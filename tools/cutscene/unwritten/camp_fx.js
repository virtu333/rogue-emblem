// Small effects for "The Night Before" that give the people weight (CRAFT.md, Grounding): the ash
// kicked up when a hand pushes off the slab, the dust a boot puts up when the weight comes down.
// Drawn on the finished frame, over the figures, one pixel at a time (nothing is blended toward a
// new colour: a grain is an ash-grey or a warm ash pixel, faded by dither, so the palette snap
// keeps it a grain and not a smudge).

import { project } from './engine/world.js';
import { hash } from './engine/raster.js';

/**
 * A puff of ash at a world point. p: { X, Y, Z, t0 (s), life (s), n (grains), seed, spread (m/s
 * sideways), up (m/s), drift: [dx, dz] (m/s), warm (0..1, lit by the fire) }.
 * Grains leave fast and slow with drag, rise, then sink a little as they fade.
 */
export function dustPuff(f, W, H, cam, t, p) {
  const age = t - p.t0;
  if (age < 0 || age > p.life) return;
  const u = age / p.life;
  const t12 = Math.floor(t * 12);
  const drag = 3.2;
  const move = (1 - Math.exp(-age * drag)) / drag;
  for (let k = 0; k < p.n; k++) {
    const a = hash(k, p.seed, 71) * Math.PI * 2;
    const sp = p.spread * (0.35 + 0.65 * hash(k, p.seed, 72));
    const vy = p.up * (0.4 + 0.9 * hash(k, p.seed, 73));
    const X = p.X + (Math.cos(a) * sp + (p.drift?.[0] ?? 0)) * move;
    const Z = p.Z + (Math.sin(a) * sp * 0.7 + (p.drift?.[1] ?? 0)) * move;
    const Y = p.Y + vy * move - 0.25 * age * age * u;
    // grains go out on a dither as they die
    if (hash(k, t12, p.seed) < u * u * 0.9) continue;
    const q = project(cam, X, Y, Z, W, H);
    if (q.depth < 0.3) continue;
    const x = Math.round(q.sx - 0.5);
    const y = Math.round(q.sy - 0.5);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const warm = p.warm ?? 0.5;
    // ash: pale grey-brown, a touch warmer where the fire lights it, darker as it thins
    const dim = 1 - 0.35 * u;
    const c = [(176 + 60 * warm) * dim, (150 + 24 * warm) * dim, (134 - 6 * warm) * dim];
    const big = q.scale > 60 && hash(k, p.seed, 74) > 0.35 ? 1 : 0;
    for (let dy = 0; dy <= big; dy++)
      for (let dx = 0; dx <= big; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= W || yy >= H) continue;
        const o = (yy * W + xx) * 4;
        f[o] = c[0];
        f[o + 1] = c[1];
        f[o + 2] = c[2];
      }
  }
}
