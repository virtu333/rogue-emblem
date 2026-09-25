// Signature (Legendary weapon art) strikes, the Entity's unlight and the boss enrage.
// 96 x 96, 12 frames: climaxes, but each still keeps to one ramp; the runtime layers
// a rune ring, shock ring and motes over them in their own colours.
import {
  TAU,
  lerp,
  clamp01,
  ease,
  field,
  solidField,
  stroke,
  polyline,
  ring,
  disc,
  spark,
  sparkle,
  mote,
  gline,
  line,
  chip,
  jagged,
  arcBand,
  arcBandEdge,
  grain,
} from '../draw.mjs';
import { drawUnlight, blobRadius } from './magic.mjs';
import { RUNES } from './procs.mjs';
import { ART_RAMPS, INK_TONES } from '../../../../../src/art/combatFx/fxPalette.js';

const R = ART_RAMPS;
const SIG = [96, 96];
const SIG_DUR = [60, 40, 40, 44, 46, 50, 54, 58, 62, 66, 70, 76];

// ---------------------------------------------------------------- sword ----------

const sigSword = {
  key: 'fx_sig_sword',
  size: SIG,
  ramp: 'steel',
  role: 'signature',
  solidOnTop: true,
  durations: SIG_DUR,
  setup: (rng) => ({
    sparks: Array.from({ length: 14 }, () => ({
      a: rng.range(0, TAU),
      d: rng.range(14, 36),
      s: rng() < 0.3,
    })),
  }),
  draw(f, i, { p }) {
    const cx = 48;
    const cy = 48;
    const ax = 8;
    const ay = 70;
    const bx = 88;
    const by = 26;
    const len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const split = [0, 0, 1, 2, 3.5, 5, 6.5, 8, 9, 10, 11, 12][i];
    const heat = [1.15, 1.05, 1, 0.92, 0.84, 0.74, 0.64, 0.54, 0.44, 0.36, 0.28, 0.2][i];
    // The cut: a haze, two hot lips, and ink between them.
    if (i <= 1) stroke(f, ax, ay, bx, by, 11, 11, 0.5, 0.5, 2);
    for (const side of [-1, 1]) {
      const o = 1.5 + split;
      stroke(
        f,
        ax + nx * o * side,
        ay + ny * o * side,
        bx + nx * o * side,
        by + ny * o * side,
        1.4,
        1.4,
        heat,
        heat * 0.8,
        1,
      );
    }
    if (i <= 6) line(f, ax + 6, ay - 3, bx - 6, by + 3, INK_TONES.line, i <= 1 ? 2 : 1);
    // Two great crescents crossing (the X).
    if (i >= 1 && i <= 8) {
      const k = (i - 1) / 7;
      const tail = k < 0.25 ? -1 : ease.outQuad((k - 0.25) / 0.75) * 1.1 - 0.05;
      const dim = 1 - 0.7 * k;
      for (const [rot, mir] of [
        [-0.9, 0],
        [2.25, 1],
      ]) {
        const thick = (u) =>
          11 * Math.min(1, (u / 0.75) ** 0.9) * Math.min(1, ((1 - u) / 0.1) ** 0.6);
        arcBand(f, cx + (mir ? 4 : -4), cy, rot + k * 0.25, 34, -1.3, 1.5, thick, (u, s) => {
          const sweep = tail < 0 ? 0.5 + 0.5 * u : clamp01((u - tail) / 0.2);
          return (0.3 + 0.8 * s ** 1.3) * sweep * dim;
        });
        if (i <= 2)
          arcBandEdge(
            f,
            cx + (mir ? 4 : -4),
            cy,
            rot + k * 0.25,
            34,
            -1.3,
            1.5,
            thick,
            0.35,
            0.9,
            INK_TONES.line,
            0.5,
          );
      }
    }
    if (i >= 3) {
      const k = ease.outCubic((i - 3) / 8);
      for (const s of p.sparks) {
        const x = cx + Math.cos(s.a) * s.d * k;
        const y = cy + Math.sin(s.a) * s.d * k - (s.s ? 6 * k : 0);
        if (s.s) sparkle(f, x, y, 1, 1 - 0.6 * k);
        else spark(f, x, y, s.a, lerp(4, 1, k), 1.05 - 0.7 * k);
      }
    }
  },
};

// ---------------------------------------------------------------- lance ----------

const sigLance = {
  key: 'fx_sig_lance',
  size: SIG,
  ramp: 'steel',
  role: 'signature',
  directional: true,
  solidOnTop: false,
  anchor: [0.5, 0.5],
  durations: SIG_DUR,
  setup: (rng) => ({
    motes: Array.from({ length: 10 }, () => ({
      x: rng.range(30, 90),
      y: rng.range(-14, 14),
      s: rng.int(1, 2),
    })),
  }),
  draw(f, i, { t, p }) {
    const y = 48;
    const tip = 64;
    const tail = i === 0 ? 0 : lerp(0, tip - 6, ease.outQuad(clamp01((i - 1) / 5)));
    const heat = i === 0 ? 1.15 : Math.max(0, 1 - 0.13 * i);
    if (tip - tail > 3 && heat > 0.1)
      stroke(f, tail, y, tip, y, 2, i <= 1 ? 11 : 7, heat * 0.3, heat, 1.5);
    // Spike through: a thin line past the target to the frame's edge.
    if (i <= 5) gline(f, tip, y, 95, y, heat * 0.95, heat * 0.3);
    if (i <= 1) {
      for (const [oy, x0, x1] of [
        [-9, 6, 40],
        [-5, 14, 50],
        [5, 10, 46],
        [9, 18, 38],
      ])
        gline(f, x0, y + oy, x1, y + oy, 0.25, 0.65);
      sparkle(f, tip + 1, y, 9, 1.15);
      disc(f, tip + 1, y, 4, 1.15, 0.8);
    }
    // Three shock rings stepping outward along the line.
    for (let j = 0; j < 3; j++) {
      const age = i - (1 + j * 2);
      if (age < 0 || age > 6) continue;
      const k = ease.outQuart(age / 6);
      const r = lerp(5, 22 - j * 3, k);
      const x = tip - 8 + j * 12;
      ring(f, x, y, r * 0.5, r, lerp(3, 1, k), lerp(1.05, 0.25, k));
    }
    if (i >= 5) {
      const k = (i - 5) / 6;
      for (const m of p.motes) mote(f, m.x + k * 8, y + m.y * (0.5 + k), m.s, 0.9 - 0.6 * k);
    }
    void t;
  },
};

// ---------------------------------------------------------------- axe ------------

const sigAxe = {
  key: 'fx_sig_axe',
  size: SIG,
  ramp: 'blood',
  role: 'signature',
  solidOnTop: true,
  durations: SIG_DUR,
  setup: (rng) => ({
    crackL: jagged(48, 80, 8, 82, 7, 3.5, rng),
    crackR: jagged(48, 80, 88, 78, 7, 3.5, rng),
    chips: Array.from({ length: 14 }, (_, k) => ({
      x: rng.range(-18, 18),
      vx: rng.range(-2.4, 2.4),
      vy: -rng.range(2.5, 5.5),
      s: rng.int(2, 4),
      shape: rng.int(0, 2),
      ramp: k % 3 ? [R.stone[2], R.stone[4], R.stone[5]] : [R.earth[2], R.earth[4], R.earth[5]],
    })),
    embers: Array.from({ length: 10 }, () => ({
      x: rng.range(-30, 30),
      rise: rng.range(10, 30),
      ph: rng.range(0, TAU),
    })),
  }),
  draw(f, i, { p }) {
    const cx = 48;
    // The great cleave: a vertical wedge that lands on the target.
    if (i <= 6) {
      const k = i / 6;
      const tail = i <= 1 ? -1 : ease.outQuad((i - 1) / 5) * 1.15 - 0.1;
      const thick = (u) =>
        17 * (1 - 0.5 * k) * Math.min(1, (u / 0.7) ** 0.8) * Math.min(1, ((1 - u) / 0.12) ** 0.5);
      arcBand(f, 20, 44, 0, 42, -1.25, 0.95, thick, (u, s) => {
        const sweep = tail < 0 ? 0.45 + 0.55 * u : clamp01((u - tail) / 0.22);
        return (0.28 + 0.85 * s ** 1.4) * sweep * (1 - 0.6 * k);
      });
      if (i <= 2) arcBandEdge(f, 20, 44, 0, 42, -1.25, 0.95, thick, 0.3, 0.92, INK_TONES.line, 3);
    }
    // Ground fissure: ink crack with heat inside, cooling.
    if (i >= 1) {
      const k = clamp01((i - 1) / 10);
      const reach = ease.outCubic(clamp01((i - 1) / 3));
      for (const crack of [p.crackL, p.crackR]) {
        const n = Math.max(2, Math.round(crack.length * reach));
        const pts = crack.slice(0, n);
        for (let s = 0; s + 1 < pts.length; s++)
          line(f, ...pts[s], ...pts[s + 1], INK_TONES.line, 2);
        polyline(f, pts, 1, 1.05 * (1 - k));
        if (k < 0.6) polyline(f, pts, 4, 0.4 * (1 - k / 0.6));
      }
    }
    // Debris thrown high and falling back.
    if (i >= 1) {
      const s = (i - 1) * 2.4;
      for (const c of p.chips) {
        const x = cx + c.x + c.vx * s;
        const y = 78 + c.vy * s + 0.3 * s * s;
        if (y < 88) chip(f, x, y, c.s, c.ramp, c.shape);
      }
      const k = ease.outQuad((i - 1) / 10);
      for (const e of p.embers)
        mote(f, cx + e.x + Math.sin(e.ph + k * 5) * 2, 78 - e.rise * k, 1, 1 - 0.7 * k);
    }
    if (i === 0) disc(f, cx, 78, 8, 1.1, 0.5);
  },
};

// ---------------------------------------------------------------- bow ------------

const sigBow = {
  key: 'fx_sig_bow',
  size: SIG,
  ramp: 'gilt',
  role: 'signature',
  durations: SIG_DUR,
  setup: (rng) => ({
    hits: Array.from({ length: 7 }, (_, k) => {
      const a = rng.range(0, TAU);
      const d = k === 6 ? 0 : rng.range(6, 22);
      return { x: 48 + Math.cos(a) * d, y: 58 + Math.sin(a) * d * 0.55 };
    }),
    motes: Array.from({ length: 12 }, () => ({
      x: rng.range(-24, 24),
      y: rng.range(-6, 10),
      rise: rng.range(10, 26),
    })),
  }),
  draw(f, i, { p }) {
    const dx = 0.52;
    const dy = 1;
    const n = Math.hypot(dx, dy);
    p.hits.forEach((h, k) => {
      const age = i - k;
      if (age < -1 || age > 3) return;
      if (age === -1) {
        // In flight: a falling streak of light.
        const hx = h.x - (dx / n) * 20;
        const hy = h.y - (dy / n) * 20;
        stroke(f, hx - (dx / n) * 22, hy - (dy / n) * 22, hx, hy, 0.6, 2.2, 0.35, 1.05, 1.3);
        return;
      }
      if (age === 0) {
        stroke(f, h.x - (dx / n) * 16, h.y - (dy / n) * 16, h.x, h.y, 0.6, 2.2, 0.4, 1.1, 1.3);
        sparkle(f, h.x, h.y, 4, 1.15);
      } else {
        const r = age * 3.2;
        ring(f, h.x, h.y, r, r * 0.55, 1.2, 0.9 - age * 0.22);
      }
    });
    if (i >= 7) {
      const k = (i - 7) / 4;
      const beams = 1 - k;
      const cx = 48;
      const cy = 58;
      if (beams > 0.05) {
        stroke(f, cx, cy - 40 * beams, cx, cy + 22 * beams, 3, 3, 0.62, 0.62, 2);
        gline(f, cx, cy - 40 * beams, cx, cy + 22 * beams, 1.1);
        stroke(f, cx - 28 * beams, cy, cx + 28 * beams, cy, 3, 3, 0.6, 0.6, 2);
        gline(f, cx - 28 * beams, cy, cx + 28 * beams, cy, 1.05);
        disc(f, cx, cy, 4 * beams + 1, 1.2, 0.8);
      }
      ring(
        f,
        cx,
        cy,
        lerp(8, 30, ease.outCubic(k)),
        lerp(8, 30, ease.outCubic(k)) * 0.55,
        1.4,
        0.8 * (1 - k),
      );
      for (const m of p.motes) mote(f, cx + m.x, cy + m.y - m.rise * k, 1, 1 - 0.6 * k);
    }
  },
};

// ---------------------------------------------------------------- magic ----------

const sigMagic = {
  key: 'fx_sig_magic',
  size: SIG,
  ramp: 'ember',
  role: 'signature',
  anchor: [0.5, 0.62],
  durations: SIG_DUR,
  setup: (rng) => ({
    cinders: Array.from({ length: 18 }, () => ({
      x: rng.range(-12, 12),
      rise: rng.range(20, 60),
      ph: rng.range(0, TAU),
      d: rng.range(0, 0.4),
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 48;
    const gy = 76;
    // Rune circle on the ground.
    const cv = i <= 7 ? [1.1, 1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6][i] : lerp(0.5, 0.15, (i - 8) / 3);
    const crx = i === 0 ? 30 : 34;
    ring(f, cx, gy, crx, crx * 0.34, 1.6, cv);
    ring(f, cx, gy, crx - 6, (crx - 6) * 0.34, 1, cv * 0.7);
    for (let n = 0; n < 14; n++) {
      const a = (n / 14) * TAU + i * 0.06;
      const rx = cx + Math.cos(a) * (crx - 3) - 1;
      const ry = gy + Math.sin(a) * (crx - 3) * 0.34 - 1;
      for (const [dx, dy] of RUNES[n % 4]) if (dy < 2) f.g(rx + dx, ry + dy, cv * 0.9);
    }
    // Pillar.
    if (i >= 1 && i <= 9) {
      const k = (i - 1) / 8;
      const w = i <= 4 ? lerp(8, 22, (i - 1) / 3) : lerp(22, 2, (i - 4) / 5);
      const top = i <= 2 ? lerp(gy - 10, 2, (i - 1) / 1) : 2;
      const heat = 1.12 - 0.5 * k;
      field(f, cx - w, top - 2, cx + w, gy + 2, (px, py) => {
        const hw = w / 2 + Math.sin(py * 0.6 + i * 1.3) * (w > 6 ? 1.2 : 0.3);
        const d = Math.abs(px - cx);
        if (d > hw || py < top || py > gy + 1) return 0;
        return heat * (0.45 + 0.55 * (1 - d / hw) ** 1.2);
      });
      if (i <= 3) disc(f, cx, gy, 10, 1.1, 0.6);
    }
    if (i >= 2) {
      const k = ease.outQuad((i - 2) / 9);
      for (const c of p.cinders) {
        const lt = clamp01((k - c.d) / (1 - c.d));
        if (lt <= 0) continue;
        mote(f, cx + c.x + Math.sin(c.ph + lt * 6) * 3, gy - 6 - c.rise * lt, 1, 1.05 - 0.7 * lt);
      }
    }
    void t;
  },
};

// ---------------------------------------------------------------- entity ---------

const sigEntity = {
  key: 'fx_sig_entity',
  size: SIG,
  ramp: 'unlight',
  role: 'signature',
  solidOnTop: true,
  durations: SIG_DUR,
  setup: (rng) => ({
    harm: [2, 3, 5, 7, 11].map((k) => ({ k, amp: rng.range(0.04, 0.12), ph: rng.range(0, TAU) })),
    tendrils: Array.from({ length: 9 }, (_, k) => ({
      a: (k / 9) * TAU + rng.range(-0.25, 0.25),
      len: rng.range(12, 22),
      curl: rng.sign() * rng.range(0.6, 1.2),
      w: rng.range(3, 5),
    })),
    sparks: Array.from({ length: 12 }, () => ({ a: rng.range(0, TAU), r: rng.range(20, 40) })),
  }),
  draw(f, i, { p }) {
    const cx = 48;
    const cy = 50;
    const base = [20, 22, 21, 19, 16, 13, 10, 7, 4.5, 3, 2, 1.5][i];
    const reach = [1, 1.1, 1.05, 0.9, 0.75, 0.6, 0.45, 0.3, 0.15, 0, 0, 0][i];
    const rim = [1, 0.9, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.3][i];
    // The image splits: violet copies of the maw's edge, offset left and right.
    if (i >= 1 && i <= 6) {
      const off = [0, 5, 4, 3, 3, 2, 1][i];
      for (const side of [-1, 1])
        field(
          f,
          cx - base * 1.6 - 8,
          cy - base * 1.6,
          cx + base * 1.6 + 8,
          cy + base * 1.6,
          (px, py) => {
            const dx = px - (cx + side * off);
            const dy = py - cy;
            const r = Math.hypot(dx, dy);
            const br = blobRadius(Math.atan2(dy, dx), base, p.harm);
            return Math.abs(r - br) < 0.8 ? 0.62 : 0;
          },
        );
    }
    drawUnlight(f, cx, cy, base, p.harm, p.tendrils, reach, -(i / 11) * 1.6, rim);
    // Violet sparks spiralling in.
    const k = ease.inQuad(i / 11);
    for (const s of p.sparks) {
      const r = s.r * (1 - k);
      const a = s.a + k * 2.2;
      if (r > base + 2) mote(f, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 0.85);
    }
    if (i >= 9) {
      const rr = (i - 8) * 9;
      ring(f, cx, cy, rr, rr, 1.4, 0.9 - (i - 9) * 0.25);
      f.s(cx, cy, INK_TONES.unlightCore);
    }
  },
};

// ---------------------------------------------------------------- enrage ---------

const sigEnrage = {
  key: 'fx_sig_enrage',
  size: SIG,
  ramp: 'blood',
  role: 'signature',
  anchor: [0.5, 0.62],
  solidOnTop: false,
  durations: [60, 56, 56, 56, 58, 60, 62, 64, 66, 70, 74, 80],
  setup: (rng) => ({
    tongues: Array.from({ length: 11 }, (_, k) => ({
      a: (k / 11) * TAU + rng.range(-0.15, 0.15),
      len: rng.range(12, 22),
      ph: rng.range(0, TAU),
    })),
    sparks: Array.from({ length: 12 }, () => ({
      x: rng.range(-20, 20),
      rise: rng.range(20, 44),
      ph: rng.range(0, TAU),
    })),
    smoke: Array.from({ length: 5 }, () => ({
      x: rng.range(-18, 18),
      r: rng.range(4, 7),
      d: rng.range(0, 0.3),
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 48;
    const cy = 60;
    if (i <= 2) ring(f, cx, cy, 20 + i * 8, (20 + i * 8) * 0.4, 2.5 - i * 0.6, 1.05 - i * 0.3);
    const grow = i <= 3 ? ease.outBack(i / 3) : 1;
    const fade = i >= 8 ? 1 - (i - 8) / 4 : 1;
    // Crown of flame around the boss, back half dimmer (depth).
    for (const g of p.tongues) {
      const bx = cx + Math.cos(g.a) * 20;
      const by = cy + Math.sin(g.a) * 8;
      const back = Math.sin(g.a) < 0 ? 0.7 : 1;
      const flick = 0.75 + 0.25 * Math.sin(g.ph + i * 1.9);
      const len = g.len * grow * flick * (0.4 + 0.6 * fade);
      const tx = bx + Math.sin(g.ph + i) * 2;
      const ty = by - len;
      stroke(f, bx, by, tx, ty, 5, 0.6, 1.05 * back * fade, 0.45 * back * fade);
    }
    if (i >= 1) {
      const k = ease.outQuad(t);
      for (const s of p.sparks)
        mote(f, cx + s.x + Math.sin(s.ph + k * 7) * 2, cy - 4 - s.rise * k, 1, 1.05 - 0.6 * k);
    }
    if (i >= 4) {
      const k = (i - 4) / 7;
      for (const s of p.smoke) {
        const lt = clamp01((k - s.d) / (1 - s.d));
        if (lt <= 0) continue;
        const sx = cx + s.x;
        const sy = cy - 26 - lt * 18;
        const r = s.r * (1 - 0.3 * lt);
        solidField(
          f,
          sx - r,
          sy - r,
          sx + r,
          sy + r,
          (px, py, x, y) => Math.hypot(px - sx, py - sy) <= r && 1 - grain(x, y) < 0.55 - 0.35 * lt,
          INK_TONES.lineEdge,
        );
      }
    }
  },
};

export const SIGNATURE_ANIMS = [sigSword, sigLance, sigAxe, sigBow, sigMagic, sigEntity, sigEnrage];
