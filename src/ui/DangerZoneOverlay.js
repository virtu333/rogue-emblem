// DangerZoneOverlay.js — Shows all tiles threatened by enemy units

import { TILE_SIZE } from '../utils/constants.js';

export class DangerZoneOverlay {
  constructor(scene, grid) {
    this.scene = scene;
    this.grid = grid;
    this.tiles = [];
    this.visible = false;
  }

  show(dangerTiles) {
    this.hide();
    this.visible = true;
    for (const { col, row, statusThreat, damageThreat } of dangerTiles) {
      const { x, y } = this.grid.gridToPixel(col, row);
      const rect = this.scene.add
        .rectangle(
          x,
          y,
          TILE_SIZE - 1,
          TILE_SIZE - 1,
          0xff8800,
          statusThreat && !damageThreat ? 0 : 0.25,
        )
        .setDepth(4);
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
