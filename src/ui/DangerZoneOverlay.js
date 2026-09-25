// DangerZoneOverlay.js — Shows all tiles threatened by enemy units

import { TILE_SIZE } from '../utils/constants.js';
import { UI_HEX } from '../utils/uiStyles.js';

export class DangerZoneOverlay {
  constructor(scene, grid, { color = UI_HEX.warn, depth = 4 } = {}) {
    this.scene = scene;
    this.grid = grid;
    this.color = color;
    this.depth = depth;
    this.tiles = [];
    this.visible = false;
  }

  show(dangerTiles) {
    this.hide();
    this.visible = true;
    for (const { col, row, count = 1, statusThreat, damageThreat } of dangerTiles) {
      const { x, y } = this.grid.gridToPixel(col, row);
      const rect = this.scene.add
        .rectangle(
          x,
          y,
          TILE_SIZE - 1,
          TILE_SIZE - 1,
          this.color,
          statusThreat && !damageThreat ? 0 : count >= 3 ? 0.42 : count === 2 ? 0.3 : 0.18,
        )
        .setDepth(this.depth);
      if (statusThreat) rect.setStrokeStyle(2, 0xb08bd6);
      this.tiles.push(rect);
    }
  }

  hide() {
    for (const tile of this.tiles) tile.destroy();
    this.tiles = [];
    this.visible = false;
  }

  toggle(dangerTiles) {
    if (this.visible) {
      this.hide();
    } else {
      this.show(dangerTiles);
    }
  }
}
