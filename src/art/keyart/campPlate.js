// campPlate.js — the army's night camp, for Home Base (pure Canvas2D, no Phaser).
//
// Painted in the Hollow Sun key art's technique (plateKit.js: the Ink & Ember ramps, ordered
// Bayer dithering, a Uint32 raster): a fire in a ring of stones, two tents, the banner, and
// the chosen commander and partner standing either side of the fire, each with the arm their
// class carries. Composed for the box it is shown in (any plate size), like the act vistas.
//
// Deterministic for (commander, partner, width, height, seed); never calls Math.random. The
// static plate is baked once (`paintCampPlate`, no DOM); per frame only a short list of
// palette-coloured rectangles moves (`rects(t)`): the flame, sparks, the banner, stars, the
// light breathing on the ground. Reduced motion shows one frozen frame.

import {
  PALETTE,
  pack,
  mulberry32,
  hash2,
  makeNoise,
  clamp,
  smooth,
  pick,
  Raster,
} from './plateKit.js';

const INK = PALETTE.ink.map(pack);
const EMB = PALETTE.ember.map(pack);
const BLD = PALETTE.blood.map(pack);
const STL = PALETTE.steel.map(pack);
const VRD = PALETTE.verdigris.map(pack);

const HEX_OF = new Map();
for (const ramp of Object.values(PALETTE)) for (const h of ramp) HEX_OF.set(pack(h), h);

export const CAMP_MIN = 64;
export const CAMP_MAX = 360;
export const CAMP_FROZEN_TIME = 5200;

/** The arm a figure carries, by lord. Unknown names carry a sword. */
export const CAMP_ARMS = Object.freeze({
  Edric: 'sword',
  Kira: 'tome',
  Voss: 'bow',
  Sera: 'staff',
  Rowan: 'lance',
  Astrid: 'lance',
  Cael: 'axe',
});
/** Cloak ramp per lord, so the pair reads apart even as silhouettes. */
const CLOAKS = {
  Edric: STL,
  Kira: PALETTE.unlight.map(pack),
  Voss: VRD,
  Sera: INK.slice(6),
  Rowan: BLD,
  Astrid: STL,
  Cael: EMB,
};

export function campArm(name) {
  return CAMP_ARMS[name] || 'sword';
}

/** Where things stand on a W x H plate. */
export function campLayout(W, H) {
  const ground = Math.round(H * 0.62);
  const fire = { x: Math.round(W * 0.5), y: Math.round(H * 0.8) };
  const tall = clamp(Math.round(H * 0.25), 12, 30); // a figure's height
  const gap = clamp(Math.round(W * 0.13), 12, 30);
  return {
    ground,
    fire,
    tall,
    commander: { x: fire.x - gap, y: fire.y + 1 },
    partner: { x: fire.x + gap, y: fire.y + 1 },
    banner: { x: Math.round(W * 0.2), y: Math.round(H * 0.7) },
  };
}

function paintSky(R, { W, ground, noise, rng }) {
  for (let y = 0; y < ground; y++) {
    const v = y / ground;
    for (let x = 0; x < W; x++) {
      const cloud = noise.fbm2(x * 0.03, y * 0.09, 3) * smooth(0.2, 0.9, v) * 1.2;
      R.set(x, y, pick(INK, 0.6 + v * 2.2 + cloud, x, y));
    }
  }
  // Stars, kept out of the lowest sky. The ones that twinkle are returned.
  const stars = [];
  const n = Math.round((W * ground) / 170);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * ground * 0.8);
    const bright = rng();
    R.set(x, y, bright > 0.8 ? INK[10] : bright > 0.4 ? INK[8] : INK[6]);
    if (bright > 0.55) stars.push({ x, y, ph: rng() * 6.28, sp: 0.6 + rng() * 1.6 });
  }
  return stars;
}

/** A small Hollow Sun low in the night: a pale ring, dark inside. */
function paintSun(R, { W, ground }) {
  const cx = Math.round(W * 0.78);
  const cy = Math.round(ground * 0.34);
  const r = clamp(Math.round(W * 0.045), 4, 9);
  for (let y = -r - 3; y <= r + 3; y++)
    for (let x = -r - 3; x <= r + 3; x++) {
      const d = Math.hypot(x, y);
      if (d < r - 1.2) R.set(cx + x, cy + y, INK[0]);
      else if (d < r + 0.4) R.set(cx + x, cy + y, EMB[4]);
      else if (d < r + 3) {
        const c = pick(INK, 3.2 + (r + 3 - d) * 1.1, cx + x, cy + y);
        R.set(cx + x, cy + y, c);
      }
    }
}

function paintFar(R, { W, ground, noise }) {
  // A far ridge, then a line of pines against it.
  for (let x = 0; x < W; x++) {
    const top = ground - 9 - noise.fbm1(x * 0.02, 3) * 12;
    for (let y = Math.round(top); y < ground; y++) R.set(x, y, pick(INK, 2.3, x, y));
  }
  for (let x = 0; x < W; x++) {
    const tree = noise.n1(x * 0.5) * 7 + noise.n1(x * 0.11 + 9) * 6;
    const top = ground - 2 - tree * (0.6 + 0.4 * Math.abs(((x % 5) - 2) / 2));
    for (let y = Math.round(top); y < ground; y++) R.set(x, y, INK[1]);
  }
}

function paintGround(R, { W, H, ground, fire, noise }) {
  const reach = Math.max(W, H) * 0.6;
  for (let y = ground; y < H; y++)
    for (let x = 0; x < W; x++) {
      // The fire's pool of light, squashed onto the ground plane.
      const d = Math.hypot(x - fire.x, (y - fire.y) * 2.4) / reach;
      const lit = Math.max(0, 1 - d);
      const grain = noise.fbm2(x * 0.12, y * 0.3, 2) - 0.5;
      const L = lit * lit * lit * 7 + grain * 0.9;
      if (L > 1.1) R.set(x, y, pick(EMB, (L - 1.1) * 0.8 + 0.3, x, y));
      else R.set(x, y, pick(INK, 1.2 + L * 1.6 + grain * 0.6, x, y));
    }
  // Grass tufts catching the light.
  for (let i = 0; i < W * 0.7; i++) {
    const x = Math.floor(hash2(i, 1, 77) * W);
    const y = ground + 1 + Math.floor(hash2(i, 2, 77) * (H - ground - 2));
    const d = Math.hypot(x - fire.x, (y - fire.y) * 2.4) / reach;
    if (d < 0.14) continue;
    const c = d < 0.55 ? EMB[2] : d < 0.85 ? VRD[1] : VRD[0];
    R.set(x, y, c);
    R.set(x, y - 1, c);
  }
}

/** A ridge tent: lit on the face turned to the fire. `face` is +1 when the fire is right. */
function paintTent(R, cx, base, w, h, face, near) {
  for (let j = 0; j < h; j++) {
    const half = ((j + 1) / h) * (w / 2);
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const side = (x - cx) * face; // > 0: the fire's side
      const y = base - h + j;
      let c;
      if (side > 0) c = pick(EMB, near * (1.2 + (j / h) * 2.4) + (side / half) * 0.6, x, y);
      else c = pick(INK, 2.4 + (j / h) * 1.2, x, y);
      R.set(x, y, c);
    }
  }
  // Ridge pole, the door's dark slit, a guy rope.
  R.rect(cx, base - h - 2, 1, 3, INK[6]);
  const door = Math.max(2, Math.round(h * 0.45));
  for (let j = 0; j < door; j++) {
    const half = Math.max(0, Math.round(((j + 1) / door) * (w * 0.09)));
    R.rect(cx + face * Math.round(w * 0.16) - half, base - door + j, half * 2 + 1, 1, INK[0]);
  }
  for (let k = 0; k < Math.round(w * 0.22); k++)
    R.set(cx - face * (Math.round(w / 2) + k), base - Math.round(k * 0.5) - 1, INK[4]);
}

function paintBannerPole(R, { banner, tall }) {
  const h = Math.round(tall * 2.1);
  R.rect(banner.x, banner.y - h, 1, h, INK[7]);
  R.set(banner.x, banner.y - h - 1, EMB[5]);
  R.rect(banner.x - 1, banner.y, 3, 1, INK[3]);
  return { x: banner.x + 1, y: banner.y - h + 1, w: clamp(Math.round(tall * 0.7), 7, 16) };
}

function paintFirePit(R, { fire }) {
  // Stones in a ring, two crossed logs.
  for (let k = -5; k <= 5; k++) {
    const y = fire.y + 1 + (Math.abs(k) < 4 ? 1 : 0);
    R.set(fire.x + k, y, Math.abs(k) % 2 ? INK[5] : INK[7]);
  }
  for (let k = -4; k <= 4; k++) {
    R.set(fire.x + k, fire.y - Math.round(Math.abs(k) * 0.25), EMB[1]);
    R.set(fire.x + k, fire.y + 1, EMB[0]);
  }
  R.rect(fire.x - 2, fire.y, 5, 1, EMB[3]);
}

/**
 * A standing figure, feet at (x, y), `face` +1 looking right (toward the fire).
 * Lit on the side turned to the fire; the arm is held on the far side.
 */
function paintFigure(R, x, y, tall, face, name) {
  const cloak = CLOAKS[name] || STL;
  const arm = campArm(name);
  const head = Math.max(3, Math.round(tall * 0.2));
  const legs = Math.round(tall * 0.34);
  const body = tall - head - legs;
  const halfW = Math.max(2, Math.round(tall * 0.16));
  const top = y - tall;
  const dark = INK[1];
  const cDark = cloak[1];
  const cMid = cloak[Math.min(3, cloak.length - 1)];
  // Long shadow thrown away from the fire.
  for (let k = 1; k <= tall; k++) R.set(x - face * (halfW + k), y + ((k / 5) | 0), INK[0]);
  // Legs.
  for (let j = 0; j < legs; j++) {
    R.set(x - 1, y - j, dark);
    R.set(x + 1, y - j, dark);
    R.set(x + face, y - j, j % 3 === 0 ? EMB[2] : dark);
  }
  R.rect(x - 1, y - legs, 3, 1, dark);
  // Body under a cloak that widens toward the hem.
  for (let j = 0; j < body + 2; j++) {
    const yy = top + head + j;
    const half = Math.round(halfW * (0.75 + (j / (body + 2)) * 0.5));
    for (let i = -half; i <= half; i++) {
      const lit = i * face;
      let c = lit >= half ? EMB[4] : lit >= half - 1 ? cMid : lit > -half + 1 ? cDark : dark;
      if (lit >= half && j % 4 === 3) c = EMB[3];
      R.set(x + i, yy, c);
    }
  }
  // Head: hair behind, a lit cheek toward the fire.
  for (let j = 0; j < head; j++)
    for (let i = -1; i <= 1; i++) {
      const lit = i * face;
      R.set(x + i, top + j, lit > 0 ? EMB[5] : lit === 0 && j > 0 ? EMB[2] : dark);
    }
  R.set(x - face, top - 1, dark);
  R.set(x, top - 1, dark);
  // The arm, on the side away from the fire, catching a rim of light.
  const ax = x - face * (halfW + 2);
  const steel = STL[4];
  if (arm === 'lance' || arm === 'staff') {
    const len = Math.round(tall * (arm === 'lance' ? 1.45 : 1.15));
    R.rect(ax, y - len, 1, len + 1, INK[6]);
    if (arm === 'lance') {
      R.set(ax, y - len - 1, steel);
      R.set(ax, y - len - 2, STL[5]);
      R.set(ax + face, y - len + 1, BLD[3]);
      R.set(ax + face, y - len + 2, BLD[2]);
    } else {
      R.set(ax, y - len - 1, EMB[5]);
      R.set(ax - 1, y - len, EMB[4]);
      R.set(ax + 1, y - len, EMB[4]);
      R.set(ax, y - len - 2, EMB[6]);
    }
  } else if (arm === 'axe') {
    const len = Math.round(tall * 0.95);
    R.rect(ax, y - len, 1, len + 1, INK[6]);
    R.rect(ax - 2, y - len, 2, 3, steel);
    R.rect(ax + 1, y - len, 2, 3, steel);
    R.set(ax - 2, y - len + 1, STL[5]);
  } else if (arm === 'bow') {
    const len = Math.round(tall * 0.8);
    for (let j = 0; j <= len; j++) {
      const bend = Math.round(Math.sin((j / len) * Math.PI) * 2.4);
      R.set(ax - face * bend, y - 2 - j, EMB[2]);
    }
    R.rect(ax + 0, y - 2 - len, 1, len + 1, INK[7]);
  } else if (arm === 'tome') {
    const yy = top + head + Math.round(body * 0.55);
    R.rect(x + face * halfW, yy, 3, 3, BLD[2]);
    R.rect(x + face * halfW + (face > 0 ? 2 : 0), yy, 1, 3, EMB[5]);
  } else {
    // A sword, point down, hands on the pommel.
    const len = Math.round(tall * 0.62);
    R.rect(ax, y - len, 1, len + 1, steel);
    R.set(ax, y - len + 1, STL[5]);
    R.rect(ax - 1, y - len, 3, 1, EMB[4]);
    R.set(ax, y - len - 1, EMB[2]);
    R.set(ax, y - len - 2, EMB[4]);
  }
}

/**
 * Bake the camp (no DOM). `rects(timeMs)` are the moving things as `[x, y, w, h, '#hex']`.
 */
export function paintCampPlate({ commander, partner, width, height, seed = 7 } = {}) {
  const W = clamp(Math.round(width) || CAMP_MIN, CAMP_MIN, CAMP_MAX);
  const H = clamp(Math.round(height) || CAMP_MIN, CAMP_MIN, CAMP_MAX);
  const s = seed >>> 0;
  const R = new Raster(W, H);
  const layout = campLayout(W, H);
  const env = { W, H, ...layout, noise: makeNoise(s * 31 + 5), rng: mulberry32(s * 7919 + 11) };
  const stars = paintSky(R, env);
  paintSun(R, env);
  paintFar(R, env);
  paintGround(R, env);
  const { fire, tall, ground } = layout;
  const tw = clamp(Math.round(W * 0.26), 20, 60);
  const th = Math.round(tw * 0.62);
  paintTent(R, Math.round(W * 0.82), ground + Math.round((H - ground) * 0.3), tw, th, -1, 0.75);
  if (W >= 120)
    paintTent(
      R,
      Math.round(W * 0.38),
      ground + 3,
      Math.round(tw * 0.62),
      Math.round(th * 0.62),
      1,
      0.4,
    );
  const flag = paintBannerPole(R, env);
  paintFirePit(R, env);
  if (commander) paintFigure(R, layout.commander.x, layout.commander.y, tall, 1, commander);
  if (partner && partner !== commander)
    paintFigure(R, layout.partner.x, layout.partner.y, tall - 1, -1, partner);

  const flameH = clamp(Math.round(tall * 0.6), 7, 16);
  const sparks = [];
  for (let i = 0; i < 9; i++)
    sparks.push({ ph: env.rng(), sp: 0.16 + env.rng() * 0.16, dx: env.rng() * 2 - 1 });

  const animate = (t, out) => {
    const sec = t / 1000;
    // Stars: the twinklers dim in turn.
    for (const st of stars)
      if (Math.sin(sec * st.sp + st.ph) > 0.72) out.push([st.x, st.y, 1, 1, INK[4]]);
    // The banner: columns ride a travelling wave.
    for (let i = 0; i < flag.w; i++) {
      const wave = Math.round(Math.sin(sec * 2.6 - i * 0.7) * Math.min(2, i * 0.35));
      const hgt = Math.max(2, Math.round(flag.w * 0.62 - (i > flag.w - 3 ? flag.w - i : 0)));
      const shade = Math.sin(sec * 2.6 - i * 0.7 + 1) > 0.2 ? BLD[4] : BLD[3];
      out.push([flag.x + i, flag.y + wave, 1, hgt, i === 0 ? BLD[2] : shade]);
      if (i === Math.round(flag.w * 0.5)) out.push([flag.x + i, flag.y + wave + 2, 1, 2, EMB[5]]);
    }
    // The flame: a column of rows whose width and lean are rehashed 9 times a second.
    const step = Math.floor(sec * 9);
    for (let j = 0; j < flameH; j++) {
      const v = j / flameH; // 0 at the base
      const jit = hash2(j, step, s + 3);
      const belly = Math.min(1, 0.55 + v * 2.2) * Math.pow(1 - v, 0.85);
      const half = Math.round(belly * tall * 0.19 * (0.75 + jit * 0.5) - 0.2);
      if (half < 0 || (half === 0 && jit < 0.45)) continue;
      const lean = Math.round((hash2(step, 5, s) - 0.5) * 3 * v);
      const y = fire.y - 1 - j;
      const c = v < 0.3 ? EMB[6] : v < 0.6 ? EMB[5] : v < 0.82 ? EMB[4] : BLD[4];
      out.push([fire.x - half + lean, y, half * 2 + 1, 1, c]);
      if (half > 1 && v < 0.5) out.push([fire.x - half + lean, y, 1, 1, EMB[4]]);
    }
    // Sparks rise, drift and go out.
    for (const sp of sparks) {
      const life = (sec * sp.sp + sp.ph) % 1;
      const y = fire.y - flameH - Math.round(life * tall * 2.4);
      const x = fire.x + Math.round(sp.dx * 3 + Math.sin(life * 9 + sp.ph * 20) * 2.5 * life);
      if (y < 1) continue;
      out.push([x, y, 1, 1, life < 0.4 ? EMB[6] : life < 0.75 ? EMB[4] : BLD[3]]);
    }
    // The ground's light breathes: a few glints near the fire come and go with the flame.
    for (let i = 0; i < 10; i++) {
      if (hash2(i, step, s + 9) < 0.5) continue;
      const gx = fire.x + Math.round((hash2(i, 3, s) - 0.5) * tall * 2.6);
      const gy = fire.y + 2 + Math.round(hash2(i, 4, s) * 4);
      if (Math.abs(gx - fire.x) < 6) continue;
      out.push([gx, gy, 2, 1, EMB[3]]);
    }
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
