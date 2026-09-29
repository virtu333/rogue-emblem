// Small effects for "The Night Before" that give the people weight (CRAFT.md, Grounding): the ash
// kicked up when a hand pushes off the rock, the dust a boot puts up when the weight comes down.
//
// Drawn on the finished frame, after the figures, in world space (so the camera's move carries
// them), depth-tested against the figures (a grain behind a boot is hidden by it), on twos: a puff
// is a handful of round clouds that pop open in a few drawings, rise a little and settle, shaded
// like the ground round them (a lit side toward the fire, a dark underside) and dissolved by the
// page's ordered dither as they thin, with grit thrown out on arcs that land and lie there.
// Colours are ash greys and warm ash (the palette snap keeps them a grain, not a smudge).

import { project } from './engine/world.js';
import { bayer, clamp, hash, smooth } from './engine/raster.js';

const onTwos = (t) => Math.floor(t * 12 + 1e-6) / 12;

// ash: a dark underside, a mid grey with a little brown, a warm top where the fire reaches it
const SHADE = [92, 80, 86];
const MID = [168, 150, 142];
const HIGH = [226, 188, 146];
const GRIT_PALE = [208, 186, 160];
const GRIT_DARK = [70, 58, 60];

/** Write one pixel if nothing nearer covers it. */
function px(world, f, x, y, z, c) {
  const { W, H } = world;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * W + x;
  if (z > world.zbuf[i] + 0.03) return;
  const o = i * 4;
  f[o] = c[0];
  f[o + 1] = c[1];
  f[o + 2] = c[2];
  f[o + 3] = 255;
}

/**
 * A puff of ash and grit at a world point.
 * p: { X, Y, Z, t0 (s), life (s), n (clouds), grit (flecks), size (m, a cloud's radius), spread (m/s
 *      outward), up (m/s), ring (clouds leave in a ring along the ground: a landing), drift [dx, dz]
 *      (m/s), seed, warm (0..1: how much fire lights it), fire: the fire's world point }
 * `world` is the CampWorld (its depth buffer and size), `cam` the frame's camera.
 */
export function puff(world, f, cam, t, p) {
  const { W, H } = world;
  const tt = onTwos(t);
  const age = tt - p.t0;
  if (age < 0 || age > p.life) return;
  const u = age / p.life;
  const F = p.fire || { x: 0, y: 0.5, z: 0 };
  const fp = project(cam, F.x, F.y, F.z, W, H);
  const fade = smooth(0.42, 1.0, u); // how much of the puff has dissolved
  // ---- the clouds
  for (let k = 0; k < p.n; k++) {
    const r = (j) => hash(k, j, p.seed);
    const th = p.ring ? (k / p.n) * Math.PI * 2 + (r(1) - 0.5) * 0.7 : r(1) * Math.PI * 2;
    const hv = p.spread * (0.55 + 0.6 * r(2));
    const dist = (hv * (1 - Math.exp(-age * 4.5))) / 4.5;
    const X = p.X + Math.cos(th) * dist + (p.drift?.[0] ?? 0) * age;
    const Z = p.Z + Math.sin(th) * dist * (p.ring ? 0.85 : 0.7) + (p.drift?.[1] ?? 0) * age;
    // rises fast, hangs, settles back a little as it thins
    const rise = p.up * (0.45 + 0.7 * r(3)) * ((1 - Math.exp(-age * 3.6)) / 3.6);
    const Y = p.Y + Math.max(0, rise - 0.5 * Math.max(0, age - 0.2) ** 2 * (0.3 + r(6)) * 2);
    // pops open in a few drawings, then swells slowly and thins at the end
    const pop = 1 - (1 - Math.min(1, age / 0.14)) ** 2;
    const rad = p.size * (0.5 + 0.6 * r(4)) * (0.25 + 0.75 * pop) * (1 + 0.35 * u) * (1 - 0.35 * fade);
    const q = project(cam, X, Y, Z, W, H);
    if (q.depth < 0.3) continue;
    const rp = Math.max(1.3, rad * q.scale);
    const cx = q.sx;
    const cy = q.sy;
    // the light comes from the fire's side of the screen
    let lx = fp.sx - cx;
    let ly = fp.sy - cy - 30;
    const ll = Math.hypot(lx, ly) || 1;
    lx /= ll;
    ly /= ll;
    const R = Math.ceil(rp + 1);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        // a cloud is lumpy: its edge wanders with the angle
        const ang = Math.atan2(dy, dx);
        const lump = 0.82 + 0.3 * hash(Math.floor((ang + Math.PI) * 1.6), k, p.seed + 5);
        const d = Math.hypot(dx, dy) / (rp * lump);
        if (d > 1) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        // the puff dissolves on the page's dither, thin edges first
        if (bayer(x, y) < fade * 0.95 + (d > 0.7 ? 0.12 * u : 0)) continue;
        const lit = clamp(0.5 + 0.55 * ((dx * lx + dy * ly) / (rp + 0.5)) - 0.25 * d);
        const w = (p.warm ?? 0.6) * lit;
        let c;
        if (lit < 0.32) c = SHADE;
        else if (w > 0.5) c = HIGH;
        else c = MID;
        // the lowest rim of a cloud is its underside: dark
        if (dy > rp * 0.45) c = SHADE;
        px(world, f, x, y, q.depth - 0.02, c);
      }
  }
  // ---- grit: flecks on arcs, landing and lying there
  const g = 9.8 * 0.6;
  for (let k = 0; k < (p.grit ?? 0); k++) {
    const r = (j) => hash(k, j, p.seed + 100);
    const th = p.ring ? (k / p.grit) * Math.PI * 2 + (r(1) - 0.5) : r(1) * Math.PI * 2;
    const sp = p.spread * (0.9 + 1.6 * r(2));
    const v0 = p.up * (1.8 + 2.4 * r(3));
    // flight time back to the ground
    const tf = (2 * v0) / g;
    const a = Math.min(age, tf);
    const X = p.X + Math.cos(th) * sp * a * 0.55 + (p.drift?.[0] ?? 0) * a;
    const Z = p.Z + Math.sin(th) * sp * a * 0.45;
    const Y = p.Y + Math.max(0, v0 * a - 0.5 * g * a * a);
    // it lies there and dissolves after landing (or with the rest at the end)
    const landed = age > tf;
    const out = landed ? smooth(tf, p.life, age) : 0;
    const q = project(cam, X, Y, Z, W, H);
    if (q.depth < 0.3) continue;
    const x = Math.round(q.sx - 0.5);
    const y = Math.round(q.sy - 0.5);
    if (bayer(x, y) < Math.max(fade * 0.8, out)) continue;
    const c = r(4) > 0.45 ? GRIT_PALE : GRIT_DARK;
    const big = q.scale > 75 && r(5) > 0.5 ? 1 : 0;
    for (let dy = 0; dy <= big; dy++)
      for (let dx = 0; dx <= big; dx++) px(world, f, x + dx, y + dy, q.depth - 0.02, c);
  }
}
