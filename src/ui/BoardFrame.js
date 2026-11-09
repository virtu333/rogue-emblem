// BoardFrame.js — seats the battlefield in its surroundings (presentation only).
//
// The map used to end in a hard cut against the scene's flat background. The frame
// gives it an edge: outside, the ground thins out into the dark in a dithered skirt and
// a thin ink-and-ember border runs round the board with a diamond at each corner (the
// menus' own ornament); inside, a narrow shade along the border sets the map down into
// its frame. Shapes come from boardFrameModel.js. Drawn once per grid; static.

import { TILE_SIZE } from '../utils/constants.js';
import { planBoardFrame, FRAME_COLORS } from './boardFrameModel.js';

// The skirt and border sit under the tiles; the inner shade sits over the tiles and the
// liquid shimmer (0.5) but under the fog (3), the ranges (5) and the units.
const OUTER_DEPTH = -1;
const INNER_DEPTH = 0.7;

/** The board's rectangle in world pixels, as drawn (a portrait board is turned). */
export function boardRect(grid) {
  const corners = [
    grid.gridToPixel(0, 0),
    grid.gridToPixel(grid.cols - 1, 0),
    grid.gridToPixel(0, grid.rows - 1),
    grid.gridToPixel(grid.cols - 1, grid.rows - 1),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const half = TILE_SIZE / 2;
  const x = Math.min(...xs) - half;
  const y = Math.min(...ys) - half;
  return { x, y, width: Math.max(...xs) + half - x, height: Math.max(...ys) + half - y };
}

export class BoardFrame {
  constructor(scene, grid) {
    this.scene = scene;
    this.grid = grid;
    this.objects = [];
  }

  create() {
    const { scene, grid } = this;
    try {
      const plan = planBoardFrame(boardRect(grid));
      const outer = scene.add.graphics().setDepth(OUTER_DEPTH);
      const inner = scene.add.graphics().setDepth(INNER_DEPTH);
      this.objects.push(outer, inner);
      const draw = (g, list) => {
        for (const [x, y, w, h, color, alpha] of list) {
          g.fillStyle(FRAME_COLORS[color], alpha);
          g.fillRect(x, y, w, h);
        }
      };
      draw(outer, plan.skirt);
      draw(outer, plan.border);
      draw(inner, plan.shade);
      draw(inner, plan.corners);
    } catch (error) {
      this.destroy();
      console.warn('[BoardFrame]', error?.message || error);
    }
    return this;
  }

  destroy() {
    for (const o of this.objects) if (o?.scene) o.destroy();
    this.objects = [];
  }
}

/** Frame a battle's board (the grid keeps it; a new grid gets a new one). */
export function attachBoardFrame(scene, grid) {
  if (!scene?.add?.graphics || typeof grid?.gridToPixel !== 'function') return null;
  grid.boardFrame?.destroy?.();
  grid.boardFrame = new BoardFrame(scene, grid).create();
  return grid.boardFrame;
}
