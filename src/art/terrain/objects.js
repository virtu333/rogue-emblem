// Tall terrain objects: trees, peaks, structures. Every object belongs to
// exactly one cell and is made of parts (one tree, one rock mass, one
// landmark). A part is built from its cell's terrain, coordinates, the seed
// and, for trees and peaks, some of the neighbouring cells (forest density,
// ridges that join neighbouring peaks). Each part records those deps and
// only paints (sprite and shadow) into cells whose 3x3 neighbourhood sees
// them, which keeps the renderer strictly 3x3-local. Parts stay inside the
// cell footprint up to OBJECT_LIMITS ("mostly fit"). Shadows fall toward the
// bottom-right.
import { down } from './palette.js';
import { G } from './biomes.js';
import { ART_CELL as CELL } from './state.js';
import { Sprite } from './sprite.js';
import { forestParts, TREE_OVERHANG } from './trees.js';
import { mountainParts, MOUNTAIN_OVERHANG } from './mountains.js';
import { structureSprite, PILLAR_CAP } from './structures.js';

/**
 * Owner rule, encoded ("mostly fit"): how far (art px) an object's opaque
 * pixels may leave its own cell on each side. Canopies and peaks may spill a
 * little over the top and sides and at most a couple of pixels downward
 * (a trunk foot or a scree stone); columns and structures stay inside.
 */
export const OBJECT_LIMITS = Object.freeze({
  tree: Object.freeze({
    left: TREE_OVERHANG.side,
    right: TREE_OVERHANG.side,
    top: TREE_OVERHANG.top,
    bottom: TREE_OVERHANG.bottom,
  }),
  mountain: Object.freeze({
    left: MOUNTAIN_OVERHANG.side,
    right: MOUNTAIN_OVERHANG.side,
    top: MOUNTAIN_OVERHANG.top,
    bottom: MOUNTAIN_OVERHANG.bottom,
  }),
  pillar: Object.freeze({ left: 0, right: 0, top: PILLAR_CAP, bottom: 0 }),
  structure: Object.freeze({ left: 0, right: 0, top: 0, bottom: 0 }),
});

const OBJECT_TERRAIN = new Set([
  'Forest',
  'Mountain',
  'Fort',
  'Village',
  'Throne',
  'Ballista',
  'Pillar',
]);

/** Back-to-front order of parts: ground line, then cell, then part order. */
function partOrder(a, b) {
  return a.baseY - b.baseY || a.r - b.r || a.c - b.c || a.order - b.order;
}

/**
 * Build the object of one cell (uncached).
 * @returns {{sprite: Sprite, parts: Sprite[]} | null} `sprite` is the cell's
 *   parts composited back to front (for inspection and tests); the renderer
 *   draws the parts themselves, depth-sorted with the neighbours' parts.
 */
export function buildCellObject(S, c, r) {
  const name = S.names[r][c];
  if (!OBJECT_TERRAIN.has(name)) return null;
  let parts, kind;
  if (name === 'Forest') {
    parts = forestParts(S, c, r);
    kind = 'tree';
  } else if (name === 'Mountain') {
    parts = mountainParts(S, c, r);
    kind = 'mountain';
  } else {
    const s = structureSprite(S, c, r, name);
    parts = s ? [s] : [];
    kind = s?.kind;
  }
  if (!parts.length) return null;
  parts.forEach((p, k) => (p.order = k));
  parts.sort(partOrder);
  if (parts.length === 1) return { sprite: parts[0], parts };
  const sprite = new Sprite(c, r, kind, r * CELL + CELL - 1);
  for (const p of parts) {
    sprite.drawOver(p);
    sprite.clipped += p.clipped;
  }
  return { sprite, parts };
}

function cellObject(S, c, r) {
  const k = r * S.cols + c;
  let entry = S.objects[k];
  if (entry === undefined) {
    entry = buildCellObject(S, c, r);
    S.objects[k] = entry;
  }
  return entry;
}

function castShadow(S, part, x0, y0, x1, y1) {
  const k = part.shadowK;
  if (!k) return;
  const { W, mat, shadow } = S;
  const [bx0, by0, bx1, by1] = part.shadowBox();
  const X0 = Math.max(x0, bx0),
    X1 = Math.min(x1, bx1),
    Y0 = Math.max(y0, by0),
    Y1 = Math.min(y1, by1);
  if (X0 >= X1 || Y0 >= Y1) return;
  part.forEach((x, y) => {
    // Billboard projection: a pixel h rows above the ground line lands
    // h*(a, b) toward the bottom-right of its foot (low sun, upper-left).
    const h = Math.max(0, part.baseY - y);
    const sx = Math.round(x + h * k.a),
      sy = y >= part.baseY ? y : Math.round(part.baseY + h * k.b);
    if (sy < Y0 || sy >= Y1) return;
    for (let X = sx; X <= sx + 1; X++) {
      if (X < X0 || X >= X1) continue;
      const i = sy * W + X;
      if (mat[i] !== G.WALL && shadow[i] < 1) shadow[i] = 1;
    }
  });
}

function wallShadows(S, c, r, x0, y0, x1, y1) {
  // Walls are the tallest mass: a band below the face and a slanted
  // shadow east of any east-facing edge.
  const { W, mat, shadow } = S;
  const isWall = (cc, rr) => S.inMap(cc, rr) && S.groundAt(cc, rr) === G.WALL;
  const put = (x, y, v) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return;
    const i = y * W + x;
    if (mat[i] !== G.WALL && shadow[i] < v) shadow[i] = v;
  };
  if (r + 1 < S.rows && !isWall(c, r + 1))
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < CELL; k++)
        put(c * CELL + k + (j >> 1), (r + 1) * CELL + j, j === 0 ? 2 : 1);
  if (c + 1 < S.cols && !isWall(c + 1, r))
    for (let v = 0; v < CELL + 3; v++)
      for (let k = 0; k < 6; k++) {
        if (k > 1 + v * 0.8) continue; // slanted leading edge
        put((c + 1) * CELL + k, r * CELL + v + 3 + (k >> 1), 1);
      }
}

/**
 * Shadows + objects over an art-pixel rectangle. Objects of the cells around
 * the rectangle are included (they may overhang or cast into it).
 */
export function passObjects(S, x0, y0, x1, y1) {
  const { W, idx, anim, shadow, mat, owner } = S;
  const c0 = Math.max(0, ((x0 / CELL) | 0) - 1),
    c1 = Math.min(S.cols - 1, (((x1 - 1) / CELL) | 0) + 1),
    r0 = Math.max(0, ((y0 / CELL) | 0) - 1),
    r1 = Math.min(S.rows - 1, (((y1 - 1) / CELL) | 0) + 1);
  const list = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (S.groundAt(c, r) === G.WALL) wallShadows(S, c, r, x0, y0, x1, y1);
      const o = cellObject(S, c, r);
      if (!o) continue;
      for (const p of o.parts) {
        castShadow(S, p, x0, y0, x1, y1);
        list.push(p);
      }
    }
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * W + x,
        s = shadow[i];
      if (!s || mat[i] === G.WALL) continue;
      idx[i] = down(idx[i], s);
      anim[i] = 0;
    }
  // Back to front across cells: a part further down the screen covers the
  // parts behind it, whichever cell they belong to.
  list.sort(partOrder);
  for (const sp of list) {
    const id = sp.r * S.cols + sp.c + 1;
    sp.forEach((x, y, col) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return;
      const i = y * W + x;
      idx[i] = col;
      anim[i] = 0;
      owner[i] = id;
    });
  }
}
