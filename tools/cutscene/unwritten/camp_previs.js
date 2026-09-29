// "The Night Before", the layout reel (CAMP.md): the scene seen from above as a plan, before
// any shot is dressed. Step 2 of the method: who sits where, which way they face, what each
// looks at and when, where the camera stands for each of the seven shots and what it takes in,
// and which gesture lands on which note. Everything here is drawn from camp_blocking.js (the
// single source of truth); nothing is invented.
//
// Left: the plan (north up, the camera south of the fire looking north; the eyelines are the
// dashed rays, the wedge is the lens). Right: the shot, its bars, the score's notes and crashes
// on a timeline with the playhead, and each person's gaze and gesture at this moment.

import { Piece } from './engine/piece.js';
import { BAR } from './engine/score.js';
import { RGB, put, dput } from './engine/anime.js';
import { bayer, clamp, lerp, smooth } from './engine/raster.js';
import {
  CAMERA,
  DURATION,
  FIRE,
  HITS,
  MUSIC_OFFSET,
  NOTES,
  PEOPLE,
  S,
  SET,
  THREAD,
  TIME,
  at,
  gazeTarget,
  gestureAt,
  targetPoint,
} from './camp_blocking.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 5;
export { BAR, DURATION, MUSIC_OFFSET, at };

const C = {
  ink: RGB.ink,
  sepia: RGB.sepia,
  grey: [0x76, 0x6b, 0x77],
  greyLo: [0x97, 0x8b, 0x94],
  paper: RGB.paper,
  paperHi: RGB.paperHi,
  gold: RGB.gold,
  fire: [0xdc, 0xa0, 0x44],
  fireDeep: [0xb3, 0x70, 0x2c],
  edric: [0x2d, 0x64, 0x50],
  sera: [0x76, 0x3a, 0xa0],
  kira: [0x9e, 0x26, 0x32],
  earth: [0xb8, 0xae, 0x78],
  stone: [0x7a, 0x7a, 0x80],
};
const PCOL = { edric: C.edric, sera: C.sera, kira: C.kira };

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

// ------------------------------------------------------------------ the shots' captions

const SHOTS = [
  ['crane', 'THE SKY, TILT DOWN TO THE CAMP', 'the crash: the thread flares, a bead on every note'],
  ['three', 'THE THREE-SHOT', 'kira works, edric stares at the flames, sera looks up'],
  ['sera', 'SERA, THE LONG E', 'a breath, on the rest her eyes come down'],
  ['sky', 'WHAT SHE SEES', 'on the crash: the thread, a bead on every note'],
  ['edric', 'EDRIC FEELS IT', 'his eyes lift and meet hers across the fire'],
  ['kira', 'KIRA SEES HIM LOOK', 'the finger stops, she folds the map'],
  ['rise', 'HE RISES', 'the leading tone, the tilt up to the thread, the hit'],
].map(([name, cap, sub], i) => ({ n: i + 1, name, cap, sub, from: S[name][0], to: S[name][1] }));

export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));

// ------------------------------------------------------------------ the plan

const PX = 8.5; // px per metre
const CX = 118;
const CY = 142;
const sx = (X) => CX + X * PX;
const sy = (Z) => CY - Z * PX; // north (+Z) is up the page

function tentCorners(t) {
  const yaw = Math.atan2(t.z, t.x) + (t.jitter || 0);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const lu = (u * t.L) / 2;
    const lv = (v * t.w) / 2;
    return [t.x + lu * c - lv * s, t.z + lu * s + lv * c];
  });
}

function plan(f, t, shot) {
  // ground: the trodden ring and the fire
  for (let y = 0; y < H; y++)
    for (let x = 0; x < 240; x++) {
      const X = (x - CX) / PX;
      const Z = (CY - y) / PX;
      const r = Math.hypot(X, Z);
      if (r < 4.6 && bayer(x, y) < (1 - r / 4.6) * 0.6) put(f, W, H, x, y, C.earth, 0.5);
    }
  // the palisade
  const P = SET.palisade;
  const mid = (P.x0 + P.x1) / 2;
  const half = (P.x1 - P.x0) / 2;
  let prev = null;
  for (let X = P.x0; X <= P.x1; X += 0.5) {
    const Z = P.z - P.bow * (1 - ((X - mid) / half) ** 2);
    if (prev) line(f, sx(prev[0]), sy(prev[1]), sx(X), sy(Z), 1, C.greyLo);
    prev = [X, Z];
  }
  // tents (door end marked), stumps, barrels, the tripod and the banner
  for (const tn of SET.tents) {
    const q = tentCorners(tn).map(([X, Z]) => [sx(X), sy(Z)]);
    for (let i = 0; i < 4; i++)
      line(f, q[i][0], q[i][1], q[(i + 1) % 4][0], q[(i + 1) % 4][1], 1, C.grey);
    line(f, q[0][0], q[0][1], q[3][0], q[3][1], 1.6, C.sepia); // the door end
  }
  for (const s of SET.stumps) disc(f, sx(s.x), sy(s.z), 2, C.greyLo);
  for (const s of SET.barrels) disc(f, sx(s.x), sy(s.z), 2, C.greyLo);
  for (const b of SET.benches)
    line(f, sx(b.x - b.sx), sy(b.z), sx(b.x + b.sx), sy(b.z), 3, C.greyLo);
  disc(f, sx(SET.tripod.x), sy(SET.tripod.z), 2, C.sepia);
  disc(f, sx(SET.banner.x), sy(SET.banner.z), 2, C.edric);
  // the fire and its stones
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    disc(f, sx(Math.cos(a) * FIRE.r), sy(Math.sin(a) * FIRE.r), 1.6, C.stone);
  }
  disc(f, sx(0), sy(0), 4, C.fire);
  disc(f, sx(0), sy(0), 2, C.paperHi);
  // the thread: its azimuth span on a ring of sky at the plan's rim (0 = north, clockwise)
  const R = 108;
  for (let i = 0; i <= 90; i++) {
    const u = i / 90;
    const az = lerp(THREAD.az0, THREAD.az1, u);
    put(f, W, H, CX + Math.sin(az) * R, CY - Math.cos(az) * R, C.gold);
  }
  text(f, CX - 14, CY - R - 10, 'THREAD', C.gold, 1, C.ink);
  // the people: a disc, a facing tick, an eyeline to what they look at
  for (const [name, p] of Object.entries(PEOPLE)) {
    const x = sx(p.seat[0]);
    const y = sy(p.seat[1]);
    const g = gazeTarget(name, t);
    const tp = targetPoint(g);
    let gx = tp.x;
    let gz = tp.z;
    let sky = false;
    if (g === 'sky') {
      // straight up the page: the ray runs off toward the thread
      gx = p.seat[0] + p.face * -0.3;
      gz = p.seat[1] + 5;
      sky = true;
    } else if (g === 'map') {
      gx = p.seat[0] + p.face * 0.4;
      gz = p.seat[1] - 0.4;
    }
    dline(f, x, y, sx(gx), sy(gz), sky ? C.gold : PCOL[name], 3, 2);
    disc(f, x, y, 4.5, PCOL[name]);
    line(f, x, y, x + p.face * 8, y, 1.4, C.ink);
    text(f, x - 1, y - 2, name[0], C.paperHi, 1);
  }
  // the camera: a wedge for the lens, and a triangle where it stands
  const lt = t - shot.from;
  const cam = CAMERA[shot.name](lt);
  const yaw = cam.yaw || 0;
  const half2 = Math.atan(240 / cam.focal);
  const cx = sx(cam.x);
  const cy = sy(cam.z);
  const len = shot.name === 'crane' ? 40 : 34;
  for (const s of [-1, 1]) {
    const a = yaw + s * half2;
    line(f, cx, cy, cx + Math.sin(a) * len, cy - Math.cos(a) * len, 1, C.ink, 0.9);
  }
  line(f, cx, cy, cx + Math.sin(yaw) * len * 0.55, cy - Math.cos(yaw) * len * 0.55, 1, C.ink, 0.5);
  disc(f, cx, cy, 3.2, C.ink);
  disc(f, cx, cy, 1.6, C.paperHi);
  const pitch = ((cam.pitch || 0) * 180) / Math.PI;
  text(
    f,
    clamp(cx - 12, 2, 200),
    clamp(cy + 6, 2, 262),
    `CAM ${shot.n} P${Math.round(pitch)}`,
    C.ink,
    1,
    C.paperHi,
  );
}

// ------------------------------------------------------------------ the score bar

function scoreBar(f, t, shot) {
  const x0 = 250;
  const x1 = 472;
  const y0 = 196;
  const tx = (s) => x0 + ((x1 - x0) * s) / DURATION;
  // the seven shots
  for (const sh of SHOTS) {
    const xa = tx(sh.from);
    const xb = tx(sh.to);
    const on = sh.n === shot.n;
    for (let x = Math.ceil(xa); x < xb - 0.5; x++)
      for (let y = y0; y < y0 + 9; y++)
        put(f, W, H, x, y, on ? C.fire : sh.n % 2 ? C.greyLo : C.grey);
    text(f, xa + 2, y0 + 2, String(sh.n), on ? C.ink : C.paperHi, 1);
    line(f, xa, y0 - 2, xa, y0 + 10, 1, C.ink);
  }
  // bars
  for (let b = 0; b <= 8; b++) {
    const x = tx(b * BAR);
    line(f, x, y0 + 12, x, y0 + 16, 1, C.ink);
    if (b < 8) text(f, x + 2, y0 + 12, String(5 + b), C.sepia, 1);
  }
  // the tune's notes (a tick each; long notes wide), the crashes tall
  for (const n of NOTES) {
    const x = tx(n.t);
    const w = Math.max(1, tx(n.t + n.dur) - x - 1);
    const y = (y0 - 8 - (n.midi - 70) * 0.6) | 0;
    for (let i = 0; i < w; i++) put(f, W, H, x + i, y, C.gold);
  }
  for (const c of HITS.crash) line(f, tx(c), y0 - 18, tx(c), y0 - 2, 1.4, C.sepia);
  // the playhead
  const px = tx(t);
  line(f, px, y0 - 20, px, y0 + 18, 1.4, C.ink);
  disc(f, px, y0 - 20, 2, C.fire);
}

// ------------------------------------------------------------------ the piece

export class PieceClass extends Piece {
  constructor() {
    super(W, H);
    this.shots = SHOTS.map((sh) => ({
      name: sh.name,
      from: sh.from,
      to: sh.to,
      draw: (f, t) => this.previs(f, t, sh),
    }));
  }

  async load() {
    await this.loadImages({}); // no images: it is all drawn from the blocking
  }

  previs(f, t, shot) {
    // a bone-coloured sheet
    for (let i = 0; i < W * H; i++) {
      f[i * 4] = 221;
      f[i * 4 + 1] = 214;
      f[i * 4 + 2] = 200;
    }
    plan(f, t, shot);
    // the panel covers whatever of the plan runs under it
    for (let y = 0; y < H; y++)
      for (let x = 246; x < W; x++) {
        const i = (y * W + x) * 4;
        f[i] = 221;
        f[i + 1] = 214;
        f[i + 2] = 200;
      }
    line(f, 245.5, 0, 245.5, H, 1, C.greyLo);
    // the right panel
    text(f, 250, 8, `${shot.n}/7`, C.sepia, 1);
    text(f, 250, 18, shot.cap, C.ink, 1);
    text(f, 250, 28, shot.sub.toUpperCase().slice(0, 55), C.grey, 1);
    const bar = 5 + Math.floor(t / BAR);
    const beat = 1 + ((t % BAR) / BAR) * 4;
    text(f, 250, 42, `BAR ${bar} BEAT ${beat.toFixed(1)}   ${t.toFixed(2)} S`, C.sepia, 1);
    // each person's gaze and gesture now
    let y = 60;
    for (const [name, p] of Object.entries(PEOPLE)) {
      disc(f, 254, y + 2, 3, PCOL[name]);
      const g = gazeTarget(name, t);
      text(f, 262, y - 1, `${name} LOOKS AT ${Array.isArray(g) ? 'POINT' : g}`, C.ink, 1);
      const ge = gestureAt(name, t);
      text(f, 262, y + 8, ge ? ge.slice(0, 44) : '-', ge ? C.sepia : C.greyLo, 1);
      y += 24;
    }
    // the moments that carry the scene
    const moments = [
      [TIME.serarest, 'SERA: EYES COME DOWN'],
      [TIME.edricLift, 'EDRIC: EYES LIFT'],
      [TIME.kiraStop, 'KIRA: FINGER STOPS'],
      [TIME.rise, 'EDRIC RISES'],
      [TIME.hit, 'THE BIG HIT'],
    ];
    let my = 134;
    for (const [mt, label] of moments) {
      const now = Math.abs(t - mt) < 0.2;
      text(f, 250, my, `${mt.toFixed(1)} ${label}`, now ? C.fire : C.greyLo, 1, now ? C.ink : null);
      my += 9;
    }
    scoreBar(f, t, shot);
    text(f, 250, 252, 'THE PLAN, FROM ABOVE: DASHED RAYS ARE EYELINES', C.greyLo, 1);
  }
}
