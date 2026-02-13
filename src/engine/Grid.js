// Grid — tile rendering, terrain management, movement range (Dijkstra), A* pathfinding, attack range

import { TILE_SIZE, TERRAIN_COLORS, ATTACK_RANGE_COLOR, ATTACK_RANGE_ALPHA, VISION_RANGES } from '../utils/constants.js';
import { parseRange } from './Combat.js';

const DIRECTIONS = [
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
];

function normalizeTerrainName(name) {
  return String(name || '').toLowerCase().replace(/ /g, '_');
}

function getTerrainAtLayout(mapLayout, terrainData, col, row, cols, rows) {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  const terrainIdx = mapLayout[row]?.[col];
  if (terrainIdx == null) return null;
  return terrainData[terrainIdx] || null;
}

function isPassableForMoveType(mapLayout, terrainData, col, row, cols, rows, moveType) {
  const terrain = getTerrainAtLayout(mapLayout, terrainData, col, row, cols, rows);
  if (!terrain) return false;
  const moveCost = terrain.moveCost?.[moveType];
  if (moveCost === '--') return false;
  return Number.isFinite(parseInt(moveCost, 10));
}

export function getEntryDirection(path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const prev = path[path.length - 2];
  const curr = path[path.length - 1];
  return { dc: curr.col - prev.col, dr: curr.row - prev.row };
}

export function resolveIceSlide(
  col,
  row,
  entryDir,
  mapLayout,
  terrainData,
  cols,
  rows,
  moveType,
  occupiedTiles = new Set(),
) {
  if (!entryDir || (!entryDir.dc && !entryDir.dr)) {
    return { col, row, slidePath: [{ col, row }] };
  }

  let currentCol = col;
  let currentRow = row;
  const slidePath = [{ col, row }];

  while (true) {
    const nextCol = currentCol + entryDir.dc;
    const nextRow = currentRow + entryDir.dr;
    const nextKey = `${nextCol},${nextRow}`;

    if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) {
      return { col: currentCol, row: currentRow, slidePath };
    }
    if (occupiedTiles.has(nextKey)) {
      return { col: currentCol, row: currentRow, slidePath };
    }
    if (!isPassableForMoveType(mapLayout, terrainData, nextCol, nextRow, cols, rows, moveType)) {
      return { col: currentCol, row: currentRow, slidePath };
    }

    const nextTerrain = getTerrainAtLayout(mapLayout, terrainData, nextCol, nextRow, cols, rows);
    slidePath.push({ col: nextCol, row: nextRow });

    if (nextTerrain?.name === 'Ice') {
      currentCol = nextCol;
      currentRow = nextRow;
      continue;
    }

    return { col: nextCol, row: nextRow, slidePath };
  }
}

export function computeEffectivePath(
  path,
  mapLayout,
  terrainData,
  cols,
  rows,
  moveType,
  occupiedTiles = new Set(),
) {
  if (!Array.isArray(path) || path.length < 2 || moveType === 'Flying') {
    return {
      effectivePath: path || [],
      slideStartIndex: -1,
      slidePath: [],
      pathEndIndex: Array.isArray(path) && path.length > 0 ? path.length - 1 : -1,
    };
  }

  for (let i = 1; i < path.length; i++) {
    const step = path[i];
    const stepKey = `${step.col},${step.row}`;
    const stepTerrain = getTerrainAtLayout(mapLayout, terrainData, step.col, step.row, cols, rows);
    if (stepTerrain?.name !== 'Ice') continue;

    // Pathfinding can traverse ally tiles; if first Ice entry is occupied, force-stop
    // at the nearest prior unoccupied tile (never end on an occupied tile).
    if (occupiedTiles.has(stepKey)) {
      let stopIndex = i - 1;
      while (stopIndex >= 0) {
        const stopStep = path[stopIndex];
        const stopKey = `${stopStep.col},${stopStep.row}`;
        if (!occupiedTiles.has(stopKey)) break;
        stopIndex -= 1;
      }
      if (stopIndex < 0) stopIndex = 0;
      return {
        effectivePath: path.slice(0, stopIndex + 1),
        slideStartIndex: -1,
        slidePath: [],
        pathEndIndex: stopIndex,
      };
    }

    const prev = path[i - 1];
    const entryDir = { dc: step.col - prev.col, dr: step.row - prev.row };
    const slide = resolveIceSlide(
      step.col,
      step.row,
      entryDir,
      mapLayout,
      terrainData,
      cols,
      rows,
      moveType,
      occupiedTiles,
    );
    const effectivePath = path.slice(0, i).concat(slide.slidePath);
    return { effectivePath, slideStartIndex: i, slidePath: slide.slidePath, pathEndIndex: i };
  }

  return { effectivePath: path, slideStartIndex: -1, slidePath: [], pathEndIndex: path.length - 1 };
}

export class Grid {
  constructor(scene, cols, rows, terrainData, mapLayout, fogEnabled = false, biome = null) {
    this.scene = scene;
    this.cols = cols;
    this.rows = rows;
    this.terrainData = terrainData;
    this.mapLayout = mapLayout; // 2D array of terrain indices
    this.biome = biome;
    this.tiles = [];
    this.highlightTiles = [];
    this.pathTiles = [];
    this.attackHighlightTiles = [];
    this.temporaryTerrains = [];

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
        this.tiles[row][col] = this._createTileDisplay(col, row);
      }
    }
  }

  _createTileDisplay(col, row) {
    const terrainIndex = this.mapLayout[row][col];
    const terrain = this.terrainData[terrainIndex];
    const { x, y } = this.gridToPixel(col, row);
    const baseName = normalizeTerrainName(terrain?.name);
    const biomeKey = this.biome ? `terrain_${baseName}_${this.biome}` : null;
    const baseKey = `terrain_${baseName}`;
    const textureKey = biomeKey && this.scene.textures.exists(biomeKey) ? biomeKey : baseKey;
    if (this.scene.textures.exists(textureKey)) {
      const img = this.scene.add.image(x, y, textureKey);
      img.setDisplaySize(TILE_SIZE, TILE_SIZE);
      return img;
    }
    const color = TERRAIN_COLORS[terrain.name] || 0x808080;
    return this.scene.add.rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, color);
  }

  _rerenderTile(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    const oldTile = this.tiles?.[row]?.[col];
    const depth = oldTile?.depth ?? 0;
    oldTile?.destroy?.();
    const newTile = this._createTileDisplay(col, row);
    newTile.setDepth(depth);
    this.tiles[row][col] = newTile;
  }

  setTerrainAt(col, row, terrainIndex) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    if (!Number.isInteger(terrainIndex) || !this.terrainData[terrainIndex]) return false;
    this.mapLayout[row][col] = terrainIndex;
    this._rerenderTile(col, row);
    return true;
  }

  setTemporaryTerrain(col, row, terrainName, duration = 1) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const terrainIndex = this.terrainData.findIndex(t => t?.name === terrainName);
    if (terrainIndex < 0) return false;
    const key = `${col},${row}`;
    const existing = this.temporaryTerrains.find(t => t.key === key);
    if (existing) {
      existing.remainingTurns = Math.max(existing.remainingTurns, Math.max(1, duration | 0));
      return this.setTerrainAt(col, row, terrainIndex);
    }
    this.temporaryTerrains.push({
      key,
      col,
      row,
      originalIndex: this.mapLayout[row][col],
      temporaryIndex: terrainIndex,
      remainingTurns: Math.max(1, duration | 0),
    });
    return this.setTerrainAt(col, row, terrainIndex);
  }

  clearTemporaryTerrainAt(col, row) {
    const key = `${col},${row}`;
    const idx = this.temporaryTerrains.findIndex(t => t.key === key);
    if (idx < 0) return false;
    const entry = this.temporaryTerrains.splice(idx, 1)[0];
    return this.setTerrainAt(entry.col, entry.row, entry.originalIndex);
  }

  isTemporaryTerrainAt(col, row, terrainIndex = null) {
    const key = `${col},${row}`;
    const entry = this.temporaryTerrains.find(t => t.key === key);
    if (!entry) return false;
    if (terrainIndex == null) return true;
    return this.mapLayout[row]?.[col] === terrainIndex;
  }

  tickTemporaryTerrains() {
    if (!this.temporaryTerrains.length) return;
    const toExpire = [];
    for (const entry of this.temporaryTerrains) {
      entry.remainingTurns -= 1;
      if (entry.remainingTurns <= 0) toExpire.push(entry);
    }
    for (const entry of toExpire) {
      this.clearTemporaryTerrainAt(entry.col, entry.row);
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

  // Overlay cyan dots for the slide segment of a path preview.
  showSlidePath(slidePath) {
    if (!Array.isArray(slidePath) || slidePath.length === 0) return;
    for (const step of slidePath) {
      const { x, y } = this.gridToPixel(step.col, step.row);
      const dot = this.scene.add.rectangle(x, y, TILE_SIZE * 0.28, TILE_SIZE * 0.28, 0x66ddff, 0.7);
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
