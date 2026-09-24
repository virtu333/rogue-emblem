// hollowSun.js — "The Hollow Sun" procedural title key art (pure Canvas2D, no Phaser).
//
// The goddess's name was not forgotten; it was spent. The sky keeps the hole where she
// was: a black disc with a thin gold corona. From a diamond-ring bead on its rim, Sera's
// gold threads (the rewoven timelines, i.e. the player's runs) arc down to a lone
// figure on a promontory. One severed thread hangs loose. Below: a ruined old-kingdom
// keep draped in imperial crimson, the border quarries with the Empire's standards on
// the rim, and a ring of standing stones (the sacred ground) in the valley mist.
//
// Rendering: one wide low-res plate (PLATE_W x PLATE_H) built from the palette ramps
// below with ordered (Bayer 4x4) dithering. Static layers are rasterised once into
// offscreen canvases (sky / land / foreground); per frame only cheap things animate:
// corona shimmer (prebaked frames), thread glints, bead flare, banner + cape flutter,
// drifting mist, crows, ash, gold motes, star twinkle. Deterministic for a given seed.
//
// Usage:
//   const scene = createHollowSunScene({ seed: 7, variant: 'dusk', reducedMotion });
//   scene.render(plateCtx, timeMs);          // raw 424x240 plate; caller scales it, or
//   scene.draw(ctx, timeMs, viewW, viewH);   // cover-crop + nearest-neighbour blit
//   scene.frame(viewW, viewH)                // -> { sx, sy, sw, sh, scale } crop maths
//   scene.toView(px, py, frame)              // plate coords -> view coords (for DOM/UI)
//
// Cropping: 844x390 (phone landscape) sees the full width at 2x (422x195); 640x480
// sees the full height at 2x (320x240). Everything important sits inside their
// intersection (plate x 52..372, y 20..215). The upper-left sky is kept calm for the
// title lockup; the dark foreground band is kept calm for menus.

export const PLATE_W = 424;
export const PLATE_H = 240;

// ---------------------------------------------------------------------------
// Palette (the only colours this module is allowed to emit)
// ---------------------------------------------------------------------------
export const PALETTE = {
  ink: [
    '#07060b',
    '#0e0c14',
    '#16131e',
    '#211d2b',
    '#2e293a',
    '#403949',
    '#58505e',
    '#766b77',
    '#978b94',
    '#bdb0aa',
    '#ddd0bd',
    '#f4ecdb',
  ],
  ember: ['#2a170e', '#4f2c16', '#80461f', '#b3702c', '#dca044', '#f3cb6c', '#fff0bd'],
  blood: ['#22090f', '#44111c', '#6e1a28', '#9e2632', '#cc4038', '#ec7a5c'],
  steel: ['#101a2e', '#1c2f4f', '#2c4c77', '#4574a0', '#77a5c6', '#b8d8e6'],
  verdigris: ['#0f2622', '#1b4239', '#2d6450', '#4d8b66', '#86b27b', '#c3d69a'],
  unlight: ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'],
};

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Pack '#rrggbb' as an opaque pixel for a Uint32 view over ImageData (RGBA bytes). */
function pack(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return LITTLE_ENDIAN
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

const INK = PALETTE.ink.map(pack);
const EMB = PALETTE.ember.map(pack);
const STL = PALETTE.steel.map(pack);
const UNL = PALETTE.unlight.map(pack);

// Sky ramp: violet zenith -> mauve -> rose-grey horizon (monotonic value).
const SKY = [
  INK[0],
  INK[1],
  UNL[0],
  UNL[1],
  INK[4],
  INK[5],
  INK[6],
  INK[7],
  INK[8],
  INK[9],
  INK[10],
  INK[11],
];
// Alternate night ramp: steel-blue zenith for the colder "ashfall" hour.
const SKY_STEEL = [
  INK[0],
  INK[1],
  STL[0],
  STL[1],
  INK[4],
  INK[5],
  INK[6],
  INK[7],
  INK[8],
  INK[9],
  INK[10],
  INK[11],
];
// Reverse lookup so animated fillRect calls can reuse the packed palette.
const HEX_OF = new Map();
for (const ramp of Object.values(PALETTE)) for (const h of ramp) HEX_OF.set(pack(h), h);

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function makeNoise(seed) {
  const s = seed | 0;
  const sm = (f) => f * f * (3 - 2 * f);
  const n1 = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash2(i, 0, s);
    const b = hash2(i + 1, 0, s);
    return a + (b - a) * sm(f);
  };
  const n2 = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = sm(x - ix);
    const fy = sm(y - iy);
    const a = hash2(ix, iy, s);
    const b = hash2(ix + 1, iy, s);
    const c = hash2(ix, iy + 1, s);
    const d = hash2(ix + 1, iy + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm1 = (x, oct = 4) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      v += amp * n1(x * f + o * 17.3);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return v / norm;
  };
  const fbm2 = (x, y, oct = 4) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      v += amp * n2(x * f + o * 11.1, y * f - o * 7.7);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return v / norm;
  };
  // Ridged 1D noise: sharp peaks, soft valleys.
  const ridge1 = (x, oct = 4) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      const r = 1 - Math.abs(n1(x * f + o * 5.1) * 2 - 1);
      v += amp * r * r;
      norm += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return v / norm;
  };
  return { n1, n2, fbm1, fbm2, ridge1 };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Ordered-dither a continuous ramp position L onto a discrete ramp. */
function pick(ramp, L, x, y) {
  let i = Math.floor(L);
  if (L - i > bayer(x, y)) i++;
  return ramp[clamp(i, 0, ramp.length - 1)];
}

// ---------------------------------------------------------------------------
// Raster: a Uint32 pixel buffer that becomes an offscreen canvas.
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h);
  }
  set(x, y, c) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x, y) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  toCanvas() {
    const cv = makeCanvas(this.w, this.h);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.px);
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

/** Pixel-perfect polyline along a sampled curve (no doubled L-corners). */
function curvePixels(fn, steps = 600) {
  const out = [];
  let last = null;
  for (let i = 0; i <= steps; i++) {
    const [fx, fy] = fn(i / steps);
    const x = Math.round(fx);
    const y = Math.round(fy);
    if (last && last[0] === x && last[1] === y) continue;
    // fill gaps with a simple DDA if the sampler skipped
    if (last && (Math.abs(x - last[0]) > 1 || Math.abs(y - last[1]) > 1)) {
      const n = Math.max(Math.abs(x - last[0]), Math.abs(y - last[1]));
      for (let k = 1; k < n; k++) {
        out.push([
          Math.round(last[0] + ((x - last[0]) * k) / n),
          Math.round(last[1] + ((y - last[1]) * k) / n),
        ]);
      }
    }
    out.push([x, y]);
    last = [x, y];
  }
  // remove L-corners
  const clean = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const a = clean[clean.length - 1];
    const b = out[i + 1];
    if (
      a &&
      b &&
      Math.abs(a[0] - b[0]) === 1 &&
      Math.abs(a[1] - b[1]) === 1 &&
      (p[0] === a[0] || p[1] === a[1])
    )
      continue;
    clean.push(p);
  }
  return clean;
}

/** Clean 1px midpoint circle, as offsets from the centre (8-connected, no doubles). */
function circlePixels(r) {
  const seen = new Set();
  const out = [];
  const add = (x, y) => {
    const k = `${x},${y}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push([x, y]);
    }
  };
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [a, b] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ])
      add(a, b);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
  return out;
}

const angDiff = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

function bezier(p0, p1, p2, p3) {
  return (t) => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
  };
}

// ---------------------------------------------------------------------------
// Composition (plate space). Crop intersection (always visible): x 52..372, y 20..215.
// ---------------------------------------------------------------------------
const VARIANTS = {
  // Default: totality at dusk. All-round horizon glow, violet zenith, sun upper-right.
  dusk: {
    sun: { x: 292, y: 68, r: 22 },
    horizon: 172,
    zenith: 0.5,
    horizonL: 8.5,
    skyCurve: 2.3,
    haloL: 3.2,
    streamerL: 3.4,
    glowBandL: 1.0,
    stars: 90,
    ash: 70,
    motes: 6,
  },
  // Ashfall: later, colder, heavier ash; the glow has sunk to a thin line.
  ashfall: {
    sky: 'steel',
    sun: { x: 292, y: 62, r: 22 },
    horizon: 172,
    zenith: 0.15,
    horizonL: 7.2,
    skyCurve: 2.9,
    haloL: 3.4,
    streamerL: 3.8,
    glowBandL: 0.7,
    stars: 150,
    ash: 170,
    ashBright: true,
    motes: 8,
  },
  // Alternate composition: a vast hollow sun rising behind the quarry hill, very close
  // to the figure. More monumental, less sky for the lockup.
  rising: {
    sun: { x: 318, y: 124, r: 40 },
    // hangs from the upper-right rim and drifts clear of the disc and the fate threads
    severed: {
      at: 302,
      path: [
        [12, 4],
        [24, 16],
        [25, 34],
      ],
    },
    horizon: 172,
    zenith: 0.4,
    horizonL: 8.2,
    skyCurve: 2.2,
    haloL: 3.0,
    streamerL: 3.2,
    glowBandL: 0.9,
    stars: 110,
    ash: 70,
    motes: 6,
  },
};

const FIGURE_FEET = { x: 172, y: 171 };

// Lone figure, seen from behind: one arm raised to the hollow sun, cape streaming
// right on the wind. Three frames differ only in the cape tail.
// '#' silhouette, 'h' hand (where the threads converge).
const FIGURE_BODY = [
  '...........h....',
  '..........#.....',
  '..........#.....',
  '.........#......',
  '....##...#......',
  '...####..#......',
  '...####.#.......',
  '....##..#.......',
  '..#######.......',
  '..#########.....',
  '..###########...',
];
const FIGURE_CAPE = [
  [
    '...###########..',
    '...####.#######.',
    '...###....######',
    '...###......###.',
    '...###.......#.#',
  ],
  [
    '...###########..',
    '...####.########',
    '...###....#####.',
    '...###......####',
    '...###........#.',
  ],
  [
    '...############.',
    '...####.#######.',
    '...###....#####.',
    '...###.....####.',
    '...###......#..#',
  ],
];
const FIGURE_LEGS = [
  '...##.#.........',
  '...##.#.........',
  '...##.#.........',
  '...##..#........',
  '...##..#........',
  '..###..##.......',
];
const FIGURE_FRAMES = FIGURE_CAPE.map((cape) => [...FIGURE_BODY, ...cape, ...FIGURE_LEGS]);
const FIGURE_W = 16;
const FIGURE_H = FIGURE_FRAMES[0].length;

// ---------------------------------------------------------------------------
// Scene factory
// ---------------------------------------------------------------------------
export function createHollowSunScene(opts = {}) {
  const seed = (opts.seed ?? 7) >>> 0;
  const V = { ...(VARIANTS[opts.variant] ?? VARIANTS.dusk) };
  let reducedMotion = !!opts.reducedMotion;
  const frozenTime = opts.frozenTime ?? 5200;
  const W = PLATE_W;
  const H = PLATE_H;
  const SUN = V.sun;
  const HZ = V.horizon;
  const SKYR = V.sky === 'steel' ? SKY_STEEL : SKY;

  const noise = makeNoise(seed * 31 + 1);
  const rng = mulberry32(seed * 7919 + 3);

  // Figure + hand are fixed by the sprite; the diamond-ring bead faces the hand.
  const figOrigin = { x: FIGURE_FEET.x - 4, y: FIGURE_FEET.y - FIGURE_H };
  const hand = (() => {
    for (let j = 0; j < FIGURE_BODY.length; j++) {
      const i = FIGURE_BODY[j].indexOf('h');
      if (i >= 0) return { x: figOrigin.x + i, y: figOrigin.y + j };
    }
    return { x: figOrigin.x, y: figOrigin.y };
  })();
  const toHand = Math.atan2(hand.y - SUN.y, hand.x - SUN.x);
  const beadAng = toHand - (10 * Math.PI) / 180;
  const bead = {
    x: Math.round(SUN.x + Math.cos(beadAng) * SUN.r),
    y: Math.round(SUN.y + Math.sin(beadAng) * SUN.r),
  };
  const sr = SUN.r / 22; // corona scale relative to the reference sun

  // ============================================================ geometry
  // Far ranges part around the figure so the brightest glow sits behind its head.
  const farA = new Float32Array(W);
  const farB = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const dip = 1 - 0.8 * Math.exp(-(((x - FIGURE_FEET.x - 4) / 24) ** 2));
    farA[x] = HZ - 4 - dip * (noise.ridge1(x * 0.011 + 2.3) * 30 + noise.fbm1(x * 0.06) * 4);
    farB[x] = HZ + 3 - dip * (noise.ridge1(x * 0.02 + 8.1) * 20 + noise.fbm1(x * 0.11 + 5) * 3);
  }

  // Mid layer: keep hill (left), valley + sacred ground (centre), quarry hill (right).
  const midTop = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let y;
    if (x < 40) y = 158;
    else if (x < 156)
      y = 160 - Math.sin(((x - 40) / 116) * Math.PI) ** 0.7 * 13 + smooth(96, 156, x) * 6;
    else if (x < 244) y = 170 + smooth(156, 200, x) * 16 + (noise.fbm1(x * 0.1) - 0.5) * 2;
    else
      y =
        186 -
        smooth(244, 312, x) * 42 -
        Math.sin((clamp(x - 312, 0, 112) / 112) * Math.PI) * 4 +
        (noise.fbm1(x * 0.06 + 30) - 0.5) * 7;
    midTop[x] = y + (noise.n1(x * 0.6 + 40) - 0.5) * 1.4;
  }

  // Foreground: left crag, the figure's promontory, a cliff, low right rise.
  const fgTop = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let y;
    if (x < 46) y = 128 + smooth(0, 46, x) * 60;
    else if (x < 96) y = 188 + Math.sin(((x - 46) / 50) * Math.PI) * 3;
    else if (x < 156) y = 190 - smooth(96, 156, x) * 19;
    else if (x < 190) y = 171;
    else if (x < 212) y = 171 + smooth(190, 212, x) * 55;
    else if (x < 330) y = 227;
    else y = 227 - smooth(330, 424, x) * 24;
    const rough = (noise.fbm1(x * 0.08 + 3) - 0.5) * 6 + (noise.n1(x * 0.55) - 0.5) * 1.5;
    const calm = x > 158 && x < 188 ? 0.15 : 1;
    fgTop[x] = y + rough * calm;
  }

  // Corona streamer profile: angular amplitude + reach.
  const STREAM_N = 360;
  const streamAmp = new Float32Array(STREAM_N);
  const streamLen = new Float32Array(STREAM_N);
  {
    const axis = -0.35; // elongated "equatorial" corona
    const peaks = [];
    for (let i = 0; i < 14; i++) {
      const along = i < 6;
      const ang = along ? axis + (i % 2 ? Math.PI : 0) + (rng() - 0.5) * 0.5 : rng() * Math.PI * 2;
      peaks.push({
        a: ang,
        w: 0.05 + rng() * 0.16,
        amp: along ? 0.8 + rng() * 0.4 : 0.35 + rng() * 0.4,
        len: (along ? 26 + rng() * 26 : 10 + rng() * 14) * sr,
      });
    }
    for (let i = 0; i < STREAM_N; i++) {
      const a = (i / STREAM_N) * Math.PI * 2;
      let amp = 0.18;
      let len = 8 * sr;
      for (const p of peaks) {
        let d = Math.abs(a - p.a) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        const g = Math.exp(-((d / p.w) ** 2));
        amp += p.amp * g;
        len = Math.max(len, 8 * sr + (p.len - 8 * sr) * g);
      }
      streamAmp[i] = Math.min(1.3, amp);
      streamLen[i] = len;
    }
  }

  // ============================================================ sky
  function skyL(x, y) {
    const v = clamp(y / HZ, 0, 1.1);
    let L = V.zenith + (V.horizonL - V.zenith) * Math.pow(v, V.skyCurve);
    // ring-glow hugging the horizon, strongest behind the figure
    const wx = 0.6 + 0.6 * Math.exp(-(((x - FIGURE_FEET.x) / 110) ** 2));
    L += V.glowBandL * wx * Math.exp(-(((y - (HZ - 8)) / 13) ** 2));
    // halo + corona streamers
    const dx = x - SUN.x;
    const dy = y - SUN.y;
    const d = Math.hypot(dx, dy);
    if (d > SUN.r) {
      const out = d - SUN.r;
      L += V.haloL * Math.exp(-out / (24 * sr)) + 1.3 * Math.exp(-out / (75 * sr));
      const ai =
        Math.floor(
          (((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * STREAM_N,
        ) % STREAM_N;
      L += V.streamerL * streamAmp[ai] * Math.exp(-out / streamLen[ai]);
    }
    // white-hot bloom around the diamond-ring bead
    const db = Math.hypot(x - bead.x, y - bead.y);
    L += 4.2 * Math.exp(-((db / 3.6) ** 2)) + 1.6 * Math.exp(-((db / 11) ** 2));
    // two broken stratus bands, dark against the glow
    for (let b = 0; b < 2; b++) {
      const yc = [131, 150][b] + (noise.fbm1(x * 0.012 + b * 20) - 0.5) * 10;
      const cover = smooth(0.46, 0.62, noise.fbm1(x * 0.011 + b * 7 + 50));
      const th = [1.3, 2.0][b] * cover;
      const m = smooth(th + 0.7, th - 0.5, Math.abs(y - yc)) * cover;
      L -= m * [0.9, 1.1][b];
    }
    // vignette
    const nx = (x - W / 2) / (W / 2);
    const ny = (y - H * 0.45) / (H * 0.6);
    L -= 1.8 * smooth(0.55, 1.3, Math.hypot(nx * 0.85, ny));
    return L;
  }

  // ============================================================ static plates
  // skyR: sky, stars, the disc.  back: all land (transparent sky) so the animated
  // corona can sit between them.  front: foreground ridge + sword (mist goes under it).
  const skyR = new Raster(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) skyR.set(x, y, pick(SKYR, skyL(x, y), x, y));
  const back = new Raster(W, H);

  // stars — sparse, only in the dark upper sky
  const twinkles = [];
  for (let i = 0; i < V.stars; i++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(Math.pow(rng(), 1.5) * HZ * 0.6);
    const L = skyL(x, y);
    if (L > 3.4) continue;
    if (Math.hypot(x - SUN.x, y - SUN.y) < SUN.r + 30) continue;
    const bright = rng();
    const c = SKYR[clamp(Math.floor(L) + (bright > 0.88 ? 4 : bright > 0.55 ? 3 : 2), 0, 8)];
    skyR.set(x, y, c);
    if (bright > 0.9 && twinkles.length < 8)
      twinkles.push({ x, y, c: SKYR[clamp(Math.floor(L) + 6, 0, 9)], base: c, ph: rng() * 6.28 });
  }

  // hollow sun disc — the hole where the goddess was
  for (let y = SUN.y - SUN.r - 1; y <= SUN.y + SUN.r + 1; y++) {
    for (let x = SUN.x - SUN.r - 1; x <= SUN.x + SUN.r + 1; x++) {
      const d = Math.hypot(x - SUN.x, y - SUN.y);
      if (d < SUN.r - 0.3) skyR.set(x, y, INK[0]);
    }
  }

  // far ranges (share the sky ramp = atmospheric perspective)
  for (let x = 0; x < W; x++) {
    for (let y = Math.floor(farA[x]); y < H; y++) {
      const depth = y - farA[x];
      back.set(x, y, pick(SKYR, 7.0 + smooth(2, 30, depth) * 0.9, x, y));
    }
    for (let y = Math.floor(farB[x]); y < H; y++) {
      const depth = y - farB[x];
      back.set(x, y, pick(SKYR, 6.0 + smooth(3, 24, depth) * 1.0, x, y));
    }
  }

  // mid layer (dark, cool) with valley mist
  const MIDR = [INK[0], INK[1], INK[2], INK[3], INK[4], INK[5], INK[6], INK[7]];
  const mistAt = (x, y) =>
    smooth(0.3, 0.75, noise.fbm2(x * 0.035, y * 0.11, 3)) *
    smooth(176, 186, y) *
    smooth(206, 192, y);
  for (let x = 0; x < W; x++) {
    const top = Math.floor(midTop[x]);
    for (let y = top; y < H; y++) {
      const depth = y - top;
      let L = 3.1 - smooth(0, 40, depth) * 1.3;
      if (depth === 0) L = 4.6;
      L += mistAt(x, y) * 2.4;
      back.set(x, y, pick(MIDR, L, x, y));
    }
  }

  // quarry: a pale stepped gash cut into the dark hill — lit bench lips, broken risers
  {
    let y0 = 149;
    const benches = [];
    for (let b = 0; b < 5; b++) {
      const h = 6 + Math.floor(hash2(b, 17, seed) * 4);
      benches.push({
        y0,
        h,
        L: 268 + b * 6 + Math.floor((noise.n1(b * 3.1 + 7) - 0.5) * 8),
        R: 350 - b * 8 + Math.floor((noise.n1(b * 2.3 + 1) - 0.5) * 12),
      });
      y0 += h;
    }
    benches.forEach(({ y0, h, L, R }, b) => {
      for (let x = L; x <= R; x++) {
        const cap = midTop[x] + 2 + (noise.n1(x * 0.8 + b) - 0.5) * 2;
        // irregular vertical cracks / tool marks
        const crack = hash2(x, b, seed) < 0.16;
        const crackLen = 2 + Math.floor(hash2(x, b + 9, seed) * (h - 2));
        for (let y = y0; y < y0 + h; y++) {
          if (y < cap) continue;
          const r = y - y0;
          let c;
          if (x === L) c = INK[1];
          else if (x === R || x === R - 1) c = INK[2];
          else if (r === 0) c = x % 9 < 7 ? INK[5] : INK[4];
          else if (crack && r > 1 && r <= crackLen) c = INK[2];
          else c = pick(INK, 3.7 - r * 0.25 + smooth(176, 190, y) * 0.9, x, y);
          back.set(x, y, c);
        }
      }
      // cut blocks waiting on the bench
      for (let k = 0; k < 2; k++) {
        const bx = L + 5 + Math.floor(hash2(b, k, seed) * Math.max(1, R - L - 12));
        if (y0 - 2 < midTop[bx] + 2) continue;
        back.rect(bx, y0 - 2, 3, 1, INK[5]);
        back.rect(bx, y0 - 1, 3, 1, INK[3]);
        if (k === 0) back.rect(bx + 3, y0 - 1, 2, 1, INK[4]);
      }
    });
  }

  // sacred ground: a ring of standing stones in the valley mist
  {
    const cx = 236;
    const cy = 192;
    const stones = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      stones.push({
        sx: Math.round(cx + Math.cos(a) * 14),
        sy: Math.round(cy + Math.sin(a) * 3.5),
        h: 3 + Math.floor(hash2(i, 3, seed) * 3) + (Math.sin(a) > 0 ? 1 : 0),
        fallen: i === 6,
      });
    }
    stones.sort((a, b) => a.sy - b.sy);
    for (const s of stones) {
      if (s.fallen) {
        back.rect(s.sx - 1, s.sy, 4, 1, INK[1]);
        continue;
      }
      back.rect(s.sx, s.sy - s.h, 2, s.h + 1, INK[1]);
      back.set(s.sx + 1, s.sy - s.h, INK[4]);
    }
  }

  // ruined old-kingdom keep on the hill
  const keepBanners = [];
  {
    // one step darker than the hill so the ruin holds against the violet band of sky
    const K = INK[2];
    const KL = INK[3];
    const LIP = INK[4];
    const ground = (x) => Math.floor(midTop[clamp(x, 0, W - 1)]);
    const skyHole = (x, y, bias = 0.5) => back.set(x, y, pick(SKYR, skyL(x, y) + bias, x, y));
    // main tower (broken on a diagonal, crenels survive on the high side)
    const tx = 82;
    const tw = 14;
    const base = ground(tx + 7) + 2;
    const topAt = (x) => {
      const i = x - tx;
      let t = base - 56 + Math.max(0, i - 4) * 1.5;
      t += Math.floor(noise.n1(x * 1.7 + 3) * 3);
      if (i < 5 && i % 2 === 1) t -= 2; // crenels
      return Math.floor(t);
    };
    for (let x = tx - 1; x < tx + tw + 1; x++) {
      const edge = x < tx || x >= tx + tw;
      const top = edge ? base - 9 : topAt(x);
      for (let y = top; y < base + 6; y++) back.set(x, y, x >= tx + tw - 3 && !edge ? KL : K);
      back.set(x, top, LIP);
    }
    // arched windows (sky through the ruin)
    for (const [wx, wy, wh] of [
      [tx + 4, base - 40, 6],
      [tx + 4, base - 24, 5],
      [tx + 9, base - 30, 4],
    ]) {
      for (let j = 0; j < wh; j++) {
        skyHole(wx, wy + j);
        if (j > 0) skyHole(wx + 1, wy + j);
      }
    }
    // curtain wall to the left, crumbling into rubble
    for (let x = 58; x < tx - 1; x++) {
      const top =
        base -
        15 +
        Math.max(0, Math.floor((68 - x) * 1.1)) +
        Math.floor(noise.n1(x * 1.9 + 11) * 2);
      const g = ground(x);
      if (top >= g) continue;
      for (let y = top; y < g + 2; y++) back.set(x, y, K);
      if ((x - 58) % 4 < 2 && x > 68) back.set(x, top - 1, K);
      back.set(x, top, LIP);
    }
    // gatehouse arch breach
    for (let y = base - 10; y < base + 1; y++)
      for (let x = 69; x < 78; x++) {
        const ax = x - 73;
        const ay = y - (base - 6);
        if (ay > 0 || ax * ax + ay * ay * 1.3 < 17) skyHole(x, y, 0);
      }
    // wall to the second tower
    for (let x = tx + tw + 1; x < 118; x++) {
      const top = base - 16 + Math.floor(noise.n1(x * 2.3 + 7) * 3);
      for (let y = top; y < base + 6; y++) back.set(x, y, K);
      back.set(x, top, LIP);
    }
    // second tower, sheared off
    const t2 = 118;
    for (let x = t2; x < t2 + 9; x++) {
      const top =
        base - 33 + Math.floor(Math.abs(x - t2 - 2) * 1.7) + Math.floor(noise.n1(x * 1.3) * 3);
      for (let y = top; y < base + 6; y++) back.set(x, y, x >= t2 + 7 ? KL : K);
      back.set(x, top, LIP);
    }
    skyHole(t2 + 3, base - 18);
    skyHole(t2 + 3, base - 17);
    skyHole(t2 + 3, base - 16);
    // rubble spill
    for (let x = t2 + 9; x < 138; x++) {
      const top = base - 5 + Math.floor((x - t2 - 9) * 0.35) + Math.floor(noise.n1(x * 2.9) * 2);
      const g = ground(x);
      for (let y = top; y < g + 3; y++) back.set(x, y, K);
      back.set(x, top, LIP);
    }
    keepBanners.push(
      { x: tx + 1, y: base - 50, w: 3, h: 22 },
      { x: tx + 7, y: base - 46, w: 3, h: 17 },
      { x: t2 + 5, y: base - 26, w: 2, h: 11 },
    );
  }

  // imperial standards planted along the quarry rim
  const rimStandards = [];
  for (let i = 0; i < 4; i++) {
    const x = 352 + i * 17 + Math.floor(hash2(i, 9, seed) * 5);
    const y = Math.floor(midTop[Math.min(W - 1, x)]);
    const h = 13 - i * 2;
    for (let j = 1; j <= h; j++) back.set(x, y - j, INK[2]);
    rimStandards.push({ x, y: y - h, len: 6 - i });
  }

  // foreground ridge (separate layer so valley mist can drift between it and the rest)
  const front = new Raster(W, H);
  for (let x = 0; x < W; x++) {
    const top = Math.floor(fgTop[x]);
    for (let y = top; y < H; y++) {
      const depth = y - top;
      front.set(x, y, depth === 0 ? INK[3] : pick(INK, 1.2 - smooth(0, 22, depth) * 1.1, x, y));
    }
    if (!(x > 156 && x < 190) && hash2(x, 1, seed) > 0.7) {
      const bh = 1 + Math.floor(hash2(x, 2, seed) * 3);
      for (let j = 1; j <= bh; j++)
        front.set(x + (j === bh && hash2(x, 5, seed) > 0.5 ? 1 : 0), top - j, INK[2]);
    }
  }

  // planted sword, leaning, left of the figure
  {
    const bx = figOrigin.x;
    const by = FIGURE_FEET.y + 1;
    const tip = [bx - 3, by - 13];
    const blade = curvePixels((t) => [bx + (tip[0] - bx) * t, by + (tip[1] - by) * t], 60);
    for (const [x, y] of blade) front.set(x, y, INK[0]);
    front.set(blade[5][0] + 1, blade[5][1], STL[1]); // one cold glint on the blade
    const [gx, gy] = blade[blade.length - 3];
    for (const [dx, dy] of [
      [-2, -1],
      [-1, -1],
      [1, 0],
      [2, 0],
    ])
      front.set(gx + dx, gy + dy, INK[0]); // crossguard, perpendicular-ish to the blade
    front.set(tip[0], tip[1] - 1, INK[0]); // grip
    front.set(tip[0], tip[1] - 2, INK[1]); // pommel
  }

  // the figure is prebaked into small frame canvases (cape flutter)
  const figureFrames = FIGURE_FRAMES.map((rows) => {
    const r = new Raster(FIGURE_W, FIGURE_H);
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === '#') r.set(i, j, INK[0]);
      }
    });
    return r.toCanvas();
  });

  const skyCanvas = skyR.toCanvas();
  const backCanvas = back.toCanvas();
  const frontCanvas = front.toCanvas();

  // drifting valley mist: two horizontally tileable dithered bands at different speeds
  const mistLayers = [
    { y0: 174, y1: 194, peak: 184, cover: 0.42, speed: 1.6, seed: 1 },
    { y0: 186, y1: 210, peak: 197, cover: 0.34, speed: 2.8, seed: 2 },
  ].map((m) => {
    const r = new Raster(W, H);
    const dens = (x, y) => {
      const f = (xx) => noise.fbm2(xx * 0.028 + m.seed * 50, y * 0.14, 3);
      return f(x) * (1 - x / W) + f(x - W) * (x / W); // seamless wrap at W
    };
    for (let y = m.y0; y < m.y1; y++) {
      const band = Math.exp(-(((y - m.peak) / ((m.y1 - m.y0) * 0.3)) ** 2));
      for (let x = 0; x < W; x++) {
        const d = smooth(0.42, 0.72, dens(x, y)) * band * m.cover;
        if (d > bayer(x, y)) r.set(x, y, y < 186 ? INK[6] : INK[5]);
      }
    }
    return { canvas: r.toCanvas(), speed: m.speed };
  });

  // ============================================================ fate threads
  // Spun from the diamond-ring bead. Control vectors are authored for the reference
  // sun (292,68 r22) and rotated/scaled to whatever sun->hand geometry a variant uses.
  const REF = { ang: Math.atan2(149 - 68, 179 - 292), len: Math.hypot(149 - 68, 179 - 292) };
  const xf = (() => {
    const len = Math.hypot(hand.y - SUN.y, hand.x - SUN.x);
    const rot = toHand - REF.ang;
    const k = len / REF.len;
    const c = Math.cos(rot) * k;
    const sn = Math.sin(rot) * k;
    return ([x, y]) => [x * c - y * sn, x * sn + y * c];
  })();
  const threads = [];
  {
    const spec = [
      { a: 150, out: [-46, -2], inn: [8, -42], amp: 0.9, waves: 1.0 },
      { a: 137, out: [-38, 8], inn: [18, -36], amp: 1.2, waves: 1.5 },
      { a: 123, out: [-26, 18], inn: [30, -26], amp: 0.8, waves: 1.0 },
    ];
    for (const [i, s] of spec.entries()) {
      // every thread is spun from the diamond-ring bead, a few px apart on the rim
      const a = beadAng + ((s.a - 137) * Math.PI) / 180 / 3;
      const p0 = [SUN.x + Math.cos(a) * (SUN.r + 1), SUN.y + Math.sin(a) * (SUN.r + 1)];
      const o = xf(s.out);
      const n = xf(s.inn);
      const p1 = [p0[0] + o[0], p0[1] + o[1]];
      const p2 = [hand.x + n[0], hand.y + n[1]];
      const p3 = [hand.x, hand.y];
      const b = bezier(p0, p1, p2, p3);
      const ph = i * 1.7;
      const fn = (t) => {
        const [x, y] = b(t);
        const [x2, y2] = b(Math.min(1, t + 0.002));
        const dx = x2 - x;
        const dy = y2 - y;
        const l = Math.hypot(dx, dy) || 1;
        const w = s.amp * Math.sin(Math.PI * t * s.waves * 2 + ph) * Math.sin(Math.PI * t);
        return [x - (dy / l) * w, y + (dx / l) * w];
      };
      threads.push({ path: curvePixels(fn, 900), severed: false });
    }
    // the severed thread — a timeline cut loose, hanging from the rim
    const sev = V.severed ?? {
      at: 72,
      path: [
        [3, 16],
        [-7, 28],
        [-3, 44],
      ],
    };
    const a = (sev.at * Math.PI) / 180;
    const p0 = [SUN.x + Math.cos(a) * (SUN.r + 0.5), SUN.y + Math.sin(a) * (SUN.r + 0.5)];
    const [q1, q2, q3] = sev.path.map(([dx, dy]) => [p0[0] + dx, p0[1] + dy]);
    threads.push({
      path: curvePixels(bezier(p0, q1, q2, q3), 600),
      severed: true,
    });
  }
  const threadRaster = new Raster(W, H);
  for (const th of threads) {
    const n = th.path.length;
    th.path.forEach(([x, y], i) => {
      const t = i / (n - 1);
      if (th.severed) {
        if (t > 0.62 && hash2(x, y, seed) < (t - 0.62) * 2.6) return; // fraying
        threadRaster.set(x, y, t < 0.08 ? EMB[5] : t < 0.35 ? EMB[4] : t < 0.7 ? EMB[3] : EMB[2]);
        return;
      }
      const c =
        t < 0.04 ? EMB[5] : t < 0.2 ? EMB[4] : t > 0.96 ? EMB[5] : t > 0.84 ? EMB[4] : EMB[3];
      threadRaster.set(x, y, c);
    });
    if (th.severed) {
      const [ex, ey] = th.path[n - 1];
      for (const [fx, fy] of [
        [ex - 1, ey + 4],
        [ex + 2, ey + 6],
        [ex - 2, ey + 9],
      ])
        threadRaster.set(fx, fy, EMB[2]);
    }
  }
  const threadCanvas = threadRaster.toCanvas();

  // ============================================================ prebaked corona frames
  // Diamond-ring bead where the threads leave the rim: the ring thickens and
  // brightens toward it, as if the last of the light leaks out there.
  const CORONA_FRAMES = 16;
  const cBox = SUN.r + 4;
  const ringOuter = circlePixels(SUN.r);
  const ringInner = circlePixels(SUN.r - 1);
  const ringHalo = circlePixels(SUN.r + 1);
  const coronaFrames = [];
  for (let f = 0; f < CORONA_FRAMES; f++) {
    const r = new Raster(cBox * 2 + 1, cBox * 2 + 1);
    const ph = (f / CORONA_FRAMES) * Math.PI * 2;
    const shimmer = (a) => 0.5 + 0.5 * Math.sin(a * 7 + ph) * Math.sin(a * 3 - ph * 2 + 1.3);
    for (const [x, y] of ringHalo) {
      const a = Math.atan2(y, x);
      const near = Math.cos(Math.min(Math.PI, angDiff(a, beadAng)));
      if (near + shimmer(a) * 0.5 + bayer(x + cBox, y + cBox) * 0.6 > 1.25)
        r.set(x + cBox, y + cBox, EMB[3]);
    }
    for (const [x, y] of ringOuter) {
      const a = Math.atan2(y, x);
      const near = 0.5 + 0.5 * Math.cos(angDiff(a, beadAng)); // 1 at the bead, 0 opposite
      const v = near * 0.7 + shimmer(a) * 0.45;
      r.set(x + cBox, y + cBox, v > 0.95 ? EMB[6] : v > 0.35 ? EMB[5] : EMB[4]);
    }
    for (const [x, y] of ringInner) {
      const a = Math.atan2(y, x);
      const dd = angDiff(a, beadAng);
      if (dd < 0.75) r.set(x + cBox, y + cBox, dd < 0.25 ? EMB[5] : EMB[4]);
      else if (dd < 1.2 && bayer(x + cBox, y + cBox) < 0.5) r.set(x + cBox, y + cBox, EMB[3]);
    }
    coronaFrames.push(r.toCanvas());
  }

  // ============================================================ particles
  const ash = [];
  for (let i = 0; i < V.ash; i++)
    ash.push({ x: rng() * W, y: rng() * H, z: rng(), ph: rng() * 6.28, sp: 0.6 + rng() * 0.8 });
  // a few crows wheeling over the dead keep
  const birds = [];
  for (let i = 0; i < 3; i++)
    birds.push({
      r: 9 + rng() * 16,
      sp: 0.22 + rng() * 0.16,
      ph: rng() * 6.28,
      ry: 0.3 + rng() * 0.15,
    });
  const BIRD_C = { x: 100, y: 82 };
  const motes = [];
  for (let i = 0; i < V.motes; i++)
    motes.push({ ph: rng(), dx: (rng() - 0.5) * 34, sp: 0.7 + rng() * 0.6, sway: rng() * 6.28 });

  // ============================================================ animated drawing helpers
  const E = PALETTE.ember;
  const I = PALETTE.ink;
  const B = PALETTE.blood;
  const hex = (c) => HEX_OF.get(c);

  function dot(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, 1, 1);
  }

  function drawBanner(ctx, b, t) {
    // long hanging drape with a ragged, swaying tail
    for (let j = 0; j < b.h; j++) {
      const k = j / b.h;
      const sway = Math.round(Math.sin(t * 1.1 + j * 0.3 + b.x) * k * k * 1.6);
      for (let i = 0; i < b.w; i++) {
        if (j > b.h - 5 && hash2(b.x + i, j, seed) < (j - (b.h - 5)) * 0.28) continue;
        const c = j < 2 ? B[2] : i === b.w - 1 ? B[2] : B[1];
        dot(ctx, b.x + i + sway, b.y + j, c);
      }
    }
    // crossbar
    for (let i = -1; i <= b.w; i++) dot(ctx, b.x + i, b.y - 1, I[2]);
  }

  function drawStandard(ctx, s, t, i) {
    for (let k = 0; k < s.len; k++) {
      const wy = Math.round(Math.sin(t * 4.2 + k * 0.9 + i * 1.3) * (k / s.len) * 1.4);
      dot(ctx, s.x + 1 + k, s.y + wy, B[k === 0 ? 2 : 1]);
      if (k < s.len - 1) dot(ctx, s.x + 1 + k, s.y + 1 + wy, B[1]);
    }
  }

  // ============================================================ render
  let destroyed = false;
  function render(ctx, timeMs = 0) {
    if (destroyed) return;
    // Callers pass rAF / Phaser clocks; never trust them to be finite or non-negative.
    const ms = reducedMotion ? frozenTime : Number(timeMs);
    const t = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(skyCanvas, 0, 0);
    for (const s of twinkles)
      dot(ctx, s.x, s.y, hex(Math.sin(t * 1.7 + s.ph * 3) > 0.6 ? s.c : s.base));
    ctx.drawImage(
      coronaFrames[Math.floor(t * 4) % CORONA_FRAMES] ?? coronaFrames[0],
      SUN.x - cBox,
      SUN.y - cBox,
    );
    ctx.drawImage(backCanvas, 0, 0);
    for (const m of mistLayers) {
      const off = Math.floor((t * m.speed) % W);
      ctx.drawImage(m.canvas, off, 0);
      ctx.drawImage(m.canvas, off - W, 0);
    }
    ctx.drawImage(frontCanvas, 0, 0);

    for (const b of keepBanners) drawBanner(ctx, b, t);
    rimStandards.forEach((s, i) => drawStandard(ctx, s, t, i));

    // crows
    for (const b of birds) {
      const a = t * b.sp + b.ph;
      const x = Math.round(BIRD_C.x + Math.cos(a) * b.r);
      const y = Math.round(BIRD_C.y + Math.sin(a) * b.r * b.ry);
      const lift = Math.floor(t * 2.6 + b.ph) % 3 === 0 ? 0 : 1;
      dot(ctx, x, y, I[1]);
      dot(ctx, x - 1, y - lift, I[1]);
      dot(ctx, x + 1, y - lift, I[1]);
    }

    // gold motes lifting from the ground around the figure, drifting up and right
    for (const m of motes) {
      const life = (t * 0.07 * m.sp + m.ph) % 1;
      const x = FIGURE_FEET.x + m.dx + life * 16 + Math.sin(t * 1.1 + m.sway) * 2;
      const y = FIGURE_FEET.y - 2 - life * 64;
      dot(ctx, x, y, life < 0.1 ? E[3] : life < 0.4 ? E[4] : life < 0.75 ? E[3] : E[2]);
    }

    // the figure (cape flutter: 3 frames, irregular cadence so it reads as wind)
    const gust = Math.floor(t * 5 + Math.sin(t * 0.7) * 2);
    ctx.drawImage(figureFrames[((gust % 3) + 3) % 3], figOrigin.x, figOrigin.y);

    // threads + glints travelling sun -> hand
    ctx.drawImage(threadCanvas, 0, 0);
    threads.forEach((th, i) => {
      if (th.severed) return;
      const local = ((t + i * 1.9) % 7.6) / 3.4;
      if (local > 1) return;
      const head = Math.floor(local * (th.path.length - 1));
      for (let k = 0; k < 4; k++) {
        const p = th.path[head - k];
        if (!p) break;
        dot(ctx, p[0], p[1], k === 0 ? E[6] : k === 1 ? E[5] : E[4]);
      }
    });

    // diamond-ring bead
    {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.1);
      const arm = 3 + Math.round(pulse * 3);
      for (let k = arm; k >= 1; k--) {
        const c = k === 1 ? E[6] : k <= 2 ? E[5] : k < arm ? E[4] : E[3];
        dot(ctx, bead.x - k, bead.y, c);
        dot(ctx, bead.x + k, bead.y, c);
        dot(ctx, bead.x, bead.y - k, c);
        dot(ctx, bead.x, bead.y + k, c);
      }
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        dot(ctx, bead.x + dx, bead.y + dy, pulse > 0.5 ? E[4] : E[3]);
      dot(ctx, bead.x, bead.y, E[6]);
    }

    // the hand, where every thread converges
    {
      const on = Math.sin(t * 2.6) > 0;
      dot(ctx, hand.x, hand.y, E[on ? 6 : 5]);
      if (on) {
        dot(ctx, hand.x + 1, hand.y, E[3]);
        dot(ctx, hand.x, hand.y - 1, E[3]);
      }
    }

    // ash — drifting right on the wind, three depths
    for (const a of ash) {
      const x = (((a.x + t * (4 + a.z * 12) * a.sp + Math.sin(t * 0.8 + a.ph) * 3) % W) + W) % W;
      const y = (((a.y + t * (2 + a.z * 5) * a.sp) % H) + H) % H;
      const c = V.ashBright
        ? a.z < 0.4
          ? I[5]
          : a.z < 0.8
            ? I[7]
            : I[8]
        : a.z < 0.45
          ? I[4]
          : a.z < 0.8
            ? I[6]
            : I[7];
      dot(ctx, x, y, c);
      if (a.z > 0.94) dot(ctx, x + 1, y, c);
    }
  }

  // ============================================================ framing
  const plateCanvas = makeCanvas(W, H);
  const plateCtx = plateCanvas.getContext('2d');

  /**
   * Cover-crop the plate into a viewport of viewW x viewH device pixels.
   * Integer scale when that crops at most ~12% more; otherwise fractional.
   */
  function frame(viewW, viewH, { anchorX = 0.5, anchorY = 0.44 } = {}) {
    viewW = Math.max(1, viewW || 0);
    viewH = Math.max(1, viewH || 0);
    let s = Math.max(viewW / W, viewH / H);
    const si = Math.ceil(s - 1e-6);
    if (si / s <= 1.12) s = si;
    const sw = Math.min(W, viewW / s);
    const sh = Math.min(H, viewH / s);
    return {
      sx: Math.round((W - sw) * anchorX),
      sy: Math.round((H - sh) * anchorY),
      sw,
      sh,
      scale: s,
    };
  }

  function draw(
    ctx,
    timeMs,
    viewW = opts.width ?? ctx.canvas.width,
    viewH = opts.height ?? ctx.canvas.height,
    frameOpts,
  ) {
    render(plateCtx, timeMs);
    const f = frame(viewW, viewH, frameOpts);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(plateCanvas, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw * f.scale, f.sh * f.scale);
    return f;
  }

  return {
    width: W,
    height: H,
    variant: VARIANTS[opts.variant] ? opts.variant : 'dusk',
    // Plate-space anchors for laying out UI over the art.
    anchors: {
      sun: { ...SUN },
      hand: { ...hand },
      figure: { ...FIGURE_FEET },
      calmSky: { x: 24, y: 8, w: 216, h: 76 }, // title lockup zone (upper-left sky)
      calmGround: { x: 52, y: 200, w: 320, h: 40 }, // dark foreground band (menus, 4:3)
    },
    render,
    draw,
    frame,
    toView(px, py, f) {
      return { x: (px - f.sx) * f.scale, y: (py - f.sy) * f.scale };
    },
    setReducedMotion(v) {
      reducedMotion = !!v;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    /** Release the offscreen canvases (helps iOS reclaim canvas memory). */
    destroy() {
      destroyed = true;
      for (const c of [
        skyCanvas,
        backCanvas,
        frontCanvas,
        threadCanvas,
        plateCanvas,
        ...coronaFrames,
        ...figureFrames,
        ...mistLayers.map((m) => m.canvas),
      ]) {
        c.width = 0;
        c.height = 0;
      }
    },
  };
}

export const HOLLOW_SUN_VARIANTS = Object.keys(VARIANTS);

export default createHollowSunScene;
