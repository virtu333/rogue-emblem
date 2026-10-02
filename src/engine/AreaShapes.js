// AreaShapes — the tiles an area weapon art covers (docs/specs/aoe-weapon-arts.md §2.1).
//
// Pure: no RNG, no Phaser, game coordinates only (a portrait board is a presentation
// transform, never a different set of tiles). Every list comes back in one stable order
// (distance from the shape's origin, then row, then column), so a suspend, a rewind, the
// preview and the AI always see the same tiles in the same order.
//
// `bounds` is { cols, rows, isSolid?(col, row) }. `isSolid` marks terrain nothing crosses
// (a wall): terrain is public, so a line that stops there leaks nothing. Units never block
// a shape, so no shape can depend on a unit the player cannot see.

import { getFootprint } from './EntitySystem.js';

export const tileKey = (col, row) => `${col},${row}`;

function inBounds(col, row, bounds) {
  return (
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    row >= 0 &&
    col < (bounds?.cols ?? 0) &&
    row < (bounds?.rows ?? 0)
  );
}

function byDistanceThenRowCol(origin) {
  return (a, b) => {
    const da = Math.abs(a.col - origin.col) + Math.abs(a.row - origin.row);
    const db = Math.abs(b.col - origin.col) + Math.abs(b.row - origin.row);
    if (da !== db) return da - db;
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  };
}

/** Tiles within Manhattan `min..max` of `origin` that lie on the board, in stable order. */
function ringTiles(origin, min, max, bounds) {
  const lo = Math.max(0, Math.trunc(Number(min) || 0));
  const hi = Math.max(0, Math.trunc(Number(max) || 0));
  if (!origin || hi < lo) return [];
  const tiles = [];
  for (let dr = -hi; dr <= hi; dr++) {
    const span = hi - Math.abs(dr);
    for (let dc = -span; dc <= span; dc++) {
      const distance = Math.abs(dc) + Math.abs(dr);
      if (distance < lo) continue;
      const col = origin.col + dc;
      const row = origin.row + dr;
      if (inBounds(col, row, bounds)) tiles.push({ col, row });
    }
  }
  return tiles.sort(byDistanceThenRowCol(origin));
}

/** A diamond of radius `radius` around `center`, the center included. */
export function radiusTiles(center, radius, bounds) {
  return ringTiles(center, 0, radius, bounds);
}

/** The diamond of radius `radius` around `origin`, without the origin itself. */
export function aroundTiles(origin, radius, bounds) {
  return ringTiles(origin, 1, radius, bounds);
}

/** The tiles a chosen-center art may be aimed at: Manhattan `range.min..range.max`. */
export function centerTiles(origin, range, bounds) {
  return ringTiles(origin, range?.min ?? 0, range?.max ?? 0, bounds);
}

/**
 * `length` tiles past `through`, continuing the straight line from `from` through it.
 * Only a row or column is a line: anything else gives []. The line starts past the
 * target, so a unit between the two is never on it, and it stops before a solid tile or
 * the board's edge.
 */
export function lineTiles(from, through, length, bounds) {
  if (!from || !through) return [];
  const dc = Math.sign(through.col - from.col);
  const dr = Math.sign(through.row - from.row);
  if ((dc === 0) === (dr === 0)) return []; // same tile, or not on a row/column
  const tiles = [];
  const steps = Math.max(0, Math.trunc(Number(length) || 0));
  for (let i = 1; i <= steps; i++) {
    const col = through.col + dc * i;
    const row = through.row + dr * i;
    if (!inBounds(col, row, bounds)) break;
    if (bounds?.isSolid?.(col, row)) break;
    tiles.push({ col, row });
  }
  return tiles;
}

/**
 * The units standing on any of `tiles` (an Entity counts when any tile of its footprint
 * does), each once, in the order of the first tile that reaches it. `exclude` removes
 * units by identity, so another tile of the excluded unit's footprint cannot bring it back.
 */
export function unitsOnTiles(tiles, units, { exclude = [] } = {}) {
  const excluded = new Set((Array.isArray(exclude) ? exclude : [exclude]).filter(Boolean));
  const order = new Map();
  (tiles || []).forEach((t, i) => {
    const key = tileKey(t.col, t.row);
    if (!order.has(key)) order.set(key, i);
  });
  const hits = [];
  for (const unit of units || []) {
    if (!unit || excluded.has(unit)) continue;
    let first = Infinity;
    for (const t of getFootprint(unit)) {
      const index = order.get(tileKey(t.col, t.row));
      if (index !== undefined && index < first) first = index;
    }
    if (first !== Infinity) hits.push({ unit, first });
  }
  hits.sort((a, b) => a.first - b.first);
  return hits.map((h) => h.unit);
}

/**
 * The tiles an art's normalized `area` covers.
 *   radius           around the target (normal_attack) or the chosen center
 *   line             `length` tiles past the target, away from the attacker
 *   around_attacker  around the attacker, its own tile excluded
 */
export function areaTilesFor(area, { attacker = null, target = null, center = null }, bounds) {
  if (!area) return [];
  switch (area.shape) {
    case 'radius': {
      const origin = center || target;
      return origin ? radiusTiles(origin, area.radius, bounds) : [];
    }
    case 'line':
      return attacker && target ? lineTiles(attacker, target, area.length, bounds) : [];
    case 'around_attacker':
      return attacker ? aroundTiles(attacker, area.radius, bounds) : [];
    default:
      return [];
  }
}
