// Drawing primitives for effect frames. Shapes are analytic and sampled at pixel
// centres; intensity profiles put the hottest value on a shape's core or leading
// edge so quantization produces ramp bands (hot core -> cool rim) with hard edges.
import { INK_TONES } from '../../../../src/art/combatFx/fxPalette.js';
export { bayer } from './raster.mjs';
import { rand2 } from '../../../../src/art/terrain/noise.js';

/** Stable per-pixel grain in [0,1): dissolves read as scattered pixels, not a mesh. */
export function grain(x, y, seed = 7) {
  return rand2(x | 0, y | 0, seed);
}

export const TAU = Math.PI * 2;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Hand-tuned easing (t in 0..1).
export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  outQuart: (t) => 1 - (1 - t) ** 4,
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

/** Distance from p to segment ab, plus the segment parameter u (0..1). */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let u = ((px - ax) * dx + (py - ay) * dy) / len2;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const cx = ax + dx * u;
  const cy = ay + dy * u;
  return { d: Math.hypot(px - cx, py - cy), u };
}

function bbox(f, x0, y0, x1, y1) {
  return [
    Math.max(0, Math.floor(Math.min(x0, x1))),
    Math.max(0, Math.floor(Math.min(y0, y1))),
    Math.min(f.w - 1, Math.ceil(Math.max(x0, x1))),
    Math.min(f.h - 1, Math.ceil(Math.max(y0, y1))),
  ];
}

/** Evaluate fn(px, py) -> intensity over a box and max-composite it. */
export function field(f, x0, y0, x1, y1, fn) {
  const [a, b, c, d] = bbox(f, x0, y0, x1, y1);
  for (let y = b; y <= d; y++)
    for (let x = a; x <= c; x++) {
      const v = fn(x + 0.5, y + 0.5, x, y);
      if (v > 0) f.g(x, y, v);
    }
}

/** Solid fill wherever pred(px, py) is true. */
export function solidField(f, x0, y0, x1, y1, pred, hex) {
  const [a, b, c, d] = bbox(f, x0, y0, x1, y1);
  for (let y = b; y <= d; y++)
    for (let x = a; x <= c; x++) {
      const r = pred(x + 0.5, y + 0.5, x, y);
      if (r) f.s(x, y, typeof r === 'string' ? r : hex);
    }
}

/** Filled disc; intensity v at the centre falling to v*edge at the rim. */
export function disc(f, cx, cy, r, v, edge = 1) {
  if (r <= 0) return;
  field(f, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (px, py) => {
    const d = Math.hypot(px - cx, py - cy);
    if (d > r) return 0;
    return v * lerp(1, edge, d / r);
  });
}

/** Ellipse ring (rx, ry), thickness in px; optional angular window and dashes. */
export function ring(f, cx, cy, rx, ry, thick, v, opts = {}) {
  const { a0 = -Infinity, a1 = Infinity, dash = 0, dashPhase = 0, seedGap = null } = opts;
  const R = Math.max(rx, ry) + thick + 1;
  field(f, cx - R, cy - R, cx + R, cy + R, (px, py) => {
    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;
    const n = Math.hypot(dx, dy);
    const rr = Math.min(rx, ry);
    const d = Math.abs(n - 1) * rr;
    if (d > thick / 2) return 0;
    let ang = Math.atan2(py - cy, px - cx);
    if (Number.isFinite(a0) && !angleIn(ang, a0, a1)) return 0;
    if (dash > 0) {
      const k = Math.floor(((ang + Math.PI) / TAU) * dash + dashPhase);
      if (seedGap ? seedGap(k) : k % 2 === 1) return 0;
    }
    return v * (1 - (d / (thick / 2 + 0.01)) * 0.35);
  });
}

export function angleIn(a, a0, a1) {
  const norm = (x) => ((x % TAU) + TAU) % TAU;
  const s = norm(a - a0);
  const e = norm(a1 - a0);
  return s <= e;
}

/**
 * Tapered stroke from a to b. Width goes w0 -> w1 along the stroke, intensity
 * v0 -> v1; across the width the core is hottest (profile exponent `p`).
 */
export function stroke(f, ax, ay, bx, by, w0, w1, v0, v1 = v0, p = 1.5) {
  const pad = Math.max(w0, w1) / 2 + 1;
  field(
    f,
    Math.min(ax, bx) - pad,
    Math.min(ay, by) - pad,
    Math.max(ax, bx) + pad,
    Math.max(ay, by) + pad,
    (px, py) => {
      const { d, u } = segDist(px, py, ax, ay, bx, by);
      const hw = lerp(w0, w1, u) / 2;
      if (hw <= 0 || d > hw) return 0;
      const core = 1 - (d / (hw + 0.001)) ** p;
      return lerp(v0, v1, u) * (0.45 + 0.55 * core);
    },
  );
}

/** 1px (or thicker) glow polyline. */
export function polyline(f, pts, w, v, p = 1.5) {
  for (let i = 0; i + 1 < pts.length; i++) {
    stroke(f, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, w, v, v, p);
  }
}

/**
 * Crescent: the part of circle A (centre ax, ay, radius ra) outside circle B
 * (centre bx, by, radius rb). `u` runs 0 -> 1 from one tip to the other,
 * measured by angle around A between a0 and a1 (radians). fn(u, s) returns the
 * intensity, where s is 0 on B's rim (inner edge) and 1 on A's rim (outer edge).
 */
export function crescent(f, ax, ay, ra, bx, by, rb, a0, a1, fn) {
  field(f, ax - ra - 1, ay - ra - 1, ax + ra + 1, ay + ra + 1, (px, py) => {
    const da = Math.hypot(px - ax, py - ay);
    if (da > ra) return 0;
    const db = Math.hypot(px - bx, py - by);
    if (db < rb) return 0;
    const ang = Math.atan2(py - ay, px - ax);
    if (!angleIn(ang, a0, a1)) return 0;
    const span = (((a1 - a0) % TAU) + TAU) % TAU || TAU;
    const u = ((((ang - a0) % TAU) + TAU) % TAU) / span;
    const inner = db - rb;
    const outer = ra - da;
    const s = inner / (inner + outer + 1e-6);
    return fn(u, s, px, py);
  });
}

/** Star polygon (n points), filled; returns the vertex list. */
export function starPoints(cx, cy, n, rOut, rIn, rot = 0, jitter = null) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    let r = i % 2 === 0 ? rOut : rIn;
    if (jitter) r *= jitter(i);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

export function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi)
      inside = !inside;
  }
  return inside;
}

function polyBox(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
}

/** Distance from p to the polygon's outline. */
export function polyEdgeDist(px, py, pts) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const { d } = segDist(px, py, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
    if (d < best) best = d;
  }
  return best;
}

/** Glow-filled polygon: fn(edgeDist) -> intensity (hot rim or hot core). */
export function polyGlow(f, pts, fn) {
  const [x0, y0, x1, y1] = polyBox(pts);
  field(f, x0, y0, x1, y1, (px, py) =>
    pointInPoly(px, py, pts) ? fn(polyEdgeDist(px, py, pts), px, py) : 0,
  );
}

export function polySolid(f, pts, hex) {
  const [x0, y0, x1, y1] = polyBox(pts);
  solidField(f, x0, y0, x1, y1, (px, py) => pointInPoly(px, py, pts), hex);
}

/** Solid outline band of `w` px just outside (or on) a polygon's edge. */
export function polyOutline(f, pts, hex, w = 1) {
  const [x0, y0, x1, y1] = polyBox(pts);
  solidField(
    f,
    x0 - w,
    y0 - w,
    x1 + w,
    y1 + w,
    (px, py) => polyEdgeDist(px, py, pts) <= w * 0.75,
    hex,
  );
}

/** Solid line (Bresenham on rounded ends), optional width via a square brush. */
export function line(f, x0, y0, x1, y1, hex, w = 1) {
  let xa = Math.round(x0);
  let ya = Math.round(y0);
  const xb = Math.round(x1);
  const yb = Math.round(y1);
  const dx = Math.abs(xb - xa);
  const dy = -Math.abs(yb - ya);
  const sx = xa < xb ? 1 : -1;
  const sy = ya < yb ? 1 : -1;
  let err = dx + dy;
  const half = Math.floor((w - 1) / 2);
  for (;;) {
    for (let oy = -half; oy < w - half; oy++)
      for (let ox = -half; ox < w - half; ox++) f.s(xa + ox, ya + oy, hex);
    if (xa === xb && ya === yb) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      xa += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ya += sy;
    }
  }
}

/** Glow line (Bresenham), constant intensity: crisp 1px beams and sparks. */
export function gline(f, x0, y0, x1, y1, v, vEnd = v) {
  let xa = Math.round(x0);
  let ya = Math.round(y0);
  const xb = Math.round(x1);
  const yb = Math.round(y1);
  const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya)) || 1;
  const dx = Math.abs(xb - xa);
  const dy = -Math.abs(yb - ya);
  const sx = xa < xb ? 1 : -1;
  const sy = ya < yb ? 1 : -1;
  let err = dx + dy;
  let k = 0;
  for (;;) {
    f.g(xa, ya, lerp(v, vEnd, k / n));
    if (xa === xb && ya === yb) break;
    k++;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      xa += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ya += sy;
    }
  }
}

/** Spark: a short streak with a hot head at (x, y) and a tail pointing back along `ang`. */
export function spark(f, x, y, ang, len, v) {
  const tx = x - Math.cos(ang) * len;
  const ty = y - Math.sin(ang) * len;
  gline(f, tx, ty, x, y, v * 0.45, v);
  f.g(Math.round(x), Math.round(y), v * 1.05);
}

/** Mote: 1px dot, 2px square or 3px cross (size 1..3). */
export function mote(f, x, y, size, v) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (size <= 1) f.g(xi, yi, v);
  else if (size === 2) {
    f.g(xi, yi, v);
    f.g(xi + 1, yi, v * 0.85);
    f.g(xi, yi + 1, v * 0.85);
    f.g(xi + 1, yi + 1, v * 0.7);
  } else {
    f.g(xi, yi, v * 1.05);
    f.g(xi - 1, yi, v * 0.7);
    f.g(xi + 1, yi, v * 0.7);
    f.g(xi, yi - 1, v * 0.7);
    f.g(xi, yi + 1, v * 0.7);
  }
}

/** Four-point sparkle: a cross with arms of length `arm`. */
export function sparkle(f, x, y, arm, v) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  for (let k = 1; k <= arm; k++) {
    const t = 1 - k / (arm + 1);
    f.g(xi + k, yi, v * t);
    f.g(xi - k, yi, v * t);
    f.g(xi, yi + k, v * t);
    f.g(xi, yi - k, v * t);
  }
  f.g(xi, yi, v * 1.1);
}

/**
 * Physical chip (debris, splinters): a small lit shape with the key light from the
 * upper-left (highlight top-left, shade bottom-right) and a 1px ink outline.
 * ramp: [shade, base, light] hex; shape 0 square, 1 diamond, 2 sliver.
 */
export function chip(f, x, y, size, ramp, shape = 0, outline = true) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  const px = [];
  const s = Math.max(1, size | 0);
  for (let oy = 0; oy < s; oy++)
    for (let ox = 0; ox < s; ox++) {
      if (shape === 1 && s >= 3 && (ox + oy < 1 || ox + oy > 2 * s - 3)) continue;
      if (shape === 1 && s >= 3 && (ox - oy > s - 2 || oy - ox > s - 2)) continue;
      if (shape === 2 && oy !== ox && oy !== ox + 1) continue;
      px.push([xi + ox, yi + oy, ox, oy]);
    }
  if (outline) {
    for (const [ax, ay] of px)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const nx = ax + dx;
        const ny = ay + dy;
        if (!px.some(([bx, by]) => bx === nx && by === ny) && !f.sAt(nx, ny))
          f.s(nx, ny, INK_TONES.line);
      }
  }
  for (const [ax, ay, ox, oy] of px) {
    const lit = ox + oy === 0 ? 2 : ox + oy >= s ? 0 : 1;
    f.s(ax, ay, ramp[lit]);
  }
}

/** Jagged polyline between two points (thunder, cracks). Deterministic from rng. */
export function jagged(ax, ay, bx, by, segs, amp, rng) {
  const pts = [[ax, ay]];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const off = (rng() * 2 - 1) * amp * Math.sin(Math.PI * t) ** 0.5;
    pts.push([ax + dx * t + nx * off, ay + dy * t + ny * off]);
  }
  pts.push([bx, by]);
  return pts;
}

/**
 * Arc band ("comet crescent") around (cx, cy), rotated by rot. The outer edge is a
 * circle of radius ro between angles a0..a1; the inner edge sits thick(u) px inside
 * it, so thickness can swell toward the head and taper to a hair at the tail.
 * fn(u, s) -> intensity with u tail->head (0..1) and s inner->outer (0..1).
 */
export function arcBand(f, cx, cy, rot, ro, a0, a1, thick, fn) {
  const span = a1 - a0;
  field(f, cx - ro - 2, cy - ro - 2, cx + ro + 2, cy + ro + 2, (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    const r = Math.hypot(dx, dy);
    if (r > ro) return 0;
    let a = Math.atan2(dy, dx) - rot - a0;
    a = ((a % TAU) + TAU) % TAU;
    if (a > span) return 0;
    const u = a / span;
    const t = thick(u);
    if (t <= 0) return 0;
    const ri = ro - t;
    if (r < ri) return 0;
    return fn(u, (r - ri) / (t + 1e-6));
  });
}

/** Solid pixels along the inner edge of an arcBand (an ink cut line). */
export function arcBandEdge(f, cx, cy, rot, ro, a0, a1, thick, u0, u1, hex, inset = 0) {
  const steps = Math.ceil(Math.abs(a1 - a0) * ro * 3);
  for (let k = 0; k <= steps; k++) {
    const u = u0 + ((u1 - u0) * k) / steps;
    const r = ro - thick(u) - inset;
    if (r <= 0) continue;
    const a = rot + a0 + (a1 - a0) * u;
    f.s(Math.floor(cx + Math.cos(a) * r), Math.floor(cy + Math.sin(a) * r), hex);
  }
}
