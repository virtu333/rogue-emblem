// tapSnap — a little forgiveness for a finger that lands just off a unit (pure).
//
// A tile is 32 world pixels, about 20 CSS pixels on an upright phone at the default zoom:
// small for a fingertip. When a tap lands on a cell with no unit but within `margin` world
// pixels of exactly one neighbouring cell that holds a unit the caller would select, the
// tap is read as a tap on that cell. Only selection uses it (InputController, PLAYER_IDLE):
// a move destination, a target or a placement keeps the exact cell, so a snap can never
// move a unit or start an attack. Ambiguity snaps nothing: if any other neighbour inside
// the margin holds a unit (any side), the tap stays where it landed.
//
// Works in display cells (the board as drawn: portrait turns it), so "neighbour" and
// "edge" are what the player sees.

/** How far past a cell's edge a tap still snaps, in CSS pixels. */
export const TAP_SNAP_CSS_PX = 5;

/**
 * @param {object} a
 * @param {number} a.px, a.py      the tap in world pixels
 * @param {number} a.offsetX, a.offsetY, a.tileSize
 * @param {number} a.displayCols, a.displayRows
 * @param {number} a.margin        snap reach in world pixels
 * @param {(dc:number, dr:number) => 'target'|'other'|null} a.cellAt
 *        'target' a unit the tap would select, 'other' any other unit, null an empty cell
 * @returns {{ dc:number, dr:number } | null}  the display cell to read the tap as, or null
 */
export function snapTapToUnitCell({
  px,
  py,
  offsetX,
  offsetY,
  tileSize,
  displayCols,
  displayRows,
  margin,
  cellAt,
}) {
  if (!(margin > 0) || !(tileSize > 0)) return null;
  const lx = px - offsetX;
  const ly = py - offsetY;
  const dc = Math.floor(lx / tileSize);
  const dr = Math.floor(ly / tileSize);
  if (dc < 0 || dc >= displayCols || dr < 0 || dr >= displayRows) return null;
  if (cellAt(dc, dr) !== null) return null; // landed on a unit: nothing to forgive
  const fx = lx - dc * tileSize; // position inside the cell
  const fy = ly - dr * tileSize;
  const near = [];
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      if (sx === 0 && sy === 0) continue;
      const nc = dc + sx;
      const nr = dr + sy;
      if (nc < 0 || nc >= displayCols || nr < 0 || nr >= displayRows) continue;
      // Distance from the tap to the neighbour cell's nearest edge or corner.
      const gx = sx < 0 ? fx : sx > 0 ? tileSize - fx : 0;
      const gy = sy < 0 ? fy : sy > 0 ? tileSize - fy : 0;
      if (Math.hypot(gx, gy) > margin) continue;
      const kind = cellAt(nc, nr);
      if (kind) near.push({ dc: nc, dr: nr, kind });
    }
  }
  if (near.length !== 1 || near[0].kind !== 'target') return null;
  return { dc: near[0].dc, dr: near[0].dr };
}
