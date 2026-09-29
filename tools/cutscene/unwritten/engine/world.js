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
//   world.groundY(X, Z), world.waterDepth(X, Z)          // for feet on the riverbed
//   world.pick(cam, sx, sy)                              // screen -> ground or water
//
// Cameras: project, unproject, lookAt, orbit, crane, lerpCam, nudge (screen shake).
// Also impulse (a shock wave for render), foregroundRow (maemono along a line) and
// smearFrame (a whip pan's drag: streaked multiples and ink speed lines, never a blur).
// world.prof holds the last frame's per-pass times (ms).
//
// How it is drawn: every pixel casts a ray. Rays that hit the ground find the river (a
// trench along Z with sloped banks) or the bank top; the rest meet ridge "curtains" on
// circles of increasing radius around the ford (real parallax, aerial perspective by
// distance) or the sky, where clouds lie on a plane 1.5 km up. Water samples a second
// image, the background seen from the camera mirrored in Y = 0, displaced by the wave
// slope; the Hollow Sun itself is broken by the water analytically (sunGlitter: a field
// of small tilted mirrors, so its image falls apart into horizontal slivers strung down a
// column, pale toward the lens, the gold ring left as glints). The river meanders within
// the picture (buildRiver: a riffle, a pool, a jutting spur, gravel bars on the insides
// of the bends, steep cut banks on the outsides); the stones are ellipsoids cut by planes
// (flat crowns, facets, cracks where faces meet). Every surface writes an id and a
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

// wash colours ("targets": what the pigment reads as on the reference vellum; they
// multiply onto the actual page, so its grain and edge shading show through)
const SKY_HOR = [206, 200, 192];
const SKY_ZEN = [168, 163, 172];
const HAZE = [199, 194, 190];
const MIST = [210, 205, 198];
const CLOUD_THIN = [180, 175, 181];
const CLOUD_THICK = [160, 155, 165];
const CLOUD_POOL = [140, 134, 146];
const GRASS_A = [152, 146, 126];
const GRASS_B = [124, 119, 104];
const MUD = [108, 102, 94];
const WET_MUD = [84, 82, 83];
const SLOPE_C = [92, 88, 84];
const WATER_DEEP = [78, 84, 94];
const BED = [112, 110, 104];
const BED_DARK = [84, 86, 88];
const BED_LIGHT = [138, 136, 130];
const BANK_REFL = [92, 89, 84];
const FOAM = [238, 232, 220];
const GRAVEL = [158, 153, 144];
const GRAVEL_W = [102, 100, 98];
const GRAVEL_HI = [184, 179, 170];
const STONE_LIT = [174, 170, 168];
const STONE_MID = [130, 128, 132];
const STONE_SH = [92, 92, 100];
const STONE_WET = [62, 62, 70];
const REED_T = [112, 106, 92];
const REED_W = [150, 144, 122];
const MIDREED = [92, 86, 84];
const REED_FAR = [128, 124, 114];
const RAIN_DARK = [166, 160, 170];
const RAIN_LIGHT = [214, 210, 210];
const FG_DARK = hexToRgb('#16131e');
const FG_RIM = hexToRgb('#403949');

// ids (what each pixel shows): contours come from changes between them
const ID_SKY = 1;
const ID_THIN = 2;
const ID_THICK = 3;
const ID_SUN = 5;
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

const WS = new Float64Array(3);
/** Bilinear sample of the interleaved wave texture into WS: slope x, slope z, height. */
function sampWave(d, N, u, v) {
  const x = Math.floor(u);
  const y = Math.floor(v);
  const fx = u - x;
  const fy = v - y;
  const m = N - 1;
  const x0 = x & m;
  const x1 = (x + 1) & m;
  const y0 = (y & m) * N;
  const y1 = ((y + 1) & m) * N;
  const a = (y0 + x0) * 3;
  const b = (y0 + x1) * 3;
  const c = (y1 + x0) * 3;
  const e = (y1 + x1) * 3;
  const wa = (1 - fx) * (1 - fy);
  const wb = fx * (1 - fy);
  const wc = (1 - fx) * fy;
  const we = fx * fy;
  WS[0] = d[a] * wa + d[b] * wb + d[c] * wc + d[e] * we;
  WS[1] = d[a + 1] * wa + d[b + 1] * wb + d[c + 1] * wc + d[e + 1] * we;
  WS[2] = d[a + 2] * wa + d[b + 2] * wb + d[c + 2] * wc + d[e + 2] * we;
}

let TEX = null;
/** The noise textures, built once per page (a few tens of ms). */
function textures() {
  if (TEX) return TEX;
  // clouds: fbm domain-warped twice (folds within folds, after Quilez), masses a few
  // hundred metres across; sampled stretched along the wind
  const N = 256;
  const cl = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i / N) * 5;
      const y = (j / N) * 5;
      const q1 = tfbm(x, y, 5, 5, 31, 2);
      const q2 = tfbm(x + 3.7, y + 1.9, 5, 5, 37, 2);
      const r1 = tfbm(x + 1.3 * q1 + 1.7, y + 1.3 * q2 + 9.2, 5, 5, 43, 2);
      const r2 = tfbm(x + 1.3 * q1 + 8.3, y + 1.3 * q2 + 2.8, 5, 5, 47, 2);
      cl[j * N + i] = tfbm(x + 1.2 * r1, y + 1.2 * r2, 5, 5, 41, 4);
    }
  stretch01(cl);
  // the sky's own unevenness by direction (azimuth x height): haze that wanders
  const skyv = new Float32Array(256 * 48);
  for (let j = 0; j < 48; j++)
    for (let i = 0; i < 256; i++)
      skyv[j * 256 + i] = tfbm((i / 256) * 6, (j / 48) * 4, 6, 64, 83, 3);
  stretch01(skyv);
  // ground blotches (grass tones, mud, pebbles, the ridges' brush)
  const gr = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) gr[j * N + i] = tfbm((i / N) * 8, (j / N) * 8, 8, 8, 71, 4);
  stretch01(gr);
  // waves: long across the flow (X), short along it (Z); height and slope
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
    for (let i = 0; i < M; i++) st[j * M + i] = tfbm((i / M) * 24, (j / M) * 6, 24, 6, 61, 2);
  stretch01(st);
  // rain cells: per 64 x 64 cell, a drop period and phase
  const rc = new Float32Array(64 * 64 * 3);
  for (let k = 0; k < 64 * 64; k++) {
    rc[k * 3] = hash(k, 1, 202);
    rc[k * 3 + 1] = 0.7 + hash(k, 2, 202) * 0.9;
    rc[k * 3 + 2] = hash(k, 3, 202);
  }
  // slope x, slope z and height interleaved, so one bilinear setup serves all three
  const wv = new Float32Array(M * M * 3);
  for (let k = 0; k < M * M; k++) {
    wv[k * 3] = gx[k];
    wv[k * 3 + 1] = gz[k];
    wv[k * 3 + 2] = hw[k];
  }
  TEX = { cloud: mipChain(cl, N), ground: mipChain(gr, N), M, wv, streak: st, rc, skyv };
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

const RIDGES = [
  // uneven on purpose: spacing and amplitude vary (a clump of near hills, a long gap,
  // the far range), and each range rises and falls along its own envelope, so the
  // silhouettes never run parallel like waves
  {
    R: 150,
    base: 5,
    amp: 28,
    freq: 3.0,
    seed: 11,
    valley: 1,
    drop: 9,
    ridged: 0.3,
    env: 0.7,
    envFreq: 1.3,
    ink: 0.2,
    lit: [130, 126, 118],
    sh: [104, 101, 104],
    mist: 7,
    skew: 1.6,
    brush: 0.12,
  },
  {
    R: 235,
    base: 4,
    amp: 24,
    freq: 4.3,
    seed: 17,
    valley: 0.9,
    drop: 8,
    ridged: 0.45,
    env: 0.95,
    envFreq: 1.8,
    ink: 0,
    lit: [143, 138, 135],
    sh: [121, 117, 121],
    mist: 10,
    skew: 1.4,
    brush: 0.07,
  },
  {
    R: 640,
    base: 18,
    amp: 125,
    freq: 2.2,
    seed: 23,
    valley: 0.4,
    drop: 4,
    ridged: 0.6,
    env: 0.8,
    envFreq: 1.1,
    ink: -0.1,
    lit: [158, 153, 154],
    sh: [139, 134, 142],
    mist: 22,
    skew: 1.2,
    brush: 0.03,
  },
  {
    R: 1500,
    base: 60,
    amp: 300,
    freq: 1.8,
    seed: 37,
    valley: 0.25,
    drop: 0,
    ridged: 0.75,
    env: 0.7,
    envFreq: 0.9,
    ink: -0.2,
    lit: [176, 170, 171],
    sh: [159, 154, 162],
    mist: 60,
    skew: 1.1,
    brush: 0,
  },
  {
    R: 3200,
    base: 180,
    amp: 640,
    freq: 1.4,
    seed: 53,
    valley: 0,
    drop: 0,
    ridged: 0.85,
    env: 0.6,
    envFreq: 0.7,
    ink: -0.3,
    lit: [192, 186, 185],
    sh: [180, 175, 180],
    mist: 220,
    skew: 1,
    brush: 0,
  },
];

function buildRidge(L) {
  const h = new Float32Array(TAB + 1);
  const eq = new Float32Array(TAB / 8 + 1);
  let hmax = 0;
  for (let i = 0; i <= TAB; i++) {
    const th = -Math.PI + (i / TAB) * TWO_PI;
    const cx = Math.cos(th);
    const cz = Math.sin(th);
    // rounded hills near, ridged mountains far (noise on a circle: periodic)
    let s = 0;
    let amp = 0.55;
    let f = L.freq;
    let n = 0;
    for (let o = 0; o < 4; o++) {
      const v = valueNoise(cx * f + 17, cz * f + 31, L.seed + o * 13);
      const r = 1 - Math.abs(2 * v - 1);
      s += amp * (r * r * L.ridged + v * (1 - L.ridged));
      n += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    // the range's own envelope: it rises and falls along the horizon
    const e = valueNoise(cx * L.envFreq + 5, cz * L.envFreq + 9, L.seed + 500);
    const p = (s / n) * (1 - L.env * 0.7 + L.env * 1.1 * e);
    // the river's valley, upstream (th = 0) and downstream (th = pi): the near hills
    // part and sink below the ground there, so the far ones show through the gap
    const a = Math.abs(th);
    const v = Math.min(smooth(0.04, 0.6, a), smooth(0.04, 0.6, Math.PI - a));
    let y = (L.base + L.amp * p) * (1 - L.valley * (1 - v) * 0.85);
    y -= L.drop * (1 - v);
    h[i] = y;
    if (y > hmax) hmax = y;
  }
  // edge quality along the contour: found (> 0.5, inked), soft (bleeds), lost (> haze)
  for (let k = 0; k <= TAB / 8; k++) {
    const th = (k / (TAB / 8)) * TWO_PI;
    eq[k] = clamp(
      valueNoise(Math.cos(th) * 5 + 3, Math.sin(th) * 5 + 7, L.seed + 900) * 1.3 - 0.15 + L.ink,
    );
  }
  const d = new Float32Array(TAB + 1);
  for (let i = 0; i <= TAB; i++) d[i] = h[Math.min(TAB, i + 2)] - h[Math.max(0, i - 2)];
  return { ...L, h, d, eq, hmax };
}

/** River half-shape: depth by normalised distance from the centre (FORD.md). */
function depthExact(a) {
  if (a < 0.625) return 0.6 - 0.1 * (a / 0.625) ** 2;
  const k = clamp((a - 0.625) / 0.375);
  return 0.5 * (1 - k) ** 0.85;
}
const DEPTH_TAB = new Float32Array(1026);
for (let i = 0; i < 1026; i++) DEPTH_TAB[i] = depthExact(Math.min(1, i / 1024));
function depthProfile(a) {
  if (a >= 1) return 0;
  const f = a * 1024;
  const i = f | 0;
  return DEPTH_TAB[i] + (DEPTH_TAB[i + 1] - DEPTH_TAB[i]) * (f - i);
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
      u: edge
        ? (side < 0.22 ? -1 : 1) * (0.93 + hash(i, 4, seed) * 0.12)
        : hash(i, 4, seed) * 1.7 - 0.85,
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
 * wind: { dir (radians, the direction it blows toward), strength }, stones (extra:
 * { X, Z, a, c (half sizes, m), top (m above water), ry, yaw, slick }),
 * cloudOffset: [x, z] (m: which stretch of cloud is overhead) }.
 * Build once per piece (a few hundred ms), after the page exists.
 */
export class World {
  constructor(o = {}) {
    this.W = o.W ?? 480;
    this.H = o.H ?? 270;
    // every scratch field exists from the start, as a double where it holds numbers:
    // a field added (or retyped) mid-render changes the object's shape and throws the
    // optimised code away, which costs whole frames in the browser
    this._el = 0.5;
    this._er = 0.5;
    this._swl = 0.5;
    this._swr = 0.5;
    this._bl = 0.5;
    this._br = 0.5;
    this._ht = 0.5;
    this._hx = 0.5;
    this._hz = 0.5;
    this._htype = 0;
    this._bt = 0.5;
    this._ri = 0;
    this._ca = 0.5;
    this._st = 0.5;
    this._flat = 0;
    this._edge = 0.5;
    this._sn = new Float32Array(3);
    this._px = 0.5;
    this._pz = 0.5;
    this._rp = new Float32Array(15);
    this.F = 360.5;
    this.t = 0.5;
    this.t2 = 0.5;
    this.rain = 0.5;
    this.cloudTh = 0.5;
    this.cloudWX = 22.5;
    this.cloudWZ = -9.5;
    this.impulses = [];
    this.prof = {};
    this.sunBox = null;
    this.reflSunBox = null;
    this.msun = null;
    this.horizonY = 0.5;
    this.frameNo = 0;
    this.last = null;
    this.paper = o.paper;
    this.seed = o.seed ?? 3;
    this.sun = { az: 0.06, el: 0.33, r: 0.075, ...(o.sun || {}) };
    this.flow = o.flow ?? 0.9;
    this.wind = { dir: 0.35, strength: 1, ...(o.wind || {}) };
    this.bankH = 0.4;
    this.slopeW = 0.9;
    this.cloudH = 1500;
    this.cloudTexel = 30;
    const W = this.W;
    const H = this.H;
    const N = W * H;
    this.N = N;
    this.tex = textures();
    this.ridges = RIDGES.map(buildRidge);
    this.buildRiver();
    this.stones = [...makeStones(this.seed), ...(o.stones || [])].map((s, i) =>
      this.placeStone(s, i),
    );
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
    this.ridx = new Uint16Array(N); // the ridge profile index seen (edge quality)
    this.gEL = new Float32Array(N); // the river's edges at the hit
    this.gER = new Float32Array(N);
    this.zbuf = new Float32Array(N);
    this.ids = new Uint8Array(N);
    this.line = new Float32Array(N);
    this.pencil = new Float32Array(N);
    this.wdx = new Float32Array(N);
    this.wdy = new Float32Array(N);
    this.refl = new Uint8ClampedArray(N * 4);
    this.reflId = new Uint8Array(N);
    this.rstamp = new Uint32Array(N); // which frame computed each reflection pixel
    this.rmark = new Uint8Array(N); // water already darkened by a reed's reflection
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
    this.B = basis({ x: 0, y: 1.5, z: -10, yaw: 0, pitch: 0, roll: 0, focal: 360 }, W, H);
    this.mistTab = this.ridges.map(() => new Float32Array(512));
    this.mtMirror = this.ridges.map(() => 0.5);
  }

  // ---------------------------------------------------------------- geometry

  /**
   * The river's plan: its two water edges by Z, how wide each bank's slope is (a gentle
   * gravel bar, a steep cut bank), and where the gravel lies. The ford itself (|Z| < 4) is
   * FORD.md's crossing: centred, 16 m wide. Away from it the river meanders within the
   * picture: upstream it swings left through a narrow riffle into a wide pool (a gravel
   * bar on the inside of each bend, a cut bank on the outside), a spur of bank juts into
   * it, and it swings back right far off; downstream it bends the other way. Entropy at
   * the scale of the picture: nothing runs parallel to anything for long.
   */
  buildRiver() {
    const n = Math.round((EZ1 - EZ0) / EDZ) + 1;
    this.eL = new Float32Array(n);
    this.eR = new Float32Array(n);
    this.swL = new Float32Array(n);
    this.swR = new Float32Array(n);
    this.barL = new Float32Array(n);
    this.barR = new Float32Array(n);
    const s = this.seed * 7 + 1;
    const bump = (Z, c, w) => Math.exp(-(((Z - c) / w) ** 2));
    for (let i = 0; i < n; i++) {
      const Z = EZ0 + i * EDZ;
      const aZ = Math.abs(Z);
      // 1 at the crossing, 0 once the river is its own shape again
      const ford = 1 - smooth(3.5, 10, aZ);
      let centre =
        Z > 0
          ? -9.5 * smooth(5, 46, Z) + 17 * smooth(58, 125, Z) - 7 * smooth(140, 230, Z)
          : 7.5 * smooth(6, 48, -Z) - 5 * smooth(60, 130, -Z) + 3 * bump(Z, -17, 6);
      centre += (valueNoise(Z / 70, 0.5, s) - 0.5) * 12 * smooth(60, 160, aZ);
      let half =
        Z > 0
          ? 8 - 2.8 * bump(Z, 29, 9) + 4.5 * bump(Z, 60, 15) - 1.6 * bump(Z, 102, 14)
          : 8 + 2.6 * bump(Z, -27, 11) - 2.2 * bump(Z, -56, 10);
      half += (valueNoise(Z / 48, 1.5, s + 1) - 0.5) * 7 * smooth(30, 110, aZ);
      centre *= 1 - ford;
      half = lerp(half, 8, ford);
      // the soft irregular edge, a little on each side
      const wig = (k) =>
        (valueNoise(Z / 2.6, k, s + 2) - 0.5) * 0.9 +
        (valueNoise(Z / 0.8, k + 3, s + 3) - 0.5) * 0.35 +
        (valueNoise(Z / 11, k + 6, s + 4) - 0.5) * 1.6 * smooth(4, 30, aZ);
      // a spur of bank juts from the right a little upstream; a lesser one downstream
      const spurR = 3.4 * bump(Z, 23, 3.2) ** 0.7 + 2.6 * bump(Z, -19, 2.4) ** 0.7;
      const spurL = 2.2 * bump(Z, 74, 4);
      // gravel bars on the inside of the bends: wide, low slopes of pebbles
      const barL =
        3.4 * bump(Z, 15, 6) + 5 * bump(Z, 120, 18) + 4.2 * bump(Z, -44, 12) + 3 * bump(Z, -17, 5);
      const barR = 5.5 * bump(Z, 47, 11) + 2.5 * bump(Z, -8.5, 3) * (1 - ford * 0.6);
      // the water edge sits a little inside a bar
      this.eL[i] = centre - half - wig(0.5) + spurL + barL * 0.35;
      this.eR[i] = centre + half + wig(7.5) - spurR - barR * 0.35;
      this.barL[i] = barL * (1 - ford);
      this.barR[i] = barR * (1 - ford);
      // cut banks on the outsides are steep; bars are gentle
      const cutL = bump(Z, 50, 12) + bump(Z, -8, 5) * 0.6;
      const cutR = bump(Z, 16, 7) + bump(Z, -42, 12) + bump(Z, 118, 16);
      this.swL[i] = lerp(Math.max(0.35, 0.9 - 0.5 * cutL + barL * 0.8), 0.9, ford);
      this.swR[i] = lerp(Math.max(0.35, 0.9 - 0.5 * cutR + barR * 0.8), 0.9, ford);
    }
  }

  /** Edges plus each side's slope width and gravel, into _el/_er, _swl/_swr, _bl/_br. */
  edgesFull(Z) {
    let f = (Z - EZ0) / EDZ;
    if (f < 0) f = 0;
    const last = this.eL.length - 1;
    if (f > last - 1) f = last - 1;
    const i = f | 0;
    const k = f - i;
    this._el = this.eL[i] + (this.eL[i + 1] - this.eL[i]) * k;
    this._er = this.eR[i] + (this.eR[i + 1] - this.eR[i]) * k;
    this._swl = this.swL[i] + (this.swL[i + 1] - this.swL[i]) * k;
    this._swr = this.swR[i] + (this.swR[i + 1] - this.swR[i]) * k;
    this._bl = this.barL[i] + (this.barL[i + 1] - this.barL[i]) * k;
    this._br = this.barR[i] + (this.barR[i + 1] - this.barR[i]) * k;
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
    this.edgesFull(Z);
    const el = this._el;
    const er = this._er;
    if (X > el && X < er) {
      const c = (el + er) / 2;
      const half = (er - el) / 2;
      return -depthProfile(Math.abs(X - c) / half) * Math.sqrt(half / 8);
    }
    const out = X <= el ? el - X : X - er;
    return this.bankH * smooth(0, X <= el ? this._swl : this._swr, out);
  }

  /** Water depth at (X, Z) (0 on the banks). */
  waterDepth(X, Z) {
    return Math.max(0, -this.groundY(X, Z));
  }

  /**
   * The ground or water under screen point (sx, sy) through camera cam:
   * { X, Y, Z, water } or null (sky).
   */
  pick(cam, sx, sy) {
    const [dx, dy, dz] = unproject(cam, sx, sy, this.W, this.H);
    this.hitGround(cam.x, cam.y, cam.z, dx, dy, dz);
    if (!(this._ht < Infinity)) return null;
    const X = this._hx;
    const Z = this._hz;
    const water = this._htype === 1;
    return { X, Y: water ? 0 : this.groundY(X, Z), Z, water };
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
    // an ellipsoid cut by planes: the crown (flat, what a foot stands on) and a few
    // facets, mostly facing up and out, each cutting off its own slice
    const cut = s.flat ?? 0.55 + 0.2 * hash(i, 20, 77);
    const cy = s.top - s.ry * cut;
    const fac = [0, 1, 0, cut];
    const nf = 5 + Math.floor(hash(i, 21, 77) * 4);
    for (let k = 0; k < nf; k++) {
      const az = hash(i, 30 + k, 77) * TWO_PI;
      const el = -0.1 + hash(i, 50 + k, 77) * 1.0;
      fac.push(
        Math.cos(el) * Math.cos(az),
        Math.sin(el),
        Math.cos(el) * Math.sin(az),
        0.7 + 0.22 * hash(i, 70 + k, 77),
      );
    }
    return {
      ...s,
      X,
      cy,
      fac,
      i,
      ex: Math.cos(s.yaw || 0),
      ez: Math.sin(s.yaw || 0),
      tone: 0.9 + hash(i, 10, 77) * 0.2,
    };
  }

  /**
   * Stones by 4 m cell (X -64..64, Z -64..128), for the water's foam and wakes, packed
   * flat: sgrid[k] is an offset into sidx (count first), sdat holds X, Z, a, c.
   */
  buildStoneGrid() {
    const lists = Array.from({ length: 32 * 48 }, () => []);
    this.sdat = new Float32Array(this.stones.length * 4);
    this.stones.forEach((s, n) => {
      this.sdat.set([s.X, s.Z, s.a, s.c], n * 4);
      const r = Math.max(s.a, s.c);
      for (let gz = Math.floor((s.Z - 5.5) / 4); gz <= Math.floor((s.Z + r + 0.6) / 4); gz++)
        for (let gx = Math.floor((s.X - r - 2) / 4); gx <= Math.floor((s.X + r + 2) / 4); gx++) {
          const cx = gx + 16;
          const cz = gz + 16;
          if (cx < 0 || cz < 0 || cx >= 32 || cz >= 48) continue;
          lists[cz * 32 + cx].push(n);
        }
    });
    this.sgrid = new Int32Array(32 * 48).fill(-1);
    const idx = [];
    lists.forEach((l, k) => {
      if (!l.length) return;
      this.sgrid[k] = idx.length;
      idx.push(l.length, ...l);
    });
    this.sidx = new Int16Array(idx);
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
        // bare gravel on the bars
        this.edgesFull(z);
        const onBar = de > 0 && de < (x < (this._el + this._er) / 2 ? this._bl : this._br) * 0.9;
        if (onBar && hash(n, 15, s) > 0.12) continue;
        // the ford itself is trodden clear
        if (Math.abs(z) < 4.5 && de < 0.6) continue;
        const far = Math.abs(z) > 60 ? 0.5 : 1;
        const dens =
          de < -1.1
            ? 0
            : de < -0.1
              ? 0.3
              : de < 0.4
                ? 0.15
                : de < 3.2
                  ? 0.55
                  : de < 8
                    ? 0.28
                    : 0.08;
        if (hash(n, 3, s) > dens * far) continue;
        const tall = de < 3.5 ? 1 : 0.6;
        const nb = 4 + Math.floor(hash(n, 4, s) * 8);
        const first = blades.length / 9;
        let maxH = 0;
        const base = de < 0 ? 0 : this.groundY(x, z);
        // a clump leans together, each blade a little its own way
        const ca = hash(n, 13, s) * TWO_PI;
        const cm = hash(n, 14, s) * 0.22;
        for (let b = 0; b < nb; b++) {
          const q = n * 31 + b;
          const h = (0.45 + hash(q, 5, s) * 1.05) * tall;
          const la = hash(q, 6, s) * TWO_PI;
          const lm = hash(q, 7, s) * 0.3;
          blades.push(
            x + (hash(q, 8, s) - 0.5) * 0.32,
            base,
            z + (hash(q, 9, s) - 0.5) * 0.32,
            h,
            Math.sin(la) * lm + Math.sin(ca) * cm,
            Math.cos(la) * lm + Math.cos(ca) * cm,
            hash(q, 10, s) * TWO_PI,
            0.7 + hash(q, 11, s) * 0.6,
            hash(q, 12, s) < 0.3 ? 1 : 0, // a seed head
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
    let best = Infinity;
    let type = 0;
    let bx = 0;
    let bz = 0;
    let zg = oz + dz * 20;
    let xa = ox; // where the ray comes down through the bank height
    if (dy < -1e-7 && oy > BH) {
      // the common case first: straight down onto open water
      const t0 = -oy / dy;
      const x0 = ox + dx * t0;
      const z0 = oz + dz * t0;
      this.edges(z0);
      const x1 = ox + (dx * (BH - oy)) / dy;
      if (
        x0 > this._el + 0.05 &&
        x0 < this._er - 0.05 &&
        x1 > this._el + 0.05 &&
        x1 < this._er - 0.05
      ) {
        this._ht = t0;
        this._hx = x0;
        this._hz = z0;
        this._htype = 1;
        return;
      }
    } else if (dy > 1e-7 && oy < BH) {
      // looking up from below the bank tops: only a bank reached before the ray climbs
      // past their height can be hit
      const tb = (BH - oy) / dy;
      const xb = ox + dx * tb;
      this.edges(oz + dz * tb * 0.5);
      const lo = Math.min(ox, xb);
      const hi = Math.max(ox, xb);
      if (lo > this._el + 0.02 && hi < this._er - 0.02) {
        this._ht = Infinity;
        this._htype = 0;
        return;
      }
    }
    if (dy < -1e-7) {
      if (oy > BH) {
        const t1 = (BH - oy) / dy;
        const x1 = ox + dx * t1;
        const z1 = oz + dz * t1;
        this.edgesFull(z1);
        if (x1 <= this._el - this._swl || x1 >= this._er + this._swr) {
          this._ht = t1;
          this._hx = x1;
          this._hz = z1;
          this._htype = 2;
          return;
        }
        zg = z1;
        xa = x1;
      }
      if (oy > 0) {
        const t0 = -oy / dy;
        const x0 = ox + dx * t0;
        const z0 = oz + dz * t0;
        this.edges(z0);
        if (x0 > this._el && x0 < this._er) {
          // between the bank height and the surface the ray stays over the water: no
          // slope can be in the way
          if (Math.min(xa, x0) > this._el + 0.05 && Math.max(xa, x0) < this._er - 0.05) {
            this._ht = t0;
            this._hx = x0;
            this._hz = z0;
            this._htype = 1;
            return;
          }
          best = t0;
          type = 1;
          bx = x0;
          bz = z0;
        }
        zg = z0;
      }
    }
    // the sloped banks: planes rising from the water edge to the bank top (each side's
    // slope its own width: a gravel bar is gentle, a cut bank steep)
    for (let side = -1; side <= 1; side += 2) {
      this.edgesFull(zg);
      let e = side < 0 ? this._el : this._er;
      let k = BH / (side < 0 ? this._swl : this._swr);
      for (let it = 0; it < 3; it++) {
        const den = k * side * dx - dy;
        if (Math.abs(den) < 1e-9) break;
        const t = (oy - k * side * (ox - e)) / den;
        if (!(t > 0) || t >= best) break;
        const zz = oz + dz * t;
        if (it < 2) {
          this.edgesFull(zz);
          e = side < 0 ? this._el : this._er;
          k = BH / (side < 0 ? this._swl : this._swr);
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
    this._ht = best;
    this._hx = bx;
    this._hz = bz;
    this._htype = type;
    if (type === 1) this.edges(bz);
  }

  /**
   * The background (ridges, sky, clouds) along a ray from (ox, oy, oz). thg: horizontal
   * distance to the ground hit (Infinity for none); if the ground is nearer than the
   * curtain in the way, returns 0 (the caller shades ground). Else writes the wash colour
   * into out and returns the id; this._bt is the distance along the ray, this._ri the
   * ridge's profile index (for the edge pass).
   */
  bg(ox, oy, oz, dx, dy, dz, thg, mt, t, out, mirror = false) {
    const hl = Math.sqrt(dx * dx + dz * dz) + 1e-9;
    const ux = dx / hl;
    const uz = dz / hl;
    const tanE = dy / hl;
    const Rs = this.ridges;
    const b = ox * ux + oz * uz;
    const c0 = ox * ox + oz * oz;
    let r = 0;
    let g = 0;
    let bb = 0;
    let id = 0;
    // a soft edge: the nearer range's wash bleeding a few pixels past its line
    let sk = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
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
      const eq = L.eq[i >> 3];
      if (Y >= top) {
        if (sk === 0 && !mirror && li < 3 && eq > 0.22 && eq <= 0.5) {
          const miss = ((Y - top) / th) * this.F;
          if (miss < 3) {
            sk = (1 - miss / 3) * 0.5;
            sr = (L.sh[0] + L.lit[0]) * 0.5;
            sg = (L.sh[1] + L.lit[1]) * 0.5;
            sb = (L.sh[2] + L.lit[2]) * 0.5;
          }
        }
        continue;
      }
      // a ridge: two flat tones split along spurs running down from the peaks
      const q = top - Y;
      let j = i - Math.round(((q / L.R) * L.skew * TAB) / TWO_PI);
      j = ((j % TAB) + TAB) % TAB;
      const sl = L.d[j] * (Math.cos(this.sun.az) > 0 ? 1 : -1);
      const lit = smooth(-0.02 * L.amp, 0.02 * L.amp, -sl);
      r = L.sh[0] + (L.lit[0] - L.sh[0]) * lit;
      g = L.sh[1] + (L.lit[1] - L.sh[1]) * lit;
      bb = L.sh[2] + (L.lit[2] - L.sh[2]) * lit;
      // brush: darker masses (trees, scrub) on the near slopes
      if (L.brush > 0 && !mirror) {
        const tx = (ang * L.R) / 7;
        const n = samp(this.tex.ground[1].d, this.tex.ground[1].N, tx, Y * 0.35 + li * 50);
        const k = smooth(0.58, 0.64, n) * L.brush * smooth(top * 0.15, top * 0.5, q);
        r -= r * k * 2;
        g -= g * k * 2;
        bb -= bb * k * 1.8;
      }
      // the top edge: pigment pools where it is found, melts into the haze where lost
      const pxBelow = (q / th) * this.F;
      let mkEdge = 0;
      if (pxBelow < 2.5 && li < 3) {
        if (eq > 0.22) {
          const k = (0.1 - li * 0.03) * (eq > 0.5 ? 1 : 0.5);
          r -= r * k;
          g -= g * k;
          bb -= bb * k * 0.8;
        } else mkEdge = 0.45 * (1 - pxBelow / 2.5);
      }
      // mist lying low between the ridges, drifting
      const mh = this.mistTab[li][Math.floor((i / TAB) * 512) & 511];
      const mk = Math.min(1, (1 - smooth(0, mh, Y)) * 0.85 + mkEdge);
      r += (MIST[0] - r) * mk;
      g += (MIST[1] - g) * mk;
      bb += (MIST[2] - bb) * mk;
      this._bt = th / hl;
      this._ri = i;
      id = ID_RIDGE + li;
      break;
    }
    if (!id) {
      if (thg < Infinity) return 0;
      id = ID_SKY;
      // the sky: vellum near the horizon, a cool grey wash overhead, never a perfect
      // ramp: the haze wanders, so it brightens and dims unevenly round the horizon
      const az = atan2f(dx, dz);
      const sv = this.skyVar(az, dy);
      const e = smooth(-0.05, 0.75, dy + (sv - 0.5) * 0.22);
      const lum = 0.95 + 0.1 * sv;
      r = (SKY_HOR[0] + (SKY_ZEN[0] - SKY_HOR[0]) * e) * lum;
      g = (SKY_HOR[1] + (SKY_ZEN[1] - SKY_HOR[1]) * e) * lum;
      bb = (SKY_HOR[2] + (SKY_ZEN[2] - SKY_HOR[2]) * e) * lum;
      this._ca = 0;
      if (dy > 0.004) {
        const tc = (this.cloudH - oy) / dy;
        const T = this.cloudTexel;
        // stretched along the wind (clouds drawn out by it)
        const wx = ox + dx * tc + this.cloudWX * t + this.cloudOX;
        const wz = oz + dz * tc + this.cloudWZ * t + this.cloudOZ;
        const cu = (wx * this.windU + wz * this.windV) / (T * 1.8);
        const cv = (-wx * this.windV + wz * this.windU) / T;
        let dens;
        if (mirror) {
          // seen in the water it is broken up anyway: one mip level is enough
          const m = this.tex.cloud[2];
          dens = samp(m.d, m.N, cu * 0.25, cv * 0.25);
        } else {
          const fp = tc / (this.F * Math.sqrt(dy));
          dens = sampMip(this.tex.cloud, cu, cv, Math.log2(fp / T + 1e-6) + 0.3);
        }
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
      this._bt = Infinity;
    }
    if (sk > 0) {
      r += (sr - r) * sk;
      g += (sg - g) * sk;
      bb += (sb - bb) * sk;
    }
    out[0] = r;
    out[1] = g;
    out[2] = bb;
    return id;
  }

  /** The sky's unevenness (0..1) by direction: azimuth (radians) and ray height. */
  skyVar(az, dy) {
    const T = this.tex.skyv;
    const u = (az + Math.PI) * (256 / TWO_PI);
    const v = Math.max(0, Math.min(46.99, (dy + 0.1) * 42));
    const x = Math.floor(u);
    const y = v | 0;
    const fx = u - x;
    const fy = v - y;
    const x0 = x & 255;
    const x1 = (x + 1) & 255;
    const a = T[y * 256 + x0];
    const b = T[y * 256 + x1];
    const c = T[(y + 1) * 256 + x0];
    const d = T[(y + 1) * 256 + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
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
   *   actors      [{ X, Z, height (m, the layer's full height), layer | layerFor(px)
   *                  (given the figure's on-screen height, returns a layer built near
   *                  it), place(x, y, scale) (a Motion's placement), Y (feet height,
   *                  default the ground or riverbed: in water the feet stand on the bed
   *                  and the surface crosses the legs), xf (extra placement: flip,
   *                  rot...), opts (drawSprite options), wade / reflect / shadow
   *                  (default true), stage (own paint stage), rings (0..1 wading rings),
   *                  seed, flat ({ yaw }: lying on the water, seen from above), sink
   *                  (0..1, how much of a flat actor the water covers),
   *                  draw(buf, { W, H, xf, feet, head, scale, stage, paper, t }) to draw
   *                  in code instead of a layer (write RGBA with alpha > 0; box
   *                  [x0, y0, x1, y1] limits the work) }]. Depth-tested per pixel
   *                  against reeds, stones, banks and each other.
   *   impulses    [impulse(x, z, t0, strength)]: shock rings, reeds flattened outward
   *   rain        0..1 (default 0.6); rainWind [wx, wz] m/s
   *   wind        gust strength multiplier (default 1)
   *   foreground  [{ X, Z, kind: 'reeds' | 'stone', h, Y, seed }] near-lens silhouettes
   *               (foregroundRow builds a row of them)
   *   splashes    [{ X, Z, t0, strength, seed }]; sprays [{ X, Z, age, ... }] (same as
   *               calling splashAt / spraySheet after render)
   *   clouds      coverage 0..1 (default 0.5)
   */
  render(frame, t, cam, o = {}) {
    const W = this.W;
    const H = this.H;
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
    this.cloudWX = 22.5;
    this.cloudWZ = -9.5;
    this.cloudOX = o.cloudOffset?.[0] ?? 2600;
    this.cloudOZ = o.cloudOffset?.[1] ?? 900;
    const wl = Math.hypot(this.cloudWX, this.cloudWZ);
    this.windU = this.cloudWX / wl;
    this.windV = this.cloudWZ / wl;
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
    const P = (this.prof = {});
    let tp = performance.now();
    const lap = (k) => {
      const n = performance.now();
      P[k] = n - tp;
      tp = n;
    };
    this.passRays(B);
    lap('rays');
    this.passReflection(B);
    lap('refl');
    this.passShade(frame, B, t);
    lap('shade');
    this.drawSun(frame, B, t);
    this.drawStones(frame, B);
    lap('stones');
    this.passEdges(frame);
    lap('edges');
    this.drawReeds(frame, B, t2, o.wind ?? 1, true);
    this.drawReeds(frame, B, t2, o.wind ?? 1, false);
    lap('reeds');
    this.combine(frame, stage);
    if (o.actors?.length) this.drawActors(frame, cam, B, t, o.actors, stage);
    lap('actors');
    for (const s of o.splashes || [])
      this.splashAt(frame, cam, s.X, s.Z, t, s.t0, s.strength ?? 1, s.seed ?? 1);
    for (const s of o.sprays || []) this.spraySheet(frame, cam, s);
    if (this.rain > 0) this.drawRain(frame, B, t, o.rainWind || [1.2, 0]);
    if (o.foreground?.length) this.drawForeground(frame, B, t2, o.foreground, o.wind ?? 1);
    lap('fx');
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
          if (this._htype === 1) {
            this.gEL[i] = this._el;
            this.gER[i] = this._er;
          }
        } else {
          this.gT[i] = Infinity;
          this.gType[i] = 0;
        }
      }
    }
  }

  /**
   * The background seen in the water: for a pixel whose ray goes down, the sky and
   * ridges along the mirrored ray from the camera mirrored in Y = 0. Computed lazily
   * (only where the water samples it, see reflAt). The Hollow Sun is not drawn into
   * it: the water breaks it into facets itself (sunGlitter); this only finds where its
   * mirror image sits.
   */
  passReflection(B) {
    this.frameNo = (this.frameNo + 1) >>> 0 || 1;
    this.mtMirror = this.maxTans(B.ox, -B.oy, B.oz);
    const s = this.sunDir();
    const { W, H } = this;
    // where the Hollow Sun's mirror image sits: the water breaks it into facets itself
    // (sunGlitter), so it is not drawn into the reflection image
    const z = s[0] * B.fx - s[1] * B.fy + s[2] * B.fz;
    this.reflSunBox = null;
    this.msun = null;
    // the horizon's height on screen at the frame's centre (where the column points)
    {
      const hx = B.fx;
      const hz = B.fz;
      const hl = Math.hypot(hx, hz) || 1;
      const zz = (hx * B.fx + hz * B.fz) / hl;
      this.horizonY = B.cy - (((hx * B.ux + hz * B.uz) / hl) * B.F) / Math.max(1e-3, zz);
    }
    if (z > 0.05) {
      const px = B.cx + ((s[0] * B.rx - s[1] * B.ry + s[2] * B.rz) * B.F) / z;
      const py = B.cy - ((s[0] * B.ux - s[1] * B.uy + s[2] * B.uz) * B.F) / z;
      const r = Math.max(2, (B.F * Math.tan(this.sun.r)) / z);
      if (px > -3 * r && px < W + 3 * r && py < H + r) this.msun = { px, py, r };
    }
  }

  /**
   * The Hollow Sun broken by the current: the water is a field of small tilted mirrors
   * (facets long across the flow, short along it, drifting with the current and rocking),
   * and each one shows whatever part of the mirrored sun its tilt points it at. So the
   * image falls apart into horizontal slivers strung down a long column under the sun:
   * whole-ish near its mirror image, thinner, sparser and paler toward the camera, the
   * gold ring surviving as broken glints. Returns 0 (none), else writes the colour into
   * c and returns 1 (disc) or 2 (ring).
   */
  sunGlitter(x, y, X, zf, fpA, fpL, t, c, gt = 50) {
    const ms = this.msun;
    const rs = ms.r;
    const ddx = x - ms.px;
    const ddy = y - ms.py;
    if (Math.abs(ddx) > rs * 2.4) return 0;
    // 0 at the mirror image, 1 at the frame's foot (below) or the horizon (above)
    // (toward the horizon the path stays dense: the slivers only get thinner there)
    const q =
      ddy >= 0
        ? clamp(ddy / Math.max(24, this.H - ms.py))
        : 0.3 * clamp(-ddy / Math.max(12, ms.py - this.horizonY));
    // the facets: a brick grid in (across, along) scaled to the pixel footprint, so they
    // are a few pixels tall at any distance and drift down the frame with the current
    const v = zf / (fpL * (2.6 - 1.2 * q)) + 0.3;
    const jv = Math.floor(v);
    const u = X / (fpA * (9 + 12 * hash(jv, 3, 71))) + hash(jv, 1, 71) * 7;
    const iu = Math.floor(u);
    const h1 = hash(iu, jv, 72);
    const h2 = hash(iu, jv, 73);
    const h3 = hash(iu, jv, 74);
    // each facet rocks with the swell: its tilt sends it up and down the column
    const amp = rs * 1.15 + Math.abs(ddy) * 1.1;
    const G = (Math.sin(h1 * 40 + t * (2.2 + 2.6 * h2)) * 0.5 + (h3 - 0.5)) * amp;
    // close to the lens the facets are few, small and pale: the image is far off
    const nearK = smooth(2, 26, gt);
    const rr = rs * (1 - 0.5 * q) * (0.55 + 0.45 * nearK);
    const ex = (ddx + (h2 - 0.5) * rs * (0.5 + 0.9 * q)) / rr;
    const ey = (ddy + G) / rr;
    const d = Math.sqrt(ex * ex + ey * ey);
    const ring = 0.2 + 0.35 * q;
    if (d > 1 + ring) return 0;
    // near the camera many facets show only water: the image thins out
    if (hash(iu, jv, 75) < 0.15 + 0.5 * q + 0.35 * (1 - nearK)) return 0;
    if (d > 1 - 0.08) {
      // the ring: broken gold glints
      if (hash(iu, jv, 76) < 0.2 + 0.4 * q) return 0;
      const hot = d < 1 + ring * 0.5;
      c[0] = hot ? 246 : 226;
      c[1] = hot ? 208 : 182;
      c[2] = hot ? 116 : 104;
      return 2;
    }
    // the disc: ink, paler as the slivers get thin toward the camera
    const k = (0.92 - 0.62 * q) * (0.4 + 0.6 * nearK);
    c[0] += (14 - c[0]) * k;
    c[1] += (12 - c[1]) * k;
    c[2] += (22 - c[2]) * k;
    return 1;
  }

  /** The reflection image at pixel j (computed on first use this frame). */
  reflAt(j, t) {
    if (this.rstamp[j] === this.frameNo) return;
    this.rstamp[j] = this.frameNo;
    const B = this.B;
    const o = j * 4;
    const dy = this.rdy[j];
    const refl = this.refl;
    if (dy >= -0.0005) {
      refl[o] = HAZE[0];
      refl[o + 1] = HAZE[1];
      refl[o + 2] = HAZE[2];
      this.reflId[j] = ID_SKY;
      return;
    }
    const out = this.bgOut;
    const id = this.bg(
      B.ox,
      -B.oy,
      B.oz,
      this.rdx[j],
      -dy,
      this.rdz[j],
      Infinity,
      this.mtMirror,
      t,
      out,
      true,
    );
    refl[o] = out[0];
    refl[o + 1] = out[1];
    refl[o + 2] = out[2];
    this.reflId[j] = id;
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
        // clouds drift across its corona; the disc and the ring always read
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        if (!mirror && d2 > (r + 1.6) * (r + 1.6)) a = 1 - this.cloudA[i] * 0.6;
        buf[o] = tmp[o] * a + this.cloudC[o] * (1 - a);
        buf[o + 1] = tmp[o + 1] * a + this.cloudC[o + 1] * (1 - a);
        buf[o + 2] = tmp[o + 2] * a + this.cloudC[o + 2] * (1 - a);
        if (!mirror && (x - px) * (x - px) + (y - py) * (y - py) <= (r + 0.6) * (r + 0.6))
          ids[i] = ID_SUN;
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
          if (id >= ID_RIDGE) this.ridx[i] = this._ri;
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
          // a slope faces the camera more than the flat ground: finer footprint
          this.shadeBank(i, X, Z, gt, type === 3 ? fpA * 2.2 : fpL, type, c);
        }
        // aerial perspective over the ground: the haze thickens unevenly round the
        // horizon and turns to mist far off, so the far edge is never a ruled line
        let fog = gt / (gt + 240);
        if (gt > 40) fog = Math.min(1, fog * (0.7 + 0.6 * this.skyVar(atan2f(dx, dz), 0.02)));
        const fm = gt > 60 ? Math.min(1, (gt - 60) / 400) : 0;
        const hr = HAZE[0] + (MIST[0] - HAZE[0]) * fm;
        const hg = HAZE[1] + (MIST[1] - HAZE[1]) * fm;
        const hb = HAZE[2] + (MIST[2] - HAZE[2]) * fm;
        const r = c[0] + (hr - c[0]) * fog;
        const g = c[1] + (hg - c[1]) * fog;
        const b = c[2] + (hb - c[2]) * fog;
        frame[o] = paper[o] * r * KR;
        frame[o + 1] = paper[o + 1] * g * KG;
        frame[o + 2] = paper[o + 2] * b * KB;
        frame[o + 3] = 255;
      }
  }

  shadeBank(i, X, Z, gt, fpL, type, c) {
    this.edgesFull(Z);
    const left = X < (this._el + this._er) / 2;
    const de = left ? this._el - X : X - this._er;
    const sw = left ? this._swl : this._swr;
    const bar = left ? this._bl : this._br;
    const T = this.tex;
    const lodF = Math.log2(fpL / 0.5 + 1e-6);
    const n = sampMip(T.ground, X / 0.5, Z / 0.5, lodF);
    const n2 = sampMip(T.ground, X / 4.5 + 40, Z / 4.5, Math.log2(fpL / 4.5 + 1e-6));
    // winter grass in two flat tones, the boundary softening with distance
    const wv = 0.03 + 0.12 * clamp(lodF / 5);
    const g = smooth(0.5 - wv, 0.5 + wv, n2);
    let r = GRASS_B[0] + (GRASS_A[0] - GRASS_B[0]) * g;
    let gg = GRASS_B[1] + (GRASS_A[1] - GRASS_B[1]) * g;
    let b = GRASS_B[2] + (GRASS_A[2] - GRASS_B[2]) * g;
    // dark tufts close up
    const tuft = smooth(0.64, 0.7, n) * (1 - clamp(lodF / 3));
    r -= r * 0.17 * tuft;
    gg -= gg * 0.17 * tuft;
    b -= b * 0.14 * tuft;
    // mud toward the water, wet and dark at its edge, pebbles on it
    const mud = 1 - smooth(0.25, 1.5 + n2 * 2.2, de);
    r += (MUD[0] - r) * mud;
    gg += (MUD[1] - gg) * mud;
    b += (MUD[2] - b) * mud;
    const wet = (1 - smooth(0, 0.4, de)) * 0.8;
    r += (WET_MUD[0] - r) * wet;
    gg += (WET_MUD[1] - gg) * wet;
    b += (WET_MUD[2] - b) * wet;
    if (mud > 0.5 && n < 0.24 && lodF < 1.5) {
      r += (STONE_LIT[0] - r) * 0.55;
      gg += (STONE_LIT[1] - gg) * 0.55;
      b += (STONE_LIT[2] - b) * 0.55;
    }
    // puddles in the trodden mud hold the sky
    if (mud > 0.55 && type === 2 && gt < 60) {
      const g0 = T.ground[0];
      if (samp(g0.d, g0.N, X / 0.045 + 33, Z / 0.045 + 9) > 0.7) {
        this.reflAt(i, this.t);
        const o = i * 4;
        const k = 0.7;
        r += (this.refl[o] * 0.88 - r) * k;
        gg += (this.refl[o + 1] * 0.93 - gg) * k;
        b += (this.refl[o + 2] - b) * k;
      }
    }
    // a gravel bar: pale stones in drifts along the current, dark and wet at the water
    let gk = 0;
    if (bar > 0.05) {
      gk = 1 - smooth(bar * 0.7, bar * 1.1 + n2 * 1.4, de);
      if (gk > 0) {
        const drift = samp(T.streak, T.M, X / 0.35 + 3, Z / 2.2);
        const dry = smooth(0.1, 1.2, de);
        let pr = GRAVEL_W[0] + (GRAVEL[0] - GRAVEL_W[0]) * dry;
        let pg = GRAVEL_W[1] + (GRAVEL[1] - GRAVEL_W[1]) * dry;
        let pb = GRAVEL_W[2] + (GRAVEL[2] - GRAVEL_W[2]) * dry;
        if (drift > 0.62) {
          pr *= 0.88;
          pg *= 0.88;
          pb *= 0.9;
        }
        if (lodF < 2) {
          // pebbles close up: dark and light stones
          const g0 = T.ground[0];
          const pn = samp(g0.d, g0.N, X / 0.04 + 17, Z / 0.04 + 5);
          const near = 1 - clamp(lodF / 2);
          if (pn > 0.68) {
            pr -= pr * 0.22 * near;
            pg -= pg * 0.22 * near;
            pb -= pb * 0.2 * near;
          } else if (pn < 0.28) {
            pr += (GRAVEL_HI[0] - pr) * 0.6 * near;
            pg += (GRAVEL_HI[1] - pg) * 0.6 * near;
            pb += (GRAVEL_HI[2] - pb) * 0.6 * near;
          }
        }
        r += (pr - r) * gk;
        gg += (pg - gg) * gk;
        b += (pb - b) * gk;
      }
    }
    if (type === 3 && gk < 0.9) {
      // the cut bank: dark earth, runnels of wet mud down it, a lighter lip
      const k = (0.35 + 0.35 * (1 - clamp(de / sw))) * (1 - gk);
      r += (SLOPE_C[0] - r) * k;
      gg += (SLOPE_C[1] - gg) * k;
      b += (SLOPE_C[2] - b) * k;
      const run = samp(T.ground[0].d, T.ground[0].N, Z / 0.02 + 90, de / 0.35);
      if (run > 0.62) {
        r *= 0.84;
        gg *= 0.84;
        b *= 0.86;
      } else if (run < 0.3 && de > sw * 0.7) {
        r += (GRASS_B[0] - r) * 0.5;
        gg += (GRASS_B[1] - gg) * 0.5;
        b += (GRASS_B[2] - b) * 0.5;
      }
    }
    c[0] = r;
    c[1] = gg;
    c[2] = b;
  }

  shadeWater(i, x, y, X, Z, gt, dx, dy, dz, fpA, fpL, t, c) {
    const T = this.tex;
    const M = T.M;
    const wv = T.wv;
    const W = this.W;
    const H = this.H;
    const zf = Z + this.flow * t;
    // wave slope: three octaves drifting with the current, each fading out before it
    // would be finer than a few pixels (far water calms to a mirror with long swells)
    let gx = 0;
    let gz = 0;
    let hv = 0.5;
    let g1 = 0;
    let hv2 = -1;
    let g2 = 0;
    const ip = 1 / fpL;
    let w0 = (3.0 * ip - 1.5) * 0.2857;
    if (w0 > 0) {
      if (w0 > 1) w0 = 1;
      sampWave(wv, M, X / 0.28 + 11, zf / 0.28 + 0.1 * t);
      gx += WS[0] * w0;
      gz += WS[1] * w0;
    }
    let w1 = (0.8 * ip - 1.5) * 0.2857;
    if (w1 > 0) {
      if (w1 > 1) w1 = 1;
      sampWave(wv, M, X / 0.075, zf / 0.075 + 0.3 * t);
      gx += WS[0] * w1 * 0.55;
      gz += WS[1] * w1 * 0.55;
      hv = WS[2];
      g1 = Math.sqrt(WS[0] * WS[0] + WS[1] * WS[1]);
    } else w1 = 0;
    let w2 = (0.28 * ip - 1.5) * 0.2857;
    if (w2 > 0) {
      if (w2 > 1) w2 = 1;
      w2 *= 0.3;
      sampWave(wv, M, X / 0.026 + 37, (zf * 1.3) / 0.026 - 0.9 * t);
      gx += WS[0] * w2;
      gz += WS[1] * w2;
      hv2 = WS[2];
      g2 = Math.sqrt(WS[0] * WS[0] + WS[1] * WS[1]);
    }
    // slope -> screen displacement of the reflection: along the view it stretches the
    // image vertically (the glitter path), across it shifts it a little sideways
    const hl = Math.sqrt(dx * dx + dz * dz) + 1e-9;
    const vx = dx / hl;
    const vz = dz / hl;
    const along = gx * vx + gz * vz;
    const across = gx * vz - gz * vx;
    const F = this.F;
    let wdy = along * F * 0.75;
    let wdx = across * F * 0.5 * (0.35 - 0.65 * dy);
    // shock rings from impulses: the surface jumps where the front passes
    let shock = 0;
    for (let k = 0; k < this.impulses.length; k++) {
      const im = this.impulses[k];
      const u = t - im.t0;
      if (u < 0 || u > 1.6) continue;
      const ex = X - im.x;
      const ez = Z - im.z;
      const d = Math.sqrt(ex * ex + ez * ez);
      const q = (d - 10 * u) / (0.3 + fpA);
      if (q * q > 9) continue;
      const e = Math.exp(-q * q) * (1 - u / 1.6) * im.strength;
      if (e > shock) shock = e;
      wdy += e * 12;
    }
    if (wdy > 30) wdy = 30;
    else if (wdy < -30) wdy = -30;
    if (wdx > 8) wdx = 8;
    else if (wdx < -8) wdx = -8;
    this.wdx[i] = wdx;
    this.wdy[i] = wdy;
    // sample the mirrored background
    let sx = (x + wdx + 0.5) | 0;
    let sy = (y + wdy + 0.5) | 0;
    if (sx < 0) sx = 0;
    else if (sx >= W) sx = W - 1;
    if (sy < 0) sy = 0;
    else if (sy >= H) sy = H - 1;
    const sb = this.reflSunBox;
    if (!sb || sx < sb[0] || sx > sb[2] || sy < sb[1] || sy > sb[3]) {
      // the waves break the mirrored sky up anyway: look it up on a 2x2 grid
      sx &= ~1;
      sy &= ~1;
    }
    let j = sy * W + sx;
    if (this.rdy[j] > -0.0005) j = i; // displaced out of the reflection: stay put
    this.reflAt(j, t);
    const ro = j * 4;
    // water takes a little red out of what it mirrors (cooler than the sky)
    let rr = this.refl[ro] * 0.9;
    let rg = this.refl[ro + 1] * 0.95;
    let rb = this.refl[ro + 2];
    let glint = 0;
    if (rr - rb > 60 && rr > 126)
      glint = 1; // the gold ring
    else if (rr < 24 && rg < 24 && rb < 30) glint = 2; // its black disc
    // the banks seen in the water near the edges (along the displaced ray: broken too)
    const el = this.gEL[i];
    const er = this.gER[i];
    const jdx = this.rdx[j];
    const jdz = this.rdz[j];
    const jhl = Math.sqrt(jdx * jdx + jdz * jdz) + 1e-9;
    const jvx = jdx / jhl;
    const tanR = -this.rdy[j] / jhl;
    let dist = Infinity;
    if (jvx > 0.02) dist = (er - X) / jvx;
    else if (jvx < -0.02) dist = (el - X) / jvx;
    if (dist < Infinity && (dist + (this.slopeW * 0.6) / Math.abs(jvx)) * tanR < this.bankH) {
      rr += (BANK_REFL[0] - rr) * 0.85;
      rg += (BANK_REFL[1] - rg) * 0.85;
      rb += (BANK_REFL[2] - rb) * 0.85;
      glint = -1;
    }
    // the water itself: the bed (pebbles, wobbling with the surface) in the shallows,
    // dark steel in the deep
    const half = (er - el) / 2;
    const ctr = (el + er) / 2;
    const dEdge = half - Math.abs(X - ctr);
    const depth = depthProfile(Math.abs(X - ctr) / half) * Math.sqrt(half / 8);
    let br = BED[0];
    let bg = BED[1];
    let bb = BED[2];
    const ad0 = -dy;
    if (fpL < 0.3 && ad0 > 0.25) {
      // rock shelves and pebbles, seen through the moving surface
      const g0 = T.ground[0];
      const bx = X + gx * 0.08;
      const bz = Z + gz * 0.08;
      const big = samp(g0.d, g0.N, bx / 0.03, bz / 0.03);
      const peb = samp(g0.d, g0.N, bx / 0.009 + 71, bz / 0.009 + 13);
      const k = (1 - smooth(0.1, 0.3, fpL)) * 0.6;
      if (big > 0.62) {
        br += (BED_DARK[0] - br) * k;
        bg += (BED_DARK[1] - bg) * k;
        bb += (BED_DARK[2] - bb) * k;
      } else if (peb < 0.3 && fpL < 0.12) {
        br += (BED_LIGHT[0] - br) * k;
        bg += (BED_LIGHT[1] - bg) * k;
        bb += (BED_LIGHT[2] - bb) * k;
      }
    }
    const dk = depth / (depth + 0.45);
    br += (WATER_DEEP[0] - br) * dk;
    bg += (WATER_DEEP[1] - bg) * dk;
    bb += (WATER_DEEP[2] - bb) * dk;
    // reflectance: a mirror at grazing angles, clearer looking down
    const ad = -dy;
    const R = 0.3 + 0.64 * (1 - ad) * (1 - ad) * (1 - ad);
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
    // the Hollow Sun, broken into facets by the current
    if (this.msun && glint === 0) {
      c[0] = r;
      c[1] = g;
      c[2] = b;
      const sg = this.sunGlitter(x, y, X, zf, fpA, fpL, t, c, gt);
      if (sg) {
        r = c[0];
        g = c[1];
        b = c[2];
        glint = 2 + sg;
      }
    }
    // ripple marks: the troughs a flat darker tone, each crest a thin light line (a
    // net of strokes across the current, like the painted plate)
    if (w1 > 0 && glint <= 0) {
      const graze = 1 - ad * ad;
      const dark = hv < 0.24 ? Math.min(1, (0.24 - hv) * 8.3) * w1 * graze : 0;
      if (dark > 0) {
        r -= r * 0.18 * dark;
        g -= g * 0.18 * dark;
        b -= b * 0.12 * dark;
      }
      // looking down, the finer ripples make the net; across the water, the coarser
      const fine = ad > 0.6 && hv2 >= 0;
      const band = fine
        ? Math.max(0.01, 0.6 * g2 * (fpL / 0.026))
        : Math.max(0.012, 0.75 * g1 * (fpL / 0.075));
      const dh = (fine ? hv2 : hv) - 0.7;
      const gate = fine
        ? samp(T.streak, M, X / 0.012 + 5, zf / 0.03)
        : samp(T.streak, M, X / 0.02 + 5, zf / 0.2);
      if (dh < band && dh > -band && gate > (fine ? 0.5 : 0.45)) {
        // near ripples are drawn strokes too (they stay, thinly, in the line stage)
        if (gt < 14) this.line[i] = 0.35 * w1;
        const k = 0.5 * w1;
        r += (SKY_HOR[0] + 14 - r) * k;
        g += (SKY_HOR[1] + 14 - g) * k;
        b += (SKY_HOR[2] + 16 - b) * k;
      }
    }
    // highlights: flow streaks, foam at stones and the edge, rain rings, the shock ring
    let foam = 0;
    if (fpA < 0.08) {
      const s = samp(T.streak, M, X / 0.03, zf / 0.05);
      if (s > 0.87) foam = Math.min(1, (s - 0.87) * 20) * (1 - smooth(0.025, 0.08, fpA)) * 0.3;
    }
    if (dEdge < Math.max(0.07, fpA)) {
      if (valueNoise(Z * 3 + t * 2, X * 0.5, 5) > 0.42) foam = Math.max(foam, 0.8);
    }
    // stones: a broken foam collar, a pillow upstream, a wake downstream
    const gcx = Math.floor(X / 4) + 16;
    const gcz = Math.floor(Z / 4) + 16;
    const cell = gcx >= 0 && gcz >= 0 && gcx < 32 && gcz < 48 ? this.sgrid[gcz * 32 + gcx] : -1;
    if (cell >= 0 && gt < 90) {
      const sidx = this.sidx;
      const sd = this.sdat;
      const cnt = sidx[cell];
      for (let k = 1; k <= cnt; k++) {
        const q = sidx[cell + k] * 4;
        const sa = sd[q + 2];
        const scc = sd[q + 3];
        const ddx = X - sd[q];
        const ddz = Z - sd[q + 1];
        if (ddz > scc * 1.4 || ddz < -scc - 5 || Math.abs(ddx) > sa * 1.8 + 0.3 - ddz * 0.2)
          continue;
        const ex = ddx / sa;
        const ez = ddz / scc;
        let e = Math.sqrt(ex * ex + ez * ez);
        const rim = Math.max(0.03, fpA * 1.1) / sa;
        if (e > 0.9 && e < 1.4) {
          // an irregular collar, lapping: never a clean ellipse
          const an = Math.atan2(ddz, ddx);
          e -= 0.16 * (valueNoise(an * 2.5 + k * 3, t * 1.5, 19) - 0.3);
          if (e > 0.95 && e < 1 + rim && valueNoise(an * 5 + t * 4, e * 4, 17) > 0.45)
            foam = Math.max(foam, 0.95);
          else if (ddz > 0 && e >= 1 && e < 1.25) foam = Math.max(foam, 0.18); // the pillow
        }
        const dn = -ddz - scc * 0.4;
        if (dn > 0 && dn < 5) {
          const spread = sa * (0.7 + 0.2 * dn);
          const lat = Math.abs(ddx);
          const aw = 0.025 + 0.012 * dn + fpA * 0.6;
          const q = (lat - spread) / aw;
          const q2 = 1 - q * q * 0.5;
          const arm = q2 > 0 ? q2 * q2 : 0;
          const fall = 1 - dn / 5;
          const mid = lat < spread ? 0.3 * fall * fall * fall * fall : 0;
          const am = arm > mid ? arm : mid;
          if (am * fall > 0.05) {
            const n = samp(T.streak, M, ddx / 0.025, (ddz + this.flow * t * 1.4) / 0.05);
            const k2 = am * fall * clamp((n - 0.5) * 5) * 0.6;
            if (k2 > foam) foam = k2;
          }
        }
      }
    }
    // rain rings: each 1.1 m cell has a drop every so often
    if (this.rain > 0 && gt < 30) {
      // rain rings: each 0.8 m cell has a drop every so often, kept inside the cell so
      // one lookup per pixel is enough
      const cs = 0.8;
      const rc = T.rc;
      const cx = Math.floor(X / cs);
      const cz = Math.floor(Z / cs);
      const k = ((cz & 63) * 64 + (cx & 63)) * 3;
      if (rc[k] < this.rain * 0.8) {
        const per = rc[k + 1];
        const ph = rc[k + 2] * per;
        const n = Math.floor((t + ph) / per);
        const age = t + ph - n * per;
        if (age < 0.5) {
          const px = (cx + 0.3 + hash(cx * 3 + n, cz, 204) * 0.4) * cs;
          const pz = (cz + 0.3 + hash(cx, cz * 3 + n, 205) * 0.4) * cs;
          const ex = X - px;
          const ez = Z - pz;
          const d = Math.sqrt(ex * ex + ez * ez);
          const w = Math.max(0.012, fpA * 0.6);
          if (Math.abs(d - 0.02 - age * 0.3) < w) foam = Math.max(foam, (1 - age / 0.5) * 0.75);
        }
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

  /**
   * Ray (from the camera, unit d) against stone s: sets this._st (Infinity: miss), the
   * local normal this._sn, this._flat (1 when a cut face was hit, not the rounded body)
   * and this._edge (how near the hit is to the next face, in local units: a crack or an
   * arris when small). A stone is an ellipsoid cut by a few planes (its facets, and the
   * flat crown), so it has hard edges and a broken silhouette.
   */
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
    let tE = (-Bq - sq) / (2 * A);
    let tX = (-Bq + sq) / (2 * A);
    let fk = -1; // the face entered (-1: the rounded body)
    let t2 = -Infinity; // the next latest entry (for the edge)
    const F = s.fac;
    for (let k = 0; k < F.length; k += 4) {
      const den = F[k] * ex + F[k + 1] * ey + F[k + 2] * ez;
      const num = F[k + 3] - (F[k] * lx + F[k + 1] * ly + F[k + 2] * lz);
      if (den < -1e-9) {
        const t = num / den;
        if (t > tE) {
          t2 = tE;
          tE = t;
          fk = k;
        } else if (t > t2) t2 = t;
      } else if (den > 1e-9) {
        const t = num / den;
        if (t < tX) tX = t;
      } else if (num < 0) {
        this._st = Infinity;
        return;
      }
    }
    if (tE > tX) {
      this._st = Infinity;
      return;
    }
    this._st = tE;
    this._edge = (tE - t2) * Math.sqrt(A);
    const n = this._sn;
    if (fk >= 0) {
      this._flat = 1;
      n[0] = F[fk];
      n[1] = F[fk + 1];
      n[2] = F[fk + 2];
    } else {
      this._flat = 0;
      n[0] = lx + ex * tE;
      n[1] = ly + ey * tE;
      n[2] = lz + ez * tE;
    }
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
              const nx0 = this._sn[0];
              const ny0 = this._sn[1];
              const nz0 = this._sn[2];
              const nxw = (nx0 / s.a) * s.ex + (nz0 / s.c) * s.ez;
              const nzw = -(nx0 / s.a) * s.ez + (nz0 / s.c) * s.ex;
              const nyw = ny0 / s.ry;
              const nl = Math.sqrt(nxw * nxw + nyw * nyw + nzw * nzw);
              const mx = nxw / nl;
              const my = nyw / nl;
              const mz = nzw / nl;
              const cutFace = this._flat === 1;
              const top = cutFace && my > 0.97;
              // an arris or crack where two faces meet (about a pixel wide)
              const crack = this._edge * Math.min(s.a, s.ry, s.c) < (1.1 * z) / this.F;
              const dif = mx * Lx + my * Ly + mz * Lz;
              // flat washes: the crown lit (the slick one wet), faces by their angle,
              // dark and wet at the waterline
              let c = top
                ? s.slick
                  ? STONE_MID
                  : STONE_LIT
                : dif > 0.6 && hy > s.top * 0.35
                  ? STONE_LIT
                  : dif > 0.2
                    ? STONE_MID
                    : STONE_SH;
              if (!top && hy < 0.03 + 0.04 * s.a) c = STONE_WET;
              if (crack && hy > 0.03) c = STONE_WET;
              // wet patches and lichen: a flat second tone over the surface
              let tn = s.tone;
              const g0 = this.tex.ground[0];
              const pn = samp(
                g0.d,
                g0.N,
                (ox + dx * st) / 0.012 + s.i * 37,
                (oz + dz * st) / 0.012 + hy / 0.012,
              );
              if (pn > 0.66) tn *= 0.86;
              else if (pn < 0.26 && c !== STONE_WET) tn *= 1.08;
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
          } else if (a >= ID_RIDGE && a < ID_RIDGE + 5) {
            if ((b < ID_RIDGE || b > a) && b < ID_BANK) {
              // only the found stretches of a contour are inked; soft ones bleed, lost
              // ones melt into the haze (bg), and the drawing keeps them thinner
              const li = a - ID_RIDGE;
              const eq = this.ridges[li].eq[this.ridx[i] >> 3];
              const found = eq > 0.5;
              const keep = eq > 0.22 ? 1 : 0.45;
              if (li === 0) {
                if (found) wash = Math.max(wash, 1);
                ln = Math.max(ln, keep);
                pc = Math.max(pc, found ? 1 : 0);
              } else if (li === 1) {
                if (found) wash = Math.max(wash, 2.5);
                ln = Math.max(ln, keep * 0.9);
                pc = Math.max(pc, found ? 0.5 : 0);
              } else ln = Math.max(ln, keep * (li === 2 ? 0.7 : 0.4));
            }
          } else if (a === ID_SUN && b !== ID_SUN) {
            // drawn in code: its ring stays as a line when the paint lifts
            ln = 1;
            pc = 1;
          } else if (a === ID_THICK && b === ID_SKY) {
            // cloud cores: inked here and there, never all round
            const az = atan2f(this.rdx[i], this.rdz[i]);
            const cq = valueNoise(az * 7 + 11, this.rdy[i] * 9, 77);
            if (cq > 0.5) wash = Math.max(wash, 2.5);
            ln = Math.max(ln, cq > 0.3 ? 0.85 : 0.3);
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

  /** Outward push of the impulses at (X, Z) (radians of bend): sets this._px, _pz. */
  push(X, Z, t) {
    let px = 0;
    let pz = 0;
    for (const im of this.impulses) {
      const u = t - im.t0;
      if (u < 0 || u > 3) continue;
      const dx = X - im.x;
      const dz = Z - im.z;
      const d = Math.sqrt(dx * dx + dz * dz) + 1e-6;
      const tau = u - d / 11;
      if (tau < 0) continue;
      const k = im.strength * (1.25 / (1 + d / 7)) * Math.exp(-tau * 2.4) * Math.cos(tau * 7);
      px += (dx / d) * k;
      pz += (dz / d) * k;
    }
    this._px = px;
    this._pz = pz;
  }

  /**
   * The reeds: ink strokes with a little wash, bending with the gusts, drawn on twos.
   * mirror: their reflections in the water (drawn first). Far clumps thin out to a
   * blade or two and take the grass's tone, so a bank reads as a mass, not hatching.
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
    const zbuf = this.zbuf;
    const ids = this.ids;
    if (mirror) this.rmark.fill(0);
    for (let c = 0; c < C_.length; c += 7) {
      const X = C_[c];
      const Yb = C_[c + 1];
      const Z = C_[c + 2];
      const maxH = C_[c + 5];
      const de = C_[c + 6];
      if (mirror && de > 1.3) continue;
      const vx = X - ox;
      const vy = Yb + maxH * 0.5 - oy;
      const vz = Z - oz;
      const z = vx * fx + vy * fy + vz * fz;
      if (z < 0.4 || z > 75) continue;
      const iz = F / z;
      const hpx = iz * maxH;
      if (hpx < 5 || (mirror && z > 45)) continue;
      const sx = cx + (vx * rx + vy * ry + vz * rz) * iz;
      const sy = cy - (vx * ux + vy * uy + vz * uz) * iz;
      const m = hpx * 1.6 + 4;
      if (sx < -m || sx > W + m || sy < -m || sy > H + m + (mirror ? m : 0)) continue;
      const g = this.gust(X, Z, t2);
      let ipx = 0;
      let ipz = 0;
      if (hasImp) {
        this.push(X, Z, t2);
        ipx = this._px;
        ipz = this._pz;
      }
      // colour: ink up close; further off the grass's tone, then the haze
      const fg = smooth(9, 45, z) * 0.75;
      const fh = smooth(25, 80, z) * 0.6;
      let cr = REED_T[0] + (REED_FAR[0] - REED_T[0]) * fg;
      let cg = REED_T[1] + (REED_FAR[1] - REED_T[1]) * fg;
      let cb = REED_T[2] + (REED_FAR[2] - REED_T[2]) * fg;
      cr += (HAZE[0] - cr) * fh;
      cg += (HAZE[1] - cg) * fh;
      cb += (HAZE[2] - cb) * fh;
      const ink = z < 6.5 && !mirror;
      if (!ink && !mirror && z < 22) {
        const k = 1 - smooth(6.5, 22, z);
        cr += (MIDREED[0] - cr) * k;
        cg += (MIDREED[1] - cg) * k;
        cb += (MIDREED[2] - cb) * k;
      }
      const lineCov = z < 8 ? 1 : z < 20 ? 0.55 : 0;
      const penCov = z < 6 ? 1 : 0;
      const wide = iz > 110 && !mirror;
      const first = C_[c + 3];
      const nb = C_[c + 4];
      const nDraw = hpx < 16 ? 1 : hpx < 30 ? Math.min(nb, 3) : hpx < 60 ? Math.ceil(nb * 0.6) : nb;
      for (let bI = 0; bI < nDraw; bI++) {
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
        const tl = Math.sqrt(tx * tx + tz * tz) + 1e-6;
        const th = Math.min(1.45, tl);
        tx /= tl;
        tz /= tl;
        // 4 segments, bending more toward the tip
        let px = bx;
        let py = by;
        let pz = bz;
        const seg = h / 4;
        const curl = 1.05 + 0.9 * ((ph * 7.3) % 1);
        const press = 0.5 + 0.5 * ((ph * 3.1) % 1);
        for (let k = 0; k <= 4; k++) {
          if (k > 0) {
            const phi = th * ((k - 0.5) / 4) ** curl;
            const sp = Math.sin(phi) * seg;
            px += tx * sp;
            pz += tz * sp;
            py += Math.cos(phi) * seg;
          }
          const qx = px - ox;
          const qy = (mirror ? -py : py) - oy;
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
          const zz = pts[a + 2];
          const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
          for (let s = 0; s <= n; s++) {
            const u = s / n;
            const X_ = Math.round(x0 + (x1 - x0) * u);
            const Y_ = Math.round(y0 + (y1 - y0) * u);
            if (X_ < 0 || Y_ < 0 || X_ >= W || Y_ >= H) continue;
            const i = Y_ * W + X_;
            if (mirror) {
              if (ids[i] !== ID_WATER) continue;
              // broken by the same waves as the rest of the reflection
              const jx = Math.round(X_ - this.wdx[i] * 0.5);
              const jy = Math.round(Y_ - this.wdy[i] * 0.4);
              if (jx < 0 || jy < 0 || jx >= W || jy >= H) continue;
              const j = jy * W + jx;
              if (ids[j] !== ID_WATER || this.rmark[j]) continue;
              this.rmark[j] = 1;
              const oj = j * 4;
              frame[oj] = frame[oj] * 0.62 + paper[oj] * cr * KR * 0.2;
              frame[oj + 1] = frame[oj + 1] * 0.62 + paper[oj + 1] * cg * KG * 0.2;
              frame[oj + 2] = frame[oj + 2] * 0.64 + paper[oj + 2] * cb * KB * 0.2;
              continue;
            }
            if (zz >= zbuf[i]) continue;
            // the pen lifts toward the tip, some blades pressed harder than others
            if (ink && press * (1 - 0.18 * k) < bayer(X_ + bI, Y_) * 0.85) continue;
            zbuf[i] = zz;
            ids[i] = ID_REED;
            const o = i * 4;
            if (ink) {
              frame[o] = SEPIA[0];
              frame[o + 1] = SEPIA[1];
              frame[o + 2] = SEPIA[2];
            } else {
              frame[o] = paper[o] * cr * KR;
              frame[o + 1] = paper[o + 1] * cg * KG;
              frame[o + 2] = paper[o + 2] * cb * KB;
            }
            if (lineCov > this.line[i]) this.line[i] = lineCov;
            if (penCov) this.pencil[i] = 1;
            // a little wash beside the stroke when close
            if (wide && k < 3 && X_ + 1 < W && zz < zbuf[i + 1]) {
              const o2 = o + 4;
              frame[o2] = paper[o2] * REED_W[0] * KR;
              frame[o2 + 1] = paper[o2 + 1] * REED_W[1] * KG;
              frame[o2 + 2] = paper[o2 + 2] * REED_W[2] * KB;
              zbuf[i + 1] = zz;
              ids[i + 1] = ID_REED;
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
              if (pts[14] >= zbuf[i]) continue;
              const o = i * 4;
              if (ink) {
                frame[o] = SEPIA[0];
                frame[o + 1] = SEPIA[1];
                frame[o + 2] = SEPIA[2];
              } else {
                frame[o] = paper[o] * cr * KR * 0.8;
                frame[o + 1] = paper[o + 1] * cg * KG * 0.8;
                frame[o + 2] = paper[o + 2] * cb * KB * 0.8;
              }
              zbuf[i] = pts[14];
              if (lineCov > this.line[i]) this.line[i] = lineCov;
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
    // a figure layer, or a draw callback (something drawn in code: a spear, a banner)
    const layer = a.draw ? null : a.layer || a.layerFor(pxH);
    const st = layer ? layer.st : null;
    const s = st ? (feet.scale * a.height) / st.h : feet.scale;
    const sy = pxH / (feet.scale * a.height);
    const rot = Math.atan2(vx, -vy);
    const base = a.place
      ? a.place(feet.sx, feet.sy, s)
      : { x: feet.sx, y: feet.sy, ax: st ? st.w / 2 : 0, ay: st ? st.h : 0, scale: s };
    const xf = { ...base, ...(a.xf || {}) };
    xf.x = base.x;
    xf.y = base.y;
    xf.scale = base.scale ?? s;
    xf.rot = (xf.rot || 0) + rot;
    xf.sy = (xf.sy ?? 1) * sy;
    const cam2 = { x: W / 2, y: H / 2, zoom: 1, rot: 0 };
    // the figure's screen box (a draw callback gives its own, or gets the frame)
    let x0 = 0;
    let y0 = 0;
    let x1 = W;
    let y1 = H;
    if (st) {
      const m = layerMatrix(xf, cam2, W, H);
      x0 = Infinity;
      y0 = Infinity;
      x1 = -Infinity;
      y1 = -Infinity;
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
    } else if (a.box) [x0, y0, x1, y1] = a.box;
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
    if (a.draw) a.draw(sc, { W, H, xf, feet, head, scale: feet.scale, stage: sA, paper, t });
    else drawSprite(sc, W, H, paper, layer, sA, xf, cam2, a.opts || {});
    const drawn = (o) => sc[o + 3] !== 0 && !(sc[o] === 1 && sc[o + 1] === 0 && sc[o + 2] === 1);
    // the waterline: world Y = 0 on the figure's card
    const wade = a.wade !== false && depth > 0.02 && Y0 < 0;
    const len = pxH || 1;
    const ax = vx / len;
    const ay = vy / len; // unit, up the figure
    const pw = project(cam, a.X, 0, a.Z, W, H);
    const t2 = this.t2;
    const aboveW = (x, y) =>
      (x - pw.sx) * ax +
      (y - pw.sy) * ay +
      0.6 * Math.sin(x * 0.8 + t2 * 9) +
      0.4 * Math.sin(x * 1.9 - t2 * 13);
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
          // ripple bands: row by row the image shifts, and drops out where a crest
          // mirrors the sky, more the further it is from the waterline
          const band = Math.sin(y * 1.9 + t2 * 11 + Math.sin(x * 0.06 + y * 0.3) * 2.5);
          if (band > 0.8 - 0.55 * brk) continue;
          const jx = x + this.wdx[i] * brk * 0.45 + band * (0.6 + 2.2 * brk);
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
          const fade = 0.6 * (1 - smooth(0.25, 1, d / (len * 1.05)));
          if (fade <= 0) continue;
          frame[o] += (sc[so] * 0.55 + 10 - frame[o]) * fade;
          frame[o + 1] += (sc[so + 1] * 0.6 + 14 - frame[o + 1]) * fade;
          frame[o + 2] += (sc[so + 2] * 0.66 + 26 - frame[o + 2]) * fade;
        }
    }
    // rings spreading from the legs
    if (wade) {
      const rk = a.rings ?? 0.6;
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.8 + k / 3 + hash(k, 1, (a.seed ?? 1) * 7) * 0.1) % 1;
        const rad = 0.22 + ph * 0.75;
        const al = (1 - ph) * rk;
        this.ringOnWater(frame, cam, a.X, a.Z, rad, al, 1, zA);
      }
    }
    // a contact shadow on the bank
    if (!wade && a.shadow !== false && Y0 > -0.01) {
      const rx = 0.42 * feet.scale;
      const ry = Math.max(
        1.6,
        rx * clamp(Math.abs(this.rdy[this.pix(feet.sx, feet.sy)] || 0.2) * 1.2, 0.12, 1),
      );
      for (let y = Math.floor(feet.sy - ry); y <= feet.sy + ry; y++)
        for (let x = Math.floor(feet.sx - rx); x <= feet.sx + rx; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = y * W + x;
          const id = this.ids[i];
          if ((id !== ID_BANK && id !== ID_SLOPE) || this.stg[i] !== 0) continue;
          const e = ((x - feet.sx) / rx) ** 2 + ((y - feet.sy) / ry) ** 2;
          if (e > 1) continue;
          if ((1 - e) * 1.6 < bayer(x, y)) continue;
          const o = i * 4;
          const k = e < 0.35 ? 0.66 : 0.8;
          frame[o] *= k;
          frame[o + 1] *= k;
          frame[o + 2] *= k + 0.03;
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
        if (under) {
          if (this.stg[i] !== 0) continue;
          frame[o] = frame[o] * 0.65 + sc[o] * 0.3;
          frame[o + 1] = frame[o + 1] * 0.65 + sc[o + 1] * 0.32;
          frame[o + 2] = frame[o + 2] * 0.65 + sc[o + 2] * 0.36;
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
      const p = project(cam, X + Math.cos(a) * rad, 0, Z + Math.sin(a) * rad * yScale, W, H);
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
    const foamC = (o) => [
      paper[o] * FOAM[0] * KR,
      paper[o + 1] * FOAM[1] * KG,
      paper[o + 2] * FOAM[2] * KB,
    ];
    const hi = [240, 234, 220];
    // the ring
    this.ringOnWater(frame, cam, X, Z, 0.15 + 1.25 * u ** 0.7 * s, (1 - u / 1.5) * 0.95);
    if (u > 0.9)
      this.ringOnWater(
        frame,
        cam,
        X,
        Z,
        0.1 + 0.9 * (u - 0.9) ** 0.7 * s,
        0.6 * (1 - (u - 0.9) / 0.6),
      );
    // the crown: a ragged wall of water thrown up round the point (drawn on twos), its
    // top breaking into fingers, inked along its rim; the far half behind, the near half
    // in front of whatever stands in it
    const u2 = Math.floor(u * 12) / 12;
    const cd = 0.3 * Math.sqrt(s);
    // a footfall only throws droplets; a body hitting the water throws a crown
    if (s >= 0.9 && u2 < cd) {
      const k = u2 / cd;
      const rc = (0.1 + 0.3 * Math.sqrt(k)) * Math.sqrt(s);
      const hc = 0.5 * s * Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.8;
      const n = 36;
      const B = [];
      const T = [];
      const fins = [];
      for (let j = 0; j <= n; j++) {
        const a = (j / n) * TWO_PI;
        // the rim: fingers of different heights, flaring outward as they rise
        const fin = 0.3 + 0.8 * valueNoise(j * 1.3, seed * 3.1, 7) + 0.3 * hash(j % n, seed, 4);
        fins.push(fin);
        B.push(project(cam, X + Math.cos(a) * rc, 0, Z + Math.sin(a) * rc, W, H));
        T.push(
          project(
            cam,
            X + Math.cos(a) * rc * (1.25 + 0.3 * k),
            hc * fin,
            Z + Math.sin(a) * rc * (1.25 + 0.3 * k),
            W,
            H,
          ),
        );
      }
      const white = [236, 232, 222];
      for (let j = 0; j < n; j++) {
        const b0 = B[j];
        const b1 = B[j + 1];
        const t0 = T[j];
        const t1 = T[j + 1];
        if (b0.depth < 0.3 || b1.depth < 0.3 || t0.depth < 0.3 || t1.depth < 0.3) continue;
        const z = (b0.depth + b1.depth) / 2 - 0.02;
        // the strip, column by column between the two base-top pairs
        const xa = Math.min(b0.sx, b1.sx, t0.sx, t1.sx);
        const xb = Math.max(b0.sx, b1.sx, t0.sx, t1.sx);
        const span = Math.max(1, Math.ceil(xb - xa));
        for (let q = 0; q <= span; q++) {
          const v = q / span;
          const bx = b0.sx + (b1.sx - b0.sx) * v;
          const by = b0.sy + (b1.sy - b0.sy) * v;
          const tx = t0.sx + (t1.sx - t0.sx) * v;
          const ty = t0.sy + (t1.sy - t0.sy) * v;
          const L = Math.ceil(Math.hypot(tx - bx, ty - by));
          if (L < 1) continue;
          for (let r = 0; r <= L; r++) {
            const h = r / L; // 0 at the water, 1 at the rim
            const x = bx + (tx - bx) * h;
            const y = by + (ty - by) * h;
            if (h > 0.9) {
              this.fxPut(frame, x, y, z, SEPIA, 1, true);
              continue;
            }
            // thinner toward the rim; streaks of falling water down it; gaps in the wall
            if (fins[j] < 0.55 && h > 0.35) continue;
            const dens = (0.72 - 0.5 * h * h - 0.35 * k) * Math.min(1, 0.55 + 0.45 * s);
            const o = ((y | 0) * W + (x | 0)) * 4;
            const streak = hash(Math.round(x * 0.5), seed, 8) > 0.8;
            this.fxPut(frame, x, y, z, streak ? foamC(Math.max(0, o)) : white, dens);
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
      const q = project(
        cam,
        px - Math.cos(a) * vh * 0.03,
        Y - (vy - 9.8 * uu) * 0.03,
        pz - Math.sin(a) * vh * 0.03,
        W,
        H,
      );
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
   * white water in columns, each thrown at its own speed so the crest breaks into
   * fingers, streaked as it falls, droplets flung above it. It hides what is behind it.
   * o: { X, Z (centre), width (m, along the line), age (s since it was thrown: slow it
   * or hold it for a time warp), dir (+1 thrown toward +X), height (m), strength, seed,
   * angle (radians: the line turned from the X axis) }.
   */
  spraySheet(frame, cam, o) {
    const { W, H } = this;
    const paper = this.paper;
    const age = o.age ?? 0;
    if (age < 0 || age > 2.4) return;
    const w = o.width ?? 2.6;
    const hgt = o.height ?? 2.2;
    const dir = o.dir ?? 1;
    const seed = o.seed ?? 1;
    const str = o.strength ?? 1;
    const ang = o.angle ?? 0;
    const lx = Math.cos(ang);
    const lz = Math.sin(ang);
    const up = Math.sqrt(2 * 9.8 * hgt);
    const apex = up / 9.8;
    const fall = smooth(apex * 0.85, apex * 2, age);
    const n = Math.max(30, Math.round(w * 34));
    const cols = [];
    for (let j = 0; j <= n; j++) {
      const v = j / n - 0.5;
      const finger = 0.7 + 0.6 * valueNoise(j * 0.55, seed * 7.1, 3);
      const vy = up * Math.cos(v * Math.PI) ** 0.7 * finger;
      const crest = Math.max(0, vy * age - 4.9 * age * age);
      const X = o.X + lx * v * w + dir * (0.4 + 0.5 * hash(j, seed, 2)) * age;
      const Z = o.Z + lz * v * w;
      cols.push({
        b: project(cam, X, 0, Z, W, H),
        // the sheet leans the way it was thrown: its crest runs ahead of its foot
        c: project(cam, X + dir * 0.2 * crest, crest, Z, W, H),
        tip: finger > 1.05,
      });
    }
    const white = [241, 236, 224];
    for (let j = 0; j < n; j++) {
      const A = cols[j];
      const Bc = cols[j + 1];
      if (A.b.depth < 0.3 || Bc.b.depth < 0.3) continue;
      const xa = A.b.sx;
      const xb = Bc.b.sx;
      for (let x = Math.floor(Math.min(xa, xb)); x <= Math.ceil(Math.max(xa, xb)); x++) {
        const v = xb !== xa ? clamp((x - xa) / (xb - xa)) : 0;
        const yb = A.b.sy + (Bc.b.sy - A.b.sy) * v;
        const top = A.c.sy + (Bc.c.sy - A.c.sy) * v;
        const z = A.b.depth + (Bc.b.depth - A.b.depth) * v - 0.02;
        if (yb - top < 1) continue;
        // falling streams: vertical streaks, steady across the sheet
        const streak = 0.55 + 0.45 * valueNoise(x * 0.45, 3.3, seed);
        const rib = valueNoise(x * 0.5, 7.7, seed + 2) > 0.74;
        const y0 = Math.floor(top);
        for (let y = y0; y <= Math.ceil(yb); y++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const hk = (yb - y) / (yb - top); // 0 at the water, 1 at the crest
          // the crest's edge is inked (broken here and there), its fingers too
          if (y <= y0 + 1 && valueNoise(x * 0.35, seed, 9) > 0.25) {
            this.fxPut(frame, x, y, z, SEPIA, 1 - fall * 0.8, true);
            continue;
          }
          if (valueNoise(x * 0.3, y * 0.3 + age * 9, seed + 5) > 0.86 - 0.3 * hk) continue;
          const dens = str * (1 - fall * 0.85) * streak * (1.05 - 0.5 * hk * hk);
          const i = y * W + x;
          const oo = i * 4;
          if (hk > 0.93 && (A.tip || Bc.tip)) {
            this.fxPut(frame, x, y, z, SEPIA, 1 - fall, true);
            continue;
          }
          const foam = [
            paper[oo] * FOAM[0] * KR,
            paper[oo + 1] * FOAM[1] * KG,
            paper[oo + 2] * FOAM[2] * KB,
          ];
          // white where the water is thick (the churning foot, the streams), a paler
          // veil between the streams that the world shows through, grey ribs of falling
          // water; ragged holes open toward the crest
          // a veil the world shows through, drawn in streams: the churning foot and the
          // crest band solid white, thin white streams running up it, a pale dithered
          // wash between them, a few grey ribs
          const px = yb - top > 40 ? 0.9 : 0.45; // streams thin out when the sheet is small
          const stream = valueNoise(x * px, 1.7, seed + 3) > 0.6;
          const solid = hk > 0.8 || hk < 0.18 + 0.1 * streak || stream;
          if (!solid) {
            if (rib && hk < 0.8) this.fxPut(frame, x, y, z, [188, 186, 186], dens);
            else this.fxPut(frame, x, y, z, foam, dens * 0.42);
            continue;
          }
          this.fxPut(frame, x, y, z, dens > 0.42 ? white : foam, dens > 0.42 ? 1 : dens * 1.6);
          if (dens > 0.42 && this.stg[i] === 0 && z < this.zbuf[i]) this.ids[i] = ID_FX;
        }
      }
    }
    // droplets flung above the crest
    const nd = Math.round(240 * str);
    for (let j = 0; j < nd; j++) {
      const v = hash(j, seed, 21) - 0.5;
      const vy = up * (0.45 + 0.85 * hash(j, seed, 22));
      const vf = (0.4 + 2.4 * hash(j, seed, 23)) * dir;
      const vz = (hash(j, seed, 24) - 0.5) * 2.2;
      const uu = age - hash(j, seed, 25) * 0.2;
      if (uu < 0) continue;
      const Y = vy * uu - 4.9 * uu * uu;
      if (Y < 0) continue;
      const X = o.X + lx * v * w + vf * uu;
      const Z = o.Z + lz * v * w + vz * uu;
      const p = project(cam, X, Y, Z, W, H);
      if (p.depth < 0.3) continue;
      const q = project(cam, X - vf * 0.025, Y - (vy - 9.8 * uu) * 0.025, Z - vz * 0.025, W, H);
      const L = Math.min(8, Math.ceil(Math.hypot(p.sx - q.sx, p.sy - q.sy)));
      for (let k = 0; k <= L; k++) {
        const s = L ? k / L : 0;
        this.fxPut(
          frame,
          p.sx + (q.sx - p.sx) * s,
          p.sy + (q.sy - p.sy) * s,
          p.depth,
          white,
          1 - s * 0.6,
        );
      }
      if (p.scale > 110) {
        this.fxPut(frame, p.sx + 1, p.sy, p.depth, white);
        this.fxPut(frame, p.sx, p.sy + 1, p.depth, SEPIA, 1, true);
      }
    }
    // the base churns
    this.ringOnWater(frame, cam, o.X, o.Z, w * 0.55 + age * 1.2, (1 - age / 2.4) * 0.9, 0.5);
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
    // box size, drops, depth range, opacity, exposure (s)
    const LAYERS = [
      [5, 150, 0.8, 3.5, 0.6, 0.016],
      [16, 420, 3.5, 12, 0.5, 0.024],
      [44, 600, 12, 40, 0.36, 0.03],
    ];
    const fall0 = 8.5;
    const mod = (v, m) => ((v % m) + m) % m;
    for (let L = 0; L < 3; L++) {
      const [Bx, n, zmin, zmax, alpha, ex] = LAYERS[L];
      const cnt = Math.round(n * this.rain);
      for (let k = 0; k < cnt; k++) {
        const hx = hash(k, L, 301) * Bx;
        const hy = hash(k, L, 302) * Bx;
        const hz = hash(k, L, 303) * Bx;
        // every drop its own speed and drift
        const fall = fall0 * (0.8 + 0.4 * hash(k, L, 304));
        let wx = wind[0] * (0.7 + 0.6 * hash(k, L, 305));
        let wz = wind[1] * (0.7 + 0.6 * hash(k, L, 306));
        const X = ox - Bx / 2 + mod(hx + wx * t - (ox - Bx / 2), Bx);
        const Y = oy - Bx / 2 + mod(hy - fall * t - (oy - Bx / 2), Bx);
        const Z = oz - Bx / 2 + mod(hz + wz * t - (oz - Bx / 2), Bx);
        if (Y < 0) continue;
        // the rain comes in sheets: thinner between the gusts
        if (hash(k, L, 309) > 0.3 + 0.9 * valueNoise(X * 0.07 - t * 0.5, Z * 0.07, 91)) continue;
        if (this.impulses.length) {
          this.push(X, Z, t);
          wx += this._px * 9;
          wz += this._pz * 9;
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
        const exk = ex * (0.7 + 0.6 * hash(k, L, 307));
        const qx = vx - wx * exk;
        const qy = vy + fall * exk;
        const qz = vz - wz * exk;
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
      return [
        B.cx + (vx * B.rx + vy * B.ry + vz * B.rz) * iz,
        B.cy - (vx * B.ux + vy * B.uy + vz * B.uz) * iz,
        iz,
        z,
      ];
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
            top: (it.h ?? 0.3) + Math.max(0, base),
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
      // a clump of blades: long curved leaves, widest a third of the way up, the tips
      // bent over by the wind, each a little its own way (out of focus: flat dark ink)
      const nb = 3 + Math.floor(hash(seed, 1, 55) * 4);
      for (let b = 0; b < nb; b++) {
        const h = (it.h ?? 1.2) * (0.5 + 0.65 * hash(seed, b, 56));
        const X = it.X + (hash(seed, b, 57) - 0.5) * 0.4;
        const Z = it.Z + (hash(seed, b, 58) - 0.5) * 0.25;
        const g = this.gust(X, Z, t2) * windK;
        const side = hash(seed, b, 61) < 0.5 ? -1 : 1;
        const lean =
          side * (0.25 + 0.55 * hash(seed, b, 59)) + (0.2 + 0.55 * g) * Math.cos(this.wind.dir);
        const wB = 0.028 * (0.7 + 0.6 * hash(seed, b, 60));
        let prev = null;
        const NS = 14;
        for (let k = 0; k <= NS; k++) {
          const v = k / NS;
          const phi = lean * v ** 1.8;
          const px = X + Math.sin(phi) * h * v * 0.95;
          const py = base + Math.cos(phi) * h * v - Math.max(0, Math.abs(phi) - 1.1) * h * 0.2 * v;
          const p = proj(px, py, Z);
          if (!p) {
            prev = null;
            continue;
          }
          if (prev) {
            // a leaf: swelling from the root, tapering to a point
            const prof = Math.sin(Math.PI * Math.min(1, v * 1.35 + 0.08)) ** 0.7 * (1 - v * 0.3);
            const half = Math.max(0.5, wB * prof * p[2]);
            const L = Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1])) + 1;
            for (let st = 0; st <= L; st++) {
              const q = st / L;
              const xm = prev[0] + (p[0] - prev[0]) * q;
              const ym = prev[1] + (p[1] - prev[1]) * q;
              const zm = prev[3] + (p[3] - prev[3]) * q;
              for (let x = Math.floor(xm - half); x <= Math.ceil(xm + half); x++) {
                const y = Math.round(ym);
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                const i = y * W + x;
                if (zm >= this.zbuf[i]) continue;
                // the side toward the sky catches a little light
                mask[i] = x > xm + half - 1.2 && half > 1.5 ? 2 : 1;
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
          x === 0 ||
          y === 0 ||
          x === W - 1 ||
          y === H - 1 ||
          !mask[i - 1] ||
          !mask[i + 1] ||
          !mask[i - W] ||
          !mask[i + W];
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
    const kind =
      o.kind === 'mixed' ? (hash(k, 4, seed) < 0.3 ? 'stone' : 'reeds') : (o.kind ?? 'reeds');
    out.push({
      X: x + (hash(k, 2, seed) - 0.5) * step * 0.7,
      Z: o.z + (hash(k, 3, seed) - 0.5) * (o.jitter ?? 0.4),
      kind,
      h: (kind === 'stone' ? (o.stoneH ?? 0.28) : (o.h ?? 1.1)) * (0.7 + 0.6 * hash(k, 5, seed)),
      seed,
      Y: o.Y,
    });
  }
  return out;
}

/**
 * A whip pan's smear, drawn the way anime draws it rather than as a camera blur: the
 * frame strobed into a few multiples along the drag (dithered, never blended), rows of
 * the picture dragged out into streaks (each takes the colour at its leading end), and
 * ink speed lines running through. (vx, vy): the drag in screen px this frame (the
 * dominant axis sets the streak direction). o: { t (the drawing: streaks boil on twos),
 * seed, lines (0..1 how many ink lines), streaks (0..1 how many rows streak) }.
 */
export function smearFrame(frame, W, H, vx, vy, o = {}) {
  const L = Math.hypot(vx, vy);
  if (L < 2) return;
  const drawing = Math.floor((o.t ?? 0) * 12);
  const seed = o.seed ?? 7;
  const src = frame.slice();
  const k = Math.min(1, L / 60); // how hard the whip is
  // 1. multiples: the image at three offsets along the drag, interleaved by dither
  const offs = [0, 0.33, 0.66].map((f) => [vx * f, vy * f]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const b = bayer(x, y);
      const m = b < 0.5 ? 0 : b < 0.5 + 0.3 * k ? 1 : b < 0.5 + 0.5 * k ? 2 : 0;
      if (!m) continue;
      const xx = Math.round(x - offs[m][0]);
      const yy = Math.round(y - offs[m][1]);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const s = (yy * W + xx) * 4;
      const d = (y * W + x) * 4;
      frame[d] = src[s];
      frame[d + 1] = src[s + 1];
      frame[d + 2] = src[s + 2];
    }
  // 2. streaks: rows (or columns) dragged out, each run the colour at its leading end
  const horiz = Math.abs(vx) >= Math.abs(vy);
  const dir = horiz ? Math.sign(vx) || 1 : Math.sign(vy) || 1;
  const along = horiz ? W : H;
  const across = horiz ? H : W;
  const dens = (o.streaks ?? 0.55) * (0.4 + 0.6 * k);
  const idx = (a, c) => (horiz ? (c * W + a) * 4 : (a * W + c) * 4);
  for (let c = 0; c < across; c++) {
    // rows come in bands (a wash dragged by a broad brush), and boil per drawing
    const band = hash(Math.floor(c / 3), drawing >> 1, seed);
    if (band > dens || hash(c, drawing, seed + 1) > 0.8) continue;
    let a = Math.floor(hash(c, 2, seed + drawing) * L);
    while (a < along) {
      const len = Math.max(4, Math.round(L * (0.5 + 1.3 * hash(c, a, seed + 3))));
      // the leading end: where the run came from
      const head = dir > 0 ? a : Math.min(along - 1, a + len);
      const hs = idx(head, c);
      const gap = Math.round(len * (0.2 + 0.6 * hash(a, c, seed + 4)));
      for (let q = 0; q < len; q++) {
        const pos = a + q;
        if (pos >= along) break;
        // the far end frays into the dither
        const tail = dir > 0 ? q / len : 1 - q / len;
        if (tail > 0.55 && tail - 0.55 > bayer(horiz ? pos : c, horiz ? c : pos) * 0.45) continue;
        const d = idx(pos, c);
        frame[d] = src[hs];
        frame[d + 1] = src[hs + 1];
        frame[d + 2] = src[hs + 2];
      }
      a += len + gap;
    }
  }
  // 3. ink speed lines
  const nl = Math.round(across * 0.07 * (o.lines ?? 1) * k);
  for (let j = 0; j < nl; j++) {
    const c = Math.floor(hash(j, drawing, seed + 5) * across);
    const len = L * (1.5 + 2.5 * hash(j, drawing, seed + 6));
    const a0 = hash(j, drawing, seed + 7) * (along + len) - len;
    for (let q = 0; q < len; q++) {
      const pos = Math.round(a0 + q);
      if (pos < 0 || pos >= along) continue;
      const taper = Math.min(q / (len * 0.3), (len - q) / (len * 0.3), 1);
      if (taper <= bayer(horiz ? pos : c, horiz ? c : pos)) continue;
      const d = idx(pos, c);
      frame[d] = SEPIA[0];
      frame[d + 1] = SEPIA[1];
      frame[d + 2] = SEPIA[2];
    }
  }
}
