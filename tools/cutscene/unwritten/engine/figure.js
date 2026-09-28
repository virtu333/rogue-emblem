// The Empire's rank and file, drawn entirely in code from a skeleton.
//
// A soldier is a pose (the 2D skeleton of ford_blocking.js: hips, spine, neck, head, shoulder,
// elbows, hands, knees, feet, toes, spear) painted every frame as shaped parts around the bones:
// tapered limbs with plate (pauldron, couter, vambrace, gauntlet, cop, greave), a closed iron helm
// with an eye slit, a crimson tabard with the black cross, a ragged cloak, brown boots and a spear.
// Parts go down back to front in flat, dense tones with a dark contour and one hard highlight
// per plate facing a fixed light (upper left). Everything is a pure function of t: the skeleton
// is sampled on twos, and the cloak and tabard are chains that lag behind the recent history of
// the skeleton (no state).
//
//   drawSoldier(frame, fw, fh, sk, xf, o)   one soldier from a skeleton
//   drawLine(frame, fw, fh, soldiers, t, cam, o)   a rank of them, depth sorted, from the blocking
//   drawParade(frame, fw, fh, t, o)          20+ marching in lockstep at three depths
//   marchSkeleton(t, o)                      a walking skeleton with planted feet (same format)
//   history(skelFn, t) / soldierLook(seed)   helpers
//
// xf: { x, y, s, ax, ay, flip, yaw, tilt }
//   the world point (ax, ay) (metres) lands on screen (x, y); s = px per metre; flip mirrors;
//   yaw (rad) turns the body from side view toward the camera (a 3/4 view); tilt lifts figures
//   with negative world Z (further away) up the page.

import { RAMPS } from './palette.js';
import { clamp, hash, hexToRgb, lerp } from './raster.js';
import { onTwos, put } from './anime.js';

const ramp = (n) => RAMPS[n].split(' ').map(hexToRgb);
const INK = ramp('ink');
const BLOOD = ramp('blood');
const EMBER = ramp('ember');
const STONE = ramp('stone');
const PAPER_HAZE = INK[9];

const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const V2 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  len: (a) => Math.hypot(a[0], a[1]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1]) || 1;
    return [a[0] / l, a[1] / l];
  },
  lerp: (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k],
};

// ---------------------------------------------------------------------------- tones

/** The palettes: every colour is a ramp colour, optionally pushed toward the paper (haze). */
export function makeTones(o = {}) {
  const hz = clamp(o.haze ?? 0);
  const H = (c) => (hz > 0 ? mix(c, PAPER_HAZE, hz * 0.78) : c);
  const set = (edge, deep, shade, base, lit, hi) => ({
    edge: H(edge),
    deep: H(deep),
    shade: H(shade),
    base: H(base),
    lit: H(lit),
    hi: H(hi),
  });
  const brown = (o.boots ?? 'brown') === 'brown';
  const T = {
    iron: set(INK[0], INK[1], INK[2], INK[3], INK[5], INK[7]),
    helm: set(INK[0], INK[2], INK[3], INK[4], INK[5], INK[7]),
    crimson: set(BLOOD[0], BLOOD[1], BLOOD[2], BLOOD[3], BLOOD[4], BLOOD[5]),
    cloak: set(BLOOD[0], BLOOD[1], BLOOD[2], BLOOD[3], BLOOD[4], BLOOD[5]),
    leather: brown
      ? set(EMBER[0], EMBER[0], EMBER[1], EMBER[2], EMBER[3], EMBER[3])
      : set(INK[0], INK[1], INK[2], INK[3], INK[4], INK[6]),
    wood: set(EMBER[0], EMBER[0], EMBER[1], EMBER[1], EMBER[2], EMBER[3]),
    steel: set(INK[0], STONE[1], STONE[2], STONE[3], STONE[4], STONE[5]),
    ink: H(INK[0]),
    slit: H(INK[0]),
    trim: H(EMBER[2]),
  };
  return T;
}

/** The same tones one step darker: limbs on the far side of the body. */
const dim = (t) => ({ edge: t.edge, deep: t.deep, shade: t.deep, base: t.shade, lit: t.base, hi: t.lit });

// ------------------------------------------------------------------------ the look

/** Per-soldier entropy: helm crest, cloak rag cut, motif, boots, spear angle, size. */
export function soldierLook(seed) {
  const h = (k) => hash(seed | 0, k, 777);
  const c = h(1);
  const rag = [];
  for (let i = 0; i < 12; i++) rag.push(0.25 + 0.75 * h(20 + i));
  return {
    seed: seed | 0,
    crest: c < 0.42 ? 'fin' : c < 0.62 ? 'comb' : c < 0.8 ? 'horn' : 'plain',
    finLen: 0.07 + 0.06 * h(2),
    finLift: 0.05 + 0.04 * h(3),
    motif: h(4) < 0.22 ? 'sun' : 'cross',
    boots: h(5) < 0.78 ? 'brown' : 'black',
    rag,
    ragDepth: 0.09 + 0.08 * h(6),
    ragTeeth: 6 + Math.floor(h(7) * 4),
    spearJitter: (h(8) - 0.5) * 0.09,
    size: 0.975 + 0.05 * h(9),
    phase: (h(10) - 0.5) * 0.07,
    mottle: h(11),
    wind: 0.45 + 0.3 * h(12),
    beltHigh: h(13),
    helmShade: h(14),
  };
}

// ----------------------------------------------------------------------- the raster

const MAXB = 420;
const cov = new Uint8Array(MAXB * MAXB);
const UU = new Float32Array(MAXB * MAXB);
const VV = new Float32Array(MAXB * MAXB);
const M = { x0: 0, y0: 0, w: 0, h: 0, nx: 0, ny: 1 };
const S = { frame: null, fw: 0, fh: 0, occ: null, ox: 0, oy: 0, ow: 0, oh: 0 };

function begin(minx, miny, maxx, maxy) {
  let x0 = Math.floor(minx) - 1;
  let y0 = Math.floor(miny) - 1;
  let x1 = Math.ceil(maxx) + 1;
  let y1 = Math.ceil(maxy) + 1;
  x0 = Math.max(x0, S.ox - 1);
  y0 = Math.max(y0, S.oy - 1);
  x1 = Math.min(x1, S.ox + S.ow);
  y1 = Math.min(y1, S.oy + S.oh);
  M.x0 = x0;
  M.y0 = y0;
  M.w = Math.max(1, Math.min(MAXB, x1 - x0 + 1));
  M.h = Math.max(1, Math.min(MAXB, y1 - y0 + 1));
  cov.fill(0, 0, M.w * M.h);
}

function capsule(ax, ay, bx, by, ra, rb) {
  ra = Math.max(ra, 0.75);
  rb = Math.max(rb, 0.75);
  const r = Math.max(ra, rb);
  begin(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r);
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const L = Math.sqrt(L2) || 1;
  M.nx = -dy / L;
  M.ny = dx / L;
  const { w, h, x0, y0 } = M;
  for (let y = 0; y < h; y++) {
    const py = y0 + y + 0.5;
    for (let x = 0; x < w; x++) {
      const px = x0 + x + 0.5;
      const t = L2 > 1e-6 ? clamp(((px - ax) * dx + (py - ay) * dy) / L2) : 0;
      const ex = px - (ax + dx * t);
      const ey = py - (ay + dy * t);
      const rr = ra + (rb - ra) * t;
      if (ex * ex + ey * ey <= rr * rr) {
        const i = y * w + x;
        cov[i] = 1;
        UU[i] = t;
        VV[i] = (ex * M.nx + ey * M.ny) / rr;
      }
    }
  }
}

/** An ellipse, rotated; U, V are its local coordinates (0..1 along the major axis, -1..1 across). */
function ellipse(cx, cy, rx, ry, rot = 0) {
  rx = Math.max(rx, 0.75);
  ry = Math.max(ry, 0.75);
  const r = Math.max(rx, ry);
  begin(cx - r, cy - r, cx + r, cy + r);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const { w, h, x0, y0 } = M;
  for (let y = 0; y < h; y++) {
    const py = y0 + y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      const px = x0 + x + 0.5 - cx;
      const lx = (px * c + py * s) / rx;
      const ly = (-px * s + py * c) / ry;
      if (lx * lx + ly * ly <= 1) {
        const i = y * w + x;
        cov[i] = 1;
        UU[i] = (lx + 1) / 2;
        VV[i] = ly;
      }
    }
  }
}

/** Even-odd scanline fill of a polygon; U, V come from `uv(px, py)` when given. */
function polygon(pts, uv = null, keep = false) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of pts) {
    minx = Math.min(minx, p[0]);
    maxx = Math.max(maxx, p[0]);
    miny = Math.min(miny, p[1]);
    maxy = Math.max(maxy, p[1]);
  }
  if (!keep) begin(minx, miny, maxx, maxy);
  fillPts(pts, uv);
}

const xsBuf = [];
function fillPts(pts, uv) {
  const { w, h, x0, y0 } = M;
  const n = pts.length;
  for (let y = 0; y < h; y++) {
    const yc = y0 + y + 0.5;
    xsBuf.length = 0;
    for (let k = 0; k < n; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % n];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc))
        xsBuf.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    if (xsBuf.length < 2) continue;
    xsBuf.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xsBuf.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xsBuf[k] - 0.5 - x0));
      const xb = Math.min(w - 1, Math.ceil(xsBuf[k + 1] - 0.5 - x0) - 1);
      for (let x = xa; x <= xb; x++) {
        const i = y * w + x;
        cov[i] = 1;
        if (uv) {
          const r = uv(x0 + x + 0.5, yc);
          UU[i] = r[0];
          VV[i] = r[1];
        }
      }
    }
  }
}

/**
 * A strip between two chains of edge points (Ls[i] on one edge, Rs[i] on the other): U runs
 * 0..1 along the strip, V -1..1 across. `cut(u, v)` removes pixels (a ragged hem).
 */
function ribbon(Ls, Rs, cut = null) {
  const n = Ls.length - 1;
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of Ls.concat(Rs)) {
    minx = Math.min(minx, p[0]);
    maxx = Math.max(maxx, p[0]);
    miny = Math.min(miny, p[1]);
    maxy = Math.max(maxy, p[1]);
  }
  begin(minx, miny, maxx, maxy);
  for (let i = 0; i < n; i++) {
    const L0 = Ls[i];
    const L1 = Ls[i + 1];
    const R0 = Rs[i];
    const R1 = Rs[i + 1];
    const m0 = V2.lerp(L0, R0, 0.5);
    const m1 = V2.lerp(L1, R1, 0.5);
    const d = V2.sub(m1, m0);
    const dd = d[0] * d[0] + d[1] * d[1] || 1e-6;
    fillPts([L0, L1, R1, R0], (px, py) => {
      const t = clamp(((px - m0[0]) * d[0] + (py - m0[1]) * d[1]) / dd);
      const lp = V2.lerp(L0, L1, t);
      const wv = V2.sub(V2.lerp(R0, R1, t), lp);
      const ww = wv[0] * wv[0] + wv[1] * wv[1] || 1e-6;
      const v = (2 * ((px - lp[0]) * wv[0] + (py - lp[1]) * wv[1])) / ww - 1;
      return [(i + t) / n, clamp(v, -1, 1)];
    });
  }
  if (cut) {
    const { w, h } = M;
    for (let k = 0; k < w * h; k++) if (cov[k] && cut(UU[k], VV[k])) cov[k] = 0;
  }
}

/** Blit the mask with `shade(u, v, x, y)`; edge pixels take the `edge` colour (a contour). */
function paint(shade, edge) {
  const { w, h, x0, y0 } = M;
  const { frame, fw, fh, occ, ox, oy, ow, oh } = S;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cov[i]) continue;
      const X = x0 + x;
      const Y = y0 + y;
      if (X < 0 || Y < 0 || X >= fw || Y >= fh) continue;
      let c = null;
      if (
        edge &&
        (x === 0 || !cov[i - 1] || x === w - 1 || !cov[i + 1] || y === 0 || !cov[i - w] || y === h - 1 || !cov[i + w])
      )
        c = edge;
      if (!c) c = shade(UU[i], VV[i], X, Y);
      put(frame, fw, fh, X, Y, c);
      if (X >= ox && Y >= oy && X < ox + ow && Y < oy + oh) occ[(Y - oy) * ow + (X - ox)] = 1;
    }
  }
}

// ---------------------------------------------------------------------- the shading

// light from the upper left, toward the viewer
const LX = -0.45;
const LY = -0.7;
const LZ = Math.sqrt(1 - LX * LX - LY * LY);

/** A noise value in [0,1) stuck to the part (its own u, v), so lacquer never swims. */
const nz = (u, v, k, seed) => hash(Math.floor(u * k), Math.floor(v * k * 0.6) + 31, seed);

/**
 * Cylinder shading for a capsule: bands of the tone set by how much the surface faces the
 * light. cfg: { hi: draw the highlight stripe, mottle: 0..1 patchiness, seed, band: shade cut }
 */
function cylShade(T, cfg = {}) {
  const lv = LX * M.nx + LY * M.ny;
  const imax = Math.sqrt(lv * lv + LZ * LZ);
  const { hi = true, mottle = 0.5, seed = 1, k = 9 } = cfg;
  return (u, v) => {
    const rz = Math.sqrt(Math.max(0, 1 - v * v));
    let t = (v * lv + rz * LZ) / imax;
    const n = nz(u, v, k, seed);
    if (mottle > 0) t += (n - 0.5) * 0.16 * mottle;
    if (hi && t > 0.93 && u > 0.1 && u < 0.9) return T.hi;
    if (t > 0.6) return T.lit;
    if (t > 0.12) return T.base;
    if (t > -0.35) return T.shade;
    return T.deep;
  };
}

/** Sphere shading for a dome (pauldron, cop, fist, helm): crescent of shade, one hard highlight. */
function domeShade(T, cx, cy, R, cfg = {}) {
  const { hi = true, mottle = 0.5, seed = 1, k = 7 } = cfg;
  return (u, v, x, y) => {
    const rx = (x + 0.5 - cx) / R;
    const ry = (y + 0.5 - cy) / R;
    const rz = Math.sqrt(Math.max(0, 1 - rx * rx - ry * ry));
    let t = rx * LX + ry * LY + rz * LZ;
    const n = nz(u, v, k, seed);
    if (mottle > 0) t += (n - 0.5) * 0.14 * mottle;
    if (hi && t > 0.86) return T.hi;
    if (t > 0.5) return T.lit;
    if (t > 0.05) return T.base;
    if (t > -0.45) return T.shade;
    return T.deep;
  };
}

// ---------------------------------------------------------------------- the skeleton

const ANKLE = 0.07;
const dimsOf = (s) => ({
  thigh: 0.44 * s,
  shin: 0.44 * s,
  trunk: 0.56 * s,
  neck: 0.19 * s,
  headR: 0.115 * s,
  upper: 0.3 * s,
  fore: 0.29 * s,
});

/** Two-bone IK (as ford_blocking.js): the joint bends toward `pref`. */
function ik2(hx, hy, tx, ty, a, b, pref) {
  const dx = tx - hx;
  const dy = ty - hy;
  const d = Math.hypot(dx, dy) || 1e-6;
  const dc = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  const ux = dx / d;
  const uy = dy / d;
  const ang = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const k1 = [hx + a * (ux * c - uy * s), hy + a * (ux * s + uy * c)];
  const k2 = [hx + a * (ux * c + uy * s), hy + a * (-ux * s + uy * c)];
  const ex = hx + ux * dc;
  const ey = hy + uy * dc;
  const sc = (k) => (k[0] - (hx + ex) / 2) * pref[0] + (k[1] - (hy + ey) / 2) * pref[1];
  return { joint: sc(k1) >= sc(k2) ? k1 : k2, end: [ex, ey] };
}

const sstep = (u) => {
  u = clamp(u);
  return u * u * (3 - 2 * u);
};

/**
 * A soldier marching on flat ground, in the skeleton format of ford_blocking.js. Feet plant
 * on the ground and stay put while the hips pass over them (heel strike, flat, heel rise about
 * the toe, swing); the hips rise over each stance foot; the near arm swings against the near
 * leg; the far hand carries the spear upright. A pure function of t.
 * o: { x0 (hip x at t = 0, m), z, facing (-1 left), speed (m/s), cadence (steps/s), scale,
 *      seed, spearLen, name }
 */
export function marchSkeleton(t, o = {}) {
  const { x0 = 0, z = 0, facing = -1, speed = 1.25, cadence = 2.5, scale = 1, seed = 0 } = o;
  const look = soldierLook(seed);
  const spearLen = o.spearLen ?? 2.35;
  const f = facing;
  const D = dimsOf(scale);
  const P = 2 / cadence; // one foot's full cycle
  const jp = look.phase; // stride phase, a hair different per soldier
  const ph = t / P + jp + (o.phase ?? 0);
  const u = speed * t; // forward travel of the hips
  const a = 0.5 * speed * 0.6 * P; // half the stance excursion: what the foot slides back under the hips
  const toeVec = [0.19 * scale, -0.05 * scale];
  const L = Math.hypot(toeVec[0], toeVec[1]);
  const flat = Math.atan2(toeVec[1], toeVec[0]);
  const hipY = (0.877 + 0.02 * Math.cos(2 * Math.PI * 2 * (ph - 0.3))) * scale;
  const hips = [x0 + f * u, hipY];

  // one foot: returns { ankle: [fwd, y], toe: [fwd, y], rel } in forward coordinates
  const plantU = (n, k) => speed * ((n + 0.3 - 0.5 * k - jp - (o.phase ?? 0)) * P);
  const foot = (k) => {
    const psi = ph + 0.5 * k;
    const n = Math.floor(psi);
    const phi = psi - n;
    const flatToe = (uP) => [uP + toeVec[0], ANKLE * scale + toeVec[1]];
    const riseEnd = 0.6;
    const heelRise = (uP, r) => {
      const toe = flatToe(uP);
      const th = flat - r;
      return { ankle: [toe[0] - L * Math.cos(th), toe[1] - L * Math.sin(th)], toe, pitch: -r };
    };
    if (phi < 0.6) {
      const uP = plantU(n, k);
      if (phi < 0.1) {
        const p = 0.3 * (1 - phi / 0.1) ** 1.5; // heel strike: toe up, pivot at the heel
        const ankle = [uP, ANKLE * scale];
        const th = flat + p;
        return { ankle, toe: [ankle[0] + L * Math.cos(th), ankle[1] + L * Math.sin(th)] };
      }
      if (phi < 0.42) {
        const ankle = [uP, ANKLE * scale];
        return { ankle, toe: flatToe(uP) };
      }
      const r = riseEnd * ((phi - 0.42) / 0.18) ** 1.3;
      return heelRise(uP, r);
    }
    // swing, from the end of the heel rise to the next heel strike
    const e = (phi - 0.6) / 0.4;
    const A0 = heelRise(plantU(n, k), riseEnd).ankle;
    const A1 = [plantU(n + 1, k), ANKLE * scale];
    const s2 = sstep(e);
    const ankle = [
      lerp(A0[0], A1[0], s2 ** 0.85),
      lerp(A0[1], A1[1], s2) + 0.16 * scale * Math.sin(Math.PI * e ** 0.8) ** 1.1,
    ];
    const p = lerp(-riseEnd, 0.3, sstep(e * 1.15));
    const th = flat + p;
    return { ankle, toe: [ankle[0] + L * Math.cos(th), ankle[1] + L * Math.sin(th)] };
  };

  const lean = 0.07 + 0.02 * (look.helmShade - 0.5) + 0.012 * Math.cos(2 * Math.PI * 2 * (ph - 0.3));
  const tv = [Math.sin(lean) * f, Math.cos(lean)];
  const nv = [Math.cos(lean) * f, -Math.sin(lean)];
  const neck = [hips[0] + tv[0] * D.trunk, hips[1] + tv[1] * D.trunk];
  const spine = [
    hips[0] + tv[0] * D.trunk * 0.5 + nv[0] * 0.025 * scale,
    hips[1] + tv[1] * D.trunk * 0.5 + nv[1] * 0.025 * scale,
  ];
  const ha = lean - 0.07 + 0.02 * Math.sin(2 * Math.PI * 2 * ph);
  const head = [neck[0] + Math.sin(ha) * f * D.neck, neck[1] + Math.cos(ha) * D.neck];
  const sh = [neck[0] - tv[0] * 0.05 * scale, neck[1] - tv[1] * 0.05 * scale];

  const legs = {};
  const rel = {};
  for (const [nm, k] of [
    ['N', 0],
    ['F', 1],
  ]) {
    const ft = foot(k);
    const ax = x0 + f * ft.ankle[0];
    const ay = ft.ankle[1];
    const r = ik2(hips[0], hips[1], ax, ay, D.thigh, D.shin, [f, 0.15]);
    legs[nm] = { knee: r.joint, foot: r.end, toe: [x0 + f * ft.toe[0], ft.toe[1]] };
    rel[nm] = (ft.ankle[0] - u) / a; // -1 (back) .. +1 (front)
  }

  // arms: the near arm swings against the near leg; the far hand carries the spear
  const armL = (D.upper + D.fore) * 0.985;
  const swing = clamp(-rel.N, -1.2, 1.2) * 0.42;
  const nearT = [sh[0] + f * Math.sin(swing) * armL * 0.9, sh[1] - Math.cos(swing) * armL * 0.9];
  const pref = [-0.35 * f, -1];
  const an = ik2(sh[0], sh[1], nearT[0], nearT[1], D.upper, D.fore, pref);
  const farT = [sh[0] + f * 0.3 * scale, sh[1] - 0.3 * scale + 0.01 * Math.cos(2 * Math.PI * 2 * ph)];
  const af = ik2(sh[0], sh[1], farT[0], farT[1], D.upper, D.fore, pref);
  const ang = Math.PI / 2 - 0.05 + look.spearJitter + 0.012 * Math.sin(2 * Math.PI * 2 * (ph - 0.1));
  const dir = [Math.cos(ang) * f, Math.sin(ang)];
  const butt = [af.end[0] - dir[0] * 1.02 * scale, af.end[1] - dir[1] * 1.02 * scale];
  const tip = [butt[0] + dir[0] * spearLen * scale, butt[1] + dir[1] * spearLen * scale];
  return {
    name: o.name ?? `march${seed}`,
    t,
    facing: f,
    X: hips[0],
    Z: z,
    hips,
    spine,
    neck,
    head,
    headR: D.headR,
    shoulder: sh,
    legs,
    arms: { N: { elbow: an.joint, hand: an.end }, F: { elbow: af.joint, hand: af.end } },
    weapon: { kind: 'spear', butt, tip, rear: af.end, lead: null, dir, ang, aimW: 0 },
    over: 0,
  };
}

/** Recent skeletons for the cloth: hist[k] is the skeleton at t - k / 24 (k = 0 is now). */
export const HIST_DT = 1 / 24;
export function history(skelFn, t, n = 8) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(skelFn(t - k * HIST_DT));
  return out;
}

/** One anchor (a joint of the skeleton) as it was `tau` seconds ago, interpolated. */
function anchorAt(hist, get, tau) {
  const k = clamp(tau / HIST_DT, 0, hist.length - 1);
  const k0 = Math.floor(k);
  const k1 = Math.min(hist.length - 1, k0 + 1);
  return V2.lerp(get(hist[k0]), get(hist[k1]), k - k0);
}

/**
 * Cloth as a chain that lags behind its anchor, a pure function of the skeleton's recent past:
 * point i hangs `i * seg` from the anchor along `dir`, is displaced by what the anchor has moved
 * in the last i * tau0 seconds (times `gain`: the cloth has not caught up), flutters, and keeps
 * its segment lengths.
 */
function chain(hist, get, o) {
  const { n, seg, dir, tau0, gain, flutter, phase, t, floor = -Infinity, push = null, bias = null } = o;
  const a0 = get(hist[0]);
  const pts = [a0];
  const perp = [-dir[1], dir[0]];
  for (let i = 1; i <= n; i++) {
    const w = i / n;
    const at = anchorAt(hist, get, i * tau0);
    let x = a0[0] + dir[0] * seg * i + (at[0] - a0[0]) * gain * (0.35 + 0.65 * w);
    let y = a0[1] + dir[1] * seg * i + (at[1] - a0[1]) * gain * (0.35 + 0.65 * w);
    const fl = flutter * w * Math.sin(t * 15 - i * 1.15 + phase) + flutter * 0.5 * w * Math.sin(t * 9.1 + i * 0.7 + phase * 2);
    x += perp[0] * fl;
    y += perp[1] * fl;
    if (push) {
      x += push[0] * w * w;
      y += push[1] * w * w;
    }
    if (bias) {
      x += bias[0] * w;
      y += bias[1] * w;
    }
    const prev = pts[i - 1];
    const vx = x - prev[0];
    const vy = y - prev[1];
    const l = Math.hypot(vx, vy) || 1;
    let px = prev[0] + (vx / l) * seg;
    let py = prev[1] + (vy / l) * seg;
    if (py < floor) py = floor;
    pts.push([px, py]);
  }
  return pts;
}

// ------------------------------------------------------------------- the helm profile

// the helm in head coordinates: f forward, u up, metres for a head of radius 0.115
const HELM = [
  [0.135, 0.03],
  [0.118, 0.105],
  [0.06, 0.16],
  [-0.03, 0.178],
  [-0.1, 0.145],
  [-0.145, 0.05],
  [-0.15, -0.06],
  [-0.118, -0.138],
  [0.0, -0.152],
  [0.1, -0.142],
  [0.142, -0.09],
  [0.152, -0.02],
];
const HELM_ROWS = (() => {
  const rows = [];
  const N = 22;
  const u0 = -0.15;
  const u1 = 0.176;
  for (let j = 0; j <= N; j++) {
    const u = u0 + ((u1 - u0) * j) / N;
    let F = -Infinity;
    let B = Infinity;
    for (let k = 0; k < HELM.length; k++) {
      const a = HELM[k];
      const b = HELM[(k + 1) % HELM.length];
      if ((a[1] <= u && b[1] > u) || (b[1] <= u && a[1] > u)) {
        const f = a[0] + ((u - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        F = Math.max(F, f);
        B = Math.min(B, f);
      }
    }
    if (F === -Infinity) {
      // cap rows: take the nearest polygon vertex
      F = HELM.reduce((m, p) => (Math.abs(p[1] - u) < Math.abs(m[1] - u) ? p : m))[0];
      B = F - 0.02;
    }
    rows.push({ u, F, B });
  }
  return rows;
})();

// ------------------------------------------------------------------------ the painter

/**
 * Paint one soldier. sk: a skeleton (ford_blocking.js format); xf: see the top of the file.
 * o: { look (soldierLook), seed, haze 0..1, boots, hist (history(...)), t (drawing time),
 *      detail (0 sketch, 1 plates, 2 all; default from size), wind, yaw via xf }
 */
export function drawSoldier(frame, fw, fh, sk, xf, o = {}) {
  const look = o.look ?? soldierLook(o.seed ?? 0);
  const s = xf.s;
  const bs = (sk.headR / 0.115) * look.size;
  const fac = sk.facing;
  const flip = xf.flip ? -1 : 1;
  const dsc = fac * flip; // screen direction the soldier faces
  const yaw = xf.yaw ?? 0;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const tilt = xf.tilt ?? 0;
  const Xc = sk.hips[0];
  const ax = xf.ax ?? Xc;
  const ay = xf.ay ?? 0;
  const H = s * 1.85 * bs;
  const detail = o.detail ?? (H < 56 ? 0 : H < 96 ? 1 : 2);
  const t = o.t ?? sk.t ?? 0;
  const T = makeTones({ ...o, boots: o.boots ?? look.boots });
  const F = {
    iron: dim(T.iron),
    crimson: dim(T.crimson),
    leather: dim(T.leather),
    helm: dim(T.helm),
  };
  const seed = look.seed;

  // world -> screen (+ view depth). p: [X, Y] world; z: lateral offset, + toward the camera
  const P = (p, z = 0) => {
    const xp = (p[0] - Xc) * fac;
    return [
      xf.x + s * ((Xc - ax) * flip + dsc * (xp * cy - z * sy)),
      xf.y - s * (p[1] - ay) + s * tilt * (sk.Z ?? 0),
      z * cy + xp * sy,
    ];
  };
  const Pt = (p, z = 0) => {
    const q = P(p, z);
    return [q[0], q[1]];
  };
  const R = (m) => m * bs * s; // a radius in px
  const hipsW = sk.hips;
  const tvw = V2.norm(V2.sub(sk.neck, sk.hips));
  const nvw = [tvw[1] * fac, -tvw[0] * fac]; // toward the chest
  const backw = [-fac, 0];

  // ---- screen bounding region (generous), and the silhouette occupancy
  {
    const all = [
      sk.hips,
      sk.neck,
      sk.head,
      sk.shoulder,
      sk.weapon.butt,
      sk.weapon.tip,
      sk.legs.N.foot,
      sk.legs.N.toe,
      sk.legs.N.knee,
      sk.legs.F.foot,
      sk.legs.F.toe,
      sk.legs.F.knee,
      sk.arms.N.hand,
      sk.arms.F.hand,
      sk.arms.N.elbow,
      sk.arms.F.elbow,
    ];
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    for (const p of all) {
      const q = Pt(p, 0.25);
      const q2 = Pt(p, -0.25);
      for (const r of [q, q2]) {
        minx = Math.min(minx, r[0]);
        maxx = Math.max(maxx, r[0]);
        miny = Math.min(miny, r[1]);
        maxy = Math.max(maxy, r[1]);
      }
    }
    const pad = 1.6 * s * bs + 6; // the cloak, the helm's crest
    S.ox = Math.max(0, Math.floor(minx - pad));
    S.oy = Math.max(0, Math.floor(miny - pad * 0.7));
    const ex = Math.min(fw, Math.ceil(maxx + pad));
    const ey = Math.min(fh, Math.ceil(maxy + pad * 0.7));
    S.ow = Math.max(0, Math.min(MAXB, ex - S.ox));
    S.oh = Math.max(0, Math.min(MAXB, ey - S.oy));
    if (S.ow <= 2 || S.oh <= 2) return;
    if (!S.occ || S.occ.length < S.ow * S.oh) S.occ = new Uint8Array(MAXB * MAXB);
    S.occ.fill(0, 0, S.ow * S.oh);
    S.frame = frame;
    S.fw = fw;
    S.fh = fh;
  }

  const parts = [];
  const add = (d, fn) => parts.push([d, parts.length, fn]);
  const depthOf = (p, z) => P(p, z)[2];
  const inner = detail >= 1;

  // -------------------------------------------------------------------- the legs
  const legPart = (nm) => {
    const leg = sk.legs[nm];
    const near = nm === 'N';
    const z = near ? 0.105 : -0.105;
    const tn = near ? T : null;
    const Tn = (k) => (near ? T[k] : F[k]);
    const hip = Pt(hipsW, z);
    const knee = Pt(leg.knee, z * 1.1);
    const ank = Pt(leg.foot, z * 1.1);
    const toe = Pt(leg.toe, z * 1.1);
    const dep = (near ? 0.9 : -0.9) + (depthOf(leg.knee, z) - z * cy) * 0.5;
    add(dep, () => {
      const outline = inner ? Tn('iron').edge : null;
      // thigh
      capsule(hip[0], hip[1], knee[0], knee[1], R(0.088), R(0.068));
      paint(cylShade(Tn('iron'), { seed: seed + 1, hi: detail >= 1, mottle: 0.6 }), outline);
      // boot shaft (tall, up the shin), greave over the shin, then the cuff
      const shin = V2.sub(knee, ank);
      const bootTop = V2.add(ank, V2.mul(shin, 0.5));
      capsule(knee[0], knee[1], ank[0], ank[1], R(0.066), R(0.052));
      paint(cylShade(Tn('iron'), { seed: seed + 2, hi: detail >= 1, mottle: 0.6 }), outline);
      capsule(ank[0], ank[1], bootTop[0], bootTop[1], R(0.056), R(0.063));
      paint(cylShade(Tn('leather'), { seed: seed + 3, hi: detail >= 2, mottle: 0.9 }), inner ? Tn('leather').edge : null);
      if (detail >= 1) {
        // the boot cuff: a darker band across the top of the boot
        const c0 = V2.lerp(ank, bootTop, 0.88);
        capsule(c0[0], c0[1], bootTop[0], bootTop[1], R(0.064), R(0.067));
        paint(cylShade(Tn('leather'), { seed: seed + 4, hi: false, mottle: 0 }), Tn('leather').edge);
      }
      // the foot: heel to toe, sole in the darkest brown
      const fd = V2.norm(V2.sub(toe, ank));
      const heel = [ank[0] - fd[0] * R(0.055), ank[1] - fd[1] * R(0.055) + R(0.02)];
      capsule(heel[0], heel[1], toe[0], toe[1], R(0.052), R(0.03));
      // sole = the low side of the capsule
      const dn = M.ny >= 0 ? 1 : -1;
      const lt = Tn('leather');
      paint(
        (u, v) => {
          const vv = v * dn;
          if (vv > 0.56) return lt.edge;
          if (vv < -0.62 && u > 0.05 && u < 0.85 && detail >= 1) return lt.hi;
          return u > 0.8 ? lt.lit : vv < -0.15 ? lt.lit : lt.base;
        },
        inner ? lt.edge : null,
      );
      // knee cop (front of the knee)
      const kd = V2.norm(V2.sub(knee, hip));
      const kfront = Pt(V2.add(leg.knee, V2.mul(nvw, 0.03 * bs)), z * 1.1);
      const kr = R(0.066);
      ellipse(kfront[0], kfront[1], kr, kr * 0.95, Math.atan2(kd[1], kd[0]));
      paint(domeShade(Tn('iron'), kfront[0], kfront[1], kr, { seed: seed + 5, hi: detail >= 1 }), inner ? Tn('iron').edge : null);
    });
  };
  legPart('F');
  legPart('N');

  // -------------------------------------------------------------------- the arms
  const wp = sk.weapon;
  const gripped = (hand, target) => target && V2.len(V2.sub(hand, target)) < 0.05 * bs + 0.03;
  const armPart = (nm) => {
    const arm = sk.arms[nm];
    const near = nm === 'N';
    const Tn = (k) => (near ? T[k] : F[k]);
    const grip = gripped(arm.hand, near ? wp.rear : wp.lead || wp.rear);
    const zs = near ? 0.19 : -0.19;
    const zh = grip ? (near ? 0.05 : -0.05) : zs * 1.15;
    const shp = Pt(sk.shoulder, zs);
    const el = Pt(arm.elbow, (zs + zh) / 2 * 1.1);
    const hd = Pt(arm.hand, zh);
    const dep = (near ? 1.0 : -1.0) + (depthOf(arm.hand, zh) - zh * cy) * 0.6;
    const outline = inner ? Tn('iron').edge : null;
    add(dep, () => {
      capsule(shp[0], shp[1], el[0], el[1], R(0.062), R(0.054));
      paint(cylShade(Tn('iron'), { seed: seed + 6, hi: detail >= 1, mottle: 0.6 }), outline);
      capsule(el[0], el[1], hd[0], hd[1], R(0.056), R(0.047));
      paint(cylShade(Tn('helm'), { seed: seed + 7, hi: detail >= 1, mottle: 0.5 }), outline);
      if (detail >= 2) {
        // vambrace bands
        for (const q of [0.45, 0.78]) {
          const c = V2.lerp(el, hd, q);
          const dd = V2.norm(V2.sub(hd, el));
          capsule(c[0] - dd[0] * R(0.008), c[1] - dd[1] * R(0.008), c[0] + dd[0] * R(0.008), c[1] + dd[1] * R(0.008), R(0.058 - 0.01 * q), R(0.058 - 0.01 * q));
          paint(() => Tn('iron').edge, null);
        }
      }
      // couter (elbow cop)
      ellipse(el[0], el[1], R(0.062), R(0.058), 0);
      paint(domeShade(Tn('iron'), el[0], el[1], R(0.062), { seed: seed + 8, hi: detail >= 1 }), outline);
      // gauntlet fist, a little past the wrist
      const dd = V2.norm(V2.sub(hd, el));
      const fc = [hd[0] + dd[0] * R(0.03), hd[1] + dd[1] * R(0.03)];
      ellipse(fc[0], fc[1], R(0.062), R(0.056), Math.atan2(dd[1], dd[0]));
      paint(domeShade(Tn('iron'), fc[0], fc[1], R(0.06), { seed: seed + 9, hi: detail >= 1 }), Tn('iron').edge);
    });
    // the pauldron over the shoulder, on the arm's side
    if (near || Math.abs(sy) > 0.2) {
      const ad = V2.norm(V2.sub(el, shp));
      const pc = [shp[0] + ad[0] * R(0.06), shp[1] + ad[1] * R(0.06) - R(0.03)];
      add(dep + 0.05, () => {
        const rx = R(0.135);
        const ry = R(0.105);
        const rot = Math.atan2(ad[1], ad[0]);
        ellipse(pc[0], pc[1], rx, ry, rot);
        const T2 = Tn('iron');
        const dome = domeShade(T2, pc[0], pc[1], Math.max(rx, ry) * 0.92, { seed: seed + 10, hi: detail >= 1 });
        paint(
          (u, v, x, y) => {
            if (detail >= 1 && (Math.abs(u - 0.5) < 0.05 || Math.abs(u - 0.75) < 0.05) && Math.abs(v) < 0.92)
              return T2.deep;
            return dome(u, v, x, y);
          },
          T2.edge,
        );
      });
    }
  };
  armPart('F');
  armPart('N');

  // ----------------------------------------------------------------- the trunk
  // spine centre curve (a quadratic through hips, spine, neck)
  const ctrl = V2.sub(V2.mul(sk.spine, 2), V2.mul(V2.add(sk.hips, sk.neck), 0.5));
  const bez = (u) => {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return [a * sk.hips[0] + b * ctrl[0] + c * sk.neck[0], a * sk.hips[1] + b * ctrl[1] + c * sk.neck[1]];
  };
  // trunk sections: t along, depth front / back, lateral half-width
  const SEC = [
    [0.0, 0.135, 0.115, 0.165],
    [0.3, 0.125, 0.105, 0.15],
    [0.68, 0.16, 0.13, 0.2],
    [0.92, 0.14, 0.12, 0.19],
    [1.0, 0.1, 0.09, 0.09],
  ];
  const trunkEdges = () => {
    const Ls = [];
    const Rs = [];
    for (let i = 0; i < 9; i++) {
      const u = i / 8;
      // interpolate the section table
      let k = 1;
      while (k < SEC.length - 1 && u > SEC[k][0]) k++;
      const A = SEC[k - 1];
      const B = SEC[k];
      const w = clamp((u - A[0]) / (B[0] - A[0]));
      const fr = lerp(A[1], B[1], w) * bs;
      const bk = lerp(A[2], B[2], w) * bs;
      const la = lerp(A[3], B[3], w) * bs;
      const c = Pt(bez(u), 0);
      const c2 = Pt(bez(Math.min(1, u + 0.04)), 0);
      const c1 = Pt(bez(Math.max(0, u - 0.04)), 0);
      const tg = V2.norm(V2.sub(c2, c1));
      const nf = [-tg[1] * dsc, tg[0] * dsc]; // toward the chest on screen
      const fe = Math.hypot(fr * cy, la * sy) * s;
      const be = Math.hypot(bk * cy, la * sy) * s;
      Ls.push([c[0] + nf[0] * fe, c[1] + nf[1] * fe]);
      Rs.push([c[0] - nf[0] * be, c[1] - nf[1] * be]);
    }
    return [Ls, Rs];
  };
  const [tL, tR] = trunkEdges();
  add(0, () => {
    ribbon(tL, tR);
    const Tc = T.crimson;
    const mot = look.mottle;
    // decals: belt, cross
    const cAt = (u) => {
      const a = V2.lerp(tL[Math.min(8, Math.floor(u * 8))], tR[Math.min(8, Math.floor(u * 8))], 0.5);
      return a;
    };
    const cross = {
      p0: V2.lerp(V2.lerp(tL[4], tR[4], 0.28), V2.lerp(tL[7], tR[7], 0.28), 0.0),
      p1: V2.lerp(tL[7], tR[7], 0.28),
    };
    const chestA = V2.lerp(tL[4], tR[4], 0.3);
    const chestB = V2.lerp(tL[7], tR[7], 0.3);
    const barW = Math.max(0.9, R(0.03));
    const armMid = V2.lerp(chestA, chestB, 0.5);
    const armDir = V2.norm(V2.sub(tL[5], tR[5]));
    const armHalf = Math.max(1.4, s * bs * (0.05 + 0.1 * Math.abs(sy)));
    const inCross = (x, y) => {
      if (look.motif === 'sun') {
        const cc = V2.lerp(chestA, chestB, 0.5);
        const d = Math.hypot(x + 0.5 - cc[0], y + 0.5 - cc[1]);
        const rr = R(0.075);
        return d < rr && d > rr * 0.4 ? 1 : d <= rr * 0.4 ? 2 : 0;
      }
      // vertical bar chestA -> chestB, horizontal arm across the chest
      const dx = chestB[0] - chestA[0];
      const dy = chestB[1] - chestA[1];
      const L2 = dx * dx + dy * dy || 1;
      const tt = clamp(((x + 0.5 - chestA[0]) * dx + (y + 0.5 - chestA[1]) * dy) / L2);
      const ex = x + 0.5 - (chestA[0] + dx * tt);
      const ey = y + 0.5 - (chestA[1] + dy * tt);
      if (ex * ex + ey * ey < barW * barW) return 1;
      const hx = x + 0.5 - armMid[0];
      const hy = y + 0.5 - armMid[1];
      const along = hx * armDir[0] + hy * armDir[1];
      const acr = hx * armDir[1] - hy * armDir[0];
      if (Math.abs(along) < armHalf && Math.abs(acr) < barW * 1.05) return 1;
      return 0;
    };
    paint(
      (u, v, x, y) => {
        // belt band
        if (u > 0.3 && u < 0.3 + (detail >= 1 ? 0.085 : 0.06)) {
          if (detail >= 1 && v < -0.55 && v > -0.9 && u > 0.315 && u < 0.36) return T.leather.lit;
          return T.iron.base;
        }
        if (detail >= 1 && u > 0.385 && u < 0.4 && Math.abs(v) < 0.95) return T.iron.deep;
        // the black motif
        const ic = u > 0.45 && u < 0.97 ? inCross(x, y) : 0;
        if (ic === 1) return T.iron.base;
        if (ic === 2) return Tc.base;
        // crimson lacquer, a little uneven: patches by the part's own coordinates
        const n = nz(u, v, 14, seed + 40);
        const trimEdge = v < -0.86 || v > 0.9;
        let c = Tc.base;
        if (n > 0.8 - 0.1 * mot) c = Tc.lit;
        else if (n < 0.14 + 0.08 * mot) c = Tc.shade;
        if (detail >= 1 && v > 0.15 && v < 0.7 && ((u * 13 + v * 3) % 1) < 0.12) c = Tc.shade; // a fold
        if (trimEdge && detail >= 1) c = Tc.shade;
        return c;
      },
      inner ? T.crimson.edge : null,
    );
  });

  // ------------------------------------------------------- collar, head, helm
  const headC = Pt(sk.head, 0);
  const neckB = Pt(sk.neck, 0);
  const upw = V2.norm(V2.sub(sk.head, sk.neck));
  const fwdw = [upw[1] * fac, -upw[0] * fac];
  add(0.06, () => {
    // gorget: a short, thick collar
    const a = Pt(V2.sub(sk.neck, V2.mul(tvw, 0.075 * bs)));
    const b = Pt(V2.add(sk.neck, V2.mul(upw, 0.05 * bs)));
    capsule(a[0], a[1], b[0], b[1], R(0.085), R(0.078));
    paint(cylShade(T.iron, { seed: seed + 11, hi: detail >= 1, mottle: 0.5 }), inner ? T.iron.edge : null);
    if (detail >= 1) {
      // the crimson rim of the collar
      const rim = Pt(V2.add(sk.neck, V2.mul(upw, 0.035 * bs)));
      capsule(rim[0], rim[1], rim[0], rim[1], R(0.084), R(0.084));
      paint(
        (u, v, x, y) => (y + 0.5 < rim[1] + R(0.012) && y + 0.5 > rim[1] - R(0.018) ? T.crimson.base : T.iron.base),
        null,
      );
    }
  });

  // the helm: drawn from the profile rows. The profile is a horizontal ellipse at each height
  // (semi-axis a, centre fc, lateral half-width lat); yaw squeezes the forward axis and widens
  // by the lateral, so one description gives the side view and the 3/4. (xh, up) are head-frame
  // metres with yaw already applied; hs() puts them on the page.
  const upS = V2.norm(V2.sub(headC, neckB)); // the head's up on screen (y down)
  const fsS = [-upS[1] * dsc, upS[0] * dsc]; // and its forward
  const hs = (xh, up) => [
    headC[0] + s * bs * (fsS[0] * xh + upS[0] * up),
    headC[1] + s * bs * (fsS[1] * xh + upS[1] * up),
  ];
  const rowAt = (u) => {
    let j = 0;
    while (j < HELM_ROWS.length - 2 && HELM_ROWS[j + 1].u < u) j++;
    const A = HELM_ROWS[j];
    const B = HELM_ROWS[j + 1];
    const w = clamp((u - A.u) / (B.u - A.u));
    const F0 = lerp(A.F, B.F, w);
    const B0 = lerp(A.B, B.B, w);
    const a = (F0 - B0) / 2;
    return { a, fc: (F0 + B0) / 2, lat: Math.min(0.112, a * 0.86) };
  };
  const drawHelm = () => {
    const rs = [];
    const ls = [];
    for (const r of HELM_ROWS) {
      const a = (r.F - r.B) / 2;
      const fc = (r.F + r.B) / 2;
      const lat = Math.min(0.112, a * 0.86);
      const wdt = Math.hypot(a * cy, lat * sy);
      rs.push(hs(fc * cy + wdt, r.u));
      ls.push(hs(fc * cy - wdt, r.u));
    }
    const Rh = R(0.155);
    const hc = hs(0.005, -0.005);
    polygon(rs.concat(ls.reverse()), (px, py) => [(px - hc[0]) / Rh * 0.5 + 0.5, (py - hc[1]) / Rh]);
    const Th = { ...T.helm };
    if (look.helmShade > 0.6) Th.base = T.iron.lit;
    const dome = domeShade(Th, hc[0], hc[1], Rh, { seed: seed + 12, hi: detail >= 1, mottle: 0.4 });
    paint(
      (u, v, x, y) => {
        let c = dome(u, v, x, y);
        // the bevor (below the slit, on the face side) sits darker than the crown
        if (detail >= 1) {
          const rx = (x + 0.5 - headC[0]) / (s * bs);
          const ry = (y + 0.5 - headC[1]) / (s * bs);
          const hgt = rx * upS[0] + ry * upS[1];
          const fwd = rx * fsS[0] + ry * fsS[1];
          if (hgt < -0.055 && fwd > -0.03 * cy) c = c === Th.hi || c === Th.lit ? Th.base : Th.shade;
        }
        return c;
      },
      T.helm.edge,
    );
    // eye slit, vents and brow rim, placed by azimuth so they turn with the head
    const surfPt = (alpha, u) => {
      const { a, fc, lat } = rowAt(u);
      const f = fc + a * Math.cos(alpha);
      const zz = lat * Math.sin(alpha);
      const vis = (Math.cos(alpha) * sy) / a + (Math.sin(alpha) * cy) / lat;
      return { p: hs(f * cy - zz * sy, u), vis };
    };
    const slitW = Math.max(0.75, R(0.017));
    const run = (u, w, col, a0 = 0.06, a1 = 1.15, n = 9) => {
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const q = surfPt(a0 + ((a1 - a0) * k) / n, u);
        if (prev && q.vis > 0.02 && prev.vis > 0.02) {
          capsule(prev.p[0], prev.p[1], q.p[0], q.p[1], w, w);
          paint(() => col, null);
        }
        prev = q;
      }
    };
    run(0.028, slitW, T.slit);
    if (detail >= 2) {
      for (const al of [0.4, 0.62, 0.84]) {
        const a = surfPt(al, -0.045);
        const b = surfPt(al, -0.105);
        if (a.vis > 0.02) {
          capsule(a.p[0], a.p[1], b.p[0], b.p[1], Math.max(0.6, R(0.009)), Math.max(0.6, R(0.009)));
          paint(() => T.slit, null);
        }
      }
      run(0.06, 0.6, T.trim);
    }
    if (Math.abs(sy) > 0.15) {
      const a = surfPt(0, 0.03);
      const b = surfPt(0, -0.11);
      capsule(a.p[0], a.p[1], b.p[0], b.p[1], Math.max(0.7, R(0.014)), Math.max(0.7, R(0.014)));
      paint(() => T.helm.lit, null);
    }
  };

  const drawCrest = () => {
    const at = (f, u) => hs(f * cy, u);
    const c = look.crest;
    let poly = null;
    if (c === 'fin') {
      poly = [at(0.08, 0.15), at(0.0, 0.176), at(-0.09, 0.15), at(-0.06 - look.finLen, 0.15 + look.finLift + 0.04), at(0.0, 0.176 + look.finLift + 0.02)];
    } else if (c === 'comb') {
      poly = [at(0.09, 0.14), at(0.05, 0.19), at(-0.02, 0.215), at(-0.09, 0.19), at(-0.11, 0.135), at(-0.02, 0.17)];
    } else if (c === 'horn') {
      poly = [at(0.06, 0.16), at(0.11, 0.245), at(0.14, 0.17), at(0.09, 0.13)];
    }
    if (!poly) return;
    polygon(poly, (px, py) => [0.5, 0]);
    const top = Math.min(...poly.map((p) => p[1]));
    paint((u, v, x, y) => (y < top + 1.2 && detail >= 1 ? T.helm.lit : T.helm.base), T.helm.edge);
  };
  add(0.08, () => {
    drawCrest();
    drawHelm();
    // cross clasps at the collar
    if (detail >= 1) {
      for (const [off, back] of [
        [0.085, 0.045],
        [0.005, 0.07],
      ]) {
        const p = Pt(V2.add(V2.sub(sk.neck, V2.mul(tvw, back * bs)), V2.mul(nvw, off * bs)), 0.02);
        const r = Math.max(1.4, R(0.038));
        ellipse(p[0], p[1], r, r, 0);
        paint(
          (u, v) => (detail >= 2 && (Math.abs(u - 0.5) < 0.09 || Math.abs(v) < 0.14) ? T.iron.base : T.crimson.lit),
          T.crimson.edge,
        );
      }
    }
  });

  // ------------------------------------------------------- the tabard flaps
  const t0 = t;
  const hist = o.hist;
  const histSafe = hist && hist.length ? hist : [sk];
  const kneeFwd = Math.max(
    ...['N', 'F'].map((nm) => (sk.legs[nm].knee[0] - sk.hips[0]) * fac),
    0,
  );
  const footBack = Math.min(...['N', 'F'].map((nm) => (sk.legs[nm].foot[0] - sk.hips[0]) * fac), 0);
  const flap = (front) => {
    const sgn = front ? 1 : -1;
    const N = detail >= 1 ? 4 : 3;
    const beltU = 0.3;
    const anchor = (sk2) => {
      const b = V2.add(sk2.hips, V2.mul(V2.sub(sk2.neck, sk2.hips), beltU));
      const nv2 = V2.norm(V2.sub(sk2.neck, sk2.hips));
      const nf = [nv2[1] * sk2.facing, -nv2[0] * sk2.facing];
      return V2.add(b, V2.mul(nf, sgn * 0.115 * bs));
    };
    const len = (front ? 0.66 : 0.6) * bs;
    const pushX = front ? clamp(kneeFwd * 0.62, 0, 0.32) * fac : clamp(-footBack * 0.4, 0, 0.26) * -fac;
    const pts = chain(histSafe, anchor, {
      n: N,
      seg: len / N,
      dir: [0, -1],
      tau0: 0.03,
      gain: 1.25,
      flutter: 0.012,
      phase: seed * 1.7 + (front ? 0 : 2),
      t: t0,
      push: [pushX * bs, 0],
    });
    const ws = front ? [0.105, 0.115, 0.105, 0.07, 0.02] : [0.095, 0.1, 0.09, 0.06, 0.02];
    const Ls = [];
    const Rs = [];
    for (let i = 0; i <= N; i++) {
      const c = Pt(pts[i], 0);
      const c0 = Pt(pts[Math.max(0, i - 1)], 0);
      const c1 = Pt(pts[Math.min(N, i + 1)], 0);
      const tg = V2.norm(V2.sub(c1, c0));
      const nrm = [-tg[1], tg[0]];
      const half = Math.hypot(ws[Math.min(i, ws.length - 1)] * bs * cy, (front ? 0.15 : 0.16) * bs * sy * (1 - i / (N + 1.5))) * s;
      Ls.push([c[0] + nrm[0] * half, c[1] + nrm[1] * half]);
      Rs.push([c[0] - nrm[0] * half, c[1] - nrm[1] * half]);
    }
    const teeth = look.ragTeeth;
    const cut = (u, v) => {
      // a pointed, ragged hem
      const k = (v + 1) * 0.5 * teeth;
      const i0 = Math.floor(k);
      const tri = Math.abs(k - i0 - 0.5) * 2;
      const hgt = look.rag[(i0 + (front ? 0 : 5)) % 12];
      return u > 0.93 + (1 - hgt) * 0.05 + tri * 0.04 * hgt - (front ? Math.abs(v) * 0.02 : 0);
    };
    return { Ls, Rs, cut };
  };
  {
    const bf = flap(false);
    add(-0.3, () => {
      ribbon(bf.Ls, bf.Rs, bf.cut);
      const Tc = F.crimson;
      paint(
        (u, v) => {
          const n = nz(u, v, 12, seed + 50);
          if (u < 0.06) return T.iron.base;
          if (detail >= 1 && (v < -0.8 || v > 0.8)) return Tc.deep;
          return n > 0.78 ? Tc.base : n < 0.2 ? Tc.deep : Tc.shade;
        },
        inner ? Tc.edge : null,
      );
    });
    const ff = flap(true);
    add(0.12, () => {
      ribbon(ff.Ls, ff.Rs, ff.cut);
      const Tc = T.crimson;
      const mot = look.mottle;
      paint(
        (u, v) => {
          if (u < 0.05) return T.iron.base;
          // the black band of the cross runs down the front of the tabard
          if (Math.abs(v) < 0.17 && u > 0.1 && u < 0.86 - Math.abs(v) * 0.4) return T.iron.base;
          const n = nz(u, v, 12, seed + 60);
          let c = Tc.base;
          if (n > 0.82 - 0.1 * mot) c = Tc.lit;
          else if (n < 0.16 + 0.06 * mot) c = Tc.shade;
          if (detail >= 1 && (v < -0.82 || v > 0.82)) c = Tc.lit; // the orange-ish trim reads as a lit edge
          return c;
        },
        inner ? Tc.edge : null,
      );
    });
  }

  // ------------------------------------------------------------------ the cloak
  {
    const N = detail >= 1 ? 7 : 5;
    const windAmt = o.wind ?? look.wind;
    const aOuter = (sk2) => {
      const nv2 = V2.norm(V2.sub(sk2.neck, sk2.hips));
      const nf = [nv2[1] * sk2.facing, -nv2[0] * sk2.facing];
      return V2.add(sk2.neck, V2.add(V2.mul(nf, -0.06 * bs), V2.mul(nv2, -0.01)));
    };
    const aInner = (sk2) => {
      const nv2 = V2.norm(V2.sub(sk2.neck, sk2.hips));
      const nf = [nv2[1] * sk2.facing, -nv2[0] * sk2.facing];
      return V2.add(V2.add(sk2.hips, V2.mul(V2.sub(sk2.neck, sk2.hips), 0.36)), V2.mul(nf, -0.125 * bs));
    };
    const bk = backw[0];
    const dirO = V2.norm([bk * (0.3 + windAmt), -1]);
    const dirI = V2.norm([bk * (0.18 + windAmt * 0.55), -1]);
    const floorY = Math.min(sk.legs.N.foot[1], sk.legs.F.foot[1]) - ANKLE + 0.04;
    const Lo = 1.18 * bs;
    const Li = 0.86 * bs;
    const co = chain(histSafe, aOuter, {
      n: N,
      seg: Lo / N,
      dir: dirO,
      tau0: 0.035,
      gain: 1.7,
      flutter: 0.03,
      phase: seed * 2.3,
      t: t0,
      floor: floorY,
    });
    const ci = chain(histSafe, aInner, {
      n: N,
      seg: Li / N,
      dir: dirI,
      tau0: 0.03,
      gain: 1.3,
      flutter: 0.02,
      phase: seed * 2.3 + 1.1,
      t: t0,
      floor: floorY,
    });
    // keep the cloak behind the back
    const Ls = [];
    const Rs = [];
    for (let i = 0; i <= N; i++) {
      const a = Pt(co[i], -0.02);
      const b = Pt(ci[i], -0.02);
      Ls.push(a);
      Rs.push(b);
    }
    const teeth = look.ragTeeth + 1;
    const cut = (u, v) => {
      const k = (v + 1) * 0.5 * teeth;
      const i0 = Math.floor(k);
      const tri = Math.abs(k - i0 - 0.5) * 2;
      const hgt = look.rag[(i0 + 3) % 12];
      return u > 1 - look.ragDepth * (0.35 + hgt * 0.65) * (0.35 + tri * 0.65) * 1.6;
    };
    add(-0.6, () => {
      ribbon(Ls, Rs, cut);
      const Tc = T.cloak;
      paint(
        (u, v) => {
          const n = nz(u, v, 10, seed + 70);
          // folds run down the length of the cloak
          const fold = Math.sin((v + 1) * (2.6 + look.mottle * 1.6) * Math.PI + Math.sin(u * 5 + seed) * 0.8);
          if (u < 0.05) return Tc.shade;
          if (detail >= 1 && fold > 0.86) return Tc.lit;
          if (detail >= 1 && fold < -0.8) return Tc.deep;
          if (fold < -0.35) return Tc.shade;
          if (n > 0.86) return Tc.lit;
          return Tc.base;
        },
        inner ? Tc.edge : null,
      );
    });
  }

  // ------------------------------------------------------------------ the spear
  {
    const z = 0.0;
    const butt = Pt(wp.butt, z);
    const tip = Pt(wp.tip, z);
    const dirS = V2.norm(V2.sub(tip, butt));
    const headLen = Math.min(0.34 * bs * s, V2.len(V2.sub(tip, butt)) * 0.3);
    const socket = V2.sub(tip, V2.mul(dirS, headLen));
    const shaftR = Math.max(0.9, R(0.02));
    add(0.32, () => {
      capsule(butt[0], butt[1], socket[0], socket[1], shaftR, shaftR);
      const Tw = T.wood;
      paint(
        (u, v) => (v < -0.2 && detail >= 1 ? Tw.lit : v > 0.35 ? Tw.deep : Tw.base),
        detail >= 2 ? Tw.edge : null,
      );
      // iron ferrule at the butt, binding at the grips
      const fe = V2.add(butt, V2.mul(dirS, R(0.16)));
      capsule(butt[0], butt[1], fe[0], fe[1], shaftR * 1.3, shaftR * 1.3);
      paint(() => T.iron.shade, null);
      // the leaf head
      const nrm = [-dirS[1], dirS[0]];
      const wmax = Math.max(1.2, R(0.055));
      const shoulderP = V2.add(socket, V2.mul(dirS, headLen * 0.34));
      const collar = V2.add(socket, V2.mul(dirS, headLen * 0.07));
      const poly = [
        V2.add(socket, V2.mul(nrm, shaftR * 1.3)),
        V2.add(shoulderP, V2.mul(nrm, wmax)),
        tip,
        V2.sub(shoulderP, V2.mul(nrm, wmax)),
        V2.sub(socket, V2.mul(nrm, shaftR * 1.3)),
      ];
      void collar;
      polygon(poly, (px, py) => {
        const rel = [px - socket[0], py - socket[1]];
        const along = (rel[0] * dirS[0] + rel[1] * dirS[1]) / headLen;
        const across = rel[0] * nrm[0] + rel[1] * nrm[1];
        return [along, across / wmax];
      });
      const Ts = T.steel;
      paint(
        (u, v) => {
          // split down the rib: the lit half toward the light
          const lit = nrm[0] * LX + nrm[1] * LY > 0 ? v > 0 : v < 0;
          if (Math.abs(v) < 0.12 && detail >= 1) return Ts.shade;
          return lit ? (u > 0.35 && u < 0.85 && detail >= 1 ? Ts.hi : Ts.lit) : Ts.shade;
        },
        Ts.edge,
      );
    });
  }

  // ----------------------------------------------------------------- run, sorted
  parts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, , fn] of parts) fn();

  // ---- the contour: one thicker line round the whole silhouette
  {
    const { occ, ow, oh, ox, oy } = S;
    const thick = H >= 100 ? 2 : 1;
    const ink = T.ink;
    for (let pass = 0; pass < thick; pass++) {
      const mark = [];
      for (let y = 0; y < oh; y++)
        for (let x = 0; x < ow; x++) {
          const i = y * ow + x;
          if (occ[i]) continue;
          if (
            (x > 0 && occ[i - 1] === 1) ||
            (x < ow - 1 && occ[i + 1] === 1) ||
            (y > 0 && occ[i - ow] === 1) ||
            (y < oh - 1 && occ[i + ow] === 1)
          )
            mark.push(i);
        }
      for (const i of mark) {
        occ[i] = 1;
        put(frame, fw, fh, ox + (i % ow), oy + Math.floor(i / ow), ink);
      }
    }
  }
}

// ------------------------------------------------------------------------ crowds

/**
 * A rank of soldiers. soldiers: [{ skel: (t) => skeleton, seed, haze?, boots? }]. Drawn far to
 * near (by the skeleton's Z), each on twos with its own recent history for the cloth.
 * cam: { x, y, s, ax, ay, flip, tilt, yaw }: one camera for all of them.
 */
export function drawLine(frame, fw, fh, soldiers, t, cam, o = {}) {
  const tt = onTwos(t);
  const items = soldiers.map((sd) => {
    const sk = sd.skel(tt);
    return { sd, sk, hist: history(sd.skel, tt, o.histN ?? 8) };
  });
  items.sort((a, b) => (a.sk.Z ?? 0) - (b.sk.Z ?? 0) || a.sk.X * (cam.flip ? 1 : -1) - b.sk.X * (cam.flip ? 1 : -1));
  for (const { sd, sk, hist } of items) {
    const haze = sd.haze ?? clamp(-(sk.Z ?? 0) * (o.hazePerM ?? 0.16));
    drawSoldier(frame, fw, fh, sk, { ...cam }, { seed: sd.seed, haze, boots: sd.boots, hist, t: tt, ...(o.soldier || {}) });
  }
}

/** The line of eight from ford_blocking.js: pass its skeletonAt. */
export function fordLine(skeletonAt, names) {
  return names.map((n, i) => ({ skel: (t) => skeletonAt(n, t), seed: 101 + i * 7 }));
}

/**
 * A parade at three depths, in lockstep (one clock, a hair of stride phase per soldier from the
 * seed), marching left across the page: nearer rows larger and darker, further rows smaller and
 * paler (aerial perspective toward the paper). The rows wrap, so it never runs out.
 * o.rows overrides the three-row default: [{ s, y, haze, spacing, jitter, seedBase, x0 }]
 */
export const PARADE_ROWS = [
  { s: 54, y: 262, haze: 0, spacing: 1.55, seedBase: 100, x0: 0.0, z: 0 },
  { s: 38, y: 222, haze: 0.2, spacing: 1.3, seedBase: 200, x0: 0.5, z: -3 },
  { s: 27, y: 194, haze: 0.42, spacing: 1.15, seedBase: 300, x0: 0.2, z: -6 },
];
export function drawParade(frame, fw, fh, t, o = {}) {
  const rows = o.rows ?? PARADE_ROWS;
  const speed = o.speed ?? 1.25;
  const tt = onTwos(t);
  let count = 0;
  for (const row of rows) {
    const worldW = (fw + 220) / row.s; // metres the row covers, plus a margin on each side
    const n = Math.max(3, Math.round(worldW / row.spacing));
    const L = n * row.spacing;
    const xs0 = -110 / row.s; // world x of the left margin
    const list = [];
    for (let i = 0; i < n; i++) {
      const seed = row.seedBase + i;
      const look = soldierLook(seed);
      // the soldier's unwrapped world position, then its wrapped one
      const x0 = row.x0 + i * row.spacing + 0.05 * (look.mottle - 0.5);
      const skel = (tk) => marchSkeleton(tk, { x0, facing: -1, speed, seed, scale: 1, z: row.z, name: `p${seed}` });
      const sk = skel(tt);
      const wrapped = xs0 + ((((sk.hips[0] - xs0) % L) + L) % L);
      list.push({ i, seed, look, skel, shift: wrapped - sk.hips[0], x: wrapped });
    }
    // draw right to left is irrelevant within a row (no overlap to speak of): far one first anyway
    list.sort((a, b) => b.x - a.x);
    for (const it of list) {
      const sk = it.skel(tt);
      const hist = history(it.skel, tt, 8);
      const xf = { x: 0, y: row.y, s: row.s, ax: -it.shift, ay: 0 };
      drawSoldier(frame, fw, fh, sk, xf, { look: it.look, haze: row.haze, hist, t: tt, ...(o.soldier || {}) });
      count++;
    }
  }
  return count;
}
