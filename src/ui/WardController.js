// WardController — what the Warden's Buckler's ward looks like when it takes a blow
// (engine/AccessoryWard.js).
//
// The state is already settled when this runs: Combat.rollStrike cut the blow to 1 damage
// and spent the ward on the unit. This only draws it:
//   * a pale blue ring bursts out from the unit and fades (a still ring under reduced motion);
//   * "Warded" floats over the unit;
//   * the unit's pip row is redrawn, so the ward's ready pip goes.
// The shield proc banner and its shield flash come with the strike's activation
// (ProcVisualTheme `warden_buckler`). Presentation only: no RNG, no saves, no unit state; a
// failure here never touches the battle.

import { TILE_SIZE } from '../utils/constants.js';
export { wardReady } from '../engine/AccessoryWard.js'; // the pip's read, for BattleScene

export const WARD_LINE = 'Warded';
export const WARD_COLOR = 0x77bbff;
const WARD_TEXT_COLOR = '#77bbff';
const WARD_RING_MS = 450;

/** A ready ward's pip in the unit's pip row (BattleScene.updateAffixPips): pale blue, round. */
export function drawWardPip(scene, x, y, size) {
  return scene.add
    .circle(x, y, size / 2 + 1, WARD_COLOR)
    .setDepth(14)
    .setStrokeStyle(1, 0x000000);
}

/** A combat that spent a ward redraws its sides' pips, whether or not its strikes were shown. */
export function redrawWardPips(scene, result, units) {
  if (!result?.events?.some?.((e) => e.buckler)) return;
  for (const unit of units) {
    try {
      scene.updateAffixPips?.(unit);
    } catch (err) {
      console.warn('[WardController] ward pip redraw failed:', err);
    }
  }
}

export default class WardController {
  constructor(scene) {
    this.scene = scene;
    this.destroyed = false;
  }

  create() {
    return this;
  }

  /** Present one warded blow on `unit`. */
  playWard(unit, { reduced = false } = {}) {
    const scene = this.scene;
    if (this.destroyed || !scene || !unit) return;
    try {
      scene.updateAffixPips?.(unit);
      const pos = scene.grid?.gridToPixel?.(unit.col, unit.row);
      if (!pos) return;
      scene.showMinorHintAt?.(pos.x, pos.y - 24, WARD_LINE, WARD_TEXT_COLOR);
      const ring = scene.add
        ?.circle?.(pos.x, pos.y, TILE_SIZE / 2 - 2)
        ?.setStrokeStyle?.(2, WARD_COLOR, 1)
        ?.setDepth?.(15);
      if (!ring) return;
      if (reduced || !scene.tweens) {
        scene.time?.delayedCall?.(WARD_RING_MS, () => ring.destroy());
        return;
      }
      ring.setScale(0.6);
      scene.tweens.add({
        targets: ring,
        scale: 1.4,
        alpha: 0,
        duration: WARD_RING_MS,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    } catch (err) {
      console.warn('[WardController] ward presentation failed:', err);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene = null;
  }
}
