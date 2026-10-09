// The pathfinding code as it was before the heap A* (origin/main, 2026-10-09:
// docs/specs/large-maps/02-encounters-and-pacing.md §2.3, §2.4), kept only as the
// references the identity tests run the shipped code against
// (tests/GridPathfindingIdentity.test.js, tests/harness/RecoveryFallbackIdentity.test.js).
// Never import this from src/.
import { passesThrough } from '../src/engine/Grid.js';
import { resolveIceSlide, iceSlideStop } from '../src/engine/IceMovement.js';
import { gridDistance } from '../src/engine/Combat.js';

const DIRECTIONS = [
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
];

/**
 * The former computePath. `tieOrder: 'lifo'` is a deliberately wrong variant (the last
 * pushed of the lowest-f entries pops first) that proves the corpus can tell tie orders
 * apart.
 */
export function referenceComputePath(
  grid,
  startCol,
  startRow,
  goalCol,
  goalRow,
  moveType,
  unitPositions = null,
  moverFaction = null,
  costModifier = 0,
  options = null,
  tieOrder = 'fifo',
) {
  const pass = options?.pass === true;
  const heuristic = (c, r) => Math.abs(c - goalCol) + Math.abs(r - goalRow);

  const openSet = [{ col: startCol, row: startRow, g: 0, f: heuristic(startCol, startRow) }];
  const cameFrom = new Map();
  const gScore = new Map();
  gScore.set(`${startCol},${startRow}`, 0);

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    let current;
    if (tieOrder === 'lifo') {
      let last = 0;
      while (last + 1 < openSet.length && openSet[last + 1].f === openSet[0].f) last++;
      current = openSet.splice(last, 1)[0];
    } else {
      current = openSet.shift();
    }
    const currentKey = `${current.col},${current.row}`;

    if (current.col === goalCol && current.row === goalRow) {
      const path = [];
      let key = currentKey;
      while (key) {
        const [c, r] = key.split(',').map(Number);
        path.unshift({ col: c, row: r });
        key = cameFrom.get(key);
      }
      return path;
    }

    for (const { dc, dr } of DIRECTIONS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (nc < 0 || nc >= grid.cols || nr < 0 || nr >= grid.rows) continue;

      const moveCost = grid.getMoveCost(nc, nr, moveType, costModifier);
      if (moveCost === Infinity) continue;

      const nKey = `${nc},${nr}`;
      if (unitPositions) {
        const occupant = unitPositions.get(nKey);
        if (
          occupant &&
          occupant.faction !== moverFaction &&
          !(pass && passesThrough(occupant, moverFaction))
        )
          continue;
      }

      const tentativeG = current.g + moveCost;

      if (!gScore.has(nKey) || tentativeG < gScore.get(nKey)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        openSet.push({ col: nc, row: nr, g: tentativeG, f: tentativeG + heuristic(nc, nr) });
      }
    }
  }

  return null;
}

/** The former computeMovementRange (queue re-sorted on every pop). */
export function referenceComputeMovementRange(
  grid,
  startCol,
  startRow,
  mov,
  moveType,
  unitPositions = null,
  moverFaction = null,
  costModifier = 0,
  options = null,
) {
  const pass = options?.pass === true;
  const reachable = new Map();
  const queue = [{ col: startCol, row: startRow, cost: 0 }];
  reachable.set(`${startCol},${startRow}`, { cost: 0, parent: null });

  const occupiedTilesSet = new Set();
  if (unitPositions) {
    for (const key of unitPositions.keys()) occupiedTilesSet.add(key);
  }
  occupiedTilesSet.delete(`${startCol},${startRow}`);

  const arrive = (col, row, entry, goesOn) => {
    const key = `${col},${row}`;
    const existing = reachable.get(key);
    if (goesOn) {
      if (existing && !existing.slideStop && existing.cost <= entry.cost) return;
      reachable.set(key, entry);
      queue.push({ col, row, cost: entry.cost });
      return;
    }
    if (existing && (!existing.slideStop || existing.cost <= entry.cost)) return;
    reachable.set(key, { ...entry, slideStop: true });
  };

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    const currentKey = `${current.col},${current.row}`;
    if ((reachable.get(currentKey)?.cost ?? Infinity) < current.cost) continue;

    for (const { dc, dr } of DIRECTIONS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (nc < 0 || nc >= grid.cols || nr < 0 || nr >= grid.rows) continue;

      const moveCost = grid.getMoveCost(nc, nr, moveType, costModifier);
      if (moveCost === Infinity) continue;

      const key = `${nc},${nr}`;
      if (unitPositions) {
        const occupant = unitPositions.get(key);
        if (occupant) {
          if (
            occupant.faction !== moverFaction &&
            !(pass && passesThrough(occupant, moverFaction))
          ) {
            continue;
          }
        }
      }

      const newCost = current.cost + moveCost;
      if (newCost > mov) continue;

      const neighborTerrain = grid.getTerrainAt(nc, nr);
      if (neighborTerrain?.name === 'Ice' && moveType !== 'Flying') {
        if (!occupiedTilesSet.has(key)) {
          const slide = resolveIceSlide(
            nc,
            nr,
            { dc, dr },
            grid.mapLayout,
            grid.terrainData,
            grid.cols,
            grid.rows,
            moveType,
            occupiedTilesSet,
          );
          const stop = iceSlideStop(slide.slidePath, newCost, mov, (t) =>
            grid.getMoveCost(t.col, t.row, moveType, costModifier),
          );
          const land = slide.slidePath[stop.stopIndex];
          arrive(
            land.col,
            land.row,
            {
              cost: stop.cost,
              parent: currentKey,
              slidePath: slide.slidePath.slice(0, stop.stopIndex + 1),
            },
            stop.complete,
          );
          continue;
        }
      }

      arrive(nc, nr, { cost: newCost, parent: currentKey }, true);
    }
  }

  if (unitPositions && moverFaction) {
    for (const [key, entry] of reachable) {
      if (key === `${startCol},${startRow}`) continue;
      const occupant = unitPositions.get(key);
      if (
        occupant &&
        (occupant.faction === moverFaction || (pass && passesThrough(occupant, moverFaction)))
      ) {
        entry.stoppable = false;
      }
    }
  }

  return reachable;
}

/** The former AIController._findRecoveryFallbackTile + _findShortestPathToTiles. */
export function referenceRecoveryFallbackTile(
  ai,
  enemy,
  targets,
  candidates,
  unitPositions,
  moveRange,
) {
  if (!targets || targets.length === 0) return null;
  const sortedTargets = [...targets].sort(
    (a, b) =>
      gridDistance(enemy.col, enemy.row, a.col, a.row) -
      gridDistance(enemy.col, enemy.row, b.col, b.row),
  );
  const candidateSet = new Set(candidates.map((t) => `${t.col},${t.row}`));

  let best = null;
  for (const target of sortedTargets) {
    const recoveryTiles = ai._getRecoveryTilesForTarget(enemy, target);
    let path = null;
    for (const tile of recoveryTiles) {
      const p = ai._findPathWithIceFallback(enemy, tile.col, tile.row, unitPositions, moveRange);
      if (!p || p.length < 2) continue;
      if (!path || p.length < path.length) path = p;
    }
    if (!path || path.length < 2) continue;

    let chosenTile = null;
    for (let i = path.length - 1; i >= 1; i--) {
      const node = path[i];
      if (candidateSet.has(`${node.col},${node.row}`)) {
        chosenTile = node;
        break;
      }
    }
    if (!chosenTile) continue;

    if (!best || path.length < best.pathLength) {
      best = { tile: chosenTile, target, pathLength: path.length };
    }
  }
  return best;
}

/** The former AIController._findPathAwareChaseTile. */
export function referencePathAwareChaseTile(
  ai,
  enemy,
  target,
  candidates,
  unitPositions,
  moveRange,
) {
  const candidateSet = new Set(candidates.map((t) => `${t.col},${t.row}`));
  const approachTiles = ai._getApproachTilesForTarget(enemy, target);
  if (approachTiles.length === 0) return null;

  let bestPath = null;
  for (const tile of approachTiles) {
    const path = ai._findPathWithIceFallback(enemy, tile.col, tile.row, unitPositions, moveRange);
    if (!path || path.length < 2) continue;
    if (!bestPath || path.length < bestPath.length) bestPath = path;
  }
  if (!bestPath) return null;

  for (let i = bestPath.length - 1; i >= 1; i--) {
    const node = bestPath[i];
    if (candidateSet.has(`${node.col},${node.row}`)) return node;
  }
  return null;
}
