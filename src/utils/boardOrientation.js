// Board presentation orientation — pure, no Phaser.
//
// A rotated board is a presentation of the same battle: grid coordinates, movement,
// combat, AI, saves and RNG never change. Only the mapping between a grid cell
// (col, row) and the cell it is drawn in (display col, display row) turns.
//
// Portrait play turns the board a quarter so the player's deployment side sits at
// the bottom of the phone and the advance runs upward:
//   'ccw' — the left edge (col 0) is drawn at the bottom; row 0 becomes the left edge.
//   'cw'  — the right edge is drawn at the bottom; row 0 becomes the right edge.
// Both are rotations, never mirrors, so the drawn map keeps its handedness.

export const BOARD_ROTATIONS = Object.freeze(['none', 'ccw', 'cw']);

export function normalizeRotation(rotation) {
  return BOARD_ROTATIONS.includes(rotation) ? rotation : 'none';
}

/**
 * The quarter turn that puts the player's side of the map at the bottom. Every map
 * template deploys players on one horizontal side; a map without player spawns keeps
 * the conventional left-side assumption.
 */
export function rotationForPlayerSide(playerSpawns, cols) {
  const spawns = Array.isArray(playerSpawns)
    ? playerSpawns.filter((s) => Number.isFinite(s?.col))
    : [];
  if (!spawns.length || !(cols > 0)) return 'ccw';
  const avg = spawns.reduce((sum, s) => sum + s.col, 0) / spawns.length;
  return avg > (cols - 1) / 2 ? 'cw' : 'ccw';
}

/**
 * @param {number} cols grid columns (game coordinates)
 * @param {number} rows grid rows (game coordinates)
 * @param {'none'|'ccw'|'cw'} rotation
 */
export function createBoardTransform(cols, rows, rotation = 'none') {
  const mode = normalizeRotation(rotation);
  const rotated = mode !== 'none';
  const displayCols = rotated ? rows : cols;
  const displayRows = rotated ? cols : rows;

  const toDisplay = (col, row) => {
    if (mode === 'ccw') return { col: row, row: cols - 1 - col };
    if (mode === 'cw') return { col: rows - 1 - row, row: col };
    return { col, row };
  };

  const fromDisplay = (col, row) => {
    if (mode === 'ccw') return { col: cols - 1 - row, row: col };
    if (mode === 'cw') return { col: row, row: rows - 1 - col };
    return { col, row };
  };

  // A step on screen (right = +x, down = +y) expressed as a grid step. Keyboard and
  // gamepad arrows move the cursor the way the board is drawn.
  const displayDeltaToGrid = (dx, dy) => {
    if (mode === 'ccw') return { dc: -dy, dr: dx };
    if (mode === 'cw') return { dc: dy, dr: -dx };
    return { dc: dx, dr: dy };
  };

  return Object.freeze({
    rotation: mode,
    rotated,
    cols,
    rows,
    displayCols,
    displayRows,
    toDisplay,
    fromDisplay,
    displayDeltaToGrid,
  });
}

/**
 * The edge of the drawn board a grid edge ('left' | 'right' | 'top' | 'bottom') appears
 * on. 'ccw' draws the left edge at the bottom and row 0 on the left; 'cw' draws the
 * right edge at the bottom and row 0 on the right.
 */
export function displayEdge(edge, rotation = 'none') {
  const mode = normalizeRotation(rotation);
  if (mode === 'ccw')
    return { left: 'bottom', right: 'top', top: 'left', bottom: 'right' }[edge] || edge;
  if (mode === 'cw')
    return { left: 'top', right: 'bottom', top: 'right', bottom: 'left' }[edge] || edge;
  return edge;
}

/**
 * Terrain layout re-indexed by display cell, for renderers whose art depends on the
 * drawn neighbors (shores, walls, bridges). Returns the original array when the board
 * is not rotated.
 */
export function displayLayout(mapLayout, transform) {
  if (!transform?.rotated) return mapLayout;
  const out = [];
  for (let dr = 0; dr < transform.displayRows; dr++) {
    const line = [];
    for (let dc = 0; dc < transform.displayCols; dc++) {
      const { col, row } = transform.fromDisplay(dc, dr);
      line.push(mapLayout[row]?.[col]);
    }
    out.push(line);
  }
  return out;
}

/**
 * Whether a menu drawn beside the tile at (col, row) has room on its right, measured
 * on the board as drawn. Grids without a presentation (older callers, test doubles)
 * use the historical column test.
 */
export function hasRoomRightOf(grid, col, row, margin = 3) {
  if (typeof grid?.isNearDisplayRightEdge === 'function')
    return !grid.isNearDisplayRightEdge(col, row, margin);
  return col < (grid?.cols ?? 0) - margin;
}

/**
 * The top-left display cell of a size x size footprint whose top-left grid cell is
 * (col, row). A turned footprint's corner moves, so it is the minimum over its corners.
 */
export function displayFootprint(transform, col, row, size = 1) {
  if (!transform?.rotated) return { col, row };
  const far = Math.max(1, size) - 1;
  const a = transform.toDisplay(col, row);
  const b = transform.toDisplay(col + far, row + far);
  return { col: Math.min(a.col, b.col), row: Math.min(a.row, b.row) };
}

/**
 * A battle-history frame ({cols, rows, tiles, units}) in display cells, so the
 * history board is drawn the way the battle was: tiles re-indexed row-major over the
 * display grid, units at their turned footprints. Unrotated boards and frames of
 * another size are returned as they are.
 */
export function displayHistoryFrame(frame, transform) {
  if (!frame || !transform?.rotated) return frame;
  if (frame.cols !== transform.cols || frame.rows !== transform.rows) return frame;
  const tiles = new Array(frame.tiles.length);
  for (const tile of frame.tiles) {
    const d = transform.toDisplay(tile.col, tile.row);
    tiles[d.row * transform.displayCols + d.col] = { ...tile, col: d.col, row: d.row };
  }
  const units = frame.units.map((u) => ({
    ...u,
    ...displayFootprint(transform, u.col, u.row, u.size || 1),
  }));
  return { ...frame, cols: transform.displayCols, rows: transform.displayRows, tiles, units };
}

/** History beats (positions and movement paths) in display cells; see displayHistoryFrame. */
export function displayHistoryBeats(beats, transform) {
  if (!Array.isArray(beats) || !transform?.rotated) return beats;
  const at = (p) => (p ? { ...p, ...displayFootprint(transform, p.col, p.row, p.size || 1) } : p);
  return beats.map((beat) => {
    const size = beat.actorPosition?.size || 1;
    return {
      ...beat,
      actorPosition: at(beat.actorPosition),
      targetPosition: at(beat.targetPosition),
      path: Array.isArray(beat.path)
        ? beat.path.map((p) =>
            p ? { ...p, ...displayFootprint(transform, p.col, p.row, size) } : p,
          )
        : beat.path,
    };
  });
}
