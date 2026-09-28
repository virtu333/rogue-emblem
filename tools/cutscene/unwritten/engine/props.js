// Props drawn in code, so they can do what a painted cut-out can't: a spear that
// foreshortens straight at the lens, a blade that turns to catch the light. Drawn in the
// page's materials: a sepia contour, flat tones, one hard highlight.

import { RGB, put } from './anime.js';
import { bayer, clamp, hexToRgb } from './raster.js';

const SHAFT = hexToRgb('#2e293a');
const SHAFT_HI = hexToRgb('#58505e');
const STEEL_D = hexToRgb('#4574a0');
const STEEL = hexToRgb('#77a5c6');
const STEEL_HI = hexToRgb('#b8d8e6');

/** Fill a convex quad/polygon with colour c (scanline, pixel exact). */
export function fillPoly(frame, fw, fh, pts, c, shade = null) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [, y] of pts) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  y0 = Math.max(0, Math.floor(y0));
  y1 = Math.min(fh - 1, Math.ceil(y1));
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    let xa = Infinity;
    let xb = -Infinity;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % n];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        const x = ax + ((yc - ay) / (by - ay)) * (bx - ax);
        xa = Math.min(xa, x);
        xb = Math.max(xb, x);
      }
    }
    if (xa > xb) continue;
    for (let x = Math.max(0, Math.round(xa)); x <= Math.min(fw - 1, Math.round(xb) - 1); x++)
      put(frame, fw, fh, x, y, shade ? shade(x, y) : c);
  }
}

/** Outline a polygon with 1 px ink. */
export function outlinePoly(frame, fw, fh, pts, c = RGB.sepia) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const L = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let k = 0; k <= L; k++)
      put(frame, fw, fh, ax + ((bx - ax) * k) / L, ay + ((by - ay) * k) / L, c);
  }
}

/**
 * A spear from its butt to its point, both as screen points with a width each (the
 * width carries the perspective: a point coming at the lens is wide, the butt far away
 * thin). o: { blade: fraction of the length that is steel (default 0.16),
 * glint: 0..1 a highlight running along the blade (or null), light: -1..1 which edge
 * of the blade is lit }.
 */
export function spear(frame, fw, fh, butt, tip, o = {}) {
  const { blade = 0.16, glint = null, light = 1 } = o;
  const [bx, by, bw] = butt;
  const [tx, ty, tw] = tip;
  const dx = tx - bx;
  const dy = ty - by;
  const L = Math.hypot(dx, dy);
  if (L < 0.5) {
    // end-on: the point is all we see
    disc(frame, fw, fh, tx, ty, Math.max(1, tw * 0.6), STEEL_HI, SHAFT);
    return;
  }
  const nx = -dy / L;
  const ny = dx / L;
  const at = (u) => [bx + dx * u, by + dy * u, bw + (tw - bw) * u];
  // the shaft, to the socket
  const s = 1 - blade;
  const [sx, sy, sw] = at(s);
  const shaftW0 = Math.max(1, bw * 0.28);
  const shaftW1 = Math.max(1, sw * 0.28);
  const shaft = [
    [bx + nx * shaftW0, by + ny * shaftW0],
    [sx + nx * shaftW1, sy + ny * shaftW1],
    [sx - nx * shaftW1, sy - ny * shaftW1],
    [bx - nx * shaftW0, by - ny * shaftW0],
  ];
  fillPoly(frame, fw, fh, shaft, SHAFT);
  // a highlight line down the lit side of the shaft
  const hl = light > 0 ? 0.5 : -0.5;
  for (let k = 0; k <= Math.ceil(L * s); k++) {
    const u = k / L;
    const [x, y, w] = at(u);
    put(frame, fw, fh, x + nx * w * 0.28 * hl, y + ny * w * 0.28 * hl, SHAFT_HI);
  }
  // the socket: a short collar
  const cw = Math.max(1.2, sw * 0.4);
  const [cx2, cy2] = at(s + 0.02);
  fillPoly(
    frame,
    fw,
    fh,
    [
      [sx + nx * cw, sy + ny * cw],
      [cx2 + nx * cw, cy2 + ny * cw],
      [cx2 - nx * cw, cy2 - ny * cw],
      [sx - nx * cw, sy - ny * cw],
    ],
    STEEL_D,
  );
  // the blade: a leaf, widest a third of the way along, split lit/shadow down the rib
  const [mx, my, mw] = at(s + blade * 0.35);
  const bwid = Math.max(1.5, mw * 0.75);
  const left = [
    [cx2, cy2],
    [mx + nx * bwid, my + ny * bwid],
    [tx, ty],
  ];
  const right = [
    [cx2, cy2],
    [mx - nx * bwid, my - ny * bwid],
    [tx, ty],
  ];
  fillPoly(frame, fw, fh, left, light > 0 ? STEEL_HI : STEEL);
  fillPoly(frame, fw, fh, right, light > 0 ? STEEL : STEEL_D);
  outlinePoly(frame, fw, fh, [left[0], left[1], left[2], right[1]], RGB.sepia);
  if (glint !== null && glint >= 0 && glint <= 1) {
    const [gx, gy, gw] = at(s + blade * clamp(glint));
    const r = Math.max(2, gw * 0.9);
    for (let i = -r; i <= r; i++) {
      put(frame, fw, fh, gx + i, gy, RGB.paperHi);
      put(frame, fw, fh, gx, gy + i, RGB.paperHi);
    }
  }
}

/** A filled disc with an outline (a point seen end-on). */
export function disc(frame, fw, fh, cx, cy, r, c, edge = null) {
  for (let y = -r - 1; y <= r + 1; y++)
    for (let x = -r - 1; x <= r + 1; x++) {
      const d = Math.hypot(x, y);
      if (d <= r - 0.5) put(frame, fw, fh, cx + x, cy + y, c);
      else if (edge && d <= r + 0.6) put(frame, fw, fh, cx + x, cy + y, edge);
    }
}

/** Rain beads on a surface: sparse 1-2 px highlights that slide down on twos. */
export function beads(frame, fw, fh, x0, y0, x1, y1, t, count = 40, seed = 3) {
  const d = Math.floor(t * 12);
  for (let i = 0; i < count; i++) {
    const h = (k) => (Math.sin((i + 1) * 12.9898 + seed * 78.233 + k * 37.719) * 43758.5453) % 1;
    const fx = Math.abs(h(1));
    const fy = (Math.abs(h(2)) + d * 0.004 * (1 + Math.abs(h(3)))) % 1;
    const x = x0 + (x1 - x0) * fx;
    const y = y0 + (y1 - y0) * fy;
    if (bayer(x | 0, y | 0) < 0.8) put(frame, fw, fh, x, y, RGB.paperHi);
  }
}
