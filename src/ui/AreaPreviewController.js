// AreaPreviewController — draws an area weapon art's preview on the board before the
// player confirms (docs/specs/aoe-weapon-arts.md §5). Rendering only: what to draw comes
// from engine/AreaPreview.js, which reads the board as the player knows it, so nothing
// here can show a unit the fog hides.
//
//   footprint  a soft tint on every tile the area covers (pure geometry and terrain)
//   victims    a ring on each known foe it reaches; with numbers, "-8" or "KO"
//   heals      "+8" on each ally a heal reaches
//   push       a line to where a ram leaves its target, and a crash mark
//
// Tiles are placed with grid.gridToPixel, so a portrait board's turn is already applied.
// Phaser construction runs under the presentation RNG: drawing never moves the battle's.

import { TILE_SIZE } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { presentationText } from '../utils/presentationText.js';

export const AREA_PREVIEW_TINT = 0xff7a3d;
const HEAL_TINT = 0x5ce08a;

export class AreaPreviewController {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    /** The last preview shown (tests and the forecast read it). */
    this.preview = null;
  }

  create() {}

  /**
   * Draw `preview` (AreaPreview.previewAreaArt). `numbers: false` marks victims without
   * damage numbers (target selection, before the forecast has the full combat mods).
   */
  show(preview, { numbers = true } = {}) {
    this.clear();
    const scene = this.scene;
    if (!preview || !scene?.add?.graphics || !scene.grid?.gridToPixel) return;
    this.preview = preview;
    const half = TILE_SIZE / 2;
    withPresentationRandom(() => {
      const g = scene.add.graphics().setDepth(UI_DEPTHS.AREA_PREVIEW);
      g.fillStyle(AREA_PREVIEW_TINT, 0.22);
      for (const tile of preview.tiles || []) {
        const { x, y } = scene.grid.gridToPixel(tile.col, tile.row);
        g.fillRect(x - half + 1, y - half + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      }
      const ring = (unit, color) => {
        const { x, y } = scene.grid.gridToPixel(unit.col, unit.row);
        g.lineStyle(2, color, 0.95);
        g.strokeRect(x - half + 2, y - half + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      };
      for (const v of preview.victims || []) ring(v.unit, AREA_PREVIEW_TINT);
      for (const h of preview.heals || []) if (h.amount > 0) ring(h.unit, HEAL_TINT);
      if (preview.push && !preview.push.braced) {
        const target = preview.target || null;
        const from = target ? scene.grid.gridToPixel(target.col, target.row) : null;
        const to = scene.grid.gridToPixel(preview.push.to.col, preview.push.to.row);
        if (from) {
          g.lineStyle(3, UI_HEX.accentText, 0.9);
          g.lineBetween(from.x, from.y, to.x, to.y);
        }
      }
      this.objects.push(g);
    });
    if (!numbers) return;
    const chip = (unit, text, color) => {
      const { x, y } = scene.grid.gridToPixel(unit.col, unit.row);
      const label = presentationText(scene, x, y - half + 6, text, {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 3,
      });
      label.setOrigin?.(0.5)?.setDepth?.(UI_DEPTHS.AREA_PREVIEW_CHIP);
      this.objects.push(label);
    };
    for (const v of preview.victims || [])
      chip(v.unit, v.kills ? 'KO' : `-${v.damage}`, UI_PALETTE.warn);
    for (const h of preview.heals || [])
      if (h.amount > 0) chip(h.unit, `+${h.amount}`, UI_PALETTE.good);
    if (preview.push?.crash && preview.push.obstacle)
      chip(preview.push.obstacle, `-${preview.push.damage}`, UI_PALETTE.warn);
  }

  clear() {
    for (const obj of this.objects) obj?.destroy?.();
    this.objects = [];
    this.preview = null;
  }

  destroy() {
    this.clear();
    this.scene = null;
  }
}
