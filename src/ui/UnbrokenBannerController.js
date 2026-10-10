// UnbrokenBannerController — what the Unbroken Banner's hold looks like (an earned blessing,
// docs/specs/blessings-v3.md §6; engine/BattleBlessings.js).
//
// The state is already settled when this runs: Combat.rollStrike (or UnitHealth.damageUnit)
// spent the banner and left the unit at 1 HP, and every reader sees that HP. This only
// draws it:
//   * the unit's HP bar shows its 1 HP;
//   * "The banner holds." floats over the unit, with the `deed` cue (sfx_heal without it).
// Motion-reduced play shows the same end state (nothing here moves). Presentation only: no
// RNG, no saves, no unit state; a failure here never touches the battle.

import { UI_PALETTE } from '../utils/uiStyles.js';
import { playCue } from './ceremonyMusic.js';

const BANNER_HOLD_LINE = 'The banner holds.';

export default class UnbrokenBannerController {
  constructor(scene) {
    this.scene = scene;
    this.destroyed = false;
  }

  create() {
    return this;
  }

  /** Present one hold on `unit` (its state already at 1 HP, the banner spent). */
  playHold(unit) {
    const scene = this.scene;
    if (this.destroyed || !scene || !unit) return;
    try {
      scene.updateHPBar?.(unit);
      const pos = scene.grid?.gridToPixel?.(unit.col, unit.row);
      if (pos) scene.showMinorHintAt?.(pos.x, pos.y - 24, BANNER_HOLD_LINE, UI_PALETTE.accentText);
      void playCue(scene, 'deed', { fallbackSfx: 'sfx_heal', duck: 0.4, waitMs: 250 });
    } catch (err) {
      console.warn('[UnbrokenBannerController] hold presentation failed:', err);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene = null;
  }
}
