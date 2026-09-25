// Crit, shock rings and proc overlays (pierce, flurry, drain, shield, buff, status,
// weapon-art ring). Same meaning as before, restyled into the Ink & Ember ramps.
import {
  TAU,
  lerp,
  clamp01,
  ease,
  field,
  stroke,
  ring,
  disc,
  spark,
  sparkle,
  mote,
  gline,
  line,
  starPoints,
  polyGlow,
  polyOutline,
  pointInPoly,
  polyEdgeDist,
  chip,
} from '../draw.mjs';
import { ART_RAMPS, INK_TONES } from '../../../../../src/art/combatFx/fxPalette.js';

const R = ART_RAMPS;

// ---------------------------------------------------------------- crit -----------

/**
 * Ink-lined starburst: a hot star with an ink outline that opens into a hollow
 * star (the target stays visible through it) while long thin rays reach out.
 */
const crit = {
  key: 'fx_crit',
  size: [64, 64],
  ramp: 'gilt',
  role: 'overlay',
  solidOnTop: false,
  durations: [50, 36, 38, 42, 48, 54, 60],
  setup: (rng) => ({
    jit: Array.from({ length: 20 }, () => rng.range(0.78, 1.18)),
    rot: rng.range(0, 0.4),
    shards: Array.from({ length: 8 }, (_, k) => ({
      a: (k / 8) * TAU + rng.range(-0.2, 0.2),
      d: rng.range(4, 8),
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 32;
    const cy = 32;
    const k = ease.outExpo(clamp01(t * 1.4));
    const rOut = lerp(15, 29, k);
    const rIn = lerp(6, 14, k);
    const pts = starPoints(cx, cy, 10, rOut, rIn, p.rot, (n) => p.jit[n]);
    if (i <= 4) {
      const band = [99, 2.4, 1.8, 1.5, 1.2][i];
      const heat = [1.15, 0.95, 0.8, 0.62, 0.45][i];
      polyGlow(f, pts, (d) => (d <= band ? heat * (i === 0 ? 1 - 0.25 * clamp01(d / 12) : 1) : 0));
      polyOutline(f, pts, INK_TONES.line, i === 0 ? 1.4 : 1);
      if (i === 0) {
        // Clear the glow under the ink so the line reads crisp.
        field(f, cx - 32, cy - 32, cx + 32, cy + 32, (px, py, x, y) => {
          if (f.sAt(x, y)) f.gClear(x, y);
          return 0;
        });
      }
    } else {
      // Shards of the burst flying off.
      for (const s of p.shards) {
        const d = rOut + s.d * (i - 4);
        const x = cx + Math.cos(s.a) * d;
        const y = cy + Math.sin(s.a) * d;
        line(f, x, y, x + Math.cos(s.a) * 2, y + Math.sin(s.a) * 2, INK_TONES.line);
        f.g(x - Math.cos(s.a), y - Math.sin(s.a), 0.7 - 0.2 * (i - 5));
      }
    }
    // Core and long thin rays.
    const ray = [30, 31, 29, 24, 17, 10, 5][i];
    const rv = [1.15, 1, 0.9, 0.75, 0.6, 0.45, 0.3][i];
    for (let q = 0; q < 4; q++) {
      const a = p.rot + (q * Math.PI) / 2;
      gline(f, cx, cy, cx + Math.cos(a) * ray, cy + Math.sin(a) * ray, rv, rv * 0.3);
    }
    if (i <= 2) disc(f, cx, cy, [5, 3.5, 2.2][i], 1.2, 0.85);
  },
};

// ---------------------------------------------------------------- shock ring -----

function shockAnim(key, size, rMax, durations, ramp = 'gilt') {
  const c = size / 2;
  return {
    key,
    size: [size, size],
    ramp,
    role: 'overlay',
    durations,
    setup: (rng) => ({ gaps: Array.from({ length: 24 }, () => rng() < 0.35) }),
    draw(f, i, { t, p }) {
      const k = ease.outQuart(t);
      const r = lerp(rMax * 0.22, rMax, k);
      const thick = lerp(3.2, 1, k);
      const v = lerp(1.05, 0.35, t);
      ring(
        f,
        c,
        c,
        r,
        r,
        thick,
        v,
        i >= durations.length - 3 ? { dash: 24, seedGap: (n) => p.gaps[n % 24] } : {},
      );
      if (i <= 1) {
        for (let a = 0; a < TAU; a += 0.04)
          f.s(
            Math.floor(c + Math.cos(a) * (r - thick)),
            Math.floor(c + Math.sin(a) * (r - thick)),
            INK_TONES.line,
          );
      }
    },
  };
}

const shock = shockAnim('fx_shock', 64, 29, [34, 34, 38, 42, 48, 54]);
const shockSmall = shockAnim('fx_shock_small', 40, 17, [30, 32, 36, 42, 48], 'steel');

// ---------------------------------------------------------------- pierce ---------

const pierce = {
  key: 'fx_pierce',
  size: [48, 48],
  ramp: 'steel',
  role: 'overlay',
  solidOnTop: true,
  durations: [40, 32, 34, 38, 44, 50],
  setup: (rng) => ({
    shards: Array.from({ length: 7 }, () => ({
      a: rng.range(-0.9, 0.9),
      d: rng.range(6, 14),
      s: rng.int(1, 2),
    })),
  }),
  draw(f, i, { t, p }) {
    // A needle of light straight through the guard, shards breaking out the far side.
    const ax = 5;
    const ay = 9;
    const bx = 43;
    const by = 39;
    const dir = Math.atan2(by - ay, bx - ax);
    if (i === 0) {
      stroke(f, ax, ay, bx, by, 1, 4, 0.35, 1.1, 1.4);
      // Three converging needles.
      for (const off of [-4, 4]) {
        const nx = -Math.sin(dir) * off;
        const ny = Math.cos(dir) * off;
        gline(f, ax + nx + 6, ay + ny + 6, 24 + nx * 0.3, 24 + ny * 0.3, 0.3, 0.9);
      }
      sparkle(f, 24, 24, 4, 1.1);
    } else {
      const k = ease.outCubic(t);
      const tail = lerp(0, 1, k);
      stroke(
        f,
        lerp(ax, bx, tail),
        lerp(ay, by, tail),
        bx + 2 * k,
        by + 2 * k,
        1,
        3 * (1 - k) + 1,
        0.3,
        1 - 0.6 * k,
        1.4,
      );
      for (const s of p.shards) {
        const a = dir + s.a;
        const d = 3 + s.d * k;
        const x = 30 + Math.cos(a) * d;
        const y = 30 + Math.sin(a) * d;
        if (i < 5) chip(f, x, y, s.s, [R.steel[2], R.steel[4], R.steel[5]], 1, i < 4);
      }
    }
  },
};

// ---------------------------------------------------------------- flurry ---------

const flurry = {
  key: 'fx_flurry',
  size: [48, 48],
  ramp: 'steel',
  role: 'overlay',
  durations: [30, 30, 30, 30, 34, 40, 48],
  setup: (rng) =>
    Array.from({ length: 5 }, (_, k) => ({
      a: -1.2 + k * 0.62 + rng.range(-0.2, 0.2),
      len: rng.range(18, 26),
      ox: rng.range(-4, 4),
      oy: rng.range(-4, 4),
    })),
  draw(f, i, { p }) {
    p.forEach((c, n) => {
      const age = i - n;
      if (age < 0 || age > 2) return;
      const v = [1.1, 0.7, 0.35][age];
      const half = c.len / 2;
      const x0 = 24 + c.ox - Math.cos(c.a) * half;
      const y0 = 24 + c.oy - Math.sin(c.a) * half;
      const x1 = 24 + c.ox + Math.cos(c.a) * half;
      const y1 = 24 + c.oy + Math.sin(c.a) * half;
      stroke(f, x0, y0, x1, y1, 0.8, age === 0 ? 2.6 : 1.6, v * 0.4, v, 1.3);
      if (age === 0) sparkle(f, x1, y1, 2, 1);
    });
  },
};

// ---------------------------------------------------------------- drain ----------

const drain = {
  key: 'fx_drain',
  size: [48, 48],
  ramp: 'blood',
  role: 'overlay',
  durations: [40, 40, 40, 42, 44, 48, 54, 60],
  setup: (rng) =>
    Array.from({ length: 9 }, (_, k) => ({
      a: (k / 9) * TAU + rng.range(-0.25, 0.25),
      r: rng.range(17, 22),
      s: rng() < 0.4 ? 2 : 1,
    })),
  draw(f, i, { t, p }) {
    const cx = 24;
    const cy = 24;
    const pull = ease.inQuad(clamp01(t * 1.5));
    if (pull < 0.98) {
      for (const m of p) {
        const r = m.r * (1 - pull);
        const a = m.a + pull * 1.8;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        mote(f, x, y, m.s, 0.95);
        // Short trail back along the spiral.
        const a2 = a - 0.25;
        const r2 = r + 3;
        gline(f, cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2, x, y, 0.3, 0.7);
      }
    }
    if (i >= 4) {
      const k = (i - 4) / 3;
      disc(f, cx, cy, lerp(5, 2, k), 1.1 - 0.5 * k, 0.6);
      ring(
        f,
        cx,
        cy,
        lerp(6, 13, ease.outCubic(k)),
        lerp(6, 13, ease.outCubic(k)),
        1.3,
        0.8 * (1 - k),
      );
    }
  },
};

// ---------------------------------------------------------------- shield ---------

function hexPts(cx, cy, r, rot = 0) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = rot + (k * Math.PI) / 3;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

const shield = {
  key: 'fx_shield',
  size: [48, 48],
  ramp: 'gilt',
  role: 'overlay',
  solidOnTop: false,
  durations: [44, 40, 40, 44, 48, 52, 56, 62],
  setup: (rng) => ({ order: [0, 1, 2, 3, 4, 5].sort(() => rng() - 0.5) }),
  draw(f, i, { p }) {
    const cx = 24;
    const cy = 23;
    const r = i === 0 ? 15 : 16;
    const pts = hexPts(cx, cy, r);
    const gone = i >= 4 ? p.order.slice(0, (i - 3) * 2) : [];
    const v = [1.1, 0.95, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4][i];
    for (let e = 0; e < 6; e++) {
      if (gone.includes(e)) continue;
      const [x0, y0] = pts[e];
      const [x1, y1] = pts[(e + 1) % 6];
      stroke(f, x0, y0, x1, y1, i === 0 ? 2.4 : 1.6, i === 0 ? 2.4 : 1.6, v, v, 2);
      // Rune tick at the edge's midpoint, pointing inward.
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      gline(f, mx, my, mx + (cx - mx) * 0.2, my + (cy - my) * 0.2, v * 0.9, v * 0.6);
    }
    for (const [x, y] of pts) mote(f, x, y, 2, v * 1.05);
    if (i <= 2) {
      // Faint ward plane and an ink inner line for contrast on bright ground.
      field(f, cx - r, cy - r, cx + r, cy + r, (px, py, x, y) =>
        pointInPoly(px, py, pts) && polyEdgeDist(px, py, pts) > 3 && x % 3 === 0 && y % 3 === 0
          ? 0.34
          : 0,
      );
      const inner = hexPts(cx, cy, r - 3);
      for (let e = 0; e < 6; e++) line(f, ...inner[e], ...inner[(e + 1) % 6], INK_TONES.lineSoft);
    }
    if (i >= 1 && i <= 4) {
      const rr = lerp(17, 23, (i - 1) / 3);
      const outer = hexPts(cx, cy, rr);
      for (let e = 0; e < 6; e++)
        gline(f, ...outer[e], ...outer[(e + 1) % 6], 0.45 * (1 - (i - 1) / 4));
    }
    if (i >= 4) {
      const k = (i - 4) / 3;
      for (const e of gone) {
        const [x0, y0] = pts[e];
        const [x1, y1] = pts[(e + 1) % 6];
        mote(f, lerp(x0, x1, 0.5), lerp(y0, y1, 0.5) - 6 * k, 1, 0.9 - 0.5 * k);
      }
    }
  },
};

// ---------------------------------------------------------------- buff -----------

const buff = {
  key: 'fx_buff',
  size: [48, 48],
  ramp: 'ember',
  role: 'overlay',
  durations: [44, 44, 44, 46, 48, 52, 56, 62],
  setup: (rng) =>
    Array.from({ length: 8 }, (_, k) => ({
      x: -13 + k * 3.7 + rng.range(-1, 1),
      d: rng.range(0, 0.35),
      rise: rng.range(18, 28),
      ph: rng.range(0, TAU),
    })),
  draw(f, i, { t, p }) {
    const cx = 24;
    const fy = 40;
    if (i <= 3) ring(f, cx, fy, lerp(9, 15, i / 3), lerp(3, 4.6, i / 3), 1.4, 1 - i * 0.25);
    for (const s of p) {
      const lt = clamp01((t - s.d) / (1 - s.d));
      if (lt <= 0 || lt >= 1) continue;
      const y = fy - s.rise * ease.outQuad(lt);
      const x = cx + s.x + Math.sin(s.ph + lt * 5) * 1.5;
      spark(f, x, y, -Math.PI / 2, lerp(4, 2, lt), 1.05 - 0.6 * lt);
    }
  },
};

// ---------------------------------------------------------------- status ---------

const statusGeneric = {
  key: 'fx_status',
  size: [48, 48],
  ramp: 'unlight',
  role: 'overlay',
  solidOnTop: true,
  durations: [50, 50, 50, 50, 54, 58, 62, 66],
  draw(f, i, { t }) {
    const cx = 24;
    const cy = 14;
    for (let m = 0; m < 4; m++) {
      const a = (m / 4) * TAU + t * 4.2;
      const x = cx + Math.cos(a) * 11;
      const y = cy + Math.sin(a) * 4;
      const v = 1.1 - 0.5 * t;
      // A violet rim round an ink bead (matter, so it reads on a lit meadow), and its
      // trail of glowing dust.
      mote(f, x, y, 3, v * 0.75);
      f.s(x, y, R.unlight[1]);
      f.s(x + 1, y, R.unlight[0]);
      for (let k = 1; k <= 4; k++) {
        const a2 = a - k * 0.16;
        mote(f, cx + Math.cos(a2) * 11, cy + Math.sin(a2) * 4, 1, v * (0.9 - k * 0.15));
      }
    }
  },
};

const statusSleep = {
  key: 'fx_status_sleep',
  size: [48, 48],
  ramp: 'pale',
  role: 'overlay',
  durations: [70, 70, 70, 70, 74, 78, 82, 90],
  draw(f, i, { t }) {
    // Drowsy "z" glyphs drifting up in a slow sway, small to large.
    const Z = [
      ['111', '010', '111'],
      ['1111', '0010', '0100', '1111'],
      ['11111', '00010', '00100', '01000', '11111'],
    ];
    for (let m = 0; m < 3; m++) {
      const lt = clamp01(t * 1.35 - m * 0.2);
      if (lt <= 0 || lt >= 1) continue;
      const g = Z[m];
      const x0 = Math.round(25 + m * 5 + Math.sin(lt * 5 + m) * 2);
      const y0 = Math.round(18 - m * 4 - lt * 10);
      const v = 1.05 * (1 - lt) ** 0.5;
      g.forEach((row, gy) => [...row].forEach((c, gx) => c === '1' && f.g(x0 + gx, y0 + gy, v)));
    }
  },
};

const statusSilence = {
  key: 'fx_status_silence',
  size: [48, 48],
  ramp: 'unlight',
  role: 'overlay',
  solidOnTop: true,
  durations: [50, 50, 60, 70, 70, 60, 56, 60],
  draw(f, i) {
    // An ink seal closes over the unit's voice: a ring with a bar through it.
    const cx = 24;
    const cy = 13;
    const r = [4, 7, 8.5, 8.5, 8.5, 8.5, 9, 9.5][i];
    const on = i <= 5;
    for (let a = 0; a < TAU; a += 0.03) {
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.9;
      if (on || ((a * 10) | 0) % 3 === 0) f.s(x, y, INK_TONES.unlightCore);
      f.g(cx + Math.cos(a) * (r + 1.2), cy + Math.sin(a) * (r + 1.2) * 0.9, on ? 0.6 : 0.35);
    }
    if (i >= 2 && i <= 6) {
      const k = Math.min(1, (i - 1) / 2);
      line(
        f,
        cx - r * 0.7 * k,
        cy + r * 0.62 * k,
        cx + r * 0.7 * k,
        cy - r * 0.62 * k,
        INK_TONES.unlightCore,
        2,
      );
      if (i <= 3) sparkle(f, cx, cy, 2, 0.8);
    }
  },
};

const statusAcid = {
  key: 'fx_status_acid',
  size: [48, 48],
  ramp: 'acid',
  role: 'overlay',
  durations: [50, 50, 50, 54, 58, 62, 66, 70],
  setup: (rng) =>
    Array.from({ length: 7 }, () => ({
      x: rng.range(-11, 11),
      y: rng.range(4, 14),
      d: rng.range(0, 0.4),
      r: rng.range(1.2, 2.4),
      rise: rng.range(8, 16),
    })),
  draw(f, i, { t, p }) {
    for (const b of p) {
      const lt = clamp01((t - b.d) / (1 - b.d));
      if (lt <= 0) continue;
      const x = 24 + b.x;
      const y = 24 + b.y - b.rise * lt;
      if (lt < 0.75) ring(f, x, y, b.r, b.r, 1, 0.95 - 0.3 * lt);
      else {
        // Pop.
        for (const [dx, dy] of [
          [-2, 0],
          [2, 0],
          [0, -2],
        ])
          f.g(x + dx, y + dy, 0.8);
      }
    }
  },
};

const statusRoot = {
  key: 'fx_status_root',
  size: [48, 48],
  ramp: 'verdigris',
  role: 'overlay',
  solidOnTop: true,
  durations: [44, 44, 48, 52, 70, 70, 60, 60],
  setup: (rng) =>
    Array.from({ length: 5 }, (_, k) => ({
      x: -10 + k * 5 + rng.range(-1, 1),
      h: rng.range(12, 20),
      curl: rng.sign() * rng.range(2, 4),
    })),
  draw(f, i, { p }) {
    // Tendrils rise from the ground and curl around the legs.
    const grow = [0.25, 0.5, 0.8, 1, 1, 1, 0.8, 0.5][i];
    const fade = i >= 6;
    for (const r of p) {
      const n = Math.round(r.h * grow);
      let px = 24 + r.x;
      let py = 42;
      for (let s = 0; s < n; s++) {
        const u = s / r.h;
        const x = 24 + r.x + Math.sin(u * 5) * r.curl * u;
        const y = 42 - s;
        const hex = fade && s > n - 3 ? R.earth[2] : s % 5 === 0 ? R.verdigris[3] : R.earth[3];
        f.s(x, y, hex);
        f.s(x + 1, y, INK_TONES.line);
        if (s === n - 1) f.g(x, y - 1, 0.8);
        px = x;
        py = y;
      }
      if (n > 3 && !fade) f.s(px - 1, py, INK_TONES.line);
    }
    if (i <= 2) ring(f, 24, 42, 12, 3.5, 1.2, 0.7 - i * 0.2);
  },
};

// ---------------------------------------------------------------- rune ring ------

const RUNES = [
  [
    [0, 0],
    [1, 1],
    [2, 0],
    [1, 2],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
    [2, 2],
  ],
  [
    [1, 0],
    [0, 1],
    [2, 1],
    [1, 2],
  ],
  [
    [0, 0],
    [2, 0],
    [1, 1],
    [1, 2],
  ],
];

const runeRing = {
  key: 'fx_ring',
  size: [64, 64],
  ramp: 'gilt',
  role: 'overlay',
  solidOnTop: false,
  durations: [44, 40, 40, 44, 48, 52, 58, 64],
  draw(f, i, { t }) {
    const cx = 32;
    const cy = 32;
    const k = ease.outCubic(t);
    const r = lerp(18, 23, k);
    const v = [1.1, 0.95, 0.9, 0.8, 0.7, 0.55, 0.42, 0.3][i];
    ring(f, cx, cy, r, r, 1.4, v);
    ring(f, cx, cy, r + 4, r + 4, 1, v * 0.6, { dash: 36, dashPhase: i * 0.5 });
    const rot = i * 0.1;
    for (let n = 0; n < 12; n++) {
      const a = rot + (n / 12) * TAU;
      const rx = cx + Math.cos(a) * (r - 4) - 1;
      const ry = cy + Math.sin(a) * (r - 4) - 1;
      for (const [dx, dy] of RUNES[n % 4]) f.g(rx + dx, ry + dy, v * 0.95);
    }
    if (i <= 3) {
      for (let a = 0; a < TAU; a += 0.035)
        f.s(
          Math.floor(cx + Math.cos(a) * (r - 7)),
          Math.floor(cy + Math.sin(a) * (r - 7)),
          INK_TONES.lineSoft,
        );
    }
  },
};

export const PROC_ANIMS = [
  crit,
  shock,
  shockSmall,
  pierce,
  flurry,
  drain,
  shield,
  buff,
  statusGeneric,
  statusSleep,
  statusSilence,
  statusAcid,
  statusRoot,
  runeRing,
];
export { hexPts, RUNES };
