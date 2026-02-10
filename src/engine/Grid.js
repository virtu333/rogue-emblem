// Grid — tile rendering, terrain management, movement range (Dijkstra), A* pathfinding, attack range

import { TILE_SIZE, TERRAIN_COLORS, ATTACK_RANGE_COLOR, ATTACK_RANGE_ALPHA, VISION_RANGES } from '../utils/constants.js';
import { parseRange } from './Combat.js';

const DIRECTIONS = [
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
];

export class Grid {
  constructor(scene, cols, rows, terrainData, mapLayout, fogEnabled = false) {
    this.scene = scene;
    this.cols = cols;
    this.rows = rows;
    this.terrainData = terrainData;
    this.mapLayout = mapLayout; // 2D array of terrain indices
    this.tiles = [];
    this.highlightTiles = [];
    this.pathTiles = [];
    this.attackHighlightTiles = [];

    // Fog of war
    this.fogEnabled = fogEnabled;
    this.fogOverlays = [];
    this.visibleSet = new Set();   // currently visible "col,row"
    this.everSeenSet = new Set();  // ever revealed "col,row"

    // Center the grid on the canvas
    const mapWidth = cols * TILE_SIZE;
    const mapHeight = rows * TILE_SIZE;
    this.offsetX = Math.floor((scene.cameras.main.width - mapWidth) / 2);
    this.offsetY = Math.floor((scene.cameras.main.height - mapHeight) / 2);

    this.render();
    if (this.fogEnabled) this.initFogOverlays();
  }

  render() {
    for (let row = 0; row < this.rows; row++) {
      this.tiles[row] = [];
      for (let col = 0; col < this.cols; col++) {
        const terrainIndex = this.mapLayout[row][col];
        const terrain = this.terrainData[terrainIndex];
        const { x, y } = this.gridToPixel(col, row);

        const textureKey = `terrain_${terrain.name.toLowerCase()}`;
        if (this.scene.textures.exists(textureKey)) {
          const img = this.scene.add.image(x, y, textureKey);
          img.setDisplaySize(TILE_SIZE, TILE_SIZE);
          this.tiles[row][col] = img;
        } else {
          const color = TERRAIN_COLORS[terrain.name] || 0x808080;
          const rect = this.scene.add.rectangle(
            x, y, TILE_SIZE - 1, TILE_SIZE - 1, color
          );
          this.tiles[row][col] = rect;
        }
      }
    }
  }

  // Convert pixel position to grid coordinates
  pixelToGrid(px, py) {
    const col = Math.floor((px - this.offsetX) / TILE_SIZE);
    const row = Math.floor((py - this.offsetY) / TILE_SIZE);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return { col, row };
  }

  // Convert grid coordinates to pixel center of tile
  gridToPixel(col, row) {
    return {
      x: this.offsetX + col * TILE_SIZE + TILE_SIZE / 2,
      y: this.offsetY + row * TILE_SIZE + TILE_SIZE / 2,
    };
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

  /**
   * Dijkstra flood-fill: all tiles reachable within `mov` movement points.
   * @param {number} startCol
   * @param {number} startRow
   * @param {number} mov - movement points
   * @param {string} moveType - e.g. "Infantry", "Cavalry"
   * @param {Map} [unitPositions] - Map of "col,row" -> { faction } for occupied tiles
   * @param {string} [moverFaction] - faction of the moving unit
   * @returns {Map} "col,row" -> { cost, parent }
   */
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

        // Check unit occupancy
        const key = `${nc},${nr}`;
        if (unitPositions) {
          const occupant = unitPositions.get(key);
          if (occupant) {
            if (occupant.faction !== moverFaction) {
              // Enemy on tile — can't move through
              continue;
            }
            // Ally on tile — can traverse but mark as occupied (filter below)
          }
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

    // Remove ally-occupied tiles from final results (can pass through but not stop on)
    if (unitPositions && moverFaction) {
      for (const [key] of reachable) {
        if (key === `${startCol},${startRow}`) continue; // own tile is fine
        const occupant = unitPositions.get(key);
        if (occupant && occupant.faction === moverFaction) {
          reachable.delete(key);
        }
      }
    }

    return reachable;
  }

  // A* pathfinding from (startCol,startRow) to (goalCol,goalRow)
  // Returns array of {col, row} from start to goal, or null if unreachable
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
        // Reconstruct path
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

        // Block enemy-occupied tiles (can pass through allies)
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

  /**
   * Get all tiles within weapon range from a position (Manhattan distance).
   * @param {number} col
   * @param {number} row
   * @param {Object} weapon - weapon object with range string
   * @returns {Array<{col, row}>}
   */
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

  // Display blue movement range overlay (skip unit's own tile)
  showMovementRange(reachable, unitCol, unitRow, color = 0x3366cc, alpha = 0.4) {
    this.clearHighlights();
    for (const [key] of reachable) {
      if (key === `${unitCol},${unitRow}`) continue;
      const [col, row] = key.split(',').map(Number);
      const { x, y } = this.gridToPixel(col, row);
      const highlight = this.scene.add.rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, color, alpha);
      highlight.setDepth(5);
      this.highlightTiles.push(highlight);
    }
  }

  // Display green heal range overlay (reuses attackHighlightTiles — never shown simultaneously)
  showHealRange(tiles) {
    this.clearAttackHighlights();
    for (const { col, row } of tiles) {
      const { x, y } = this.gridToPixel(col, row);
      const highlight = this.scene.add.rectangle(
        x, y, TILE_SIZE - 1, TILE_SIZE - 1, 0x33cc66, 0.4
      );
      highlight.setDepth(5);
      this.attackHighlightTiles.push(highlight);
    }
  }

  // Display red attack range overlay
  showAttackRange(tiles, color = ATTACK_RANGE_COLOR, alpha = ATTACK_RANGE_ALPHA) {
    this.clearAttackHighlights();
    for (const { col, row } of tiles) {
      const { x, y } = this.gridToPixel(col, row);
      const highlight = this.scene.add.rectangle(
        x, y, TILE_SIZE - 1, TILE_SIZE - 1, color, alpha
      );
      highlight.setDepth(5);
      this.attackHighlightTiles.push(highlight);
    }
  }

  clearAttackHighlights() {
    this.attackHighlightTiles.forEach(h => h.destroy());
    this.attackHighlightTiles = [];
  }

  // Show path preview (lighter blue trail)
  showPath(path) {
    this.clearPath();
    // Skip first node (unit's position)
    for (let i = 1; i < path.length; i++) {
      const { x, y } = this.gridToPixel(path[i].col, path[i].row);
      const dot = this.scene.add.rectangle(x, y, TILE_SIZE * 0.4, TILE_SIZE * 0.4, 0x88bbff, 0.7);
      dot.setDepth(6);
      this.pathTiles.push(dot);
    }
  }

  clearPath() {
    this.pathTiles.forEach(p => p.destroy());
    this.pathTiles = [];
  }

  clearHighlights() {
    this.highlightTiles.forEach(h => h.destroy());
    this.highlightTiles = [];
    this.clearPath();
  }

  // --- Fog of War ---

  initFogOverlays() {
    for (let row = 0; row < this.rows; row++) {
      this.fogOverlays[row] = [];
      for (let col = 0; col < this.cols; col++) {
        const { x, y } = this.gridToPixel(col, row);
        const fog = this.scene.add.rectangle(
          x, y, TILE_SIZE, TILE_SIZE, 0x000000, 0.7
        ).setDepth(3);
        this.fogOverlays[row][col] = fog;
      }
    }
  }

  /**
   * Get all tiles visible from a position within Manhattan distance.
   * Pure function — returns Set of "col,row" keys.
   */
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

  /**
   * Update fog of war based on player unit positions.
   * @param {Array} playerUnits - array of units with col, row, moveType
   */
  updateFogOfWar(playerUnits) {
    if (!this.fogEnabled) return;

    // Calculate vision union
    const newVisible = new Set();
    for (const unit of playerUnits) {
      const range = VISION_RANGES[unit.moveType] || 3;
      const tiles = this.getVisionRange(unit.col, unit.row, range);
      for (const key of tiles) newVisible.add(key);
    }

    this.visibleSet = newVisible;
    for (const key of newVisible) this.everSeenSet.add(key);

    // Update fog overlay alpha
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const key = `${col},${row}`;
        const fog = this.fogOverlays[row]?.[col];
        if (!fog) continue;
        if (newVisible.has(key)) {
          fog.setAlpha(0); // fully visible
        } else if (this.everSeenSet.has(key)) {
          fog.setAlpha(0.3); // seen before
        } else {
          fog.setAlpha(0.7); // never seen
        }
      }
    }
  }

  /** Check if a tile is currently visible (in fog mode). */
  isVisible(col, row) {
    if (!this.fogEnabled) return true;
    return this.visibleSet.has(`${col},${row}`);
  }

  /** Clean up fog overlays. */
  destroyFog() {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const fog = this.fogOverlays[row]?.[col];
        if (fog) fog.destroy();
      }
    }
    this.fogOverlays = [];
  }
}
