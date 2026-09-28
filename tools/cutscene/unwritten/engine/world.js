// The world: a procedural 2.5D place seen through a real perspective camera, painted in
// the Unwritten Page's materials (docs/art-direction/anime-op/STYLE.md): pale
// transparent washes over the vellum, sepia ink on the nearest edges only, the gold ring
// of the Hollow Sun the one warm light. Backgrounds stay large, simple and quieter than
// the figures.
//
// Coordinates are metres. X runs along the crossing (right), Y is up (the water surface
// is Y = 0), Z is depth. The river runs along Z and flows toward -Z, so a camera looking
// upstream (yaw 0) sees the current coming at it. A camera is
// { x, y, z, yaw, pitch, roll, focal } (radians; focal in screen px, ~300-420 normal).
//
// A frame is a pure function of (t, camera, options): nothing is carried between frames,
// particles are seeded by index and birth time. Drawn things (reeds, splash crowns) step
// on twos; the camera, clouds, water and rain move on ones.
//
//   const world = new World({ paper });
//   world.render(frame, t, cam, { stage, actors, impulses, rain, foreground, ... });
//   world.splashAt(frame, cam, X, Z, t, t0, strength);   // after render: depth-tested
//   world.spraySheet(frame, cam, { X, Z, age, ... });
//
// How it is drawn: every pixel casts a ray. Rays that hit the ground find the river (a
// trench along Z with sloped banks) or the bank top; the rest meet ridge "curtains" on
// circles of increasing radius around the ford (real parallax, aerial perspective by
// distance) or the sky, where clouds lie on a plane 1.5 km up. Water samples a second
// image, the background seen from the camera mirrored in Y = 0, displaced by the wave
// slope (so the Hollow Sun breaks up in the current). Every surface writes an id and a
// depth; the ink contours come from id changes (the world's own shapes), and the paint
// stages dissolve wash -> lines -> pencil -> paper in noise patches like every layer.

import { bayer, clamp, hash, hexToRgb, lerp, noiseField, smooth, valueNoise } from './raster.js';
import { C } from './palette.js';
import { hollowSun } from './fx.js';
import { drawSprite, layerMatrix } from './view.js';

// ------------------------------------------------------------------------ camera

const NEAR = 0.05;
const BASIS = new WeakMap();

/**
 * The camera's basis and screen constants (cached per camera object: treat cameras as
 * immutable values). Positive roll tilts the horizon down to the right.
 */
export function basis(cam, W = 480, H = 270) {
  const hit = BASIS.get(cam);
  if (hit && hit.W === W && hit.H === H) return hit;
  const cy = Math.cos(cam.yaw || 0);
  const sy = Math.sin(cam.yaw || 0);
  const cp = Math.cos(cam.pitch || 0);
  const sp = Math.sin(cam.pitch || 0);
  const fx = sy * cp;
  const fy = sp;
  const fz = cy * cp;
  const r0x = cy;
  const r0z = -sy;
  // up = forward x right
  const u0x = fy * r0z;
  const u0y = fz * r0x - fx * r0z;
  const u0z = -fy * r0x;
  const cr = Math.cos(cam.roll || 0);
  const sr = Math.sin(cam.roll || 0);
  const b = {
    W,
    H,
    fx,
    fy,
    fz,
    rx: r0x * cr + u0x * sr,
    ry: u0y * sr,
    rz: r0z * cr + u0z * sr,
    ux: u0x * cr - r0x * sr,
    uy: u0y * cr,
    uz: u0z * cr - r0z * sr,
    F: cam.focal ?? 360,
    cx: W / 2,
    cy: H / 2,
    ox: cam.x,
    oy: cam.y,
    oz: cam.z,
  };
  BASIS.set(cam, b);
  return b;
}

/**
 * World point -> screen. Returns { sx, sy, scale, depth }: scale is screen px per metre
 * at that depth, depth the distance along the view axis (<= 0: behind the camera).
 */
export function project(cam, X, Y, Z, W = 480, H = 270) {
  const b = basis(cam, W, H);
  const vx = X - cam.x;
  const vy = Y - cam.y;
  const vz = Z - cam.z;
  const z = vx * b.fx + vy * b.fy + vz * b.fz;
  const iz = b.F / Math.max(z, 1e-6);
  return {
    sx: b.cx + (vx * b.rx + vy * b.ry + vz * b.rz) * iz,
    sy: b.cy - (vx * b.ux + vy * b.uy + vz * b.uz) * iz,
    scale: iz,
    depth: z,
  };
}

/** Screen point -> unit ray direction [dx, dy, dz]. */
export function unproject(cam, sx, sy, W = 480, H = 270) {
  const b = basis(cam, W, H);
  const a = (sx - b.cx) / b.F;
  const c = -(sy - b.cy) / b.F;
  const dx = b.fx + a * b.rx + c * b.ux;
  const dy = b.fy + a * b.ry + c * b.uy;
  const dz = b.fz + a * b.rz + c * b.uz;
  const l = Math.hypot(dx, dy, dz);
  return [dx / l, dy / l, dz / l];
}

/** A camera at `from` looking at `to` ({x, y, z} each). o: { focal, roll }. */
export function lookAt(from, to, o = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return {
    x: from.x,
    y: from.y,
    z: from.z,
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    roll: o.roll ?? 0,
    focal: o.focal ?? 360,
  };
}

/**
 * A camera orbiting `center` ({x, y, z}; y is the height looked at) at `radius` and
 * `height`. angle 0 puts the camera downstream (-Z) of the centre looking upstream;
 * positive angles swing it toward +X. o: { focal, roll, lookY }.
 */
export function orbit(center, radius, angle, height, o = {}) {
  const from = {
    x: center.x + Math.sin(angle) * radius,
    y: height,
    z: center.z - Math.cos(angle) * radius,
  };
  return lookAt(from, { x: center.x, y: o.lookY ?? center.y ?? 1, z: center.z }, o);
}

/** Linear blend of two cameras (yaw the short way round). */
export function lerpCam(a, b, k) {
  let dyaw = (b.yaw || 0) - (a.yaw || 0);
  dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    z: lerp(a.z, b.z, k),
    yaw: (a.yaw || 0) + dyaw * k,
    pitch: lerp(a.pitch || 0, b.pitch || 0, k),
    roll: lerp(a.roll || 0, b.roll || 0, k),
    focal: lerp(a.focal ?? 360, b.focal ?? 360, k),
  };
}

/**
 * A crane: `base` camera ({x, z, yaw, focal, roll}) rising or dropping from `from` to
 * `to` (each { y, pitch }, optionally x/z/focal) by k (0..1, eased by the caller).
 */
export function crane(base, from, to, k) {
  return lerpCam({ ...base, ...from }, { ...base, ...to }, k);
}

/** Screen shake on a world camera: dx, dy in screen px, droll in radians. */
export function nudge(cam, dx = 0, dy = 0, droll = 0) {
  const F = cam.focal ?? 360;
  return {
    ...cam,
    yaw: (cam.yaw || 0) + dx / F,
    pitch: (cam.pitch || 0) - dy / F,
    roll: (cam.roll || 0) + droll,
  };
}

/** A shock wave for render({ impulses }): reeds flatten outward, rain bends, a ring runs. */
export const impulse = (x, z, t0, strength = 1) => ({ x, z, t0, strength });

// ------------------------------------------------------------------------ colour

const PAPER_REF = [214, 207, 196];
const KR = 1 / PAPER_REF[0];
const KG = 1 / PAPER_REF[1];
const KB = 1 / PAPER_REF[2];
const SEPIA = hexToRgb(C.sepia);
const GRAPHITE = hexToRgb(C.graphite);
const INK = hexToRgb(C.ink);

// wash colours ("targets": what the pigment reads as on the reference vellum; they
// multiply onto the actual page, so its grain and edge shading show through)
const SKY_HOR = [206, 200, 192];
const SKY_ZEN = [168, 163, 172];
const HAZE = [199, 194, 190];
const MIST = [210, 205, 198];
const CLOUD_THIN = [180, 175, 181];
const CLOUD_THICK = [160, 155, 165];
const CLOUD_POOL = [140, 134, 146];
const GRASS_A = [158, 151, 118];
const GRASS_B = [134, 129, 101];
const MUD = [112, 108, 101];
const SLOPE_C = [88, 84, 80];
const WATER_DEEP = [74, 82, 98];
const BED = [118, 113, 100];
const BANK_REFL = [92, 89, 84];
const FOAM = [238, 232, 220];
const STONE_LIT = [158, 156, 156];
const STONE_MID = [120, 119, 124];
const STONE_SH = [86, 86, 94];
const STONE_WET = [66, 66, 74];
const STONE_MOSS = [124, 126, 100];
const REED_T = [118, 110, 86];
const RAIN_DARK = [128, 120, 132];
const RAIN_LIGHT = [210, 206, 208];
const FG_DARK = hexToRgb('#16131e');
const FG_RIM = hexToRgb('#403949');

// ids (what each pixel shows): contours come from changes between them
const ID_SKY = 1;
const ID_THIN = 2;
const ID_THICK = 3;
const ID_RIDGE = 10; // + layer
const ID_BANK = 20;
const ID_SLOPE = 21;
const ID_WATER = 22;
const ID_STONE = 40; // + stone index (< 150)
const ID_REED = 200;
const ID_ACTOR = 210;
const ID_FX = 230;

// ------------------------------------------------------------------------ noise tables

/** Tileable value noise: lattice periods px, py. */
function tnoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tfbm(x, y, px, py, seed, oct) {
  let s = 0;
  let amp = 0.5;
  let n = 0;
  let f = 1;
  for (let o = 0; o < oct; o++) {
    s += amp * tnoise(x * f, y * f, px * f, py * f, seed + o * 101);
    n += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / n;
}

function stretch01(a) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
  return a;
}

/** A texture's box-filtered mip chain: [{ N, d }, ...]. */
function mipChain(d, N) {
  const out = [{ N, d }];
  while (N > 4) {
    const n = N >> 1;
    const s = out[out.length - 1].d;
    const e = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = 2 * y * N + 2 * x;
        e[y * n + x] = (s[i] + s[i + 1] + s[i + N] + s[i + N + 1]) * 0.25;
      }
    out.push({ N: n, d: e });
    N = n;
  }
  return out;
}

/** Bilinear, wrapping sample of an N*N texture (N a power of two) at texel (u, v). */
function samp(d, N, u, v) {
  const x = Math.floor(u);
  const y = Math.floor(v);
  const fx = u - x;
  const fy = v - y;
  const m = N - 1;
  const x0 = x & m;
  const x1 = (x + 1) & m;
  const y0 = (y & m) * N;
  const y1 = ((y + 1) & m) * N;
  const a = d[y0 + x0];
  const b = d[y0 + x1];
  const c = d[y1 + x0];
  const e = d[y1 + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

/** Trilinear sample of a mip chain; lod in levels (0 = finest). */
function sampMip(m, u, v, lod) {
  if (lod <= 0) return samp(m[0].d, m[0].N, u, v);
  const top = m.length - 1;
  if (lod >= top) {
    const s = 1 / (1 << top);
    return samp(m[top].d, m[top].N, u * s, v * s);
  }
  const l = Math.floor(lod);
  const f = lod - l;
  const s0 = 1 / (1 << l);
  const a = samp(m[l].d, m[l].N, u * s0, v * s0);
  if (f < 0.02) return a;
  const b = samp(m[l + 1].d, m[l + 1].N, u * s0 * 0.5, v * s0 * 0.5);
  return a + (b - a) * f;
}

let TEX = null;
/** The noise textures, built once per page (a few tens of ms). */
function textures() {
  if (TEX) return TEX;
  // clouds: domain-warped fbm, masses a few hundred metres across
  const N = 256;
  const cl = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i / N) * 6;
      const y = (j / N) * 6;
      const q1 = tfbm(x, y, 6, 6, 31, 3);
      const q2 = tfbm(x + 3.7, y + 1.9, 6, 6, 37, 3);
      cl[j * N + i] = tfbm(x + 2.4 * q1, y + 2.4 * q2, 6, 6, 41, 5);
    }
  stretch01(cl);
  // ground blotches (grass tones, mud, the ridges' brush)
  const gr = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) gr[j * N + i] = tfbm((i / N) * 8, (j / N) * 8, 8, 8, 71, 4);
  stretch01(gr);
  // waves: long across the flow (X), short along it (Z); stored as slope
  const M = 128;
  const hw = new Float32Array(M * M);
  for (let j = 0; j < M; j++)
    for (let i = 0; i < M; i++) hw[j * M + i] = tfbm((i / M) * 4, (j / M) * 12, 4, 12, 51, 3);
  stretch01(hw);
  const gx = new Float32Array(M * M);
  const gz = new Float32Array(M * M);
  for (let j = 0; j < M; j++)
    for (let i = 0; i < M; i++) {
      const m = M - 1;
      gx[j * M + i] = (hw[j * M + ((i + 1) & m)] - hw[j * M + ((i - 1) & m)]) * 0.5;
      gz[j * M + i] = (hw[((j + 1) & m) * M + i] - hw[((j - 1) & m) * M + i]) * 0.5;
    }
  // flow streaks: long along Z, thin across
  const st = new Float32Array(M * M);
  for (let j = 0; j < M; j++)
    for (let i = 0; i < M; i++) st[j * M + i] = tfbm((i / M) * 24, (j / M) * 3, 24, 3, 61, 2);
  stretch01(st);
  TEX = { cloud: mipChain(cl, N), ground: mipChain(gr, N), M, gx, gz, hw, streak: st };
  return TEX;
}

/** Fast atan2 (|error| < 1e-5 rad). */
function atan2f(y, x) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const a = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-30);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.5707963268 - r;
  if (x < 0) r = 3.1415926536 - r;
  return y < 0 ? -r : r;
}

// ------------------------------------------------------------------------ the place

const TAB = 4096; // ridge profile samples around the circle
const TWO_PI = Math.PI * 2;

/**
 * Ridge layers: curtains on circles around the ford, nearest first. Each farther one is
 * paler, cooler, lower in contrast (aerial perspective); only the near ones get ink.
 */
const RIDGES = [
  {
    R: 170,
    base: 5,
    amp: 30,
    freq: 3.4,
    seed: 11,
    valley: 0.9,
    lit: [128, 124, 116],
    sh: [101, 98, 102],
    mist: 9,
    skew: 1.6,
    brush: 0.12,
  },
  {
    R: 440,
    base: 12,
    amp: 82,
    freq: 2.5,
    seed: 23,
    valley: 0.65,
    lit: [154, 149, 150],
    sh: [133, 128, 136],
    mist: 26,
    skew: 1.3,
    brush: 0.06,
  },
  {
    R: 1150,
    base: 40,
    amp: 250,
    freq: 1.9,
    seed: 37,
    valley: 0.3,
    lit: [176, 170, 171],
    sh: [158, 153, 162],
    mist: 70,
    skew: 1.1,
    brush: 0,
  },
  {
    R: 2900,
    base: 160,
    amp: 620,
    freq: 1.45,
    seed: 53,
    valley: 0,
    lit: [191, 185, 184],
    sh: [178, 173, 178],
    mist: 200,
    skew: 1,
    brush: 0,
  },
];

function buildRidge(L) {
  const h = new Float32Array(TAB + 1);
  let hmax = 0;
  for (let i = 0; i <= TAB; i++) {
    const th = -Math.PI + (i / TAB) * TWO_PI;
    const cx = Math.cos(th) * L.freq;
    const cz = Math.sin(th) * L.freq;
    // ridged fbm on a circle (periodic by construction)
    let s = 0;
    let amp = 0.55;
    let f = 1;
    let n = 0;
    for (let o = 0; o < 4; o++) {
      const v = valueNoise(cx * f + 17, cz * f + 31, L.seed + o * 13);
      const r = 1 - Math.abs(2 * v - 1);
      s += amp * r * r;
      n += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    let p = s / n;
    // the river's valley: upstream (th = 0) and downstream (th = pi)
    const a = Math.abs(th);
    const v = Math.min(smooth(0.05, 0.55, a), smooth(0.05, 0.55, Math.PI - a));
    p *= 1 - L.valley * (1 - v);
    h[i] = L.base * (0.4 + 0.6 * v) + L.amp * p;
    if (h[i] > hmax) hmax = h[i];
  }
  const d = new Float32Array(TAB + 1);
  for (let i = 0; i <= TAB; i++) d[i] = h[Math.min(TAB, i + 2)] - h[Math.max(0, i - 2)];
  return { ...L, h, d, hmax };
}

/** River half-shape: depth by normalised distance from the centre (FORD.md). */
function depthProfile(a) {
  if (a < 0.625) return 0.6 - 0.1 * (a / 0.625) ** 2;
  const k = clamp((a - 0.625) / 0.375);
  return 0.5 * (1 - k) ** 0.85;
}

const EZ0 = -1400; // edge table range (m) and step
const EZ1 = 1400;
const EDZ = 0.1;

/** The stones that break the surface. FORD.md names the four at the ford line. */
function makeStones(seed) {
  const S = [
    { X: -6.0, Z: 0.7, a: 0.42, c: 0.34, top: 0.16, ry: 0.36, yaw: 0.3 },
    { X: -1.5, Z: -0.5, a: 0.36, c: 0.3, top: 0.12, ry: 0.32, yaw: -0.5 },
    { X: 2.0, Z: 0.6, a: 0.46, c: 0.38, top: 0.2, ry: 0.4, yaw: 0.9 },
    // the slick one Edric slips on: low and flat
    { X: 3.8, Z: -0.2, a: 0.55, c: 0.42, top: 0.07, ry: 0.22, yaw: 0.2, slick: true },
  ];
  // upstream and downstream, in the river and along its edges
  for (let i = 0; i < 46; i++) {
    const up = i < 34;
    const Z = up ? 4 + hash(i, 1, seed) ** 1.3 * 80 : -3 - hash(i, 1, seed) * 34;
    const side = hash(i, 2, seed);
    const edge = side < 0.45;
    const s = 0.22 + hash(i, 3, seed) ** 2 * 0.55;
    S.push({
      Z,
      u: edge ? (side < 0.22 ? -1 : 1) * (0.93 + hash(i, 4, seed) * 0.12) : hash(i, 4, seed) * 1.7 - 0.85,
      a: s * (1 + hash(i, 5, seed) * 0.5),
      c: s * (0.8 + hash(i, 6, seed) * 0.4),
      top: 0.05 + hash(i, 7, seed) * 0.22 * (s / 0.5),
      ry: s * 0.8,
      yaw: hash(i, 8, seed) * Math.PI,
    });
  }
  return S;
}

/**
 * The world. o: { paper (the page, W*H RGBA; required), W, H, seed, sun: { az, el, r }
 * (direction of the Hollow Sun, radians; r its angular radius), flow (m/s),
 * wind: { dir (radians, the direction it blows toward), strength }, stones (extra) }.
 */
export class World {
  constructor(o = {}) {
    this.W = o.W ?? 480;
    this.H = o.H ?? 270;
    this.paper = o.paper;
    this.seed = o.seed ?? 3;
    this.sun = { az: 0.06, el: 0.33, r: 0.075, ...(o.sun || {}) };
    this.flow = o.flow ?? 0.9;
    this.wind = { dir: 0.35, strength: 1, ...(o.wind || {}) };
    this.bankH = 0.4;
    this.slopeW = 0.9;
    this.cloudH = 1500;
    this.cloudTexel = 26;
    const W = this.W;
    const H = this.H;
    const N = W * H;
    this.N = N;
    this.tex = textures();
    this.ridges = RIDGES.map(buildRidge);
    this.buildRiver();
    this.stones = [...makeStones(this.seed), ...(o.stones || [])].map((s, i) => this.placeStone(s, i));
    this.buildStoneGrid();
    this.buildReeds();
    // per-pixel buffers
    this.rdx = new Float32Array(N);
    this.rdy = new Float32Array(N);
    this.rdz = new Float32Array(N);
    this.il = new Float32Array(N); // d . forward for the unit ray (view z = t * il)
    this.gT = new Float32Array(N);
    this.gX = new Float32Array(N);
    this.gZ = new Float32Array(N);
    this.gType = new Uint8Array(N);
    this.zbuf = new Float32Array(N);
    this.ids = new Uint8Array(N);
    this.line = new Float32Array(N);
    this.pencil = new Float32Array(N);
    this.wdx = new Float32Array(N);
    this.wdy = new Float32Array(N);
    this.refl = new Uint8ClampedArray(N * 4);
    this.reflId = new Uint8Array(N);
    this.stg = new Uint8Array(N);
    this.tmp = new Uint8ClampedArray(N * 4);
    this.scratch = new Uint8ClampedArray(N * 4);
    this.cloudA = new Float32Array(N);
    this.cloudC = new Uint8ClampedArray(N * 4);
    this.fgMask = new Uint8Array(N);
    const mask = noiseField(W, H, this.seed + 101, 44);
    this.thr = new Float32Array(N);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) this.thr[y * W + x] = 0.8 * mask[y * W + x] + 0.2 * bayer(x, y);
    this.col = new Float32Array(3);
    this.bgOut = new Float32Array(3);
    this.last = null;
  }

  // ---------------------------------------------------------------- geometry

  buildRiver() {
    const n = Math.round((EZ1 - EZ0) / EDZ) + 1;
    this.eL = new Float32Array(n);
    this.eR = new Float32Array(n);
    const s = this.seed * 7 + 1;
    for (let i = 0; i < n; i++) {
      const Z = EZ0 + i * EDZ;
      const away = smooth(12, 90, Math.abs(Z));
      const centre = (valueNoise(Z / 70, 0.5, s) - 0.5) * 9 * away;
      const half = 8 + (valueNoise(Z / 48, 1.5, s + 1) - 0.5) * 8 * smooth(8, 60, Math.abs(Z));
      // the soft irregular edge, a little on each side
      const wig = (k) =>
        (valueNoise(Z / 2.6, k, s + 2) - 0.5) * 0.9 +
        (valueNoise(Z / 0.8, k + 3, s + 3) - 0.5) * 0.35 +
        (valueNoise(Z / 11, k + 6, s + 4) - 0.5) * 1.4 * smooth(4, 30, Math.abs(Z));
      this.eL[i] = centre - half - wig(0.5);
      this.eR[i] = centre + half + wig(7.5);
    }
  }

  /** Left and right water edges (X) at depth Z, into this._el/_er. */
  edges(Z) {
    let f = (Z - EZ0) / EDZ;
    if (f < 0) f = 0;
    const last = this.eL.length - 1;
    if (f > last - 1) f = last - 1;
    const i = f | 0;
    const k = f - i;
    this._el = this.eL[i] + (this.eL[i + 1] - this.eL[i]) * k;
    this._er = this.eR[i] + (this.eR[i + 1] - this.eR[i]) * k;
  }

  /** Ground height at (X, Z): the riverbed (negative) or the bank. */
  groundY(X, Z) {
    this.edges(Z);
    const el = this._el;
    const er = this._er;
    if (X > el && X < er) {
      const c = (el + er) / 2;
      const half = (er - el) / 2;
      return -depthProfile(Math.abs(X - c) / half) * Math.sqrt(half / 8);
    }
    const out = X <= el ? el - X : X - er;
    return this.bankH * smooth(0, this.slopeW, out);
  }

  /** Water depth at (X, Z) (0 on the banks). */
  waterDepth(X, Z) {
    return Math.max(0, -this.groundY(X, Z));
  }

  /** Signed distance outside the water (m): negative in the river, positive on a bank. */
  outside(X, Z) {
    this.edges(Z);
    return X < (this._el + this._er) / 2 ? this._el - X : X - this._er;
  }

  placeStone(s, i) {
    let X = s.X;
    if (X === undefined) {
      this.edges(s.Z);
      const c = (this._el + this._er) / 2;
      const half = (this._er - this._el) / 2;
      X = c + s.u * half;
    }
    const cy = s.top - s.ry;
    return {
      ...s,
      X,
      cy,
      i,
      ex: Math.cos(s.yaw || 0),
      ez: Math.sin(s.yaw || 0),
      moss: hash(i, 9, 77) < 0.45,
      tone: 0.9 + hash(i, 10, 77) * 0.2,
    };
  }

  buildStoneGrid() {
    this.sgrid = new Map();
    for (const s of this.stones) {
      const r = Math.max(s.a, s.c);
      for (let gz = Math.floor((s.Z - 5) / 4); gz <= Math.floor((s.Z + r + 0.6) / 4); gz++)
        for (let gx = Math.floor((s.X - r - 2) / 4); gx <= Math.floor((s.X + r + 2) / 4); gx++) {
          const k = gx * 7919 + gz;
          if (!this.sgrid.has(k)) this.sgrid.set(k, []);
          this.sgrid.get(k).push(s);
        }
    }
  }

  /** Reed clumps on the banks and in the shallows, packed into typed arrays. */
  buildReeds() {
    const clumps = [];
    const blades = [];
    const s = this.seed * 13 + 5;
    let n = 0;
    const step = 0.75;
    for (let Z = -50; Z < 110; Z += step)
      for (let X = -44; X < 44; X += step) {
        n++;
        const x = X + hash(n, 1, s) * step;
        const z = Z + hash(n, 2, s) * step;
        const de = this.outside(x, z);
        const far = Math.abs(z) > 60 ? 0.5 : 1;
        const dens =
          de < -1.1
            ? 0
            : de < -0.1
              ? 0.3
              : de < 0.4
                ? 0.15
                : de < 3.2
                  ? 0.85
                  : de < 8
                    ? 0.3
                    : 0.1;
        if (hash(n, 3, s) > dens * far) continue;
        const tall = de < 3.5 ? 1 : 0.65;
        const nb = 4 + Math.floor(hash(n, 4, s) * 8);
        const first = blades.length / 9;
        let maxH = 0;
        const base = de < 0 ? 0 : this.groundY(x, z);
        for (let b = 0; b < nb; b++) {
          const q = n * 31 + b;
          const h = (0.45 + hash(q, 5, s) * 1.05) * tall;
          const la = hash(q, 6, s) * TWO_PI;
          const lm = hash(q, 7, s) * 0.32;
          blades.push(
            x + (hash(q, 8, s) - 0.5) * 0.3,
            base,
            z + (hash(q, 9, s) - 0.5) * 0.3,
            h,
            Math.sin(la) * lm,
            Math.cos(la) * lm,
            hash(q, 10, s) * TWO_PI,
            0.7 + hash(q, 11, s) * 0.6,
            hash(q, 12, s) < 0.25 ? 1 : 0, // a seed head
          );
          if (h > maxH) maxH = h;
        }
        clumps.push(x, base, z, first, nb, maxH, de);
      }
    this.clumps = new Float32Array(clumps);
    this.blades = new Float32Array(blades);
  }

  // ---------------------------------------------------------------- ray casting

  /**
   * Ray from (ox, oy, oz) along unit (dx, dy, dz) against the river trench and banks.
   * Sets this._ht (distance, Infinity for none), _hx, _hz, _htype (1 water, 2 bank top,
   * 3 bank slope).
   */
  hitGround(ox, oy, oz, dx, dy, dz) {
    const BH = this.bankH;
    const SW = this.slopeW;
    let best = Infinity;
    let type = 0;
    let bx = 0;
    let bz = 0;
    let zg = oz + dz * 20;
    if (dy < -1e-7) {
      if (oy > BH) {
        const t1 = (BH - oy) / dy;
        const x1 = ox + dx * t1;
        const z1 = oz + dz * t1;
        this.edges(z1);
        if (x1 <= this._el - SW || x1 >= this._er + SW) {
          this._ht = t1;
          this._hx = x1;
          this._hz = z1;
          this._htype = 2;
          return;
        }
        zg = z1;
      }
      if (oy > 0) {
        const t0 = -oy / dy;
        const x0 = ox + dx * t0;
        const z0 = oz + dz * t0;
        this.edges(z0);
        if (x0 > this._el && x0 < this._er) {
          best = t0;
          type = 1;
          bx = x0;
          bz = z0;
        }
        zg = z0;
      }
    }
    // the sloped banks: planes rising from the water edge to the bank top
    const k = BH / SW;
    for (let side = -1; side <= 1; side += 2) {
      this.edges(zg);
      let e = side < 0 ? this._el : this._er;
      for (let it = 0; it < 2; it++) {
        const den = k * side * dx - dy;
        if (Math.abs(den) < 1e-9) break;
        const t = (oy - k * side * (ox - e)) / den;
        if (!(t > 0) || t >= best) break;
        const zz = oz + dz * t;
        if (it === 0) {
          this.edges(zz);
          e = side < 0 ? this._el : this._er;
          continue;
        }
        const yy = oy + dy * t;
        if (yy >= -0.001 && yy <= BH + 0.001) {
          best = t;
          type = 3;
          bx = ox + dx * t;
          bz = zz;
        }
      }
    }
    // a low camera looking up at a bank top from inside the trench never sees it; a
    // camera above the banks that missed everything above has hit the far bank top
    this._ht = best;
    this._hx = bx;
    this._hz = bz;
    this._htype = type;
  }

  /**
   * The background (ridges, sky, clouds) along a ray from (ox, oy, oz). thg: horizontal
   * distance to the ground hit (Infinity for none); if the ground is nearer than the
   * curtain in the way, returns 0 (the caller shades ground). Else writes the wash colour
   * into out and returns the id; this._bt is the distance along the ray.
   */
  bg(ox, oy, oz, dx, dy, dz, thg, mt, t, out) {
    const hl = Math.sqrt(dx * dx + dz * dz) + 1e-9;
    const ux = dx / hl;
    const uz = dz / hl;
    const tanE = dy / hl;
    const Rs = this.ridges;
    const b = ox * ux + oz * uz;
    const c0 = ox * ox + oz * oz;
    for (let li = 0; li < Rs.length; li++) {
      const L = Rs[li];
      const th = -b + Math.sqrt(b * b - c0 + L.R * L.R);
      if (thg < th) return 0;
      if (tanE > mt[li]) continue;
      const Y = oy + tanE * th;
      if (Y < 0) continue;
      const px = ox + ux * th;
      const pz = oz + uz * th;
      const ang = atan2f(px, pz);
      let f = (ang + Math.PI) * (TAB / TWO_PI);
      let i = f | 0;
      if (i >= TAB) i = TAB - 1;
      f -= i;
      const top = L.h[i] + (L.h[i + 1] - L.h[i]) * f;
      if (Y >= top) continue;
      // a ridge: two flat tones split along spurs running down from the peaks
      const q = top - Y;
      let j = i - Math.round(((q / L.R) * L.skew * TAB) / TWO_PI);
      j = ((j % TAB) + TAB) % TAB;
      const sl = L.d[j] * (Math.cos(this.sun.az) > 0 ? 1 : -1);
      const lit = smooth(-0.02 * L.amp, 0.02 * L.amp, -sl);
      let r = L.sh[0] + (L.lit[0] - L.sh[0]) * lit;
      let g = L.sh[1] + (L.lit[1] - L.sh[1]) * lit;
      let bb = L.sh[2] + (L.lit[2] - L.sh[2]) * lit;
      // brush: darker masses (trees, scrub) on the near slopes
      if (L.brush > 0) {
        const tx = (ang * L.R) / 7;
        const n = samp(this.tex.ground[1].d, this.tex.ground[1].N, tx, Y * 0.35 + li * 50);
        const k = smooth(0.58, 0.64, n) * L.brush * smooth(top * 0.15, top * 0.5, q);
        r -= r * k * 2;
        g -= g * k * 2;
        bb -= bb * k * 1.8;
      }
      // pigment pools at the top edge of the wash
      const pxBelow = (q / th) * this.F;
      if (pxBelow < 2.2 && li < 3) {
        const k = 0.1 - li * 0.03;
        r -= r * k;
        g -= g * k;
        bb -= bb * k * 0.8;
      }
      // mist lying low between the ridges, drifting
      const mh = this.mistTab[li][Math.floor((i / TAB) * 512) & 511];
      const mk = (1 - smooth(0, mh, Y)) * 0.85;
      out[0] = r + (MIST[0] - r) * mk;
      out[1] = g + (MIST[1] - g) * mk;
      out[2] = bb + (MIST[2] - bb) * mk;
      this._bt = th / hl;
      return ID_RIDGE + li;
    }
    if (thg < Infinity) return 0;
    // the sky: vellum near the horizon, a cool grey wash overhead
    const e = smooth(-0.05, 0.7, dy);
    let r = SKY_HOR[0] + (SKY_ZEN[0] - SKY_HOR[0]) * e;
    let g = SKY_HOR[1] + (SKY_ZEN[1] - SKY_HOR[1]) * e;
    let bb = SKY_HOR[2] + (SKY_ZEN[2] - SKY_HOR[2]) * e;
    let id = ID_SKY;
    this._ca = 0;
    if (dy > 0.004) {
      const tc = (this.cloudH - oy) / dy;
      const T = this.cloudTexel;
      const cu = (ox + dx * tc + this.cloudWX * t) / T;
      const cv = (oz + dz * tc + this.cloudWZ * t) / T;
      const fp = tc / (this.F * Math.sqrt(dy));
      const lod = Math.log2(fp / T + 1e-6) + 0.3;
      const dens = sampMip(this.tex.cloud, cu, cv, lod);
      const hk = smooth(0.012, 0.16, dy);
      const th1 = this.cloudTh;
      const th2 = th1 + 0.1;
      if (dens > th1) {
        let cr;
        let cg;
        let cb;
        if (dens > th2) {
          const pool = dens < th2 + 0.035 ? 1 : 0;
          cr = pool ? CLOUD_POOL[0] : CLOUD_THICK[0];
          cg = pool ? CLOUD_POOL[1] : CLOUD_THICK[1];
          cb = pool ? CLOUD_POOL[2] : CLOUD_THICK[2];
          if (hk > 0.7) id = ID_THICK;
          this._ca = 0.8 * hk;
        } else {
          const pool = dens < th1 + 0.03 ? 0.6 : 0;
          cr = CLOUD_THIN[0] + (CLOUD_POOL[0] - CLOUD_THIN[0]) * pool;
          cg = CLOUD_THIN[1] + (CLOUD_POOL[1] - CLOUD_THIN[1]) * pool;
          cb = CLOUD_THIN[2] + (CLOUD_POOL[2] - CLOUD_THIN[2]) * pool;
          if (hk > 0.7) id = ID_THIN;
          this._ca = 0.5 * hk;
        }
        // clouds far off melt into the haze at the horizon
        const k = hk * 0.9;
        r += (cr - r) * k;
        g += (cg - g) * k;
        bb += (cb - bb) * k;
      }
    }
    out[0] = r;
    out[1] = g;
    out[2] = bb;
    this._bt = Infinity;
    return id;
  }

  /** Per-frame ridge limits: the steepest ray (tan of elevation) each layer can stop. */
  maxTans(ox, oy, oz) {
    const d = Math.hypot(ox, oz);
    return this.ridges.map((L) => (L.hmax - oy) / Math.max(1, L.R - d));
  }

  // ---------------------------------------------------------------- render

  /**
   * Draw the world into frame (W*H RGBA) at time t through camera cam.
   * opts:
   *   stage       paint stage 0 wash .. 1 lines .. 2 pencil .. 3 paper (fractional ok)
   *   actors      [{ X, Z, height (m, the layer's full height), layer | layerFor(px),
   *                  place(x, y, scale) (a Motion's placement), Y (feet height, default
   *                  the ground/riverbed), xf (extra placement: flip, rot...), opts
   *                  (drawSprite options), wade (default true), reflect (default true),
   *                  shadow (default true), stage, rings (0..1 wading rings), flat
   *                  ({ yaw }: lying on the water, seen from above), sink (0..1) }]
   *   impulses    [impulse(x, z, t0, strength)]: shock rings, reeds flattened outward
   *   rain        0..1 (default 0.6); rainWind [wx, wz] m/s
   *   wind        gust strength multiplier (default 1)
   *   foreground  [{ X, Z, kind: 'reeds' | 'stone', h, seed }] near-lens silhouettes
   *   splashes    [{ X, Z, t0, strength, seed }]; sprays [{ X, Z, age, ... }]
   *   clouds      coverage 0..1 (default 0.5)
   */
  render(frame, t, cam, o = {}) {
    const W = this.W;
    const H = this.H;
    const N = this.N;
    const paper = this.paper;
    const stage = Math.max(0, o.stage ?? 0);
    this.last = { cam, t };
    if (stage >= 3) {
      frame.set(paper);
      this.zbuf.fill(Infinity);
      this.ids.fill(0);
      this.stg.fill(3);
      return;
    }
    const B = basis(cam, W, H);
    this.B = B;
    this.F = B.F;
    const t2 = Math.floor(t * 12) / 12; // drawings on twos
    this.t = t;
    this.t2 = t2;
    const cov = o.clouds ?? 0.5;
    this.cloudTh = 0.72 - cov * 0.36;
    this.cloudWX = 22;
    this.cloudWZ = -9;
    this.rain = o.rain ?? 0.6;
    this.impulses = o.impulses || [];
    // drifting mist heights around each ridge circle
    this.mistTab = this.ridges.map((L, li) => {
      const a = new Float32Array(512);
      for (let i = 0; i < 512; i++)
        a[i] = L.mist * (0.45 + 0.9 * valueNoise(i / 18 + t * (0.05 + li * 0.02), li * 7.3, 91));
      return a;
    });
    this.line.fill(0);
    this.pencil.fill(0);
    this.passRays(B);
    this.passReflection(B, t);
    this.passShade(frame, B, t);
    this.drawSun(frame, B, t);
    this.drawStones(frame, B);
    this.passEdges(frame);
    this.drawReeds(frame, B, t2, o.wind ?? 1, true);
    this.drawReeds(frame, B, t2, o.wind ?? 1, false);
    this.combine(frame, stage);
    if (o.actors?.length) this.drawActors(frame, cam, B, t, o.actors, stage);
    for (const s of o.splashes || [])
      this.splashAt(frame, cam, s.X, s.Z, t, s.t0, s.strength ?? 1, s.seed ?? 1);
    for (const s of o.sprays || []) this.spraySheet(frame, cam, s);
    if (this.rain > 0) this.drawRain(frame, B, t, o.rainWind || [1.2, 0]);
    if (o.foreground?.length) this.drawForeground(frame, B, t2, o.foreground, o.wind ?? 1);
    for (let i = 0; i < N; i++) if (frame[i * 4 + 3] === 0) frame[i * 4 + 3] = 255;
  }

  /** Rays and ground hits for every pixel. */
  passRays(B) {
    const { W, H } = this;
    const { fx, fy, fz, rx, ry, rz, ux, uy, uz, F, cx, cy } = B;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const needGround = true;
    for (let y = 0; y < H; y++) {
      const b = -(y + 0.5 - cy) / F;
      for (let x = 0; x < W; x++) {
        const a = (x + 0.5 - cx) / F;
        let dx = fx + a * rx + b * ux;
        let dy = fy + a * ry + b * uy;
        let dz = fz + a * rz + b * uz;
        const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx *= il;
        dy *= il;
        dz *= il;
        const i = y * W + x;
        this.rdx[i] = dx;
        this.rdy[i] = dy;
        this.rdz[i] = dz;
        this.il[i] = il;
        if (needGround && (dy < 0 || oy < this.bankH)) {
          this.hitGround(ox, oy, oz, dx, dy, dz);
          this.gT[i] = this._ht;
          this.gX[i] = this._hx;
          this.gZ[i] = this._hz;
          this.gType[i] = this._htype;
        } else {
          this.gT[i] = Infinity;
          this.gType[i] = 0;
        }
      }
    }
  }

  /**
   * The background seen in the water: for each pixel whose ray goes down, the sky and
   * ridges along the mirrored ray from the camera mirrored in Y = 0. The Hollow Sun is
   * drawn into it too, so its reflection breaks up with the rest.
   */
  passReflection(B, t) {
    const { W, H } = this;
    const out = this.bgOut;
    const ox = B.ox;
    const oy = -B.oy;
    const oz = B.oz;
    const mt = this.maxTans(ox, oy, oz);
    const refl = this.refl;
    for (let i = 0; i < W * H; i++) {
      const dy = this.rdy[i];
      if (dy > 0.06) {
        this.reflId[i] = 0;
        continue;
      }
      const o = i * 4;
      if (dy >= -0.0005) {
        refl[o] = HAZE[0];
        refl[o + 1] = HAZE[1];
        refl[o + 2] = HAZE[2];
        this.reflId[i] = ID_SKY;
        continue;
      }
      const id = this.bg(ox, oy, oz, this.rdx[i], -dy, this.rdz[i], Infinity, mt, t, out);
      refl[o] = out[0];
      refl[o + 1] = out[1];
      refl[o + 2] = out[2];
      this.reflId[i] = id;
    }
    // the Hollow Sun in the water
    const s = this.sunDir();
    this.sunInto(refl, this.reflId, B, s[0], -s[1], s[2], t, true);
  }

  sunDir() {
    const { az, el } = this.sun;
    return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  }

  /** Draw the Hollow Sun at world direction (sx, sy, sz) into buf where the id is sky. */
  sunInto(buf, ids, B, sx, sy, sz, t, mirror = false) {
    const z = sx * B.fx + sy * B.fy + sz * B.fz;
    if (z <= 0.05) return null;
    const px = B.cx + ((sx * B.rx + sy * B.ry + sz * B.rz) * B.F) / z;
    const py = B.cy - ((sx * B.ux + sy * B.uy + sz * B.uz) * B.F) / z;
    const r = Math.max(2, (B.F * Math.tan(this.sun.r)) / z);
    const R = r + 9;
    const { W, H } = this;
    const x0 = Math.max(0, Math.floor(px - R));
    const x1 = Math.min(W - 1, Math.ceil(px + R));
    const y0 = Math.max(0, Math.floor(py - R));
    const y1 = Math.min(H - 1, Math.ceil(py + R));
    if (x0 > x1 || y0 > y1) return null;
    const tmp = this.tmp;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const o = (y * W + x) * 4;
        tmp[o] = buf[o];
        tmp[o + 1] = buf[o + 1];
        tmp[o + 2] = buf[o + 2];
      }
    hollowSun(tmp, W, H, px, py, r, t, 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const id = ids[i];
        if (id !== ID_SKY && id !== ID_THIN && id !== ID_THICK) continue;
        const o = i * 4;
        let a = 1;
        // clouds pass in front of the sun, but never hide it
        if (!mirror) a = 1 - this.cloudA[i] * 0.75;
        buf[o] = tmp[o] * a + this.cloudC[o] * (1 - a);
        buf[o + 1] = tmp[o + 1] * a + this.cloudC[o + 1] * (1 - a);
        buf[o + 2] = tmp[o + 2] * a + this.cloudC[o + 2] * (1 - a);
      }
    return { px, py, r };
  }

  /** Shade every pixel: sky, ridges, banks and water. */
  passShade(frame, B, t) {
    const { W, H } = this;
    const paper = this.paper;
    const out = this.bgOut;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const mt = this.maxTans(ox, oy, oz);
    const R0 = this.ridges[0].R - Math.hypot(ox, oz) - 1;
    this.cloudA.fill(0);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = i * 4;
        const dx = this.rdx[i];
        const dy = this.rdy[i];
        const dz = this.rdz[i];
        const gt = this.gT[i];
        const hl = Math.sqrt(dx * dx + dz * dz);
        const thg = gt * hl;
        let id = 0;
        if (!(thg < R0)) id = this.bg(ox, oy, oz, dx, dy, dz, thg, mt, t, out);
        if (id) {
          this.ids[i] = id;
          this.zbuf[i] = this._bt * this.il[i];
          let r = out[0];
          let g = out[1];
          let b = out[2];
          if (id >= ID_RIDGE) {
            // aerial perspective already in the layer colours
          } else if (this._ca > 0) {
            // keep the cloudless sky and the cloud colour, for the sun to sit between
            this.cloudA[i] = this._ca;
          }
          frame[o] = paper[o] * r * KR;
          frame[o + 1] = paper[o + 1] * g * KG;
          frame[o + 2] = paper[o + 2] * b * KB;
          frame[o + 3] = 255;
          if (this._ca > 0) {
            this.cloudC[o] = frame[o];
            this.cloudC[o + 1] = frame[o + 1];
            this.cloudC[o + 2] = frame[o + 2];
          }
          continue;
        }
        // ground
        const type = this.gType[i];
        const X = this.gX[i];
        const Z = this.gZ[i];
        this.zbuf[i] = gt * this.il[i];
        const fpA = gt / this.F; // pixel footprint across the view (m)
        const fpL = fpA / Math.max(0.03, -dy); // and along it
        const c = this.col;
        if (type === 1) {
          this.ids[i] = ID_WATER;
          this.shadeWater(i, x, y, X, Z, gt, dx, dy, dz, fpA, fpL, t, c);
        } else {
          this.ids[i] = type === 3 ? ID_SLOPE : ID_BANK;
          this.wdx[i] = 0;
          this.wdy[i] = 0;
          this.shadeBank(X, Z, gt, fpL, type, c);
        }
        // aerial perspective over the ground
        const fog = 1 - Math.exp(-gt / 240);
        const r = c[0] + (HAZE[0] - c[0]) * fog;
        const g = c[1] + (HAZE[1] - c[1]) * fog;
        const b = c[2] + (HAZE[2] - c[2]) * fog;
        frame[o] = paper[o] * r * KR;
        frame[o + 1] = paper[o + 1] * g * KG;
        frame[o + 2] = paper[o + 2] * b * KB;
        frame[o + 3] = 255;
      }
  }

  shadeBank(X, Z, gt, fpL, type, c) {
    const de = this.outside(X, Z);
    const lod = Math.log2(fpL / 0.6 + 1e-6);
    const n = sampMip(this.tex.ground, X / 0.6, Z / 0.6, lod);
    const n2 = sampMip(this.tex.ground, X / 5 + 40, Z / 5, Math.log2(fpL / 5 + 1e-6));
    // grass in two flat tones, mud toward the water
    const g = n2 > 0.52 ? 1 : 0;
    let r = GRASS_B[0] + (GRASS_A[0] - GRASS_B[0]) * g;
    let gg = GRASS_B[1] + (GRASS_A[1] - GRASS_B[1]) * g;
    let b = GRASS_B[2] + (GRASS_A[2] - GRASS_B[2]) * g;
    const mud = 1 - smooth(0.2, 1.6 + n * 1.8, de);
    r += (MUD[0] - r) * mud;
    gg += (MUD[1] - gg) * mud;
    b += (MUD[2] - b) * mud;
    if (type === 3) {
      const k = 0.55 + 0.3 * (1 - clamp(de / this.slopeW));
      r += (SLOPE_C[0] - r) * k;
      gg += (SLOPE_C[1] - gg) * k;
      b += (SLOPE_C[2] - b) * k;
    }
    // small dark tufts close up
    if (fpL < 0.05 && n > 0.72) {
      r *= 0.86;
      gg *= 0.86;
      b *= 0.88;
    }
    c[0] = r;
    c[1] = gg;
    c[2] = b;
  }

  shadeWater(i, x, y, X, Z, gt, dx, dy, dz, fpA, fpL, t, c) {
    const T = this.tex;
    const M = T.M;
    const flow = this.flow;
    const W = this.W;
    // wave slope: two octaves drifting with the current, fading out where they would
    // be finer than a few pixels (far water turns to a calmer mirror)
    const zf = Z + flow * t;
    const s1 = 0.075;
    const s2 = 0.026;
    const w1 = smooth(1.2, 5, (s1 * 32) / fpL);
    const w2 = smooth(1.2, 5, (s2 * 32) / fpL) * 0.6;
    let gx = 0;
    let gz = 0;
    if (w1 > 0) {
      const u = X / s1;
      const v = zf / s1 + 0.3 * t;
      gx += samp(T.gx, M, u, v) * w1;
      gz += samp(T.gz, M, u, v) * w1;
    }
    if (w2 > 0) {
      const u = X / s2 + 37;
      const v = (zf * 1.3) / s2 - 0.9 * t;
      gx += samp(T.gx, M, u, v) * w2;
      gz += samp(T.gz, M, u, v) * w2;
    }
    // slope -> screen displacement of the reflection: along the view it stretches the
    // image vertically (the glitter path); across it shifts it a little sideways
    const B = this.B;
    const hl = Math.sqrt(dx * dx + dz * dz) + 1e-9;
    const vx = dx / hl;
    const vz = dz / hl;
    const along = gx * vx + gz * vz;
    const across = gx * vz - gz * vx;
    const A = 9;
    let wdx = across * A * this.F * 0.012 * (0.4 + 0.6 * Math.abs(dy)) * 2.2;
    let wdy = along * A * this.F * 0.012 * 2.2;
    if (wdy > 26) wdy = 26;
    if (wdy < -26) wdy = -26;
    if (wdx > 8) wdx = 8;
    if (wdx < -8) wdx = -8;
    // shock rings from impulses: the surface jumps where the front passes
    let shock = 0;
    for (let k = 0; k < this.impulses.length; k++) {
      const im = this.impulses[k];
      const u = t - im.t0;
      if (u < 0 || u > 1.6) continue;
      const d = Math.hypot(X - im.x, Z - im.z);
      const r = 10 * u;
      const e = Math.exp(-(((d - r) / (0.35 + fpA)) ** 2)) * (1 - u / 1.6) * im.strength;
      shock = Math.max(shock, e);
      wdy += e * 10;
    }
    this.wdx[i] = wdx;
    this.wdy[i] = wdy;
    // sample the mirrored background
    let sx = Math.round(x + wdx);
    let sy = Math.round(y + wdy);
    if (sx < 0) sx = 0;
    if (sx >= W) sx = W - 1;
    if (sy < 0) sy = 0;
    if (sy >= this.H) sy = this.H - 1;
    let j = sy * W + sx;
    if (this.rdy[j] > 0.055) j = i; // displaced out of the reflection: stay put
    const ro = j * 4;
    let rr = this.refl[ro];
    let rg = this.refl[ro + 1];
    let rb = this.refl[ro + 2];
    let glint = 0;
    if (rr - rb > 70 && rr > 140) glint = 1; // the gold ring
    else if (rr < 24 && rg < 24 && rb < 30) glint = 2; // its black disc
    // the banks, seen in the water near the edges
    this.edges(Z);
    const tanR = -dy / hl;
    let dist = Infinity;
    if (vx > 0.02) dist = (this._er - X) / vx;
    else if (vx < -0.02) dist = (this._el - X) / vx;
    if (dist < Infinity) {
      const hb = (dist + (this.slopeW * 0.6) / Math.abs(vx)) * tanR;
      if (hb < this.bankH) {
        const k = 0.85;
        rr += (BANK_REFL[0] - rr) * k;
        rg += (BANK_REFL[1] - rg) * k;
        rb += (BANK_REFL[2] - rb) * k;
        glint = 0;
      }
    }
    // the water itself: the bed shows in the shallows, the deep is dark steel
    const el = this._el;
    const er = this._er;
    const half = (er - el) / 2;
    const ctr = (el + er) / 2;
    const dEdge = half - Math.abs(X - ctr);
    const depth = depthProfile(Math.abs(X - ctr) / half) * Math.sqrt(half / 8);
    const dk = 1 - Math.exp(-depth / 0.3);
    let br = BED[0] + (WATER_DEEP[0] - BED[0]) * dk;
    let bg = BED[1] + (WATER_DEEP[1] - BED[1]) * dk;
    let bb = BED[2] + (WATER_DEEP[2] - BED[2]) * dk;
    // reflectance: a mirror at grazing angles, clearer looking down
    const ad = -dy;
    const R = 0.28 + 0.66 * (1 - ad) ** 3;
    let r = br + (rr - br) * R;
    let g = bg + (rg - bg) * R;
    let b = bb + (rb - bb) * R;
    if (glint === 1) {
      r = 243;
      g = 203;
      b = 108;
    } else if (glint === 2) {
      r = r * 0.35 + 7;
      g = g * 0.35 + 6;
      b = b * 0.35 + 11;
    }
    // highlights: flow streaks, foam at stones and the edge, rain rings, the shock ring
    let foam = 0;
    if (fpA < 0.25) {
      const su = X / 0.04;
      const sv = zf / 0.12;
      const s = samp(T.streak, M, su, sv);
      const fade = 1 - smooth(0.08, 0.25, fpA);
      foam = Math.max(foam, smooth(0.8, 0.86, s) * 0.7 * fade);
    }
    // the edge laps
    if (dEdge < Math.max(0.1, fpA * 1.2)) {
      const n = valueNoise(Z * 3 + t * 2, X, 5);
      if (n > 0.35) foam = Math.max(foam, 0.8);
    }
    // stones: a foam collar and a wake downstream
    const cell = this.sgrid.get(Math.floor(X / 4) * 7919 + Math.floor(Z / 4));
    if (cell && gt < 90) {
      for (let k = 0; k < cell.length; k++) {
        const s = cell[k];
        const ddx = X - s.X;
        const ddz = Z - s.Z;
        const e = Math.sqrt((ddx / s.a) ** 2 + (ddz / s.c) ** 2);
        const rim = 0.12 / s.a + fpA / s.a;
        if (e > 0.9 && e < 1 + rim * 1.6) {
          const n = valueNoise(Math.atan2(ddz, ddx) * 4 + t * 3, e * 6, 17);
          if (n > 0.3) foam = Math.max(foam, 0.95);
        }
        const dn = -ddz - s.c * 0.4;
        if (dn > 0 && dn < 5) {
          const spread = s.a * (0.75 + 0.22 * dn);
          const lat = Math.abs(ddx);
          const arm = Math.exp(-(((lat - spread) / (0.07 + 0.03 * dn + fpA)) ** 2));
          const mid = lat < spread ? 0.5 * Math.exp(-dn / 1.2) : 0;
          const n = samp(T.streak, M, (ddx / 0.03) | 0, (ddz + flow * t * 1.4) / 0.08);
          const k2 = Math.max(arm, mid) * Math.exp(-dn / 2.6) * smooth(0.45, 0.7, n);
          foam = Math.max(foam, k2);
        }
      }
    }
    // rain rings: each 0.9 m cell has a drop every so often
    if (this.rain > 0 && gt < 32) {
      const cs = 0.9;
      const gx0 = Math.floor(X / cs - 0.5);
      const gz0 = Math.floor(Z / cs - 0.5);
      const w = Math.max(0.018, fpA * 0.8);
      for (let a = 0; a < 2; a++)
        for (let bq = 0; bq < 2; bq++) {
          const cx = gx0 + a;
          const cz = gz0 + bq;
          if (hash(cx, cz, 201) > this.rain) continue;
          const per = 0.6 + hash(cx, cz, 202) * 0.7;
          const ph = hash(cx, cz, 203) * per;
          const n = Math.floor((t + ph) / per);
          const age = t + ph - n * per;
          if (age > 0.6) continue;
          const px = (cx + 0.2 + hash(cx * 3 + n, cz, 204) * 0.6) * cs;
          const pz = (cz + 0.2 + hash(cx, cz * 3 + n, 205) * 0.6) * cs;
          const d = Math.hypot(X - px, Z - pz);
          const rr2 = 0.03 + age * 0.55;
          if (Math.abs(d - rr2) < w) foam = Math.max(foam, (1 - age / 0.6) * 0.9);
        }
    }
    if (shock > 0.2) foam = Math.max(foam, shock);
    if (foam > 0) {
      r += (FOAM[0] - r) * foam;
      g += (FOAM[1] - g) * foam;
      b += (FOAM[2] - b) * foam;
    }
    c[0] = r;
    c[1] = g;
    c[2] = b;
  }

  /** The Hollow Sun in the sky, between the sky wash and the clouds. */
  drawSun(frame, B, t) {
    const s = this.sunDir();
    this.sunBox = this.sunInto(frame, this.ids, B, s[0], s[1], s[2], t, false);
  }

  // ---------------------------------------------------------------- stones

  /** Ray (from the camera, unit d) against stone s: sets this._st (Infinity: miss). */
  stoneHit(s, ox, oy, oz, dx, dy, dz) {
    const vx = ox - s.X;
    const vy = oy - s.cy;
    const vz = oz - s.Z;
    const lx = (vx * s.ex - vz * s.ez) / s.a;
    const ly = vy / s.ry;
    const lz = (vx * s.ez + vz * s.ex) / s.c;
    const ex = (dx * s.ex - dz * s.ez) / s.a;
    const ey = dy / s.ry;
    const ez = (dx * s.ez + dz * s.ex) / s.c;
    const A = ex * ex + ey * ey + ez * ez;
    const Bq = 2 * (lx * ex + ly * ey + lz * ez);
    const Cq = lx * lx + ly * ly + lz * lz - 1;
    const disc = Bq * Bq - 4 * A * Cq;
    if (disc < 0) {
      this._st = Infinity;
      return;
    }
    const sq = Math.sqrt(disc);
    const t = (-Bq - sq) / (2 * A);
    this._st = t;
    this._sn = [lx + ex * t, ly + ey * t, lz + ez * t];
  }

  drawStones(frame, B) {
    const { W, H } = this;
    const paper = this.paper;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const Lx = 0.35;
    const Ly = 0.8;
    const Lz = -0.3;
    for (const s of this.stones) {
      // screen box of the stone and its mirror image
      const r = Math.max(s.a, s.c);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let behind = 0;
      for (let k = 0; k < 8; k++) {
        const X = s.X + (k & 1 ? r : -r);
        const Z = s.Z + (k & 2 ? r : -r);
        const Y = k & 4 ? s.top : -s.top - 0.05;
        const vx = X - ox;
        const vy = Y - oy;
        const vz = Z - oz;
        const z = vx * B.fx + vy * B.fy + vz * B.fz;
        if (z < NEAR) {
          behind++;
          continue;
        }
        const sx = B.cx + ((vx * B.rx + vy * B.ry + vz * B.rz) * B.F) / z;
        const sy = B.cy - ((vx * B.ux + vy * B.uy + vz * B.uz) * B.F) / z;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
      if (behind === 8) continue;
      if (behind > 0) {
        x0 = 0;
        y0 = 0;
        x1 = W;
        y1 = H;
      }
      const X0 = Math.max(0, Math.floor(x0) - 1);
      const X1 = Math.min(W - 1, Math.ceil(x1) + 1);
      const Y0 = Math.max(0, Math.floor(y0) - 1);
      const Y1 = Math.min(H - 1, Math.ceil(y1) + 1);
      if (X0 > X1 || Y0 > Y1) continue;
      const id = ID_STONE + (s.i % 150);
      for (let y = Y0; y <= Y1; y++)
        for (let x = X0; x <= X1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          this.stoneHit(s, ox, oy, oz, dx, dy, dz);
          const st = this._st;
          const o = i * 4;
          if (st > 0 && st < Infinity) {
            const hy = oy + dy * st;
            const z = st * this.il[i];
            if (hy > 0 && z < this.zbuf[i]) {
              // flat washes: lit, mid, shadow; dark and wet at the waterline
              const [nx0, ny0, nz0] = this._sn;
              const nxw = (nx0 / s.a) * s.ex + (nz0 / s.c) * s.ez;
              const nzw = -(nx0 / s.a) * s.ez + (nz0 / s.c) * s.ex;
              const nyw = ny0 / s.ry;
              const nl = Math.hypot(nxw, nyw, nzw);
              const dif = (nxw * Lx + nyw * Ly + nzw * Lz) / nl;
              let c = dif > 0.62 ? STONE_LIT : dif > 0.2 ? STONE_MID : STONE_SH;
              if (s.moss && nyw / nl > 0.8 && dif > 0.62) c = STONE_MOSS;
              if (hy < 0.035 + 0.02 * s.a || s.slick) c = hy < 0.04 ? STONE_WET : c === STONE_LIT ? STONE_MID : c;
              const tn = s.tone;
              frame[o] = paper[o] * c[0] * KR * tn;
              frame[o + 1] = paper[o + 1] * c[1] * KG * tn;
              frame[o + 2] = paper[o + 2] * c[2] * KB * tn;
              this.zbuf[i] = z;
              this.ids[i] = id;
              continue;
            }
            if (hy <= 0 && this.ids[i] === ID_WATER && hy > -0.4) {
              // the stone under the surface darkens the water
              const k = 0.18 * (1 + hy / 0.4);
              frame[o] *= 1 - k;
              frame[o + 1] *= 1 - k;
              frame[o + 2] *= 1 - k * 0.8;
            }
          }
          // its reflection in the water
          if (this.ids[i] !== ID_WATER) continue;
          let jx = Math.round(x + this.wdx[i] * 0.6);
          let jy = Math.round(y + this.wdy[i] * 0.6);
          jx = jx < 0 ? 0 : jx >= W ? W - 1 : jx;
          jy = jy < 0 ? 0 : jy >= H ? H - 1 : jy;
          const j = jy * W + jx;
          const qy = this.rdy[j];
          if (qy >= -1e-4) continue;
          const t0 = -oy / qy;
          const px = ox + this.rdx[j] * t0;
          const pz = oz + this.rdz[j] * t0;
          this.stoneHit(s, px, 0, pz, this.rdx[j], -qy, this.rdz[j]);
          if (this._st > 0 && this._st < 30 && -qy * this._st > 0.0) {
            const R = 0.28 + 0.66 * (1 + qy) ** 3;
            const k = 0.7 * R;
            frame[o] += (paper[o] * STONE_SH[0] * KR - frame[o]) * k;
            frame[o + 1] += (paper[o + 1] * STONE_SH[1] * KG - frame[o + 1]) * k;
            frame[o + 2] += (paper[o + 2] * STONE_SH[2] * KB - frame[o + 2]) * k;
          }
        }
    }
  }

  // ---------------------------------------------------------------- lines

  /**
   * Ink where one shape meets another (the world's own contours): near ridges, cloud
   * cores, stones, the water's edge. Writes the stage-0 ink into the frame and the
   * line/pencil coverage for the drawing stages.
   */
  passEdges(frame) {
    const { W, H } = this;
    const ids = this.ids;
    const zb = this.zbuf;
    const line = this.line;
    const pencil = this.pencil;
    const nb = [-1, 1, -W, W];
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const a = ids[i];
        const za = zb[i];
        let wash = 0; // 0 none, else weight of sepia (>1: graphite)
        let ln = 0;
        let pc = 0;
        for (let k = 0; k < 4; k++) {
          const n = i + nb[k];
          const b = ids[n];
          if (b === a) continue;
          if (a >= ID_STONE && a < ID_STONE + 150) {
            if (za < zb[n]) {
              const near = za < 30 ? 1 : 0.5;
              wash = Math.max(wash, near);
              ln = 1;
              pc = Math.max(pc, za < 14 ? 1 : 0);
            }
          } else if (a >= ID_RIDGE && a < ID_RIDGE + 4) {
            if ((b < ID_RIDGE || b > a) && b < ID_BANK) {
              const li = a - ID_RIDGE;
              if (li === 0) {
                wash = Math.max(wash, 1);
                ln = 1;
                pc = 1;
              } else if (li === 1) {
                wash = Math.max(wash, 2.55);
                ln = Math.max(ln, 1);
                pc = Math.max(pc, 0.5);
              } else ln = Math.max(ln, li === 2 ? 0.7 : 0.4);
            }
          } else if (a === ID_THICK && b === ID_SKY) {
            wash = Math.max(wash, 2.5);
            ln = Math.max(ln, 0.85);
          } else if ((a === ID_BANK || a === ID_SLOPE) && b === ID_WATER) {
            const k = 1 - smooth(8, 40, za);
            if (k > 0) {
              wash = Math.max(wash, 2 + 0.7 * k);
              ln = Math.max(ln, 1 - smooth(25, 70, za));
              pc = Math.max(pc, 1 - smooth(8, 22, za));
            }
          } else if (a === ID_BANK && b === ID_SLOPE && za < zb[n]) {
            ln = Math.max(ln, (1 - smooth(10, 35, za)) * 0.8);
          }
        }
        if (ln > 0) line[i] = Math.max(line[i], ln);
        if (pc > 0) pencil[i] = Math.max(pencil[i], pc);
        if (wash > 0) {
          const o = i * 4;
          if (wash <= 1) {
            if (wash > bayer(x, y) * 0.9) {
              frame[o] = SEPIA[0];
              frame[o + 1] = SEPIA[1];
              frame[o + 2] = SEPIA[2];
            }
          } else if (wash - 2 > bayer(x + 1, y + 2)) {
            frame[o] = GRAPHITE[0];
            frame[o + 1] = GRAPHITE[1];
            frame[o + 2] = GRAPHITE[2];
          }
        }
      }
  }

  // ---------------------------------------------------------------- reeds

  /** Gust strength 0..1 at (X, Z): bands of wind travelling across the field. */
  gust(X, Z, t) {
    const wd = this.wind.dir;
    const p = X * Math.cos(wd) + Z * Math.sin(wd);
    const q = -X * Math.sin(wd) + Z * Math.cos(wd);
    const w = 0.5 + 0.5 * Math.sin(p * 0.45 - t * 2.6 + valueNoise(q * 0.06, p * 0.03, 9) * 5);
    const w2 = 0.5 + 0.5 * Math.sin(p * 1.3 - t * 5.5 + q * 0.2);
    return w * w * w * 0.8 + w2 * 0.2;
  }

  /** Outward push of the impulses at (X, Z): [px, pz] (radians of bend). */
  push(X, Z, t) {
    let px = 0;
    let pz = 0;
    for (const im of this.impulses) {
      const u = t - im.t0;
      if (u < 0 || u > 3) continue;
      const dx = X - im.x;
      const dz = Z - im.z;
      const d = Math.hypot(dx, dz) + 1e-6;
      const tau = u - d / 11;
      if (tau < 0) continue;
      const k = im.strength * (1.25 / (1 + d / 7)) * Math.exp(-tau * 2.4) * Math.cos(tau * 7);
      px += (dx / d) * k;
      pz += (dz / d) * k;
    }
    return [px, pz];
  }

  /**
   * The reeds: ink strokes with a little wash, bending with the gusts, drawn on twos.
   * mirror: their reflections in the water (drawn first).
   */
  drawReeds(frame, B, t2, windK, mirror) {
    const { W, H } = this;
    const paper = this.paper;
    const C_ = this.clumps;
    const BL = this.blades;
    const { fx, fy, fz, rx, ry, rz, ux, uy, uz, F, cx, cy } = B;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const wd = this.wind.dir;
    const wcx = Math.cos(wd);
    const wcz = Math.sin(wd);
    const str = this.wind.strength * windK;
    const pts = this._rp || (this._rp = new Float32Array(15));
    const hasImp = this.impulses.length > 0;
    for (let c = 0; c < C_.length; c += 7) {
      const X = C_[c];
      const Yb = C_[c + 1];
      const Z = C_[c + 2];
      const maxH = C_[c + 5];
      const de = C_[c + 6];
      if (mirror && de > 2.2) continue;
      const vx = X - ox;
      const vy = Yb + maxH * 0.5 - oy;
      const vz = Z - oz;
      const z = vx * fx + vy * fy + vz * fz;
      if (z < 0.4 || z > 75) continue;
      const iz = F / z;
      if (iz * maxH < 1.6) continue;
      const sx = cx + (vx * rx + vy * ry + vz * rz) * iz;
      const sy = cy - (vx * ux + vy * uy + vz * uz) * iz;
      const m = maxH * iz * 1.6 + 4;
      if (sx < -m || sx > W + m || sy < -m || sy > H + m + (mirror ? m : 0)) continue;
      const g = this.gust(X, Z, t2);
      let ipx = 0;
      let ipz = 0;
      if (hasImp) [ipx, ipz] = this.push(X, Z, t2);
      const fog = smooth(6, 75, z) * 0.8;
      const ink = z < 12 && !mirror;
      const cr = REED_T[0] + (HAZE[0] - REED_T[0]) * fog;
      const cg = REED_T[1] + (HAZE[1] - REED_T[1]) * fog;
      const cb = REED_T[2] + (HAZE[2] - REED_T[2]) * fog;
      const lineCov = z < 30 ? 1 : 0;
      const penCov = z < 9 ? 1 : 0;
      const wide = iz > 110 && !mirror;
      const first = C_[c + 3];
      const nb = C_[c + 4];
      for (let bI = 0; bI < nb; bI++) {
        const q = (first + bI) * 9;
        const bx = BL[q];
        const by = BL[q + 1];
        const bz = BL[q + 2];
        const h = BL[q + 3];
        const ph = BL[q + 6];
        const stiff = BL[q + 7];
        const flutter = 0.06 * Math.sin(t2 * 7.5 + ph) * str;
        const bend = ((0.1 + 0.62 * g) * str) / stiff + flutter;
        let tx = BL[q + 4] + wcx * bend + ipx / stiff;
        let tz = BL[q + 5] + wcz * bend + ipz / stiff;
        const th = Math.min(1.45, Math.hypot(tx, tz));
        const tl = Math.hypot(tx, tz) + 1e-6;
        tx /= tl;
        tz /= tl;
        // 4 segments, bending more toward the tip
        let px = bx;
        let py = by;
        let pz = bz;
        const seg = h / 4;
        for (let k = 0; k <= 4; k++) {
          if (k > 0) {
            const phi = th * ((k - 0.5) / 4) ** 1.3;
            px += tx * Math.sin(phi) * seg;
            pz += tz * Math.sin(phi) * seg;
            py += Math.cos(phi) * seg;
          }
          const Y = mirror ? -py : py;
          const qx = px - ox;
          const qy = Y - oy;
          const qz = pz - oz;
          const zz = qx * fx + qy * fy + qz * fz;
          if (zz < NEAR) {
            pts[k * 3 + 2] = -1;
            continue;
          }
          const izz = F / zz;
          pts[k * 3] = cx + (qx * rx + qy * ry + qz * rz) * izz;
          pts[k * 3 + 1] = cy - (qx * ux + qy * uy + qz * uz) * izz;
          pts[k * 3 + 2] = zz;
        }
        for (let k = 0; k < 4; k++) {
          const a = k * 3;
          if (pts[a + 2] < 0 || pts[a + 5] < 0) continue;
          const x0 = pts[a];
          const y0 = pts[a + 1];
          const x1 = pts[a + 3];
          const y1 = pts[a + 4];
          const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
          for (let s = 0; s <= n; s++) {
            const u = s / n;
            const X_ = Math.round(x0 + (x1 - x0) * u);
            const Y_ = Math.round(y0 + (y1 - y0) * u);
            if (X_ < 0 || Y_ < 0 || X_ >= W || Y_ >= H) continue;
            const i = Y_ * W + X_;
            const o = i * 4;
            if (mirror) {
              if (this.ids[i] !== ID_WATER) continue;
              // broken by the same waves as the rest of the reflection
              const ii = i;
              const jx = Math.round(X_ - this.wdx[ii] * 0.5);
              const jy = Math.round(Y_ - this.wdy[ii] * 0.5);
              if (jx < 0 || jy < 0 || jx >= W || jy >= H) continue;
              const j = jy * W + jx;
              if (this.ids[j] !== ID_WATER) continue;
              const oj = j * 4;
              frame[oj] = frame[oj] * 0.66 + paper[oj] * 0.07;
              frame[oj + 1] = frame[oj + 1] * 0.66 + paper[oj + 1] * 0.07;
              frame[oj + 2] = frame[oj + 2] * 0.68 + paper[oj + 2] * 0.08;
              continue;
            }
            const zz = pts[a + 2];
            if (zz >= this.zbuf[i]) continue;
            this.zbuf[i] = zz;
            this.ids[i] = ID_REED;
            if (ink) {
              frame[o] = SEPIA[0];
              frame[o + 1] = SEPIA[1];
              frame[o + 2] = SEPIA[2];
            } else {
              frame[o] = paper[o] * cr * KR;
              frame[o + 1] = paper[o + 1] * cg * KG;
              frame[o + 2] = paper[o + 2] * cb * KB;
            }
            if (lineCov) this.line[i] = 1;
            if (penCov) this.pencil[i] = 1;
            // a little wash beside the stroke when close
            if (wide && k < 3 && X_ + 1 < W && zz < this.zbuf[i + 1]) {
              const o2 = o + 4;
              frame[o2] = paper[o2] * REED_T[0] * 1.25 * KR;
              frame[o2 + 1] = paper[o2 + 1] * REED_T[1] * 1.25 * KG;
              frame[o2 + 2] = paper[o2 + 2] * REED_T[2] * 1.25 * KB;
              this.zbuf[i + 1] = zz;
              this.ids[i + 1] = ID_REED;
            }
          }
        }
        // seed heads
        if (!mirror && BL[q + 8] && iz > 30 && pts[14] > 0) {
          const hx = Math.round(pts[12]);
          const hy = Math.round(pts[13]);
          const sz = iz > 90 ? 2 : 1;
          for (let dy = 0; dy < sz + 1; dy++)
            for (let dx = 0; dx < sz; dx++) {
              const X_ = hx + dx;
              const Y_ = hy + dy - 1;
              if (X_ < 0 || Y_ < 0 || X_ >= W || Y_ >= H) continue;
              const i = Y_ * W + X_;
              if (pts[14] >= this.zbuf[i]) continue;
              const o = i * 4;
              const cc = ink ? SEPIA : [paper[o] * cr * KR * 0.8, paper[o + 1] * cg * KG * 0.8, paper[o + 2] * cb * KB * 0.8];
              frame[o] = cc[0];
              frame[o + 1] = cc[1];
              frame[o + 2] = cc[2];
              this.zbuf[i] = pts[14];
              if (lineCov) this.line[i] = 1;
            }
        }
      }
    }
  }

  // ---------------------------------------------------------------- stages

  /** Turn the wash into lines, pencil or paper, pixel by pixel, by the dissolve mask. */
  combine(frame, stage) {
    const { W, H } = this;
    const k = Math.floor(stage);
    const f = stage - k;
    if (k === 0 && f === 0) {
      this.stg.fill(0);
      return;
    }
    const paper = this.paper;
    const T = 0.12;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const st = f > this.thr[i] ? k + 1 : k;
        this.stg[i] = st;
        if (st === 0) continue;
        const o = i * 4;
        if (st >= 3) {
          frame[o] = paper[o];
          frame[o + 1] = paper[o + 1];
          frame[o + 2] = paper[o + 2];
          continue;
        }
        const cov = st === 1 ? this.line[i] : this.pencil[i];
        if (cov > bayer(x + 3, y + 5) * 0.9 + 0.05) {
          const c = st === 1 ? SEPIA : GRAPHITE;
          frame[o] = c[0];
          frame[o + 1] = c[1];
          frame[o + 2] = c[2];
        } else {
          const tt = st === 1 ? T : 0;
          frame[o] = paper[o] * (1 - tt) + frame[o] * tt;
          frame[o + 1] = paper[o + 1] * (1 - tt) + frame[o + 1] * tt;
          frame[o + 2] = paper[o + 2] * (1 - tt) + frame[o + 2] * tt;
        }
      }
  }

  // ---------------------------------------------------------------- actors

  /**
   * Figures in the world: placed from project(), depth-tested with the reeds and stones,
   * cut at the waterline (with a ripple and foam), reflected, shadowed on the banks.
   */
  drawActors(frame, cam, B, t, actors, stage) {
    const list = actors
      .map((a) => ({ a, z: project(cam, a.X, 0, a.Z, this.W, this.H).depth }))
      .filter((e) => e.z > 0.3)
      .sort((p, q) => q.z - p.z);
    for (const { a } of list) this.drawActor(frame, cam, B, t, a, stage);
  }

  drawActor(frame, cam, B, t, a, stage) {
    const { W, H } = this;
    const paper = this.paper;
    const ground = this.groundY(a.X, a.Z);
    const depth = Math.max(0, -ground);
    const Y0 = a.Y ?? ground;
    const feet = project(cam, a.X, Y0, a.Z, W, H);
    if (feet.depth < 0.3) return;
    if (a.flat) return this.drawFlatActor(frame, cam, B, t, a, stage);
    const head = project(cam, a.X, Y0 + a.height, a.Z, W, H);
    const vx = head.sx - feet.sx;
    const vy = head.sy - feet.sy;
    const pxH = Math.hypot(vx, vy);
    if (pxH < 2) return;
    const layer = a.layer || a.layerFor(pxH);
    const st = layer.st;
    const s = (feet.scale * a.height) / st.h;
    const sy = pxH / (feet.scale * a.height);
    const rot = Math.atan2(vx, -vy);
    const base = a.place ? a.place(feet.sx, feet.sy, s) : { x: feet.sx, y: feet.sy, ax: st.w / 2, ay: st.h, scale: s };
    const xf = { ...base, ...(a.xf || {}) };
    xf.x = base.x;
    xf.y = base.y;
    xf.scale = base.scale ?? s;
    xf.rot = (xf.rot || 0) + rot;
    xf.sy = (xf.sy ?? 1) * sy;
    const cam2 = { x: W / 2, y: H / 2, zoom: 1, rot: 0 };
    // the figure's screen box
    const m = layerMatrix(xf, cam2, W, H);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [u, v] of [
      [0, 0],
      [st.w, 0],
      [0, st.h],
      [st.w, st.h],
    ]) {
      const X = m[0] * u + m[1] * v + m[2];
      const Y = m[3] * u + m[4] * v + m[5];
      x0 = Math.min(x0, X);
      y0 = Math.min(y0, Y);
      x1 = Math.max(x1, X);
      y1 = Math.max(y1, Y);
    }
    const pad = a.opts?.warp ? 9 : 2;
    const X0 = Math.max(0, Math.floor(x0 - pad));
    const Y0s = Math.max(0, Math.floor(y0 - pad));
    const X1 = Math.min(W, Math.ceil(x1 + pad));
    const Y1 = Math.min(H, Math.ceil(y1 + pad));
    if (X0 >= X1 || Y0s >= Y1) return;
    const sc = this.scratch;
    for (let y = Y0s; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const o = (y * W + x) * 4;
        sc[o] = 1;
        sc[o + 1] = 0;
        sc[o + 2] = 1;
        sc[o + 3] = 0;
      }
    const sA = a.stage ?? stage;
    drawSprite(sc, W, H, paper, layer, sA, xf, cam2, a.opts || {});
    const drawn = (o) => sc[o + 3] !== 0 && !(sc[o] === 1 && sc[o + 1] === 0 && sc[o + 2] === 1);
    // the waterline: world Y = 0 on the figure's card
    const wade = a.wade !== false && depth > 0.02 && Y0 < 0;
    const len = pxH || 1;
    const ax = vx / len;
    const ay = vy / len; // unit, up the figure
    const pw = project(cam, a.X, 0, a.Z, W, H);
    const t2 = this.t2;
    const aboveW = (x, y) =>
      (x - pw.sx) * ax + (y - pw.sy) * ay + 0.6 * Math.sin(x * 0.8 + t2 * 9) + 0.4 * Math.sin(x * 1.9 - t2 * 13);
    const zA = feet.depth;
    // reflection: the part above the water, flipped about the waterline, broken by the
    // waves, darker and a little blue
    if (a.reflect !== false && (wade || Y0 < 0.5)) {
      const pwr = wade ? pw : project(cam, a.X, 0, a.Z, W, H);
      const off = wade ? 0 : (Y0 * feet.scale) | 0;
      const ry1 = Math.min(H, Math.ceil(pwr.sy + (pwr.sy - y0) + 4 + off * 2));
      const ry0 = Math.max(0, Math.floor(pwr.sy - 2));
      const rx0 = Math.max(0, X0 - 8);
      const rx1 = Math.min(W, X1 + 8);
      for (let y = ry0; y < ry1; y++)
        for (let x = rx0; x < rx1; x++) {
          const i = y * W + x;
          if (this.ids[i] !== ID_WATER || this.stg[i] !== 0) continue;
          const d = -((x - pwr.sx) * ax + (y - pwr.sy) * ay);
          if (d <= 0) continue;
          const brk = clamp(d / (feet.scale * 1.2));
          const jx = x + this.wdx[i] * brk * 0.45 + 0.8 * Math.sin(y * 0.9 + t2 * 8) * brk;
          const jy = y + this.wdy[i] * brk * 0.12;
          // mirror across the waterline (through pwr, along the figure's axis)
          const dd = -((jx - pwr.sx) * ax + (jy - pwr.sy) * ay);
          const sx = Math.round(jx + 2 * dd * ax - (wade ? 0 : 2 * off * ax));
          const syy = Math.round(jy + 2 * dd * ay - (wade ? 0 : 2 * off * ay));
          if (sx < X0 || syy < Y0s || sx >= X1 || syy >= Y1) continue;
          const so = (syy * W + sx) * 4;
          if (!drawn(so)) continue;
          if (wade && aboveW(sx, syy) < 0) continue;
          const o = i * 4;
          const fade = 0.62 * (1 - smooth(0.4, 1, d / (len * 1.05)));
          if (fade <= 0) continue;
          frame[o] += (sc[so] * 0.62 + 12 - frame[o]) * fade;
          frame[o + 1] += (sc[so + 1] * 0.66 + 16 - frame[o + 1]) * fade;
          frame[o + 2] += (sc[so + 2] * 0.72 + 28 - frame[o + 2]) * fade;
        }
    }
    // rings spreading from the legs
    if (wade) {
      const rk = a.rings ?? 0.6;
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.8 + k / 3 + hash(k, 1, (a.seed ?? 1) * 7) * 0.1) % 1;
        const rad = 0.22 + ph * 0.75;
        const al = (1 - ph) * rk;
        this.ringOnWater(frame, cam, a.X, a.Z, rad, al, 0.55, zA);
      }
    }
    // a contact shadow on the bank
    if (!wade && a.shadow !== false && Y0 > -0.01) {
      const rx = 0.42 * feet.scale;
      const ry = Math.max(1, rx * clamp(Math.abs(this.rdy[this.pix(feet.sx, feet.sy)] || 0.2) * 1.2, 0.12, 1));
      for (let y = Math.floor(feet.sy - ry); y <= feet.sy + ry; y++)
        for (let x = Math.floor(feet.sx - rx); x <= feet.sx + rx; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = y * W + x;
          const id = this.ids[i];
          if ((id !== ID_BANK && id !== ID_SLOPE) || this.stg[i] !== 0) continue;
          const e = ((x - feet.sx) / rx) ** 2 + ((y - feet.sy) / ry) ** 2;
          if (e > 1) continue;
          if ((1 - e) * 1.4 < bayer(x, y)) continue;
          const o = i * 4;
          frame[o] *= 0.8;
          frame[o + 1] *= 0.8;
          frame[o + 2] *= 0.83;
        }
    }
    // the body: hidden below the ripple line, foam where the water meets it
    for (let y = Y0s; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const o = (y * W + x) * 4;
        if (!drawn(o)) continue;
        const i = y * W + x;
        if (wade) {
          const h = aboveW(x, y);
          if (h < 0) {
            // below the surface: a faint, water-tinted ghost of the legs in the shallows
            if (depth < 0.7 && h > -feet.scale * 0.35 && this.stg[i] === 0 && bayer(x, y) < 0.25) {
              frame[o] = frame[o] * 0.72 + sc[o] * 0.18;
              frame[o + 1] = frame[o + 1] * 0.72 + sc[o + 1] * 0.2;
              frame[o + 2] = frame[o + 2] * 0.72 + sc[o + 2] * 0.24;
            }
            continue;
          }
          if (zA >= this.zbuf[i]) continue;
          if (h < 1.1 && this.stg[i] === 0 && hash(x, t2 * 12, 5) > 0.25) {
            frame[o] = paper[o] * FOAM[0] * KR;
            frame[o + 1] = paper[o + 1] * FOAM[1] * KG;
            frame[o + 2] = paper[o + 2] * FOAM[2] * KB;
            this.zbuf[i] = zA;
            this.ids[i] = ID_ACTOR;
            continue;
          }
        } else if (zA >= this.zbuf[i]) continue;
        frame[o] = sc[o];
        frame[o + 1] = sc[o + 1];
        frame[o + 2] = sc[o + 2];
        frame[o + 3] = sc[o + 3];
        this.zbuf[i] = zA;
        this.ids[i] = ID_ACTOR;
      }
  }

  pix(x, y) {
    const X = Math.max(0, Math.min(this.W - 1, Math.round(x)));
    const Y = Math.max(0, Math.min(this.H - 1, Math.round(y)));
    return Y * this.W + X;
  }

  /**
   * A figure lying on the water (seen from above: the fall). a.flat = { yaw } turns the
   * card's head toward yaw; a.sink (0..1) lets the water over it in patches.
   */
  drawFlatActor(frame, cam, B, t, a, stage) {
    const { W, H } = this;
    const paper = this.paper;
    const yaw = a.flat.yaw ?? 0;
    const hx = Math.sin(yaw);
    const hz = Math.cos(yaw);
    const Yp = 0.03;
    const feet = project(cam, a.X, Yp, a.Z, W, H);
    const head = project(cam, a.X + hx * a.height, Yp, a.Z + hz * a.height, W, H);
    const side = project(cam, a.X + hz, Yp, a.Z - hx, W, H);
    const vx = head.sx - feet.sx;
    const vy = head.sy - feet.sy;
    const pxH = Math.hypot(vx, vy);
    if (pxH < 2) return;
    const layer = a.layer || a.layerFor(pxH);
    const st = layer.st;
    const pxW = Math.hypot(side.sx - feet.sx, side.sy - feet.sy); // px per metre across
    const s = (pxW * a.height) / st.h;
    const xf = {
      x: feet.sx,
      y: feet.sy,
      ax: st.w / 2,
      ay: st.h,
      scale: s,
      sy: pxH / (pxW * a.height),
      rot: Math.atan2(vx, -vy),
      ...(a.xf || {}),
    };
    const cam2 = { x: W / 2, y: H / 2, zoom: 1, rot: 0 };
    const sc = this.scratch;
    const m = layerMatrix(xf, cam2, W, H);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [u, v] of [
      [0, 0],
      [st.w, 0],
      [0, st.h],
      [st.w, st.h],
    ]) {
      const X = m[0] * u + m[1] * v + m[2];
      const Y = m[3] * u + m[4] * v + m[5];
      x0 = Math.min(x0, X);
      y0 = Math.min(y0, Y);
      x1 = Math.max(x1, X);
      y1 = Math.max(y1, Y);
    }
    const X0 = Math.max(0, Math.floor(x0 - 2));
    const Y0 = Math.max(0, Math.floor(y0 - 2));
    const X1 = Math.min(W, Math.ceil(x1 + 2));
    const Y1 = Math.min(H, Math.ceil(y1 + 2));
    for (let y = Y0; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const o = (y * W + x) * 4;
        sc[o] = 1;
        sc[o + 1] = 0;
        sc[o + 2] = 1;
        sc[o + 3] = 0;
      }
    drawSprite(sc, W, H, paper, layer, a.stage ?? stage, xf, cam2, a.opts || {});
    const sink = a.sink ?? 0.35;
    const zA = feet.depth;
    const t2 = this.t2;
    for (let y = Y0; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const o = (y * W + x) * 4;
        if (sc[o + 3] === 0 || (sc[o] === 1 && sc[o + 1] === 0 && sc[o + 2] === 1)) continue;
        const i = y * W + x;
        if (zA >= this.zbuf[i] + 0.5) continue;
        // the water washes over the body in moving patches
        const n = valueNoise(x * 0.12 + t2 * 0.7, y * 0.12 - t2 * 0.4, 33);
        const under = n < sink;
        const edge = !under && n < sink + 0.05;
        if (under) {
          if (this.stg[i] !== 0) continue;
          frame[o] = frame[o] * 0.65 + sc[o] * 0.3;
          frame[o + 1] = frame[o + 1] * 0.65 + sc[o + 1] * 0.32;
          frame[o + 2] = frame[o + 2] * 0.65 + sc[o + 2] * 0.36;
          continue;
        }
        if (edge && this.stg[i] === 0) {
          frame[o] = paper[o] * FOAM[0] * KR;
          frame[o + 1] = paper[o + 1] * FOAM[1] * KG;
          frame[o + 2] = paper[o + 2] * FOAM[2] * KB;
          continue;
        }
        frame[o] = sc[o];
        frame[o + 1] = sc[o + 1];
        frame[o + 2] = sc[o + 2];
        frame[o + 3] = sc[o + 3];
        this.zbuf[i] = zA;
        this.ids[i] = ID_ACTOR;
      }
  }

  /** A ring on the water around (X, Z) of radius rad (m), alpha al, foam-white. */
  ringOnWater(frame, cam, X, Z, rad, al, yScale = 1, zMax = Infinity) {
    const { W, H } = this;
    const paper = this.paper;
    const p0 = project(cam, X, 0, Z, W, H);
    if (p0.depth < 0.3) return;
    const n = Math.max(16, Math.ceil(rad * p0.scale * 7));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TWO_PI;
      const p = project(cam, X + Math.cos(a) * rad, 0, Z + Math.sin(a) * rad * yScale * 1.8, W, H);
      if (p.depth < 0.3) continue;
      const x = Math.round(p.sx);
      const y = Math.round(p.sy);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (this.ids[i] !== ID_WATER || this.stg[i] !== 0) continue;
      if (p.depth > zMax + rad * 3 && Math.sin(a) > 0) continue;
      if (al <= bayer(x, y) * 0.9 + 0.05) continue;
      const o = i * 4;
      frame[o] = paper[o] * FOAM[0] * KR;
      frame[o + 1] = paper[o + 1] * FOAM[1] * KG;
      frame[o + 2] = paper[o + 2] * FOAM[2] * KB;
    }
  }

  // ---------------------------------------------------------------- water thrown up

  /** Stage-aware, depth-tested pixel for effects drawn after the world. */
  fxPut(frame, x, y, z, c, a = 1, ink = false) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    if (z >= this.zbuf[i]) return;
    const s = this.stg[i];
    if (s >= 2) return;
    if (s === 1 && !ink) return;
    if (a < 1 && a <= bayer(x, y)) return;
    const o = i * 4;
    const col = s === 1 ? SEPIA : c;
    frame[o] = col[0];
    frame[o + 1] = col[1];
    frame[o + 2] = col[2];
  }

  /**
   * A perspective-correct splash on the water at (X, Z), born at t0: a crown of spikes
   * (drawn on twos), droplets arcing out and falling (on ones), a ring spreading.
   * Call after render(): it is depth-tested against the frame just drawn.
   */
  splashAt(frame, cam, X, Z, t, t0, strength = 1, seed = 1) {
    const u = t - t0;
    if (u < 0 || u > 1.5) return;
    const { W, H } = this;
    const s = strength;
    const paper = this.paper;
    const foamC = (o) => [paper[o] * FOAM[0] * KR, paper[o + 1] * FOAM[1] * KG, paper[o + 2] * FOAM[2] * KB];
    const hi = [240, 234, 220];
    // the ring
    this.ringOnWater(frame, cam, X, Z, 0.15 + 1.25 * u ** 0.7 * s, (1 - u / 1.5) * 0.95);
    if (u > 0.9) this.ringOnWater(frame, cam, X, Z, 0.1 + 0.9 * (u - 0.9) ** 0.7 * s, 0.6 * (1 - (u - 0.9) / 0.6));
    // the crown
    const u2 = Math.floor(u * 12) / 12;
    const cd = 0.42 * Math.sqrt(s);
    if (u2 < cd) {
      const k = u2 / cd;
      const rc = (0.1 + 0.3 * Math.sqrt(k)) * Math.sqrt(s);
      const hc = 0.5 * s * Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.8;
      const n = 18;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * TWO_PI + hash(j, seed, 3) * 0.3;
        const b = project(cam, X + Math.cos(a) * rc, 0, Z + Math.sin(a) * rc, W, H);
        const tp = project(
          cam,
          X + Math.cos(a) * rc * 1.45,
          hc * (0.55 + 0.6 * hash(j, seed, 4)),
          Z + Math.sin(a) * rc * 1.45,
          W,
          H,
        );
        if (b.depth < 0.3 || tp.depth < 0.3) continue;
        const L = Math.ceil(Math.hypot(tp.sx - b.sx, tp.sy - b.sy)) + 1;
        const wid = Math.max(1, Math.round(0.03 * b.scale));
        for (let q = 0; q <= L; q++) {
          const v = q / L;
          const x = b.sx + (tp.sx - b.sx) * v;
          const y = b.sy + (tp.sy - b.sy) * v;
          for (let w = 0; w < wid; w++) {
            const xx = Math.round(x) + w;
            const yy = Math.round(y);
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const o = (yy * W + xx) * 4;
            this.fxPut(frame, xx, yy, b.depth - 0.05, v > 0.92 ? SEPIA : foamC(o), 1, v > 0.92);
          }
        }
      }
    }
    // droplets
    const nd = Math.round(26 * s);
    for (let j = 0; j < nd; j++) {
      const a = hash(j, seed, 7) * TWO_PI;
      const vh = (0.5 + hash(j, seed, 8) * 1.4) * Math.sqrt(s);
      const vy = (1.6 + hash(j, seed, 9) * 2.6) * Math.sqrt(s);
      const born = hash(j, seed, 10) * 0.12;
      const uu = u - born;
      if (uu < 0) continue;
      const Y = vy * uu - 4.9 * uu * uu;
      if (Y < 0) continue;
      const px = X + Math.cos(a) * (0.1 + vh * uu);
      const pz = Z + Math.sin(a) * (0.1 + vh * uu);
      const p = project(cam, px, Y, pz, W, H);
      if (p.depth < 0.3) continue;
      const q = project(cam, px - Math.cos(a) * vh * 0.03, Y - (vy - 9.8 * uu) * 0.03, pz - Math.sin(a) * vh * 0.03, W, H);
      const big = p.scale > 140 ? 2 : 1;
      const L = Math.ceil(Math.hypot(p.sx - q.sx, p.sy - q.sy));
      for (let k = 0; k <= L; k++) {
        const v = L ? k / L : 0;
        const x = p.sx + (q.sx - p.sx) * v;
        const y = p.sy + (q.sy - p.sy) * v;
        this.fxPut(frame, x, y, p.depth, hi, 1 - v * 0.6);
      }
      if (big > 1) {
        this.fxPut(frame, p.sx + 1, p.sy, p.depth, hi);
        this.fxPut(frame, p.sx, p.sy + 1, p.depth, SEPIA, 1, true);
        this.fxPut(frame, p.sx + 1, p.sy + 1, p.depth, SEPIA, 1, true);
      }
    }
  }

  /**
   * A sheet of spray thrown up from a line on the water (Edric's slide): a curtain of
   * white water rising and falling, with droplets above its ragged crest. It hides what
   * is behind it. o: { X, Z (centre), width (m, along X), age (s since it was thrown;
   * slow it down or hold it for a time warp), dir (+1 thrown toward +X), height (m),
   * strength, seed, angle (radians: the sheet's line turned from the X axis) }.
   */
  spraySheet(frame, cam, o) {
    const { W, H } = this;
    const paper = this.paper;
    const age = o.age ?? 0;
    if (age < 0 || age > 2.2) return;
    const w = o.width ?? 2.6;
    const hgt = o.height ?? 2.2;
    const dir = o.dir ?? 1;
    const seed = o.seed ?? 1;
    const ang = o.angle ?? 0;
    const lx = Math.cos(ang);
    const lz = Math.sin(ang);
    const n = Math.max(24, Math.round(w * 26));
    const cols = [];
    const up = Math.sqrt(2 * 9.8 * hgt);
    for (let j = 0; j <= n; j++) {
      const v = j / n - 0.5;
      const prof = Math.cos(v * Math.PI) ** 0.6 * (0.8 + 0.4 * valueNoise(j * 0.35, seed, 3));
      const vy = up * prof;
      const vf = (1.2 + 1.2 * hash(j, seed, 2)) * dir;
      const uu = age;
      const crest = Math.max(0, vy * uu - 4.9 * uu * uu);
      const X = o.X + lx * v * w + vf * uu * lz * 0 + vf * uu * 0.35;
      const Z = o.Z + lz * v * w;
      const b = project(cam, X, 0, Z, W, H);
      const c = project(cam, X, crest, Z, W, H);
      cols.push({ b, c, crest, prof });
    }
    const apex = up / 9.8;
    const fall = smooth(apex * 0.9, apex * 1.9, age);
    const white = [241, 236, 224];
    for (let j = 0; j < n; j++) {
      const A = cols[j];
      const Bc = cols[j + 1];
      if (A.b.depth < 0.3 || Bc.b.depth < 0.3) continue;
      const xa = A.b.sx;
      const xb = Bc.b.sx;
      const xs = Math.min(xa, xb);
      const xe = Math.max(xa, xb);
      for (let x = Math.floor(xs); x <= Math.ceil(xe); x++) {
        const v = xe > xs ? clamp((x - xa) / (xb - xa)) : 0;
        const yb = A.b.sy + (Bc.b.sy - A.b.sy) * v;
        const yc = A.c.sy + (Bc.c.sy - A.c.sy) * v;
        const z = A.b.depth + (Bc.b.depth - A.b.depth) * v;
        if (yb - yc < 1) continue;
        const rag = (valueNoise(x * 0.3, age * 6, seed + 9) - 0.5) * (yb - yc) * 0.18;
        const top = yc + rag;
        for (let y = Math.floor(top); y <= Math.ceil(yb); y++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const hk = (yb - y) / Math.max(1, yb - top); // 0 at the water, 1 at the crest
          // dense near the water, thinning upward and as it falls; streaked vertically
          const stre = 0.75 + 0.25 * Math.sin(x * 1.3 + j * 0.7);
          const dens = (0.95 - 0.45 * hk) * (1 - fall * 0.8) * stre * (o.strength ?? 1);
          const i = y * W + x;
          const oo = i * 4;
          if (y <= top + 1 && hk > 0.9) {
            this.fxPut(frame, x, y, z - 0.02, SEPIA, 1 - fall, true);
            continue;
          }
          const c = dens > 0.62 ? white : [paper[oo] * FOAM[0] * KR, paper[oo + 1] * FOAM[1] * KG, paper[oo + 2] * FOAM[2] * KB];
          this.fxPut(frame, x, y, z - 0.02, c, dens);
          if (dens > 0.5 && this.stg[i] === 0 && z < this.zbuf[i]) this.ids[i] = ID_FX;
        }
      }
    }
    // droplets thrown above the crest
    const nd = Math.round(160 * (o.strength ?? 1));
    for (let j = 0; j < nd; j++) {
      const v = hash(j, seed, 21) - 0.5;
      const vy = up * (0.5 + 0.75 * hash(j, seed, 22));
      const vf = (0.6 + 2.2 * hash(j, seed, 23)) * dir;
      const vz = (hash(j, seed, 24) - 0.5) * 2;
      const born = hash(j, seed, 25) * 0.15;
      const uu = age - born;
      if (uu < 0) continue;
      const Y = vy * uu - 4.9 * uu * uu;
      if (Y < 0) continue;
      const X = o.X + lx * v * w + vf * uu;
      const Z = o.Z + lz * v * w + vz * uu;
      const p = project(cam, X, Y, Z, W, H);
      if (p.depth < 0.3) continue;
      this.fxPut(frame, p.sx, p.sy, p.depth, white);
      if (p.scale > 120) {
        this.fxPut(frame, p.sx + 1, p.sy, p.depth, white);
        this.fxPut(frame, p.sx, p.sy + 1, p.depth, SEPIA, 1, true);
      }
    }
    // the base churns
    this.ringOnWater(frame, cam, o.X, o.Z, w * 0.55 + age * 1.2, (1 - age / 2.2) * 0.9, 0.5);
  }

  // ---------------------------------------------------------------- rain

  /**
   * Slanted streaks at three depths, world-fixed (the camera moves through them), near
   * ones longer and faster by perspective. Bent by the wind and by shock waves.
   */
  drawRain(frame, B, t, wind) {
    const { W, H } = this;
    const { fx, fy, fz, rx, ry, rz, ux, uy, uz, F, cx, cy } = B;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const LAYERS = [
      [5, 220, 0.8, 3.5, 0.75],
      [16, 420, 3.5, 12, 0.55],
      [44, 600, 12, 40, 0.38],
    ];
    const fall = 8.5;
    const ex = 0.028;
    const mod = (v, m) => ((v % m) + m) % m;
    for (let L = 0; L < 3; L++) {
      const [Bx, n, zmin, zmax, alpha] = LAYERS[L];
      const cnt = Math.round(n * this.rain);
      for (let k = 0; k < cnt; k++) {
        const hx = hash(k, L, 301) * Bx;
        const hy = hash(k, L, 302) * Bx;
        const hz = hash(k, L, 303) * Bx;
        let wx = wind[0];
        let wz = wind[1];
        const X = ox - Bx / 2 + mod(hx + wx * t - (ox - Bx / 2), Bx);
        const Y = oy - Bx / 2 + mod(hy - fall * t - (oy - Bx / 2), Bx);
        const Z = oz - Bx / 2 + mod(hz + wz * t - (oz - Bx / 2), Bx);
        if (Y < 0) continue;
        if (this.impulses.length) {
          const [px, pz] = this.push(X, Z, t);
          wx += px * 9;
          wz += pz * 9;
        }
        const vx = X - ox;
        const vy = Y - oy;
        const vz = Z - oz;
        const z = vx * fx + vy * fy + vz * fz;
        if (z < zmin || z > zmax) continue;
        const iz = F / z;
        const sx = cx + (vx * rx + vy * ry + vz * rz) * iz;
        const sy = cy - (vx * ux + vy * uy + vz * uz) * iz;
        if (sx < -20 || sx > W + 20 || sy < -40 || sy > H + 20) continue;
        const qx = vx - wx * ex;
        const qy = vy + fall * ex;
        const qz = vz - wz * ex;
        const z2 = qx * fx + qy * fy + qz * fz;
        if (z2 < NEAR) continue;
        const iz2 = F / z2;
        const ex2 = cx + (qx * rx + qy * ry + qz * rz) * iz2;
        const ey2 = cy - (qx * ux + qy * uy + qz * uz) * iz2;
        const len = Math.ceil(Math.hypot(ex2 - sx, ey2 - sy));
        if (len < 1) continue;
        for (let s = 0; s <= len; s++) {
          const v = s / len;
          const x = Math.round(sx + (ex2 - sx) * v);
          const y = Math.round(sy + (ey2 - sy) * v);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = y * W + x;
          if (z >= this.zbuf[i]) continue;
          const st = this.stg[i];
          if (st >= 2) continue;
          const a = alpha * (1 - v * 0.5);
          if (a <= bayer(x + L, y + k)) continue;
          const o = i * 4;
          if (st === 1) {
            frame[o] = GRAPHITE[0];
            frame[o + 1] = GRAPHITE[1];
            frame[o + 2] = GRAPHITE[2];
            continue;
          }
          const lum = 0.299 * frame[o] + 0.587 * frame[o + 1] + 0.114 * frame[o + 2];
          const c = lum > 150 ? RAIN_DARK : RAIN_LIGHT;
          frame[o] = c[0];
          frame[o + 1] = c[1];
          frame[o + 2] = c[2];
        }
      }
    }
  }

  // ---------------------------------------------------------------- foreground

  /**
   * Near-lens occluders (maemono): dark ink silhouettes of reeds or stones very close to
   * the camera, so they pass faster than the subject in a tracking shot.
   * items: [{ X, Z, kind: 'reeds' | 'stone', h (m), seed }]
   */
  drawForeground(frame, B, t2, items, windK) {
    const { W, H } = this;
    const paper = this.paper;
    const mask = this.fgMask;
    mask.fill(0);
    let any = false;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const proj = (X, Y, Z) => {
      const vx = X - ox;
      const vy = Y - oy;
      const vz = Z - oz;
      const z = vx * B.fx + vy * B.fy + vz * B.fz;
      if (z < NEAR) return null;
      const iz = B.F / z;
      return [B.cx + (vx * B.rx + vy * B.ry + vz * B.rz) * iz, B.cy - (vx * B.ux + vy * B.uy + vz * B.uz) * iz, iz, z];
    };
    for (const it of items) {
      const seed = it.seed ?? 1;
      const base = it.Y ?? this.groundY(it.X, it.Z);
      if (it.kind === 'stone') {
        const s = this.placeStone(
          {
            X: it.X,
            Z: it.Z,
            a: it.a ?? 0.5,
            c: it.c ?? 0.4,
            top: (it.h ?? 0.35) + Math.max(0, base),
            ry: it.ry ?? 0.45,
            yaw: seed,
          },
          0,
        );
        const p = proj(s.X, s.top, s.Z);
        if (!p) continue;
        const r = Math.max(s.a, s.c) * p[2] * 1.6 + 4;
        const X0 = Math.max(0, Math.floor(p[0] - r));
        const X1 = Math.min(W - 1, Math.ceil(p[0] + r));
        const Y0 = Math.max(0, Math.floor(p[1] - r * 0.5));
        const Y1 = Math.min(H - 1, Math.ceil(p[1] + r * 1.6));
        for (let y = Y0; y <= Y1; y++)
          for (let x = X0; x <= X1; x++) {
            const i = y * W + x;
            this.stoneHit(s, ox, oy, oz, this.rdx[i], this.rdy[i], this.rdz[i]);
            if (!(this._st > 0 && this._st < Infinity)) continue;
            const hy = oy + this.rdy[i] * this._st;
            if (hy < Math.min(0, base)) continue;
            const z = this._st * this.il[i];
            if (z >= this.zbuf[i]) continue;
            // the top catches the sky: a lighter rim
            mask[i] = this._sn[1] > 0.75 ? 2 : 1;
            this.zbuf[i] = z;
            any = true;
          }
        continue;
      }
      // a clump of broad blades
      const nb = 4 + Math.floor(hash(seed, 1, 55) * 4);
      for (let b = 0; b < nb; b++) {
        const h = (it.h ?? 1.2) * (0.55 + 0.6 * hash(seed, b, 56));
        const X = it.X + (hash(seed, b, 57) - 0.5) * 0.35;
        const Z = it.Z + (hash(seed, b, 58) - 0.5) * 0.25;
        const g = this.gust(X, Z, t2) * windK;
        const lean = (hash(seed, b, 59) - 0.5) * 0.7 + (0.15 + 0.5 * g) * Math.cos(this.wind.dir);
        const wB = 0.035 * (0.7 + 0.6 * hash(seed, b, 60));
        let prev = null;
        for (let k = 0; k <= 8; k++) {
          const v = k / 8;
          const phi = lean * v ** 1.4;
          const px = X + Math.sin(phi) * h * v * 0.9;
          const py = base + Math.cos(phi * 0.6) * h * v;
          const p = proj(px, py, Z);
          if (!p) {
            prev = null;
            continue;
          }
          if (prev) {
            const half = Math.max(0.6, wB * (1 - v * 0.85) * p[2] * 0.5);
            const L = Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1])) + 1;
            for (let s = 0; s <= L; s++) {
              const q = s / L;
              const xm = prev[0] + (p[0] - prev[0]) * q;
              const ym = prev[1] + (p[1] - prev[1]) * q;
              const zm = prev[3] + (p[3] - prev[3]) * q;
              for (let x = Math.floor(xm - half); x <= Math.ceil(xm + half); x++) {
                const y = Math.round(ym);
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                const i = y * W + x;
                if (zm >= this.zbuf[i]) continue;
                mask[i] = 1;
                this.zbuf[i] = zm;
                any = true;
              }
            }
          }
          prev = p;
        }
      }
    }
    if (!any) return;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const m = mask[i];
        if (!m) continue;
        const edge =
          x === 0 || y === 0 || x === W - 1 || y === H - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W];
        const s = this.stg[i];
        const o = i * 4;
        this.ids[i] = ID_FX;
        if (s >= 3) continue;
        if (s >= 1) {
          const c = edge ? (s === 1 ? SEPIA : GRAPHITE) : null;
          if (c) {
            frame[o] = c[0];
            frame[o + 1] = c[1];
            frame[o + 2] = c[2];
          } else {
            frame[o] = paper[o];
            frame[o + 1] = paper[o + 1];
            frame[o + 2] = paper[o + 2];
          }
          continue;
        }
        const c = m === 2 && !edge ? FG_RIM : FG_DARK;
        frame[o] = c[0];
        frame[o + 1] = c[1];
        frame[o + 2] = c[2];
        frame[o + 3] = 255;
      }
  }
}

/**
 * Near-lens reeds along a line at depth Z (a tracking shot's maemono): items for
 * render({ foreground }). o: { z, x0, x1, step, kind, h, seed, jitter }.
 */
export function foregroundRow(o) {
  const out = [];
  const step = o.step ?? 1.6;
  let k = 0;
  for (let x = o.x0; x <= o.x1; x += step) {
    k++;
    const seed = (o.seed ?? 1) * 97 + k;
    if (hash(k, 1, seed) < (o.gaps ?? 0.25)) continue;
    out.push({
      X: x + (hash(k, 2, seed) - 0.5) * step * 0.7,
      Z: o.z + (hash(k, 3, seed) - 0.5) * (o.jitter ?? 0.4),
      kind: o.kind === 'mixed' ? (hash(k, 4, seed) < 0.3 ? 'stone' : 'reeds') : (o.kind ?? 'reeds'),
      h: (o.h ?? 1.1) * (0.7 + 0.6 * hash(k, 5, seed)),
      seed,
      Y: o.Y,
    });
  }
  return out;
}

/**
 * A whip pan's smear: the frame dragged along (vx, vy) screen px (averaged over the
 * path), as the eye sees a camera turned faster than the shutter.
 */
export function smearFrame(frame, W, H, vx, vy) {
  const L = Math.hypot(vx, vy);
  if (L < 2) return;
  const n = Math.min(24, Math.ceil(L));
  const src = frame.slice();
  const ux = vx / n;
  const uy = vy / n;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      for (let k = 0; k < n; k++) {
        const xx = Math.round(x - ux * k);
        const yy = Math.round(y - uy * k);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const o = (yy * W + xx) * 4;
        r += src[o];
        g += src[o + 1];
        b += src[o + 2];
        c++;
      }
      const o = (y * W + x) * 4;
      frame[o] = r / c;
      frame[o + 1] = g / c;
      frame[o + 2] = b / c;
    }
}

export { INK as WORLD_INK };
