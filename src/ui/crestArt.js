// crestArt — the class crests drawn in code (docs/art-direction/growth/README.md).
//
// Faceted heraldry in the Reliquary language: a chamfered heater shield,
// flat facets lit from the upper left, one ink outline, palette ramps only
// (ART_BIBLE). Everything is polygons in a 64×64 box, so one definition is
// crisp from a 24px roster chip to a 160px ceremony crest (no raster to
// scale, nothing to download). Pure string building: no DOM beyond the
// optional element helper, no randomness.
import { CLASS_CREST_SPECS, crestSpecForClass, crestLabel } from './classCrests.js';

// ART_BIBLE ramps (art-only colours; UI tokens stay in uiPalette.json).
const INK = ['#07060b', '#0e0c14', '#16131e', '#211d2b', '#2e293a', '#403949', '#58505e', '#766b77', '#978b94', '#bdb0aa', '#ddd0bd', '#f4ecdb']; // prettier-ignore
const EMBER = ['#2a170e', '#4f2c16', '#80461f', '#b3702c', '#dca044', '#f3cb6c', '#fff0bd'];
const BLOOD = ['#22090f', '#44111c', '#6e1a28', '#9e2632', '#cc4038', '#ec7a5c'];
const STEEL = ['#101a2e', '#1c2f4f', '#2c4c77', '#4574a0', '#77a5c6', '#b8d8e6'];
const VERD = ['#0f2622', '#1b4239', '#2d6450', '#4d8b66', '#86b27b', '#c3d69a'];
const UNLIGHT = ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'];
const STONE = ['#1a1a20', '#2b2c33', '#40414a', '#5a5b63', '#7a7a80', '#a09e9f'];
const EARTH = ['#1d1a12', '#34301d', '#4f4a2a', '#6e6a3b', '#938c55', '#b8ae78'];

export const CREST_PALETTE = Object.freeze({ INK, EMBER, BLOOD, STEEL, VERD, UNLIGHT, STONE, EARTH }); // prettier-ignore

// ── Geometry helpers ─────────────────────────────────────────────────────

const r2 = (n) => Math.round(n * 100) / 100;

function transform(points, { x = 0, y = 0, rot = 0, s = 1, flip = false }) {
  const a = (rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return points.map(([px, py]) => {
    const fx = (flip ? -px : px) * s;
    const fy = py * s;
    return [r2(x + fx * cos - fy * sin), r2(y + fx * sin + fy * cos)];
  });
}

const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const diamond = (cx, cy, rx, ry = rx) => [
  [cx, cy - ry],
  [cx + rx, cy],
  [cx, cy + ry],
  [cx - rx, cy],
];
function ngon(cx, cy, r, n, start = -90) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((start + (360 / n) * i) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}
function star(cx, cy, outer, inner, n = 4, start = -90) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((start + (180 / n) * i) * Math.PI) / 180;
    const r = i % 2 ? inner : outer;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
function arc(cx, cy, r, from, to, steps) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

// A shape is { fill, pts }; `line` marks strokes-only shapes (bow strings).
const S = (fill, pts) => ({ fill, pts });

// ── Charges (local coordinates, point up, ~52 units tall, centred) ───────

function blade(tone) {
  const hi = tone === 'muted' ? INK[9] : INK[11];
  const lo = tone === 'muted' ? INK[7] : INK[9];
  const gold = tone === 'muted' ? EMBER[3] : EMBER[4];
  return { hi, lo, gold, grip: EMBER[1], wood: tone === 'muted' ? EMBER[2] : EMBER[3] };
}

const CHARGES = {
  sword(t) {
    const c = blade(t);
    return [
      S(c.hi, [
        [-3, -19],
        [0, -26],
        [0, 9],
        [-3, 9],
      ]),
      S(c.lo, [
        [0, -26],
        [3, -19],
        [3, 9],
        [0, 9],
      ]),
      S(c.gold, rect(-10, 9, 10, 12.5)),
      S(c.grip, rect(-1.8, 12.5, 1.8, 20)),
      S(c.gold, diamond(0, 22.5, 3, 3)),
    ];
  },
  curved(t) {
    const c = blade(t);
    return [
      S(c.hi, [
        [-2.5, 9],
        [-2.6, -6],
        [-1.4, -16],
        [1.2, -23],
        [3.6, -26.5],
        [1.6, -15],
        [0.6, -5],
        [0.6, 9],
      ]),
      S(c.lo, [
        [0.6, 9],
        [0.6, -5],
        [1.6, -15],
        [3.6, -26.5],
        [4.2, -19],
        [3.4, -7],
        [2.8, 9],
      ]),
      S(c.gold, ngon(0, 10.5, 4.6, 8, -90 + 22.5)),
      S(c.grip, rect(-1.8, 13.5, 1.8, 22.5)),
      S(c.gold, rect(-2.2, 16, 2.2, 17.2)),
      S(c.gold, rect(-2.2, 19.5, 2.2, 20.7)),
      S(c.gold, rect(-2.4, 22.5, 2.4, 24.5)),
    ];
  },
  dagger(t) {
    const c = blade(t);
    return [
      S(c.hi, [
        [-3.2, -8],
        [0, -17],
        [0, 6],
        [-3.2, 6],
      ]),
      S(c.lo, [
        [0, -17],
        [3.2, -8],
        [3.2, 6],
        [0, 6],
      ]),
      S(c.gold, [
        [-8, 6],
        [8, 6],
        [6.5, 9],
        [-6.5, 9],
      ]),
      S(c.grip, rect(-1.8, 9, 1.8, 15.5)),
      S(c.gold, diamond(0, 17.8, 2.6, 2.6)),
    ];
  },
  lance(t) {
    const c = blade(t);
    return [
      S(c.wood, rect(-1.5, -12, 1.5, 27)),
      S(EMBER[1], rect(0.4, -12, 1.5, 27)),
      S(c.hi, [
        [0, -28],
        [0, -12],
        [-2.4, -12],
        [-4.4, -19],
      ]),
      S(c.lo, [
        [0, -28],
        [4.4, -19],
        [2.4, -12],
        [0, -12],
      ]),
      S(c.gold, rect(-2.8, -12, 2.8, -9.5)),
      S(c.gold, rect(-2.4, 5, 2.4, 7)),
    ];
  },
  axe(t) {
    const c = blade(t);
    return [
      S(c.wood, rect(-1.6, -21, 1.6, 26)),
      S(EMBER[1], rect(0.4, -21, 1.6, 26)),
      S(c.hi, [
        [1.6, -17],
        [8, -22],
        [12.5, -14],
        [8.5, -11],
        [1.6, -9],
      ]),
      S(c.lo, [
        [1.6, -9],
        [8.5, -11],
        [12.5, -14],
        [12.5, -3],
        [8, 3],
        [1.6, -1],
      ]),
      S(c.gold, rect(-2.6, -23.5, 2.6, -20.5)),
      S(c.gold, rect(-2.2, 22, 2.2, 24.5)),
    ];
  },
  bow(t) {
    const c = blade(t);
    const wood = c.wood;
    return [
      // arrow along the string, point up
      S(c.lo, rect(-5.3, -18, -4.3, 20)),
      S(c.hi, [
        [-4.8, -26],
        [-2, -19],
        [-7.6, -19],
      ]),
      S(BLOOD[3], [
        [-4.8, 16],
        [-1.8, 21],
        [-4.8, 20],
      ]),
      S(BLOOD[3], [
        [-4.8, 16],
        [-7.8, 21],
        [-4.8, 20],
      ]),
      // string
      S(INK[9], rect(-3.2, -23, -2.6, 23)),
      // limbs (a D to the right)
      S(wood, [
        [-3.2, -24.5],
        [0.2, -24],
        [5.2, -15],
        [7.6, 0],
        [5.2, 15],
        [0.2, 24],
        [-3.2, 24.5],
        [-1.4, 21],
        [2.4, 13],
        [4, 0],
        [2.4, -13],
        [-1.4, -21],
      ]),
      S(EMBER[1], [
        [4, 0],
        [7.6, 0],
        [5.2, 15],
        [0.2, 24],
        [-3.2, 24.5],
        [-1.4, 21],
        [2.4, 13],
      ]),
      S(c.gold, rect(3.4, -3.5, 8.2, 3.5)),
    ];
  },
  tome(t) {
    const muted = t === 'muted';
    const cover = muted ? BLOOD[2] : BLOOD[3];
    const coverLo = muted ? BLOOD[1] : BLOOD[2];
    const gold = muted ? EMBER[3] : EMBER[4];
    return [
      S(INK[10], rect(9, -13, 12, 14)),
      S(cover, rect(-11, -15, 10, 15)),
      S(coverLo, [
        [10, -15],
        [10, 15],
        [-11, 15],
      ]),
      S(gold, rect(-11, -15, -7.5, 15)),
      S(gold, diamond(1.5, 0, 5, 6.5)),
      S(coverLo, diamond(1.5, 0, 2.4, 3.2)),
      S(gold, rect(9, -2.5, 13, 2.5)),
      S(gold, [
        [10, -15],
        [10, -10],
        [5, -15],
      ]),
      S(gold, [
        [10, 15],
        [10, 10],
        [5, 15],
      ]),
    ];
  },
  staff(t) {
    const c = blade(t);
    const ring = ngon(0, -18, 8, 8, -90 + 22.5);
    const hole = ngon(0, -18, 4.8, 8, -90 + 22.5);
    return [
      S(c.wood, rect(-1.5, -10, 1.5, 27)),
      S(EMBER[1], rect(0.4, -10, 1.5, 27)),
      S(c.gold, ring),
      { fill: 'hole', pts: hole },
      S(EMBER[6], diamond(0, -18, 2.2, 3.2)),
      S(c.gold, rect(-2.6, -10.5, 2.6, -8)),
    ];
  },
  light(t) {
    const hi = t === 'muted' ? EMBER[4] : EMBER[6];
    const lo = t === 'muted' ? EMBER[3] : EMBER[5];
    const big = star(0, 0, 15, 3.6, 4);
    const small = star(0, 0, 9, 3.2, 4, -45);
    return [
      S(lo, small),
      S(hi, big),
      S(lo, [[0, 0], ...big.slice(2, 6)]),
      S(EMBER[6], diamond(0, 0, 2.2)),
    ];
  },
  breath(t) {
    const muted = t === 'muted';
    return [
      S(muted ? BLOOD[3] : BLOOD[4], [
        [-8, 16],
        [-11, 2],
        [-6, -10],
        [-5, -2],
        [0, -20],
        [4, -8],
        [6, -14],
        [11, 2],
        [8, 16],
      ]),
      S(EMBER[5], [
        [-4, 16],
        [-6, 6],
        [-2, 0],
        [0, -8],
        [3, 2],
        [6, 8],
        [4, 16],
      ]),
      S(INK[11], [
        [-4, 18],
        [4, 18],
        [2, 8],
        [-1, -4],
        [-2.5, 6],
      ]),
      S(INK[9], [
        [4, 18],
        [2, 8],
        [-1, -4],
        [0.5, 18],
      ]),
    ];
  },
  fan(t) {
    const muted = t === 'muted';
    const shapes = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a0 = -160 + (140 / n) * i;
      const a1 = a0 + 140 / n;
      shapes.push(
        S(i % 2 ? (muted ? BLOOD[2] : BLOOD[3]) : muted ? INK[9] : INK[11], [
          [0, 12],
          ...arc(0, 12, 23, a0, a1, 2),
        ]),
      );
    }
    shapes.push(S(muted ? EMBER[3] : EMBER[4], ngon(0, 12, 3, 8)));
    shapes.push(S(EMBER[1], ngon(0, 12, 1.2, 6)));
    return shapes;
  },
  eclipse() {
    const shapes = [];
    for (let i = 0; i < 10; i++) {
      if (i === 3 || i === 7) continue; // the corona is cracked
      shapes.push(
        S(i % 2 ? UNLIGHT[4] : UNLIGHT[3], [[0, 0], ...arc(0, 0, 17, i * 36, i * 36 + 36, 3)]),
      );
    }
    shapes.push(S(INK[0], ngon(0, 0, 13, 20)));
    shapes.push(S(UNLIGHT[1], [[0, 0], ...arc(0, 0, 13, 200, 250, 3)]));
    return shapes;
  },
};

// ── Supporters (behind the charge) ────────────────────────────────────────

const MOUNTS = {
  horse: () => [
    S(INK[10], [
      [9, 26],
      [9, 8],
      [7, -4],
      [4, -14],
      [2, -20],
      [0, -26],
      [-3, -19],
      [-7, -16],
      [-13, -9],
      [-19, -1],
      [-21, 4],
      [-18, 8],
      [-12, 7],
      [-6, 6],
      [-5, 14],
      [-6, 26],
    ]),
    S(INK[8], [
      [-21, 4],
      [-18, 8],
      [-12, 7],
      [-6, 6],
      [-5, 14],
      [-6, 26],
      [9, 26],
      [9, 12],
      [0, 8],
      [-8, 2],
    ]),
    S(EMBER[3], [
      [9, 8],
      [7, -4],
      [4, -14],
      [2, -20],
      [5, -19],
      [8, -10],
      [11, -2],
      [12.5, 8],
      [12, 26],
      [9, 26],
    ]),
    S(INK[0], diamond(-9.5, -8.5, 1.4, 1.4)),
    S(INK[6], diamond(-18.2, 3, 1.1, 1.1)),
  ],
  wing: () => {
    const wingL = [
      S(INK[8], [
        [-4, -2],
        [-12, -14],
        [-22, -19],
        [-26, -12],
        [-24, -2],
        [-20, 8],
        [-12, 12],
        [-4, 8],
      ]),
      S(INK[9], [
        [-4, -2],
        [-12, -14],
        [-22, -19],
        [-20, -9],
        [-13, -3],
      ]),
      S(INK[7], [
        [-24, -2],
        [-20, 8],
        [-12, 12],
        [-4, 8],
        [-12, 4],
      ]),
    ];
    return [
      ...wingL,
      ...wingL.map((sh) => ({ fill: sh.fill, pts: sh.pts.map(([x, y]) => [-x, y]) })),
    ];
  },
  wyvern: () => {
    const wingL = [
      S(STEEL[1], [
        [-4, -4],
        [-14, -18],
        [-26, -16],
        [-22, -10],
        [-25, -4],
        [-19, 0],
        [-20, 7],
        [-12, 6],
        [-4, 10],
      ]),
      S(INK[7], rect(-14.8, -18, -13.2, 6)),
      S(INK[7], [
        [-14, -18],
        [-26, -16],
        [-25.5, -14.6],
        [-14, -16.4],
      ]),
    ];
    return [
      ...wingL,
      ...wingL.map((sh) => ({ fill: sh.fill, pts: sh.pts.map(([x, y]) => [-x, y]) })),
    ];
  },
  tower: () => [
    S(STONE[3], [
      [-13, 26],
      [-13, -6],
      [-15, -6],
      [-15, -14],
      [-10, -14],
      [-10, -10],
      [-5, -10],
      [-5, -14],
      [5, -14],
      [5, -10],
      [10, -10],
      [10, -14],
      [15, -14],
      [15, -6],
      [13, -6],
      [13, 26],
    ]),
    S(STONE[2], rect(4, -6, 13, 26)),
    S(STONE[4], rect(-15, -14, -10, -12.6)),
    S(STONE[4], rect(-5, -14, 5, -12.6)),
    S(INK[1], [
      [-4, 26],
      [-4, 14],
      [0, 10],
      [4, 14],
      [4, 26],
    ]),
  ],
};

// ── Marks (small, in the dexter chief) ────────────────────────────────────

const MARKS = {
  crown: () => [
    S(EMBER[4], [
      [-5, 3],
      [-5, -3],
      [-2.5, 0],
      [0, -4],
      [2.5, 0],
      [5, -3],
      [5, 3],
    ]),
    S(EMBER[3], rect(-5, 1.5, 5, 3)),
  ],
  star: () => [S(EMBER[5], star(0, 0, 5, 1.6, 4))],
  eye: () => [
    S(UNLIGHT[4], [
      [-5.5, 0],
      [-2, -3],
      [2, -3],
      [5.5, 0],
      [2, 3],
      [-2, 3],
    ]),
    S(INK[0], diamond(0, 0, 1.8, 2.2)),
  ],
  coin: () => [S(EMBER[3], ngon(0, 0, 4.5, 8)), S(EMBER[5], ngon(-0.6, -0.6, 3, 8))],
  key: () => [
    S(EMBER[4], ngon(-2.6, 0, 3, 6)),
    { fill: 'hole', pts: ngon(-2.6, 0, 1.3, 6) },
    S(EMBER[4], rect(0, -0.8, 6, 0.8)),
    S(EMBER[4], rect(4, 0.8, 5.2, 3)),
  ],
  flame: () => [
    S(BLOOD[4], [
      [-3.5, 4],
      [-4, -1],
      [-1, -3],
      [0, -6],
      [2.5, -2],
      [4, 0],
      [3.5, 4],
    ]),
    S(EMBER[5], [
      [-1.5, 4],
      [-1.5, 1],
      [0.5, -2],
      [2, 1.5],
      [1.5, 4],
    ]),
  ],
  chalice: () => [
    S(EMBER[4], [
      [-4.5, -4],
      [4.5, -4],
      [3, 0],
      [0.8, 1],
      [0.8, 3],
      [3, 4.5],
      [-3, 4.5],
      [-0.8, 3],
      [-0.8, 1],
      [-3, 0],
    ]),
  ],
  moon: () => [
    S(INK[10], [...arc(0, 0, 5, 60, 300, 8), ...arc(2.5, 0, 3.6, 270, 90, 6).reverse()]),
  ],
  arrow: () => [S(INK[10], [[0, -5], [4, 1], [1.2, 0], [1.2, 5], [-1.2, 5], [-1.2, 0], [-4, 1]])], // prettier-ignore
  crack: () => [],
  ring: () => [S(UNLIGHT[3], ngon(0, 0, 4.2, 8)), { fill: 'hole', pts: ngon(0, 0, 2.4, 8) }],
};

// ── Shield and frames ─────────────────────────────────────────────────────

const SHIELD = [
  [11, 5],
  [53, 5],
  [59, 11],
  [59, 33],
  [53, 46],
  [32, 61],
  [11, 46],
  [5, 33],
  [5, 11],
];
function inset(points, d) {
  // Scale toward the shield centroid (a cheap, stable inset for convex shapes).
  const cx = 32;
  const cy = 31;
  const w = 27;
  const h = 28;
  return points.map(([x, y]) => [
    r2(cx + (x - cx) * ((w - d) / w)),
    r2(cy + (y - cy) * ((h - d) / h)),
  ]);
}

const TIER_FRAMES = {
  base: { rim: STEEL[2], rimHi: STEEL[3], rimLo: STEEL[1], inner: INK[5], field: INK[2], fieldHi: INK[3] },
  promoted: { rim: EMBER[3], rimHi: EMBER[5], rimLo: EMBER[2], inner: EMBER[4], field: INK[2], fieldHi: INK[3] },
  boss: { rim: UNLIGHT[2], rimHi: UNLIGHT[3], rimLo: UNLIGHT[1], inner: UNLIGHT[3], field: INK[1], fieldHi: UNLIGHT[0] },
}; // prettier-ignore

function poly(pts, fill, extra = '') {
  return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}"${extra}/>`;
}

function shapesSvg(shapes, t, holeFill) {
  let out = '';
  for (const sh of shapes) {
    const pts = transform(sh.pts, t);
    out += poly(pts, sh.fill === 'hole' ? holeFill : sh.fill);
  }
  return out;
}

// One ink contour for a whole charge group: the shapes redrawn in ink,
// grown by `w` units (an outline that also separates overlapping charges).
function contourSvg(shapes, t, w = 1.1) {
  const pts = shapes
    .filter((sh) => sh.fill !== 'hole')
    .map((sh) => poly(transform(sh.pts, t), INK[0], ` stroke="${INK[0]}" stroke-width="${w * 2}" stroke-linejoin="miter"`))
    .join(''); // prettier-ignore
  return pts;
}

/**
 * Crest composition for a class: the layers in draw order with their
 * transforms. Exported for tests (every class resolves; secondaries follow
 * the table) and the review sheet.
 */
export function crestLayers(spec) {
  const layers = [];
  const cx = 32;
  const cy = 32;
  if (spec.mount) layers.push({ kind: 'mount', key: spec.mount, t: { x: cx, y: cy + 1, s: 0.92 } });
  const sec = spec.secondary.slice(0, 2);
  const angles = sec.length === 1 ? [-34] : [-34, 34];
  sec.forEach((key, i) =>
    layers.push({ kind: 'secondary', key, t: { x: cx, y: cy + 2, rot: angles[i], s: 0.82 } }),
  );
  const primaryScale = spec.primary === 'light' ? 1.15 : spec.primary === 'eclipse' ? 1.1 : 0.9;
  if (spec.twin) {
    layers.push({ kind: 'primary', key: spec.primary, t: { x: cx, y: cy + 1, rot: 28, s: 0.84 } });
    layers.push({
      kind: 'primary',
      key: spec.primary,
      t: { x: cx, y: cy + 1, rot: -28, s: 0.84, flip: true },
    });
  } else {
    layers.push({ kind: 'primary', key: spec.primary, t: { x: cx, y: cy + 1, s: primaryScale } });
  }
  if (spec.mark) layers.push({ kind: 'mark', key: spec.mark, t: { x: 18.5, y: 16, s: 0.95 } });
  return layers;
}

const svgCache = new Map();

/** The crest as an SVG document string (64×64 viewBox). */
export function crestSvg(className) {
  if (svgCache.has(className)) return svgCache.get(className);
  const spec = crestSpecForClass(className);
  if (!spec) return '';
  const f = TIER_FRAMES[spec.tier] || TIER_FRAMES.base;
  let body = '';
  // Shield: outline, rim facets (lit upper left), field facets.
  body += poly(inset(SHIELD, -1.2), INK[0]);
  body += poly(SHIELD, f.rim);
  body += poly([[11, 5], [53, 5], [59, 11], [59, 22], [32, 22], [5, 22], [5, 11]], f.rimHi); // prettier-ignore
  body += poly([[59, 33], [53, 46], [32, 61], [32, 50], [55, 30]], f.rimLo); // prettier-ignore
  const inner = inset(SHIELD, 3.6);
  body += poly(inset(SHIELD, 2.6), INK[0]);
  if (spec.tier === 'promoted') {
    body += poly(inner, f.inner);
    body += poly(inset(SHIELD, 4.6), INK[0]);
  }
  const field = inset(SHIELD, spec.tier === 'promoted' ? 5.4 : 3.6);
  body += poly(field, f.field);
  // Upper-left light across the field: a diagonal facet.
  body += poly(
    field.filter(([x, y]) => x + y < 60).concat([[field[0][0], field[0][1]]]),
    f.fieldHi,
  );
  if (spec.mark === 'crack') {
    body += poly([[40, 8], [36, 22], [41, 30], [35, 44], [34.5, 44], [39.5, 30], [34.5, 22], [39, 8]], BLOOD[3]); // prettier-ignore
  }
  // Charges: supporter, secondaries, primary, mark; each group ink-contoured.
  const holeFill = f.field;
  for (const layer of crestLayers(spec)) {
    const table = { mount: MOUNTS, secondary: CHARGES, primary: CHARGES, mark: MARKS }[layer.kind];
    const tone = layer.kind === 'secondary' ? 'muted' : 'full';
    const shapes = table[layer.key]?.(tone) || [];
    if (!shapes.length) continue;
    body += contourSvg(shapes, layer.t, layer.kind === 'mark' ? 0.8 : 1.1);
    body += shapesSvg(shapes, layer.t, holeFill);
  }
  // Promoted frame: gilt studs and a keystone on the rim.
  if (spec.tier === 'promoted') {
    for (const [x, y] of [[5.8, 16], [58.2, 16], [11.5, 44.5], [52.5, 44.5]]) // prettier-ignore
      body += poly(diamond(x, y, 1.9, 1.9), EMBER[6]);
    body += poly(diamond(32, 5, 4.2, 4.2), INK[0]);
    body += poly(diamond(32, 5, 3, 3), EMBER[5]);
    body += poly([[32, 2], [35, 5], [32, 5]], EMBER[6]); // prettier-ignore
  }
  if (spec.tier === 'boss') {
    body += poly([[32, 5], [29, 14], [33, 20], [30.5, 20], [27, 14], [30, 5]], UNLIGHT[4]); // prettier-ignore
  }
  // The shield sits in the lower box; the promoted crown rides above it, so
  // base and promoted crests share one silhouette (the rite burns in place).
  let crown = '';
  if (spec.tier === 'promoted') {
    const pts = [[20, 12.5], [20, 4.5], [24.5, 8], [28, 2], [32, 6.5], [36, 2], [39.5, 8], [44, 4.5], [44, 12.5]]; // prettier-ignore
    crown += poly(pts, INK[0], ` stroke="${INK[0]}" stroke-width="2.4" stroke-linejoin="miter"`);
    crown += poly(pts, EMBER[4]);
    crown += poly([[20, 12.5], [20, 4.5], [24.5, 8], [28, 2], [32, 6.5], [32, 12.5]], EMBER[5]); // prettier-ignore
    crown += poly(rect(20, 10.2, 44, 12.5), EMBER[3]);
    for (const x of [24.5, 32, 39.5]) crown += poly(diamond(x, 10.3, 1.2, 1.2), EMBER[6]);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="geometricPrecision"><g transform="translate(32 38.6) scale(0.8) translate(-32 -32)">${body}</g>${crown}</svg>`;
  svgCache.set(className, svg);
  return svg;
}

export function crestDataUrl(className) {
  const svg = crestSvg(className);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}

/**
 * <img class="re-crest"> for a class, or null when the class has no crest.
 * Decorative by default; pass `label` to expose "<Class> crest · tier".
 */
export function crestElement(className, { className: extraClass = '', label = false } = {}) {
  if (typeof document === 'undefined') return null;
  const src = crestDataUrl(className);
  if (!src) return null;
  const img = document.createElement('img');
  img.className = `re-crest ${extraClass}`.trim();
  img.src = src;
  img.decoding = 'async';
  img.draggable = false;
  img.dataset.crest = className;
  img.dataset.crestTier = CLASS_CREST_SPECS[className]?.tier || '';
  img.alt = label ? crestLabel(className) : '';
  if (!label) img.setAttribute('aria-hidden', 'true');
  return img;
}

const chargeCache = new Map();

/**
 * A single heraldic charge (a weapon type from the crest language) as an SVG
 * data URL: the weapon seals in the promotion rite use the same motifs as
 * the crests. Keys: sword, curved, dagger, lance, axe, bow, tome, staff,
 * light, breath, fan.
 */
export function chargeDataUrl(key) {
  if (chargeCache.has(key)) return chargeCache.get(key);
  const shapes = CHARGES[key]?.('full');
  if (!shapes?.length) return '';
  const t = { x: 32, y: 32, s: key === 'light' ? 1.7 : 1.08 };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${contourSvg(shapes, t, 1.3)}${shapesSvg(shapes, t, INK[2])}</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  chargeCache.set(key, url);
  return url;
}
