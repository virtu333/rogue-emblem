// HeadlessGrid — Pure Grid algorithms without Phaser dependencies.
// Extracted from src/engine/Grid.js for headless battle testing.

import { parseRange } from '../../src/engine/Combat.js';
import { VISION_RANGES } from '../../src/utils/constants.js';

const DIRECTIONS = [
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
];

export class HeadlessGrid {
  constructor(cols, rows, terrainData, mapLayout, fogEnabled = false) {
    this.cols = cols;
    this.rows = rows;
    this.terrainData = terrainData;
    this.mapLayout = mapLayout;
    this.fogEnabled = fogEnabled;
    this.visibleSet = new Set();
    this.everSeenSet = new Set();
  }

  getTerrainAt(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.terrainData[this.mapLayout[row][col]];
  }

  getMoveCost(col, row, moveType) {
    const terrain = this.getTerrainAt(col, row);
    if (!terrain) return Infinity;
    const cost = terrain.moveCost[moveType];
    if (cost === '--') return Infinity;
    return parseInt(cost, 10);
  }

  // Dijkstra flood-fill: all tiles reachable within `mov` movement points.
  getMovementRange(startCol, startRow, mov, moveType, unitPositions = null, moverFaction = null) {
    const reachable = new Map();
    const queue = [{ col: startCol, row: startRow, cost: 0 }];
    reachable.set(`${startCol},${startRow}`, { cost: 0, parent: null });

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift();

      for (const { dc, dr } of DIRECTIONS) {
        const nc = current.col + dc;
        const nr = current.row + dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;

        const moveCost = this.getMoveCost(nc, nr, moveType);
        if (moveCost === Infinity) continue;

        const key = `${nc},${nr}`;
        if (unitPositions) {
          const occupant = unitPositions.get(key);
          if (occupant && occupant.faction !== moverFaction) continue;
        }

        const newCost = current.cost + moveCost;
        if (newCost > mov) continue;

        const existing = reachable.get(key);
        if (!existing || newCost < existing.cost) {
          reachable.set(key, { cost: newCost, parent: `${current.col},${current.row}` });
          queue.push({ col: nc, row: nr, cost: newCost });
        }
      }
    }

    // Remove ally-occupied tiles from final results
    if (unitPositions && moverFaction) {
      for (const [key] of reachable) {
        if (key === `${startCol},${startRow}`) continue;
        const occupant = unitPositions.get(key);
        if (occupant && occupant.faction === moverFaction) {
          reachable.delete(key);
        }
      }
    }

    return reachable;
  }

  // A* pathfinding — returns array of {col, row} or null.
  findPath(startCol, startRow, goalCol, goalRow, moveType, unitPositions = null, moverFaction = null) {
    const heuristic = (c, r) => Math.abs(c - goalCol) + Math.abs(r - goalRow);

    const openSet = [{ col: startCol, row: startRow, g: 0, f: heuristic(startCol, startRow) }];
    const cameFrom = new Map();
    const gScore = new Map();
    gScore.set(`${startCol},${startRow}`, 0);

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift();
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
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;

        const moveCost = this.getMoveCost(nc, nr, moveType);
        if (moveCost === Infinity) continue;

        const nKey = `${nc},${nr}`;
        if (unitPositions) {
          const occupant = unitPositions.get(nKey);
          if (occupant && occupant.faction !== moverFaction) continue;
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

  // Get all tiles within weapon range (Manhattan distance).
  getAttackRange(col, row, weapon) {
    if (!weapon) return [];
    const { min, max } = parseRange(weapon.range);
    const tiles = [];
    for (let dr = -max; dr <= max; dr++) {
      for (let dc = -max; dc <= max; dc++) {
        const dist = Math.abs(dr) + Math.abs(dc);
        if (dist < min || dist > max) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
        tiles.push({ col: nc, row: nr });
      }
    }
    return tiles;
  }

  getVisionRange(col, row, range) {
    const visible = new Set();
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (Math.abs(dr) + Math.abs(dc) > range) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
        visible.add(`${nc},${nr}`);
      }
    }
    return visible;
  }

  updateFogOfWar(playerUnits) {
    if (!this.fogEnabled) return;
    const newVisible = new Set();
    for (const unit of playerUnits) {
      const range = VISION_RANGES[unit.moveType] || 3;
      const tiles = this.getVisionRange(unit.col, unit.row, range);
      for (const key of tiles) newVisible.add(key);
    }
    this.visibleSet = newVisible;
    for (const key of newVisible) this.everSeenSet.add(key);
  }

  isVisible(col, row) {
    if (!this.fogEnabled) return true;
    return this.visibleSet.has(`${col},${row}`);
  }
}
