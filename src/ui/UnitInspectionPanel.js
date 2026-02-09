// UnitInspectionPanel.js — Minimal tooltip shown on right-click
// Shows unit name + "View Unit [V]" near the unit. Click or V opens full detail overlay.

import { UI_COLORS } from '../utils/uiStyles.js';
import { TILE_SIZE } from '../utils/constants.js';

export class UnitInspectionPanel {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.visible = false;
    this._unit = null;
    this._terrain = null;
    this._gameData = null;
  }

  show(unit, terrain, gameData) {
    this.hide();
    this.visible = true;
    this._unit = unit;
    this._terrain = terrain;
    this._gameData = gameData;

    // Position tooltip near the unit's grid tile, clamped to screen
    const pixelX = unit.col * TILE_SIZE + TILE_SIZE / 2;
    const pixelY = unit.row * TILE_SIZE;
    const tooltipW = 120;
    const tooltipH = 34;

    let tx = pixelX + TILE_SIZE / 2 + 4; // right of unit
    let ty = pixelY - 4;

    // Clamp to screen edges (640x480)
    if (tx + tooltipW > 636) tx = pixelX - tooltipW - 4;
    if (ty + tooltipH > 476) ty = 476 - tooltipH;
    if (ty < 4) ty = 4;
    if (tx < 4) tx = 4;

    // Dark background box
    const bg = this.scene.add.rectangle(tx, ty, tooltipW, tooltipH, 0x111122, 0.92)
      .setOrigin(0, 0).setDepth(150).setStrokeStyle(1, 0x666688)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => {
      if (this.scene.openUnitDetailOverlay) this.scene.openUnitDetailOverlay();
    });
    this.objects.push(bg);

    // Unit name
    const nameText = this.scene.add.text(tx + 6, ty + 3, unit.name, {
      fontFamily: 'monospace', fontSize: '10px', color: UI_COLORS.gold,
    }).setDepth(151);
    this.objects.push(nameText);

    // "View Unit [V]" hint
    const hintText = this.scene.add.text(tx + 6, ty + 17, 'View Unit [V]', {
      fontFamily: 'monospace', fontSize: '9px', color: UI_COLORS.gray,
    }).setDepth(151);
    this.objects.push(hintText);
  }

  hide() {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    this._unit = null;
    this._terrain = null;
    this._gameData = null;
  }
}
