// Tall terrain objects: trees, peaks, structures. Every object belongs to
// exactly one cell, is built only from that cell's terrain name, coordinates
// and the seed, and stays inside the cell footprint (see OBJECT_LIMITS).
// Shadows fall toward the bottom-right, at most into the E / S / SE
// neighbours. That keeps the renderer strictly 3x3-local.
import { down } from './palette.js';
import { G } from './biomes.js';
import { ART_CELL as CELL } from './state.js';
import { Sprite } from './sprite.js';
import { forestTrees, TREE_OVERHANG } from './trees.js';
import { mountainSprite, MOUNTAIN_OVERHANG } from './mountains.js';
import { structureSprite, PILLAR_CAP } from './structures.js';

/**
 * Owner rule, encoded: how far (art px) an object's opaque pixels may leave
 * its own cell on each side. Nothing ever hangs below the cell.
 */
export const OBJECT_LIMITS = Object.freeze({
  tree: { left: TREE_OVERHANG, right: TREE_OVERHANG, top: TREE_OVERHANG, bottom: 0 },
  mountain: {
    left: MOUNTAIN_OVERHANG.side,
    right: MOUNTAIN_OVERHANG.side,
    top: MOUNTAIN_OVERHANG.top,
    bottom: 0,
  },
  pillar: { left: 0, right: 0, top: PILLAR_CAP, bottom: 0 },
  structure: { left: 0, right: 0, top: 0, bottom: 0 },
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

/**
 * Build the object of one cell (uncached).
 * @returns {{sprite: Sprite, parts: Sprite[]} | null}
 */
export function buildCellObject(S, c, r) {
  const name = S.names[r][c];
  if (!OBJECT_TERRAIN.has(name)) return null;
  if (name === 'Forest') {
    const parts = forestTrees(S, c, r);
    const sprite = new Sprite(c, r, 'tree', r * CELL + CELL - 1);
    for (const p of parts) sprite.drawOver(p);
    for (const p of parts) sprite.clipped += p.clipped;
    return { sprite, parts };
  }
  const sprite = name === 'Mountain' ? mountainSprite(S, c, r) : structureSprite(S, c, r, name);
  return sprite ? { sprite, parts: [sprite] } : null;
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
  part.forEach((x, y) => {
    // Billboard projection: a pixel h rows above the ground line lands
    // h*(a, b) toward the bottom-right of its foot (low sun, upper-left).
    const h = Math.max(0, part.baseY - y);
    const sx = Math.round(x + h * k.a),
      sy = y >= part.baseY ? y : Math.round(part.baseY + h * k.b);
    if (sy < y0 || sy >= y1) return;
    for (let X = sx; X <= sx + 1; X++) {
      if (X < x0 || X >= x1) continue;
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
      list.push(o);
      for (const p of o.parts) castShadow(S, p, x0, y0, x1, y1);
    }
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * W + x,
        s = shadow[i];
      if (!s || mat[i] === G.WALL) continue;
      idx[i] = down(idx[i], s);
      anim[i] = 0;
    }
  // Back to front: row-major cell order (lower rows overlap upper ones).
  for (const o of list) {
    const sp = o.sprite,
      id = sp.r * S.cols + sp.c + 1;
    sp.forEach((x, y, col) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return;
      const i = y * W + x;
      idx[i] = col;
      anim[i] = 0;
      owner[i] = id;
    });
  }
}
