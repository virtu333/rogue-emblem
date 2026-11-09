// campPlate.js — the army's encampment at nightfall, for Home Base (pure Canvas2D, no Phaser).
//
// A vista like the act cards' (actVista.js), painted with the same kit (plateKit.js: the Ink
// & Ember ramps, ordered Bayer dithering, a Uint32 raster): the last ember of dusk under a
// night sky and the Hollow Sun, two far ranges and a line of pines, and the camp on its
// field: the command pavilion with its standard, rows of tents, a wagon, a spear rack, the
// watch fires. Nobody is drawn: the camp is the army. Composed for the box it is shown in
// (any plate size), so a short box is a wider camp, not a crop.
//
// Deterministic for (width, height, seed); never calls Math.random. The static plate is
// baked once (`paintCampPlate`, no DOM); per frame only a short list of palette-coloured
// rectangles moves (`rects(t)`): the flames, sparks, smoke, the pennants, stars, fireflies,
// grass. Reduced motion shows one frozen frame.

import {
  PALETTE,
  pack,
  mulberry32,
  hash2,
  makeNoise,
  bayer,
  clamp,
  smooth,
  pick,
  Raster,
  fillSky,
  fillLayer,
  hollowSun,
  profile,
} from './plateKit.js';

const INK = PALETTE.ink.map(pack);
const EMB = PALETTE.ember.map(pack);
const BLD = PALETTE.blood.map(pack);
const UNL = PALETTE.unlight.map(pack);

const HEX_OF = new Map();
for (const ramp of Object.values(PALETTE)) for (const h of ramp) HEX_OF.set(pack(h), h);

export const CAMP_MIN = 40;
export const CAMP_MAX = 360;
export const CAMP_FROZEN_TIME = 5200;

const NIGHT_SKY = [INK[0], INK[1], UNL[0], UNL[0], UNL[1], BLD[1], BLD[2], BLD[3], EMB[3]];
const NIGHT_HILL = [INK[0], INK[1], UNL[0], UNL[1], BLD[1]];
const CAMP_FIELD = [INK[0], INK[1], INK[2], EMB[0], EMB[1], EMB[2], EMB[3], EMB[4]];
/** Tent canvas by value: grey under the night, warm in firelight (dithered between). */
const CANVAS_COOL = [INK[2], INK[3], INK[4], INK[5], INK[6]];
const CANVAS_WARM = [EMB[0], EMB[1], EMB[2], EMB[3], EMB[4], EMB[5]];
/** Canvas of value `v` (0..1) with `lit` (0..1) firelight on it, at pixel (x, y). */
function canvas(v, lit, x, y) {
  const warm = lit > 0.26 + (bayer(x + 2, y + 1) - 0.5) * 0.14;
  const ramp = warm ? CANVAS_WARM : CANVAS_COOL;
  return pick(ramp, clamp(v, 0, 1) * (ramp.length - 1), x, y);
}

/**
 * Where things stand on a W x H plate. `unit` scales the camp's furniture to the ground
 * it has (1 on a 182 x 137 plate); `tents` are back to front.
 */
export function campLayout(W, H) {
  const hz = Math.round(H * 0.5);
  const groundH = H - hz;
  const unit = clamp(Math.min(groundH / 68, W / 150), 0.5, 1.6);
  const fire = { x: Math.round(W * 0.47), y: Math.round(hz + groundH * 0.6) };
  const pavilion = { x: Math.round(W * 0.7), y: Math.round(hz + groundH * 0.42) };
  // [x share of W, y share of the ground, height in units]
  const spots = [
    [0.1, 0.14, 6],
    [0.26, 0.1, 6],
    [0.4, 0.13, 6],
    [0.55, 0.09, 5],
    [0.9, 0.16, 7],
    [0.16, 0.36, 10],
    [0.34, 0.3, 9],
    [0.93, 0.5, 12],
    [0.2, 0.68, 14],
  ];
  const tents = spots.map(([sx, sy, h]) => ({
    x: Math.round(W * sx),
    y: Math.round(hz + groundH * sy),
    h: Math.max(3, Math.round(h * unit)),
  }));
  return {
    hz,
    unit,
    fire,
    pavilion,
    tents,
    sun: { x: Math.round(W * 0.8), y: Math.round(hz * 0.4) },
  };
}

/** Firelight on the ground plane at (x, y): 0 in the dark, about 1 beside a fire. */
function glowAt(fires, x, y) {
  let g = 0;
  for (const f of fires) {
    const d = Math.hypot(x - f.x, (y - f.y) * 2.3) / f.reach;
    g += f.power * Math.exp(-d * d);
  }
  return g;
}

/**
 * A ridge tent seen from its gable: the front triangle, its door, and the roof running
 * back to one side. `lit` (0..1) is the firelight on it, `side` the side the fire is on.
 */
function tent(R, { x, y, h }, lit, side) {
  const half = (j) => Math.ceil(j * 0.8);
  const back = Math.max(2, Math.round(h * 0.9)); // the ridge's run, away from the fire
  const dir = -side || 1;
  const face = 0.42 + lit * 0.4;
  // roof plane (in shadow), behind the gable
  for (let j = 0; j <= h; j++) {
    const edge = x + dir * half(j);
    const run = Math.max(0, back - Math.round(j * 0.25));
    for (let i = 1; i <= run; i++) {
      const px = edge + dir * i;
      R.set(px, y - h + j, canvas(face - 0.22 - (i / run) * 0.12, lit * 0.5, px, y - h + j));
    }
  }
  // gable: the half toward the fire is the brighter one, and its edge catches the light
  for (let j = 0; j <= h; j++) {
    const w = half(j);
    for (let dx = -w; dx <= w; dx++) {
      const toward = dx * side > 0 ? 0.1 : dx * side < 0 ? -0.12 : 0;
      const rim = dx * side === w ? 0.16 + lit * 0.2 : 0;
      R.set(x + dx, y - h + j, canvas(face + toward + rim, lit, x + dx, y - h + j));
    }
  }
  // the door: a dark slit that widens to the ground
  const door = Math.max(2, Math.round(h * 0.55));
  for (let j = 0; j < door; j++) {
    const w = h >= 8 && j < door * 0.5 ? 1 : 0;
    for (let dx = -w; dx <= w; dx++) R.set(x + dx, y - j, INK[0]);
  }
  // ridge pole
  R.set(x, y - h - 1, INK[0]);
}

/** The command pavilion: a round tent with a peaked roof, a scalloped valance and a pole. */
function pavilion(R, { x, y }, unit, lit, side) {
  const wallH = Math.max(4, Math.round(8 * unit));
  const roofH = Math.max(5, Math.round(11 * unit));
  const half = Math.max(6, Math.round(13 * unit));
  const face = 0.46 + lit * 0.4;
  const shade = (dx) => (dx * side > 0 ? 0.1 : -0.14) * Math.min(1, Math.abs(dx) / half + 0.25);
  // walls, in broad stripes
  for (let j = 0; j < wallH; j++)
    for (let dx = -half; dx <= half; dx++) {
      const stripe = Math.floor((dx + half) / Math.max(2, Math.round(3 * unit))) % 2 ? -0.12 : 0;
      R.set(x + dx, y - j, canvas(face + shade(dx) + stripe, lit, x + dx, y - j));
    }
  // the door, lit from inside
  const dw = Math.max(1, Math.round(2 * unit));
  for (let j = 0; j < wallH - 1; j++)
    for (let dx = -dw; dx <= dw; dx++)
      R.set(x + dx, y - j, Math.abs(dx) === dw || j === wallH - 2 ? EMB[2] : EMB[4]);
  // roof, bowing in to the pole
  for (let j = 0; j <= roofH; j++) {
    const t = j / roofH;
    const w = Math.round((half + 1) * (0.25 * t + 0.75 * t * t));
    for (let dx = -w; dx <= w; dx++) {
      const yy = y - wallH - roofH + j;
      R.set(x + dx, yy, canvas(face - 0.08 + shade(dx) * 1.4, lit, x + dx, yy));
    }
  }
  // valance: a crimson band with a scalloped lower edge
  for (let dx = -half - 1; dx <= half + 1; dx++) {
    R.set(x + dx, y - wallH, lit > 0.25 ? BLD[3] : BLD[2]);
    if ((dx + half + 1) % 3 !== 1) R.set(x + dx, y - wallH + 1, BLD[2]);
  }
  // the pole and its finial
  const top = y - wallH - roofH;
  const poleH = Math.max(5, Math.round(9 * unit));
  for (let j = 1; j <= poleH; j++) R.set(x, top - j, INK[0]);
  R.set(x, top - poleH - 1, EMB[4]);
  return { pole: { x, y: top - poleH } };
}

/** A supply wagon in silhouette: bed, hooped cover, two wheels, a shaft. */
function wagon(R, x, y, unit, lit) {
  const s = Math.max(1, Math.round(unit * 1.7));
  const len = 9 * s;
  const body = lit > 0.3 ? EMB[0] : INK[1];
  R.rect(x, y - 4 * s, len, 2 * s, body);
  for (let i = 0; i < len; i++) {
    const t = (i + 0.5) / len;
    const hoop = Math.round(Math.sin(t * Math.PI) * 4 * s);
    for (let j = 0; j < hoop; j++)
      R.set(
        x + i,
        y - 4 * s - 1 - j,
        canvas(0.4 + lit * 0.4 - (j === hoop - 1 ? 0 : 0.15), lit, x + i, j),
      );
  }
  for (const wx of [x + 2 * s, x + len - 2 * s]) {
    const r = Math.max(1, Math.round(1.6 * s));
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r + 0.3) R.set(wx + dx, y - r + dy, d > r - 0.9 ? INK[0] : INK[2]);
      }
  }
  for (let i = 1; i <= 4 * s; i++) R.set(x + len + i, y - 2 * s + Math.round(i * 0.4), INK[0]);
}

/** A spear rack: two posts, a rail, spears leaning on it, their heads catching light. */
function spearRack(R, x, y, unit, lit) {
  const h = Math.max(4, Math.round(7 * unit));
  const w = Math.max(5, Math.round(8 * unit));
  for (let j = 0; j < h; j++) {
    R.set(x, y - j, INK[0]);
    R.set(x + w, y - j, INK[0]);
  }
  for (let i = 0; i <= w; i++) R.set(x + i, y - h + 1, INK[0]);
  const tall = Math.max(6, Math.round(12 * unit));
  for (let k = 1; k < w; k += 2) {
    for (let j = 0; j < tall; j++) R.set(x + k + (j > tall * 0.6 ? 1 : 0), y - j, INK[1]);
    R.set(x + k + 1, y - tall, lit > 0.2 ? EMB[4] : INK[6]);
  }
}

/** A standard on a tall pole; the cloth itself is animated. */
function standardPole(R, x, y, h) {
  for (let j = 0; j < h; j++) R.set(x, y - j, INK[0]);
  R.set(x, y - h, EMB[3]);
  return { x, y: y - h + 1 };
}

/**
 * Bake the camp (no DOM). Returns the pixel buffer and `rects(timeMs)`: the moving things
 * as `[x, y, w, h, '#hex']`, to draw over the buffer each frame.
 */
export function paintCampPlate({ width, height, seed = 7 } = {}) {
  const W = clamp(Math.round(width) || CAMP_MIN, CAMP_MIN, CAMP_MAX);
  const H = clamp(Math.round(height) || CAMP_MIN, CAMP_MIN, CAMP_MAX);
  const s = (seed >>> 0) + 911;
  const R = new Raster(W, H);
  const noise = makeNoise(s * 31 + 1);
  const rng = mulberry32(s * 7919 + 3);
  const layout = campLayout(W, H);
  const { hz, unit, fire, sun } = layout;
  const groundH = H - hz;

  // --- sky: night above, the last of the dusk on the horizon ---
  const n = NIGHT_SKY.length - 1;
  const gx = W * 0.3;
  const skyLevel = (x, y) => {
    const t = clamp(y / (hz * 0.86), 0, 1.15);
    const glow = Math.exp(-(((x - gx) / (W * 0.55)) ** 2)) * t ** 2.4 * 2.6;
    const band = (noise.fbm2(x * 0.009, y * 0.07, 3) - 0.5) * 0.8;
    return n * t ** 2 * 0.86 + glow + band;
  };
  fillSky(R, NIGHT_SKY, skyLevel);
  const twinkles = [];
  const starCount = Math.round((W * hz) / 120);
  for (let i = 0; i < starCount; i++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() ** 1.4 * hz * 0.72);
    const b = rng();
    R.set(x, y, b > 0.85 ? INK[10] : b > 0.5 ? INK[8] : b > 0.25 ? UNL[3] : INK[6]);
    if (b > 0.7) twinkles.push({ x, y, ph: rng() * 6.28, sp: 0.6 + rng() * 1.4 });
  }
  // Long clouds low in the sky, lit from underneath by the dusk.
  for (let y = Math.round(hz * 0.45); y < hz - 2; y++) {
    const t = y / hz;
    for (let x = 0; x < W; x++) {
      const c = noise.fbm2(x * 0.014 + 40, y * 0.11, 4) + smooth(0.45, 0.9, t) * 0.07;
      if (c < 0.61) continue;
      const under = noise.fbm2(x * 0.014 + 40, (y + 1.5) * 0.11, 4) < 0.61;
      R.set(x, y, pick(NIGHT_SKY, clamp(skyLevel(x, y) + (under ? 1.5 : -2.2), 0.6, n), x, y));
    }
  }
  const sunR = clamp(Math.round(Math.min(W, hz * 2) * 0.05), 3, 9);
  hollowSun(R, noise, sun.x, sun.y, sunR, { corona: [EMB[3], EMB[5]], reach: sunR * 1.5 });

  // --- far ranges and the pines ---
  const farA = profile(W, (x) => hz - 5 - noise.fbm1(x * 0.012 + 3, 3) * groundH * 0.2);
  const farB = profile(W, (x) => hz - noise.fbm1(x * 0.021 + 11, 3) * groundH * 0.12);
  fillLayer(R, farA, NIGHT_HILL, { base: 1.7, haze: 0.5, hazeSpan: 14 });
  fillLayer(R, farB, NIGHT_HILL, { base: 0.9, haze: 0.4, hazeSpan: 12 });
  for (let x = 0; x < W; x++) {
    const tree = noise.n1(x * 0.55) * 5 + noise.n1(x * 0.13 + 9) * 4;
    const tip = 0.55 + 0.45 * (1 - Math.abs(((x % 5) - 2) / 2));
    const top = Math.round(farB[x] + 2 - tree * tip * clamp(unit, 0.6, 1.2));
    for (let y = top; y < hz + 3; y++) R.set(x, y, INK[1]);
  }

  // --- the field, with the fires' light pooled on it ---
  const smallFires = [
    { x: Math.round(W * 0.18), y: Math.round(hz + groundH * 0.2) },
    { x: Math.round(W * 0.62), y: Math.round(hz + groundH * 0.16) },
    { x: Math.round(W * 0.84), y: Math.round(hz + groundH * 0.3) },
  ];
  const fires = [
    { ...fire, reach: Math.max(W * 0.24, 24 * unit), power: 1 },
    ...smallFires.map((f) => ({ ...f, reach: Math.max(7, 11 * unit), power: 0.55 })),
  ];
  const field = profile(W, (x) => hz + 2 + (noise.fbm1(x * 0.03 + 5, 3) - 0.5) * 3);
  for (let x = 0; x < W; x++)
    for (let y = Math.round(field[x]); y < H; y++) {
      const depth = (y - hz) / groundH;
      const g = glowAt(fires, x, y);
      const tuft = (noise.fbm2(x * 0.09, y * 0.3, 2) - 0.5) * 0.9;
      const L = 1.3 - depth * 0.4 + Math.min(g, 1.05) * 4.4 + tuft;
      R.px[y * W + x] = pick(CAMP_FIELD, L, x, y);
    }
  // --- the camp, back to front ---
  const litAt = (x, y) => clamp(glowAt(fires, x, y) * 1.25, 0, 1);
  const sideOf = (x) => (fire.x >= x ? 1 : -1);
  const pennants = [];
  const things = [];
  for (const t of layout.tents)
    things.push({ y: t.y, draw: () => tent(R, t, litAt(t.x, t.y), sideOf(t.x)) });
  things.push({
    y: layout.pavilion.y,
    draw: () => {
      const p = layout.pavilion;
      const made = pavilion(R, p, unit, litAt(p.x - 8 * unit, p.y), sideOf(p.x));
      pennants.push({ ...made.pole, len: Math.max(4, Math.round(8 * unit)), big: true });
    },
  });
  const wag = { x: Math.round(W * 0.68), y: Math.round(hz + groundH * 0.76) };
  things.push({ y: wag.y, draw: () => wagon(R, wag.x, wag.y, unit, litAt(wag.x + 8, wag.y)) });
  const rack = { x: Math.round(fire.x + 17 * unit), y: Math.round(fire.y + 3 * unit) };
  things.push({ y: rack.y, draw: () => spearRack(R, rack.x, rack.y, unit, litAt(rack.x, rack.y)) });
  for (const [sx, sy, sh] of [
    [0.06, 0.26, 20],
    [0.5, 0.2, 15],
  ]) {
    const px = Math.round(W * sx);
    const py = Math.round(hz + groundH * sy);
    things.push({
      y: py,
      draw: () => {
        const top = standardPole(R, px, py, Math.max(7, Math.round(sh * unit)));
        pennants.push({ ...top, len: Math.max(3, Math.round(6 * unit)) });
      },
    });
  }
  things.sort((a, b) => a.y - b.y);
  for (const t of things) t.draw();

  // The fires themselves: a ring of stones and logs for the watch fire, a coal for the rest.
  const ring = Math.max(2, Math.round(3 * unit));
  for (let dx = -ring - 1; dx <= ring + 1; dx++) {
    const edge = Math.abs(dx) > ring - 1;
    R.set(fire.x + dx, fire.y + 1, edge ? INK[5] : EMB[1]);
    if (!edge) R.set(fire.x + dx, fire.y, dx % 2 ? EMB[0] : INK[1]);
    if (Math.abs(dx) === ring) R.set(fire.x + dx, fire.y, INK[6]);
  }
  for (const f of smallFires) {
    R.set(f.x, f.y, EMB[4]);
    R.set(f.x - 1, f.y, EMB[2]);
    R.set(f.x + 1, f.y, EMB[2]);
  }

  // --- foreground: a dark bank and its grass ---
  const fgY = H * 0.93;
  const fg = profile(
    W,
    (x) => fgY + (noise.fbm1(x * 0.04 + 80, 3) - 0.5) * 8 * unit - Math.abs(x - W * 0.5) * 0.03,
  );
  fillLayer(R, fg, [INK[0], INK[1], INK[2]], { base: 0.3, haze: -0.3, hazeSpan: 10 });
  const blades = [];
  for (let x = 0; x < W; x++) {
    if (hash2(x, 1, 21) < 0.42) continue;
    const h = 1 + Math.floor(hash2(x, 2, 21) * 5 * clamp(unit, 0.6, 1.2));
    const y = Math.round(fg[x]);
    for (let j = 0; j < h; j++) R.set(x, y - j, INK[j > h - 2 ? 1 : 0]);
    if (h >= 4) blades.push({ x, y: y - h });
  }

  // --- animation ---
  const flameH = Math.max(5, Math.round(12 * unit));
  const flameW = Math.max(1, Math.round(3 * unit));
  const sparks = [];
  for (let i = 0; i < 7; i++)
    sparks.push({ ph: rng(), dx: (rng() - 0.5) * 6, sp: 0.7 + rng() * 0.6 });
  const puffs = [];
  for (let i = 0; i < 6; i++) puffs.push({ ph: i / 6, dx: (rng() - 0.5) * 3 });
  const flies = [];
  for (let i = 0; i < Math.round((W * groundH) / 2600); i++)
    flies.push({
      x: rng() * W,
      y: hz + groundH * (0.55 + rng() * 0.4),
      p: rng() * 6.28,
      s: 0.5 + rng(),
    });
  const smokeTop = Math.max(hz * 0.5, fire.y - 46 * unit);

  const animate = (t, out) => {
    for (const st of twinkles) {
      const v = Math.sin(t * 0.0011 * st.sp + st.ph);
      if (v > 0.75) out.push([st.x, st.y, 1, 1, INK[11]]);
      else if (v < -0.8) out.push([st.x, st.y, 1, 1, INK[5]]);
    }
    // smoke: thin puffs that rise from the watch fire, lean with the wind and thin out
    for (const p of puffs) {
      const life = (t * 0.00007 + p.ph) % 1;
      const y = Math.round(fire.y - flameH - 2 - life * (fire.y - flameH - smokeTop));
      const x = Math.round(
        fire.x + p.dx + life * life * 14 * unit + Math.sin(life * 9 + p.ph * 6) * 1.5,
      );
      const w = life < 0.3 ? 1 : 2;
      if (life > 0.9 && (Math.floor(t / 180) + x) % 2) continue;
      out.push([x, y, w, 1, life < 0.25 ? INK[6] : life < 0.6 ? INK[5] : INK[4]]);
    }
    // the watch fire: columns of flame, a hot core
    const frame = Math.floor(t / 110);
    for (let dx = -flameW; dx <= flameW; dx++) {
      const fall = Math.abs(dx) / (flameW + 1);
      const h = Math.max(
        1,
        Math.round(flameH * (1 - fall * 0.8) * (0.62 + hash2(frame, dx + 9, 3) * 0.45)),
      );
      out.push([fire.x + dx, fire.y - h, 1, h, EMB[4]]);
      const core = Math.round(h * (0.62 - fall * 0.4));
      if (core > 0 && Math.abs(dx) < flameW)
        out.push([fire.x + dx, fire.y - core, 1, core, EMB[5]]);
    }
    const heart = Math.max(1, Math.round(flameH * 0.3));
    out.push([fire.x, fire.y - heart, 1, heart, EMB[6]]);
    const lick = Math.round(fire.y - flameH * (0.95 + hash2(frame, 1, 5) * 0.3));
    out.push([fire.x + (frame % 3) - 1, lick, 1, 1, EMB[3]]);
    for (const sp of sparks) {
      const life = (t * 0.00042 * sp.sp + sp.ph) % 1;
      if (life > 0.8) continue;
      const x = Math.round(fire.x + sp.dx * life * unit + Math.sin(life * 11 + sp.ph * 20) * 1.5);
      const y = Math.round(fire.y - flameH - life * 26 * unit);
      out.push([x, y, 1, 1, life < 0.3 ? EMB[5] : life < 0.6 ? EMB[4] : EMB[2]]);
    }
    for (let i = 0; i < smallFires.length; i++) {
      const f = smallFires[i];
      const fl = hash2(Math.floor(t / 150), i, 9);
      out.push([f.x, f.y - 1, 1, 2, fl > 0.7 ? EMB[5] : EMB[4]]);
      if (fl > 0.45) out.push([f.x, f.y - 2, 1, 1, EMB[3]]);
    }
    // pennants: crimson cloth in three segments that lift and fall along its length
    for (let i = 0; i < pennants.length; i++) {
      const p = pennants[i];
      const seg = Math.max(1, Math.round(p.len / 3));
      const tall = p.big ? 3 : 2;
      for (let k = 0; k < 3; k++) {
        const wave = Math.round(Math.sin(t * 0.0045 - k * 1.3 + i * 2) * (k * 0.6));
        const h = Math.max(1, tall - (k === 2 ? 1 : 0));
        out.push([p.x + 1 + k * seg, p.y + wave, seg, h, k === 1 ? BLD[4] : BLD[3]]);
      }
    }
    for (const m of flies) {
      const blink = Math.sin(t * 0.0016 * m.s + m.p);
      if (blink < 0.35) continue;
      const x = Math.round(m.x + Math.sin(t * 0.0005 * m.s + m.p) * 5);
      const y = Math.round(m.y + Math.cos(t * 0.0007 + m.p * 2) * 3);
      out.push([x, y, 1, 1, blink > 0.85 ? EMB[6] : EMB[4]]);
    }
    for (const g of blades)
      if (Math.sin(t * 0.0018 + g.x * 0.3) > 0.55) out.push([g.x + 1, g.y, 1, 1, INK[1]]);
  };

  return {
    width: W,
    height: H,
    layout,
    pixels: R.px,
    raster: R,
    rects(timeMs) {
      const raw = [];
      animate(Math.max(0, Number(timeMs) || 0), raw);
      const out = [];
      for (const [x, y, w, h, c] of raw) {
        if (w <= 0 || h <= 0 || x + w <= 0 || y + h <= 0 || x >= W || y >= H) continue;
        out.push([x, y, w, h, HEX_OF.get(c)]);
      }
      return out;
    },
  };
}

/** The camp as a scene the backdrop helper drives (`render(ctx, timeMs)`). */
export function createCampScene(opts = {}) {
  const plate = paintCampPlate(opts);
  let reducedMotion = !!opts.reducedMotion;
  let base = plate.raster.toCanvas();
  return {
    width: plate.width,
    height: plate.height,
    layout: plate.layout,
    setReducedMotion(value) {
      reducedMotion = !!value;
    },
    render(ctx, timeMs) {
      if (!base) return;
      ctx.drawImage(base, 0, 0);
      for (const [x, y, w, h, hex] of plate.rects(reducedMotion ? CAMP_FROZEN_TIME : timeMs)) {
        ctx.fillStyle = hex;
        ctx.fillRect(x, y, w, h);
      }
    },
    destroy() {
      if (base) base.width = base.height = 0;
      base = null;
    },
  };
}

export default createCampScene;
