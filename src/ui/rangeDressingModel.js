// rangeDressingModel.js — the shapes of a range overlay and a path ribbon (pure, no Phaser).
//
// A range (move, attack, heal, a staff's or an ability's tiles) is one region, not a
// pile of squares: a wash, a soft inner band along its border, a bright rim with a dark
// under-stroke, and faint seams between its tiles so they can still be counted. A walk
// preview is one gold thread through the tile centres, knotted at the unit and ending in a
// barbed head. Everything
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

/**
 * The walk preview is a gold thread (the game's motif: the veil's thread, the loom): an
 * ember body with a pale core and stitches across it, inked all round so it reads on any
 * ground, a knot on the unit's tile and a barbed head on the destination.
 */
export const PATH_STYLE = Object.freeze({
  width: 6,
  outline: 2,
  coreWidth: 2,
  head: 12,
  knot: 5,
  stitchEvery: 8,
  slideDash: 5,
  slideGap: 4,
  body: 0xdca044,
  shade: 0xa3621f,
  core: 0xfff0bd,
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

/** The axis step (-1, 0 or 1 each way) from a to b; a diagonal takes its longer side. */
function axisStep(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) };
}

/** A band `w` wide from a to b (grid steps are axis-aligned), its ends squared off. */
function bandRect(a, b, w) {
  const x = Math.round(Math.min(a.x, b.x) - w / 2);
  const y = Math.round(Math.min(a.y, b.y) - w / 2);
  return [x, y, Math.round(Math.abs(b.x - a.x) + w), Math.round(Math.abs(b.y - a.y) + w)];
}

/** A slab across the direction `d`: from `k0` to `k1` along it from `at`, `half` each side. */
function slab(at, d, k0, k1, half) {
  if (d.x)
    return [
      Math.round(at.x + Math.min(k0 * d.x, k1 * d.x)),
      Math.round(at.y - half),
      Math.abs(k1 - k0),
      half * 2,
    ];
  return [
    Math.round(at.x - half),
    Math.round(at.y + Math.min(k0 * d.y, k1 * d.y)),
    half * 2,
    Math.abs(k1 - k0),
  ];
}

/** The head's rows from its base to its tip: a barb, then a stepped point. */
function headRows(size) {
  const rows = [];
  for (let k = 0; k < size; k += 2)
    rows.push([k, k === 0 ? Math.round(size * 0.5) : Math.max(1, size - 1 - k)]);
  return rows;
}

/**
 * The thread for a walk: the points it passes (tile centres, the unit's own tile first; the
 * last is the head's base), the head's outline triangle (tip, then its two base corners),
 * and what to draw, back to front, as rectangles: `ink`, `body`, `shade` (the stitches),
 * `core`. A path of fewer than two points has no thread.
 * @returns {null | { points: {x:number,y:number}[], head: {x:number,y:number}[],
 *   ink: number[][], body: number[][], shade: number[][], core: number[][] }}
 */
export function planPath(points, style = PATH_STYLE) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (pts.length < 2) return null;
  const end = pts[pts.length - 1];
  const d = axisStep(pts[pts.length - 2], end);
  const h = style.head;
  const { width: w, outline: o, coreWidth: c } = style;
  // The head's tip sits just past the tile's centre; the shaft stops at the head's base.
  const lead = Math.round(h * 0.55);
  const base = { x: end.x + d.x * (lead - h), y: end.y + d.y * (lead - h) };
  const tip = { x: base.x + d.x * h, y: base.y + d.y * h };
  const wide = Math.round(h * 0.8);
  const head = [
    tip,
    { x: base.x - d.y * wide, y: base.y + d.x * wide },
    { x: base.x + d.y * wide, y: base.y - d.x * wide },
  ];
  const shaft = [...pts.slice(0, -1), base];
  const plan = { points: shaft, head, ink: [], body: [], shade: [], core: [] };

  for (let i = 1; i < shaft.length; i++) {
    plan.ink.push(bandRect(shaft[i - 1], shaft[i], w + o * 2));
    plan.body.push(bandRect(shaft[i - 1], shaft[i], w));
    plan.core.push(bandRect(shaft[i - 1], shaft[i], c));
  }
  // Stitches: short bars across the body, evenly along the whole thread.
  let run = 0;
  let next = style.stitchEvery - 2;
  for (let i = 1; i < shaft.length; i++) {
    const a = shaft[i - 1];
    const b = shaft[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (!len) continue;
    const step = axisStep(a, b);
    for (; next < run + len - 1; next += style.stitchEvery) {
      const at = { x: a.x + step.x * (next - run), y: a.y + step.y * (next - run) };
      plan.shade.push(slab(at, step, 0, 2, w / 2));
    }
    run += len;
  }
  for (const [k, half] of headRows(h)) {
    plan.ink.push(slab(base, d, k - o, k + 2 + o, half + o));
    plan.body.push(slab(base, d, k, k + 2, half));
  }
  plan.core.push(slab(base, d, 0, h - 4, c / 2));
  // The knot on the unit's own tile: a small diamond the thread is tied to.
  const start = shaft[0];
  const diamond = (r, into) => {
    for (let j = -r; j <= r; j++) {
      const half = r - Math.abs(j);
      into.push([Math.round(start.x - half), Math.round(start.y + j), half * 2 + 1, 1]);
    }
  };
  diamond(style.knot + o, plan.ink);
  diamond(style.knot, plan.body);
  diamond(1, plan.core);
  return plan;
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
