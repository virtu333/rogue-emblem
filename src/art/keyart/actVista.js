// actVista.js — code-drawn vistas for the act title cards (pure Canvas2D, no Phaser).
//
// One plate per act, painted in the Hollow Sun key art's technique (plateKit.js: the Ink &
// Ember ramps, ordered Bayer dithering, a Uint32 raster): the road the army is about to walk.
//   act1       Border Marches · Ember Dusk     a watchtower and palisade under a burning dusk
//   act2       Old Kingdom Roads · Iron Rain   a broken aqueduct and a headless king in the rain
//   act3       Imperial Heartland · Bleached Rite   the white city and its crimson standards
//   act4       Ashen Frontier · Ashfall        a burning mountain over a dead frontier
//   finalBoss  The Imperial Seat · The Deep    the stair under the throne, lit from below
//   secretAct  Beyond the Veil                 the Hollow Sun itself, over a black mirror
// The Hollow Sun hangs in every open sky and grows act by act.
//
// Unlike the title's fixed plate, a vista is composed for the box it is shown in: the painter
// takes any plate size (a 422x195 phone held sideways, a 195x422 phone held upright) and
// lays the land out for it, so neither orientation is a crop of the other. The card's title
// sits over the upper centre (`titleZone`), which every vista keeps calm.
//
// Deterministic for (act, width, height, seed); never calls Math.random. The static plate is
// baked once into a pixel buffer (`paintActVista`, no DOM, so it runs in tests); per frame only
// a short list of palette-coloured rectangles moves (`rects(t)`): rain, ash, motes, pennants,
// a flicker. Reduced motion shows one frozen frame.

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
  circlePixels,
  curvePixels,
  bezier,
  fillSky,
  fillLayer,
  stamp,
  hollowSun,
  stars,
  profile,
} from './plateKit.js';

const INK = PALETTE.ink.map(pack);
const EMB = PALETTE.ember.map(pack);
const BLD = PALETTE.blood.map(pack);
const STL = PALETTE.steel.map(pack);
const UNL = PALETTE.unlight.map(pack);

export const ACT_VISTA_IDS = Object.freeze([
  'act1',
  'act2',
  'act3',
  'act4',
  'finalBoss',
  'secretAct',
]);

/** The vista an act id shows (the prologue walks the Border Marches; unknown ids too). */
export function actVistaId(actId) {
  return ACT_VISTA_IDS.includes(actId) ? actId : 'act1';
}

/** Plate size limits: below MIN nothing reads, above MAX the bake costs too much. */
export const VISTA_MIN = 96;
export const VISTA_MAX = 520;

/**
 * Where things sit for a `W` x `H` plate: the horizon, and the title's zone (kept calm).
 * A wide plate carries the title over the top third with dialogue over the lower half;
 * a tall plate has the whole middle to itself.
 */
export function vistaLayout(W, H) {
  const wide = W >= H;
  return {
    wide,
    hz: Math.round(H * (wide ? 0.5 : 0.57)),
    titleZone: wide
      ? { x0: Math.round(W * 0.2), x1: Math.round(W * 0.8), y1: Math.round(H * 0.34) }
      : { x0: 0, x1: W, y1: Math.round(H * 0.2) },
  };
}

// ---------------------------------------------------------------------------
// Act I — Border Marches · Ember Dusk
// ---------------------------------------------------------------------------
const DUSK_SKY = [INK[1], UNL[0], UNL[1], BLD[1], BLD[2], BLD[3], EMB[3], EMB[4], EMB[5]];
const DUSK_HILL = [INK[0], INK[1], UNL[0], UNL[1], BLD[1], BLD[2], BLD[3]];
const DUSK_FIELD = [INK[0], INK[1], INK[2], EMB[0], EMB[1], EMB[2], EMB[3]];

/** The border watchtower: stone shaft, timber hoarding, a steep roof and a pennant pole. */
function watchtower(R, cx, baseY) {
  const shaftH = 22;
  for (let j = 0; j < shaftH; j++) {
    const half = j < 4 ? 5 : 4;
    for (let dx = -half; dx <= half; dx++) {
      const c = dx === -half ? BLD[1] : dx < 1 ? INK[1] : INK[0];
      R.set(cx + dx, baseY - j, c);
    }
  }
  // door and arrow slit
  for (let j = 0; j < 4; j++) R.set(cx - 1, baseY - j, INK[0]);
  R.set(cx - 1, baseY - 11, INK[0]);
  R.set(cx - 1, baseY - 12, INK[0]);
  // hoarding, jutting over the shaft on brackets
  const hy = baseY - shaftH;
  for (let j = 0; j < 7; j++)
    for (let dx = -7; dx <= 7; dx++) {
      if (j === 0 && Math.abs(dx) < 7 - 1 && dx % 2 === 0) continue; // brackets
      if (j === 6 && dx % 3 === 0) continue; // crenels
      R.set(cx + dx, hy - j, dx === -7 ? BLD[1] : dx < 2 ? INK[1] : INK[0]);
    }
  // roof
  for (let j = 0; j < 9; j++) {
    const half = 8 - j;
    for (let dx = -half; dx <= half; dx++)
      R.set(cx + dx, hy - 7 - j, dx < -half + 2 ? BLD[1] : INK[0]);
  }
  for (let j = 0; j < 6; j++) R.set(cx, hy - 16 - j, INK[0]);
  return { window: { x: cx - 4, y: hy - 4 }, pole: { x: cx, y: hy - 21 } };
}

function paintAct1(R, ctx) {
  const { W, H, hz, wide, noise, rng } = ctx;
  const n = DUSK_SKY.length - 1;
  const gx = W * (wide ? 0.3 : 0.36);
  fillSky(R, DUSK_SKY, (x, y) => {
    const t = clamp(y / hz, 0, 1.2);
    const glow = Math.exp(-(((x - gx) / (W * 0.42)) ** 2)) * t * t * 1.5;
    const band = (noise.fbm2(x * 0.008, y * 0.06, 3) - 0.5) * 0.9;
    return n * t ** 1.55 * 0.86 + glow + band;
  });
  stars(R, rng, Math.round((W * hz) / 900), hz * 0.42, [INK[6], INK[8], UNL[3]]);
  // Long dusk clouds, lit from underneath.
  for (let y = Math.round(hz * 0.3); y < hz - 3; y++) {
    const t = y / hz;
    for (let x = 0; x < W; x++) {
      const c = noise.fbm2(x * 0.011 + 40, y * 0.085, 4) + smooth(0.3, 0.75, t) * 0.08;
      if (c < 0.6) continue;
      const under = noise.fbm2(x * 0.011 + 40, (y + 1.6) * 0.085, 4) < 0.6;
      const L = n * t ** 1.55 * 0.86 + (under ? 1.8 : -2.4) + smooth(0.5, 1, t) * 0.6;
      R.set(x, y, pick(DUSK_SKY, clamp(L, 1, n), x, y));
    }
  }
  const sun = wide ? { x: W * 0.87, y: H * 0.2 } : { x: W * 0.74, y: H * 0.3 };
  hollowSun(R, noise, Math.round(sun.x), Math.round(sun.y), wide ? 8 : 9, {
    corona: [EMB[4], EMB[6]],
  });

  // Far marches: two soft ranges against the burning horizon.
  const farA = profile(W, (x) => hz - 5 - noise.fbm1(x * 0.011 + 3, 3) * 15);
  const farB = profile(W, (x) => hz - 1 - noise.fbm1(x * 0.019 + 11, 3) * 11);
  fillLayer(R, farA, DUSK_HILL, { base: 3.3, haze: 0.7, hazeSpan: 14 });
  fillLayer(R, farB, DUSK_HILL, { base: 2.1, haze: 0.8, hazeSpan: 16 });
  // Poplars on the nearer range.
  for (let i = 0; i < Math.round(W / 26); i++) {
    const x = Math.floor(rng() * W);
    const h = 6 + Math.floor(rng() * 6);
    const y = Math.round(farB[x]);
    for (let j = 0; j < h; j++) {
      const w = j < 2 ? 0 : j > h - 3 ? 0 : 1;
      for (let i2 = -w; i2 <= w; i2++) R.set(x + i2, y - j, DUSK_HILL[1]);
    }
  }

  // The tower's hill.
  const tx = Math.round(W * (wide ? 0.73 : 0.6));
  const hillTop = hz + (wide ? 6 : 10);
  const mid = profile(
    W,
    (x) =>
      hillTop +
      16 -
      22 * Math.exp(-(((x - tx) / (W * 0.3)) ** 2)) +
      (noise.fbm1(x * 0.03 + 5, 3) - 0.5) * 6,
  );
  fillLayer(R, mid, DUSK_FIELD, {
    base: 2.7,
    rim: 2.4,
    rimDepth: 1,
    light: -1,
    haze: -1.5,
    hazeSpan: 70,
  });
  // Wheat rows catching the last light: warm dashes that follow the slope.
  for (let x = 0; x < W; x++) {
    const y0 = Math.round(mid[x]);
    for (let d = 3; d < 46; d += 1) {
      const y = y0 + d;
      const row = Math.floor((d + noise.fbm1(x * 0.02, 2) * 6) / 4);
      const lit = hash2(x >> 1, row, 5) > 0.62 && (d + (x >> 2)) % 4 === 0;
      const fade = 1 - smooth(8, 44, d);
      const side = Math.exp(-(((x - gx) / (W * 0.5)) ** 2));
      if (lit && fade * side > bayer(x, y) * 0.9)
        R.set(x, y, d < 16 ? EMB[3] : d < 30 ? EMB[2] : EMB[1]);
    }
  }
  // The road, winding up to the tower.
  const road = bezier(
    [W * (wide ? 0.34 : 0.3), H + 4],
    [W * 0.52, hillTop + 40],
    [tx - 34, hillTop + 22],
    [tx - 2, mid[tx] + 1],
  );
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const [rx, ry] = road(t);
    const half = (1 - t) * (wide ? 9 : 7) + 0.6;
    for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
      if (Math.abs(dx) > half) continue;
      const x = Math.round(rx + dx);
      const y = Math.round(ry);
      if (y < mid[clamp(x, 0, W - 1)] + 1) continue;
      const edge = Math.abs(dx) > half - 1;
      R.set(x, y, edge ? INK[3] : pick([INK[3], INK[4], INK[5]], 1 + t * 1.2, x, y));
    }
  }
  // Palisade along the crest, then the tower.
  for (let x = tx - 44; x < tx + 30; x++) {
    if (x < 0 || x >= W || Math.abs(x - tx) < 6) continue;
    const y = Math.round(mid[x]);
    const h = 3 + ((x * 7) % 3);
    if (x % 2 === 0) for (let j = 0; j < h; j++) R.set(x, y - j, INK[0]);
    else R.set(x, y - 1, INK[1]);
  }
  const tower = watchtower(R, tx, Math.round(mid[tx]) + 1);
  R.rect(tower.window.x, tower.window.y, 2, 3, EMB[4]);

  // Foreground: a dark bank with grass.
  const fgY = wide ? H * 0.8 : H * 0.86;
  const fg = profile(
    W,
    (x) => fgY + (noise.fbm1(x * 0.035 + 80, 3) - 0.5) * 16 + Math.abs(x - W * 0.45) * 0.03,
  );
  fillLayer(R, fg, [INK[0], INK[1], INK[2]], { base: 0.3, haze: -0.3, hazeSpan: 12 });
  const blades = [];
  for (let x = 0; x < W; x++) {
    if (hash2(x, 1, 21) < 0.45) continue;
    const h = 2 + Math.floor(hash2(x, 2, 21) * 5);
    const y = Math.round(fg[x]);
    for (let j = 0; j < h; j++) R.set(x, y - j, INK[j > h - 2 ? 1 : 0]);
    if (h >= 5) blades.push({ x, y: y - h });
  }

  // --- animation ---
  const flies = [];
  for (let i = 0; i < Math.round((W * H) / 5200); i++)
    flies.push({
      x: rng() * W,
      y: hz + 10 + rng() * (H - hz - 14),
      p: rng() * 6.28,
      s: 0.5 + rng(),
    });
  const birds = [0, 1, 2].map((i) => ({ off: rng() * W, y: hz * (0.5 + i * 0.09) + rng() * 6, i }));
  const win = tower.window;
  const pole = tower.pole;
  return (t, out) => {
    // pennant: three pixels of crimson that lift and fall
    const f = Math.floor(t / 260) % 4;
    const lift = [0, -1, 0, 1][f];
    out.push([pole.x + 1, pole.y, 2, 2, BLD[3]]);
    out.push([pole.x + 3, pole.y + lift, 2, 2, BLD[3]]);
    out.push([pole.x + 5, pole.y + (f === 1 ? 0 : lift), 1, 1, BLD[2]]);
    // the watch light
    const fl = hash2(Math.floor(t / 140), 3, 9);
    out.push([win.x, win.y, 2, 3, fl > 0.82 ? EMB[5] : fl < 0.12 ? EMB[3] : EMB[4]]);
    for (const m of flies) {
      const blink = Math.sin(t * 0.0016 * m.s + m.p);
      if (blink < 0.2) continue;
      const x = Math.round(m.x + Math.sin(t * 0.0005 * m.s + m.p) * 6);
      const y = Math.round(m.y + Math.cos(t * 0.0007 + m.p * 2) * 4);
      out.push([x, y, 1, 1, blink > 0.8 ? EMB[6] : EMB[4]]);
    }
    for (const b of birds) {
      const x = Math.round(((b.off + t * 0.006 * (1 + b.i * 0.2)) % (W + 20)) - 10);
      const y = Math.round(b.y + Math.sin(t * 0.0012 + b.i) * 2);
      const flap = Math.floor(t / 300 + b.i) % 2;
      out.push([x - 1, y - flap, 1, 1, INK[0]]);
      out.push([x, y, 1, 1, INK[0]]);
      out.push([x + 1, y - flap, 1, 1, INK[0]]);
    }
    for (const g of blades) {
      const sway = Math.sin(t * 0.0018 + g.x * 0.3) > 0.55 ? 1 : 0;
      if (sway) out.push([g.x + 1, g.y, 1, 1, INK[1]]);
    }
  };
}

// ---------------------------------------------------------------------------
// Act II — Old Kingdom Roads · Iron Rain
// ---------------------------------------------------------------------------
const RAIN_SKY = [INK[1], STL[0], INK[3], STL[1], INK[4], INK[5], INK[6], INK[7], INK[8]];
const RAIN_STONE = [INK[0], INK[1], INK[2], INK[3], INK[4], INK[5], INK[6], INK[7]];

const KING = [
  '.....hh.......',
  '....hsss......',
  '...hhssss..S..',
  '..hssssssshS..',
  '..hsssssss.S..',
  '..hssssss..S..',
  '...hsssss..S..',
  '...hsssss..S..',
  '...hssssss.S..',
  '...hssssss.S..',
  '..hsssssss.S..',
  '..hsssssss.S..',
  '..hssssssss...',
  '..hssssssss...',
  '.hhhhhhhhhhh..',
  '.hssssssssss..',
  '.hssssssssss..',
  '.hssssssssss..',
  'hhhhhhhhhhhhh.',
  'hsssssssssssss',
];

function paintAct2(R, ctx) {
  const { W, H, hz, wide, noise, rng } = ctx;
  const n = RAIN_SKY.length - 1;
  fillSky(R, RAIN_SKY, (x, y) => {
    const t = clamp(y / hz, 0, 1.3);
    const cloud = (noise.fbm2(x * 0.013, y * 0.04, 5) - 0.5) * 4.2;
    const slit = 3.2 * Math.exp(-(((y - hz + 7) / 6) ** 2));
    return clamp(1.2 + t * 2.2 + cloud + slit, 0, n);
  });
  // The sun, dim behind the overcast.
  const sun = wide ? { x: W * 0.12, y: H * 0.19 } : { x: W * 0.24, y: H * 0.29 };
  hollowSun(R, noise, Math.round(sun.x), Math.round(sun.y), wide ? 10 : 11, {
    ring: INK[8],
    hot: INK[10],
    corona: [INK[6], INK[7]],
    reach: 12,
  });

  // Hills lost in the rain.
  const far = profile(W, (x) => hz - 3 - noise.fbm1(x * 0.014 + 4, 3) * 12);
  fillLayer(R, far, RAIN_STONE, { base: 5.6, haze: 0.9, hazeSpan: 12 });

  // The aqueduct: tall arches marching in from the left, broken before the far bank.
  const AH = clamp(Math.round(H * (wide ? 0.22 : 0.17)), 28, 66);
  const deckY = hz - AH;
  const pitch = Math.round(AH * 0.62);
  const pierW = Math.max(4, Math.round(AH * 0.13));
  const endX = Math.round(W * (wide ? 0.6 : 0.72));
  const ground = hz + 4;
  const body = (x, y, lit) =>
    pick(RAIN_STONE, lit ? 4.1 : 1.5 + smooth(0, AH, y - deckY) * 1.1, x, y);
  for (let x = -pitch; x < endX; x++) {
    const k = Math.floor((x + pitch) / pitch);
    const lx = (((x + pitch) % pitch) + pitch) % pitch;
    const inPier = lx < pierW;
    const last = (k + 1) * pitch - pitch > endX - pitch;
    // jagged break on the last span
    const breakY = last ? deckY + Math.round(hash2(x >> 1, 0, 3) * 5 + (lx / pitch) * AH * 0.5) : 0;
    for (let y = deckY; y < ground; y++) {
      if (last && y < breakY) continue;
      const d = y - deckY;
      let solid = inPier || d < 5;
      if (!solid) {
        // arch: semicircle spanning the gap under the deck
        const span = pitch - pierW;
        const cx = pierW + span / 2;
        const r = span / 2;
        const ay = deckY + 5 + r;
        solid = y < ay && Math.hypot(lx - cx, y - ay) > r;
      }
      if (!solid) continue;
      const lit = d === 0 || (inPier && lx === 0) || d === 5;
      R.set(x, y, d === 4 ? RAIN_STONE[2] : body(x, y, lit));
    }
  }
  // A lone pier past the break, and a stub on the far side.
  for (const [px, top] of [
    [endX + pitch * 0.9, deckY + AH * 0.28],
    [endX + pitch * 2.1, deckY + AH * 0.62],
  ]) {
    const x0 = Math.round(px);
    for (let x = x0; x < x0 + pierW; x++)
      for (let y = Math.round(top + hash2(x, 1, 8) * 4); y < ground; y++)
        R.set(x, y, body(x, y, x === x0));
  }

  // The old road: wet slabs running to the horizon.
  const land = profile(W, (x) => hz + 3 + (noise.fbm1(x * 0.03 + 2, 3) - 0.5) * 4);
  fillLayer(R, land, RAIN_STONE, { base: 3.2, rim: 1.2, haze: -1.6, hazeSpan: 50, grain: 0.5 });
  const vx = W * (wide ? 0.5 : 0.48);
  for (let y = hz + 5; y < H; y++) {
    const t = (y - hz - 5) / (H - hz - 5);
    const half = 3 + t * W * (wide ? 0.2 : 0.34);
    const cx = vx + (t - 0.4) * W * 0.08;
    const seam = Math.floor(Math.log(1 + t * 9) * 6);
    const seamNext = Math.floor(Math.log(1 + ((y + 1 - hz - 5) / (H - hz - 5)) * 9) * 6);
    for (let x = Math.round(cx - half); x <= cx + half; x++) {
      const edge = x - (cx - half) < 1.5 || cx + half - x < 1.5;
      const col = Math.floor(((x - cx) / half) * 2.5 + (seam % 2) * 0.5 + 8);
      const colNext = Math.floor(((x + 1 - cx) / half) * 2.5 + (seam % 2) * 0.5 + 8);
      const joint = seam !== seamNext || col !== colNext;
      const wet = noise.fbm2(x * 0.05, y * 0.2 + 30, 2);
      let L = 4.4 - t * 1.6 + (wet - 0.5) * 1.2;
      if (edge || joint) L -= 1.6;
      R.set(x, y, pick(RAIN_STONE, clamp(L, 0, 7), x, y));
    }
  }
  // Puddles: slivers of sky lying on the stone.
  const puddles = [];
  for (let i = 0; i < Math.round(W / 34); i++) {
    const t = 0.12 + rng() * 0.55;
    const y = Math.round(hz + 5 + t * (H - hz - 5));
    const x = Math.round(rng() * W);
    const w = Math.round(4 + t * 14);
    for (let dx = 0; dx < w; dx++) R.set(x + dx, y, dx % 5 === 4 ? INK[6] : STL[2]);
    for (let dx = 1; dx < w - 2; dx++) R.set(x + dx, y + 1, STL[1]);
    puddles.push({ x, y, w });
  }
  // The headless king on his plinth, and a milestone.
  const kx = Math.round(W * (wide ? 0.82 : 0.74));
  const ky = Math.round(land[clamp(kx, 0, W - 1)]) - KING.length + 9;
  stamp(R, KING, kx, ky, { h: INK[5], s: INK[2], S: INK[4] });
  const mx = Math.round(vx - W * (wide ? 0.16 : 0.26));
  const my = Math.round(hz + 5 + 0.3 * (H - hz - 5));
  stamp(R, ['.hh.', 'hsss', 'hsss', 'hsss', 'hsss'], mx, my - 5, { h: INK[5], s: INK[2] });

  // Foreground rubble and reeds.
  const fgY = wide ? H * 0.78 : H * 0.87;
  const fg = profile(W, (x) => {
    const block = Math.floor(x / 9);
    const step = (hash2(block, 0, 13) - 0.5) * 10;
    const side = Math.abs(x - W * 0.5) / (W * 0.5);
    return fgY + step * side - side * side * 14 + (H - fgY + 8) * (1 - side) ** 1.5;
  });
  fillLayer(R, fg, RAIN_STONE, { base: 0.6, rim: 1.4, haze: -0.6, hazeSpan: 8 });
  for (let x = 0; x < W; x++) {
    const side = Math.abs(x - W * 0.5) / (W * 0.5);
    if (side < 0.5 || hash2(x, 4, 17) < 0.6) continue;
    const h = 4 + Math.floor(hash2(x, 5, 17) * 9);
    const y = Math.round(fg[x]);
    for (let j = 0; j < h; j++) R.set(x + (j > h - 3 ? 1 : 0), y - j, INK[j === h - 1 ? 2 : 0]);
  }

  // --- animation ---
  const drops = [];
  const count = Math.round((W * H) / 260);
  for (let i = 0; i < count; i++)
    drops.push({ x: rng() * (W + 40), y: rng() * H, near: i % 3 === 0, v: 0.8 + rng() * 0.4 });
  return (t, out) => {
    for (const d of drops) {
      const speed = (d.near ? 0.34 : 0.2) * d.v;
      const y = (d.y + t * speed) % (H + 8);
      const x = Math.round(d.x - (y / H) * (d.near ? 26 : 16));
      if (d.near) {
        out.push([x, Math.round(y) - 4, 1, 3, INK[8]]);
        out.push([x + 1, Math.round(y) - 7, 1, 3, INK[7]]);
      } else out.push([x, Math.round(y) - 3, 1, 3, INK[6]]);
    }
    for (let i = 0; i < puddles.length; i++) {
      const p = puddles[i];
      const ph = Math.floor(t / 180 + i * 3) % 7;
      if (ph < 3) {
        const c = p.x + Math.floor(p.w / 2);
        out.push([c - ph - 1, p.y, 1, 1, STL[4]]);
        out.push([c + ph + 1, p.y, 1, 1, STL[4]]);
      }
    }
    // far lightning: the horizon slit brightens for a breath
    const cycle = t % 9800;
    if (cycle < 90 || (cycle > 210 && cycle < 270)) out.push([0, 0, W, hz, STL[5], 0.1]);
  };
}

// ---------------------------------------------------------------------------
// Act III — Imperial Heartland · Bleached Rite
// ---------------------------------------------------------------------------
const BLEACH_SKY = [INK[2], INK[3], INK[4], INK[5], INK[6], INK[7], INK[8], INK[9], INK[10]];
const BLEACH_STONE = [INK[3], INK[5], INK[6], INK[7], INK[8], INK[9], INK[10], INK[11]];

function paintAct3(R, ctx) {
  const { W, H, hz, wide, noise, rng, titleZone } = ctx;
  const n = BLEACH_SKY.length - 1;
  const sun = wide ? { x: W * 0.13, y: H * 0.22 } : { x: W * 0.26, y: H * 0.31 };
  const sr = wide ? 12 : 13;
  fillSky(R, BLEACH_SKY, (x, y) => {
    const t = clamp(y / hz, 0, 1.2);
    const d = Math.hypot(x - sun.x, (y - sun.y) * 1.1);
    const halo = 2.6 * Math.exp(-d / (W * 0.16));
    // long pale rays fanning from the sun
    const a = Math.atan2(y - sun.y, x - sun.x);
    const ray = noise.n1(a * 9 + 3) > 0.62 ? 0.7 * Math.exp(-d / (W * 0.5)) : 0;
    return clamp(0.2 + t ** 1.5 * (n - 1.2) + halo + ray, 0, n);
  });
  hollowSun(R, noise, Math.round(sun.x), Math.round(sun.y), sr, {
    ring: INK[11],
    hot: EMB[6],
    corona: [INK[10], INK[11]],
    reach: sr * 2.2,
  });

  // Bleached mesas far off.
  const far = profile(W, (x) => hz - 4 - noise.fbm1(x * 0.009 + 7, 2) * 9);
  fillLayer(R, far, BLEACH_STONE, { base: 4.4, haze: 1.2, hazeSpan: 10 });

  // The white city: three terraces of wall rising to the cathedral.
  const cx0 = Math.round(W * (wide ? 0.42 : 0.18));
  const cx1 = W + 4;
  const cathX = Math.round(W * (wide ? 0.86 : 0.7));
  const stone = (x, y, lit, depth) =>
    pick(
      BLEACH_STONE,
      (lit ? 6.2 : 4.6) - depth * 0.5 + (hash2(x >> 1, y >> 1, 2) - 0.5) * 0.5,
      x,
      y,
    );
  const tiers = [
    { y: hz - 6, x0: cx0, depth: 1.6 },
    { y: hz - 14, x0: cx0 + Math.round(W * 0.1), depth: 0.8 },
    { y: hz - 23, x0: cx0 + Math.round(W * 0.22), depth: 0 },
  ];
  const banners = [];
  // back to front: highest terrace first
  for (const tier of [...tiers].reverse()) {
    for (let x = tier.x0; x < cx1; x++) {
      const merlon = Math.floor((x - tier.x0) / 2) % 2 === 0 ? 2 : 0;
      const buttress = (x - tier.x0) % 17 < 3;
      for (let y = tier.y - merlon; y < hz + 4; y++) {
        const lit = y < tier.y + 1 || !buttress;
        R.set(x, y, stone(x, y, lit && y - tier.y < 9, tier.depth + (y - tier.y) * 0.05));
      }
    }
    // towers along the wall
    for (let x = tier.x0; x < cx1; x += 31 + Math.floor(hash2(x, 3, 5) * 12)) {
      const th = 9 + Math.floor(hash2(x, 4, 5) * 7);
      for (let i = 0; i < 6; i++)
        for (let y = tier.y - th; y < tier.y + 2; y++)
          R.set(x + i, y, stone(x + i, y, i < 4, tier.depth));
      // cone roof
      for (let j = 0; j < 4; j++)
        for (let i = j; i < 6 - j + (j ? 0 : 0); i++)
          R.set(x + i, tier.y - th - 1 - j, i < 3 ? INK[8] : INK[6]);
      // a long crimson banner down the tower's face
      for (let y = tier.y - th + 3; y < tier.y - 1; y++) {
        R.set(x + 1, y, BLD[3]);
        R.set(x + 2, y, BLD[2]);
      }
      banners.push({ x: x + 1, y: tier.y - 1 });
    }
  }
  // Domes between the terraces.
  for (let i = 0; i < Math.round(W / 60); i++) {
    const x = Math.round(cx0 + W * 0.26 + rng() * (W * 0.5));
    const r = 4 + Math.floor(rng() * 3);
    const y = tiers[2].y - 1;
    for (let dy = -r; dy <= 0; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r)
          R.set(x + dx, y + dy, dx < -r * 0.2 ? INK[11] : dx < r * 0.4 ? INK[10] : INK[8]);
    R.set(x, y - r - 1, EMB[4]);
    R.set(x, y - r - 2, EMB[4]);
  }
  // The cathedral: a nave, two flanking spires and the great spire, kept out of the title.
  const spireTop = Math.max(
    cathX > titleZone.x0 && cathX < titleZone.x1 ? titleZone.y1 + 6 : 8,
    hz - Math.round(H * (wide ? 0.42 : 0.3)),
  );
  const naveY = tiers[2].y - 16;
  for (let x = cathX - 13; x <= cathX + 13; x++)
    for (let y = naveY + Math.abs(x - cathX) * 0.35; y < tiers[2].y + 1; y++)
      R.set(x, y, stone(x, y, x < cathX + 4, 0));
  const spire = (sx, top, halfBase) => {
    for (let y = top; y < naveY + 4; y++) {
      const half = Math.min(halfBase, ((y - top) / 9) * halfBase + 0.4);
      for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
        if (Math.abs(dx) > half) continue;
        R.set(sx + dx, y, dx <= 0 ? INK[11] : INK[8]);
      }
    }
    R.set(sx, top - 1, EMB[4]);
    R.set(sx, top - 2, EMB[5]);
    R.set(sx - 1, top - 2, EMB[4]);
    R.set(sx + 1, top - 2, EMB[4]);
    R.set(sx, top - 3, EMB[4]);
  };
  spire(cathX - 10, spireTop + Math.round((naveY - spireTop) * 0.45), 2);
  spire(cathX + 10, spireTop + Math.round((naveY - spireTop) * 0.45), 2);
  spire(cathX, spireTop, 3);
  // rose window and tall lancets
  for (const [dx, dy] of circlePixels(3)) R.set(cathX + dx, naveY + 7 + dy, BLD[3]);
  R.set(cathX, naveY + 7, EMB[4]);
  for (const dx of [-9, -6, 6, 9])
    for (let j = 0; j < 6; j++) R.set(cathX + dx, naveY + 9 + j, INK[5]);

  // The white fields and the processional road to the gate.
  const land = profile(W, (x) => hz + 3 + (noise.fbm1(x * 0.02 + 9, 2) - 0.5) * 3);
  fillLayer(R, land, BLEACH_STONE, { base: 4.6, haze: -1.2, hazeSpan: 70 });
  const gate = { x: cx0 + Math.round(W * (wide ? 0.16 : 0.3)), y: hz + 3 };
  const foot = { x: W * (wide ? 0.4 : 0.42), y: H };
  for (let y = gate.y; y < H; y++) {
    const t = (y - gate.y) / (H - gate.y);
    const cx = gate.x + (foot.x - gate.x) * t;
    const half = 1.5 + t * W * (wide ? 0.09 : 0.17);
    for (let x = 0; x < W; x++) {
      const off = x - cx;
      if (Math.abs(off) <= half) {
        R.set(x, y, pick(BLEACH_STONE, 6.4 - t * 2.4, x, y));
        continue;
      }
      // furrows fan away from the road
      const furrow = Math.floor((off / (half + 2)) * 3);
      const next = Math.floor(((off + 1) / (half + 2)) * 3);
      if (furrow !== next && y > land[x] + 1) R.set(x, y, pick(BLEACH_STONE, 3 - t * 1.4, x, y));
    }
    // gate arch
  }
  for (let j = 0; j < 7; j++)
    for (let i = -2; i <= 2; i++)
      if (j > 0 || Math.abs(i) < 2) R.set(gate.x + i, gate.y - j, INK[3]);
  // Standards lining the road, shrinking toward the gate.
  const flags = [];
  for (const t of [0.14, 0.24, 0.37, 0.54, 0.76]) {
    const y = Math.round(gate.y + (H - gate.y) * t);
    const cx = gate.x + (foot.x - gate.x) * t;
    const half = 1.5 + t * W * (wide ? 0.09 : 0.17);
    const h = Math.round(5 + t * 26);
    for (const side of [-1, 1]) {
      const x = Math.round(cx + side * (half + 2 + t * 4));
      for (let j = 0; j < h; j++) R.set(x, y - j, INK[2]);
      const fw = Math.max(2, Math.round(2 + t * 5));
      const fh = Math.max(2, Math.round(2 + t * 7));
      for (let j = 0; j < fh; j++)
        for (let i = 1; i <= fw; i++) R.set(x + i, y - h + 1 + j, i === fw ? BLD[2] : BLD[3]);
      flags.push({ x: x + fw, y: y - h + 1, h: fh });
    }
  }

  // Foreground: two standing stones of the old faith, dark against the white.
  const fgY = wide ? H * 0.8 : H * 0.88;
  const fg = profile(W, (x) => fgY + (noise.fbm1(x * 0.03 + 60, 3) - 0.5) * 10);
  fillLayer(R, fg, [INK[1], INK[2], INK[3]], { base: 0.8, rim: 1, haze: -0.6, hazeSpan: 10 });
  for (const [u, hgt, lean] of [
    [0.07, 0.3, 0.12],
    [0.93, 0.24, -0.1],
  ]) {
    const bx = Math.round(W * u);
    const sh = Math.round(H * hgt * (wide ? 0.75 : 0.6));
    const by = Math.round(fg[clamp(bx, 0, W - 1)]) + 3;
    for (let j = 0; j < sh; j++) {
      const half = 5 - (j / sh) ** 2 * 3 + (hash2(j >> 2, 0, 31) - 0.5) * 1.4;
      const ox = Math.round(j * lean);
      for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++)
        if (Math.abs(dx) <= half) R.set(bx + ox + dx, by - j, dx < -half + 1.5 ? INK[4] : INK[1]);
    }
  }

  // --- animation ---
  const motes = [];
  for (let i = 0; i < Math.round((W * H) / 3800); i++)
    motes.push({ x: rng() * W, y: rng() * H, p: rng() * 6.28, v: 0.4 + rng() * 0.8 });
  return (t, out) => {
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      const ph = Math.floor(t / 240 + i) % 3;
      if (ph === 1) out.push([f.x + 1, f.y + 1, 1, Math.max(1, f.h - 2), BLD[3]]);
      if (ph === 2) out.push([f.x, f.y, 1, 1, INK[9]]);
    }
    for (let i = 0; i < banners.length; i++) {
      const b = banners[i];
      if (Math.floor(t / 400 + i * 2) % 3 === 0) out.push([b.x + 1, b.y, 1, 1, BLD[3]]);
    }
    // petals of ash-white on a slow wind
    for (const m of motes) {
      const x = Math.round((m.x + t * 0.008 * m.v) % (W + 6)) - 3;
      const y = Math.round(((m.y + t * 0.004 * m.v + Math.sin(t * 0.001 + m.p) * 5) % H) + H) % H;
      out.push([x, y, 1, 1, y < hz ? INK[11] : INK[10]]);
    }
  };
}

// ---------------------------------------------------------------------------
// Act IV — Ashen Frontier · Ashfall
// ---------------------------------------------------------------------------
const ASH_SKY = [INK[0], INK[1], INK[2], BLD[0], BLD[1], BLD[2], BLD[3], EMB[3]];
const ASH_ROCK = [INK[0], INK[1], INK[2], INK[3], BLD[0], BLD[1], BLD[2]];

function paintAct4(R, ctx) {
  const { W, H, hz, wide, noise, rng } = ctx;
  const n = ASH_SKY.length - 1;
  const vx = Math.round(W * (wide ? 0.87 : 0.66));
  const VH = Math.round(wide ? H * 0.34 : H * 0.2);
  const crater = { x: vx, y: hz - VH };
  fillSky(R, ASH_SKY, (x, y) => {
    const t = clamp(y / hz, 0, 1.2);
    const d = Math.hypot((x - crater.x) * 0.8, y - crater.y);
    const glow = 3.4 * Math.exp(-d / (H * (wide ? 0.2 : 0.11)));
    const low = t ** 2.4 * 4.4;
    const band = (noise.fbm2(x * 0.01, y * 0.07, 4) - 0.5) * 2.2 * (0.4 + t);
    return clamp(0.6 + low + glow + band, 0, n);
  });
  // The plume: rises from the crater and shears off downwind (left), lit from below.
  for (let y = 0; y <= crater.y; y++)
    for (let x = 0; x < W; x++) {
      const up = clamp((crater.y - y) / Math.max(1, crater.y), 0, 1);
      const cxp = crater.x - up ** 1.5 * W * (wide ? 0.5 : 0.7);
      const width = 5 + up ** 0.7 * W * (wide ? 0.16 : 0.34);
      const off = (x - cxp) / width;
      const body = 1 - off * off + (noise.fbm2(x * 0.04, y * 0.05 + 20, 4) - 0.5) * 1.3;
      if (body < 0.35) continue;
      const lit = (1 - up) ** 2 * 2.6 + (off > 0.2 ? 0.6 : 0);
      const L = 1.6 + lit + (noise.fbm2(x * 0.07, y * 0.09, 3) - 0.5) * 1.6;
      // dither the plume's edge into the sky
      if (body < 0.55 && bayer(x, y) > (body - 0.35) / 0.2) continue;
      R.set(x, y, pick(ASH_SKY, clamp(L, 0.5, 5.2), x, y));
    }
  // The Hollow Sun, red through the ash.
  const sun = wide ? { x: W * 0.1, y: H * 0.2 } : { x: W * 0.2, y: H * 0.3 };
  hollowSun(R, noise, Math.round(sun.x), Math.round(sun.y), wide ? 13 : 14, {
    ring: BLD[4],
    hot: EMB[5],
    corona: [BLD[2], BLD[3]],
    reach: 22,
  });

  // Jagged far ridges, rim-lit by the mountain.
  const far = profile(W, (x) => hz - 3 - noise.ridge1(x * 0.02 + 5, 3) * 20 * (wide ? 0.8 : 1.2));
  fillLayer(R, far, ASH_ROCK, {
    base: 2.2,
    rim: 3.4,
    rimDepth: 1,
    light: -1,
    haze: 1.6,
    hazeSpan: 16,
  });

  // The mountain.
  const halfW = VH * (wide ? 1.9 : 1.7);
  const cone = profile(W, (x) => {
    const dx = Math.abs(x - vx);
    if (dx < 5) return hz - VH + 2 + (noise.n1(x * 0.9) - 0.5) * 2;
    const s = clamp(1 - (dx - 5) / halfW, 0, 1);
    // concave flanks: steep at the summit, long skirts; a shoulder on the left
    const shoulder = 0.1 * Math.exp(-(((x - vx + VH * 0.9) / (VH * 0.3)) ** 2));
    return (
      hz +
      4 -
      (VH + 2) * (s ** 2.6 * 0.82 + s * 0.18 + shoulder) +
      (noise.fbm1(x * 0.11, 3) - 0.5) * 5 * (1 - s) * s * 3
    );
  });
  for (let x = 0; x < W; x++) {
    const y0 = Math.round(cone[x]);
    for (let y = Math.max(0, y0); y < hz + 6; y++) {
      // gullies run down from the summit; faces toward the crater catch its light
      const a = (x - vx) / Math.max(4, y - crater.y + 6);
      const gully = noise.n1(a * 7 + 3) - 0.5;
      const heat = Math.exp(-Math.hypot(x - vx, y - crater.y) / (VH * 0.5));
      let L = 1.3 + gully * 2.2 + heat * 2.6 + (y === y0 ? 1.2 : 0);
      if (x > vx) L -= 0.5;
      R.set(x, y, pick(ASH_ROCK, clamp(L, 0, 6), x, y));
    }
  }
  // crater glow on the lip, and lava running down the flanks
  for (let dx = -4; dx <= 4; dx++) {
    R.set(vx + dx, Math.round(cone[clamp(vx + dx, 0, W - 1)]), EMB[Math.abs(dx) < 3 ? 5 : 4]);
    R.set(vx + dx, Math.round(cone[clamp(vx + dx, 0, W - 1)]) + 1, BLD[4]);
  }
  const flows = [];
  for (const [dir, bend, len] of [
    [-1, 0.5, 0.8],
    [1, 0.35, 0.55],
    [-1, 0.12, 0.42],
    [1, 0.1, 0.3],
  ]) {
    let x = vx + dir * 2;
    const path = [];
    const steps = Math.round(VH * len);
    for (let i = 0; i < steps; i++) {
      const y = Math.round(cone[clamp(Math.round(x), 0, W - 1)]) + 1 + Math.round(i * 0.25);
      path.push([Math.round(x), y]);
      x += dir * (bend + (i / steps) * 1.1 + (hash2(i, dir, 7) - 0.5) * 0.9);
    }
    for (let i = 0; i < path.length; i++) {
      const [px, py] = path[i];
      const t = i / path.length;
      R.set(px, py, t < 0.25 ? EMB[5] : t < 0.6 ? EMB[4] : BLD[4]);
      R.set(px, py + 1, t < 0.5 ? BLD[4] : BLD[3]);
      if (t < 0.7 && bayer(px, py) > 0.5) R.set(px - dir, py, BLD[2]);
    }
    flows.push(path);
  }

  // The dead plain: cracked, with a seam of fire here and there.
  const land = profile(W, (x) => hz + 4 + (noise.fbm1(x * 0.03 + 12, 3) - 0.5) * 5);
  fillLayer(R, land, ASH_ROCK, { base: 2.6, rim: 0.8, haze: -2, hazeSpan: 60, grain: 0.7 });
  const seams = [];
  for (let i = 0; i < Math.round(W / 18); i++) {
    const t = 0.08 + rng() * 0.6;
    let x = rng() * W;
    let y = hz + 6 + t * (H - hz - 6);
    const len = Math.round(5 + t * 22);
    for (let k = 0; k < len; k++) {
      const hot = hash2(i, k >> 2, 3) > 0.55 && Math.abs(x - vx) < W * 0.45;
      R.set(Math.round(x), Math.round(y), hot ? BLD[3] : INK[0]);
      if (hot && k % 5 === 2) seams.push({ x: Math.round(x), y: Math.round(y) });
      x += 1;
      y += (hash2(i, k, 4) - 0.5) * 1.4;
    }
  }
  // A ruined frontier fort and dead trees.
  const fx = Math.round(W * (wide ? 0.3 : 0.2));
  const fy = Math.round(land[clamp(fx, 0, W - 1)]) + 2;
  for (let x = fx - 26; x < fx + 34; x++) {
    const towerL = x < fx - 14;
    const towerR = x > fx + 24;
    const hgt = towerL
      ? 20 - Math.floor(hash2(x >> 1, 0, 2) * 7)
      : towerR
        ? 13 - Math.floor(hash2(x >> 1, 3, 2) * 4)
        : 8 + (Math.floor((x - fx) / 2) % 2 ? 2 : 0) - Math.floor(hash2(x >> 3, 1, 2) * 5);
    const gap = x > fx + 4 && x < fx + 11;
    for (let j = 0; j < (gap ? 2 : hgt); j++)
      R.set(x, fy - j, x === fx + 34 - 1 || (towerL && x === fx - 15) ? BLD[1] : INK[0]);
  }
  R.rect(fx - 21, fy - 12, 2, 3, BLD[3]);
  const tree = (x, y, h, dir) => {
    for (let j = 0; j < h; j++) R.set(x + Math.round(j * 0.15 * dir), y - j, INK[0]);
    for (const [at, len, d] of [
      [0.5, 4, dir],
      [0.7, 3, -dir],
      [0.85, 3, dir],
    ]) {
      const by = y - Math.round(h * at);
      const bx = x + Math.round(h * at * 0.15 * dir);
      for (let k = 1; k <= len; k++) R.set(bx + k * d, by - Math.round(k * 0.7), INK[0]);
    }
  };
  for (let i = 0; i < Math.round(W / 55); i++) {
    const x = Math.round(rng() * W * 0.62);
    tree(
      x,
      Math.round(land[clamp(x, 0, W - 1)]) + 3 + Math.floor(rng() * 8),
      8 + Math.floor(rng() * 8),
      rng() > 0.5 ? 1 : -1,
    );
  }

  // Foreground: shards of black glass.
  const fgY = wide ? H * 0.8 : H * 0.88;
  const fg = profile(W, (x) => {
    const k = x / 13;
    const saw = Math.abs((k % 1) - 0.5) * 2;
    return fgY + saw * 18 * hash2(Math.floor(k), 0, 23) - 6 + Math.abs(x - W * 0.5) * -0.04;
  });
  fillLayer(R, fg, ASH_ROCK, { base: 0.3, rim: 3.6, rimDepth: 1, light: 1, haze: 0, hazeSpan: 8 });

  // --- animation ---
  const ash = [];
  for (let i = 0; i < Math.round((W * H) / 900); i++)
    ash.push({
      x: rng() * W,
      y: rng() * H,
      p: rng() * 6.28,
      v: 0.5 + rng() * 0.7,
      big: i % 7 === 0,
    });
  const sparks = [];
  for (let i = 0; i < 9; i++)
    sparks.push({ p: rng(), dx: (rng() - 0.5) * 16, v: 0.6 + rng() * 0.6 });
  return (t, out) => {
    for (const a of ash) {
      const y = Math.round((a.y + t * 0.014 * a.v) % (H + 4)) - 2;
      const x =
        Math.round(a.x + Math.sin(t * 0.0009 * a.v + a.p) * 5 - ((t * 0.004 * a.v) % W) + W) % W;
      out.push([x, y, a.big ? 2 : 1, 1, a.big ? INK[8] : y < hz ? INK[6] : INK[7]]);
    }
    for (const s of sparks) {
      const life = (t * 0.00035 * s.v + s.p) % 1;
      const x = Math.round(crater.x + s.dx * life - life * life * 14);
      const y = Math.round(crater.y - life * VH * 0.7);
      if (life < 0.85) out.push([x, y, 1, 1, life < 0.4 ? EMB[5] : life < 0.65 ? EMB[4] : BLD[4]]);
    }
    // the crater breathes
    const breath = Math.floor(t / 320) % 4;
    if (breath === 0)
      out.push([crater.x - 2, Math.round(cone[clamp(vx, 0, W - 1)]) - 1, 5, 1, EMB[5]]);
    if (breath === 2)
      out.push([crater.x - 1, Math.round(cone[clamp(vx, 0, W - 1)]) - 1, 3, 1, EMB[4]]);
    // lava: a bright bead travels down each flow
    for (let i = 0; i < flows.length; i++) {
      const path = flows[i];
      const k = Math.floor((t * 0.012 + i * 9) % (path.length + 12));
      if (k < path.length) out.push([path[k][0], path[k][1], 1, 1, EMB[6]]);
    }
    for (let i = 0; i < seams.length; i++) {
      const s = seams[i];
      if (hash2(Math.floor(t / 420), i, 6) > 0.7) out.push([s.x, s.y, 1, 1, EMB[4]]);
    }
  };
}

// ---------------------------------------------------------------------------
// Final Act — The Imperial Seat · The Deep
// ---------------------------------------------------------------------------
const DEEP_GLOW = [INK[0], INK[1], UNL[0], UNL[1], UNL[2], UNL[3], UNL[4], UNL[5]];

function paintDeep(R, ctx) {
  const { W, H, wide, noise, rng } = ctx;
  const vp = { x: Math.round(W / 2), y: Math.round(H * (wide ? 0.455 : 0.47)) };
  const n = DEEP_GLOW.length - 1;
  const reach = wide ? W * 0.2 : W * 0.52;
  // A wide card carries its title right over the hall: the light dies away above the pit,
  // so the lintels behind the words are shapes in the dark, not a glare.
  const dim = (y) => (wide ? 0.3 + 0.7 * smooth(H * 0.16, vp.y * 0.96, y) : 1);
  fillSky(R, DEEP_GLOW, (x, y) => {
    const d = Math.hypot(
      (x - vp.x) * (wide ? 0.62 : 0.9),
      (y - vp.y) * (wide ? (y < vp.y ? 1.5 : 1.05) : y < vp.y ? 0.8 : 0.7),
    );
    const fog = (noise.fbm2(x * 0.025, y * 0.04, 3) - 0.5) * 1.1;
    return clamp(
      ((n + 0.6) * Math.exp(-d / reach) + fog * Math.exp(-d / (reach * 2.2))) * dim(y),
      0,
      n,
    );
  });

  // The stair: we stand at its head; the treads narrow down into the light.
  const steps = wide ? 15 : 22;
  const stepY = (i) => vp.y + 3 + (H - vp.y) * (i / steps) ** 1.9;
  for (let i = 0; i < steps; i++) {
    const y0 = Math.round(stepY(i));
    const y1 = Math.round(stepY(i + 1));
    const t0 = i / steps;
    for (let y = y0; y < y1 + 1 && y < H; y++) {
      const t = (y - vp.y - 3) / (H - vp.y - 3);
      const half = 5 + t ** 1.1 * W * (wide ? 0.62 : 0.95);
      for (let x = Math.round(vp.x - half); x <= vp.x + half; x++) {
        if (x < 0 || x >= W) continue;
        const riser = y === y0;
        const side = Math.abs(x - vp.x) / half;
        // treads catch the light near the pit and go black toward us
        let L = (riser ? 5.6 : 3.4) * (1 - t0) ** 1.3 - side * side * 1.2;
        if (y === y1) L -= 0.6;
        R.set(x, y, pick(DEEP_GLOW, clamp(L, 0, n), x, y));
      }
    }
  }
  // The pit's mouth.
  for (let dx = -4; dx <= 4; dx++) {
    R.set(vp.x + dx, vp.y + 2, UNL[5]);
    R.set(vp.x + dx, vp.y + 1, Math.abs(dx) < 3 ? UNL[5] : UNL[4]);
    if (Math.abs(dx) < 3) R.set(vp.x + dx, vp.y, UNL[4]);
  }

  // Pillars and lintels receding in pairs: far ones bright with haze, near ones black.
  const depths = wide ? [7, 4.6, 3.1, 2.1, 1.45, 1] : [6, 3.9, 2.6, 1.75, 1.2];
  const spread = W * (wide ? 0.4 : 0.56);
  const floorDrop = (H - vp.y) * 0.92;
  const roof = vp.y + 8;
  depths.forEach((z, k) => {
    const near = 1 - k / (depths.length - 1); // 1 far .. 0 near
    const w = Math.max(2, Math.round((wide ? 34 : 30) / z));
    const off = spread / z;
    const foot = Math.round(vp.y + floorDrop / z);
    const top = Math.round(vp.y - roof / z);
    const body = 0.2 + near * 2.4;
    for (const side of [-1, 1]) {
      const x0 = Math.round(vp.x + side * off - (side < 0 ? w : 0));
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || x >= W) continue;
        const inner = side < 0 ? x0 + w - 1 - x : x - x0; // 0 at the edge facing the pit
        for (let y = Math.max(0, top); y < Math.min(H, foot); y++) {
          const flute = inner > 1 && (inner + 1) % 4 === 0 ? -0.5 : 0;
          const rim = inner === 0 ? 2.4 : inner === 1 ? 1 : 0;
          const fall = Math.exp(-Math.abs(y - vp.y) / (H * 0.3));
          const L = (body + rim * fall * (0.4 + near)) * dim(y) + flute;
          R.set(x, y, pick(DEEP_GLOW, clamp(L, 0, n), x, y));
        }
        // plinth and capital
        for (const [ya, yb] of [
          [foot - Math.max(1, Math.round(5 / z)), foot],
          [top, top + Math.max(1, Math.round(6 / z))],
        ])
          for (let y = Math.max(0, ya); y < Math.min(H, yb); y++) {
            const L = (body + 0.5) * dim(y);
            R.set(x, y, pick(DEEP_GLOW, clamp(L, 0, n), x, y));
            if (inner === 0) R.set(x - side, y, pick(DEEP_GLOW, clamp(L - 0.2, 0, n), x, y));
          }
      }
    }
    // lintel across the pair
    const lh = Math.max(1, Math.round(9 / z));
    for (let y = Math.max(0, top - lh); y < Math.max(0, top); y++)
      for (let x = Math.max(0, Math.round(vp.x - off - w)); x < Math.min(W, vp.x + off + w); x++)
        R.set(
          x,
          y,
          pick(DEEP_GLOW, clamp((body + (y === top - 1 ? 1.2 * near : 0)) * dim(y), 0, n), x, y),
        );
  });

  // Chains from the dark.
  for (let i = 0; i < Math.round(W / 70); i++) {
    const x = Math.round(W * 0.12 + rng() * W * 0.76);
    if (Math.abs(x - vp.x) < W * 0.07) continue;
    const len = Math.round(H * (0.12 + rng() * 0.22));
    for (let y = 0; y < len; y++)
      if (y % 3 !== 2) R.set(x + (y % 6 < 3 ? 0 : 1), y, INK[y % 3 ? 2 : 3]);
    R.set(x, len, INK[4]);
    R.set(x + 1, len + 1, INK[4]);
  }

  // --- animation ---
  const words = [];
  for (let i = 0; i < Math.round(W / 14); i++)
    words.push({ a: rng() * 6.28, r: 0.35 + rng() * 0.65, p: rng(), v: 0.5 + rng() * 0.6 });
  const motes = [];
  for (let i = 0; i < Math.round((W * H) / 4200); i++)
    motes.push({ x: rng() * W, y: rng() * H, p: rng() * 6.28, v: 0.5 + rng() });
  return (t, out) => {
    // every word they speak falls through the floor and never lands
    for (const w of words) {
      const life = (t * 0.00012 * w.v + w.p) % 1;
      const k = (1 - life) ** 1.6;
      const x = Math.round(vp.x + Math.cos(w.a) * w.r * W * 0.5 * k);
      const y = Math.round(vp.y + 1 + (Math.sin(w.a) * 0.5 - 0.55) * w.r * H * 0.42 * k);
      if (life > 0.94) continue;
      out.push([x, y, k > 0.5 ? 2 : 1, 1, k > 0.6 ? EMB[4] : k > 0.25 ? EMB[5] : EMB[6]]);
    }
    for (const m of motes) {
      const y = Math.round((((m.y - t * 0.006 * m.v) % H) + H) % H);
      const x = Math.round(m.x + Math.sin(t * 0.0008 + m.p) * 4);
      const d = Math.hypot(x - vp.x, y - vp.y);
      out.push([x, y, 1, 1, d < reach * 0.9 ? UNL[5] : UNL[3]]);
    }
    const pulse = Math.floor(t / 380) % 4;
    if (pulse === 1) out.push([vp.x - 5, vp.y + 1, 11, 1, UNL[5]]);
    if (pulse === 2) out.push([vp.x - 2, vp.y - 1, 5, 1, UNL[5]]);
  };
}

// ---------------------------------------------------------------------------
// Beyond the Veil — the Hollow Sun, close
// ---------------------------------------------------------------------------
const VEIL_SKY = [INK[0], INK[1], UNL[0], UNL[1], UNL[2], UNL[3]];

function paintVeil(R, ctx) {
  const { W, H, hz, wide, noise, rng, titleZone } = ctx;
  // Wide: the disc fills the upper centre, so the title sits on the Hollow Sun itself.
  const r = wide
    ? Math.round(W * 0.36)
    : Math.round(Math.min(W * 0.44, (hz - titleZone.y1 - 8) / 0.82));
  const sun = { x: Math.round(W / 2), y: Math.round(wide ? hz + r * 0.12 : hz - r * 0.18) };
  const n = VEIL_SKY.length - 1;
  fillSky(R, VEIL_SKY, (x, y) => {
    const d = Math.hypot(x - sun.x, y - sun.y) - r;
    const glow = 3.6 * Math.exp(-Math.max(0, d) / (r * 0.9));
    return clamp(0.3 + glow + (noise.fbm2(x * 0.02, y * 0.02, 3) - 0.5) * 0.8, 0, n);
  });
  stars(R, rng, Math.round((W * H) / 700), hz, [INK[5], INK[7], UNL[4]]);
  hollowSun(R, noise, sun.x, sun.y, r, {
    ring: EMB[5],
    hot: EMB[6],
    corona: [UNL[4], EMB[6]],
    reach: Math.min(r * 0.9, 30),
  });
  // The black mirror: the corona's reflection in broken dashes.
  for (let y = hz; y < H; y++) {
    const d = y - hz;
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - sun.x);
      const band = Math.exp(-dx / (r * (0.75 + d * 0.01))) * Math.exp(-d / (H * 0.22));
      // each row breaks into dashes that lengthen toward us
      const cell = 2 + (d >> 3);
      const wave = hash2(Math.floor((x + (d % 2) * cell) / (cell * 2)), d, 3);
      let c = INK[0];
      if (d < 2 && dx < r * 0.98) c = d ? EMB[4] : EMB[5];
      else if (d % 2 === 0 && band > wave * 0.9 + 0.12)
        c = band > 0.7 ? UNL[4] : band > 0.4 ? UNL[3] : UNL[2];
      else if (d % 4 === 1 && wave > 0.86) c = INK[2];
      R.set(x, y, c);
    }
  }
  for (let x = 0; x < W; x++) R.set(x, hz, x % 2 ? INK[3] : INK[4]);
  // Sera's threads, hanging loose from above.
  const threads = [];
  for (const u of wide ? [0.06, 0.14, 0.9, 0.96] : [0.08, 0.2, 0.84, 0.94]) {
    const x0 = W * u;
    const len = H * (0.3 + rng() * 0.3);
    const sway = (rng() - 0.5) * 24;
    const px = curvePixels(
      bezier([x0, -2], [x0 + sway, len * 0.4], [x0 - sway, len * 0.7], [x0 + sway * 0.4, len]),
      300,
    );
    for (const [x, y] of px) R.set(x, y, EMB[3]);
    threads.push(px);
  }
  return (t, out) => {
    for (let i = 0; i < threads.length; i++) {
      const px = threads[i];
      const k = Math.floor((t * 0.03 + i * 40) % (px.length + 60));
      for (let j = 0; j < 3; j++)
        if (px[k - j]) out.push([px[k - j][0], px[k - j][1], 1, 1, j ? EMB[5] : EMB[6]]);
    }
    const tw = Math.floor(t / 500);
    for (let i = 0; i < 6; i++) {
      const a = hash2(tw, i, 2) * 6.28;
      out.push([
        Math.round(sun.x + Math.cos(a) * r),
        Math.round(sun.y + Math.sin(a) * r),
        1,
        1,
        EMB[6],
      ]);
    }
  };
}

const PAINTERS = {
  act1: paintAct1,
  act2: paintAct2,
  act3: paintAct3,
  act4: paintAct4,
  finalBoss: paintDeep,
  secretAct: paintVeil,
};

const HEX_OF = new Map();
for (const ramp of Object.values(PALETTE)) for (const h of ramp) HEX_OF.set(pack(h), h);

/**
 * Bake one vista (no DOM). Returns the pixel buffer and `rects(timeMs)`: the moving
 * things as `[x, y, w, h, '#hex', alpha?]`, to draw over the buffer each frame.
 */
export function paintActVista({ act, width, height, seed = 7 } = {}) {
  const id = actVistaId(act);
  const W = clamp(Math.round(width) || VISTA_MIN, VISTA_MIN, VISTA_MAX);
  const H = clamp(Math.round(height) || VISTA_MIN, VISTA_MIN, VISTA_MAX);
  const s = (seed >>> 0) + ACT_VISTA_IDS.indexOf(id) * 101;
  const R = new Raster(W, H);
  const layout = vistaLayout(W, H);
  const animate = PAINTERS[id](R, {
    W,
    H,
    ...layout,
    noise: makeNoise(s * 31 + 1),
    rng: mulberry32(s * 7919 + 3),
  });
  return {
    id,
    width: W,
    height: H,
    layout,
    pixels: R.px,
    raster: R,
    rects(timeMs) {
      const raw = [];
      animate(Math.max(0, Number(timeMs) || 0), raw);
      const out = [];
      for (const r of raw) {
        const [x, y, w, h, c, alpha] = r;
        if (x + w <= 0 || y + h <= 0 || x >= W || y >= H) continue;
        out.push([x, y, w, h, HEX_OF.get(c), alpha]);
      }
      return out;
    },
  };
}

/** The time a still vista shows (reduced motion): motes and pennants mid-gesture. */
export const VISTA_FROZEN_TIME = 5200;

/**
 * A vista as a scene the backdrop helper can drive (`render(ctx, timeMs)`), the same
 * contract as createHollowSunScene.
 */
export function createActVistaScene(opts = {}) {
  const plate = paintActVista(opts);
  let reducedMotion = !!opts.reducedMotion;
  let base = plate.raster.toCanvas();
  return {
    id: plate.id,
    width: plate.width,
    height: plate.height,
    layout: plate.layout,
    setReducedMotion(value) {
      reducedMotion = !!value;
    },
    render(ctx, timeMs) {
      if (!base) return;
      ctx.drawImage(base, 0, 0);
      const t = reducedMotion ? VISTA_FROZEN_TIME : timeMs;
      for (const [x, y, w, h, hex, alpha] of plate.rects(t)) {
        // The one flash (far lightning) is a wash; reduced motion never shows it.
        if (alpha != null) {
          if (reducedMotion) continue;
          ctx.globalAlpha = alpha;
        }
        ctx.fillStyle = hex;
        ctx.fillRect(x, y, w, h);
        if (alpha != null) ctx.globalAlpha = 1;
      }
    },
    destroy() {
      if (base) base.width = base.height = 0;
      base = null;
    },
  };
}

export default createActVistaScene;
