// DangerZoneOverlay.js — enemy threat drawn so it reads at a glance.
//
// Ink & Ember: the empire's threat is blood crimson, never gold. Three layers:
//   1. a translucent fill that steps with how many enemies reach the tile;
//   2. world-aligned diagonal hatching (single, denser, then cross-hatch at 3+),
//      so threat stays distinct from the flat blue/red move and attack ranges;
//   3. a crisp outer edge — a dark under-stroke and a bright crimson line —
//      drawn above the move/attack ranges so the zone's border survives every
//      terrain, act grade and night layer.
// Status-staff reach keeps its violet outline. Variants: 'global' (the Danger
// toggle), 'pinned' (per-enemy pins) and 'focus' (the one enemy being inspected).
// Presentation only: never reads RNG or game state beyond the tiles it is given.

import { TILE_SIZE } from '../utils/constants.js';
import { UI_HEX } from '../utils/uiStyles.js';

// Fill and hatch alpha by tier (index = tier: 0 status-only, 1, 2, 3+ enemies).
export const DANGER_FILL_ALPHA = Object.freeze([0, 0.2, 0.3, 0.4]);
export const DANGER_HATCH_ALPHA = Object.freeze([0, 0.6, 0.72, 0.8]);
const HATCH_SPACING = Object.freeze([0, 8, 5, 7]);

const BAKE_MARGIN = 4; // edge strokes overhang the map border by half their width
const NEAREST = 1; // Phaser.Textures.FilterMode.NEAREST (no Phaser import here)

export const DANGER_VARIANTS = Object.freeze({
  global: { fill: true, hatch: true, edgeWidth: 2, fillScale: 1 },
  pinned: { fill: true, hatch: false, edgeWidth: 2, fillScale: 1.2 },
  focus: { fill: true, hatch: false, edgeWidth: 3, fillScale: 1 },
});

/** 0 = status-only, 1, 2, 3 (three or more damage sources). */
export function dangerTier({ count = 1, damageThreat, statusThreat } = {}) {
  if (statusThreat && !damageThreat) return 0;
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 1) return 1;
  return n >= 3 ? 3 : 2;
}

/**
 * Outer boundary of a tile set, as unit-length edges in grid coordinates
 * ({x1,y1,x2,y2} with x/y in tile units). Interior shared edges are omitted.
 */
export function dangerEdges(tiles) {
  const keys = new Set(tiles.map(({ col, row }) => `${col},${row}`));
  const edges = [];
  for (const { col, row } of tiles) {
    if (!keys.has(`${col},${row - 1}`)) edges.push({ x1: col, y1: row, x2: col + 1, y2: row });
    if (!keys.has(`${col},${row + 1}`))
      edges.push({ x1: col, y1: row + 1, x2: col + 1, y2: row + 1 });
    if (!keys.has(`${col - 1},${row}`)) edges.push({ x1: col, y1: row, x2: col, y2: row + 1 });
    if (!keys.has(`${col + 1},${row}`))
      edges.push({ x1: col + 1, y1: row, x2: col + 1, y2: row + 1 });
  }
  return edges;
}

/**
 * Hatch segments clipped to one tile box (x0, y0, size) in world pixels. Lines
 * are aligned to the world (x + y = k·s), so stripes run on unbroken across
 * neighbouring tiles. Tier 3 adds the opposite diagonal (cross-hatch).
 */
export function hatchSegments(x0, y0, size, tier) {
  const spacing = HATCH_SPACING[tier] || 0;
  if (!spacing) return [];
  const out = [];
  // '/' family: x + y = k
  for (let k = Math.ceil((x0 + y0) / spacing) * spacing; k <= x0 + y0 + 2 * size; k += spacing) {
    const xa = Math.max(x0, k - (y0 + size));
    const xb = Math.min(x0 + size, k - y0);
    if (xb - xa > 0.5) out.push({ x1: xa, y1: k - xa, x2: xb, y2: k - xb });
  }
  if (tier >= 3) {
    // '\' family: y - x = k
    for (
      let k = Math.ceil((y0 - (x0 + size)) / spacing) * spacing;
      k <= y0 + size - x0;
      k += spacing
    ) {
      const xa = Math.max(x0, y0 - k);
      const xb = Math.min(x0 + size, y0 + size - k);
      if (xb - xa > 0.5) out.push({ x1: xa, y1: xa + k, x2: xb, y2: xb + k });
    }
  }
  return out;
}

export class DangerZoneOverlay {
  constructor(scene, grid, { color = UI_HEX.threatFill, depth = 4, variant = 'global' } = {}) {
    this.scene = scene;
    this.grid = grid;
    this.color = color;
    this.depth = depth;
    this.variant = DANGER_VARIANTS[variant] ? variant : 'global';
    this.style = DANGER_VARIANTS[this.variant];
    // Plain descriptors of what is drawn ({col,row,count,tier,fillAlpha}); tests and
    // the HUD read these instead of display objects.
    this.tiles = [];
    this.visible = false;
    this.fillLayer = null;
    this.edgeLayer = null;
  }

  _layers() {
    const scene = this.scene;
    const grid = this.grid;
    // Baked path: draw once into scratch Graphics, then into two render textures.
    // Phaser replays a Graphics command list every frame; thousands of hatch
    // lines would tax every frame (and phone batteries), a texture costs one quad.
    if (scene?.add?.renderTexture && scene?.make?.graphics && grid?.cols && grid?.rows) {
      if (!this.fillRT || this.fillRT.active === false) {
        const m = BAKE_MARGIN;
        const w = grid.cols * TILE_SIZE + m * 2;
        const h = grid.rows * TILE_SIZE + m * 2;
        const x = (grid.offsetX || 0) - m;
        const y = (grid.offsetY || 0) - m;
        this.bakeOrigin = { x, y };
        const layer = (depth) => {
          const rt = scene.add.renderTexture(x, y, w, h).setOrigin(0, 0).setDepth(depth);
          rt.texture?.setFilter?.(NEAREST);
          return rt;
        };
        this.fillRT = layer(this.depth);
        this.edgeRT = layer(Math.max(this.depth, 5) + 0.4);
        this.scratchFill = scene.make.graphics({ add: false });
        this.scratchEdge = scene.make.graphics({ add: false });
      }
      return { fill: this.scratchFill, edge: this.scratchEdge, baked: true };
    }
    const add = scene?.add;
    if (!add?.graphics) return null;
    if (!this.fillLayer || this.fillLayer.active === false) {
      this.fillLayer = add.graphics().setDepth(this.depth);
      // Edges sit above move/attack ranges (depth 5) and below path dots and units.
      this.edgeLayer = add.graphics().setDepth(Math.max(this.depth, 5) + 0.4);
    }
    return { fill: this.fillLayer, edge: this.edgeLayer };
  }

  show(dangerTiles) {
    this.hide();
    this.visible = true;
    const layers = this._layers();
    const S = TILE_SIZE;
    const damage = [];
    for (const tile of dangerTiles || []) {
      const tier = dangerTier(tile);
      const fillAlpha = this.style.fill
        ? Math.min(0.6, DANGER_FILL_ALPHA[tier] * this.style.fillScale)
        : 0;
      this.tiles.push({
        col: tile.col,
        row: tile.row,
        count: tile.count ?? 1,
        tier,
        fillAlpha,
        statusThreat: Boolean(tile.statusThreat),
      });
      if (tier > 0) damage.push(tile);
      if (!layers) continue;
      const { x, y } = this.grid.gridToPixel(tile.col, tile.row);
      const x0 = x - S / 2;
      const y0 = y - S / 2;
      if (fillAlpha > 0) {
        layers.fill.fillStyle(this.color, fillAlpha);
        layers.fill.fillRect(x0, y0, S, S);
      }
      if (this.style.hatch && tier > 0) {
        layers.fill.lineStyle(1, UI_HEX.threatEdge, DANGER_HATCH_ALPHA[tier]);
        for (const seg of hatchSegments(x0, y0, S, tier))
          layers.fill.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
      }
      if (tile.statusThreat) {
        layers.edge.lineStyle(2, UI_HEX.threatStatus, 0.95);
        layers.edge.strokeRect(x0 + 2, y0 + 2, S - 4, S - 4);
      }
    }
    if (!layers || !damage.length) {
      this._bake(layers);
      return;
    }
    // Outer edge of the damage zone: ink under-stroke, then the crimson line.
    const origin = this.grid.gridToPixel(0, 0);
    const ox = origin.x - S / 2;
    const oy = origin.y - S / 2;
    const edges = dangerEdges(damage);
    const w = this.style.edgeWidth;
    const stroke = (width, color, alpha) => {
      layers.edge.lineStyle(width, color, alpha);
      const ext = width / 2;
      for (const e of edges) {
        const horizontal = e.y1 === e.y2;
        const x1 = ox + e.x1 * S - (horizontal ? ext : 0);
        const x2 = ox + e.x2 * S + (horizontal ? ext : 0);
        const y1 = oy + e.y1 * S - (horizontal ? 0 : ext);
        const y2 = oy + e.y2 * S + (horizontal ? 0 : ext);
        layers.edge.lineBetween(x1, y1, x2, y2);
      }
    };
    stroke(w + 2, UI_HEX.threatInk, 0.7);
    stroke(w, this.variant === 'focus' ? UI_HEX.parchment : UI_HEX.threatEdge, 1);
    this._bake(layers);
  }

  _bake(layers) {
    if (!layers?.baked) return;
    const { x, y } = this.bakeOrigin;
    this.fillRT.clear();
    this.edgeRT.clear();
    this.fillRT.draw(layers.fill, -x, -y);
    this.edgeRT.draw(layers.edge, -x, -y);
    layers.fill.clear();
    layers.edge.clear();
  }

  hide() {
    this.fillLayer?.clear?.();
    this.edgeLayer?.clear?.();
    if (this.fillRT?.active !== false) this.fillRT?.clear?.();
    if (this.edgeRT?.active !== false) this.edgeRT?.clear?.();
    this.tiles = [];
    this.visible = false;
  }

  destroy() {
    this.hide();
    for (const obj of [
      this.fillLayer,
      this.edgeLayer,
      this.fillRT,
      this.edgeRT,
      this.scratchFill,
      this.scratchEdge,
    ])
      obj?.destroy?.();
    this.fillLayer = this.edgeLayer = this.fillRT = this.edgeRT = null;
    this.scratchFill = this.scratchEdge = null;
  }

  toggle(dangerTiles) {
    if (this.visible) {
      this.hide();
    } else {
      this.show(dangerTiles);
    }
  }
}
