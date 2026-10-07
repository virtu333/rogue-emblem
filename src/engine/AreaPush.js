// AreaPush — Override's push (docs/specs/phase3.md 3F): after the line damage, every foe
// the line hit, and the primary target with them, is driven `distance` tile(s) straight
// away from the attacker. Pure: no Phaser, no RNG, and nothing is moved here. It plans
// the pushes over a board the caller supplies, and the caller applies them (execution:
// PostCombatEffects over the real board) or draws them (the preview: the board as the
// player knows it, engine/AreaPreview.js).
//
// The rules:
//   - The attacker must stand cardinally next to the primary (as every art push does); from
//     range the line still strikes but nothing moves. The push runs along that axis.
//   - Who is pushed: the primary (if it stands) and each live foe on the line's tiles
//     (AreaDamage.areaVictims: the same units the line's blows reach). A foe the blows
//     felled is not on the board any more, so it is never pushed. The primary is one unit
//     in one list, so it is never moved twice.
//   - The farthest goes first, so a near foe never blocks on a far one that is about to
//     move; each later push sees the board as the earlier ones left it.
//   - Each push is ForcedMovement.traceForcedMove: Ice slides apply, and a push that cannot
//     take its whole distance (an edge, a wall, a unit) leaves the unit where it is.
//   - Bosses, the Entity, Anchored and rooted foes stay put, as for Smite
//     (ForcedMovement.displacementBlockReason). They still block the tile behind them.

import { areaVictims } from './AreaDamage.js';
import { getFootprint } from './EntitySystem.js';
import { displacementBlockReason, traceForcedMove } from './ForcedMovement.js';

const isLive = (unit) => Boolean(unit) && !unit._removing && Number(unit.currentHP) > 0;

/** Tiles from `source` to the nearest tile `unit` stands on. */
function distanceFrom(source, unit) {
  return Math.min(
    ...getFootprint(unit).map((t) => Math.abs(t.col - source.col) + Math.abs(t.row - source.row)),
  );
}

/**
 * @param {object} p
 * @param {object} p.source    the art's user
 * @param {object} p.primary   the combat's target
 * @param {object} p.area      the art's normalized line area (WeaponArtSystem.getWeaponArtArea)
 * @param {number} [p.distance] tiles of push (default 1)
 * @param {object[]} p.units   the foes the line may hit: every hostile for execution, only
 *                             the known ones for a preview
 * @param {object} p.world     { cols, rows, getMoveCost, getTerrainAt?, affixes? }
 * @param {(col:number,row:number)=>object|null} p.getUnitAt  who blocks a push's tiles
 * @param {(col:number,row:number)=>object|null} [p.slideUnitAt]  who stops a slide
 *                             (default: getUnitAt)
 * @param {Iterable<object>} [p.felled]  units to treat as already fallen (a preview's
 *                             foes the blows will kill): never pushed, and they block nothing
 * @returns {{ direction: {dc:number,dr:number}|null, entries: Array<{ unit: object,
 *   from: {col:number,row:number}, to: {col:number,row:number}, moved: boolean,
 *   reason: null|'blocked'|'entity'|'boss'|'anchored'|'rooted', steps: number,
 *   slid: boolean, path: object[] }> }} entries in push order, farthest first
 */
export function planAreaPush({
  source,
  primary,
  area,
  distance = 1,
  units = [],
  world,
  getUnitAt,
  slideUnitAt = getUnitAt,
  felled = [],
}) {
  const plan = { direction: null, entries: [] };
  if (!source || !primary || !area || typeof getUnitAt !== 'function') return plan;
  const dc = primary.col - source.col;
  const dr = primary.row - source.row;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return plan;
  plan.direction = { dc, dr };

  const down = new Set(felled);
  const standing = (unit) => isLive(unit) && !down.has(unit);
  const struck = areaVictims({ source, primary, area, units, world }).filter(standing);
  if (standing(primary)) struck.push(primary);
  // Farthest first. The sort is stable, so two units at one distance keep the area's order.
  const order = struck.sort((a, b) => distanceFrom(source, b) - distanceFrom(source, a));

  // The board as the pushes leave it: a unit that moved is on its new tile and gone from
  // its old one. A felled unit that is still on the grid blocks nothing.
  const moved = new Map();
  const through = (baseAt) => (col, row) => {
    for (const [unit, to] of moved) if (to.col === col && to.row === row) return unit;
    const unit = baseAt(col, row);
    if (!unit || moved.has(unit) || !standing(unit)) return null;
    return unit;
  };
  const occupantAt = through(getUnitAt);
  const slideOccupantAt = through(slideUnitAt || getUnitAt);
  const grid = {
    cols: world.cols,
    rows: world.rows,
    getMoveCost: world.getMoveCost,
    getTerrainAt: world.getTerrainAt || undefined,
  };

  for (const unit of order) {
    const from = { col: unit.col, row: unit.row };
    const entry = {
      unit,
      from,
      to: { ...from },
      moved: false,
      reason: null,
      steps: 0,
      slid: false,
      path: [from],
    };
    plan.entries.push(entry);
    entry.reason = displacementBlockReason(unit, world.affixes);
    if (entry.reason) continue;
    // A unit that is not on the tile it claims (an earlier effect moved it) stays.
    if (getUnitAt(unit.col, unit.row) !== unit) {
      entry.reason = 'blocked';
      continue;
    }
    const trace = traceForcedMove(unit, dc, dr, distance, grid, occupantAt, slideOccupantAt);
    // All or nothing: every tile of the push must be enterable, or the unit stays.
    if (trace.steps <= 0 || trace.stoppedShort) {
      entry.reason = 'blocked';
      continue;
    }
    entry.moved = trace.col !== from.col || trace.row !== from.row;
    entry.to = { col: trace.col, row: trace.row };
    entry.steps = trace.steps;
    entry.slid = trace.slid;
    entry.path = trace.path;
    if (entry.moved) moved.set(unit, entry.to);
  }
  return plan;
}
