// Ice slides are priced (pure, no Phaser). Stepping onto Ice costs the tile, and the
// unit slides on in the direction it entered until it reaches a tile that is not Ice
// (slideAcrossIce, below). The first ICE_FREE_SLIDE_TILES tiles slid past the
// entry are free; each tile after that costs its move cost, and a slide whose next tile
// the unit can no longer pay for stops there, on the ice, and ends the move.
//
// Until 2026-10-06 every slide was free whatever its length, so a unit chained slides
// across a tundra map in one move (Infantry MOV 5 reached ~17 tiles on Glacier Run).
// The movement range (Grid.computeMovementRange), the committed path
// (computeEffectivePath) and the fog ambush's cost (FogAmbush.pathCostTo) all price a
// slide here, so the blue range, the preview, the move and Canto's remaining
// movement agree.
//
// A unit that another unit's action puts onto Ice slides too (traceForcedSlide below):
// the same slide, with no movement to pay for it. ForcedMovement.js is where Shove,
// Smite and the weapon-art pushes use it.

/** Tiles slid past the entry tile that cost nothing. */
export const ICE_FREE_SLIDE_TILES = 1;

/** True when the tile at this index of a slide path is free (the entry tile is paid as a step). */
export function isFreeSlideIndex(index) {
  return index >= 1 && index <= ICE_FREE_SLIDE_TILES;
}

/**
 * Where a slide stops when its tiles are paid for out of a movement allowance.
 * @param {{col:number,row:number}[]} slidePath - entry tile first, landing last (resolveIceSlide)
 * @param {number} entryCost - movement spent once the unit stands on the entry tile
 * @param {number} mov - the move's allowance
 * @param {(tile:{col:number,row:number}) => number} stepCost - a tile's move cost
 * @returns {{stopIndex:number, cost:number, complete:boolean}} the last slide index reached,
 *   the movement spent there, and whether the slide ran to its natural end (a slide cut
 *   short by the allowance ends the move).
 */
export function iceSlideStop(slidePath, entryCost, mov, stepCost) {
  const tiles = Array.isArray(slidePath) ? slidePath : [];
  let cost = entryCost;
  let stopIndex = 0;
  for (let i = 1; i < tiles.length; i++) {
    const step = isFreeSlideIndex(i) ? 0 : stepCost(tiles[i]);
    if (!Number.isFinite(step) || cost + step > mov) break;
    cost += step;
    stopIndex = i;
  }
  return { stopIndex, cost, complete: stopIndex >= tiles.length - 1 };
}

/** True for the Ice terrain record (terrain.json). */
export function isIceTerrain(terrain) {
  return terrain?.name === 'Ice';
}

/** The terrain at a tile of a layout, or null off the map. */
export function getTerrainAtLayout(mapLayout, terrainData, col, row, cols, rows) {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  const terrainIdx = mapLayout[row]?.[col];
  if (terrainIdx == null) return null;
  return terrainData[terrainIdx] || null;
}

/** True when the tile exists and the move type can stand on it (terrain.json cost is not '--'). */
export function isPassableForMoveType(mapLayout, terrainData, col, row, cols, rows, moveType) {
  const terrain = getTerrainAtLayout(mapLayout, terrainData, col, row, cols, rows);
  if (!terrain) return false;
  const moveCost = terrain.moveCost?.[moveType];
  if (moveCost === '--') return false;
  return Number.isFinite(parseInt(moveCost, 10));
}

/**
 * The one slide. A unit standing on an Ice tile it has just entered goes on, tile by
 * tile, in the direction it entered. It stops ON the last Ice tile when the next tile is
 * off the map, occupied or ground it cannot stand on; otherwise it slides onto the first
 * tile that is not Ice and stops there (whatever that tile is: it is entered like any
 * tile). Walking (resolveIceSlide) and forced moves (traceForcedSlide) both run it, so
 * what ends a slide is decided in this one place.
 *
 * @param {object} p
 * @param {number} p.col - the Ice tile the unit stands on
 * @param {number} p.row
 * @param {number} p.dc - the direction it was moving (one axis, one step)
 * @param {number} p.dr
 * @param {number} p.cols
 * @param {number} p.rows
 * @param {(col:number,row:number)=>object|null} p.terrainAt
 * @param {(col:number,row:number)=>boolean} p.passableAt - a tile the mover may stand on
 * @param {(col:number,row:number)=>any} p.occupiedAt - truthy when a unit holds the tile
 * @returns {{col:number,row:number,path:{col:number,row:number}[],
 *   stop:'edge'|'unit'|'terrain'|'off_ice', blocker:any}} path starts at the entry tile
 *   and ends at the landing; `stop` says what ended the slide (`off_ice`: it left the
 *   Ice; the others: it was held on the Ice), `blocker` is the occupant for `unit`.
 */
export function slideAcrossIce({
  col,
  row,
  dc,
  dr,
  cols,
  rows,
  terrainAt,
  passableAt,
  occupiedAt,
}) {
  const path = [{ col, row }];
  let currentCol = col;
  let currentRow = row;
  for (;;) {
    const nextCol = currentCol + dc;
    const nextRow = currentRow + dr;
    const held = (stop, blocker = null) => ({
      col: currentCol,
      row: currentRow,
      path,
      stop,
      blocker,
    });
    if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) return held('edge');
    const occupant = occupiedAt(nextCol, nextRow);
    if (occupant) return held('unit', occupant);
    if (!passableAt(nextCol, nextRow)) return held('terrain');
    path.push({ col: nextCol, row: nextRow });
    if (isIceTerrain(terrainAt(nextCol, nextRow))) {
      currentCol = nextCol;
      currentRow = nextRow;
      continue;
    }
    return { col: nextCol, row: nextRow, path, stop: 'off_ice', blocker: null };
  }
}

/**
 * Walking's slide, from a layout: the Ice tile the unit entered and the direction it
 * entered it in. (Grid.js re-exports it; computeEffectivePath and the movement range
 * price what it returns.)
 */
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
  const slide = slideAcrossIce({
    col,
    row,
    dc: entryDir.dc,
    dr: entryDir.dr,
    cols,
    rows,
    terrainAt: (c, r) => getTerrainAtLayout(mapLayout, terrainData, c, r, cols, rows),
    passableAt: (c, r) => isPassableForMoveType(mapLayout, terrainData, c, r, cols, rows, moveType),
    occupiedAt: (c, r) => occupiedTiles.has(`${c},${r}`),
  });
  return { col: slide.col, row: slide.row, slidePath: slide.path };
}

/** Move types that never slide (walking: Grid.computeEffectivePath and computeMovementRange). */
export function slidesOnIce(unit) {
  return Boolean(unit) && unit.moveType !== 'Flying';
}

/**
 * Forced slide: the rule for every forced displacement. A unit another unit's action
 * has just put on `from` (Shove, Smite, a weapon-art push or ram) slides on in the
 * direction it was pushed, exactly as it would have had it walked there: the same slide
 * (slideAcrossIce) with nothing to pay, because a forced slide has no movement budget.
 *   - `from` must be the Ice tile the push put the unit on; any other tile does nothing.
 *   - Fliers do not slide (as walking).
 *   - It stops ON the last Ice tile when the next tile is off the map, holds a unit
 *     (`occupantAt` truthy) or is ground the unit's move type cannot stand on; otherwise
 *     it ends ON the first tile that is not Ice, hazards included (the unit stands there
 *     as if it had walked, so the ground works on it at the end of its phase).
 *   - Only the push direction; never diagonal.
 *
 * Pure: it reads the grid and the occupant probe and moves nothing.
 * @param {object} unit - needs moveType
 * @param {{col:number,row:number}} from - the tile the unit stands on after the push
 * @param {{dc:number,dr:number}} direction - the push direction
 * @param {{cols:number,rows:number,getMoveCost:Function,getTerrainAt?:Function}} grid -
 *   a Grid, a HeadlessGrid or a post-combat world; with no getTerrainAt nothing is Ice
 * @param {(col:number,row:number)=>any} occupantAt - truthy for a tile a unit holds
 * @returns {{col:number,row:number,path:{col:number,row:number}[],slid:boolean,
 *   stop:null|'edge'|'unit'|'terrain'|'off_ice',blocker:any}} the landing, the tiles from
 *   `from` to it (`from` first), whether the unit moved on, and what ended the slide
 *   (null when there was no slide to run)
 */
export function traceForcedSlide(unit, from, direction, grid, occupantAt = () => null) {
  const stay = {
    col: from.col,
    row: from.row,
    path: [{ col: from.col, row: from.row }],
    slid: false,
    stop: null,
    blocker: null,
  };
  if (!slidesOnIce(unit) || !grid || !direction) return stay;
  const dc = Math.sign(direction.dc || 0);
  const dr = Math.sign(direction.dr || 0);
  // One axis only: a diagonal (or no) direction is no push this game makes.
  if ((dc === 0) === (dr === 0)) return stay;
  if (typeof grid.getTerrainAt !== 'function') return stay;
  if (!isIceTerrain(grid.getTerrainAt(from.col, from.row))) return stay;
  const slide = slideAcrossIce({
    col: from.col,
    row: from.row,
    dc,
    dr,
    cols: grid.cols,
    rows: grid.rows,
    terrainAt: (c, r) => grid.getTerrainAt(c, r),
    passableAt: (c, r) => Number.isFinite(grid.getMoveCost(c, r, unit.moveType)),
    occupiedAt: occupantAt,
  });
  return { ...slide, slid: slide.path.length > 1 };
}
