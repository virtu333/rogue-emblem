// The camp: a procedural night place seen through a real perspective camera, in the same
// world language as world.js (ridges on circles with aerial perspective, wind, found and lost
// edges, pale washes under sepia ink on the nearest edges only) but lit by a fire.
//
// Coordinates are metres: X right, Y up, Z away from a camera that looks up +Z (yaw 0). The
// fire is the light: every surface, grass blade and figure is lit by a point light at the
// flames (warm, guttering on twos, falling off with distance), and what the fire cannot
// reach is the cool dark of the night. Cameras are world.js's ({x, y, z, yaw, pitch, roll,
// focal}: lookAt, crane, nudge are re-used by camp.js).
//
//   const w = new CampWorld({ paper, W, H, set });
//   w.render(frame, t, cam, { actors, wind, thread, fire, foreground, ... });
//
// A frame is a pure function of (t, camera, options). Drawn things (flames, smoke, grass,
// embers) step on twos, the camera and the sky's slow drift on ones. Passes:
//   rays -> sky, ridges, ground (shaded by the fire) -> stars and the Thread (in the sky
//   only) -> solid props (tents, crates, stumps, stones, logs) -> ink on their edges ->
//   billboards back to front (fence, grass, far fires, flame, smoke, embers, figures).
//
// Everything here is drawn in the palette's materials: the fire is orange and red, never the
// Thread's pale gold; the Thread is thin, cold, and the only thing that sparkles.

import { basis, project } from './world.js';
import { bayer, clamp, hash, lerp, smooth, valueNoise } from './raster.js';
import { drawSprite, layerMatrix } from './view.js';
import { billboardMethods } from './camp_billboards.js';

const TWO_PI = Math.PI * 2;
const PAPER_REF = [214, 207, 196];

// ------------------------------------------------------------------------ colours (targets)

// the night's ambient: cool violet-blue light from the sky (multiplies an albedo)
const AMB = [0.2, 0.225, 0.36];
// the fire's light (multiplies an albedo, times its intensity 0..~1.3)
const FIRE_C = [1.25, 0.8, 0.34];
const HAZE = [70, 64, 92]; // aerial perspective toward the horizon glow
const INKC = [17, 15, 26];
const SKY_ZEN = [17, 15, 32];
const SKY_MID = [40, 36, 66];
const SKY_HOR = [86, 80, 108];
const SKY_GLOW = [128, 104, 118]; // the eastern horizon: the dawn to come
const GRASS_DARK = [84, 80, 80];
const GRASS_DRY = [124, 110, 98];
const EARTH = [158, 130, 96];
const TRAMPLED = [178, 146, 106];
const SOOT = [40, 34, 32];
const CANVAS = [214, 198, 164];
const CANVAS_DK = [150, 134, 110];
const WOOD = [126, 96, 66];
const WOOD_DK = [84, 64, 48];
const STONE = [140, 132, 126];
const BARREL = [122, 92, 62];

// ids: what each pixel shows (edges come from changes between them)
const ID_SKY = 1;
const ID_RIDGE = 10; // + layer
const ID_GROUND = 20;
const ID_TENT = 40; // + tent index
const ID_PROP = 80;
const ID_STONE = 120;
const ID_FENCE = 200;
const ID_GRASS = 205;
const ID_ACTOR = 210;
const ID_FX = 230;

// ------------------------------------------------------------------------ noise

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
/** Bilinear wrapping sample of an N*N texture at texel (u, v). */
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

let TEX = null;
function textures() {
  if (TEX) return TEX;
  const N = 256;
  const g = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) g[j * N + i] = tfbm((i / N) * 8, (j / N) * 8, 8, 8, 71, 4);
  stretch01(g);
  const c = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i / N) * 5;
      const y = (j / N) * 5;
      const q1 = tfbm(x, y, 5, 5, 31, 2);
      const q2 = tfbm(x + 3.7, y + 1.9, 5, 5, 37, 2);
      c[j * N + i] = tfbm(x + 1.2 * q1, y + 1.2 * q2, 5, 5, 41, 4);
    }
  stretch01(c);
  TEX = { N, ground: g, cloud: c };
  return TEX;
}

// ------------------------------------------------------------------------ the ridges

const TAB = 2048;
const RIDGES = [
  // near hills with a dark line of cypresses, then paler ranges into the glow
  {
    R: 62,
    base: 5,
    amp: 13,
    freq: 2.6,
    seed: 11,
    trees: 80,
    tree: [1.8, 4.2],
    tw: 0.9,
    lit: [34, 31, 48],
    sh: [26, 24, 38],
    mist: 4,
  },
  {
    R: 135,
    base: 8,
    amp: 30,
    freq: 3.1,
    seed: 17,
    trees: 50,
    tree: [3.5, 7.5],
    tw: 1.8,
    lit: [46, 43, 64],
    sh: [38, 35, 56],
    mist: 9,
  },
  {
    R: 420,
    base: 26,
    amp: 90,
    freq: 2.2,
    seed: 23,
    trees: 0,
    tree: [0, 0],
    tw: 1,
    lit: [62, 58, 84],
    sh: [55, 51, 76],
    mist: 26,
  },
  {
    R: 1400,
    base: 80,
    amp: 250,
    freq: 1.7,
    seed: 37,
    trees: 0,
    tree: [0, 0],
    tw: 1,
    lit: [78, 73, 100],
    sh: [72, 67, 94],
    mist: 90,
  },
];

function buildRidge(L) {
  const h = new Float32Array(TAB + 1);
  let hmax = 0;
  for (let i = 0; i <= TAB; i++) {
    const th = -Math.PI + (i / TAB) * TWO_PI;
    const cx = Math.cos(th);
    const cz = Math.sin(th);
    let s = 0;
    let amp = 0.55;
    let f = L.freq;
    let n = 0;
    for (let o = 0; o < 4; o++) {
      const v = valueNoise(cx * f + 17, cz * f + 31, L.seed + o * 13);
      const r = 1 - Math.abs(2 * v - 1);
      s += amp * (r * r * 0.4 + v * 0.6);
      n += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    const e = valueNoise(cx * 1.3 + 5, cz * 1.3 + 9, L.seed + 500);
    h[i] = L.base + L.amp * (s / n) * (0.35 + 1.0 * e);
  }
  // cypresses: narrow dark spikes standing on the ridge, in clumps
  for (let k = 0; k < L.trees; k++) {
    const clump = hash(k >> 3, 1, L.seed) * TWO_PI - Math.PI;
    const th0 = clump + (hash(k, 2, L.seed) - 0.5) * 0.16;
    const ht = L.tree[0] + (L.tree[1] - L.tree[0]) * hash(k, 3, L.seed);
    const half = (L.tw * (0.7 + 0.6 * hash(k, 4, L.seed))) / L.R;
    const ic = Math.round(((th0 + Math.PI) / TWO_PI) * TAB);
    const span = Math.ceil((half / TWO_PI) * TAB) + 1;
    for (let d = -span; d <= span; d++) {
      const i = (((ic + d) % TAB) + TAB) % TAB;
      const u = Math.abs(d) / span;
      const add = ht * Math.sqrt(Math.max(0, 1 - u * u * 0.9));
      h[i] = Math.max(h[i], L.base + add + (h[i] - L.base) * 0.85);
      if (i === 0) h[TAB] = h[0];
    }
  }
  for (let i = 0; i <= TAB; i++) if (h[i] > hmax) hmax = h[i];
  const d = new Float32Array(TAB + 1);
  for (let i = 0; i <= TAB; i++) d[i] = h[Math.min(TAB, i + 2)] - h[Math.max(0, i - 2)];
  return { ...L, h, d, hmax };
}

// ------------------------------------------------------------------------ the world

export class CampWorld {
  /** o: { paper (the page, W*H RGBA), W, H, set (camp_blocking's SET), seed }. */
  constructor(o = {}) {
    this.W = o.W ?? 480;
    this.H = o.H ?? 270;
    this.paper = o.paper;
    this.set = o.set || {};
    const n = this.W * this.H;
    this.rdx = new Float32Array(n);
    this.rdy = new Float32Array(n);
    this.rdz = new Float32Array(n);
    this.cf = new Float32Array(n); // cos between the ray and the view axis (t -> depth)
    this.gT = new Float32Array(n); // ground hit: ray length
    this.zbuf = new Float32Array(n);
    this.ids = new Uint8Array(n);
    this.ink = new Uint8Array(n);
    this.sky = new Uint8Array(n); // 1 where the frame shows open sky (stars and the Thread may draw)
    this.scratch = new Uint8ClampedArray(n * 4);
    this.tex = textures();
    this.ridges = RIDGES.map(buildRidge);
    this.fire = { x: 0, y: 0.55, z: 0 };
    this._c = new Float64Array(3);
    this._n = new Float64Array(3);
    this.buildStars();
    this.buildProps();
    this.buildTufts();
    this.actorsLast = [];
  }

  // ---------------------------------------------------------------- building

  buildStars() {
    this.stars = [];
    for (let i = 0; i < 900; i++) {
      // uniform on the sphere above the horizon (a few below are hidden by the ridges anyway)
      const az = hash(i, 1, 501) * TWO_PI - Math.PI;
      const sinEl = 0.01 + 0.99 * hash(i, 2, 501) ** 0.8;
      const el = Math.asin(sinEl);
      const b = hash(i, 3, 501);
      this.stars.push({
        d: [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)],
        b: b < 0.05 ? 3 : b < 0.24 ? 2 : 1,
        tw: hash(i, 4, 501) < 0.16,
        ph: hash(i, 5, 501) * 20,
        tint: hash(i, 6, 501),
      });
    }
  }

  /** The set's solid things as data the ray tests can use. */
  buildProps() {
    const S = this.set;
    this.tents = (S.tents || []).map((t, i) => {
      // the door (the -u end) faces the fire, plus a little jitter
      const yaw = Math.atan2(t.z, t.x) + (t.jitter || 0);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const Nn = Math.hypot(t.w / 2, t.h);
      const corners = [];
      for (const u of [-1, 1])
        for (const y of [0, 1])
          for (const v of [-1, 1]) {
            const lu = (u * t.L) / 2;
            const lv = (v * t.w) / 2;
            corners.push([t.x + lu * c - lv * s, y * t.h, t.z + lu * s + lv * c]);
          }
      return {
        ...t,
        i,
        c,
        s,
        yaw,
        nN: Nn,
        // planes in local (u, y, v): normal and offset
        pl: [
          [0, t.w / 2 / Nn, t.h / Nn, (t.h * (t.w / 2)) / Nn],
          [0, t.w / 2 / Nn, -t.h / Nn, (t.h * (t.w / 2)) / Nn],
          [-1, 0, 0, t.L / 2],
          [1, 0, 0, t.L / 2],
          [0, -1, 0, 0],
        ],
        corners,
      };
    });
    // boxes: benches, crates (local u, v; height h from the ground)
    this.boxes = [];
    for (const b of S.benches || [])
      this.boxes.push(this.mkBox(b.x, b.z, b.sx, b.sz, b.h, b.yaw, 'bench'));
    for (const b of S.crates || [])
      if (!b.hidden) this.boxes.push(this.mkBox(b.x, b.z, b.sx, b.sz, b.sy * 2, b.yaw, 'crate'));
    // the fire's two logs
    // a small pile of logs leaning on each other, laid out from the middle
    for (let k = 0; k < 5; k++) {
      const a = 0.4 + k * 1.25;
      this.boxes.push(
        this.mkBox(
          Math.cos(a) * 0.14,
          Math.sin(a) * 0.14,
          0.3 + 0.08 * hash(k, 1, 78),
          0.045,
          0.1 + 0.06 * (k % 2),
          a,
          'log',
        ),
      );
    }
    this.cyls = [];
    for (const s of S.stumps || []) this.cyls.push({ ...s, kind: 'stump' });
    for (const s of S.barrels || []) this.cyls.push({ ...s, kind: 'barrel' });
    // stones round the fire and a few scattered, as ellipsoids sitting on the ground
    this.stones = [];
    const ring = 0.55;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TWO_PI + hash(k, 1, 77) * 0.3;
      const r = ring + (hash(k, 2, 77) - 0.5) * 0.08;
      this.stones.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        a: 0.13 + 0.06 * hash(k, 3, 77),
        b: 0.1 + 0.05 * hash(k, 4, 77),
        c: 0.12 + 0.05 * hash(k, 5, 77),
        yaw: hash(k, 6, 77) * 3,
        ring: true,
      });
    }
    for (let k = 0; k < 14; k++) {
      const a = hash(k, 7, 77) * TWO_PI;
      const r = 2.8 + hash(k, 8, 77) * 9;
      this.stones.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        a: 0.14 + 0.3 * hash(k, 9, 77),
        b: 0.1 + 0.16 * hash(k, 10, 77),
        c: 0.14 + 0.25 * hash(k, 11, 77),
        yaw: hash(k, 12, 77) * 3,
      });
    }
    // bedrolls beside the tents (dark low lumps)
    for (const t of this.tents.slice(0, 5))
      this.stones.push({
        x: t.x - t.c * (t.L / 2 + 1.4) + t.s * 0.6,
        z: t.z - t.s * (t.L / 2 + 1.4) - t.c * 0.6,
        a: 0.9,
        b: 0.22,
        c: 0.38,
        yaw: t.yaw + 1.57,
        bed: true,
      });
  }

  mkBox(x, z, sx, sz, h, yaw, kind) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const corners = [];
    for (const u of [-1, 1])
      for (const y of [0, 1])
        for (const v of [-1, 1])
          corners.push([x + u * sx * c - v * sz * s, y * h, z + u * sx * s + v * sz * c]);
    return { x, z, sx, sz, h, yaw, c, s, kind, corners };
  }

  buildTufts() {
    // dry grass in clumps, dense at the edges of the trodden ground, none where people sit
    const keep = [
      [0, 0, 1.0],
      [-1.55, 0.15, 0.9],
      [1.45, -0.1, 0.9],
      [0.35, 1.7, 0.8],
      [0.4, -2.6, 1.1],
    ];
    this.tufts = [];
    for (let k = 0; k < 1500 && this.tufts.length < 900; k++) {
      const a = hash(k, 1, 91) * TWO_PI;
      const r = 1.4 + 22 * hash(k, 2, 91) ** 1.35;
      const X = Math.cos(a) * r;
      const Z = Math.sin(a) * r * 0.9 - 1.2 + hash(k, 5, 91) * 2;
      // sparser in the trodden middle
      const trod = smooth(5.5, 2.4, Math.hypot(X, Z));
      if (hash(k, 3, 91) < trod * 0.85) continue;
      if (keep.some(([x, z, rr]) => Math.hypot(X - x, Z - z) < rr)) continue;
      this.tufts.push({
        X,
        Z,
        h: 0.22 + 0.42 * hash(k, 4, 91) + (r > 9 ? 0.25 * hash(k, 6, 91) : 0),
        n: 5 + Math.floor(hash(k, 7, 91) * 5),
        seed: k,
      });
    }
  }

  // ---------------------------------------------------------------- light

  /** The fire's flicker (0.7..1.15), on twos: a drawn light, not a smooth one. */
  flick(t) {
    const t2 = Math.floor(t * 12) / 12;
    return (
      0.96 +
      0.07 * Math.sin(t2 * 9.1) +
      0.045 * Math.sin(t2 * 17.3 + 1.3) +
      0.09 * (valueNoise(t2 * 5, 3, 9) - 0.5)
    );
  }

  /** The fire's intensity at a world point (0..~1.3). */
  intensity(X, Y, Z) {
    const f = this.fire;
    const dx = X - f.x;
    const dy = Y - f.y;
    const dz = Z - f.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    return (this.k * 1.2) / (1 + d2 / 2.0);
  }

  /** Shadow multiplier on the ground light at (X, Z): the figures and props block the fire. */
  shadowAt(X, Z) {
    const f = this.fire;
    const qx = X - f.x;
    const qz = Z - f.z;
    if (qx * qx + qz * qz > 190) return 1;
    let m = 1;
    const cs = this.casters;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      const u = qx * c.ux + qz * c.uz;
      if (u < c.r * 0.8 || u > c.r + c.len) continue;
      const v = qx * c.vx + qz * c.vz;
      const wd = c.w * Math.min(u / c.r, 2.4);
      const av = Math.abs(v);
      if (av > wd * 1.25) continue;
      const edge = 1 - smooth(wd * 0.65, wd * 1.25, av);
      const fade = 1 - smooth(c.r, c.r + c.len, u) * 0.8;
      const inb = smooth(c.r * 0.8, c.r * 1.05, u);
      m *= 1 - c.k * edge * fade * inb;
    }
    return m;
  }

  // ---------------------------------------------------------------- rendering

  /**
   * o: { actors, wind (0..2), thread { pulses, k, ... }, fireK, foreground (extra tufts),
   *      sentry (0..1: the far sentry on the ridge), starK, smoke (0..2), embers (0..2) }.
   */
  render(frame, t, cam, o = {}) {
    const { W, H } = this;
    const B = basis(cam, W, H);
    this.B = B;
    this.cam = cam;
    this.t = t;
    this.t2 = Math.floor(t * 12) / 12;
    this.t3 = Math.floor(t * 8) / 8;
    this.wind = o.wind ?? 1;
    this.k = this.flick(t) * (o.fireK ?? 1);
    // the light wobbles a little with the flames
    this.fire = {
      x: 0.05 * Math.sin(this.t2 * 7.7),
      y: 0.55,
      z: 0.05 * Math.sin(this.t2 * 6.1 + 1),
    };
    this.buildCasters(o.actors || []);
    this.zbuf.fill(1e9);
    this.ids.fill(0);
    this.ink.fill(0);
    this.sky.fill(0);
    this.passRays(B, frame, t);
    this.drawStars(frame, B, t, o.starK ?? 1);
    if (o.thread) this.drawThread(frame, B, t, o.thread);
    this.drawProps(frame, B);
    this.passInk(frame);
    this.paperGrain(frame);
    this.drawBillboards(frame, cam, B, t, o);
    this.vignette(frame);
  }

  /** The page darkens toward its edges (a few percent, so the eye stays on the middle). */
  vignette(frame) {
    const { W, H } = this;
    for (let y = 0; y < H; y++) {
      const dy = (y + 0.5 - H / 2) / (H / 2);
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - W / 2) / (W / 2);
        const r = Math.sqrt(dx * dx * 0.6 + dy * dy);
        const k = 1 - 0.2 * smooth(0.62, 1.25, r);
        const o = (y * W + x) * 4;
        frame[o] *= k;
        frame[o + 1] *= k;
        frame[o + 2] *= k * 1.01;
      }
    }
  }

  buildCasters(actors) {
    const f = { x: 0, z: 0 };
    const list = [];
    const push = (x, z, w, h, k = 0.6) => {
      const dx = x - f.x;
      const dz = z - f.z;
      const r = Math.hypot(dx, dz);
      if (r < 0.4) return;
      const ux = dx / r;
      const uz = dz / r;
      list.push({ r, ux, uz, vx: -uz, vz: ux, w, len: Math.min(4.5, 1.2 + h * 3), k });
    };
    for (const a of actors)
      if (a.shadow !== false) push(a.X, a.Z, a.shadowW ?? 0.4, a.height ?? 1, a.shadowK ?? 0.72);
    for (const s of this.set.stumps || []) push(s.x, s.z, s.r * 0.9, s.h, 0.6);
    for (const b of this.set.benches || []) push(b.x, b.z, b.sx * 0.9, b.h, 0.6);
    this.casters = list;
  }

  /** Rays for every pixel; the sky, ridges and ground shaded straight away. */
  passRays(B, frame, t) {
    const { W, H } = this;
    const { fx, fy, fz, rx, ry, rz, ux, uy, uz, F, cx, cy } = B;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const c = this._c;
    // where the mist lies on each ridge drifts
    this.mist = this.ridges.map((L, li) => {
      const a = new Float32Array(256);
      for (let i = 0; i < 256; i++)
        a[i] = L.mist * (0.5 + 0.9 * valueNoise(i / 12 + t * (0.04 + li * 0.015), li * 7.3, 91));
      return a;
    });
    this.mt = this.ridges.map((L) => (L.hmax - oy) / Math.max(1, L.R - Math.hypot(ox, oz)));
    for (let y = 0; y < H; y++) {
      const bb = -(y + 0.5 - cy) / F;
      for (let x = 0; x < W; x++) {
        const aa = (x + 0.5 - cx) / F;
        let dx = fx + aa * rx + bb * ux;
        let dy = fy + aa * ry + bb * uy;
        let dz = fz + aa * rz + bb * uz;
        const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx *= il;
        dy *= il;
        dz *= il;
        const i = y * W + x;
        this.rdx[i] = dx;
        this.rdy[i] = dy;
        this.rdz[i] = dz;
        const cf = dx * fx + dy * fy + dz * fz;
        this.cf[i] = cf;
        let tg = Infinity;
        let hd = Infinity;
        if (dy < -1e-4 && oy > 0) {
          tg = -oy / dy;
          hd = tg * Math.sqrt(dx * dx + dz * dz);
        }
        this.gT[i] = tg;
        // the ridge / sky behind (or nothing if the ground is nearer)
        const id = this.background(ox, oy, oz, dx, dy, dz, hd, t, c);
        let r;
        let g;
        let b;
        if (id) {
          r = c[0];
          g = c[1];
          b = c[2];
          this.ids[i] = id;
          this.zbuf[i] = 4000 * cf;
          if (id === ID_SKY) this.sky[i] = 1;
        } else {
          // the ground
          const X = ox + tg * dx;
          const Z = oz + tg * dz;
          this.shadeGround(X, Z, tg, t, c);
          r = c[0];
          g = c[1];
          b = c[2];
          this.ids[i] = ID_GROUND;
          this.zbuf[i] = tg * cf;
        }
        const o = i * 4;
        frame[o] = r;
        frame[o + 1] = g;
        frame[o + 2] = b;
        frame[o + 3] = 255;
      }
    }
  }

  /** Sky and ridges along a ray; returns an id, or 0 when the ground (at horizontal distance hd) is nearer. */
  background(ox, oy, oz, dx, dy, dz, hd, t, out) {
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
      if (hd < th) return 0;
      if (tanE > this.mt[li]) continue;
      const Y = oy + tanE * th;
      if (Y < 0) continue;
      const px = ox + ux * th;
      const pz = oz + uz * th;
      const ang = Math.atan2(px, pz);
      let f = (ang + Math.PI) * (TAB / TWO_PI);
      let i = f | 0;
      if (i >= TAB) i = TAB - 1;
      f -= i;
      const top = L.h[i] + (L.h[i + 1] - L.h[i]) * f;
      if (Y >= top) continue;
      const q = top - Y;
      let j = i - Math.round(((q / L.R) * 1.4 * TAB) / TWO_PI);
      j = ((j % TAB) + TAB) % TAB;
      const lit = smooth(-0.02 * L.amp, 0.02 * L.amp, -L.d[j]);
      let r = L.sh[0] + (L.lit[0] - L.sh[0]) * lit;
      let g = L.sh[1] + (L.lit[1] - L.sh[1]) * lit;
      let bl = L.sh[2] + (L.lit[2] - L.sh[2]) * lit;
      // mist lying low between the ridges, drifting; and the horizon glow behind the east ridges
      const mh = this.mist[li][(i >> 3) & 255];
      const mk = Math.min(1, (1 - smooth(0, mh, Y)) * 0.9);
      const east = smooth(0.1, 1.5, Math.sin(ang) * 0.9 + 0.3);
      const hz0 = HAZE[0] + (SKY_GLOW[0] - HAZE[0]) * east * 0.5;
      const hz1 = HAZE[1] + (SKY_GLOW[1] - HAZE[1]) * east * 0.5;
      const hz2 = HAZE[2] + (SKY_GLOW[2] - HAZE[2]) * east * 0.5;
      r += (hz0 - r) * mk;
      g += (hz1 - g) * mk;
      bl += (hz2 - bl) * mk;
      // the near ridge takes a hint of firelight on its crest? no: too far. Its top edge is
      // a found line (a darker pigment pool) in places
      const pxBelow = (q / th) * this.B.F;
      if (pxBelow < 1.6 && li < 2 && hash(i >> 4, li, 5) > 0.35) {
        r *= 0.72;
        g *= 0.72;
        bl *= 0.78;
      }
      out[0] = r;
      out[1] = g;
      out[2] = bl;
      return ID_RIDGE + li;
    }
    // the sky: a cool wash overhead, the glow of the coming dawn low in the east
    const az = Math.atan2(dx, dz);
    const e = smooth(-0.03, 0.85, dy);
    const glow = Math.exp(-(((az - 1.15) / 0.95) ** 2)) * (1 - smooth(0, 0.5, dy));
    const w2 = e ** 0.55;
    let r = SKY_HOR[0] * (1 - w2) + SKY_MID[0] * w2;
    let g = SKY_HOR[1] * (1 - w2) + SKY_MID[1] * w2;
    let bl = SKY_HOR[2] * (1 - w2) + SKY_MID[2] * w2;
    const z2 = smooth(0.35, 1, dy);
    r += (SKY_ZEN[0] - r) * z2;
    g += (SKY_ZEN[1] - g) * z2;
    bl += (SKY_ZEN[2] - bl) * z2;
    r += (SKY_GLOW[0] - r) * glow * 0.6;
    g += (SKY_GLOW[1] - g) * glow * 0.6;
    bl += (SKY_GLOW[2] - bl) * glow * 0.6;
    // thin cloud drifting, lighter than the sky, torn into streaks by the wind
    let ca = 0;
    if (dy > 0.01) {
      const tc = (700 - oy) / dy;
      const wx = ox + dx * tc + 9 * t + 3000;
      const wz = oz + dz * tc + 3 * t + 800;
      const T = this.tex;
      const d = samp(T.cloud, T.N, wx / 520, wz / 190);
      const th = 0.5;
      if (d > th) {
        const k = smooth(th, th + 0.14, d) * smooth(0.01, 0.2, dy) * 0.95;
        // the masses are cooler and lighter at their edges, thicker (darker) in the middle
        const core = smooth(th + 0.12, th + 0.3, d);
        const lift = 1.55 - 0.5 * core;
        r += (r * lift + 12 - r) * k;
        g += (g * lift + 10 - g) * k;
        bl += (bl * (lift - 0.05) + 14 - bl) * k;
        ca = k;
      }
    }
    this._ca = ca;
    out[0] = r;
    out[1] = g;
    out[2] = bl;
    return ID_SKY;
  }

  /** The ground at (X, Z), d m from the camera: earth and grass under the fire's pool. */
  shadeGround(X, Z, d, t, out) {
    const T = this.tex;
    const n1 = samp(T.ground, T.N, X * 0.3 + 40, Z * 0.3 + 17);
    const n2 = samp(T.ground, T.N, X * 1.6, Z * 1.6 + 5);
    const near = 1 - smooth(6, 26, d);
    const n3 = near > 0 ? samp(T.ground, T.N, X * 5.5 + 9, Z * 5.5) : 0.5;
    const rr = Math.sqrt(X * X + Z * Z);
    // grass tones, then the trodden earth of the camp, then soot round the fire
    let a0 = GRASS_DARK[0] + (GRASS_DRY[0] - GRASS_DARK[0]) * n1;
    let a1 = GRASS_DARK[1] + (GRASS_DRY[1] - GRASS_DARK[1]) * n1;
    let a2 = GRASS_DARK[2] + (GRASS_DRY[2] - GRASS_DARK[2]) * n1;
    const trod = smooth(7, 2.6, rr + (n2 - 0.5) * 2.6);
    const tr = EARTH[0] + (TRAMPLED[0] - EARTH[0]) * n2;
    const tg = EARTH[1] + (TRAMPLED[1] - EARTH[1]) * n2;
    const tb = EARTH[2] + (TRAMPLED[2] - EARTH[2]) * n2;
    a0 += (tr - a0) * trod * 0.85;
    a1 += (tg - a1) * trod * 0.85;
    a2 += (tb - a2) * trod * 0.85;
    const soot = smooth(1.1, 0.45, rr + (n2 - 0.5) * 0.5);
    a0 += (SOOT[0] - a0) * soot;
    a1 += (SOOT[1] - a1) * soot;
    a2 += (SOOT[2] - a2) * soot;
    // brush: darker and paler flecks in the wash, finer near the eye, gone with distance
    const br = 1 + (n3 - 0.5) * 0.5 * near + (n2 - 0.5) * 0.3;
    // blades: a fleck of dark in cells of the ground
    if (near > 0.1) {
      // thin ticks, longer along Z (blades lying over), broken by a second noise
      const v = valueNoise(X * 8.5, Z * 2.6, 3) * valueNoise(X * 2, Z * 2, 8);
      if (v > 0.36) {
        const k = 0.72 + 0.2 * smooth(0.36, 0.5, 1 - v);
        a0 *= k;
        a1 *= k;
        a2 *= k;
      }
    }
    const I = this.intensity(X, 0, Z);
    const sh = this.shadowAt(X, Z);
    const lit = I * sh;
    let r = a0 * br * (AMB[0] + FIRE_C[0] * lit);
    let g = a1 * br * (AMB[1] + FIRE_C[1] * lit);
    let b = a2 * br * (AMB[2] + FIRE_C[2] * lit);
    // embers glowing in the ashes under the flames
    if (soot > 0.2) {
      const e = valueNoise(X * 14, Z * 14 + this.t2 * 2.3, 7);
      if (e > 0.72) {
        const k = (e - 0.72) * 3 * soot * this.k;
        r += 150 * k;
        g += 55 * k;
        b += 12 * k;
      }
    }
    // aerial perspective toward the glow at the far end of the ground
    const hz = smooth(30, 400, d) * 0.85;
    r += (HAZE[0] * 0.9 - r) * hz;
    g += (HAZE[1] * 0.9 - g) * hz;
    b += (HAZE[2] * 0.95 - b) * hz;
    out[0] = r;
    out[1] = g;
    out[2] = b;
  }

  // ---------------------------------------------------------------- stars and the Thread

  /** A world direction -> screen (rotation only: the sky is at infinity). */
  dirToScreen(B, d) {
    const z = d[0] * B.fx + d[1] * B.fy + d[2] * B.fz;
    if (z < 0.02) return null;
    const iz = B.F / z;
    return [
      B.cx + (d[0] * B.rx + d[1] * B.ry + d[2] * B.rz) * iz,
      B.cy - (d[0] * B.ux + d[1] * B.uy + d[2] * B.uz) * iz,
    ];
  }

  drawStars(frame, B, t, k) {
    const { W, H } = this;
    const t3 = this.t3;
    for (const s of this.stars) {
      const p = this.dirToScreen(B, s.d);
      if (!p) continue;
      const x = Math.round(p[0] - 0.5);
      const y = Math.round(p[1] - 0.5);
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const i = y * W + x;
      if (!this.sky[i]) continue;
      // thin cloud over a star dims it
      let br = 1;
      if (s.tw) br = 0.55 + 0.45 * Math.sin(t3 * 6.3 + s.ph);
      br *= k;
      if (br < 0.25) continue;
      const cold =
        s.tint < 0.3 ? [196, 204, 232] : s.tint > 0.85 ? [236, 214, 190] : [222, 216, 212];
      const a = Math.min(1, br);
      const put = (xx, yy, w) => {
        const j = (yy * W + xx) * 4;
        if (!this.sky[yy * W + xx]) return;
        frame[j] += (cold[0] - frame[j]) * w;
        frame[j + 1] += (cold[1] - frame[j + 1]) * w;
        frame[j + 2] += (cold[2] - frame[j + 2]) * w;
      };
      put(x, y, a);
      if (s.b >= 2) {
        put(x + 1, y, 0.45 * a);
        put(x, y + 1, 0.45 * a);
      }
      if (s.b >= 3) {
        put(x - 1, y, 0.5 * a);
        put(x, y - 1, 0.5 * a);
        put(x + 1, y + 1, 0.2 * a);
      }
    }
  }

  /** The Thread's direction at u in 0..1 (an arc over the camp, alive with small waves). */
  threadDir(u, t, TH, amp = 1) {
    const az = TH.az0 + (TH.az1 - TH.az0) * u + 0.02 * Math.sin(u * 7 + t * 0.6);
    const arc = Math.sin(Math.PI * clamp(u + TH.skew * (u - 0.5) * (1 - u) * 2)) ** 0.85;
    const el =
      0.04 +
      (TH.peak - 0.04) * arc +
      TH.wave * amp * Math.sin(u * 38 + t * 1.9) +
      TH.wave * amp * 1.6 * Math.sin(u * 11 - t * 0.9) * (0.4 + arc);
    return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  }

  /**
   * The Thread across the sky: a cold, pale gold line stitched through the stars, with a
   * dithered halo, running glints, and a bead of light at each pulse (a note of the tune).
   * th: { k (0..1 brightness), pulses: [{ t0, speed?, width?, k? }], width, cfg (blocking's THREAD) }.
   */
  drawThread(frame, B, t, th) {
    const { W, H } = this;
    const TH = th.cfg;
    const n = 700;
    const k0 = th.k ?? 1;
    let prev = null;
    const t3 = this.t3;
    // the Thread sings with the tune: its waves swell on each note and settle in the rests
    const amp = 1 + 4 * (th.energy ?? 0);
    for (let s = 0; s <= n; s++) {
      const u = s / n;
      const p = this.dirToScreen(B, this.threadDir(u, t, TH, amp));
      if (p && prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 12) {
        // pulses running along the line: beads and a swell that decays behind them
        let glow = 0;
        for (const q of th.pulses || []) {
          const age = t - q.t0;
          if (age < 0 || age > 2.6) continue;
          const pos = (q.from ?? 0) + age * (q.speed ?? 0.55);
          const dd = pos - u;
          const kq = q.k ?? 1;
          if (dd > -0.05 && dd < 0.5)
            glow = Math.max(glow, kq * Math.exp(-((dd - 0.12) ** 2) / 0.004) * (1 - age / 2.6));
          if (dd >= 0 && dd < 0.8)
            glow = Math.max(glow, kq * 0.35 * Math.exp(-dd * 5) * (1 - age / 2.6));
        }
        // slow stitching: the brightness breathes along it
        const shimmer = 0.6 + 0.4 * Math.sin(u * 60 - t3 * 5.2) * Math.sin(u * 9 + t3 * 1.3);
        const a = clamp((0.8 * shimmer + glow) * k0);
        this.plotThread(frame, prev, p, a, glow, t3, s);
      }
      prev = p;
    }
    // a four-point glint at the head of each young bead
    for (const q of th.pulses || []) {
      const age = t - q.t0;
      if (age < 0 || age > 1.3) continue;
      const u = (q.from ?? 0) + age * (q.speed ?? 0.55) - 0.12;
      if (u < 0 || u > 1) continue;
      const p = this.dirToScreen(B, this.threadDir(u, t, TH, amp));
      if (!p) continue;
      const k = (q.k ?? 1) * (1 - age / 1.3);
      if (k < 0.3) continue;
      const r = Math.round(1 + 2.4 * k);
      const x = Math.round(p[0] - 0.5);
      const y = Math.round(p[1] - 0.5);
      for (let d = -r; d <= r; d++) {
        for (const [xx, yy] of [
          [x + d, y],
          [x, y + d],
        ]) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || !this.sky[yy * W + xx]) continue;
          const j = (yy * W + xx) * 4;
          const w = (1 - Math.abs(d) / (r + 1)) * Math.min(1, k * 1.3);
          frame[j] += (255 - frame[j]) * w;
          frame[j + 1] += (240 - frame[j + 1]) * w;
          frame[j + 2] += (190 - frame[j + 2]) * w;
        }
      }
    }
  }

  plotThread(frame, p0, p1, a, glow, t3, s) {
    const { W, H } = this;
    const len = Math.max(1, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
    const steps = Math.ceil(len * 1.5);
    for (let q = 0; q < steps; q++) {
      const f = q / steps;
      const x = p0[0] + (p1[0] - p0[0]) * f;
      const y = p0[1] + (p1[1] - p0[1]) * f;
      const xi = Math.round(x - 0.5);
      const yi = Math.round(y - 0.5);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
      if (!this.sky[yi * W + xi]) continue;
      // running stitches: the far parts of a thread are a dashed line
      const o = (yi * W + xi) * 4;
      // the core: pale gold, 1 px
      const core = 0.35 + 0.65 * a;
      frame[o] += (255 - frame[o]) * core;
      frame[o + 1] += (236 - frame[o + 1]) * core;
      frame[o + 2] += (176 - frame[o + 2]) * core * 0.9;
      // a halo of gold pixels above and below, dithered
      if (a > 0.15 && bayer(xi, yi) < a * 1.0) {
        for (const dy of [-1, 1]) {
          const yy = yi + dy;
          if (yy < 0 || yy >= H || !this.sky[yy * W + xi]) continue;
          const j = (yy * W + xi) * 4;
          const k = 0.5 * a;
          frame[j] += (222 - frame[j]) * k;
          frame[j + 1] += (170 - frame[j + 1]) * k;
          frame[j + 2] += (78 - frame[j + 2]) * k;
        }
      }
      if (a > 0.9 && bayer(xi + 1, yi + 3) < (a - 0.7) * 1.4) {
        // a flare: the halo opens to two pixels
        for (const dy of [-2, 2]) {
          const yy = yi + dy;
          if (yy < 0 || yy >= H || !this.sky[yy * W + xi]) continue;
          const j = (yy * W + xi) * 4;
          frame[j] += (226 - frame[j]) * 0.32;
          frame[j + 1] += (176 - frame[j + 1]) * 0.32;
          frame[j + 2] += (84 - frame[j + 2]) * 0.32;
        }
      }
      if (glow > 0.75 && bayer(xi + 2, yi) < glow - 0.5) {
        const k = 0.5 * glow;
        for (const [dx, dy] of [
          [0, -2],
          [0, 2],
          [-2, 0],
          [2, 0],
        ]) {
          const xx = xi + dx;
          const yy = yi + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || !this.sky[yy * W + xx]) continue;
          const j = (yy * W + xx) * 4;
          frame[j] += (255 - frame[j]) * k;
          frame[j + 1] += (232 - frame[j + 1]) * k;
          frame[j + 2] += (160 - frame[j + 2]) * k;
        }
      }
    }
  }

  // ---------------------------------------------------------------- props (ray-tested)

  /** Screen box of world points, or the whole frame if any is behind the camera. */
  boxOf(cam, pts, pad = 2) {
    const { W, H } = this;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [X, Y, Z] of pts) {
      const p = project(cam, X, Y, Z, W, H);
      if (p.depth < 0.15) return [0, 0, W, H];
      x0 = Math.min(x0, p.sx);
      y0 = Math.min(y0, p.sy);
      x1 = Math.max(x1, p.sx);
      y1 = Math.max(y1, p.sy);
    }
    return [
      Math.max(0, Math.floor(x0 - pad)),
      Math.max(0, Math.floor(y0 - pad)),
      Math.min(W, Math.ceil(x1 + pad)),
      Math.min(H, Math.ceil(y1 + pad)),
    ];
  }

  /** Light a surface point: albedo A (rgb 0..255), normal n, extra emissive [r, g, b]. */
  lightSurf(X, Y, Z, nx, ny, nz, A, out, warm = 0, ambK = 1) {
    const f = this.fire;
    let lx = f.x - X;
    let ly = f.y - Y;
    let lz = f.z - Z;
    const d2 = lx * lx + ly * ly + lz * lz;
    const il = 1 / Math.sqrt(d2 + 1e-6);
    lx *= il;
    ly *= il;
    lz *= il;
    const lam = Math.max(0, nx * lx + ny * ly + nz * lz);
    const I = (this.k * 1.2) / (1 + d2 / 2.0);
    const fl = I * (0.18 + 0.82 * lam);
    const sky = (0.8 + 0.2 * ny) * ambK;
    out[0] = A[0] * (AMB[0] * sky + FIRE_C[0] * fl) + warm * 90;
    out[1] = A[1] * (AMB[1] * sky + FIRE_C[1] * fl) + warm * 34;
    out[2] = A[2] * (AMB[2] * sky + FIRE_C[2] * fl) + warm * 6;
  }

  drawProps(frame, B) {
    const cam = this.cam;
    const { W, H } = this;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const c = new Float64Array(3);
    // tents
    for (const T of this.tents) {
      const [bx0, by0, bx1, by1] = this.boxOf(cam, T.corners);
      if (bx0 >= bx1 || by0 >= by1) continue;
      // the ray in the tent's local frame (u along the ridge, y up, v across)
      const lox = ox - T.x;
      const loz = oz - T.z;
      const lo = [lox * T.c + loz * T.s, oy, -lox * T.s + loz * T.c];
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          const ld = [dx * T.c + dz * T.s, dy, -dx * T.s + dz * T.c];
          // convex prism: clip the ray against its planes
          let t0 = 0.05;
          let t1 = 1e9;
          let face = -1;
          let ok = true;
          for (let p = 0; p < 5; p++) {
            const pl = T.pl[p];
            const den = pl[0] * ld[0] + pl[1] * ld[1] + pl[2] * ld[2];
            const num = pl[3] - (pl[0] * lo[0] + pl[1] * lo[1] + pl[2] * lo[2]);
            if (Math.abs(den) < 1e-9) {
              if (num < 0) {
                ok = false;
                break;
              }
              continue;
            }
            const tt = num / den;
            if (den < 0) {
              if (tt > t0) {
                t0 = tt;
                face = p;
              }
            } else if (tt < t1) t1 = tt;
            if (t0 > t1) {
              ok = false;
              break;
            }
          }
          if (!ok || face < 0) continue;
          const depth = t0 * this.cf[i];
          if (depth >= this.zbuf[i]) continue;
          // the hit in local coords, and its normal in world coords
          const hu = lo[0] + ld[0] * t0;
          const hy = lo[1] + ld[1] * t0;
          const hv = lo[2] + ld[2] * t0;
          const pl = T.pl[face];
          const nu = pl[0];
          const nv = pl[2];
          const nx = nu * T.c - nv * T.s;
          const nz = nu * T.s + nv * T.c;
          const ny = pl[1];
          const X = ox + dx * t0;
          const Z = oz + dz * t0;
          let A = CANVAS;
          let warm = 0;
          let inked = 1;
          // canvas: long seams down the slope, patches, a darker hem near the ground
          const seam = Math.abs(((hu / 0.62) % 1) - 0.5) > 0.47 ? 0.78 : 1;
          const patch =
            hash(Math.floor(hu / 0.9), Math.floor(hy / 0.8) + (hv > 0 ? 40 : 0), T.i + 3) > 0.9
              ? 0.86
              : 1;
          const stain = 0.86 + 0.24 * valueNoise(hu * 1.7 + T.i * 9, hy * 1.7 + hv * 1.3, 4);
          const hem = smooth(0.0, 0.5, hy);
          let sh = seam * patch * stain * (0.72 + 0.28 * hem);
          let inDoor = false;
          if (face === 2) {
            // the door: a dark triangular opening, with the flaps folded back either side
            const dw = T.w * 0.5 * 0.5 * (1 - hy / (T.h * 0.85));
            if (hy < T.h * 0.85 && Math.abs(hv) < dw) inDoor = true;
            else if (hy < T.h * 0.85 && Math.abs(hv) < dw + 0.28) sh *= 0.72; // the fold
          }
          if (inDoor) {
            // the tent's inside: near black with a faint warm bounce low down
            const k = 0.08 + 0.06 * (1 - hy / T.h);
            this.lightSurf(X, hy, Z, nx, ny, nz, CANVAS, c, 0.03);
            frame[i * 4] = 20 + c[0] * 0.08 + k * 40;
            frame[i * 4 + 1] = 18 + c[1] * 0.06 + k * 22;
            frame[i * 4 + 2] = 28 + c[2] * 0.08 + k * 10;
            this.ids[i] = ID_TENT + T.i;
            this.zbuf[i] = depth;
            this.ink[i] = 1;
            continue;
          }
          this.lightSurf(X, hy, Z, nx, ny, nz, [A[0] * sh, A[1] * sh, A[2] * sh], c, warm, 1.75);
          // aerial perspective
          const hz = smooth(20, 120, depth) * 0.4;
          frame[i * 4] = c[0] + (HAZE[0] - c[0]) * hz;
          frame[i * 4 + 1] = c[1] + (HAZE[1] - c[1]) * hz;
          frame[i * 4 + 2] = c[2] + (HAZE[2] - c[2]) * hz;
          this.ids[i] = ID_TENT + T.i;
          this.zbuf[i] = depth;
          this.ink[i] = inked;
          this.sky[i] = 0;
        }
    }
    // boxes (benches, crates, the logs)
    for (const Bx of this.boxes) {
      const [bx0, by0, bx1, by1] = this.boxOf(cam, Bx.corners);
      if (bx0 >= bx1 || by0 >= by1) continue;
      const lox = ox - Bx.x;
      const loz = oz - Bx.z;
      const lo = [lox * Bx.c + loz * Bx.s, oy, -lox * Bx.s + loz * Bx.c];
      const ext = [Bx.sx, Bx.h / 2, Bx.sz];
      const cy0 = Bx.h / 2;
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          const ld = [dx * Bx.c + dz * Bx.s, dy, -dx * Bx.s + dz * Bx.c];
          // slab test on the box (centre at height h/2)
          let t0 = 0.05;
          let t1 = 1e9;
          let ax = -1;
          let sg = 1;
          const oc = [lo[0], lo[1] - cy0, lo[2]];
          let ok = true;
          for (let a = 0; a < 3; a++) {
            if (Math.abs(ld[a]) < 1e-9) {
              if (Math.abs(oc[a]) > ext[a]) {
                ok = false;
                break;
              }
              continue;
            }
            let ta = (-ext[a] - oc[a]) / ld[a];
            let tb = (ext[a] - oc[a]) / ld[a];
            let s2 = -1;
            if (ta > tb) {
              const tmp = ta;
              ta = tb;
              tb = tmp;
              s2 = 1;
            }
            if (ta > t0) {
              t0 = ta;
              ax = a;
              sg = s2;
            }
            if (tb < t1) t1 = tb;
            if (t0 > t1) {
              ok = false;
              break;
            }
          }
          if (!ok || ax < 0) continue;
          const depth = t0 * this.cf[i];
          if (depth >= this.zbuf[i]) continue;
          const nl = [0, 0, 0];
          nl[ax] = sg;
          const nx = nl[0] * Bx.c - nl[2] * Bx.s;
          const nz = nl[0] * Bx.s + nl[2] * Bx.c;
          const ny = nl[1];
          const X = ox + dx * t0;
          const Y = oy + dy * t0;
          const Z = oz + dz * t0;
          const isLog = Bx.kind === 'log';
          const grain =
            0.82 +
            0.3 * valueNoise(lo[0] * 9 + ld[0] * t0 * 9 + Bx.x * 7, (lo[2] + ld[2] * t0) * 21, 5);
          const A0 = isLog ? WOOD_DK : Bx.kind === 'crate' ? WOOD : WOOD;
          const A = [A0[0] * grain, A0[1] * grain, A0[2] * grain];
          this.lightSurf(
            X,
            Y,
            Z,
            nx,
            ny,
            nz,
            A,
            c,
            isLog ? 0.95 * this.k * (1 - smooth(0.2, 0.7, Math.hypot(X, Z))) : 0,
          );
          frame[i * 4] = c[0];
          frame[i * 4 + 1] = c[1];
          frame[i * 4 + 2] = c[2];
          this.ids[i] = ID_PROP;
          this.zbuf[i] = depth;
          this.ink[i] = 1;
          this.sky[i] = 0;
        }
    }
    // stumps and barrels: vertical cylinders with a top
    for (const Cy of this.cyls) {
      const pts = [];
      for (const a of [0, 1.57, 3.14, 4.71])
        for (const y of [0, Cy.h])
          pts.push([Cy.x + Math.cos(a) * Cy.r, y, Cy.z + Math.sin(a) * Cy.r]);
      const [bx0, by0, bx1, by1] = this.boxOf(cam, pts);
      if (bx0 >= bx1 || by0 >= by1) continue;
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          const px = ox - Cy.x;
          const pz = oz - Cy.z;
          const a = dx * dx + dz * dz;
          if (a < 1e-9) continue;
          const b = px * dx + pz * dz;
          const cc = px * px + pz * pz - Cy.r * Cy.r;
          const disc = b * b - a * cc;
          let t0 = -1;
          let top = false;
          if (disc > 0) {
            const ts = (-b - Math.sqrt(disc)) / a;
            const yy = oy + dy * ts;
            if (ts > 0.05 && yy >= 0 && yy <= Cy.h) t0 = ts;
          }
          if (dy < 0) {
            const tt = (Cy.h - oy) / dy;
            if (tt > 0.05) {
              const qx = px + dx * tt;
              const qz = pz + dz * tt;
              if (qx * qx + qz * qz <= Cy.r * Cy.r && (t0 < 0 || tt < t0)) {
                t0 = tt;
                top = true;
              }
            }
          }
          if (t0 < 0) continue;
          const depth = t0 * this.cf[i];
          if (depth >= this.zbuf[i]) continue;
          const X = ox + dx * t0;
          const Y = oy + dy * t0;
          const Z = oz + dz * t0;
          let nx = 0;
          let ny = 1;
          let nz = 0;
          if (!top) {
            nx = (X - Cy.x) / Cy.r;
            nz = (Z - Cy.z) / Cy.r;
            ny = 0;
          }
          let A = Cy.kind === 'barrel' ? BARREL : WOOD;
          let k = 0.85 + 0.3 * valueNoise(Math.atan2(nz, nx) * 5 + Cy.x, Y * 6, 3);
          if (Cy.kind === 'barrel' && !top) {
            const hb = Y / Cy.h;
            if (Math.abs(hb - 0.18) < 0.045 || Math.abs(hb - 0.82) < 0.045) k *= 0.55; // hoops
          }
          if (top && Cy.kind === 'stump') {
            // rings on the cut top
            k *= 0.88 + 0.2 * Math.sin(Math.hypot(X - Cy.x, Z - Cy.z) * 34);
            A = [150, 120, 84];
          }
          this.lightSurf(X, Y, Z, nx, ny, nz, [A[0] * k, A[1] * k, A[2] * k], c);
          frame[i * 4] = c[0];
          frame[i * 4 + 1] = c[1];
          frame[i * 4 + 2] = c[2];
          this.ids[i] = ID_PROP + 1;
          this.zbuf[i] = depth;
          this.ink[i] = 1;
          this.sky[i] = 0;
        }
    }
    // stones (ellipsoids resting on the ground) and bedrolls
    for (let si = 0; si < this.stones.length; si++) {
      const St = this.stones[si];
      const pts = [];
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          for (const y of [0, 2 * St.b]) pts.push([St.x + sx * St.a, y, St.z + sz * St.c]);
      const [bx0, by0, bx1, by1] = this.boxOf(cam, pts);
      if (bx0 >= bx1 || by0 >= by1) continue;
      const cs = Math.cos(St.yaw);
      const sn = Math.sin(St.yaw);
      const lox = ox - St.x;
      const loz = oz - St.z;
      const ou = (lox * cs + loz * sn) / St.a;
      const ov = (-lox * sn + loz * cs) / St.c;
      const oyy = (oy - St.b * 0.6) / St.b;
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          const du = (dx * cs + dz * sn) / St.a;
          const dv = (-dx * sn + dz * cs) / St.c;
          const dyy = dy / St.b;
          const a = du * du + dyy * dyy + dv * dv;
          const b = ou * du + oyy * dyy + ov * dv;
          const cc = ou * ou + oyy * oyy + ov * ov - 1;
          const disc = b * b - a * cc;
          if (disc <= 0) continue;
          const t0 = (-b - Math.sqrt(disc)) / a;
          if (t0 < 0.05) continue;
          const Y = oy + dy * t0;
          if (Y < 0) continue;
          const depth = t0 * this.cf[i];
          if (depth >= this.zbuf[i]) continue;
          const hu = ou + du * t0;
          const hyy = oyy + dyy * t0;
          const hv = ov + dv * t0;
          // the normal of an ellipsoid: gradient of the implicit form
          let nu = hu / St.a;
          let nyy = hyy / St.b;
          let nv = hv / St.c;
          const nl = Math.hypot(nu, nyy, nv) || 1;
          nu /= nl;
          nyy /= nl;
          nv /= nl;
          const nx = nu * cs - nv * sn;
          const nz = nu * sn + nv * cs;
          const X = ox + dx * t0;
          const Z = oz + dz * t0;
          const base = St.bed ? [96, 84, 70] : STONE;
          const tone = 0.78 + 0.4 * valueNoise(X * 3 + 11, Z * 3 + Y * 3, 6);
          // fire-ring stones: sooty on top, lit red on the side toward the flames
          let warm = 0;
          if (St.ring)
            warm =
              0.25 *
              this.k *
              Math.max(0, -(nx * X + nz * Z) / 0.6) *
              (0.5 + 0.5 * Math.min(1, Y / 0.1));
          this.lightSurf(
            X,
            Y,
            Z,
            nx,
            nyy,
            nz,
            [base[0] * tone, base[1] * tone, base[2] * tone],
            c,
            warm,
          );
          frame[i * 4] = c[0];
          frame[i * 4 + 1] = c[1];
          frame[i * 4 + 2] = c[2];
          this.ids[i] = ID_STONE + (si & 63);
          this.zbuf[i] = depth;
          this.ink[i] = St.bed ? 0 : 1;
          this.sky[i] = 0;
        }
    }
  }

  /** Ink on the nearer side of every edge between solid things (found lines, broken by the dither). */
  passInk(frame) {
    const { W, H } = this;
    const ids = this.ids;
    const zb = this.zbuf;
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W - 1; x++) {
        const i = y * W + x;
        for (const j of [i + 1, i + W]) {
          const a = ids[i];
          const b = ids[j];
          if (a === b) continue;
          const near = zb[i] < zb[j] ? i : j;
          const far = near === i ? j : i;
          if (!this.ink[near]) continue;
          // sky and ridges are never inked here; ground against an object is (its foot)
          if (ids[near] < 30) continue;
          // an edge with real depth between the sides (not two faces of one object)
          if (ids[near] >= ID_TENT && ids[near] < ID_PROP && ids[far] === ids[near]) continue;
          const px = near % W;
          const py = (near / W) | 0;
          if (hash(px >> 1, py >> 1, 17) < 0.14) continue; // the line breaks in places
          const o = near * 4;
          frame[o] = frame[o] * 0.3 + INKC[0] * 0.7;
          frame[o + 1] = frame[o + 1] * 0.3 + INKC[1] * 0.7;
          frame[o + 2] = frame[o + 2] * 0.3 + INKC[2] * 0.7;
        }
      }
  }

  /** The vellum's grain shows through the wash: a few percent, so dark passages still feel painted. */
  paperGrain(frame) {
    const p = this.paper;
    if (!p) return;
    const n = this.W * this.H;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const id = this.ids[i];
      if (id >= ID_FX) continue;
      const g = 0.93 + 0.07 * ((p[o] + p[o + 1]) / (2 * 207));
      frame[o] *= g;
      frame[o + 1] *= g;
      frame[o + 2] *= g;
    }
  }
}

Object.assign(CampWorld.prototype, billboardMethods);
