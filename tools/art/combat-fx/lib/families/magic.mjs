// Magic impacts and bolts: fire, thunder, wind, light, unlight (dark), dragon breath,
// staff healing. Elements keep their own short ramps (see fxPalette GLOW_RAMPS).
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
  jagged,
  arcBand,
} from '../draw.mjs';
import { ART_RAMPS, INK_TONES } from '../../../../../src/art/combatFx/fxPalette.js';
import { bodyFrame, paintBody, flameTongue, heatShade, puff } from '../body.mjs';

const R = ART_RAMPS;

// ---------------------------------------------------------------- fire -----------

// Fire: drawn as pixel fire, not a glow. The body is solid (dark crimson rim, orange,
// gold, cream core) so it reads on a lit meadow; the additive layer only carries its
// light (the burst bloom, a halo and the cinders). Frame 0 is the held impact: a
// compact burst with flecks. Then tongues lick up over the target, break into curling
// wisps and flicks, cool to crimson and leave a thin smudge of smoke.
const FIRE_BODY = [R.blood[2], R.blood[3], R.ember[3], R.ember[4], R.ember[5], R.ember[6]];
const FIRE_STOPS = [0.1, 0.3, 0.45, 0.62, 0.79, 0.91];
const SMOKE_BODY = [R.blood[0], R.blood[1], R.blood[2]];

const fire = {
  key: 'fx_magic',
  size: [48, 60],
  anchor: [0.5, 36 / 60],
  ramp: 'ember',
  role: 'impact',
  solidOnTop: false,
  durations: [44, 36, 40, 42, 46, 50, 58, 64],
  setup: (rng) => ({
    // A tall centre tongue, two shoulders, two low flankers.
    tongues: [
      { x: 0, h: 1, w: 6, sway: rng.range(-3, 3) },
      { x: -5.5, h: 0.8, w: 4.6, sway: -rng.range(2.5, 4.5) },
      { x: 5.5, h: 0.86, w: 4.6, sway: rng.range(2.5, 4.5) },
      { x: -10, h: 0.56, w: 3.4, sway: -rng.range(3, 5) },
      { x: 10, h: 0.6, w: 3.4, sway: rng.range(3, 5) },
    ].map((tg) => ({ ...tg, ph: rng.range(0, TAU), seed: rng.int(1, 999) })),
    burst: Array.from({ length: 9 }, (_, k) => ({
      a: (k / 9) * TAU + rng.range(-0.25, 0.25),
      len: rng.range(11, 15),
      seed: rng.int(1, 999),
    })),
    flicks: Array.from({ length: 5 }, (_, k) => ({
      x: (k - 2) * 4.5 + rng.range(-1.5, 1.5),
      y: rng.range(20, 27),
      rise: rng.range(6, 12),
      h: rng.range(4, 6),
      sway: rng.range(-2.5, 2.5),
      seed: rng.int(1, 999),
    })),
    cinders: Array.from({ length: 12 }, () => ({
      x: rng.range(-12, 12),
      y: rng.range(-6, 6),
      rise: rng.range(12, 26),
      sway: rng.range(1, 3),
      ph: rng.range(0, TAU),
      size: rng() < 0.3 ? 2 : 1,
    })),
    smoke: Array.from({ length: 4 }, (_, k) => ({
      x: (k - 1.5) * 5 + rng.range(-1.5, 1.5),
      y: rng.range(-2, 3),
      r: rng.range(3, 4.5),
    })),
  }),
  draw(f, i, { p }) {
    const cx = 24;
    const cy = 36; // the target's body
    const root = cy + 9; // flames rise from about its feet
    const b = bodyFrame(f);
    if (i === 0) {
      // The held impact: a compact star of flame round a cream core.
      for (const br of p.burst) {
        // Each ray is a short tongue pointing outward (rotated by sampling in its frame).
        const ex = cx + Math.cos(br.a) * br.len;
        const ey = cy + Math.sin(br.a) * br.len * 0.85;
        stroke(b, cx, cy, ex, ey, 6, 0.8, 1, 0.6, 0.8);
      }
      puff(b, cx, cy, 10, 1, { lit: 0, seed: 3, scallop: 0.18 });
      heatShade(b, cx, cy + 1, 12, 12, 1.12);
      paintBody(f, b, FIRE_BODY, FIRE_STOPS);
      disc(f, cx, cy, 3.5, 1.2, 0.8);
      for (const br of p.burst) {
        if (br.seed % 3) continue;
        spark(
          f,
          cx + Math.cos(br.a) * (br.len + 4),
          cy + Math.sin(br.a) * (br.len + 3),
          br.a,
          3,
          1,
        );
      }
      return;
    }
    // 1..7: the fire climbs, peaks, breaks up and cools.
    const grow = [0, 0.72, 1, 0.94, 0.7, 0.42, 0.18, 0][i];
    const heat = [0, 1.08, 1.05, 0.98, 0.86, 0.7, 0.56, 0.44][i];
    const H = 40;
    for (const tg of p.tongues) {
      const h = H * tg.h * grow * (1 + 0.07 * Math.sin(i * 2.1 + tg.ph));
      flameTongue(b, cx + tg.x, root, h, tg.w * (0.6 + 0.4 * grow), {
        sway: tg.sway * (0.7 + 0.15 * i),
        wob: 1.8,
        ph: tg.ph + i * 1.3,
        seed: tg.seed + i * 7,
      });
    }
    // Flicks: small flames tearing off the tips, rising and curling as they cool.
    if (i >= 2 && i <= 6) {
      const k = (i - 2) / 4;
      for (const fk of p.flicks) {
        const h = fk.h * (1 - 0.55 * k);
        flameTongue(b, cx + fk.x + fk.sway * k * 2, root - fk.y - fk.rise * k, h, 1.8 - 0.6 * k, {
          sway: fk.sway,
          rim: 1.2,
          seed: fk.seed + i,
          round: 0.6,
        });
      }
    }
    heatShade(b, cx, root - 3, 8 * (0.5 + 0.5 * grow) + 2, 20 * grow + 6, heat);
    // Smoke: a thin maroon-ink smudge above the dying fire, breaking up (never a lid).
    if (i >= 5) {
      const k = (i - 5) / 2;
      const s = bodyFrame(f);
      for (const sm of p.smoke) {
        puff(s, cx + sm.x, cy - 10 + sm.y - 9 * k, sm.r * (0.8 + 0.5 * k), 0.8, {
          lit: 0.5,
          seed: sm.r,
        });
      }
      paintBody(f, s, SMOKE_BODY, [0.2, 0.62, 0.9], { dither: 0.78 - 0.3 * k, block: 2 });
    }
    paintBody(f, b, FIRE_BODY, FIRE_STOPS);
    // Light: the rising cinders (the night impact light carries the glow on the ground).
    const k = ease.outQuad((i - 1) / 6);
    for (const c of p.cinders) {
      const x = cx + c.x * (0.6 + 0.6 * k) + Math.sin(c.ph + k * 6) * c.sway;
      const y = cy + c.y - c.rise * k - 4;
      mote(f, x, y, c.size, 1.05 - 0.6 * k);
    }
  },
};

// ---------------------------------------------------------------- thunder --------

const thunder = {
  key: 'fx_thunder',
  size: [48, 64],
  ramp: 'thunder',
  role: 'impact',
  anchor: [0.5, 46 / 64],
  solidOnTop: false,
  durations: [40, 30, 34, 38, 44, 50, 56],
  setup: (rng) => {
    const bolt = (seed) => jagged(24 + rng.range(-7, 7), -2, 24, 46, 9, 6 + seed, rng);
    const main = [bolt(0), bolt(1)];
    const branches = main.map((pts) =>
      [3, 5].map((k) => {
        const [x, y] = pts[k];
        const dir = rng.sign();
        return jagged(x, y, x + dir * rng.range(7, 12), y + rng.range(6, 11), 3, 2.5, rng);
      }),
    );
    const crackle = Array.from({ length: 6 }, () => {
      const a = rng.range(0, TAU);
      const r0 = rng.range(6, 9);
      const a1 = a + rng.range(0.5, 0.9);
      return {
        pts: jagged(
          24 + Math.cos(a) * r0,
          46 + Math.sin(a) * r0 * 0.6,
          24 + Math.cos(a1) * (r0 + 4),
          46 + Math.sin(a1) * (r0 + 4) * 0.6,
          3,
          2,
          rng,
        ),
      };
    });
    const sparks = Array.from({ length: 6 }, () => ({
      a: rng.range(-Math.PI, 0),
      d: rng.range(8, 16),
    }));
    return { main, branches, crackle, sparks };
  },
  draw(f, i, { p }) {
    const cx = 24;
    const cy = 46;
    if (i <= 1) {
      const pts = p.main[i];
      const dim = i === 0 ? 1 : 0.8;
      polyline(f, pts, 4, 0.55 * dim);
      polyline(f, pts, 1.2, 1.12 * dim);
      for (const br of p.branches[i]) polyline(f, br, 1, 0.8 * dim);
      disc(f, cx, cy, i === 0 ? 6 : 4.5, 1.15 * dim, 0.6);
      ring(f, cx, cy, (i === 0 ? 9 : 12) * 1.0, (i === 0 ? 9 : 12) * 0.6, 2, 0.6 * dim);
    } else {
      const k = (i - 2) / 4;
      // Afterglow of the bolt's foot.
      if (i === 2) polyline(f, p.main[1].slice(-3), 1, 0.4);
      ring(f, cx, cy, lerp(13, 17, k), lerp(13, 17, k) * 0.6, 1.2, 0.4 * (1 - k));
      for (let c = 0; c < p.crackle.length; c++) {
        if ((c + i) % 3 === 0 && i > 3) continue;
        polyline(f, p.crackle[c].pts, 1, (1 - k) * 0.95);
      }
      for (const s of p.sparks) {
        const e = ease.outCubic(k);
        spark(
          f,
          cx + Math.cos(s.a) * s.d * e,
          cy + Math.sin(s.a) * s.d * e * 0.7,
          s.a,
          2,
          1 - 0.7 * k,
        );
      }
    }
  },
};

/** Bolt segments chained caster -> target at runtime (frames are variants, not time). */
const boltSeg = {
  key: 'fx_bolt_seg',
  size: [32, 13],
  ramp: 'thunder',
  role: 'segment',
  anchor: [0, 6.5 / 13],
  durations: [30, 30, 30, 30],
  setup: (rng) => ({
    paths: Array.from({ length: 4 }, () => jagged(0, 6.5, 32, 6.5, 5, 4, rng)),
    forks: Array.from({ length: 4 }, () => ({
      k: rng.int(1, 3),
      dir: rng.sign(),
      len: rng.range(4, 7),
    })),
  }),
  draw(f, i, { p }) {
    const pts = p.paths[i];
    polyline(f, pts, 3.5, 0.5);
    polyline(f, pts, 1.1, 1.1);
    const fk = p.forks[i];
    if (i % 2 === 0) {
      const [x, y] = pts[fk.k];
      gline(f, x, y, x + fk.len, y + fk.dir * fk.len * 0.8, 0.8, 0.35);
    }
  },
};

// ---------------------------------------------------------------- wind -----------

// Wind: a cyclone of three blades spinning round the target. Each blade is a spiral
// comet (hair-thin tail swinging out, a thick sharp head), with an ink-verdigris cut
// line on its inner edge while it is hot so it reads on a lit meadow; the vortex
// opens as it spins down and throws pale flecks outward.
function spiralBlade(f, cx, cy, rot, r0, span, spread, head, v) {
  const R0 = r0 + spread + head + 2;
  field(f, cx - R0, cy - R0, cx + R0, cy + R0, (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    const d = Math.hypot(dx, dy);
    let a = Math.atan2(dy, dx) - rot;
    a = ((a % TAU) + TAU) % TAU;
    if (a > span) return 0;
    const u = a / span; // 0 tail -> 1 head
    const rc = r0 + (1 - u) * spread;
    const th = head * u ** 0.9 * Math.min(1, ((1 - u) / 0.1) ** 0.5);
    const off = Math.abs(d - rc);
    if (th <= 0.2 || off > th / 2) return 0;
    return v * (0.45 + 0.6 * (1 - off / (th / 2))) * (0.35 + 0.65 * u);
  });
}

function spiralCut(f, cx, cy, rot, r0, span, spread, head, hex) {
  const steps = Math.ceil(span * (r0 + spread) * 2.5);
  for (let k = 0; k <= steps; k++) {
    const u = 0.3 + (0.62 * k) / steps;
    const rc = r0 + (1 - u) * spread;
    const th = head * u ** 0.9 * Math.min(1, ((1 - u) / 0.1) ** 0.5);
    const r = rc - th / 2 - 0.7;
    const ang = rot + u * span;
    f.s(Math.floor(cx + Math.cos(ang) * r), Math.floor(cy + Math.sin(ang) * r), hex);
  }
}

const wind = {
  key: 'fx_wind',
  size: [48, 48],
  ramp: 'wind',
  role: 'impact',
  solidOnTop: true,
  durations: [42, 32, 34, 38, 44, 50, 56],
  setup: (rng) => ({
    rot0: rng.range(0, TAU),
    flecks: Array.from({ length: 10 }, () => ({
      a: rng.range(0, TAU),
      d: rng.range(9, 13),
      s: rng() < 0.3 ? 2 : 1,
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 24;
    const cy = 24;
    const k = ease.outCubic(t);
    const r0 = lerp(8, 13, k);
    const head = lerp(5, 2.2, k);
    const v = [1.1, 1.05, 0.95, 0.82, 0.66, 0.5, 0.36][i];
    const span = lerp(1.9, 1.5, k);
    for (let c = 0; c < 3; c++) {
      const rot = p.rot0 + i * 0.95 + (c * TAU) / 3;
      spiralBlade(f, cx, cy, rot, r0, span, 6, head, v);
      if (i <= 2) spiralCut(f, cx, cy, rot, r0, span, 6, head, R.verdigris[1]);
    }
    if (i <= 1) sparkle(f, cx, cy, 3 - i, 1);
    if (i >= 1) {
      for (const fl of p.flecks) {
        const a = fl.a + k * 1.8;
        const d = fl.d + 10 * k;
        mote(f, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, fl.s, 1 - 0.65 * k);
      }
    }
  },
};

// ---------------------------------------------------------------- light ----------

// Holy light: a shaft falls on the target from above (the gilt judgement), bursts
// into a cross-flare on contact, then leaves rising gilt motes and sparkles.
const light = {
  key: 'fx_light',
  size: [48, 64],
  anchor: [0.5, 40 / 64],
  ramp: 'gilt',
  role: 'impact',
  durations: [44, 34, 36, 40, 46, 52, 58, 64],
  setup: (rng) => ({
    motes: Array.from({ length: 11 }, () => ({
      x: rng.range(-12, 12),
      y: rng.range(-4, 8),
      rise: rng.range(10, 22),
      spark: rng() < 0.4,
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 24;
    const cy = 40;
    // The shaft from above: full on the impact frame, narrowing and lifting after.
    const shaft = [1, 0.75, 0.45, 0.2][i] ?? 0;
    if (shaft > 0) {
      const top = (1 - shaft) * 22;
      const w = 7 * shaft;
      stroke(f, cx, top, cx, cy, w, w, 0.34, 0.62, 1.2);
      stroke(f, cx, top, cx, cy, Math.max(1, w * 0.4), Math.max(1, w * 0.4), 0.8, 1.05, 2);
    }
    const beams = [1, 0.7, 0.4, 0.15][i] ?? 0;
    if (beams > 0) {
      const vy = 22 * beams;
      const hx = 17 * beams;
      stroke(f, cx, cy - vy, cx, cy + vy, 3, 3, 0.62, 0.62, 2);
      gline(f, cx, cy - vy, cx, cy + vy, 1.1);
      stroke(f, cx - hx, cy, cx + hx, cy, 3, 3, 0.6, 0.6, 2);
      gline(f, cx - hx, cy, cx + hx, cy, 1.0);
      const d = 7 * beams;
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        gline(f, cx + sx * 2, cy + sy * 2, cx + sx * d, cy + sy * d, 0.85, 0.35);
      disc(f, cx, cy, 3.2 * (0.6 + 0.4 * beams), 1.2, 0.8);
    }
    const k = ease.outCubic(t);
    ring(f, cx, cy, lerp(6, 15, k), lerp(6, 15, k), 1.2, 0.65 * (1 - k));
    if (i >= 1) {
      const m = ease.outQuad((i - 1) / 6);
      for (const mo of p.motes) {
        const x = cx + mo.x;
        const y = cy + mo.y - mo.rise * m;
        if (mo.spark) sparkle(f, x, y, m < 0.5 ? 2 : 1, 1.05 - 0.6 * m);
        else mote(f, x, y, m < 0.4 ? 2 : 1, 1.05 - 0.55 * m);
      }
    }
  },
};

// ---------------------------------------------------------------- unlight --------

/** Ragged ink blob radius at angle a (sum of seeded harmonics). */
function blobRadius(a, base, harm) {
  let v = 0;
  for (const h of harm) v += h.amp * Math.sin(h.k * a + h.ph);
  return base * (1 + v);
}

function drawUnlight(f, cx, cy, base, harm, tendrils, reach, curl, rim, { core = true } = {}) {
  const inside = (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    if (r <= blobRadius(a, base, harm)) return r / Math.max(1, blobRadius(a, base, harm));
    for (const td of tendrils) {
      const len = td.len * reach;
      if (len <= 0.5) continue;
      // Tendril: a curved, tapering stroke leaving the blob edge.
      for (let s = 0; s <= 1; s += 0.08) {
        const ang = td.a + curl * td.curl * s * s;
        const rr = base * 0.8 + len * s;
        const tx = cx + Math.cos(ang) * rr;
        const ty = cy + Math.sin(ang) * rr;
        const w = td.w * (1 - s) * 0.5 + 0.35;
        if (Math.hypot(px - tx, py - ty) <= w) return 0.9;
      }
    }
    return -1;
  };
  const R0 = base * 1.5 + 22;
  solidField(
    f,
    cx - R0,
    cy - R0,
    cx + R0,
    cy + R0,
    (px, py) => {
      const d = inside(px, py);
      if (d < 0) return false;
      if (core && d < 0.55) return INK_TONES.unlightCore;
      return INK_TONES.unlightBody;
    },
    INK_TONES.unlightBody,
  );
  // Violet rim: the only light corruption gives off is its own edge.
  if (rim > 0) {
    field(f, cx - R0, cy - R0, cx + R0, cy + R0, (px, py, x, y) => {
      if (f.sAt(x, y)) return 0;
      let near = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (f.sAt(x + dx, y + dy)) near++;
      if (!near) return 0;
      return rim * (0.55 + 0.45 * ((x * 7 + y * 13) % 5 === 0 ? 1 : 0.3));
    });
  }
}

const dark = {
  key: 'fx_dark',
  size: [48, 48],
  ramp: 'unlight',
  role: 'impact',
  solidOnTop: true,
  durations: [48, 36, 38, 42, 46, 52, 58, 64],
  setup: (rng) => ({
    harm: [2, 3, 5, 7].map((k) => ({ k, amp: rng.range(0.05, 0.14), ph: rng.range(0, TAU) })),
    tendrils: Array.from({ length: 7 }, (_, k) => ({
      a: (k / 7) * TAU + rng.range(-0.3, 0.3),
      len: rng.range(8, 15),
      curl: rng.sign() * rng.range(0.5, 1.1),
      w: rng.range(2.5, 3.6),
    })),
    motes: Array.from({ length: 6 }, () => ({
      x: rng.range(-10, 10),
      y: rng.range(-4, 6),
      fall: rng.range(4, 10),
    })),
  }),
  draw(f, i, { t, p }) {
    const cx = 24;
    const cy = 26;
    const base = [9, 10.5, 10, 8.5, 7, 5.2, 3.6, 2.2][i];
    const reach = [1, 1.12, 1, 0.8, 0.55, 0.32, 0.12, 0][i];
    const rim = [0.95, 0.8, 0.7, 0.62, 0.55, 0.5, 0.42, 0.35][i];
    drawUnlight(f, cx, cy, base, p.harm, p.tendrils, reach, t * 1.3, rim);
    if (i >= 4) {
      const k = (i - 4) / 3;
      for (const m of p.motes) {
        const x = cx + m.x * (1 + k * 0.3);
        const y = cy + m.y + m.fall * k;
        f.s(x, y, INK_TONES.unlightBody);
        f.s(x + 1, y, INK_TONES.unlightBody);
        f.g(x, y - 1, 0.5 * (1 - k));
      }
    }
  },
};

// ---------------------------------------------------------------- breath ---------

// A billow that rolls through the target from the left (the runtime mirrors or turns
// it toward the striker): frame 0 is the fireball front slamming in with its tongue
// trailing back to the mouth; then the billow tumbles on past the target in lit puffs
// (key light upper-left, hot leading edge), and cools into rising smoke.
function breathAnim(key, { ramp, body, stops, smoke, extra }) {
  return {
    key,
    size: [72, 52],
    anchor: [40 / 72, 26 / 52],
    ramp,
    role: 'impact',
    directional: true,
    solidOnTop: false,
    durations: [44, 36, 38, 42, 46, 52, 58],
    setup: (rng) => ({
      puffs: Array.from({ length: 7 }, (_, k) => ({
        x: -12 + k * 3 + rng.range(-1.5, 1.5),
        y: [-5, 4, -1, 6, -6, 2, -2][k] + rng.range(-1.5, 1.5),
        r: rng.range(5, 7),
        drift: rng.range(4, 9),
        rise: rng.range(3, 8),
        seed: rng.int(1, 99),
      })),
      smoke: Array.from({ length: 6 }, (_, k) => ({
        x: -9 + k * 3.2 + rng.range(-2, 2),
        y: rng.range(-6, 4),
        r: rng.range(3.4, 5.2),
        seed: rng.int(1, 99),
      })),
      bits: Array.from({ length: 11 }, () => ({
        x: rng.range(-10, 14),
        y: rng.range(-9, 9),
        rise: rng.range(6, 16),
        drift: rng.range(4, 12),
        ph: rng.range(0, TAU),
      })),
    }),
    draw(f, i, { t, p }) {
      const cx = 40; // the target
      const cy = 26;
      const b = bodyFrame(f);
      if (i === 0) {
        // The front hits: a fireball on the target, its tongue trailing to the mouth.
        stroke(b, 3, cy + 1, cx - 4, cy, 1, 12, 0.7, 1, 0.7);
        puff(b, cx, cy, 10.5, 1, { lit: 0.25, seed: 2, scallop: 0.14 });
        puff(b, cx - 8, cy - 5, 5.5, 0.9, { lit: 0.3, seed: 4 });
        puff(b, cx - 7, cy + 6, 5, 0.85, { lit: 0.3, seed: 6 });
        heatShade(b, cx + 3, cy - 1, 14, 12, 1.1);
        paintBody(f, b, body, stops);
        disc(f, cx + 2, cy - 1, 3.5, 1.1, 0.8);
        extra?.(f, i, t, p, cx, cy);
        return;
      }
      const k = ease.outCubic((i - 1) / 5);
      const heat = [0, 1.14, 1.06, 0.94, 0.76, 0.6, 0.46][i];
      // The trailing tongue thins and falls behind.
      if (i <= 2) stroke(b, 10 + 10 * i, cy + 1, cx - 6, cy, 1, 8 - 3 * i, 0.6, 0.9, 0.7);
      for (const pf of p.puffs) {
        const x = cx + pf.x + pf.drift * k;
        const y = cy + pf.y - pf.rise * k;
        const r = pf.r * (1.05 + 0.35 * k) * (i >= 5 ? 1 - (i - 4) * 0.2 : 1);
        puff(b, x, y, r, 1, { lit: 0.3, seed: pf.seed });
      }
      heatShade(b, cx + 3 + 5 * k, cy - 2 - 3 * k, 16 + 4 * k, 12 + 3 * k, heat);
      // Smoke rolls up behind the billow as it cools.
      if (i >= 3) {
        const m = (i - 3) / 3;
        const sm = bodyFrame(f);
        for (const s of p.smoke) {
          const x = cx + s.x + 6 * m;
          const y = cy + s.y - 6 - 10 * m;
          puff(sm, x, y, s.r * (0.8 + 0.5 * m), 0.8, { lit: 0.45, seed: s.seed });
        }
        paintBody(f, sm, smoke, [0.2, 0.6, 0.9], { dither: 0.82 - 0.4 * m, block: 2 });
      }
      paintBody(f, b, body, stops, { dither: i >= 5 ? 0.9 - (i - 5) * 0.3 : null, block: 2 });
      extra?.(f, i, t, p, cx, cy);
    },
  };
}

const BREATHS = {
  fire: { ramp: 'ember', body: FIRE_BODY, stops: FIRE_STOPS, smoke: SMOKE_BODY },
  toxic: {
    ramp: 'acid',
    body: R.verdigris.slice(0, 6),
    stops: [0.1, 0.28, 0.44, 0.6, 0.76, 0.92],
    smoke: [R.verdigris[0], R.ink[3], R.verdigris[1]],
  },
  ancient: {
    ramp: 'pale',
    body: [R.unlight[1], R.unlight[2], R.steel[3], R.steel[4], R.ink[10], R.ink[11]],
    stops: [0.1, 0.26, 0.42, 0.6, 0.76, 0.92],
    smoke: [R.unlight[0], R.ink[2], R.unlight[1]],
  },
};

const breathFire = breathAnim('fx_breath', {
  ...BREATHS.fire,
  extra: (f, i, t, p, cx, cy) => {
    if (i === 0) return;
    const k = ease.outQuad(t);
    for (const b of p.bits)
      mote(f, cx + b.x + b.drift * k, cy + b.y - b.rise * k, 1, 1.05 - 0.65 * k);
  },
});

const breathToxic = breathAnim('fx_breath_toxic', {
  ...BREATHS.toxic,
  extra: (f, i, t, p, cx, cy) => {
    if (i === 0) return;
    const k = ease.outQuad(t);
    p.bits.forEach((b, n) => {
      const x = cx + b.x + b.drift * k;
      const y = cy + b.y - b.rise * k;
      // Acid: bubbles that pop, and droplets that fall.
      if (n % 3 === 0 && i < 5) ring(f, x, y, 1.6, 1.6, 1, 1 - 0.5 * k);
      else if (n % 3 === 1) mote(f, x, cy + b.y + 6 * k * k, 1, 0.95 - 0.5 * k);
      else mote(f, x, y, 1, 0.9 - 0.6 * k);
    });
  },
});

const breathAncient = breathAnim('fx_breath_ancient', {
  ...BREATHS.ancient,
  extra: (f, i, t, p, cx, cy) => {
    const k = ease.outQuad(t);
    p.bits.forEach((b, n) => {
      const x = cx + b.x + b.drift * k;
      const y = cy + b.y - b.rise * k * 0.6;
      // Unlight flecks riding the pale breath (solid ink-violet, they emit nothing).
      if (n % 2 === 0) {
        f.s(x, y, R.unlight[i < 3 ? 3 : 2]);
        f.s(x + 1, y, R.unlight[0]);
      } else if (i > 0) mote(f, x, y, 1, 0.95 - 0.6 * k);
    });
  },
});

// ---------------------------------------------------------------- heal -----------

const HEAL_RING = [R.verdigris[1], R.verdigris[2], R.verdigris[3], R.verdigris[4]];

// Healing: a rune ring opens at the feet (solid verdigris line work so it reads on a
// lit meadow), a shimmer of vertical streaks rises out of it, and motes and small
// four-point sparkles drift up and out. The light is the glow layer; the ring is matter.
const heal = {
  key: 'fx_heal',
  size: [48, 56],
  anchor: [0.5, 28 / 56],
  ramp: 'verdigris',
  role: 'overlay',
  solidOnTop: false,
  durations: [50, 50, 50, 55, 55, 60, 65, 70],
  setup: (rng) => ({
    streaks: Array.from({ length: 11 }, (_, k) => ({
      x: -10 + k * 2 + rng.range(-0.6, 0.6),
      h: rng.range(0.45, 1) * (1 - Math.abs(k - 5) / 8),
      d: rng.range(0, 0.25),
    })),
    motes: Array.from({ length: 12 }, () => ({
      x: rng.range(-12, 12),
      d: rng.range(0, 0.45),
      rise: rng.range(18, 30),
      spark: rng() < 0.3,
      size: rng() < 0.3 ? 2 : 1,
    })),
    ticks: Array.from({ length: 8 }, (_, k) => (k / 8) * TAU + rng.range(-0.15, 0.15)),
  }),
  draw(f, i, { t, p }) {
    const cx = 24;
    const fy = 40; // the unit's feet
    // The ring: opens, holds, fades.
    const open = [0.55, 0.85, 1, 1, 1, 1, 0.9, 0][i];
    const ringA = [0.9, 1, 1, 1, 0.95, 0.8, 0.55, 0][i];
    if (open > 0) {
      const rx = 13 * open;
      const ry = 4.2 * open;
      const b = bodyFrame(f);
      ring(b, cx, fy, rx, ry, 1.2, ringA);
      ring(b, cx, fy, rx - 3, ry - 1.2, 1, ringA * 0.7, { dash: 12, dashPhase: i * 0.5 });
      paintBody(f, b, HEAL_RING, [0.1, 0.4, 0.62, 0.85], { dither: i >= 6 ? 0.55 : null });
      if (i >= 1 && i <= 5)
        for (const a of p.ticks)
          f.g(cx + Math.cos(a + i * 0.2) * rx, fy + Math.sin(a + i * 0.2) * ry, 0.9);
      if (i <= 4) ring(f, cx, fy, rx + 1, ry + 0.8, 1, 0.35 * ringA);
    }
    // The shimmer column: vertical streaks, tallest in the middle, peaking at 3-4.
    const col = [0, 0.3, 0.7, 1, 0.95, 0.6, 0.28, 0][i];
    if (col > 0) {
      for (const st of p.streaks) {
        const h = 30 * st.h * col;
        const x = cx + st.x;
        const base = fy - 1;
        const v = (1.05 - 0.35 * st.d) * (0.55 + 0.45 * col);
        gline(f, x, base, x, base - h, v, v * 0.25);
        if (col >= 0.95 && Math.abs(st.x) < 5) f.g(x, base - h - 2, v * 0.6);
      }
      if (col >= 0.95) disc(f, cx, fy - 2, 5, 0.9, 0.4);
    }
    // Motes and sparkles drifting up and out.
    for (const m of p.motes) {
      const lt = clamp01((t - m.d) / (1 - m.d));
      if (lt <= 0) continue;
      const y = fy - 3 - m.rise * ease.outQuad(lt);
      const x = cx + m.x * (0.8 + 0.3 * lt);
      const v = 1.1 - 0.65 * lt;
      if (m.spark && lt > 0.15 && lt < 0.85) sparkle(f, x, y, 2, v);
      else mote(f, x, y, m.size, v);
    }
  },
};

// ---------------------------------------------------------------- magic bolts ----

// A fireball: solid flame (the same bands as the impact) with a hot cream head and a
// licking tail, plus a light bloom on the head so it glows at night.
const projFire = {
  key: 'fx_proj_fire',
  size: [24, 16],
  ramp: 'ember',
  role: 'projectile',
  directional: true,
  loop: true,
  solidOnTop: false,
  anchor: [17 / 24, 0.5],
  durations: [45, 45, 45, 45],
  draw(f, i) {
    const cx = 17;
    const cy = 8;
    const len = [12, 14, 11, 13][i];
    const wob = [0, 1, 0, -1][i];
    const b = bodyFrame(f);
    stroke(b, cx, cy, cx - len, cy + wob, 8, 1, 1, 0.55, 0.8);
    stroke(b, cx - 3, cy - 2, cx - len + 3, cy - 4 - wob, 3, 0.6, 0.8, 0.5, 0.8);
    stroke(b, cx - 3, cy + 2, cx - len + 4, cy + 3 - wob, 2.5, 0.6, 0.8, 0.5, 0.8);
    puff(b, cx, cy, 4.2, 1, { lit: 0, seed: i + 1, scallop: 0.1 });
    heatShade(b, cx + 1, cy, 9, 7, 1.1);
    paintBody(f, b, FIRE_BODY, FIRE_STOPS);
    disc(f, cx + 1, cy, 2, 1.15, 0.8);
    mote(f, cx - len - 2, cy + (i % 2 ? 2 : -2), 1, 0.7);
  },
};

const projWind = {
  key: 'fx_proj_wind',
  size: [24, 24],
  ramp: 'wind',
  role: 'projectile',
  loop: true,
  durations: [40, 40, 40, 40],
  draw(f, i) {
    for (let c = 0; c < 2; c++)
      arcBand(
        f,
        12,
        12,
        (i * Math.PI) / 4 + c * Math.PI,
        9,
        0,
        1.9,
        (u) => 3 * Math.sin(Math.PI * u) ** 0.7,
        (u, s) => (0.4 + 0.7 * s) * (0.4 + 0.6 * u),
      );
    mote(f, 12, 12, 1, 0.8);
  },
};

const projDark = {
  key: 'fx_proj_dark',
  size: [20, 16],
  ramp: 'unlight',
  role: 'projectile',
  directional: true,
  loop: true,
  solidOnTop: true,
  anchor: [14 / 20, 0.5],
  durations: [50, 50, 50, 50],
  setup: (rng) => ({
    harm: [2, 3, 5].map((k) => ({ k, amp: rng.range(0.06, 0.14), ph: rng.range(0, TAU) })),
  }),
  draw(f, i, { p }) {
    const harm = p.harm.map((h) => ({ ...h, ph: h.ph + i * 0.9 }));
    drawUnlight(f, 14, 8, 4.3, harm, [], 0, 0, 0.9, { core: true });
    // Wisps trailing behind.
    for (let k = 0; k < 3; k++) {
      const x = 8 - k * 3 - (i % 2);
      const y = 8 + [-2, 1, -1, 2][(i + k) % 4];
      f.s(x, y, INK_TONES.unlightBody);
      if (k < 2) f.s(x - 1, y, INK_TONES.unlightEdge);
    }
  },
};

const projLight = {
  key: 'fx_proj_light',
  size: [13, 13],
  ramp: 'gilt',
  role: 'projectile',
  loop: true,
  durations: [50, 50],
  draw(f, i) {
    sparkle(f, 6, 6, i === 0 ? 5 : 4, 1.1);
    disc(f, 6, 6, i === 0 ? 2 : 1.6, 1.1);
  },
};

// Breath in flight: a tumbling lit puff (solid, key light upper-left) in the breath's
// own bands, rolling a quarter turn per frame.
function breathPuff(key, { ramp, body, stops }) {
  return {
    key,
    size: [20, 20],
    ramp,
    role: 'projectile',
    loop: true,
    solidOnTop: false,
    durations: [45, 45, 45, 45],
    draw(f, i) {
      const a = (i * Math.PI) / 2;
      const b = bodyFrame(f);
      puff(b, 10, 10, 5.2, 1, { lit: 0.35, seed: i + 1 });
      puff(b, 10 + Math.cos(a) * 3.5, 10 + Math.sin(a) * 3, 3.6, 0.95, { lit: 0.35, seed: i + 3 });
      puff(b, 10 + Math.cos(a + 2.4) * 3.5, 10 + Math.sin(a + 2.4) * 3, 3, 0.9, {
        lit: 0.35,
        seed: i + 5,
      });
      heatShade(b, 11, 9, 7, 6, 1.05);
      paintBody(f, b, body, stops);
    },
  };
}

export const MAGIC_ANIMS = [
  fire,
  thunder,
  boltSeg,
  wind,
  light,
  dark,
  breathFire,
  breathToxic,
  breathAncient,
  heal,
  projFire,
  projWind,
  projDark,
  projLight,
  breathPuff('fx_proj_breath', BREATHS.fire),
  breathPuff('fx_proj_breath_toxic', BREATHS.toxic),
  breathPuff('fx_proj_breath_ancient', BREATHS.ancient),
];
export { drawUnlight, blobRadius };
