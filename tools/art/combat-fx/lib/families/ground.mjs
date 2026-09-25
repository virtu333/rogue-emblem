// Ground reactions under a knocked-back unit, by terrain material: dust, sand, snow,
// ash, stone chips, leaves, water and mire splashes, lava sparks. Physical matter is
// drawn solid with the key light from the upper-left; only sparks glow.
import { TAU, lerp, clamp01, ease, solidField, ring, spark, chip, grain } from '../draw.mjs';
import { ART_RAMPS } from '../../../../../src/art/combatFx/fxPalette.js';

const R = ART_RAMPS;
const SIZE = [32, 24];
const FOOT_Y = 20;
const DURATIONS = [40, 44, 50, 56, 62, 70];

/** Lit blob: light top-left rim, shade bottom-right rim, eroded by `thin` (0..1). */
function blob(f, cx, cy, r, ramp, thin) {
  solidField(
    f,
    cx - r - 1,
    cy - r - 1,
    cx + r + 1,
    cy + r + 1,
    (px, py, x, y) => {
      const dx = px - cx;
      const dy = py - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) return false;
      if (thin > 0 && grain(x, y) < thin * (0.5 + 0.6 * (d / r))) return false;
      const lit = (-dx - dy) / (r * 1.41);
      if (d > r - 1.2 && lit < -0.2) return ramp[0];
      if (lit > 0.35 && d > r * 0.35) return ramp[2];
      return ramp[1];
    },
    ramp[1],
  );
}

function puffAnim(key, ramp, extra = null) {
  return {
    key,
    size: SIZE,
    ramp: 'ember',
    role: 'dust',
    directional: true,
    solidOnTop: true,
    anchor: [0.5, FOOT_Y / SIZE[1]],
    durations: DURATIONS,
    setup: (rng) => ({
      blobs: [
        { dx: -1, r: 3.2, sp: 7 },
        { dx: 1, r: 3.6, sp: 10 },
        { dx: 1, r: 2.4, sp: 5 },
        { dx: -1, r: 2.2, sp: 4 },
      ].map((b) => ({ ...b, ph: rng.range(0, 1), lift: rng.range(1.5, 4) })),
      bits: Array.from({ length: 5 }, () => ({
        a: -Math.PI / 2 + rng.range(-1.2, 1.2),
        v: rng.range(5, 10),
        s: rng.int(1, 2),
      })),
    }),
    draw(f, i, { t, p }) {
      const k = ease.outCubic(t);
      for (const b of p.blobs) {
        const x = 16 + b.dx * b.sp * k + (b.dx > 0 ? 1.5 : 0) * k;
        const y = FOOT_Y - 1 - b.lift * k;
        const r = b.r * (0.55 + 0.6 * k);
        blob(f, x, y, r, ramp, clamp01((t - 0.3) / 0.7));
      }
      if (extra) extra(f, i, t, p);
    },
  };
}

const dust = puffAnim('fx_dust', [R.earth[3], R.earth[4], R.earth[5]]);
const sand = puffAnim('fx_dust_sand', [R.earth[4], R.earth[5], R.ink[10]]);
const snow = puffAnim('fx_dust_snow', [R.ink[8], R.ink[10], R.ink[11]], (f, i, t, p) => {
  const k = ease.outCubic(t);
  for (const b of p.bits) {
    const x = 16 + Math.cos(b.a) * b.v * k;
    const y = FOOT_Y - 2 + Math.sin(b.a) * b.v * k + 6 * k * k;
    if (i < 5) f.s(x, y, R.steel[5]);
  }
});
const ash = puffAnim('fx_dust_ash', [R.ink[5], R.ink[6], R.ink[7]]);
const stone = puffAnim('fx_dust_stone', [R.stone[2], R.stone[3], R.stone[4]], (f, i, t, p) => {
  const k = t * 2.2;
  for (const b of p.bits) {
    const x = 16 + Math.cos(b.a) * b.v * k * 0.7;
    const y = FOOT_Y - 2 + Math.sin(b.a) * b.v * k * 0.7 + 5 * k * k;
    if (y < FOOT_Y + 2 && i < 5) chip(f, x, y, b.s, [R.stone[2], R.stone[4], R.stone[5]], 0, true);
  }
});
const leaves = puffAnim('fx_dust_leaves', [R.earth[2], R.earth[3], R.earth[4]], (f, i, t, p) => {
  const k = ease.outQuad(t);
  p.bits.forEach((b, n) => {
    const x = 16 + Math.cos(b.a) * b.v * k + Math.sin(k * 7 + n) * 1.5;
    const y = FOOT_Y - 3 + Math.sin(b.a) * b.v * k + 7 * k * k;
    const flip = (i + n) % 2 === 0;
    f.s(x, y, R.verdigris[flip ? 4 : 3]);
    f.s(x + (flip ? 1 : 0), y + (flip ? 0 : 1), R.verdigris[2]);
  });
});

function splashAnim(key, drop) {
  return {
    key,
    size: SIZE,
    ramp: 'steel',
    role: 'dust',
    directional: true,
    solidOnTop: true,
    anchor: [0.5, FOOT_Y / SIZE[1]],
    durations: DURATIONS,
    setup: (rng) =>
      Array.from({ length: 9 }, (_, n) => ({
        vx: (n % 2 ? 1 : -1) * rng.range(1.5, 5.5) + 0.8,
        vy: -rng.range(4, 8),
        s: rng() < 0.3 ? 2 : 1,
      })),
    draw(f, i, { t, p }) {
      const k = ease.outCubic(t);
      // Surface ring.
      const rr = lerp(4, 12, k);
      for (let a = 0; a < TAU; a += 0.05) {
        if (i >= 4 && ((a * 8) | 0) % 2) continue;
        f.s(16 + Math.cos(a) * rr, FOOT_Y + Math.sin(a) * rr * 0.3, drop[i < 3 ? 2 : 1]);
      }
      // Droplets on ballistic arcs.
      const s = t * 1.5;
      for (const d of p) {
        const x = 16 + d.vx * s * 2.2;
        const y = FOOT_Y - 1 + d.vy * s * 2.2 + 9 * s * s * 1.6;
        if (y > FOOT_Y + 1) continue;
        f.s(x, y, drop[2]);
        f.s(x, y + 1, drop[1]);
        if (d.s === 2) f.s(x + 1, y, drop[2]);
      }
      if (i === 0) ring(f, 16, FOOT_Y, 3, 1.2, 1, 0.5);
    },
  };
}

const splash = splashAnim('fx_dust_splash', [R.steel[3], R.steel[4], R.steel[5]]);
const mire = splashAnim('fx_dust_mire', [R.verdigris[2], R.verdigris[3], R.verdigris[4]]);

const sparks = {
  key: 'fx_dust_sparks',
  size: SIZE,
  ramp: 'ember',
  role: 'dust',
  directional: true,
  anchor: [0.5, FOOT_Y / SIZE[1]],
  durations: DURATIONS,
  setup: (rng) =>
    Array.from({ length: 8 }, () => ({
      a: -Math.PI / 2 + rng.range(-1.1, 1.1),
      d: rng.range(6, 14),
    })),
  draw(f, i, { t, p }) {
    const k = ease.outCubic(t);
    for (const s of p) {
      const x = 16 + Math.cos(s.a) * s.d * k;
      const y = FOOT_Y - 1 + Math.sin(s.a) * s.d * k + 4 * k * k;
      spark(f, x, y, s.a, lerp(3, 1, k), 1.05 - 0.7 * k);
    }
  },
};

export const GROUND_ANIMS = [dust, sand, snow, ash, stone, leaves, splash, mire, sparks];
