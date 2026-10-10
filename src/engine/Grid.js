import { createBattleTerrain } from '../ui/BattleMapVisuals.js';
import { safeBattlePresentation } from '../ui/safeBattlePresentation.js';
import { paintFogOverlays } from '../ui/fogState.js';
// Grid — tile rendering, terrain management, movement range (Dijkstra), A* pathfinding, attack range

import {
  TILE_SIZE,
  ATTACK_RANGE_COLOR,
  ATTACK_RANGE_ALPHA,
  VISION_RANGES,
} from '../utils/constants.js';
import { parseRange } from './Combat.js';
import { createBoardTransform } from '../utils/boardOrientation.js';
import {
  ICE_FREE_SLIDE_TILES,
  getTerrainAtLayout,
  iceSlideStop,
  resolveIceSlide,
} from './IceMovement.js';

const DIRECTIONS = [
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
];

/**
 * The open set of computePath and computeMovementRange: a binary min-heap that pops entries
 * in exactly the order the searches' former `queue.sort((a, b) => a.p - b.p); queue.shift()`
 * did. That sort is stable and each round's pushes land after the remainder of the previous
 * round, so it popped the lowest priority and, among equals, the earliest pushed: the
 * heap's order (priority, insertion sequence). A priority that compares with nothing (NaN:
 * an unknown move type's costs) ties with everything, as it did under the sort's
 * comparator (`NaN < 0` is false), so such entries keep insertion order too.
 */
class InsertionOrderedHeap {
  constructor() {
    this.items = [];
    this.nextSeq = 0;
  }

  get size() {
    return this.items.length;
  }

  push(priority, value) {
    const entry = { priority, seq: this.nextSeq++, value };
    const items = this.items;
    let i = items.length;
    items.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!popsBefore(entry, items[parent])) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = entry;
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    const length = items.length;
    if (length > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= length) break;
        const right = left + 1;
        const child = right < length && popsBefore(items[right], items[left]) ? right : left;
        if (!popsBefore(items[child], last)) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return top.value;
  }
}

function popsBefore(a, b) {
  return a.priority < b.priority || (!(b.priority < a.priority) && a.seq < b.seq);
}

/**
 * Does a mover with Pass walk through this occupant? Enemy units only, and never for an
 * enemy mover (Pass is a player skill: the AI's movement code never sets the option).
 * NPC allies keep blocking as they always did.
 */
export function passesThrough(occupant, moverFaction) {
  return occupant?.faction === 'enemy' && moverFaction !== 'enemy';
}

export function getEntryDirection(path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const prev = path[path.length - 2];
  const curr = path[path.length - 1];
  return { dc: curr.col - prev.col, dr: curr.row - prev.row };
}

export { resolveIceSlide };

export function computeEffectivePath(
  path,
  mapLayout,
  terrainData,
  cols,
  rows,
  moveType,
  occupiedTiles = new Set(),
  costModifier = 0,
) {
  const noSlideResult = (p) => ({
    effectivePath: p || [],
    slideSegments: [],
    movementCost: 0,
    // Legacy compat fields (deprecated)
    slideStartIndex: -1,
    slidePath: [],
    pathEndIndex: Array.isArray(p) && p.length > 0 ? p.length - 1 : -1,
  });

  if (!Array.isArray(path) || path.length < 2) {
    return noSlideResult(path);
  }

  const effectivePath = [path[0]];
  const slideSegments = [];
  let movementCost = 0;
  let i = 1;

  while (i < path.length) {
    const step = path[i];
    const stepTerrain = getTerrainAtLayout(mapLayout, terrainData, step.col, step.row, cols, rows);

    if (stepTerrain?.name === 'Ice' && moveType !== 'Flying') {
      const stepKey = `${step.col},${step.row}`;
      // If ice entry is occupied, force-stop at prior unoccupied tile
      if (occupiedTiles.has(stepKey)) {
        // Occupied ice entry — walk through normally, no slide.
        // Mirrors getMovementRange which allows ally traversal on ice.
        const rawCost = parseInt(stepTerrain.moveCost?.[moveType] || '1', 10);
        const cost = costModifier ? Math.max(1, rawCost - costModifier) : rawCost;
        movementCost += Number.isFinite(cost) ? cost : 1;
        effectivePath.push({ col: step.col, row: step.row });
        i++;
        continue;
      }

      // Add the walk-onto-ice cost
      const iceCost = getTerrainAtLayout(mapLayout, terrainData, step.col, step.row, cols, rows);
      const rawIceCost = iceCost ? parseInt(iceCost.moveCost?.[moveType] || '1', 10) : 1;
      const iceMoveCost = costModifier ? Math.max(1, rawIceCost - costModifier) : rawIceCost;
      movementCost += Number.isFinite(iceMoveCost) ? iceMoveCost : 1;

      const prev = effectivePath[effectivePath.length - 1];
      const entryDir = { dc: step.col - prev.col, dr: step.row - prev.row };
      let slide = resolveIceSlide(
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
      // A path rebuilt from a movement range whose goal is a slide cut short by the
      // allowance (reconstructIcePath marks it `slideStop`) stops there, on the ice. A
      // path without the mark (A*) always slides to the end: only the range knows the
      // allowance, so only it may stop a slide early.
      const dest = path[path.length - 1];
      if (dest?.slideStop) {
        const di = slide.slidePath.findIndex((t) => t.col === dest.col && t.row === dest.row);
        const rest = path.slice(i + 1);
        const followsSlide =
          di > 0 &&
          di < slide.slidePath.length - 1 &&
          rest.length === di &&
          rest.every(
            (t, k) => t.col === slide.slidePath[k + 1].col && t.row === slide.slidePath[k + 1].row,
          );
        if (followsSlide)
          slide = { col: dest.col, row: dest.row, slidePath: slide.slidePath.slice(0, di + 1) };
      }
      // Tiles slid past the free ones are paid (IceMovement.js).
      for (let si = ICE_FREE_SLIDE_TILES + 1; si < slide.slidePath.length; si++) {
        const tile = slide.slidePath[si];
        const slid = getTerrainAtLayout(mapLayout, terrainData, tile.col, tile.row, cols, rows);
        const rawSlid = slid ? parseInt(slid.moveCost?.[moveType] || '1', 10) : 1;
        const slidCost = costModifier ? Math.max(1, rawSlid - costModifier) : rawSlid;
        movementCost += Number.isFinite(slidCost) ? slidCost : 1;
      }

      const startIndex = effectivePath.length;
      for (const s of slide.slidePath) {
        const last = effectivePath[effectivePath.length - 1];
        if (last.col === s.col && last.row === s.row) continue;
        effectivePath.push({ col: s.col, row: s.row });
      }
      slideSegments.push({ startIndex, slidePath: slide.slidePath });

      // Skip any original path tiles the slide already covered.
      // If no remaining step connects to the landing, the path is broken by the slide — stop.
      const landCol = slide.col;
      const landRow = slide.row;
      let pathBroken = true;
      i++;
      while (i < path.length) {
        const next = path[i];
        // If the original path goes through the slide landing, continue from there
        if (next.col === landCol && next.row === landRow) {
          i++;
          pathBroken = false;
          break;
        }
        // Check if this path tile was part of the slide (between entry and landing)
        const isOnSlide = slide.slidePath.some((sp) => sp.col === next.col && sp.row === next.row);
        if (isOnSlide) {
          i++;
          continue;
        }
        // Check if remaining path step is adjacent to landing
        const dx = Math.abs(next.col - landCol);
        const dy = Math.abs(next.row - landRow);
        if (dx + dy === 1) {
          pathBroken = false;
        }
        break;
      }
      if (pathBroken) break; // slide diverted us — stop processing remaining path
      continue;
    }

    // Normal walk step
    const terrain = getTerrainAtLayout(mapLayout, terrainData, step.col, step.row, cols, rows);
    const rawCost = terrain ? parseInt(terrain.moveCost?.[moveType] || '1', 10) : 1;
    const cost = costModifier ? Math.max(1, rawCost - costModifier) : rawCost;
    movementCost += Number.isFinite(cost) ? cost : 1;
    effectivePath.push({ col: step.col, row: step.row });
    i++;
  }

  return {
    effectivePath,
    slideSegments,
    movementCost,
    // Legacy compat fields
    slideStartIndex: slideSegments.length > 0 ? slideSegments[0].startIndex : -1,
    slidePath: slideSegments.length > 0 ? slideSegments[0].slidePath : [],
    pathEndIndex: effectivePath.length - 1,
  };
}

/**
 * Dijkstra flood-fill: all tiles reachable within `mov` movement points. Shared by the
 * scene's Grid and the headless harness's grid (anything with cols, rows, mapLayout,
 * terrainData, getMoveCost and getTerrainAt), so the two never drift.
 *
 * Ice: stepping onto Ice resolves the slide. The slide is priced (IceMovement.js): the
 * landing is reached at the slide's cost and the move goes on from it, or, when the
 * allowance runs out mid-slide, the unit stops on that ice tile and the move ends there
 * (the entry is marked `slideStop` and never expanded). A tile reached both ways keeps
 * the arrival the move can go on from, since parent chains run through it.
 *
 * @param {object} grid
 * @param {number} startCol
 * @param {number} startRow
 * @param {number} mov - movement points
 * @param {string} moveType - e.g. "Infantry", "Cavalry"
 * @param {Map} [unitPositions] - Map of "col,row" -> { faction } for occupied tiles
 * @param {string} [moverFaction] - faction of the moving unit
 * @param {number} [costModifier]
 * @param {{ pass?: boolean }} [options] - `pass`: the mover has Pass (passesThrough): it
 *   walks through enemy units and may not stop on one, the rule an ally's tile already
 *   follows. An occupied tile still ends an ice slide.
 * @returns {Map} "col,row" -> { cost, parent, slidePath?, slideStop?, stoppable? }
 */
export function computeMovementRange(
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
  const queue = new InsertionOrderedHeap();
  queue.push(0, { col: startCol, row: startRow, cost: 0 });
  reachable.set(`${startCol},${startRow}`, { cost: 0, parent: null });

  // Build occupied set for ice slide blocking (all units except mover).
  // Both allies AND enemies block slides.
  const occupiedTilesSet = new Set();
  if (unitPositions) {
    for (const key of unitPositions.keys()) {
      occupiedTilesSet.add(key);
    }
  }
  // Exclude mover's own tile from blocking
  occupiedTilesSet.delete(`${startCol},${startRow}`);

  // An arrival the move goes on from replaces any costlier one and any slide stop; a
  // slide stop only takes an empty tile or a costlier stop.
  const arrive = (col, row, entry, goesOn) => {
    const key = `${col},${row}`;
    const existing = reachable.get(key);
    if (goesOn) {
      if (existing && !existing.slideStop && existing.cost <= entry.cost) return;
      reachable.set(key, entry);
      queue.push(entry.cost, { col, row, cost: entry.cost });
      return;
    }
    if (existing && (!existing.slideStop || existing.cost <= entry.cost)) return;
    reachable.set(key, { ...entry, slideStop: true });
  };

  while (queue.size > 0) {
    // Cheapest first, ties in arrival order (InsertionOrderedHeap).
    const current = queue.pop();
    const currentKey = `${current.col},${current.row}`;
    // A tile reached again more cheaply was expanded from that arrival.
    if ((reachable.get(currentKey)?.cost ?? Infinity) < current.cost) continue;

    for (const { dc, dr } of DIRECTIONS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (nc < 0 || nc >= grid.cols || nr < 0 || nr >= grid.rows) continue;

      const moveCost = grid.getMoveCost(nc, nr, moveType, costModifier);
      if (moveCost === Infinity) continue;

      // Check unit occupancy for walk-through
      const key = `${nc},${nr}`;
      if (unitPositions) {
        const occupant = unitPositions.get(key);
        if (occupant) {
          if (
            occupant.faction !== moverFaction &&
            !(pass && passesThrough(occupant, moverFaction))
          ) {
            // Enemy on tile — can't move through (unless the mover has Pass)
            continue;
          }
          // Ally on tile (or a foe a Pass unit walks through) — can traverse but mark as
          // occupied (filter below)
        }
      }

      const newCost = current.cost + moveCost;
      if (newCost > mov) continue;

      // Ice slide handling: when stepping onto Ice, resolve the slide and price it
      const neighborTerrain = grid.getTerrainAt(nc, nr);
      if (neighborTerrain?.name === 'Ice' && moveType !== 'Flying') {
        // If an ally (or other unit) occupies the ice entry tile, treat as normal
        // passable tile — can't initiate a slide from an occupied tile.
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
        // Fall through to normal tile handling below
      }

      arrive(nc, nr, { cost: newCost, parent: currentKey }, true);
    }
  }

  // Mark ally-occupied tiles (and, with Pass, foe-occupied ones) as non-stoppable (can
  // pass through but not stop on). We keep them in the map so parent chains stay intact
  // for path reconstruction.
  if (unitPositions && moverFaction) {
    for (const [key, entry] of reachable) {
      if (key === `${startCol},${startRow}`) continue; // own tile is fine
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

/**
 * Reconstruct a path from Dijkstra reachable data, inserting slide segments.
 * This is the primary path-building method for any tile in the movement range. A goal
 * where a slide was cut short by the allowance is marked `slideStop` on the path's
 * last tile, so computeEffectivePath stops the slide there.
 * @param {Map} reachable - from computeMovementRange()
 * @param {number} startCol
 * @param {number} startRow
 * @param {number} goalCol
 * @param {number} goalRow
 * @returns {Array<{col, row, slideStop?}>|null} - path from start to goal, or null if not in reachable
 */
export function reconstructRangePath(reachable, startCol, startRow, goalCol, goalRow) {
  const goalKey = `${goalCol},${goalRow}`;
  if (!reachable.has(goalKey)) return null;

  // Walk parent chain from goal to start
  const chain = [];
  let key = goalKey;
  while (key) {
    const entry = reachable.get(key);
    if (!entry) break;
    chain.unshift({ key, entry });
    key = entry.parent;
  }

  // Build path, inserting slide segments where present
  const path = [];
  for (const { key: nodeKey, entry } of chain) {
    const [c, r] = nodeKey.split(',').map(Number);
    if (entry.slidePath && entry.slidePath.length > 1) {
      // Insert all slide tiles (slidePath includes the entry ice tile through landing)
      for (const step of entry.slidePath) {
        // Avoid duplicating the tile that's already the last in path
        if (path.length > 0) {
          const last = path[path.length - 1];
          if (last.col === step.col && last.row === step.row) continue;
        }
        path.push({ col: step.col, row: step.row });
      }
    } else {
      // Normal walk step
      if (path.length > 0) {
        const last = path[path.length - 1];
        if (last.col === c && last.row === r) continue;
      }
      path.push({ col: c, row: r });
    }
  }

  if (path.length < 2) return null;
  if (reachable.get(goalKey)?.slideStop) path[path.length - 1].slideStop = true;
  return path;
}

/**
 * A* from (startCol,startRow) to (goalCol,goalRow). Shared by the scene's Grid and the
 * headless harness's grid (anything with cols, rows and getMoveCost, whose cost is
 * Infinity off an integer tile), so the two never drift. Enemy-occupied tiles block,
 * allies' tiles do not; with `options.pass` (Pass) a foe's tile is walked through too
 * (computeMovementRange's rule).
 *
 * The path is exactly the one the former sorted-array search returned, ties included
 * (tests/GridPathfindingIdentity.test.js runs the two side by side):
 * - the open set pops the lowest f and, among equal f, the earliest pushed entry
 *   (InsertionOrderedHeap), the order the stable sort + shift() popped in;
 * - an entry whose tile has since been reached more cheaply is skipped. The cheaper entry
 *   has the lower f (same tile, same h), so it was popped and expanded first, and every
 *   neighbour already holds a g at least that low: expanding the stale entry could never
 *   lower a g, set a parent or push, which is all the old search did with it;
 * - a goal the search can never push (off the board, impassable for the move type, or
 *   held by a unit that blocks the mover) returns null at once instead of flooding the
 *   map first. Only the start is matched without a push, so start = goal still returns
 *   [start].
 * @returns {Array<{col, row}>|null} start to goal, or null when unreachable
 */
export function computePath(
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
) {
  const pass = options?.pass === true;
  const cols = grid.cols;
  const rows = grid.rows;
  const heuristic = (c, r) => Math.abs(c - goalCol) + Math.abs(r - goalRow);
  // Enemy-occupied tiles block (the mover passes through allies, and through foes with Pass).
  const blocks = (col, row) => {
    if (!unitPositions) return false;
    const occupant = unitPositions.get(`${col},${row}`);
    return Boolean(
      occupant &&
      occupant.faction !== moverFaction &&
      !(pass && passesThrough(occupant, moverFaction)),
    );
  };

  if (
    !(startCol === goalCol && startRow === goalRow) &&
    Number.isInteger(goalCol) &&
    Number.isInteger(goalRow) &&
    (goalCol < 0 ||
      goalCol >= cols ||
      goalRow < 0 ||
      goalRow >= rows ||
      grid.getMoveCost(goalCol, goalRow, moveType, costModifier) === Infinity ||
      blocks(goalCol, goalRow))
  ) {
    return null;
  }

  // Tiles are indexed row * cols + col; the start gets the spare last slot when it is not a
  // tile of the board (only neighbours that pass the bounds check are ever indexed).
  const tileCount = cols * rows;
  const startOnBoard =
    Number.isInteger(startCol) &&
    Number.isInteger(startRow) &&
    startCol >= 0 &&
    startCol < cols &&
    startRow >= 0 &&
    startRow < rows;
  const startIndex = startOnBoard ? startRow * cols + startCol : tileCount;
  const gScore = new Float64Array(tileCount + 1);
  // The tile each tile was best reached from; -1 = not reached yet, the start is its own.
  const cameFrom = new Int32Array(tileCount + 1).fill(-1);
  cameFrom[startIndex] = startIndex;

  const openSet = new InsertionOrderedHeap();
  openSet.push(heuristic(startCol, startRow), {
    index: startIndex,
    col: startCol,
    row: startRow,
    g: 0,
  });

  while (openSet.size > 0) {
    const current = openSet.pop();
    if (current.g > gScore[current.index]) continue; // reached more cheaply since

    if (current.col === goalCol && current.row === goalRow) {
      const path = [];
      for (let index = current.index; ; index = cameFrom[index]) {
        if (index === tileCount) {
          // `+ 0` keeps the old string key round trip's coordinates (-0 read back as 0).
          path.unshift({ col: startCol + 0, row: startRow + 0 });
        } else {
          const col = index % cols;
          path.unshift({ col, row: (index - col) / cols });
        }
        if (index === startIndex) return path;
      }
    }

    for (const { dc, dr } of DIRECTIONS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;

      const moveCost = grid.getMoveCost(nc, nr, moveType, costModifier);
      if (moveCost === Infinity) continue;
      if (blocks(nc, nr)) continue;

      const index = nr * cols + nc;
      const tentativeG = current.g + moveCost;
      if (cameFrom[index] === -1 || tentativeG < gScore[index]) {
        cameFrom[index] = current.index;
        gScore[index] = tentativeG;
        openSet.push(tentativeG + heuristic(nc, nr), { index, col: nc, row: nr, g: tentativeG });
      }
    }
  }

  return null;
}

export class Grid {
  constructor(
    scene,
    cols,
    rows,
    terrainData,
    mapLayout,
    fogEnabled = false,
    biome = null,
    presentation = null,
  ) {
    this.scene = scene;
    this.cols = cols;
    this.rows = rows;
    // Presentation only: how the board is drawn (portrait play turns it a quarter).
    // Every game rule keeps using (col, row); only pixel conversion goes through it.
    this.board = createBoardTransform(cols, rows, presentation?.rotation);
    this.terrainData = terrainData;
    this.mapLayout = mapLayout; // 2D array of terrain indices
    this.biome = biome;
    this.tiles = [];
    this.highlightTiles = [];
    this.pathTiles = [];
    this.attackHighlightTiles = [];
    this.temporaryTerrains = [];
    // Presentation hooks: bumped/notified whenever a cell's terrain is rebuilt so
    // painted terrain, night light and cached threat answers can follow. Never
    // read by game rules.
    this.terrainRevision = 0;
    this._terrainListeners = new Set();

    // Fog of war
    this.fogEnabled = fogEnabled;
    this.fogOverlays = [];
    this.visibleSet = new Set(); // currently visible "col,row"
    this.everSeenSet = new Set(); // ever revealed "col,row"
    // Tiles a move ran into this player phase ("col,row"): the hidden unit that stopped it
    // stays shown even when it stands past every unit's vision (revealContact).
    this.contactSet = new Set();

    // Center the grid on the canvas
    const mapWidth = this.mapPixelWidth;
    const mapHeight = this.mapPixelHeight;
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
    const { x, y } = this.gridToPixel(col, row);
    return createBattleTerrain(
      this.scene,
      this.terrainData[this.mapLayout[row][col]]?.name,
      x,
      y,
      this.biome,
    );
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
    safeBattlePresentation('terrain tile', () => this._rerenderTile(col, row), {
      scene: this.scene,
    });
    this.terrainRevision = (this.terrainRevision || 0) + 1;
    for (const listener of this._terrainListeners || []) {
      try {
        listener(col, row);
      } catch (err) {
        console.warn('[Grid] terrain listener failed:', err?.message || err);
      }
    }
    return true;
  }

  /** Presentation-only: observe terrain cell changes. Returns an unsubscribe. */
  addTerrainListener(listener) {
    if (typeof listener !== 'function') return () => {};
    this._terrainListeners ||= new Set();
    this._terrainListeners.add(listener);
    return () => this._terrainListeners.delete(listener);
  }

  setTemporaryTerrain(col, row, terrainName, duration = 1, sourceUnit = null) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const terrainIndex = this.terrainData.findIndex((t) => t?.name === terrainName);
    if (terrainIndex < 0) return false;
    const key = `${col},${row}`;
    const existing = this.temporaryTerrains.find((t) => t.key === key);
    if (existing) {
      existing.remainingTurns = Math.max(existing.remainingTurns, Math.max(1, duration | 0));
      // Transfer ownership to the new caller on refresh
      if (sourceUnit) existing.sourceUnit = sourceUnit;
      return this.setTerrainAt(col, row, terrainIndex);
    }
    this.temporaryTerrains.push({
      key,
      col,
      row,
      originalIndex: this.mapLayout[row][col],
      temporaryIndex: terrainIndex,
      remainingTurns: Math.max(1, duration | 0),
      sourceUnit: sourceUnit || null,
    });
    return this.setTerrainAt(col, row, terrainIndex);
  }

  clearTemporaryTerrainAt(col, row) {
    const key = `${col},${row}`;
    const idx = this.temporaryTerrains.findIndex((t) => t.key === key);
    if (idx < 0) return false;
    const entry = this.temporaryTerrains.splice(idx, 1)[0];
    return this.setTerrainAt(entry.col, entry.row, entry.originalIndex);
  }

  clearTemporaryTerrainsBySource(sourceUnit) {
    if (!sourceUnit) return 0;
    const toRemove = this.temporaryTerrains.filter((t) => t.sourceUnit === sourceUnit);
    for (const entry of toRemove) {
      this.clearTemporaryTerrainAt(entry.col, entry.row);
    }
    return toRemove.length;
  }

  isTemporaryTerrainAt(col, row, terrainIndex = null) {
    const key = `${col},${row}`;
    const entry = this.temporaryTerrains.find((t) => t.key === key);
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

  /** Drawn board width in world pixels (swaps with height on a rotated board). */
  get mapPixelWidth() {
    return this.board.displayCols * TILE_SIZE;
  }

  get mapPixelHeight() {
    return this.board.displayRows * TILE_SIZE;
  }

  /** The cell a grid position is drawn in. */
  displayCellOf(col, row) {
    return this.board.toDisplay(col, row);
  }

  /**
   * Whether a tile is drawn within `margin` cells of the board's right edge, for
   * placing menus beside a unit on whichever side has room.
   */
  isNearDisplayRightEdge(col, row, margin = 3) {
    return this.board.toDisplay(col, row).col >= this.board.displayCols - margin;
  }

  // Convert pixel position to grid coordinates
  pixelToGrid(px, py) {
    const dc = Math.floor((px - this.offsetX) / TILE_SIZE);
    const dr = Math.floor((py - this.offsetY) / TILE_SIZE);
    if (dc < 0 || dc >= this.board.displayCols || dr < 0 || dr >= this.board.displayRows)
      return null;
    return this.board.fromDisplay(dc, dr);
  }

  // Convert grid coordinates to pixel center of tile
  gridToPixel(col, row) {
    const cell = this.board.toDisplay(col, row);
    return {
      x: this.offsetX + cell.col * TILE_SIZE + TILE_SIZE / 2,
      y: this.offsetY + cell.row * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  getTerrainAt(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.terrainData[this.mapLayout[row][col]];
  }

  getMoveCost(col, row, moveType, costModifier = 0) {
    const terrain = this.getTerrainAt(col, row);
    if (!terrain) return Infinity;
    const cost = terrain.moveCost[moveType];
    if (cost === '--') return Infinity;
    const baseCost = parseInt(cost, 10);
    return costModifier ? Math.max(1, baseCost - costModifier) : baseCost;
  }

  /**
   * Dijkstra flood-fill: all tiles reachable within `mov` movement points, ice slides
   * priced (computeMovementRange).
   * @returns {Map} "col,row" -> { cost, parent, slidePath?, slideStop?, stoppable? }
   */
  getMovementRange(
    startCol,
    startRow,
    mov,
    moveType,
    unitPositions = null,
    moverFaction = null,
    costModifier = 0,
    options = null,
  ) {
    return computeMovementRange(
      this,
      startCol,
      startRow,
      mov,
      moveType,
      unitPositions,
      moverFaction,
      costModifier,
      options,
    );
  }

  /** A path to a tile of a movement range, slides included (reconstructRangePath). */
  reconstructIcePath(reachable, startCol, startRow, goalCol, goalRow) {
    return reconstructRangePath(reachable, startCol, startRow, goalCol, goalRow);
  }

  // A* pathfinding from (startCol,startRow) to (goalCol,goalRow): computePath, shared with
  // the headless grid. Returns array of {col, row} from start to goal, or null if unreachable.
  findPath(
    startCol,
    startRow,
    goalCol,
    goalRow,
    moveType,
    unitPositions = null,
    moverFaction = null,
    costModifier = 0,
    options = null,
  ) {
    return computePath(
      this,
      startCol,
      startRow,
      goalCol,
      goalRow,
      moveType,
      unitPositions,
      moverFaction,
      costModifier,
      options,
    );
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

  // Display blue movement range overlay (skip unit's own tile and non-stoppable tiles)
  showMovementRange(reachable, unitCol, unitRow, color = 0x3366cc, alpha = 0.4) {
    this.clearHighlights();
    for (const [key, entry] of reachable) {
      if (key === `${unitCol},${unitRow}`) continue;
      if (entry.stoppable === false) continue;
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
      const highlight = this.scene.add.rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, 0x33cc66, 0.4);
      highlight.setDepth(5);
      this.attackHighlightTiles.push(highlight);
    }
  }

  // Display red attack range overlay
  showAttackRange(tiles, color = ATTACK_RANGE_COLOR, alpha = ATTACK_RANGE_ALPHA) {
    this.clearAttackHighlights();
    for (const { col, row } of tiles) {
      const { x, y } = this.gridToPixel(col, row);
      const highlight = this.scene.add.rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, color, alpha);
      highlight.setDepth(5);
      this.attackHighlightTiles.push(highlight);
    }
  }

  /**
   * Warp/Rescue, second step: the chosen ally shimmers in a gold outline and its
   * landing tiles show as gold squares. Shares attackHighlightTiles, so every
   * clearAttackHighlights (cancel, commit, turn end) removes it.
   */
  // Colours come from the caller (the UI palette): the engine runs headless in Node too.
  showRelocateGuide(
    ally,
    tiles,
    { reduceMotion = false, fill = ATTACK_RANGE_COLOR, edge = ATTACK_RANGE_COLOR } = {},
  ) {
    this.clearAttackHighlights();
    for (const { col, row } of tiles) {
      const { x, y } = this.gridToPixel(col, row);
      const square = this.scene.add
        .rectangle(x, y, TILE_SIZE - 3, TILE_SIZE - 3, fill, 0.35)
        .setStrokeStyle(2, edge, 0.95)
        .setDepth(5);
      this.attackHighlightTiles.push(square);
    }
    if (!ally) return;
    const { x, y } = this.gridToPixel(ally.col, ally.row);
    // Above the unit graphic (depth 10), so the outline reads over the sprite.
    const outline = this.scene.add
      .rectangle(x, y, TILE_SIZE - 2, TILE_SIZE - 2)
      .setStrokeStyle(3, edge, 1)
      .setDepth(11);
    outline._relocateAlly = true;
    this.attackHighlightTiles.push(outline);
    if (!reduceMotion && typeof this.scene.tweens?.add === 'function') {
      this.scene.tweens.add({
        targets: outline,
        alpha: 0.5,
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  clearAttackHighlights() {
    this.attackHighlightTiles.forEach((h) => {
      this.scene.tweens?.killTweensOf?.(h);
      h.destroy();
    });
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
    this.pathTiles.forEach((p) => p.destroy());
    this.pathTiles = [];
  }

  clearHighlights() {
    this.highlightTiles.forEach((h) => h.destroy());
    this.highlightTiles = [];
    this.clearPath();
  }

  // --- Fog of War ---

  initFogOverlays() {
    for (let row = 0; row < this.rows; row++) {
      this.fogOverlays[row] = [];
      for (let col = 0; col < this.cols; col++) {
        const { x, y } = this.gridToPixel(col, row);
        const fog = this.scene.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, 0x000000, 0.7).setDepth(3);
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

    // Calculate vision union, plus the tiles a move ran into this phase
    const newVisible = new Set(this.contactSet || []);
    for (const unit of playerUnits) {
      const range = VISION_RANGES[unit.moveType] || 3;
      const tiles = this.getVisionRange(unit.col, unit.row, range);
      for (const key of tiles) newVisible.add(key);
    }

    this.visibleSet = newVisible;
    for (const key of newVisible) this.everSeenSet.add(key);
    paintFogOverlays(this);
  }

  /**
   * A committed move ran into a unit the fog hid (FogAmbush): its tiles stay shown for the
   * rest of the player phase, whatever the movers' vision, so the unit that stopped the move
   * can be inspected and planned around even when the cut left the mover far from it. Takes
   * effect at the next fog update (the action's settled vision). Cleared when the enemy
   * phase starts (clearContacts); saved with the fog (gridFogState).
   */
  revealContact(tiles) {
    if (!this.fogEnabled) return;
    if (!(this.contactSet instanceof Set)) this.contactSet = new Set();
    for (const t of tiles || []) {
      if (t.col >= 0 && t.col < this.cols && t.row >= 0 && t.row < this.rows)
        this.contactSet.add(`${t.col},${t.row}`);
    }
  }

  /** Forget this phase's contacts. True when there were any (the fog needs an update). */
  clearContacts() {
    const had = (this.contactSet?.size ?? 0) > 0;
    this.contactSet = new Set();
    return had;
  }

  /** Snapshot fog state for undo support. */
  snapshotFogState() {
    if (!this.fogEnabled) return null;
    return new Set(this.everSeenSet);
  }

  /** Restore fog state from a previous snapshot. */
  restoreFogState(snapshot) {
    if (!this.fogEnabled || !snapshot) return;
    this.everSeenSet = new Set(snapshot);
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
