// TerrainPhases.js — the one terrain override (pure: no Phaser, no RNG).
//
// `applyTerrainSetTiles` is the only code that writes authored terrain changes onto a
// live battle board: today the hybrid arenas' `phaseTerrainOverrides`, later the
// objective phases' `onEnter.setTiles` (docs/specs/large-maps). BattleScene and the
// headless harness both call it, so the two boards cannot drift.
//
// The rule it adds over a raw `grid.setTerrainAt`: it never writes terrain a unit
// standing on the tile could not stand on (its move type; every tile of a multi-tile
// footprint counts). Those entries are refused and returned, and the caller decides
// what a refusal means. `setTerrainAt` itself stays a raw setter, because restoring a
// saved board goes through it and must reproduce that board exactly.
//
// `applyDueHybridOverrides` is the v1 hybrid-arena caller: a refused tile is deferred
// (`pendingHybridOverrideTiles`, saved with the battle) and retried at each later
// enemy-phase start until the tile is free (docs/specs/large-maps/02-encounters-and-
// pacing.md §2.2).

import { getFootprint } from './EntitySystem.js';

const tileKey = (col, row) => `${col},${row}`;

/** Whether a unit of `moveType` may stand on `terrain` (the reinforcement rule: a cost, not '--'). */
export function canStandOnTerrain(terrain, moveType = 'Infantry') {
  if (!terrain) return false;
  const cost = terrain.moveCost?.[moveType || 'Infantry'];
  return cost !== '--' && !Number.isNaN(parseInt(cost, 10));
}

/** The tile a setTiles entry names: `coord: [col, row]`, or `anchor` resolved by `anchors`. */
export function resolveSetTileTarget(setTile, anchors = {}) {
  const target = Array.isArray(setTile?.coord)
    ? { col: setTile.coord[0], row: setTile.coord[1] }
    : anchors?.[setTile?.anchor];
  if (!target || !Number.isInteger(target.col) || !Number.isInteger(target.row)) return null;
  return { col: target.col, row: target.row };
}

function occupantsByTile(occupants) {
  const byTile = new Map();
  for (const unit of occupants || []) {
    if (!unit || unit._removing || !(unit.currentHP > 0)) continue;
    for (const tile of getFootprint(unit)) {
      const key = tileKey(tile.col, tile.row);
      if (!byTile.has(key)) byTile.set(key, []);
      byTile.get(key).push(unit);
    }
  }
  return byTile;
}

/**
 * Write `setTiles` onto `grid` (anything with cols, rows, terrainData, mapLayout and
 * setTerrainAt: Grid and HeadlessGrid), in order.
 *
 * - An entry whose target or terrain cannot be resolved is `skipped`.
 * - An entry whose tile holds a unit that could not stand on the new terrain is
 *   `refused` (with those units) and the tile is left as it is.
 * - Otherwise it is `applied`. A tile under a temporary terrain (an affix wall) keeps
 *   that terrain until it expires; the override becomes what it expires back to.
 *
 * `changedTiles` counts the writes made to the board.
 */
export function applyTerrainSetTiles(grid, setTiles, anchors = {}, { occupants = [] } = {}) {
  const out = { applied: [], refused: [], skipped: [], changedTiles: 0 };
  if (!grid || !Array.isArray(setTiles)) return out;
  const terrainData = grid.terrainData || [];
  const byTile = occupantsByTile(occupants);
  for (const setTile of setTiles) {
    const target = resolveSetTileTarget(setTile, anchors);
    const terrainIndex = terrainData.findIndex((terrain) => terrain?.name === setTile?.terrain);
    if (
      !target ||
      terrainIndex < 0 ||
      target.col < 0 ||
      target.row < 0 ||
      target.col >= grid.cols ||
      target.row >= grid.rows
    ) {
      out.skipped.push({ setTile });
      continue;
    }
    const entry = { col: target.col, row: target.row, terrain: setTile.terrain, terrainIndex };
    const terrain = terrainData[terrainIndex];
    const blockers = (byTile.get(tileKey(target.col, target.row)) || []).filter(
      (unit) => !canStandOnTerrain(terrain, unit.moveType),
    );
    if (blockers.length > 0) {
      out.refused.push({ ...entry, occupants: blockers });
      continue;
    }
    const temporary = (grid.temporaryTerrains || []).find(
      (t) => t?.key === tileKey(target.col, target.row),
    );
    if (temporary) {
      temporary.originalIndex = terrainIndex;
      out.applied.push({ ...entry, underTemporary: true });
      continue;
    }
    if (grid.setTerrainAt?.(target.col, target.row, terrainIndex)) {
      out.changedTiles++;
      out.applied.push(entry);
    } else {
      out.skipped.push({ setTile });
    }
  }
  return out;
}

/** A deferred override tile as it is saved: `{ turn, col, row, terrain }` (terrain by name). */
export function normalizePendingTerrainTiles(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    if (
      !entry ||
      !Number.isInteger(entry.turn) ||
      entry.turn < 1 ||
      !Number.isInteger(entry.col) ||
      !Number.isInteger(entry.row) ||
      typeof entry.terrain !== 'string'
    )
      continue;
    out.push({ turn: entry.turn, col: entry.col, row: entry.row, terrain: entry.terrain });
  }
  return out;
}

/**
 * The hybrid arenas' phase overrides at the start of enemy phase `turn`.
 *
 * 1. Tiles deferred at an earlier enemy-phase start are retried, oldest first.
 * 2. Every override authored for exactly this turn and not yet applied
 *    (`appliedTurns`, mutated) is applied; a refused tile joins the pending list.
 *
 * A tile is pending at most once: a later write to it (applied or deferred)
 * replaces the older entry, so a retry never undoes a newer override.
 *
 * Returns `{ result, pendingTiles }`; the caller stores `pendingTiles` (a new array).
 */
export function applyDueHybridOverrides({
  grid,
  battleConfig,
  turn,
  occupants = [],
  appliedTurns,
  pendingTiles = [],
} = {}) {
  const normalizedTurn = Math.trunc(Number(turn) || 0);
  const pending = normalizePendingTerrainTiles(pendingTiles);
  const result = {
    turn: normalizedTurn,
    dueOverrides: 0,
    appliedOverrides: 0,
    changedTiles: 0,
    retriedTiles: 0,
    deferredTiles: 0,
    pendingTiles: pending.length,
  };
  if (normalizedTurn <= 0) return { result, pendingTiles: pending };

  const queue = new Map(pending.map((entry) => [tileKey(entry.col, entry.row), entry]));
  // One entry's outcome: refused -> (re)deferred, newest last; applied -> nothing left
  // to retry on that tile. `dropSkipped`: a retry that can no longer resolve is dropped.
  const settle = (key, outcome, deferred, { dropSkipped = false } = {}) => {
    result.changedTiles += outcome.changedTiles;
    if (outcome.refused.length > 0) {
      result.deferredTiles++;
      queue.delete(key);
      queue.set(key, deferred);
    } else if (outcome.applied.length > 0 || dropSkipped) {
      queue.delete(key);
    }
  };

  for (const entry of pending) {
    if (entry.turn >= normalizedTurn) continue;
    result.retriedTiles++;
    const outcome = applyTerrainSetTiles(
      grid,
      [{ coord: [entry.col, entry.row], terrain: entry.terrain }],
      {},
      { occupants },
    );
    settle(tileKey(entry.col, entry.row), outcome, entry, { dropSkipped: true });
  }

  const overrides = battleConfig?.phaseTerrainOverrides;
  const due = Array.isArray(overrides)
    ? overrides.filter(
        (entry) =>
          Number.isInteger(entry?.turn) &&
          entry.turn === normalizedTurn &&
          !appliedTurns?.has?.(entry.turn),
      )
    : [];
  const anchors = battleConfig?.hybridAnchors || {};
  for (const entry of due) {
    for (const setTile of Array.isArray(entry?.setTiles) ? entry.setTiles : []) {
      const target = resolveSetTileTarget(setTile, anchors);
      const outcome = applyTerrainSetTiles(grid, [setTile], anchors, { occupants });
      if (!target) continue;
      settle(tileKey(target.col, target.row), outcome, {
        turn: entry.turn,
        col: target.col,
        row: target.row,
        terrain: setTile.terrain,
      });
    }
    appliedTurns?.add?.(entry.turn);
  }
  result.dueOverrides = due.length;
  result.appliedOverrides = due.length;
  const nextPending = [...queue.values()];
  result.pendingTiles = nextPending.length;
  return { result, pendingTiles: nextPending };
}
