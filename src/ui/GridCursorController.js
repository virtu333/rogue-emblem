import { TILE_SIZE } from '../utils/constants.js';

// Keep the cursor this many world-units inside the viewport edge before panning.
const FOLLOW_MARGIN = TILE_SIZE * 1.5;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Tile-snapping gamepad/keyboard cursor for the battle grid.
 *
 * It owns a logical {col,row} cursor and drives the SAME selection path the mouse
 * uses: a confirm converts the tile's world center to a *screen* point and calls
 * `scene.onClick(null, screenPoint)`. `onClick` interprets `clickPos` as screen
 * space (it runs `_screenToWorld` then `grid.pixelToGrid`), so the world→screen
 * step is mandatory — passing world coordinates would double-transform under any
 * camera scroll/zoom. No selection logic is duplicated here.
 *
 * Cancel (B) and the action-menu focus are handled by BattleScene's action-bus
 * routing, not by this controller — this stays a pure cursor.
 */
export class GridCursorController {
  constructor(scene) {
    this.scene = scene;
    this.cursorCol = 0;
    this.cursorRow = 0;
    this.active = false;
  }

  destroy() {
    this.scene = null;
  }

  _cols() {
    return this.scene?.grid?.cols ?? 0;
  }

  _rows() {
    return this.scene?.grid?.rows ?? 0;
  }

  /** Move the cursor by a delta of {-1,0,1} per axis, clamped to the grid. */
  move(dx = 0, dy = 0) {
    const cols = this._cols();
    const rows = this._rows();
    if (cols <= 0 || rows <= 0) return;
    this.active = true;
    this.cursorCol = clamp(this.cursorCol + dx, 0, cols - 1);
    this.cursorRow = clamp(this.cursorRow + dy, 0, rows - 1);
    this._render();
  }

  /** Jump the cursor to a specific tile (e.g. onto a freshly selected unit/target). */
  snapTo(col, row) {
    const cols = this._cols();
    const rows = this._rows();
    if (cols <= 0 || rows <= 0) return;
    this.active = true;
    this.cursorCol = clamp(Math.round(col), 0, cols - 1);
    this.cursorRow = clamp(Math.round(row), 0, rows - 1);
    this._render();
  }

  /** Confirm at the cursor — equivalent to a mouse click on the cursor's tile. */
  confirm() {
    const scene = this.scene;
    if (!scene?.grid) return;
    const world = scene.grid.gridToPixel(this.cursorCol, this.cursorRow);
    if (!world) return;
    const screen = scene._worldToScreen(world.x, world.y);
    if (!screen) return;
    // Same seam the mouse uses: null pointer + a screen-space clickPos override.
    scene.onClick(null, { x: screen.x, y: screen.y });
  }

  hide() {
    this.active = false;
    if (this.scene?.cursorHighlight?.setVisible) this.scene.cursorHighlight.setVisible(false);
  }

  // Position the shared highlight on the cursor tile and pan the camera so the
  // cursor never slips off-screen.
  _render() {
    const scene = this.scene;
    if (!scene?.grid) return;
    const { x, y } = scene.grid.gridToPixel(this.cursorCol, this.cursorRow);
    if (scene.cursorHighlight?.setPosition) {
      scene.cursorHighlight.setPosition(x, y).setVisible(true);
    }
    if (scene._battleCamera?.ensureWorldVisible) {
      scene._battleCamera.ensureWorldVisible(x, y, FOLLOW_MARGIN);
    }
    // Notify the scene so cursor-anchored UI (terrain/unit info panel, movement
    // path preview) refreshes — the gamepad analogue of a mouse-hover update.
    scene._onGridCursorMoved?.(this.cursorCol, this.cursorRow);
  }
}
