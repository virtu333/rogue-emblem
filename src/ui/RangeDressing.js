// RangeDressing.js — draws the grid's range overlays and walk preview as designed shapes.
//
// Grid still owns which tiles are lit (its highlight rectangles keep their positions and
// counts, which tests and controllers read); this takes the drawing over. Each layer
// (the move range, the attack / heal / ability range) becomes one region: a wash, a
// soft band inside its border, a bright rim over a dark under-stroke, faint seams
// between tiles. The walk preview becomes a gold thread with a barbed head; an Ice slide
// is its dashed tail. Shapes come from rangeDressingModel.js.
//
// Presentation only: no game state, no RNG. The rim breathes unless Reduce motion is
// on. If drawing fails, the grid's own flat rectangles show instead.

import { TILE_SIZE } from '../utils/constants.js';
import {
  RANGE_STYLE,
  PATH_STYLE,
  planRange,
  planPath,
  dashSegments,
  lighten,
} from './rangeDressingModel.js';

// Above the tiles and the grid's own rectangles (5), below the danger zone's edge (5.4)
// and the path dots' old depth (6).
const FILL_DEPTH = 5;
const RIM_DEPTH = 5.2;
const PATH_DEPTH = 6;

function reducedMotion(scene) {
  try {
    return Boolean(scene?.registry?.get?.('settings')?.getReduceMotion?.());
  } catch {
    return false;
  }
}

export class RangeDressing {
  constructor(scene) {
    this.scene = scene;
    this.layers = new Map(); // layer id -> { fill, rim, tween }
  }

  /**
   * Take over the drawing of a layer's highlight rectangles.
   * @param {'move'|'attack'} layer
   * @param {object[]} rects the grid's rectangles (read for position, then hidden)
   * @param {{ color:number, quiet?: {x:number,y:number}[] }} look `quiet`: tile centres that
   *   belong to the region but cannot be stopped on (thin wash, no rim round them)
   * @returns {boolean} false when nothing was drawn (the rectangles stay as they are)
   */
  dress(layer, rects, { color, quiet = [] } = {}) {
    this.clear(layer);
    const scene = this.scene;
    const tiles = (rects || []).filter((r) => r && !r._relocateAlly);
    if (!scene?.add?.graphics || !tiles.length) return false;
    try {
      // An attack fringe drawn beside a move range shares that range's border.
      const beside = layer === 'attack' ? this.layers.get('move')?.tiles || [] : [];
      const plan = planRange(tiles, TILE_SIZE, RANGE_STYLE, { quiet, beside });
      const fill = scene.add.graphics().setDepth(FILL_DEPTH);
      const rim = scene.add.graphics().setDepth(RIM_DEPTH);
      const light = lighten(color, 0.5);
      const draw = (g, list, c, alpha) => {
        g.fillStyle(c, alpha);
        for (const [x, y, w, h] of list) g.fillRect(x, y, w, h);
      };
      draw(fill, plan.fills, lighten(color, 0.22), RANGE_STYLE.fillAlpha);
      draw(fill, plan.quiets, lighten(color, 0.22), RANGE_STYLE.quietAlpha);
      draw(fill, plan.seams, light, RANGE_STYLE.seamAlpha);
      draw(fill, plan.bands, light, RANGE_STYLE.bandAlpha);
      draw(rim, plan.unders, plan.ink, RANGE_STYLE.underAlpha);
      draw(rim, plan.rims, light, RANGE_STYLE.rimAlpha);
      for (const r of tiles) r.setAlpha?.(0);
      // The region washes in, then its rim breathes.
      const entry = { fill, rim, tween: null };
      if (!reducedMotion(scene) && typeof scene.tweens?.add === 'function') {
        fill.setAlpha(0);
        rim.setAlpha(0);
        entry.tween = scene.tweens.add({
          targets: [fill, rim],
          alpha: 1,
          duration: RANGE_STYLE.revealMs,
          ease: 'Quad.easeOut',
          onComplete: () => {
            if (this.layers.get(layer) !== entry) return;
            entry.tween = scene.tweens.add({
              targets: rim,
              alpha: RANGE_STYLE.breatheTo,
              duration: RANGE_STYLE.breatheMs,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut',
            });
          },
        });
      }
      const kept = [...tiles, ...quiet].map(({ x, y }) => ({ x, y }));
      entry.tiles = kept;
      this.layers.set(layer, entry);
      return true;
    } catch (error) {
      this.clear(layer);
      for (const r of tiles) r.setAlpha?.(1);
      console.warn('[RangeDressing]', error?.message || error);
      return false;
    }
  }

  clear(layer) {
    const entry = this.layers.get(layer);
    if (!entry) return;
    this.layers.delete(layer);
    entry.tween?.remove?.();
    entry.fill?.destroy?.();
    entry.rim?.destroy?.();
  }

  /**
   * The walk preview. `path` is grid steps with the unit's own tile first.
   * @returns {object|null} the Graphics drawn (the grid destroys it with its path), or null
   */
  drawPath(path, toPixel) {
    const scene = this.scene;
    if (!scene?.add?.graphics || !Array.isArray(path)) return null;
    try {
      const plan = planPath(path.map((step) => toPixel(step.col, step.row)));
      if (!plan) return null;
      const g = scene.add.graphics().setDepth(PATH_DEPTH);
      const layers = [
        [plan.ink, PATH_STYLE.ink, 0.85],
        [plan.body, PATH_STYLE.body, 1],
        [plan.shade, PATH_STYLE.shade, 1],
        [plan.core, PATH_STYLE.core, 1],
      ];
      for (const [rects, color, alpha] of layers) {
        g.fillStyle(color, alpha);
        for (const [x, y, w, h] of rects) g.fillRect(x, y, w, h);
      }
      return g;
    } catch (error) {
      console.warn('[RangeDressing]', error?.message || error);
      return null;
    }
  }

  /** An Ice slide: dashes over the tiles the unit is carried across. */
  drawSlide(slidePath, toPixel) {
    const scene = this.scene;
    if (!scene?.add?.graphics || !Array.isArray(slidePath) || !slidePath.length) return null;
    try {
      const points = slidePath.map((step) => toPixel(step.col, step.row));
      const g = scene.add.graphics().setDepth(PATH_DEPTH + 0.1);
      const { slide, ink, slideDash, slideGap } = PATH_STYLE;
      if (points.length === 1) {
        g.fillStyle(ink, 0.8);
        g.fillRect(points[0].x - 4, points[0].y - 4, 8, 8);
        g.fillStyle(slide, 0.95);
        g.fillRect(points[0].x - 3, points[0].y - 3, 6, 6);
        return g;
      }
      const dashes = dashSegments(points, slideDash, slideGap);
      g.lineStyle(5, ink, 0.8);
      for (const [x1, y1, x2, y2] of dashes) g.lineBetween(x1, y1, x2, y2);
      g.lineStyle(3, slide, 0.95);
      for (const [x1, y1, x2, y2] of dashes) g.lineBetween(x1, y1, x2, y2);
      return g;
    } catch (error) {
      console.warn('[RangeDressing]', error?.message || error);
      return null;
    }
  }

  destroy() {
    for (const layer of [...this.layers.keys()]) this.clear(layer);
    this.scene = null;
  }
}

/** Give a battle's grid its range dressing (the grid keeps it; a new grid gets a new one). */
export function attachRangeDressing(scene, grid) {
  if (!scene?.add?.graphics || !grid) return null;
  grid.rangeDressing?.destroy?.();
  grid.rangeDressing = new RangeDressing(scene);
  return grid.rangeDressing;
}
