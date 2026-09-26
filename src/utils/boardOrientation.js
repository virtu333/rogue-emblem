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
