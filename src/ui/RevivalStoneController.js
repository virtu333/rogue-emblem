// RevivalStoneController — what a broken Revival Stone looks like (docs/specs/phase3.md 3D).
//
// The state is already settled when this runs: Combat.rollStrike (or UnitHealth.damageUnit)
// spent the stone and refilled the bar, and every reader sees the refilled HP. This only
// draws it:
//   * the unit's map bar fills back from empty over REFILL_MS (its boss bar likewise,
//     BossPresenceController.playRefill);
//   * the stone's pip (BattleScene.updateAffixPips draws one beside the affix pips) goes;
//   * "The stone breaks." floats over the unit, with the `sealed` cue (sfx_heal without it).
// Motion-reduced play shows the end state at once. Presentation only: no RNG, no saves, no
// unit state; a failure here never touches the battle.

import { UI_PALETTE } from '../utils/uiStyles.js';
import { playCue } from './ceremonyMusic.js';

export const STONE_REFILL_MS = 400;
export const STONE_BREAK_LINE = 'The stone breaks.';

export default class RevivalStoneController {
  constructor(scene) {
    this.scene = scene;
    this._tweens = new Set();
    this.destroyed = false;
  }

  create() {
    return this;
  }

  _reduced() {
    return Boolean(this.scene?._reduceMotion?.());
  }

  /** Present one broken stone on `unit` (its state already refilled and spent). */
  playBreak(unit) {
    const scene = this.scene;
    if (this.destroyed || !scene || !unit) return;
    try {
      scene.updateAffixPips?.(unit);
      this._refillBar(unit);
      if (unit.isBoss) scene._bossPresence?.playRefill?.();
      const pos = scene.grid?.gridToPixel?.(unit.col, unit.row);
      if (pos) scene.showMinorHintAt?.(pos.x, pos.y - 24, STONE_BREAK_LINE, UI_PALETTE.info);
      void playCue(scene, 'sealed', { fallbackSfx: 'sfx_heal', duck: 0.4, waitMs: 250 });
    } catch (err) {
      console.warn('[RevivalStoneController] break presentation failed:', err);
    }
  }

  /** The unit's own bar: empty, then back to its real fill (a boss's bar steps aside). */
  _refillBar(unit) {
    const scene = this.scene;
    const counter = scene?.tweens?.addCounter;
    if (!unit?.hpBar?.fill || this._reduced() || !counter) {
      scene?.updateHPBar?.(unit);
      return;
    }
    scene.updateHPBar(unit, { ratio: 0 });
    const tween = scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: STONE_REFILL_MS,
      ease: 'Cubic.easeOut',
      onUpdate: (t) => {
        if (!this.destroyed)
          scene.updateHPBar(unit, { ratio: t.getValue() * this._realRatio(unit) });
      },
      onComplete: () => {
        this._tweens.delete(tween);
        if (!this.destroyed) scene.updateHPBar(unit);
      },
    });
    this._tweens.add(tween);
  }

  _realRatio(unit) {
    const max = Number(unit?.stats?.HP) || 1;
    return Math.max(0, Math.min(1, (Number(unit?.currentHP) || 0) / max));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const tween of this._tweens) tween.stop?.();
    this._tweens.clear();
    this.scene = null;
  }
}
