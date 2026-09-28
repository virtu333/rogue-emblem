// "The Ford", the layout reel: the whole fight seen side-on on a flat camera, as gesture
// figures on a cross-section of the river. Step 2 of the fight-design method: before any
// dynamic camera, plan every position, every step and who holds the initiative. Everything
// here is drawn from ford_blocking.js (the single source of truth); nothing is invented.
//
// The camera pans and pushes slowly to keep both fighters in frame and never cuts. The
// caption is the FORD.md shot that the final piece will shoot over the same moment.

import { Piece } from './engine/piece.js';
import { BAR, KIT } from './engine/score.js';
import { RGB, put, dput, splash, sparks, star, stroke } from './engine/anime.js';
import { bayer, clamp, lerp, smooth } from './engine/raster.js';
import {
  ACTORS,
  DURATION as BLOCK_DURATION,
  LINE,
  MUSIC_OFFSET,
  STONES,
  TIME,
  at,
  bedY,
  BIND_SPAN,
  bindPoint,
  events,
  initiative,
  skeletonAt,
  spearTip,
  waterDepth,
} from './ford_blocking.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 28;
export const DURATION = at(37); // 13.6 s
export { BAR, MUSIC_OFFSET, at };

// the palette, all on the art bible's ramps
const C = {
  ink: RGB.ink,
  sepia: RGB.sepia,
  grey: [0x76, 0x6b, 0x77],
  greyLo: [0x97, 0x8b, 0x94],
  paper: RGB.paper,
  paperHi: RGB.paperHi,
  steel: RGB.steel,
  steelMid: RGB.steelMid,
  steelDeep: [0x2c, 0x4c, 0x77],
  teal: [0x4d, 0x8b, 0x66],
  tealDeep: [0x2d, 0x64, 0x50],
  crimson: RGB.crimson,
  blood: [0x9e, 0x26, 0x32],
  stone: [0x7a, 0x7a, 0x80],
  stoneDeep: [0x40, 0x41, 0x4a],
  earth: [0x93, 0x8c, 0x55],
  gold: RGB.gold,
};

// ------------------------------------------------------------------ the FORD.md shots

const SHOT_TABLE = [
  [at(28, 3), 'THE RUSH DOWN THE THREAD'],
  [at(29, 1), 'CRANE DOWN TO THE FORD'],
  [at(30, 1), "THE WARDEN'S BOOTS IN THE SHALLOWS"],
  [at(30, 3), 'THE SPEAR LEVELS AT THE LENS'],
  [at(31, 1), 'EDRIC RUNS THE FORD'],
  [at(31, 4), 'THE EYE, THE POINT IN IT'],
  [at(32, 1), 'OVER THE SHOULDER: THRUST'],
  [at(32, 3), 'THE SLIDE, THE SPRAY SHEET'],
  [at(32, 4), 'THREE SIXTEENTH CUTS'],
  [at(33, 1), 'THE CLASH'],
  [at(33, 3), 'THE BIND'],
  [at(34, 3), 'THE HELM: HE DECIDES'],
  [at(35, 1), 'THE YIELD: CROSSING THE LINE'],
  [at(35, 3), 'THE CRIMSON CUT'],
  [at(35, 4), "EDRIC'S FACE, THE SPRAY HANGING"],
  [at(36, 1), 'THE FALL, THE PAINT LIFTS'],
]
  .map(([from, name]) => [Math.round(from * 1e6) / 1e6, name]) // bar arithmetic: 7.200000000000003 is 7.2
  .map(([from, name], i, a) => ({
    n: i + 1,
    name,
    from,
    to: i + 1 < a.length ? a[i + 1][0] : DURATION,
  }));

export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));

// ------------------------------------------------------------------ pixel font (3x5)

const GLYPHS = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  0: '111101101101111',
  1: '010110010010111',
  2: '110001010100111',
  3: '110001010001110',
  4: '101101111001001',
  5: '111100110001110',
  6: '011100111101111',
  7: '111001010010010',
  8: '111101111101111',
  9: '111101111001110',
  ':': '000010000010000',
  '.': '000000000000010',
  '-': '000000111000000',
  '/': '001001010100100',
  "'": '010010000000000',
  '+': '000010111010000',
  ',': '000000000010100',
  '(': '010100100100010',
  ')': '010001001001010',
  '?': '110001010000010',
  '!': '010010010000010',
  '=': '000111000111000',
  '>': '100010001010100',
  '<': '001010100010001',
  '%': '101001010100101',
  ' ': '000000000000000',
};
const textWidth = (s, k = 1) => s.length * 4 * k - k;
function text(f, x, y, s, c, k = 1, halo = null) {
  const draw = (ox, oy, col) => {
    let cx = x + ox;
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch] || GLYPHS['?'];
      for (let i = 0; i < 15; i++)
        if (g[i] === '1') {
          const gx = cx + (i % 3) * k;
          const gy = y + oy + Math.floor(i / 3) * k;
          for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) put(f, W, H, gx + a, gy + b, col);
        }
      cx += 4 * k;
    }
  };
  if (halo)
    for (const [ox, oy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      draw(ox, oy, halo);
  draw(0, 0, c);
}

// ------------------------------------------------------------------ drawing primitives

function disc(f, cx, cy, r, c, a = 1) {
  const R = Math.max(0.5, r);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R + 0.3) put(f, W, H, x, y, c, a);
}
function line(f, x0, y0, x1, y1, w, c, a = 1) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(L * 1.3));
  if (w <= 1.2) {
    for (let i = 0; i <= n; i++)
      put(f, W, H, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, a);
    return;
  }
  for (let i = 0; i <= n; i++)
    disc(f, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, w / 2, c, a);
}
function dline(f, x0, y0, x1, y1, c, on = 3, off = 3, a = 1) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(L);
  for (let i = 0; i <= n; i++)
    if (i % (on + off) < on) put(f, W, H, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, a);
}
function ring(f, cx, cy, rx, ry, c, a = 1, dith = 1) {
  const n = Math.ceil(Math.max(rx, ry) * 6);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(th) * rx;
    const y = cy + Math.sin(th) * ry;
    if (dith >= 1 || dith > bayer(x | 0, y | 0)) put(f, W, H, x, y, c, a);
  }
}

// ------------------------------------------------------------------ the flat camera

const camS = keyedCam([
  [0, 17],
  [3.4, 17],
  [4.4, 27],
  [5.4, 38],
  [6.6, 48],
  [7.4, 60],
  [9.6, 64],
  [10.6, 58],
  [11.4, 54],
  [12.4, 52],
  [13.6, 50],
]);
const camX = keyedCam([
  [0, -1.0],
  [3.4, -1.0],
  [4.4, 0.3],
  [5.4, 0.6],
  [6.6, 1.8],
  [7.4, 3.2],
  [10.0, 3.7],
  [11.2, 4.1],
  [12.4, 4.5],
  [13.6, 4.5],
]);
function keyedCam(keys) {
  // smooth (C1) interpolation: the flat camera glides, it never snaps
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++)
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return lerp(v0, v1, smooth(0, 1, (t - t0) / (t1 - t0)));
      }
    return keys[keys.length - 1][1];
  };
}
const GROUND_Y = 172; // the water surface, on screen
const RULER_Y = 226;
const view = (t) => {
  const s = camS(t);
  const cx = camX(t);
  return { s, cx, X: (x) => W / 2 + (x - cx) * s, Y: (y) => GROUND_Y - y * s };
};

// ------------------------------------------------------------------ the river, in section

function groundLayer(f, V) {
  const { s, cx } = V;
  let prev = null;
  for (let px = 0; px < W; px++) {
    const X = cx + (px - W / 2) / s;
    const yTop = V.Y(bedY(X));
    // earth below the line: dithered stone-grey, with a darker crust just under it
    for (let y = Math.max(0, Math.floor(yTop)); y < RULER_Y - 4; y++) {
      const depth = y - yTop;
      if (depth < 2) put(f, W, H, px, y, C.stoneDeep);
      else dput(f, W, H, px, y, depth < 9 ? C.stone : C.greyLo, depth < 9 ? 0.4 : 0.2);
    }
    if (prev !== null) line(f, px - 1, prev, px, yTop, 2, C.ink);
    prev = yTop;
  }
}

/** Stones on the cross-section: the ford's line is solid, off-line and upstream ones are ghosts. */
function stonesLayer(f, V) {
  for (const st of STONES) {
    const near = Math.abs(st.z) <= 0.3;
    const x0 = V.X(st.x - st.w / 2);
    const x1 = V.X(st.x + st.w / 2);
    if (x1 < 0 || x0 > W) continue;
    const bed = bedY(st.x);
    for (let px = Math.floor(x0); px <= Math.ceil(x1); px++) {
      const dx = (2 * (px - V.X(st.x))) / (x1 - x0);
      if (Math.abs(dx) >= 1) continue;
      const crown = bed + (st.top - bed) * Math.sqrt(1 - dx ** 4);
      for (let y = Math.floor(V.Y(crown)); y <= V.Y(bedY(st.x + (px - V.X(st.x)) / V.s)); y++) {
        if (near) put(f, W, H, px, y, st.slick ? C.stone : C.stoneDeep);
        else dput(f, W, H, px, y, C.stone, st.z < 0 ? 0.22 : 0.4);
      }
      put(f, W, H, px, V.Y(crown), near ? C.ink : C.grey);
    }
    if (st.slick) {
      // the slick one: a wet sheen
      for (let k = 0; k < 3; k++)
        line(
          f,
          V.X(st.x - 0.2 + k * 0.14),
          V.Y(st.top) + 1,
          V.X(st.x - 0.08 + k * 0.14),
          V.Y(st.top) + 1,
          1,
          C.steel,
        );
      if (V.s > 30) text(f, V.X(st.x) - 10, V.Y(bedY(st.x)) + 8, 'SLICK', C.paperHi, 1);
    }
  }
}

/** The water in front of everything: knee-deep, so the wading shows. */
function waterLayer(f, V, t) {
  const { s, cx } = V;
  for (let px = 0; px < W; px++) {
    const X = cx + (px - W / 2) / s;
    const d = waterDepth(X);
    if (d <= 0.005) continue;
    const yb = V.Y(-d);
    for (let y = GROUND_Y; y <= yb; y++)
      dput(f, W, H, px, y, y < GROUND_Y + 3 ? C.steelMid : C.steel, y < GROUND_Y + 3 ? 0.5 : 0.26);
  }
  // the surface: a live line, and a few glints
  const wave = (px) => Math.sin(px * 0.11 + t * 4) * 0.6 + Math.sin(px * 0.037 - t * 2.3) * 0.5;
  for (let px = 0; px < W; px++) {
    const X = cx + (px - W / 2) / s;
    if (waterDepth(X) <= 0.005) continue;
    put(f, W, H, px, GROUND_Y + wave(px), C.steelDeep);
    if ((px * 7 + Math.floor(t * 12)) % 23 === 0)
      line(f, px, GROUND_Y + 2, px + 4, GROUND_Y + 2, 1, C.paperHi);
  }
}

/** The metre ruler along the bottom, and the world's landmarks. */
function ruler(f, V) {
  line(f, 0, RULER_Y, W, RULER_Y, 1, C.ink);
  const x0 = Math.floor(V.cx - W / 2 / V.s);
  const x1 = Math.ceil(V.cx + W / 2 / V.s);
  for (let X = x0; X <= x1; X++) {
    const px = V.X(X);
    const big = X % 5 === 0;
    line(f, px, RULER_Y, px, RULER_Y + (big ? 5 : 3), 1, C.ink);
    if (X % 2 === 0 || V.s > 36) {
      const lab = `${X > 0 ? '+' : ''}${X}`;
      text(f, px - textWidth(lab) / 2, RULER_Y + 7, lab, X === 0 ? C.crimson : C.sepia);
    }
    if (big) dline(f, px, GROUND_Y - 62 * 0, px, RULER_Y - 1, C.greyLo, 1, 5, 0.7);
  }
  for (const X of [-8, 8]) {
    const px = V.X(X);
    if (px > -30 && px < W + 30) {
      line(f, px, RULER_Y - 5, px, RULER_Y, 1.5, C.steelDeep);
      text(f, clamp(px - 22, 2, W - 46), RULER_Y - 12, 'WATERS EDGE', C.steelDeep);
    }
  }
}

// ------------------------------------------------------------------ the figures

const STYLE = {
  edric: { ink: C.ink, far: C.grey, accent: C.teal, accentDeep: C.tealDeep },
  warden: { ink: C.ink, far: C.grey, accent: C.crimson, accentDeep: C.blood },
  line: { ink: C.grey, far: C.greyLo, accent: C.greyLo, accentDeep: C.grey },
};

function figure(f, V, name, t, kind = name) {
  const sk = skeletonAt(name, t);
  const st = STYLE[kind];
  const S = (p) => [V.X(p[0]), V.Y(p[1])];
  const s = V.s;
  const thin = kind === 'line';
  const lw = clamp(0.058 * s * (thin ? 0.7 : 1), 1.4, 3.4);
  const tw = clamp(0.1 * s * (thin ? 0.7 : 1), 2, 5.4);
  const fl = sk.facing;
  const limb = (a, b, c, col, w) => {
    const A = S(a);
    const B = S(b);
    const Cc = S(c);
    line(f, A[0], A[1], B[0], B[1], w, col);
    line(f, B[0], B[1], Cc[0], Cc[1], w, col);
  };
  const foot = (leg, col, w) => {
    const A = S(leg.foot);
    const B = S(leg.toe);
    line(f, A[0], A[1], B[0], B[1], w, col);
  };
  // the plumb line: is the weight over the feet?
  if (!thin) {
    const hp = S(sk.hips);
    const gy = V.Y(bedY(sk.hips[0]));
    dline(f, hp[0], hp[1], hp[0], gy, st.accent, 1, 3, 0.8);
    line(f, hp[0] - 2, gy, hp[0] + 2, gy, 1, st.accent);
  }
  // the scarf / cape: trails opposite to the neck's motion (follow-through)
  {
    const prev = skeletonAt(name, t - 0.06);
    const vx = (sk.neck[0] - prev.neck[0]) / 0.06;
    const vy = (sk.neck[1] - prev.neck[1]) / 0.06;
    let p = [sk.neck[0] - sk.facing * 0.05, sk.neck[1] - 0.03];
    const seg = kind === 'warden' ? 0.16 : 0.13;
    const n = thin ? 0 : 6;
    let ang = Math.atan2(-vy * 0.16 - 0.5, -vx * 0.16 - sk.facing * 0.4);
    for (let i = 0; i < n; i++) {
      ang += Math.sin(t * 13 - i * 0.9) * 0.16;
      const q = [
        p[0] + Math.cos(ang) * seg,
        Math.max(bedY(p[0]) + 0.03, p[1] + Math.sin(ang) * seg - 0.012 * i),
      ];
      const A = S(p);
      const B = S(q);
      line(f, A[0], A[1], B[0], B[1], clamp(lw * (1.5 - i * 0.16), 1, 4), st.accent);
      p = q;
    }
  }
  // far limbs, then the trunk and head, then the near limbs, then the weapon
  const fa = sk.arms.F;
  limb(sk.legs.F.knee, sk.legs.F.knee, sk.legs.F.foot, st.far, 1);
  limb(sk.hips, sk.legs.F.knee, sk.legs.F.foot, st.far, lw);
  foot(sk.legs.F, st.far, lw);
  limb(sk.shoulder, fa.elbow, fa.hand, st.far, lw);
  const hips = S(sk.hips);
  const spine = S(sk.spine);
  const neck = S(sk.neck);
  line(f, hips[0], hips[1], spine[0], spine[1], tw + 2, st.ink);
  line(f, spine[0], spine[1], neck[0], neck[1], tw + 2, st.ink);
  line(f, hips[0], hips[1], spine[0], spine[1], tw, st.accent);
  line(f, spine[0], spine[1], neck[0], neck[1], tw, st.accent);
  const hc = S(sk.head);
  const hr = Math.max(2.2, sk.headR * s);
  if (kind === 'warden') {
    disc(f, hc[0], hc[1], hr + 1, C.ink);
    line(
      f,
      hc[0] + fl * hr * 0.1,
      hc[1] - hr * 0.05,
      hc[0] + fl * hr * 0.9,
      hc[1] - hr * 0.05,
      1,
      C.crimson,
    );
    line(f, hc[0], hc[1] - hr, hc[0] - fl * hr * 1.6, hc[1] - hr * 1.4, 1.5, C.crimson);
  } else {
    disc(f, hc[0], hc[1], hr + 1, thin ? C.grey : C.ink);
    disc(f, hc[0], hc[1], hr - 0.4, C.paperHi);
    if (!thin) disc(f, hc[0] - fl * hr * 0.35, hc[1] - hr * 0.3, hr * 0.62, st.accent);
  }
  limb(sk.hips, sk.legs.N.knee, sk.legs.N.foot, st.ink, lw + 0.6);
  foot(sk.legs.N, st.ink, lw + 0.6);
  const na = sk.arms.N;
  limb(sk.shoulder, na.elbow, na.hand, st.ink, lw + 0.4);
  // the weapon, in the hands
  const wp = sk.weapon;
  const b = S(wp.butt);
  const tp = S(wp.tip);
  if (wp.kind === 'sword') {
    line(f, b[0], b[1], tp[0], tp[1], 3.4, C.ink);
    line(f, b[0], b[1], tp[0], tp[1], 1.6, C.steel);
    const R = S(wp.rear);
    const nx = -wp.dir[1];
    const ny = wp.dir[0];
    line(
      f,
      R[0] + nx * 0.1 * s,
      R[1] - ny * 0.1 * s,
      R[0] - nx * 0.1 * s,
      R[1] + ny * 0.1 * s,
      2,
      C.ink,
    );
  } else {
    const hd = 0.34;
    const base = S([wp.tip[0] - wp.dir[0] * hd, wp.tip[1] - wp.dir[1] * hd]);
    line(f, b[0], b[1], base[0], base[1], thin ? 1.6 : 2.2, thin ? C.grey : C.sepia);
    const nx = -(tp[1] - base[1]);
    const ny = tp[0] - base[0];
    const nl = Math.hypot(nx, ny) || 1;
    const wd = 0.05 * s;
    for (let k = -1; k <= 1; k += 0.5)
      line(
        f,
        base[0] + (nx / nl) * wd * k,
        base[1] + (ny / nl) * wd * k,
        tp[0],
        tp[1],
        1.4,
        thin ? C.greyLo : C.steel,
      );
    line(f, base[0] + (nx / nl) * wd, base[1] + (ny / nl) * wd, tp[0], tp[1], 1, C.ink);
    line(f, base[0] - (nx / nl) * wd, base[1] - (ny / nl) * wd, tp[0], tp[1], 1, C.ink);
  }
  const R = S(wp.rear);
  disc(f, R[0], R[1], 2, st.ink);
  if (wp.lead) {
    const L = S(wp.lead);
    disc(f, L[0], L[1], 2, st.ink);
  }
  return sk;
}

// ------------------------------------------------------------------ marks and effects

const easeOut3 = (u) => 1 - (1 - clamp(u)) ** 3;

/** Footprints (where each foot was set down), the hips' trail (its spacing is the speed), the reach. */
function marks(f, V, t) {
  // where feet went down: a tick on the bed, fading
  for (const e of events('footfall')) {
    if (e.actor.startsWith('line') || t < e.t || t - e.t > 2.0) continue;
    const st = STYLE[e.actor];
    const px = V.X(e.x);
    const py = V.Y(bedY(e.x)) + 3;
    const k = 1 - (t - e.t) / 2.0;
    if (k > bayer(px | 0, py | 0) * 0.9) {
      line(f, px, py, px, py + 3, 1, st.accent);
      put(f, W, H, px - 1, py + 3, st.accent);
      put(f, W, H, px + 1, py + 3, st.accent);
    }
  }
  // the hips' trail: a dot every 0.1 s for the last second
  for (const nm of ['edric', 'warden']) {
    for (let k = 1; k <= 10; k++) {
      const tt = Math.floor(t * 10) / 10 - k * 0.1;
      if (tt < 0) break;
      const p = skeletonAt(nm, tt).hips;
      if (1 - k / 11 > bayer((k * 3) | 0, (k * 5) | 0))
        disc(f, V.X(p[0]), V.Y(p[1]), 1, STYLE[nm].accent, 0.85);
    }
  }
  // the spear's reach: a dotted arc from the hands, from the level to the last thrust
  if (t >= TIME.level && t <= 7.6) {
    const sk = skeletonAt('warden', t);
    const w = sk.weapon;
    const g = w.lead || w.rear;
    const c = [(w.rear[0] + g[0]) / 2, (w.rear[1] + g[1]) / 2];
    const R = 2.6;
    const a = smooth(TIME.level, TIME.level + 0.3, t) * (1 - smooth(7.2, 7.6, t));
    for (let k = -14; k <= 14; k++) {
      const th = k * 0.045;
      const x = V.X(c[0] - Math.cos(th) * R);
      const y = V.Y(c[1] + Math.sin(th) * R);
      if (k % 2 === 0 && a > bayer(x | 0, y | 0)) put(f, W, H, x, y, C.crimson);
    }
    if (a > 0.5) {
      // the reach, dimensioned: hands to the farthest point the thrust can touch
      const x0 = V.X(c[0]);
      const x1 = V.X(c[0] - R);
      const yy = V.Y(-0.75);
      line(f, x0, yy, x1, yy, 1, C.crimson);
      line(f, x1, yy - 3, x1, yy + 3, 1, C.crimson);
      line(f, x0, yy - 3, x0, yy + 3, 1, C.crimson);
      text(f, (x0 + x1) / 2 - 8, yy + 5, '2.6M', C.crimson);
    }
  }
  // the point's trail during the thrust and recovery
  if (t >= 5.85 && t <= 6.9)
    for (let k = 0; k < 8; k++) {
      const tt = t - k * 0.03;
      if (tt < 5.85) break;
      const p = spearTip(tt);
      if (1 - k / 8 > bayer(k * 5, k * 3)) disc(f, V.X(p.x), V.Y(p.y), 1.2, C.crimson, 0.9);
    }
}

function effects(f, V, t) {
  const s = V.s;
  // footfall splashes
  for (const e of events('footfall')) {
    if (!e.wet || e.actor.startsWith('line') || t < e.t || t - e.t > 0.6) continue;
    const dirF = e.actor === 'edric' ? 1 : -1;
    const sp = Math.min(e.speed, 4.5);
    splash(f, W, H, V.X(e.x), V.Y(0), t, e.t, {
      count: Math.round(12 + sp * 4),
      speed: s * (1.1 + 0.32 * sp),
      spread: 0.85,
      dir: -Math.PI / 2 + 0.4 * dirF,
      life: 0.55,
      gravity: s * 9,
      seed: Math.round(e.t * 100) % 97,
    });
  }
  // the spray sheet, thrown up and forward by the slide
  for (let k = 0; k < 10; k++) {
    const tb = TIME.thrust + k * 0.07;
    if (t < tb || t - tb > 0.9) continue;
    const p = skeletonAt('edric', tb);
    splash(f, W, H, V.X(p.X + 0.2), V.Y(0), t, tb, {
      count: 46,
      speed: s * 4.2,
      spread: 0.5,
      dir: -1.05,
      life: 0.9,
      gravity: s * 9.5,
      seed: 30 + k,
    });
  }
  // the clash: a star, sparks, a ring across the water
  const B = bindPoint(TIME.clash);
  const uC = t - TIME.clash;
  if (uC >= 0 && uC < 0.9) {
    if (uC < 0.09) star(f, W, H, V.X(B.x), V.Y(B.y), 20 * (1 - uC / 0.09) + 4, C.paperHi);
    sparks(f, W, H, V.X(B.x), V.Y(B.y), t, TIME.clash, {
      count: 46,
      speed: s * 4,
      life: 0.55,
      seed: 5,
    });
    const u = uC / 0.6;
    if (u < 1)
      ring(
        f,
        V.X(B.x),
        V.Y(0) + 1,
        7 * s * easeOut3(u),
        0.7 * s * easeOut3(u),
        C.paperHi,
        1,
        1 - u,
      );
  }
  // the bind grinds: sparks on twos
  if (t > TIME.clash + 0.3 && t < BIND_SPAN[1]) {
    const t0 = Math.floor(t * 6) / 6;
    const q = bindPoint(t0) || B;
    sparks(f, W, H, V.X(q.x), V.Y(q.y), t, t0, {
      count: 9,
      speed: s * 1.8,
      life: 0.3,
      seed: Math.floor(t0 * 6) % 50,
    });
    const bp = bindPoint(t);
    if (bp) star(f, W, H, V.X(bp.x), V.Y(bp.y), 3 + 2 * (Math.floor(t * 12) % 2), C.paperHi);
  }
  // the yield drags the contact down the blade
  if (t > 10.4 && t < 11.0) {
    const a = bindPoint(10.4);
    const bnow = bindPoint(Math.min(t, BIND_SPAN[1]));
    dline(f, V.X(a.x), V.Y(a.y), V.X(bnow.x), V.Y(bnow.y), C.gold, 2, 2);
  }
  // the crimson cut
  if (t > 11.12 && t < 11.75) {
    // the point's swept arc, tapering behind it, then fading
    const head = Math.min(t, 11.34);
    const fade = 1 - smooth(11.34, 11.75, t);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t0 = head - ((i + 1) / n) * 0.2;
      const t1 = head - (i / n) * 0.2;
      if (t0 < 11.1) break;
      const a = spearTip(t0);
      const b = spearTip(t1);
      const w = 1 + (1 - i / n) * 7;
      if (fade > bayer(i * 3, i * 5))
        stroke(
          f,
          W,
          H,
          V.X(a.x),
          V.Y(a.y),
          V.X(b.x),
          V.Y(b.y),
          w,
          w,
          i < 3 ? C.crimson : C.blood,
          1,
          0.3,
          4,
        );
    }
    const uK = t - 11.2;
    if (uK >= 0 && uK < 0.13) {
      const hit = spearTip(11.2);
      star(f, W, H, V.X(hit.x), V.Y(hit.y), 12 * (1 - uK / 0.13) + 3, C.crimson);
    }
  }
  // the fall: hips, then back and head; then ripples
  for (const [tb, n, sp] of [
    [TIME.fall, 90, 3.4],
    [TIME.landed, 140, 4.4],
  ]) {
    if (t < tb || t - tb > 1.4) continue;
    const p = skeletonAt('edric', tb).hips;
    splash(f, W, H, V.X(p[0] - (tb > 12.1 ? 0.35 : 0)), V.Y(0), t, tb, {
      count: n,
      speed: s * sp,
      spread: 1.15,
      dir: -Math.PI / 2 - 0.15,
      life: 1.4,
      gravity: s * 8.5,
      seed: 61 + n,
    });
  }
  for (let k = 0; k < 3; k++) {
    const u = (t - (TIME.landed + 0.15 + k * 0.32)) / 1.4;
    if (u > 0 && u < 1) {
      const p = skeletonAt('edric', TIME.landed).hips;
      ring(
        f,
        V.X(p[0] - 0.3),
        V.Y(0) + 1,
        2.6 * s * easeOut3(u),
        0.28 * s * easeOut3(u),
        C.steel,
        1,
        1 - u,
      );
    }
  }
}

// ------------------------------------------------------------------ labels and the HUD

// [event kind, text, drum? (flashes inverse on the hit), seconds shown]
const LABELS = [
  ['enterWater', 'WATER', false, 0.9],
  ['level', 'LEVEL', false, 0.6],
  ['plant', 'PLANT', false, 0.6],
  ['thrustAnt', 'SINKS', false, 0.45],
  ['drop', 'DROP', false, 0.4],
  ['thrust', 'THRUST', true, 0.9],
  ['spray', 'SPRAY', false, 0.8],
  ['clash', 'CLASH', true, 1.0],
  ['bind', 'BIND', false, 1.4],
  ['decide', 'DECIDE', false, 0.8],
  ['yield', 'YIELD', true, 0.8],
  ['stone', 'STONE', false, 0.45],
  ['slip', 'SLIP', false, 0.6],
  ['cut', 'CUT', true, 1.0],
  ['fall', 'FALL', true, 0.6],
  ['landed', 'LANDED', true, 1.1],
  ['paintLift', 'THE PAINT LIFTS', false, 0.4],
];

function labelsLayer(f, V, t) {
  let slot = 0;
  for (const [kind, txt, drum, dur] of LABELS) {
    const e = events(kind)[0];
    const u = t - e.t;
    if (u < 0 || u > dur) continue;
    const k = 2;
    const w = textWidth(txt, k);
    const ex = e.x !== undefined ? V.X(e.x) : W / 2;
    const px = clamp(ex - w / 2, 4, W - w - 4);
    const py = clamp(V.Y(2.7), 34, 70) + 18 * slot++;
    const flash = drum && u < 0.09;
    if (flash) {
      for (let y = py - 3; y < py + 13; y++)
        for (let x = px - 4; x < px + w + 4; x++) put(f, W, H, x, y, C.ink);
      text(f, px, py, txt, C.paperHi, k);
    } else {
      const fade = u > dur * 0.7 ? 1 - (u - dur * 0.7) / (dur * 0.3) : 1;
      for (let y = py - 3; y < py + 13; y++)
        for (let x = px - 4; x < px + w + 4; x++)
          if (fade > bayer(x, y)) put(f, W, H, x, y, C.paperHi, 0.85);
      if (fade > 0.15) {
        for (let y = py - 3; y < py + 13; y++)
          if (fade > bayer(px, y)) {
            put(f, W, H, px - 4, y, C.ink);
            put(f, W, H, px + w + 3, y, C.ink);
          }
        text(f, px, py, txt, drum ? C.crimson : C.ink, k);
      }
    }
    // a leader down to the event
    if (e.x !== undefined && e.y !== undefined && u < dur * 0.7) {
      const ly = V.Y(e.y);
      if (ly > py + 14) dline(f, ex, py + 14, ex, ly, C.ink, 1, 2, 0.8);
    }
  }
}

function hud(f, V, t, shot) {
  // header
  for (let y = 0; y < 15; y++) for (let x = 0; x < W; x++) put(f, W, H, x, y, C.paperHi);
  line(f, 0, 15, W, 15, 1, C.ink);
  text(f, 5, 5, 'THE FORD  FLAT-CAMERA LAYOUT', C.ink);
  const total = t + MUSIC_OFFSET;
  const bar = 1 + Math.floor(total / BAR + 1e-9);
  const beat = 1 + Math.floor(((total % BAR) + 1e-9) / (BAR / 4));
  const clock = `BAR ${bar}:${beat}   ${t.toFixed(2)}S`;
  text(f, W - 5 - textWidth(clock), 5, clock, C.ink);
  // the kit lights: K S C flash on each drum hit (do the hits land on the picture?)
  const lights = [
    ['K', 'kick', C.blood],
    ['S', 'snare', C.steelDeep],
    ['C', 'crash', C.gold],
  ];
  lights.forEach(([lab, name, col], i) => {
    const x = 262 + i * 22;
    const hit = KIT[name].some((h) => t + MUSIC_OFFSET - h.t >= 0 && t + MUSIC_OFFSET - h.t < 0.1);
    for (let y = 3; y < 12; y++)
      for (let xx = x; xx < x + 18; xx++) put(f, W, H, xx, y, hit ? col : C.paper);
    text(f, x + 2, 5, lab, hit ? C.paperHi : C.grey);
    line(f, x, 3, x + 18, 3, 1, C.grey);
  });
  // the beat
  for (let i = 0; i < 4; i++) {
    const on = i + 1 === beat;
    for (let y = 4; y < 11; y++)
      for (let x = 340 + i * 9; x < 346 + i * 9; x++) put(f, W, H, x, y, on ? C.ink : C.paper);
  }
  // the second header row: who holds the initiative
  for (let y = 16; y < 25; y++) for (let x = 0; x < W; x++) put(f, W, H, x, y, C.paper);
  const ini = initiative(t);
  const colOf = (n) => (n === 'edric' ? C.teal : C.crimson);
  text(f, 5, 18, 'INITIATIVE', C.sepia);
  for (let y = 17; y < 24; y++) for (let x = 50; x < 82; x++) put(f, W, H, x, y, colOf(ini.holder));
  text(f, 52, 18, ini.holder === 'edric' ? 'EDRIC' : 'WARDEN', C.paperHi);
  if (ini.apparent !== ini.holder) {
    text(f, 88, 18, 'LOOKS LIKE', C.sepia);
    for (let y = 17; y < 24; y++)
      for (let x = 136; x < 168; x++) put(f, W, H, x, y, colOf(ini.apparent));
    text(f, 138, 18, ini.apparent === 'edric' ? 'EDRIC' : 'WARDEN', C.paperHi);
  }
  const ea = ACTORS.edric.action(t);
  const wa = ACTORS.warden.action(t);
  text(f, 178, 18, `E:${ea}`, C.tealDeep);
  text(f, 300, 18, `W:${wa}`, C.blood);

  // the caption: the FORD.md shot over this moment
  for (let y = RULER_Y + 15; y < H; y++) for (let x = 0; x < W; x++) put(f, W, H, x, y, C.ink);
  const cap = `${String(shot.n).padStart(2, '0')}/16  ${shot.name}`;
  text(f, 6, RULER_Y + 18, cap, C.paperHi, 2);
  const words = ini.note.split(' ');
  const rows = ['', ''];
  let r = 0;
  for (const w of words) {
    if (textWidth(`${rows[r]} ${w}`) > W - 12 && r < 1) r++;
    rows[r] = rows[r] ? `${rows[r]} ${w}` : w;
  }
  rows.forEach((row, i) => text(f, 6, RULER_Y + 31 + i * 7, row, C.greyLo));
}

// ------------------------------------------------------------------ the piece

export class PieceClass extends Piece {
  constructor() {
    super(W, H);
    this.shots = SHOT_TABLE.map((sh) => ({
      name: `${String(sh.n).padStart(2, '0')} ${sh.name}`,
      from: sh.from,
      to: sh.to,
      draw: (f, t) => this.previs(f, t, sh),
    }));
  }

  async load() {
    await this.loadImages({}); // no images: it is all drawn from the blocking
  }

  previs(f, t, shot) {
    const V = view(t);
    groundLayer(f, V);
    stonesLayer(f, V);
    for (const n of LINE) figure(f, V, n, t, 'line');
    // depth order: the farther one (smaller Z) first
    const order = ['warden', 'edric'].sort((a, b) => skeletonAt(a, t).Z - skeletonAt(b, t).Z);
    // once Edric is down he lies in the river: draw him over the tint so the fall stays readable
    const down = t >= TIME.fall;
    for (const n of order) if (!(down && n === 'edric')) figure(f, V, n, t);
    waterLayer(f, V, t);
    if (down) figure(f, V, 'edric', t);
    marks(f, V, t);
    effects(f, V, t);
    ruler(f, V);
    labelsLayer(f, V, t);
    hud(f, V, t, shot);
  }
}

export const BLOCKING_DURATION = BLOCK_DURATION;
