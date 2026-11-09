// rangeDressingModel.js — the shapes of a range overlay and a path ribbon (pure, no Phaser).
//
// A range (move, attack, heal, a staff's or an ability's tiles) is one region, not a
// pile of squares: a wash, a soft inner band along its border, a bright rim with a dark
// under-stroke, and faint seams between its tiles so they can still be counted. A walk
// preview is one ribbon through the tile centres that ends in an arrowhead. Everything
// here is rectangles and points in world pixels; RangeDressing.js draws them.

/** Rim and band sizes, in world pixels (a tile is 32). */
export const RANGE_STYLE = Object.freeze({
  rim: 2,
  band: 4,
  underStroke: 1,
  fillAlpha: 0.38,
  quietAlpha: 0.16,
  bandAlpha: 0.2,
  rimAlpha: 0.95,
  underAlpha: 0.55,
  seamAlpha: 0.2,
  breatheTo: 0.62,
  breatheMs: 900,
  revealMs: 110,
});

export const PATH_STYLE = Object.freeze({
  width: 6,
  outline: 2,
  head: 9,
  slideDash: 5,
  slideGap: 4,
  body: 0xf4ecdb,
  slide: 0x8fe6ff,
  ink: 0x0e0c14,
});

const INK = 0x0e0c14;

/** Blend a 0xRRGGBB colour toward white by `t` (0..1). */
export function lighten(color, t) {
  const mix = (c) => Math.round(c + (255 - c) * t);
  const r = mix((color >> 16) & 0xff);
  const g = mix((color >> 8) & 0xff);
  const b = mix(color & 0xff);
  return (r << 16) | (g << 8) | b;
}

/**
 * The drawing plan for a set of tiles.
 * @param {{x:number, y:number}[]} centres tile centres in world pixels (duplicates ignored)
 * @param {number} size tile size in world pixels
 * @param {object} [style]
 * @param {{ quiet?: {x:number,y:number}[], beside?: {x:number,y:number}[] }} [more]
 * @returns {{ fills: number[][], bands: number[][], rims: number[][], unders: number[][],
 *   seams: number[][], ink: number }} each entry is [x, y, w, h]
 */
export function planRange(centres, size, style = RANGE_STYLE, { quiet = [], beside = [] } = {}) {
  const key = (x, y) => `${x},${y}`;
  const corner = (c) => ({ x: Math.round(c.x - size / 2), y: Math.round(c.y - size / 2) });
  const cells = new Map();
  for (const c of centres || []) {
    const cell = corner(c);
    cells.set(key(cell.x, cell.y), cell);
  }
  // Quiet tiles belong to the region (no rim round them) but get only a thin wash: the
  // unit's own tile and tiles it can cross but not stop on.
  for (const c of quiet || []) {
    const cell = corner(c);
    if (!cells.has(key(cell.x, cell.y))) cells.set(key(cell.x, cell.y), { ...cell, quiet: true });
  }
  // Tiles of the layer this one sits beside (a move range under its attack fringe):
  // the border between the two is drawn once, by the other layer.
  const other = new Set((beside || []).map((c) => key(corner(c).x, corner(c).y)));
  const has = (x, y) => cells.has(key(x, y)) || other.has(key(x, y));
  const { rim, band, underStroke: u } = style;
  const plan = { fills: [], quiets: [], bands: [], rims: [], unders: [], seams: [], ink: INK };
  for (const cell of cells.values()) {
    const { x, y } = cell;
    (cell.quiet ? plan.quiets : plan.fills).push([x, y, size, size]);
    const up = has(x, y - size);
    const down = has(x, y + size);
    const left = has(x - size, y);
    const right = has(x + size, y);
    if (!up) {
      plan.rims.push([x, y, size, rim]);
      plan.bands.push([x, y + rim, size, band]);
      plan.unders.push([x, y - u, size, u]);
    }
    if (!down) {
      plan.rims.push([x, y + size - rim, size, rim]);
      plan.bands.push([x, y + size - rim - band, size, band]);
      plan.unders.push([x, y + size, size, u]);
    }
    if (!left) {
      plan.rims.push([x, y, rim, size]);
      plan.bands.push([x + rim, y, band, size]);
      plan.unders.push([x - u, y, u, size]);
    }
    if (!right) {
      plan.rims.push([x + size - rim, y, rim, size]);
      plan.bands.push([x + size - rim - band, y, band, size]);
      plan.unders.push([x + size, y, u, size]);
    }
    // Where the border turns a corner into the region, the two rims meet only at a
    // point: the corner block joins them.
    const corners = [
      [up && left && !has(x - size, y - size), x, y],
      [up && right && !has(x + size, y - size), x + size - rim, y],
      [down && left && !has(x - size, y + size), x, y + size - rim],
      [down && right && !has(x + size, y + size), x + size - rim, y + size - rim],
    ];
    for (const [open, cx, cy] of corners) if (open) plan.rims.push([cx, cy, rim, rim]);
    // Seams are drawn once, on the tile's right and bottom sides.
    if (cells.has(key(x + size, y))) plan.seams.push([x + size - 1, y + 3, 1, size - 6]);
    if (cells.has(key(x, y + size))) plan.seams.push([x + 3, y + size - 1, size - 6, 1]);
  }
  return plan;
}

/**
 * The ribbon for a walk: the points it passes (tile centres, the unit's own tile first)
 * and the arrowhead at its end. A path of fewer than two points has no ribbon.
 * @returns {null | { points: {x:number,y:number}[], head: {x:number,y:number}[] }}
 */
export function planPath(points, style = PATH_STYLE) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (pts.length < 2) return null;
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const dx = (end.x - prev.x) / len;
  const dy = (end.y - prev.y) / len;
  const h = style.head;
  // The shaft stops at the arrowhead's base; the head's tip sits just past the centre.
  const tip = { x: end.x + dx * (h * 0.55), y: end.y + dy * (h * 0.55) };
  const base = { x: tip.x - dx * h, y: tip.y - dy * h };
  const head = [
    tip,
    { x: base.x - dy * h * 0.8, y: base.y + dx * h * 0.8 },
    { x: base.x + dy * h * 0.8, y: base.y - dx * h * 0.8 },
  ];
  return { points: [...pts.slice(0, -1), base], head };
}

/** Dashes along a polyline: [[x1, y1, x2, y2], ...]. */
export function dashSegments(points, dash, gap) {
  const out = [];
  let carry = 0;
  let on = true;
  for (let i = 1; i < (points || []).length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    let at = 0;
    while (at < len) {
      const want = (on ? dash : gap) - carry;
      const step = Math.min(want, len - at);
      if (on)
        out.push([a.x + ux * at, a.y + uy * at, a.x + ux * (at + step), a.y + uy * (at + step)]);
      at += step;
      carry += step;
      if (carry >= (on ? dash : gap) - 1e-6) {
        carry = 0;
        on = !on;
      }
    }
  }
  return out;
}
