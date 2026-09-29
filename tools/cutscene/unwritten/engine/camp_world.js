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
import { bayer, clamp, hash, smooth, valueNoise } from './raster.js';
import { billboardMethods } from './camp_billboards.js';

const TWO_PI = Math.PI * 2;

// ------------------------------------------------------------------------ colours (targets)

// The page at night: the vellum is toned indigo, washes are pale and transparent, and the
// paper's grain shows through every one of them. Dim warm tones lean to mauve and violet grey,
// never to olive (the camp's palette snap has no earth ramp either: camp_palette.js).

// the night's ambient: cool violet-blue light from the sky (multiplies an albedo)
const AMB = [0.2, 0.225, 0.36];
// the fire's light (multiplies an albedo, times its intensity 0..~1.3): red-orange, never yellow
const FIRE_C = [1.2, 0.6, 0.22];
const HAZE = [66, 60, 90]; // aerial perspective toward the horizon glow
const INKC = [14, 12, 22];
const SKY_ZEN = [14, 13, 27];
const SKY_MID = [34, 32, 54];
const SKY_HOR = [74, 70, 98];
const SKY_GLOW = [128, 104, 122]; // the eastern horizon: the dawn to come
const GRASS_DARK = [70, 68, 92];
const GRASS_PALE = [96, 92, 112];
const EARTH = [158, 122, 100];
const TRAMPLED = [176, 136, 108];
const SOOT = [34, 30, 36];
const CANVAS = [204, 188, 158];
const WOOD = [122, 92, 72];
const STONE = [132, 126, 138];
const BARREL = [118, 90, 72];

// ids: what each pixel shows (edges come from changes between them)
const ID_SKY = 1;
const ID_RIDGE = 10; // + layer
const ID_GROUND = 20;
const ID_TENT = 40; // + tent index
const ID_PROP = 80;
const ID_STONE = 120;
const ID_GRASS = 205;
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
  // near hills with a dark line of cypresses, then paler ranges into the glow. `ink`: how much of
  // the crest is a found line (drawn in ink) rather than soft (pigment pooling) or lost (haze)
  {
    R: 62,
    base: 5,
    amp: 13,
    freq: 2.6,
    seed: 11,
    trees: 34,
    tree: [1.5, 3.4],
    tw: 1.0,
    lit: [40, 36, 56],
    sh: [30, 27, 44],
    mist: 4,
    ink: 0.16,
  },
  {
    R: 135,
    base: 8,
    amp: 30,
    freq: 3.1,
    seed: 17,
    trees: 22,
    tree: [3.0, 6.5],
    tw: 1.8,
    lit: [52, 48, 72],
    sh: [43, 40, 62],
    mist: 9,
    ink: 0.05,
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
    lit: [66, 62, 88],
    sh: [59, 55, 80],
    mist: 26,
    ink: -0.1,
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
    lit: [80, 75, 102],
    sh: [74, 69, 96],
    mist: 90,
    ink: -0.3,
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
  // how the crest is drawn along its length: > 0.5 found (a line of ink), 0.22..0.5 soft
  // (pigment pooled along it, no line), below that lost in the haze
  const eq = new Float32Array(TAB / 8);
  for (let k = 0; k < eq.length; k++) {
    const th = (k / eq.length) * TWO_PI;
    eq[k] = clamp(
      valueNoise(Math.cos(th) * 5 + 3, Math.sin(th) * 5 + 7, L.seed + 900) * 1.3 - 0.15 + L.ink,
      0,
      1,
    );
  }
  return { ...L, h, d, hmax, eq };
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
    this.buildGrain();
    this.buildStars();
    this.buildProps();
    this.buildTufts();
    this.actorsLast = [];
  }

  // ---------------------------------------------------------------- building

  /**
   * The vellum's tooth as a screen-fixed field (the page does not move when the camera does): a
   * fine hash, a 2 px clumping and short horizontal fibres, about -1.3..1.3. Washes multiply by
   * 1 + k * grain, so pigment settles darker in the valleys of the paper.
   */
  buildGrain() {
    const { W, H } = this;
    const g = new Float32Array(W * H);
    const p = this.paper;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const fine = hash(x, y, 313) - 0.5;
        const clump = valueNoise(x * 0.45, y * 0.5, 317) - 0.5;
        const fibre = valueNoise(x * 0.11, y * 0.85, 331) - 0.5;
        const mottle = p ? (p[(y * W + x) * 4] - 207) / 24 : 0;
        g[y * W + x] = fine * 0.8 + clump * 0.9 + fibre * 0.7 + mottle * 0.5;
      }
    this.grain = g;
  }

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
      // the door (the -u end) faces the fire, plus a little jitter (or the tent's own yaw)
      const yaw = t.yaw ?? Math.atan2(t.z, t.x) + (t.jitter || 0);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const a = t.L / 2;
      const b = t.w / 2;
      const Nn = Math.hypot(b, t.h);
      const corners = [];
      for (const u of [-1, 1])
        for (const y of [0, 1])
          for (const v of [-1, 1]) {
            const lu = u * a;
            const lv = v * b;
            corners.push([t.x + lu * c - lv * s, y * (t.h + 0.35), t.z + lu * s + lv * c]);
          }
      // guy ropes run out from the pole tips along the ridge: their pegs widen the box
      const rope = t.rope ?? 1.5;
      for (const u of [-1, 1]) {
        const lu = u * (a + rope);
        corners.push([t.x + lu * c, 0, t.z + lu * s]);
      }
      return {
        ...t,
        i,
        c,
        s,
        yaw,
        a,
        b,
        rope,
        sag: t.sag ?? 0.16,
        nN: Nn,
        // planes of the unsagged prism in local (u, y, v): normal and offset. The roof is then
        // found on the sagged ridge (see tentRoof): the prism only bounds the search.
        pl: [
          [0, b / Nn, t.h / Nn, (t.h * b) / Nn],
          [0, b / Nn, -t.h / Nn, (t.h * b) / Nn],
          [-1, 0, 0, a],
          [1, 0, 0, a],
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
    // the fire's logs: charred, lying across each other and leaning in over the coals
    // (p0 -> p1 in metres from the fire's centre, r the radius)
    this.logs = [
      { p0: [-0.34, 0.055, 0.07], p1: [0.3, 0.06, -0.09], r: 0.055 },
      { p0: [0.08, 0.05, -0.32], p1: [-0.05, 0.07, 0.3], r: 0.05 },
      { p0: [-0.3, 0.05, -0.15], p1: [0.0, 0.3, 0.02], r: 0.042 },
      { p0: [0.29, 0.05, 0.13], p1: [0.01, 0.27, -0.02], r: 0.042 },
      { p0: [0.12, 0.05, 0.3], p1: [-0.03, 0.24, 0.02], r: 0.038 },
    ].map((L) => {
      const ab = [L.p1[0] - L.p0[0], L.p1[1] - L.p0[1], L.p1[2] - L.p0[2]];
      return { ...L, ab, abab: ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] };
    });
    this.cyls = [];
    for (const s of S.stumps || []) this.cyls.push({ ...s, kind: 'stump' });
    for (const s of S.barrels || []) this.cyls.push({ ...s, kind: 'barrel' });
    // stones: ellipsoids resting on the ground, cut by a few planes into a flat crown and
    // facets (world.js's stones): a ring round the fire, a few scattered, bedrolls at the tents
    this.stones = [];
    const facets = (k) => {
      const F = [];
      // the crown
      F.push(0, 1, 0, 0.66 + 0.16 * hash(k, 20, 77));
      const n = 4 + Math.floor(hash(k, 21, 77) * 3);
      for (let f = 0; f < n; f++) {
        const th = hash(k, 30 + f, 77) * TWO_PI;
        const el = 0.12 + 0.7 * hash(k, 40 + f, 77);
        F.push(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el));
        F.push(0.6 + 0.24 * hash(k, 50 + f, 77));
      }
      return F;
    };
    const ring = 0.56;
    for (let k = 0; k < 9; k++) {
      const an = (k / 9) * TWO_PI + hash(k, 1, 77) * 0.3;
      const r = ring + (hash(k, 2, 77) - 0.5) * 0.08;
      this.stones.push({
        x: Math.cos(an) * r,
        z: Math.sin(an) * r,
        a: 0.1 + 0.04 * hash(k, 3, 77),
        b: 0.075 + 0.035 * hash(k, 4, 77),
        c: 0.09 + 0.04 * hash(k, 5, 77),
        yaw: hash(k, 6, 77) * 3,
        ring: true,
        fac: facets(k),
      });
    }
    for (let k = 0; k < 14; k++) {
      const an = hash(k, 7, 77) * TWO_PI;
      const r = 2.8 + hash(k, 8, 77) * 9;
      this.stones.push({
        x: Math.cos(an) * r,
        z: Math.sin(an) * r,
        a: 0.14 + 0.3 * hash(k, 9, 77),
        b: 0.1 + 0.16 * hash(k, 10, 77),
        c: 0.14 + 0.25 * hash(k, 11, 77),
        yaw: hash(k, 12, 77) * 3,
        fac: facets(k + 40),
      });
    }
    // bedrolls beside the tents (dark low lumps)
    for (const t of this.tents.slice(0, 5))
      this.stones.push({
        x: t.x - t.c * (t.a + 1.4) + t.s * 0.6,
        z: t.z - t.s * (t.a + 1.4) - t.c * 0.6,
        a: 0.9,
        b: 0.22,
        c: 0.38,
        yaw: t.yaw + 1.57,
        bed: true,
        fac: [],
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
      // no grass between the lens and Edric's feet at the end (it crosses his legs)
      [-1.5, -1.0, 1.3],
      [-1.0, -2.2, 1.2],
      [-2.4, -0.4, 1.0],
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
      // the crest: where it is found it is a line of ink; where soft the pigment pools along it
      // (a darker wash, no line); where lost it melts into the haze
      const pxBelow = (q / th) * this.B.F;
      if (li < 3) {
        const eq = L.eq[i >> 3];
        const w = li === 0 ? 1.7 : li === 1 ? 1.15 : 0.85;
        if (eq > 0.5) {
          if (pxBelow < w) {
            r = r * 0.15 + INKC[0] * 0.85;
            g = g * 0.15 + INKC[1] * 0.85;
            bl = bl * 0.15 + INKC[2] * 0.85;
          }
        } else if (eq > 0.22) {
          if (pxBelow < 2.6) {
            r *= 0.8;
            g *= 0.8;
            bl *= 0.84;
          }
        } else if (pxBelow < 2.4) {
          const k2 = 0.5 * (1 - pxBelow / 2.4);
          r += (hz0 - r) * k2;
          g += (hz1 - g) * k2;
          bl += (hz2 - bl) * k2;
        }
      }
      out[0] = r;
      out[1] = g;
      out[2] = bl;
      return ID_RIDGE + li;
    }
    // the sky: washes laid in bands, the edge of each a wandering line where the pigment pooled
    // as it dried (never a perfect ramp); the glow of the coming dawn low in the east
    const az = Math.atan2(dx, dz);
    const wob =
      valueNoise(az * 3.2 + 7, dy * 7 + 3, 61) * 0.62 + valueNoise(az * 10 + 1, dy * 21, 67) * 0.38;
    const pp = smooth(-0.03, 1.0, dy + (wob - 0.5) * 0.24);
    const NB = 7;
    const pb = pp * NB;
    const bi = Math.floor(pb);
    const fr = pb - bi;
    const pq = (bi + 0.5) / NB;
    const w2 = smooth(0, 0.42, pq);
    const z2 = smooth(0.42, 1, pq);
    let r = SKY_HOR[0] + (SKY_MID[0] - SKY_HOR[0]) * w2;
    let g = SKY_HOR[1] + (SKY_MID[1] - SKY_HOR[1]) * w2;
    let bl = SKY_HOR[2] + (SKY_MID[2] - SKY_HOR[2]) * w2;
    r += (SKY_ZEN[0] - r) * z2;
    g += (SKY_ZEN[1] - g) * z2;
    bl += (SKY_ZEN[2] - bl) * z2;
    if (fr < 0.14) {
      const k = 0.93 + 0.07 * (fr / 0.14);
      r *= k;
      g *= k;
      bl *= k;
    }
    const glow = Math.exp(-(((az - 1.15) / 0.95) ** 2)) * (1 - smooth(0, 0.5, dy));
    const gq = Math.max(0, Math.floor(glow * 3.4 + (wob - 0.5) * 0.9)) / 3.4;
    r += (SKY_GLOW[0] - r) * gq * 0.6;
    g += (SKY_GLOW[1] - g) * gq * 0.6;
    bl += (SKY_GLOW[2] - bl) * gq * 0.6;
    // clouds: two flat washes, a pale thin one and a darker thick core, the pigment pooled
    // darker along the edge of the thin one (streaked out by the wind)
    let ca = 0;
    if (dy > 0.01) {
      const tc = (700 - oy) / dy;
      const wx = ox + dx * tc + 9 * t + 3000;
      const wz = oz + dz * tc + 3 * t + 800;
      const T = this.tex;
      const d = samp(T.cloud, T.N, wx / 520, wz / 190);
      const th = 0.56;
      if (d > th) {
        const hk = smooth(0.01, 0.2, dy);
        if (hk > 0.35) {
          const core = d > th + 0.11;
          const edge = d < th + 0.03;
          const lift = core ? 1.06 : 1.24;
          const em = edge ? 0.86 : 1;
          r = (r * lift + (core ? 5 : 12)) * em;
          g = (g * lift + (core ? 4 : 10)) * em;
          bl = (bl * (lift - 0.03) + (core ? 7 : 16)) * em;
          ca = 1;
        }
      }
    }
    this._ca = ca;
    out[0] = r;
    out[1] = g;
    out[2] = bl;
    return ID_SKY;
  }

  /**
   * The ground at (X, Z), d m from the camera: washes (a cool grass wash with a paler one laid over
   * it in patches, the trampled earth of the camp), the fire's light as a pool in flat bands
   * whose edges wander and breathe with the flames.
   */
  shadeGround(X, Z, d, t, out) {
    const T = this.tex;
    const n1 = samp(T.ground, T.N, X * 0.3 + 40, Z * 0.3 + 17);
    const n2 = samp(T.ground, T.N, X * 1.6, Z * 1.6 + 5);
    const near = 1 - smooth(6, 26, d);
    const rr = Math.sqrt(X * X + Z * Z);
    // grass: a dark wash, a paler one laid over it in patches with a pooled (darker) edge
    const patch = smooth(0.5, 0.53, n1);
    let a0 = GRASS_DARK[0] + (GRASS_PALE[0] - GRASS_DARK[0]) * patch * 0.8;
    let a1 = GRASS_DARK[1] + (GRASS_PALE[1] - GRASS_DARK[1]) * patch * 0.8;
    let a2 = GRASS_DARK[2] + (GRASS_PALE[2] - GRASS_DARK[2]) * patch * 0.8;
    if (patch > 0.04 && patch < 0.96) {
      a0 *= 0.88;
      a1 *= 0.88;
      a2 *= 0.9;
    }
    // the trampled earth of the camp: a wash with a ragged edge, a second layer nearer the fire
    const t0 = rr + (n2 - 0.5) * 2.8;
    const trod = smooth(4.4, 4.15, t0) * 0.6 + smooth(3.1, 2.85, t0) * 0.4;
    const tk = n2 > 0.55 ? 1 : 0.93;
    a0 += (EARTH[0] * tk + (TRAMPLED[0] - EARTH[0]) * (n2 > 0.66 ? 1 : 0) - a0) * trod * 0.92;
    a1 += (EARTH[1] * tk + (TRAMPLED[1] - EARTH[1]) * (n2 > 0.66 ? 1 : 0) - a1) * trod * 0.92;
    a2 += (EARTH[2] * tk + (TRAMPLED[2] - EARTH[2]) * (n2 > 0.66 ? 1 : 0) - a2) * trod * 0.92;
    const soot = smooth(1.05, 0.72, rr + (n2 - 0.5) * 0.4);
    a0 += (SOOT[0] - a0) * soot;
    a1 += (SOOT[1] - a1) * soot;
    a2 += (SOOT[2] - a2) * soot;
    // dry-brush: short darker ticks in the wash near the eye, gone with distance
    if (near > 0.1) {
      const v = valueNoise(X * 8.5, Z * 2.6, 3) * valueNoise(X * 2, Z * 2, 8);
      if (v > 0.42) {
        const k = 0.84 + 0.1 * smooth(0.42, 0.55, 1 - v);
        a0 *= k;
        a1 *= k;
        a2 *= k;
      }
    }
    // the fire's pool in flat bands
    const f = this.fire;
    const dx = X - f.x;
    const dz = Z - f.z;
    const sh = this.shadowAt(X, Z);
    // the pool's edge wanders like a brush's: a slow noise on top of the trodden-earth one
    const wob = valueNoise(X * 0.9 + 5, Z * 0.9 + 9, 27) - 0.5;
    const Ip =
      ((this.k * 1.2) / (1 + (dx * dx + dz * dz + 0.3) / 1.5)) *
      sh *
      (1 + 0.32 * (n2 - 0.5) + 0.6 * wob);
    const Lb =
      0.14 * smooth(0.1, 0.125, Ip) +
      0.14 * smooth(0.18, 0.21, Ip) +
      0.14 * smooth(0.28, 0.32, Ip) +
      0.13 * smooth(0.42, 0.46, Ip) +
      0.1 * smooth(0.62, 0.66, Ip);
    let r = a0 * (AMB[0] + FIRE_C[0] * Lb);
    let g = a1 * (AMB[1] + FIRE_C[1] * Lb);
    let b = a2 * (AMB[2] + FIRE_C[2] * Lb);
    // embers glowing in the ashes under the flames
    if (soot > 0.2) {
      const e = valueNoise(X * 14, Z * 14 + this.t2 * 2.3, 7);
      if (e > 0.72) {
        const k = (e - 0.72) * 3 * soot * this.k;
        r += 120 * k;
        g += 42 * k;
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
    const amp = 1 + 2.6 * (th.energy ?? 0);
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
        this.plotThread(frame, prev, p, a, glow);
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

  plotThread(frame, p0, p1, a, glow) {
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

  /**
   * Light a surface point: albedo A (rgb 0..255), normal n, extra emissive [r, g, b]. With `cel`
   * the fire's light is three flat steps (the way a drawn scene is lit), not a ramp.
   */
  lightSurf(X, Y, Z, nx, ny, nz, A, out, warm = 0, ambK = 1, cel = true) {
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
    let fl = I * (0.18 + 0.82 * lam);
    if (cel)
      fl =
        0.9 *
        (0.38 * smooth(0.05, 0.075, fl) +
          0.34 * smooth(0.16, 0.19, fl) +
          0.28 * smooth(0.36, 0.4, fl));
    const sky = (0.8 + 0.2 * ny) * ambK;
    out[0] = A[0] * (AMB[0] * sky + FIRE_C[0] * fl) + warm * 90;
    out[1] = A[1] * (AMB[1] * sky + FIRE_C[1] * fl) + warm * 34;
    out[2] = A[2] * (AMB[2] * sky + FIRE_C[2] * fl) + warm * 6;
  }

  /**
   * Canvas in the night: the side toward the fire takes a warm band (two flat steps, reaching
   * about 12 m: an artist's reach, more than a real fire's), the far side the cool of the sky,
   * the faces toward the pale east a little lighter than the ones turned away.
   */
  tentTone(X, Y, Z, nx, ny, nz, A, out) {
    const f = this.fire;
    let lx = f.x - X;
    let ly = f.y - Y;
    let lz = f.z - Z;
    const d2 = lx * lx + ly * ly + lz * lz;
    const il = 1 / Math.sqrt(d2 + 1e-6);
    const lam = Math.max(0, (nx * lx + ny * ly + nz * lz) * il);
    const wl = ((this.k * 1.5) / (1 + d2 / 9)) * lam;
    const wb = 0.5 * smooth(0.045, 0.065, wl) + 0.5 * smooth(0.11, 0.14, wl);
    const e = nx * 0.86 + ny * 0.28 - nz * 0.1;
    const ab = smooth(-0.12, 0.1, e);
    // the fire's light washes the sky's blue out of the faces it reaches: warm ones go orange-brown
    // (a colour the palette has), not dusty rose (which it does not)
    const am = (0.78 + 0.6 * ab) * (1 - 0.65 * wb);
    out[0] = A[0] * (AMB[0] * am + FIRE_C[0] * wb * 0.3);
    out[1] = A[1] * (AMB[1] * am + FIRE_C[1] * wb * 0.3);
    out[2] = A[2] * (AMB[2] * am + FIRE_C[2] * wb * 0.3);
  }

  /** A tent's roof height at local (u, v): the ridge sags between its poles, the canvas slopes to the hem. */
  tentRoofY(T, u, v) {
    const r = T.h - T.sag * (1 - (u / T.a) * (u / T.a));
    return r * (1 - Math.abs(v) / T.b);
  }

  drawProps(frame, B) {
    this.drawTents(frame, B);
    this.drawBoxes(frame, B);
    this.drawLogs(frame, B);
    this.drawCylinders(frame, B);
    this.drawStones(frame, B);
    for (const T of this.tents) this.tentLines(frame, T);
  }

  drawTents(frame, B) {
    const cam = this.cam;
    const { W } = this;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const c = new Float64Array(3);
    for (const T of this.tents) {
      const [bx0, by0, bx1, by1] = this.boxOf(cam, T.corners);
      if (bx0 >= bx1 || by0 >= by1) continue;
      // the ray in the tent's local frame (u along the ridge, y up, v across)
      const lox = ox - T.x;
      const loz = oz - T.z;
      const lo = [lox * T.c + loz * T.s, oy, -lox * T.s + loz * T.c];
      const reach = 2 * (T.L + T.w + T.h);
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          const ld = [dx * T.c + dz * T.s, dy, -dx * T.s + dz * T.c];
          // convex prism bounds the search: clip the ray against its planes
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
          let th = t0;
          if (face <= 1) {
            // the roof is the sagged surface inside the prism: march to it, then bisect
            const tEnd = Math.min(t1, t0 + reach);
            let tp = t0;
            let hit = false;
            const NS = 14;
            for (let k = 1; k <= NS && !hit; k++) {
              const tk = t0 + ((tEnd - t0) * k) / NS;
              if (lo[1] + ld[1] * tk <= this.tentRoofY(T, lo[0] + ld[0] * tk, lo[2] + ld[2] * tk)) {
                let a = tp;
                let b = tk;
                for (let q = 0; q < 6; q++) {
                  const m = (a + b) * 0.5;
                  if (lo[1] + ld[1] * m <= this.tentRoofY(T, lo[0] + ld[0] * m, lo[2] + ld[2] * m))
                    b = m;
                  else a = m;
                }
                th = b;
                hit = true;
              }
              tp = tk;
            }
            if (!hit) continue;
          }
          const depth = th * this.cf[i];
          if (depth >= this.zbuf[i]) continue;
          const hu = lo[0] + ld[0] * th;
          const hy = lo[1] + ld[1] * th;
          const hv = lo[2] + ld[2] * th;
          // the normal in local coords: the sagged roof's gradient, or the gable's plane
          let nu;
          let ny = 0;
          let nv = 0;
          if (face <= 1) {
            const Ru = T.h - T.sag * (1 - (hu / T.a) * (hu / T.a));
            const dRu = (T.sag * 2 * hu) / (T.a * T.a);
            const kv = 1 - Math.abs(hv) / T.b;
            nu = -dRu * kv;
            ny = 1;
            nv = (Ru * (hv > 0 ? 1 : -1)) / T.b;
            const nl = Math.hypot(nu, ny, nv);
            nu /= nl;
            ny /= nl;
            nv /= nl;
          } else nu = face === 2 ? -1 : 1;
          const nx = nu * T.c - nv * T.s;
          const nz = nu * T.s + nv * T.c;
          const X = ox + dx * th;
          const Z = oz + dz * th;
          const far = smooth(18, 60, depth);
          // canvas: panels stitched along the ridge, radiating folds from the pole tips where it
          // sags, a mud-splashed hem
          const pan = Math.floor((hu + T.a) / 0.66);
          const pf = (hu + T.a) / 0.66 - pan;
          let sh = 0.93 + 0.13 * hash(pan, T.i, 91);
          if (face <= 1) {
            if (pf < 0.05 || pf > 0.95) sh *= 0.74;
            const nearEnd = Math.min(T.a - Math.abs(hu), 1.6);
            const dpole = Math.min(Math.abs(hu + T.a), Math.abs(hu - T.a));
            const qq = Math.abs(hv) / (dpole + 0.14);
            const ph = qq / 0.46;
            const fold = 1 - smooth(0, 0.13, Math.abs(ph - Math.round(ph)));
            sh *= 1 - 0.2 * fold * Math.exp(-dpole / 0.9) * (0.4 + 0.6 * (1 - far));
            void nearEnd;
          }
          sh *= 0.94 + 0.09 * valueNoise(hu * 1.6 + T.i * 9, hy * 1.9 + hv * 1.3, 4);
          const hemH = 0.15 + 0.05 * Math.sin(hu * 6.5 + T.i);
          if (hy < hemH) sh *= 0.72;
          let idv = ID_TENT + T.i;
          if (face === 2) {
            // the door end: an open flap on one tent (a dark opening, the flaps tied back), a
            // laced seam on the rest
            if (T.open) {
              const dw = T.b * 0.46 * (1 - hy / (T.h * 0.88));
              if (hy < T.h * 0.88 && Math.abs(hv) < dw) {
                const k = 0.1 + 0.08 * (1 - hy / T.h);
                this.lightSurf(X, hy, Z, nx, ny, nz, CANVAS, c, 0.03);
                frame[i * 4] = 18 + c[0] * 0.06 + k * 46;
                frame[i * 4 + 1] = 15 + c[1] * 0.05 + k * 22;
                frame[i * 4 + 2] = 26 + c[2] * 0.06 + k * 12;
                this.ids[i] = ID_TENT + 25 + T.i;
                this.zbuf[i] = depth;
                this.ink[i] = 1;
                this.sky[i] = 0;
                continue;
              }
              if (hy < T.h * 0.88 && Math.abs(hv) < dw + 0.34 * T.b) sh *= 0.8; // the folded flap
            } else if (Math.abs(hv) < 0.035 + 0.02 * (1 - hy / T.h) && hy < T.h * 0.85) sh *= 0.66; // the closed flap's seam
          }
          const A = [CANVAS[0] * sh, CANVAS[1] * sh, CANVAS[2] * sh];
          this.tentTone(X, hy, Z, nx, ny, nz, A, c);
          // aerial perspective
          const hz = smooth(20, 120, depth) * 0.45;
          frame[i * 4] = c[0] + (HAZE[0] - c[0]) * hz;
          frame[i * 4 + 1] = c[1] + (HAZE[1] - c[1]) * hz;
          frame[i * 4 + 2] = c[2] + (HAZE[2] - c[2]) * hz;
          this.ids[i] = idv;
          this.zbuf[i] = depth;
          this.ink[i] = 1;
          this.sky[i] = 0;
        }
    }
  }

  /**
   * A tent's drawn lines, in ink on the world's own edges: the sagging ridge, the rafters of the
   * gable ends, the scalloped hem, the pole tips, a guy rope to its peg from each pole. Depth-tested
   * against the tents (a line behind the canvas is not drawn); thicker and darker near the
   * eye, thin and pale in the distance; the line breaks in places (lost) and swells in others.
   */
  tentLines(frame, T) {
    const { W, H } = this;
    const cam = this.cam;
    const wp = (u, y, v) => {
      const X = T.x + u * T.c - v * T.s;
      const Z = T.z + u * T.s + v * T.c;
      const p = project(cam, X, y, Z, W, H);
      return p;
    };
    const mid = wp(0, T.h * 0.5, 0);
    if (mid.depth < 0.4) return;
    const dist = mid.depth;
    const near = 1 - smooth(10, 40, dist);
    const wNear = dist < 9 ? 2.2 : dist < 18 ? 1.6 : 1;
    const inkA = 0.55 + 0.4 * near;
    const col = [INKC[0] + 10, INKC[1] + 8, INKC[2] + 12];
    const bias = 0.06;
    const line = (pts, wb, gap, id) => {
      for (let s = 1; s < pts.length; s++) {
        const p0 = pts[s - 1];
        const p1 = pts[s];
        if (p0.depth < 0.3 || p1.depth < 0.3) continue;
        if (gap && hash(Math.floor(s / 2), T.i, id) < gap) continue;
        // the pen presses in the middle of a stroke and lifts at its ends
        const k = s / pts.length;
        const w = wb * (0.55 + 0.6 * Math.sin(Math.PI * k) ** 0.6);
        this.strokeZ(
          frame,
          p0.sx,
          p0.sy,
          p1.sx,
          p1.sy,
          w,
          w,
          col,
          p0.depth - bias * (1 + 0.02 * p0.depth),
          p1.depth - bias * (1 + 0.02 * p1.depth),
          ID_GRASS,
          inkA,
          false,
        );
      }
    };
    const N = 22;
    // the ridge, with its sag
    const ridge = [];
    for (let s = 0; s <= N; s++) {
      const u = -T.a + (2 * T.a * s) / N;
      ridge.push(wp(u, T.h - T.sag * (1 - (u / T.a) * (u / T.a)), 0));
    }
    line(ridge, wNear * 1.1, 0.06, 71);
    // the gable rafters and the hem
    for (const e of [-1, 1]) {
      for (const sd of [-1, 1]) {
        const apex = wp(e * T.a, T.h, 0);
        const foot = wp(e * T.a, 0, sd * T.b);
        line([apex, foot], wNear * 0.8, 0.1, 72 + e + sd);
      }
    }
    for (const sd of [-1, 1]) {
      const hem = [];
      for (let s = 0; s <= N; s++) {
        const u = -T.a + (2 * T.a * s) / N;
        // the hem lifts a little between pegs
        hem.push(wp(u, 0.02 + 0.045 * Math.abs(Math.sin((u + T.a) * 2.6)), sd * T.b));
      }
      line(hem, wNear * 0.9, 0.16, 75 + sd);
    }
    // pole tips and guy ropes
    if (dist < 45) {
      const rc = [80, 60, 60];
      for (const e of [-1, 1]) {
        const top = wp(e * T.a, T.h, 0);
        const tip = wp(e * T.a, T.h + 0.3, 0);
        if (top.depth > 0.3 && tip.depth > 0.3)
          this.strokeZ(
            frame,
            top.sx,
            top.sy,
            tip.sx,
            tip.sy,
            Math.max(1, wNear * 0.7),
            1,
            col,
            top.depth - 0.06,
            top.depth - 0.06,
            ID_GRASS,
            inkA,
            false,
          );
        const peg = wp(e * (T.a + T.rope), 0, 0);
        if (peg.depth > 0.3 && top.depth > 0.3) {
          // the rope: a thin taut line (a hair of pale cord over the ink), a peg driven at its foot
          this.strokeZ(
            frame,
            top.sx,
            top.sy,
            peg.sx,
            peg.sy,
            1,
            1,
            rc,
            top.depth - 0.06,
            peg.depth - 0.06,
            ID_GRASS,
            0.85,
            false,
          );
          const px = Math.round(peg.sx);
          const py = Math.round(peg.sy);
          this.bpx(
            frame,
            px,
            py - 1,
            peg.depth - 0.06,
            col[0],
            col[1],
            col[2],
            ID_GRASS,
            false,
            inkA,
          );
          this.bpx(frame, px, py, peg.depth - 0.06, col[0], col[1], col[2], ID_GRASS, false, inkA);
        }
      }
    }
  }

  drawBoxes(frame, B) {
    const cam = this.cam;
    const { W } = this;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const c = new Float64Array(3);
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
          const grain =
            0.86 +
            0.24 * valueNoise(lo[0] * 9 + ld[0] * t0 * 9 + Bx.x * 7, (lo[2] + ld[2] * t0) * 21, 5);
          const A = [WOOD[0] * grain, WOOD[1] * grain, WOOD[2] * grain];
          this.lightSurf(X, Y, Z, nx, ny, nz, A, c, 0);
          frame[i * 4] = c[0];
          frame[i * 4 + 1] = c[1];
          frame[i * 4 + 2] = c[2];
          this.ids[i] = ID_PROP;
          this.zbuf[i] = depth;
          this.ink[i] = 1;
          this.sky[i] = 0;
        }
    }
  }

  /**
   * The fire's logs: charred cylinders lying across each other and leaning in. Black bark with
   * cracks that glow red where the heat is (deepest in the middle), the cut ends pale ash ringed
   * with coals.
   */
  drawLogs(frame, B) {
    const cam = this.cam;
    const { W } = this;
    const F = this.fire;
    const ox = B.ox - F.x;
    const oy = B.oy;
    const oz = B.oz - F.z;
    const c = new Float64Array(3);
    for (let li = 0; li < this.logs.length; li++) {
      const L = this.logs[li];
      const pts = [];
      for (const q of [L.p0, L.p1])
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          pts.push([F.x + q[0] + a * L.r, q[1] + (b > 0 ? L.r : -L.r), F.z + q[2] + a * L.r]);
      const [bx0, by0, bx1, by1] = this.boxOf(cam, pts, 1);
      if (bx0 >= bx1 || by0 >= by1) continue;
      const ab = L.ab;
      const abab = L.abab;
      const ao = [ox - L.p0[0], oy - L.p0[1], oz - L.p0[2]];
      const abao = ab[0] * ao[0] + ab[1] * ao[1] + ab[2] * ao[2];
      const aoao = ao[0] * ao[0] + ao[1] * ao[1] + ao[2] * ao[2];
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          const abd = ab[0] * dx + ab[1] * dy + ab[2] * dz;
          const aod = ao[0] * dx + ao[1] * dy + ao[2] * dz;
          const A = abab - abd * abd;
          const Bq = abab * aod - abao * abd;
          const C = abab * aoao - abao * abao - L.r * L.r * abab;
          const h = Bq * Bq - A * C;
          if (h < 0 || A < 1e-9) continue;
          let t0 = (-Bq - Math.sqrt(h)) / A;
          let yy = abao + t0 * abd;
          let cap = false;
          if (yy < 0 || yy > abab) {
            // the cut end: the plane at that end, inside the radius
            const tc = ((yy < 0 ? 0 : abab) - abao) / abd;
            const px = ao[0] + tc * dx - (ab[0] * (yy < 0 ? 0 : abab)) / abab;
            const py = ao[1] + tc * dy - (ab[1] * (yy < 0 ? 0 : abab)) / abab;
            const pz = ao[2] + tc * dz - (ab[2] * (yy < 0 ? 0 : abab)) / abab;
            if (Math.abs(abd) < 1e-9 || px * px + py * py + pz * pz > L.r * L.r) continue;
            t0 = tc;
            cap = true;
            yy = yy < 0 ? 0 : abab;
          }
          if (t0 < 0.05) continue;
          const depth = t0 * this.cf[i];
          if (depth >= this.zbuf[i]) continue;
          const X = ox + dx * t0;
          const Y = oy + dy * t0;
          const Z = oz + dz * t0;
          // the normal: out from the axis, or along it at a cut end
          let nx;
          let ny;
          let nz;
          const s = yy / abab;
          if (cap) {
            const sg = s <= 0 ? -1 : 1;
            const il = 1 / Math.sqrt(abab);
            nx = sg * ab[0] * il;
            ny = sg * ab[1] * il;
            nz = sg * ab[2] * il;
          } else {
            nx = (ao[0] + t0 * dx - ab[0] * s) / L.r;
            ny = (ao[1] + t0 * dy - ab[1] * s) / L.r;
            nz = (ao[2] + t0 * dz - ab[2] * s) / L.r;
          }
          // heat: strongest near the middle of the fire, on the faces that look into it
          const rad = Math.hypot(X - F.x, Z - F.z);
          const heat = (1 - smooth(0.05, 0.42, rad)) * this.k;
          const ang = Math.atan2(ny, nx + nz * 0.3);
          const crack =
            valueNoise(s * 14 + li * 5, ang * 2.4 + li, 5) * 0.7 +
            valueNoise(s * 31, ang * 5, 9) * 0.3;
          let em = 0;
          if (cap) em = 0.55 * heat;
          else if (crack > 0.55) em = smooth(0.55, 0.68, crack) * (0.25 + 0.75 * heat);
          const bark = 0.8 + 0.4 * valueNoise(s * 20 + li * 3, ang * 4, 12);
          const Abark = cap ? [110, 96, 92] : [46 * bark, 34 * bark, 36 * bark];
          this.lightSurf(X, Y, Z, nx, ny, nz, Abark, c, 0);
          // coals glow red-orange, never yellow
          frame[i * 4] = c[0] + 190 * em;
          frame[i * 4 + 1] = c[1] + 62 * em;
          frame[i * 4 + 2] = c[2] + 16 * em;
          this.ids[i] = ID_PROP + 2 + li;
          this.zbuf[i] = depth;
          this.ink[i] = 0;
          this.sky[i] = 0;
        }
    }
  }

  /** Stumps and barrels: vertical cylinders with a top. */
  drawCylinders(frame, B) {
    const cam = this.cam;
    const { W } = this;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const c = new Float64Array(3);
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
          let k = 0.88 + 0.24 * valueNoise(Math.atan2(nz, nx) * 5 + Cy.x, Y * 6, 3);
          if (Cy.kind === 'barrel' && !top) {
            const hb = Y / Cy.h;
            if (Math.abs(hb - 0.18) < 0.045 || Math.abs(hb - 0.82) < 0.045) k *= 0.55; // hoops
          }
          if (top && Cy.kind === 'stump') {
            // rings on the cut top
            k *= 0.9 + 0.16 * Math.sin(Math.hypot(X - Cy.x, Z - Cy.z) * 34);
            A = [150, 118, 96];
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
  }

  /**
   * A stone's ray test: an ellipsoid cut by planes (a flat crown and facets, as world.js's stones)
   * in its own unit-sphere frame. Returns t (or Infinity) and sets this._sn (local normal),
   * this._flat and this._edge (how far the entry face's edge is from the next: a crack under a
   * pixel wide).
   */
  stoneHit(s, lx, ly, lz, ex, ey, ez) {
    const A = ex * ex + ey * ey + ez * ez;
    const Bq = 2 * (lx * ex + ly * ey + lz * ez);
    const Cq = lx * lx + ly * ly + lz * lz - 1;
    const disc = Bq * Bq - 4 * A * Cq;
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    let tE = (-Bq - sq) / (2 * A);
    let tX = (-Bq + sq) / (2 * A);
    let fk = -1;
    let t2 = -Infinity;
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
      } else if (num < 0) return Infinity;
    }
    if (tE > tX) return Infinity;
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
    return tE;
  }

  /**
   * Stones (faceted ellipsoids resting on the ground) and bedrolls. Flat washes by facet (lit,
   * mid, shadow), a crack of ink where two facets meet; the ring's stones are blackened with soot
   * on the side toward the flames, the coals lighting their top edge red.
   */
  drawStones(frame, B) {
    const cam = this.cam;
    const { W } = this;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const c = new Float64Array(3);
    if (!this._sn) this._sn = new Float64Array(3);
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
      const rr = Math.hypot(St.x, St.z) || 1;
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          const i = y * W + x;
          const dx = this.rdx[i];
          const dy = this.rdy[i];
          const dz = this.rdz[i];
          const du = (dx * cs + dz * sn) / St.a;
          const dv = (-dx * sn + dz * cs) / St.c;
          const dyy = dy / St.b;
          const t0 = this.stoneHit(St, ou, oyy, ov, du, dyy, dv);
          if (!(t0 > 0.05) || t0 === Infinity) continue;
          const Y = oy + dy * t0;
          if (Y < 0) continue;
          const depth = t0 * this.cf[i];
          if (depth >= this.zbuf[i]) continue;
          // local normal -> world (the gradient of the implicit form, then the yaw)
          let nu = this._sn[0] / St.a;
          let nyy = this._sn[1] / St.b;
          let nv = this._sn[2] / St.c;
          const nl = Math.hypot(nu, nyy, nv) || 1;
          nu /= nl;
          nyy /= nl;
          nv /= nl;
          const nx = nu * cs - nv * sn;
          const nz = nu * sn + nv * cs;
          const X = ox + dx * t0;
          const Z = oz + dz * t0;
          const crack =
            this._flat === 1 && this._edge * Math.min(St.a, St.b, St.c) < (1.1 * depth) / this.B.F;
          const base = St.bed ? [92, 80, 78] : STONE;
          const tone = 0.82 + 0.34 * valueNoise(X * 3 + 11, Z * 3 + Y * 3, 6);
          let A0 = [base[0] * tone, base[1] * tone, base[2] * tone];
          let warm = 0;
          if (St.ring) {
            // toward the fire (inward) the stone is black with soot; a red line of coal light
            // sits on the top edge; the outer side keeps its grey
            const inward = (-nx * St.x - nz * St.z) / rr;
            const soot = smooth(-0.15, 0.5, inward);
            A0 = [
              A0[0] + (26 - A0[0]) * soot * 0.85,
              A0[1] + (22 - A0[1]) * soot * 0.85,
              A0[2] + (28 - A0[2]) * soot * 0.85,
            ];
            warm = 0.2 * this.k * smooth(0.2, 0.9, nyy) * smooth(-0.1, 0.4, inward);
          }
          this.lightSurf(X, Y, Z, nx, nyy, nz, A0, c, warm);
          if (crack) {
            c[0] = c[0] * 0.35 + INKC[0] * 0.65;
            c[1] = c[1] * 0.35 + INKC[1] * 0.65;
            c[2] = c[2] * 0.35 + INKC[2] * 0.65;
          }
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

  /**
   * Ink on the nearer side of every edge between solid things: a fine line where a thing meets
   * the ground or the sky, heavier for near and dark things, breaking in places (lost) and
   * swelling in others (found). Far things are drawn thinner and paler.
   */
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
          // sky and ridges are inked at their crests (background()); ground against an object is
          // the object's foot
          if (ids[near] < 30) continue;
          if (ids[near] >= ID_TENT && ids[near] < ID_PROP && ids[far] === ids[near]) continue;
          const px = near % W;
          const py = (near / W) | 0;
          if (hash(px >> 1, py >> 1, 17) < 0.14) continue; // the line breaks in places
          const d = zb[near];
          const k = 0.8 - 0.35 * smooth(14, 50, d);
          const o = near * 4;
          frame[o] = frame[o] * (1 - k) + INKC[0] * k;
          frame[o + 1] = frame[o + 1] * (1 - k) + INKC[1] * k;
          frame[o + 2] = frame[o + 2] * (1 - k) + INKC[2] * k;
        }
      }
  }

  /**
   * The vellum's tooth shows through every wash: pigment settles darker in the valleys of the
   * paper. Strongest in the sky and the far ground, lighter where the fire's light has bleached
   * the wash; drawings and effects are left clean.
   */
  paperGrain(frame) {
    const n = this.W * this.H;
    const g = this.grain;
    for (let i = 0; i < n; i++) {
      const id = this.ids[i];
      if (id >= ID_FX) continue;
      const o = i * 4;
      // brighter pixels lose some of it (the light lifts the wash off the tooth)
      const lum = (frame[o] + frame[o + 1] + frame[o + 2]) / 765;
      // canvas takes less (a big flat mid-tone between two palette colours turns to noise)
      const tent = id >= ID_TENT && id < ID_PROP ? 0.5 : 1;
      const k = (0.16 - 0.08 * Math.min(1, lum * 2.2)) * (id === ID_SKY ? 0.9 : 1) * tent;
      const m = 1 + k * g[i];
      frame[o] *= m;
      frame[o + 1] *= m;
      frame[o + 2] *= m;
    }
  }
}

Object.assign(CampWorld.prototype, billboardMethods);
