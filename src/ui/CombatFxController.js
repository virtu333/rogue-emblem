/**
 * CombatFxController — tween-based combat motion effects ("juice").
 * Animates existing static unit graphics: attack lunge, dodge hop, hit
 * recoil, crit shake/pop, and death fade. No new assets or spritesheets.
 *
 * All motion works on unit.graphic only (labels/HP bars stay put — the
 * displacement is small and brief). Home position is captured per strike
 * via settle(), which also kills any in-flight FX tweens so overlapping
 * strikes (doubles, counters) can never drift a sprite off its tile.
 *
 * Reduced-effects mode shortens durations and skips camera shake.
 */

const LUNGE_PX = 10;
const DODGE_PX = 8;
const RECOIL_PX = 4;

export class CombatFxController {
  constructor(scene) {
    this.scene = scene;
  }

  _reduced() {
    return this.scene._isReducedEffects();
  }

  /** Unit vector from `fromG` toward `toG` (falls back to pointing down). */
  _dir(fromG, toG) {
    if (!fromG || !toG) return { nx: 0, ny: 1 };
    const dx = toG.x - fromG.x;
    const dy = toG.y - fromG.y;
    const len = Math.hypot(dx, dy);
    if (len <= 0.001) return { nx: 0, ny: 1 };
    return { nx: dx / len, ny: dy / len };
  }

  /** Kill stray FX tweens and re-capture the graphic's home position. */
  settle(unit) {
    const g = unit?.graphic;
    if (!g) return;
    this.scene.tweens.killTweensOf(g);
    if (g._fxHomeX !== undefined) {
      g.x = g._fxHomeX;
      g.y = g._fxHomeY;
      g.scaleX = g._fxHomeScaleX;
      g.scaleY = g._fxHomeScaleY;
    }
    g._fxHomeX = g.x;
    g._fxHomeY = g.y;
    g._fxHomeScaleX = g.scaleX;
    g._fxHomeScaleY = g.scaleY;
  }

  /** Clear stored home so later map movement can't snap back to stale FX state. */
  _clearHome(g) {
    if (!g) return;
    delete g._fxHomeX;
    delete g._fxHomeY;
    delete g._fxHomeScaleX;
    delete g._fxHomeScaleY;
  }

  /**
   * Move the striker's sprite toward the target ("contact" point).
   * Awaits the forward motion; call lungeBack() after impact effects.
   * With no graphic, waits the legacy flash delay so pacing is unchanged.
   */
  async lungeForward(striker, target) {
    const g = striker?.graphic;
    const reduced = this._reduced();
    if (!g) {
      await this.scene._awaitSceneDelay(reduced ? 70 : 120, { label: 'combat_fx_lunge_fallback' });
      return;
    }
    this.settle(striker);
    if (target?.graphic) this.settle(target);
    const { nx, ny } = this._dir(g, target?.graphic);
    await this.scene._awaitSceneTween(
      {
        targets: g,
        x: g._fxHomeX + nx * LUNGE_PX,
        y: g._fxHomeY + ny * LUNGE_PX,
        duration: reduced ? 50 : 90,
        ease: 'Quad.easeOut',
      },
      { label: 'combat_fx_lunge_forward' },
    );
  }

  /**
   * Return the striker's sprite to its home tile, then clear stored homes on
   * both units. Clearing matters: units move between combats, so a stale home
   * must never survive past the strike (settle() would snap to it).
   * The fire-and-forget dodge/recoil/pop tweens always finish within the
   * hit/miss hold that precedes this call, so clearing here is race-free.
   */
  async lungeBack(striker, target) {
    const g = striker?.graphic;
    if (g && g._fxHomeX !== undefined) {
      const reduced = this._reduced();
      await this.scene._awaitSceneTween(
        {
          targets: g,
          x: g._fxHomeX,
          y: g._fxHomeY,
          duration: reduced ? 50 : 90,
          ease: 'Quad.easeIn',
        },
        { label: 'combat_fx_lunge_back' },
      );
      if (g._fxHomeX !== undefined) {
        g.x = g._fxHomeX;
        g.y = g._fxHomeY;
      }
    }
    this._clearHome(g);
    this._clearHome(target?.graphic);
  }

  /** Side-step hop for a missed strike. Fire-and-forget (yoyo restores position). */
  dodge(target, striker) {
    const g = target?.graphic;
    if (!g || g._fxHomeX === undefined) return;
    const reduced = this._reduced();
    const { nx, ny } = this._dir(striker?.graphic, g);
    // Perpendicular to the attack direction reads as a side-step.
    const px = -ny;
    const py = nx;
    this.scene.tweens.add({
      targets: g,
      x: g._fxHomeX + px * DODGE_PX,
      y: g._fxHomeY + py * DODGE_PX,
      duration: reduced ? 45 : 80,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (g._fxHomeX !== undefined) {
          g.x = g._fxHomeX;
          g.y = g._fxHomeY;
        }
      },
    });
  }

  /** Knockback nudge on a landed hit. Fire-and-forget (yoyo restores position). */
  recoil(target, striker) {
    const g = target?.graphic;
    if (!g || g._fxHomeX === undefined) return;
    const reduced = this._reduced();
    const { nx, ny } = this._dir(striker?.graphic, g);
    this.scene.tweens.add({
      targets: g,
      x: g._fxHomeX + nx * RECOIL_PX,
      y: g._fxHomeY + ny * RECOIL_PX,
      duration: reduced ? 30 : 50,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (g._fxHomeX !== undefined) {
          g.x = g._fxHomeX;
          g.y = g._fxHomeY;
        }
      },
    });
  }

  /** Crit punch-up: brief camera shake + scale pop on the striker. */
  critImpact(striker) {
    const reduced = this._reduced();
    if (!reduced) this.scene.cameras?.main?.shake?.(120, 0.006);
    const g = striker?.graphic;
    if (!g || g._fxHomeScaleX === undefined) return;
    this.scene.tweens.add({
      targets: g,
      scaleX: g._fxHomeScaleX * 1.18,
      scaleY: g._fxHomeScaleY * 1.18,
      duration: reduced ? 40 : 70,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (g._fxHomeScaleX !== undefined) {
          g.scaleX = g._fxHomeScaleX;
          g.scaleY = g._fxHomeScaleY;
        }
      },
    });
  }

  /** Flicker + fade a dying unit's visuals before they are destroyed. */
  async deathFade(unit) {
    const g = unit?.graphic;
    if (!g) return;
    const reduced = this._reduced();
    this.scene.tweens.killTweensOf(g);
    const targets = [
      g,
      unit.label,
      unit.factionIndicator,
      unit.hpBar?.bg,
      unit.hpBar?.fill,
      ...(unit.affixPips || []),
    ].filter(Boolean);
    if (g.setTintFill) g.setTintFill(0xffffff);
    await this.scene._awaitSceneTween(
      {
        targets,
        alpha: 0,
        duration: reduced ? 140 : 300,
        ease: 'Quad.easeIn',
      },
      { label: 'combat_fx_death_fade' },
    );
  }
}
