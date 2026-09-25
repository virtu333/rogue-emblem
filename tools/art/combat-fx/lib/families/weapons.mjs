// Weapon impacts and projectiles: sword, axe, lance, bow (+ thrown weapons, ballista).
// Directional effects are drawn travelling toward +x; the runtime flips or turns them
// in 90-degree steps, so pixels stay exact.
import {
  TAU,
  lerp,
  smooth,
  ease,
  field,
  stroke,
  ring,
  spark,
  sparkle,
  chip,
  line,
  gline,
  disc,
  angleIn,
  arcBand,
  arcBandEdge,
} from '../draw.mjs';
import { ART_RAMPS, INK_TONES } from '../../../../../src/art/combatFx/fxPalette.js';

const R = ART_RAMPS;
const STONE_CHIP = [R.stone[2], R.stone[4], R.stone[5]];
const EARTH_CHIP = [R.earth[2], R.earth[4], R.earth[5]];
const SPLINTER = [R.earth[3], R.earth[4], R.ink[10]];

/**
 * Crescent field with rotation about (cx, cy). The crescent is the part of circle A
 * outside circle B (both given unrotated), swept from angle a0 to a1 around A.
 * fn(u, s) -> intensity (u: tip-to-tip 0..1, s: inner rim 0 -> outer rim 1).
 */
function crescentAt(f, cx, cy, rot, A, B, a0, a1, fn) {
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const R0 = A.r + Math.hypot(A.x - cx, A.y - cy) + 2;
  field(f, cx - R0, cy - R0, cx + R0, cy + R0, (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    const qx = cx + dx * cos - dy * sin;
    const qy = cy + dx * sin + dy * cos;
    const da = Math.hypot(qx - A.x, qy - A.y);
    if (da > A.r) return 0;
    const db = Math.hypot(qx - B.x, qy - B.y);
    if (db < B.r) return 0;
    const ang = Math.atan2(qy - A.y, qx - A.x);
    if (!angleIn(ang, a0, a1)) return 0;
    const span = (((a1 - a0) % TAU) + TAU) % TAU || TAU;
    const u = ((((ang - a0) % TAU) + TAU) % TAU) / span;
    const inner = db - B.r;
    const outer = A.r - da;
    return fn(u, inner / (inner + outer + 1e-6));
  });
}

/** Points along B's rim inside the crescent window (for the ink cut line). */
function cutLine(f, A, B, a0, a1, u0, u1, hex, rot = 0, cx = 0, cy = 0) {
  const steps = 80;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let k = 0; k <= steps; k++) {
    const ang = lerp(a0, a1, lerp(u0, u1, k / steps));
    // Point on A's angle ray that lies on B's rim: sample along the ray.
    for (let r = A.r; r > 0; r -= 0.25) {
      const x = A.x + Math.cos(ang) * r;
      const y = A.y + Math.sin(ang) * r;
      if (Math.hypot(x - B.x, y - B.y) <= B.r + 0.5) {
        const dx = x - cx;
        const dy = y - cy;
        f.s(Math.floor(cx + dx * cos - dy * sin), Math.floor(cy + dx * sin + dy * cos), hex);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- sword ----------

const slash = {
  key: 'fx_slash',
  size: [48, 48],
  ramp: 'steel',
  role: 'impact',
  directional: true,
  solidOnTop: true,
  durations: [40, 32, 32, 34, 38, 42, 48],
  setup: (rng) => ({
    sparks: Array.from({ length: 4 }, () => ({
      a: rng.range(0.1, 1.1),
      d: rng.range(8, 14),
    })),
  }),
  draw(f, i, { t, p }) {
    // A diagonal cut through the body: a wide circle centred low-left of the target,
    // so the blade's arc crosses from the upper-left to the lower-right.
    const cx = 7;
    const cy = 38;
    const ro = 25;
    const a0 = -1.8;
    const a1 = 0.12;
    // The blade keeps travelling a little after contact.
    const rot = -0.06 + ease.outCubic(t) * 0.14;
    const thin = i <= 2 ? 1 : lerp(1, 0.5, ease.outQuad((i - 2) / 4));
    // Comet crescent: a hair at the tail, swelling to the head, a sharp tip.
    const thick = (u) =>
      9 * thin * Math.min(1, (u / 0.72) ** 0.85) * Math.min(1, ((1 - u) / 0.1) ** 0.6);
    const tail = i <= 2 ? -1 : ease.outQuad((i - 2) / 4) * 1.12 - 0.08;
    const dim = [1.05, 1, 0.92, 0.78, 0.62, 0.46, 0.32][i];
    arcBand(f, cx, cy, rot, ro, a0, a1, thick, (u, s) => {
      const sweep = i <= 2 ? 0.45 + 0.55 * u : smooth(tail - 0.2, tail + 0.12, u);
      return (0.28 + 0.8 * s ** 1.3) * sweep * dim;
    });
    // Afterimage: the same crescent a beat earlier in the swing.
    if (i <= 2) {
      const ghost = [0.62, 0.46, 0.26][i];
      arcBand(
        f,
        cx,
        cy,
        rot - 0.3,
        ro - 1,
        a0,
        a1,
        (u) => thick(u) * 0.7,
        (u, s) => (0.3 + 0.6 * s) * (0.35 + 0.65 * u) * ghost,
      );
    }
    // The cut: an ink line on the inner edge while the arc is hot.
    if (i <= 1) arcBandEdge(f, cx, cy, rot, ro, a0, a1, thick, 0.3, 0.9, INK_TONES.line, 0.5);
    // Steel sparks thrown off the head.
    if (i >= 1) {
      const k = ease.outCubic((i - 1) / 5);
      const ha = rot + a1 - 0.18;
      const hx = cx + Math.cos(ha) * (ro - 2);
      const hy = cy + Math.sin(ha) * (ro - 2);
      for (const s of p.sparks) {
        const x = hx + Math.cos(s.a) * s.d * k;
        const y = hy + Math.sin(s.a) * s.d * k;
        spark(f, x, y, s.a, lerp(3, 1, k), lerp(1, 0.35, k));
      }
    }
  },
};

// ---------------------------------------------------------------- axe ------------

const chop = {
  key: 'fx_chop',
  size: [64, 64],
  ramp: 'blood',
  role: 'impact',
  directional: true,
  solidOnTop: true,
  durations: [46, 30, 32, 36, 40, 44, 50, 56],
  setup: (rng) => ({
    chips: Array.from({ length: 8 }, (_, k) => ({
      vx: rng.range(-0.6, 2.6),
      vy: -rng.range(1.2, 3.4),
      size: rng.int(2, 3),
      shape: rng.int(0, 2),
      ramp: k % 3 === 0 ? EARTH_CHIP : STONE_CHIP,
      x: rng.range(-4, 4),
    })),
    embers: Array.from({ length: 5 }, () => ({
      a: rng.range(-2.6, -0.4),
      d: rng.range(10, 20),
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 32;
    const cy = 30;
    const settle = ease.outCubic(t);
    const A = { x: 26, y: 30 + settle * 2, r: 24 };
    const B = { x: 15 + settle * 5, y: 30 + settle * 2, r: 24 };
    const a0 = -1.78;
    const a1 = 1.78;
    const tail = i === 0 ? -1 : ease.outQuad(t) * 1.2 - 0.12;
    const dim = i === 0 ? 1 : 1 - 0.62 * t;
    crescentAt(f, cx, cy, 0.18, A, B, a0, a1, (u, s) => {
      const sweep = i === 0 ? 0.5 + 0.5 * u ** 0.8 : smooth(tail - 0.25, tail + 0.05, u);
      const tip = Math.sin(Math.PI * u) ** 0.3;
      return (0.26 + 0.8 * s ** 1.4) * sweep * tip * dim;
    });
    if (i === 1) {
      crescentAt(
        f,
        cx,
        cy,
        -0.3,
        A,
        B,
        a0,
        a1,
        (u, s) => (0.2 + 0.5 * s) * 0.35 * Math.sin(Math.PI * u),
      );
    }
    // The cleft: a heavy ink gash down the middle of the wedge.
    if (i <= 2) {
      const mid = { x: B.x + 5, y: B.y, r: B.r + 0.5 };
      const u0 = i === 0 ? 0.28 : 0.4 + i * 0.12;
      cutLine(f, A, mid, a0, a1, u0, 0.92, INK_TONES.line, 0.18, cx, cy);
      cutLine(
        f,
        A,
        { ...mid, r: mid.r + 1 },
        a0,
        a1,
        u0 + 0.04,
        0.9,
        INK_TONES.lineSoft,
        0.18,
        cx,
        cy,
      );
    }
    // Debris: stone and earth chips thrown from the point of impact, falling back.
    if (i >= 1) {
      const k = (i - 1) * 3.2;
      for (const c of p.chips) {
        const x = 38 + c.x + c.vx * k;
        const y = 44 + c.vy * k + 0.36 * k * k * 0.5;
        if (y < 62) chip(f, x, y, c.size, c.ramp, c.shape);
      }
      const e = ease.outCubic((i - 1) / 6);
      for (const m of p.embers) {
        const x = 38 + Math.cos(m.a) * m.d * e;
        const y = 42 + Math.sin(m.a) * m.d * e;
        spark(f, x, y, m.a, lerp(3, 1, e), lerp(0.95, 0.3, e));
      }
    }
  },
};

// ---------------------------------------------------------------- lance ----------

const thrust = {
  key: 'fx_thrust',
  size: [64, 48],
  ramp: 'steel',
  role: 'impact',
  directional: true,
  solidOnTop: false,
  anchor: [0.56, 0.5],
  durations: [40, 30, 32, 36, 40, 46, 52],
  draw(f, i, { t }) {
    const y = 24;
    const tipX = 38;
    const tail = i === 0 ? 2 : lerp(2, tipX - 2, ease.outQuad(t));
    const dim = i === 0 ? 1 : 1 - 0.7 * t;
    if (tipX - tail > 2)
      stroke(f, tail, y, tipX, y, 1, i === 0 ? 5 : 3, 0.28 * dim, 1.02 * dim, 1.6);
    if (i === 0) {
      // Speed lines trailing the streak.
      gline(f, 8, y - 4, 26, y - 4, 0.22, 0.5);
      gline(f, 12, y + 4, 28, y + 4, 0.22, 0.5);
      sparkle(f, tipX + 1, y, 5, 1.05);
      disc(f, tipX + 1, y, 2.2, 1.05);
    }
    // Shock ring released at the tip, seen edge-on (a tall ellipse).
    if (i >= 1) {
      const k = ease.outQuart((i - 1) / 5);
      const r = lerp(4, 15, k);
      ring(f, tipX + 1 + k * 4, y, r * 0.55, r, lerp(2.6, 1, k), lerp(0.95, 0.12, k ** 0.8));
      if (i <= 2) {
        const ri = r - 2;
        for (let a = 0; a < TAU; a += 0.05) {
          f.s(
            Math.floor(tipX + 1 + k * 4 + Math.cos(a) * ri * 0.55),
            Math.floor(y + Math.sin(a) * ri),
            INK_TONES.line,
          );
        }
      }
      if (i <= 3) sparkle(f, tipX + 1, y, Math.max(1, 4 - i), 0.9 - 0.15 * i);
    }
  },
};

// ---------------------------------------------------------------- bow ------------

const arrowHit = {
  key: 'fx_arrow',
  size: [32, 32],
  ramp: 'steel',
  role: 'impact',
  directional: true,
  solidOnTop: true,
  durations: [36, 30, 34, 38, 44, 50],
  setup: (rng) => ({
    splinters: Array.from({ length: 5 }, () => ({
      a: Math.PI + rng.range(-0.95, 0.95),
      d: rng.range(6, 11),
      shape: rng.int(0, 2),
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 17;
    const cy = 16;
    if (i === 0) {
      // The held impact: a flare along the line of flight, a hot point, a shock ring.
      stroke(f, cx - 12, cy, cx + 7, cy, 1, 3, 0.55, 1.1, 1.2);
      sparkle(f, cx, cy, 6, 1.1);
      disc(f, cx, cy, 2.6, 1.15);
      ring(f, cx, cy, 3, 5, 1.2, 0.7);
    } else {
      const k = ease.outCubic(t);
      ring(f, cx, cy, lerp(3, 9, k) * 0.6, lerp(3, 9, k), lerp(2, 1, k), lerp(0.95, 0.3, k));
      if (i <= 2) sparkle(f, cx, cy, 5 - i * 2, 0.95);
      // Speed lines thrown back along the flight.
      if (i <= 2)
        for (const dy of [-3, 0, 3])
          gline(f, cx - 4 - i * 3, cy + dy, cx - 9 - i * 3, cy + dy * 1.4, 0.8 - i * 0.2, 0.2);
    }
    // The shaft stands in the target for the first beats (matter, earth + pale fletching).
    if (i <= 2) {
      const back = i === 2 ? 1 : 0;
      line(f, cx - 9 - back, cy - back, cx - 2, cy, R.earth[4]);
      line(f, cx - 9 - back, cy + 1 - back, cx - 3, cy + 1, R.earth[2]);
      f.s(cx - 10 - back, cy - 1 - back, R.ink[9]);
      f.s(cx - 10 - back, cy + 1 - back, R.ink[9]);
      f.s(cx - 11 - back, cy - 1 - back, R.ink[8]);
    }
    const k = ease.outCubic(t);
    for (const s of p.splinters) {
      const x = cx + Math.cos(s.a) * s.d * k;
      const y = cy + Math.sin(s.a) * s.d * k + k * k * 3;
      if (i < 5) chip(f, x, y, s.shape === 2 ? 2 : 1, SPLINTER, s.shape, i < 3);
    }
  },
};

// ---------------------------------------------------------------- projectiles ----

const projArrow = {
  key: 'fx_proj_arrow',
  size: [24, 7],
  ramp: 'steel',
  role: 'projectile',
  directional: true,
  anchor: [22 / 24, 0.5],
  durations: [100],
  draw(f) {
    const y = 3;
    // Faint trail so the arrow reads at night.
    gline(f, 0, y, 7, y, 0.14, 0.4);
    line(f, 6, y, 19, y, R.earth[4]);
    line(f, 7, y + 1, 18, y + 1, R.earth[2]);
    // Fletching (pale), key-lit from the upper-left.
    f.s(5, y - 2, R.ink[10]);
    f.s(6, y - 1, R.ink[10]);
    f.s(4, y - 2, R.ink[9]);
    f.s(5, y + 2, R.ink[9]);
    f.s(6, y + 2, R.ink[8]);
    f.s(4, y + 3, R.ink[8]);
    // Iron head with an ink edge.
    f.s(20, y - 1, R.steel[5]);
    f.s(20, y, R.steel[4]);
    f.s(21, y, R.steel[5]);
    f.s(20, y + 1, R.steel[3]);
    f.s(22, y, R.ink[11]);
    f.s(19, y - 1, INK_TONES.line);
    f.s(19, y + 1, INK_TONES.line);
    f.s(21, y - 1, INK_TONES.line);
    f.s(21, y + 1, INK_TONES.line);
    f.g(22, y, 0.9);
  },
};

const projBolt = {
  key: 'fx_proj_bolt',
  size: [34, 11],
  ramp: 'steel',
  role: 'projectile',
  directional: true,
  anchor: [32 / 34, 0.5],
  durations: [100],
  draw(f) {
    const y = 5;
    gline(f, 0, y, 10, y, 0.14, 0.45);
    for (let x = 7; x <= 26; x++) {
      f.s(x, y - 1, INK_TONES.line);
      f.s(x, y, R.earth[4]);
      f.s(x, y + 1, R.earth[2]);
      f.s(x, y + 2, INK_TONES.line);
    }
    // Vanes.
    for (let k = 0; k < 4; k++) {
      f.s(6 + k, y - 2 - (k >> 1), R.ink[9]);
      f.s(6 + k, y + 3 + (k >> 1), R.ink[8]);
    }
    // Iron head: a lit wedge.
    for (let x = 27; x <= 32; x++) {
      const h = Math.max(0, 3 - Math.floor((x - 27) / 2));
      for (let dy = -h; dy <= h + 1; dy++) {
        const edge = dy === -h || dy === h + 1;
        f.s(x, y + dy, edge ? INK_TONES.line : dy <= 0 ? R.stone[5] : R.stone[3]);
      }
    }
    f.s(33, y, R.ink[11]);
    f.g(33, y, 0.9);
  },
};

const projJavelin = {
  key: 'fx_proj_javelin',
  size: [28, 7],
  ramp: 'steel',
  role: 'projectile',
  directional: true,
  anchor: [26 / 28, 0.5],
  durations: [100],
  draw(f) {
    const y = 3;
    gline(f, 0, y, 6, y, 0.14, 0.38);
    line(f, 3, y, 21, y, R.earth[4]);
    line(f, 4, y + 1, 20, y + 1, R.earth[2]);
    for (let x = 22; x <= 26; x++) {
      const h = x < 25 ? 1 : 0;
      for (let dy = -h; dy <= h; dy++)
        f.s(x, y + dy, dy < 0 ? R.steel[5] : dy > 0 ? R.steel[3] : R.steel[4]);
      f.s(x, y - h - 1, INK_TONES.line);
      f.s(x, y + h + 1, INK_TONES.line);
    }
    f.s(27, y, R.ink[11]);
    f.g(27, y, 0.9);
  },
};

/** Hand axe, spinning: four quarter turns drawn exactly (no resampling). */
function drawHandAxe(f, quarter) {
  const pts = [];
  // Handle from (4,12) to (10,6); head around (10,4)-(13,8).
  const handle = [
    [4, 12],
    [5, 11],
    [6, 10],
    [7, 9],
    [8, 8],
    [9, 7],
  ];
  for (const [x, y] of handle) pts.push([x, y, R.earth[4]], [x + 1, y + 1, R.earth[2]]);
  const head = [
    [10, 3, R.steel[5]],
    [11, 3, R.steel[5]],
    [12, 4, R.steel[4]],
    [13, 5, R.steel[4]],
    [13, 6, R.steel[3]],
    [12, 7, R.steel[3]],
    [11, 4, R.steel[4]],
    [11, 5, R.steel[4]],
    [12, 5, R.steel[4]],
    [12, 6, R.steel[3]],
    [10, 4, R.stone[4]],
    [10, 5, R.stone[3]],
    [11, 6, R.stone[3]],
  ];
  pts.push(...head);
  const rot = ([x, y]) => {
    let [a, b] = [x - 8, y - 8];
    for (let q = 0; q < quarter; q++) [a, b] = [-b, a];
    return [a + 8, b + 8];
  };
  const occupied = new Set();
  for (const pt of pts) {
    const [x, y] = rot(pt);
    occupied.add(`${x},${y}`);
  }
  for (const k of occupied) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (!occupied.has(`${x + dx},${y + dy}`)) f.s(x + dx, y + dy, INK_TONES.line);
  }
  for (const pt of pts) {
    const [x, y] = rot(pt);
    f.s(x, y, pt[2]);
  }
}

const projAxe = {
  key: 'fx_proj_axe',
  size: [16, 16],
  ramp: 'steel',
  role: 'projectile',
  loop: true,
  durations: [40, 40, 40, 40],
  draw(f, i) {
    // Motion arc: a faint crescent behind the spinning head.
    ring(f, 8, 8, 7, 7, 1.2, 0.3, { a0: (i * Math.PI) / 2 + 2.2, a1: (i * Math.PI) / 2 + 3.6 });
    drawHandAxe(f, i);
  },
};

const projBlade = {
  key: 'fx_proj_blade',
  size: [16, 26],
  ramp: 'steel',
  role: 'projectile',
  directional: true,
  loop: true,
  anchor: [0.75, 0.5],
  durations: [50, 50],
  draw(f, i) {
    const A = { x: 6, y: 13, r: 10 };
    const B = { x: 2 + i, y: 13, r: 10 };
    crescentAt(
      f,
      8,
      13,
      0,
      A,
      B,
      -1.6,
      1.6,
      (u, s) => (0.35 + 0.7 * s) * Math.sin(Math.PI * u) ** 0.4,
    );
  },
};

const moteAnim = {
  key: 'fx_mote',
  size: [3, 3],
  ramp: 'white',
  role: 'mote',
  durations: [100, 100, 100, 100],
  draw(f, i) {
    const W = '#ffffff';
    if (i === 0) f.s(1, 1, W);
    else if (i === 1) {
      f.s(1, 1, W);
      f.s(2, 1, W);
      f.s(1, 2, W);
      f.s(2, 2, W);
    } else if (i === 2) {
      f.s(1, 0, W);
      f.s(0, 1, W);
      f.s(1, 1, W);
      f.s(2, 1, W);
      f.s(1, 2, W);
    } else {
      f.s(0, 1, W);
      f.s(1, 1, W);
      f.s(2, 1, W);
    }
  },
};

export const WEAPON_ANIMS = [
  slash,
  chop,
  thrust,
  arrowHit,
  projArrow,
  projBolt,
  projJavelin,
  projAxe,
  projBlade,
  moteAnim,
];
export { crescentAt, cutLine };
