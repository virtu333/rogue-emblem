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

import Phaser from 'phaser';
import { fxForActivation, findArtByName, artBurstsForTier, PROC_THEME } from './ProcVisualTheme.js';

const LUNGE_PX = 10;
const DODGE_PX = 8;
const RECOIL_PX = 4;
const WINDUP_PX = 4;

// Effect overlay depth: above units (10), below floating damage text (300).
const FX_DEPTH = 250;
const FX_FRAME_RATE = 16; // 4 frames -> ~250ms per burst

/** Weapon type -> effect spritesheet key. Directional effects are drawn
 *  pointing right in the source art and get rotated toward the target. */
const WEAPON_FX = {
  Sword: { key: 'fx_slash', directional: true },
  Axe: { key: 'fx_chop', directional: true },
  Lance: { key: 'fx_thrust', directional: true },
  Bow: { key: 'fx_arrow', directional: true },
  Tome: { key: 'fx_magic', directional: false },
  Breath: { key: 'fx_magic', directional: false },
  Scroll: { key: 'fx_magic', directional: false },
  Light: { key: 'fx_light', directional: false },
  Staff: { key: 'fx_heal', directional: false },
};

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
   *
   * opts.windUp: brief pull-back before the lunge (offensive procs / arts).
   * opts.tempo 'followup': shorter, faster lunge for consecutive strikes by
   * the same unit (Astra flurries, brave doubles, Adept bonus strikes).
   */
  async lungeForward(striker, target, opts = {}) {
    const g = striker?.graphic;
    const reduced = this._reduced();
    if (!g) {
      await this.scene._awaitSceneDelay(reduced ? 70 : 120, { label: 'combat_fx_lunge_fallback' });
      return;
    }
    this.settle(striker);
    if (target?.graphic) this.settle(target);
    const { nx, ny } = this._dir(g, target?.graphic);
    const followUp = opts.tempo === 'followup';
    if (opts.windUp && !reduced && !followUp) {
      await this.scene._awaitSceneTween(
        {
          targets: g,
          x: g._fxHomeX - nx * WINDUP_PX,
          y: g._fxHomeY - ny * WINDUP_PX,
          duration: 70,
          ease: 'Quad.easeOut',
        },
        { label: 'combat_fx_windup' },
      );
    }
    const dist = followUp ? LUNGE_PX * 0.7 : LUNGE_PX;
    await this.scene._awaitSceneTween(
      {
        targets: g,
        x: g._fxHomeX + nx * dist,
        y: g._fxHomeY + ny * dist,
        duration: reduced ? (followUp ? 35 : 50) : followUp ? 55 : 90,
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

  /**
   * Defensive-proc reaction (Pavise, Aegis, Miracle, Shielded): the target
   * holds ground and braces -- a squash instead of the usual knockback.
   * Fire-and-forget (yoyo restores scale).
   */
  brace(target) {
    const g = target?.graphic;
    if (!g || g._fxHomeScaleX === undefined) return;
    const reduced = this._reduced();
    this.scene.tweens.add({
      targets: g,
      scaleX: g._fxHomeScaleX * 1.08,
      scaleY: g._fxHomeScaleY * 0.86,
      duration: reduced ? 35 : 60,
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

  /**
   * Camera zoom pulse for crit / Legendary-art impacts. Desktop only: the
   * mobile pinch camera owns zoom state, so it is skipped there, and it only
   * pulses when the camera is at rest to avoid fighting any other zoom.
   */
  zoomPunch() {
    if (this._reduced()) return;
    const scene = this.scene;
    const cam = scene.cameras?.main;
    if (!cam || scene._battleCamera) return;
    if (Math.abs(cam.zoom - 1) > 0.001) return;
    scene.tweens.add({
      targets: cam,
      zoom: 1.06,
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => cam.setZoom(1),
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

  /** Register the play-once animation for an effect key (idempotent).
   *  Frame count comes from the spritesheet (4-frame strips play ~250ms at
   *  16fps, 8-frame signature strips ~500ms). */
  _ensureAnim(key) {
    const anims = this.scene.anims;
    if (!anims?.exists) return false; // headless/stub scene: overlays are a no-op
    if (anims.exists(`${key}_anim`)) return true;
    if (!this.scene.textures.exists(key)) return false;
    // frameTotal includes Phaser's __BASE frame; sheet frames are 0..n-1
    const frames = Math.max(1, (this.scene.textures.get(key).frameTotal || 2) - 1);
    anims.create({
      key: `${key}_anim`,
      frames: anims.generateFrameNumbers(key, { start: 0, end: frames - 1 }),
      frameRate: FX_FRAME_RATE,
      repeat: 0,
    });
    return true;
  }

  /**
   * Play a one-shot effect overlay at (x, y). Additive blending makes the
   * black spritesheet background invisible. Fire-and-forget; the sprite
   * destroys itself when the animation ends. Skipped in reduced-effects mode.
   * tint colors the (white/light) art; delay staggers stacked bursts.
   */
  playOverlay(key, x, y, { rotation = 0, scale = 1, tint = null, delay = 0 } = {}) {
    if (this._reduced()) return;
    if (!this._ensureAnim(key)) return;
    const spawn = () => {
      if (!this.scene.sys || !this.scene.sys.isActive()) return;
      const sprite = this.scene.add
        .sprite(x, y, key, 0)
        .setDepth(FX_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setRotation(rotation)
        .setScale(scale);
      if (tint !== null) sprite.setTint(tint);
      sprite.once('animationcomplete', () => sprite.destroy());
      sprite.play(`${key}_anim`);
    };
    if (delay > 0) this.scene.time.delayedCall(delay, spawn);
    else spawn();
  }

  /**
   * Weapon-type effect at the point of contact, plus a starburst on crits.
   * opts.emphasis (weapon-art strikes) plays the weapon overlay larger.
   * opts.signatureKey (Legendary art strikes) replaces the weapon overlay
   * with the 8-frame signature effect for the art's weapon type.
   */
  playImpact(event, striker, target, opts = {}) {
    const tg = target?.graphic;
    if (!tg) return;
    const { nx, ny } = this._dir(striker?.graphic, tg);
    if (opts.signatureKey && this.scene.textures?.exists?.(opts.signatureKey)) {
      // Only the lance charge is drawn directional (pointing right in source art)
      const rotation = opts.signatureKey === 'fx_sig_lance' ? Math.atan2(ny, nx) : 0;
      this.playOverlay(opts.signatureKey, tg.x, tg.y, { rotation, scale: 1.2 });
    } else {
      const fxDef = WEAPON_FX[striker?.weapon?.type] || WEAPON_FX.Sword;
      const rotation = fxDef.directional ? Math.atan2(ny, nx) : 0;
      this.playOverlay(fxDef.key, tg.x, tg.y, { rotation, scale: opts.emphasis ? 1.3 : 1 });
    }
    if (event?.isCrit) this.playOverlay('fx_crit', tg.x, tg.y, { scale: 1.25 });
  }

  /**
   * Category effect overlays for a strike's procs (split comes from
   * splitStrikeActivations). Each proc's effect plays on the unit it
   * belongs to (drain on the striker, shield on the defender, ...).
   * Deduplicated per key+position; capped at 2 per strike to avoid clutter.
   */
  playProcOverlays(split, striker, target) {
    if (this._reduced()) return;
    const seen = new Set();
    let played = 0;
    for (const entry of [...(split?.striker || []), ...(split?.target || [])]) {
      if (entry.id === 'weapon_art') continue; // arts get the ring burst
      const fx = fxForActivation(entry);
      if (!fx) continue;
      const dedupe = `${fx.key}@${fx.at}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const g = (fx.at === 'striker' ? striker : target)?.graphic;
      if (!g) continue;
      this.playOverlay(fx.key, g.x, g.y);
      if (++played >= 2) break;
    }
  }

  /**
   * Amber ring burst under a weapon-art strike. Higher-tier arts stack
   * extra, larger bursts (Iron/Steel 1, Silver 2, Legendary 3).
   */
  playArtBurst(split, target, artCatalog) {
    if (this._reduced()) return;
    const tg = target?.graphic;
    if (!tg) return;
    const artEntry = (split?.striker || []).find((e) => e.id === 'weapon_art');
    if (!artEntry) return;
    const art = findArtByName(artEntry.name, artCatalog);
    const bursts = artBurstsForTier(art?.tierAffinity);
    for (let i = 0; i < bursts; i++) {
      this.playOverlay('fx_ring', tg.x, tg.y, {
        tint: PROC_THEME.art.accent,
        scale: 1 + i * 0.3,
        delay: i * 90,
      });
    }
  }

  /** Heal sparkle on the healed unit (staff heals, cures, fountains). */
  playHeal(x, y) {
    this.playOverlay('fx_heal', x, y);
  }

  /** Ailment swirl when a status condition lands or ticks. */
  playStatus(x, y) {
    this.playOverlay('fx_status', x, y);
  }

  /** Rising golden sparkles for buffs and action refreshes (Dance). */
  playBuff(x, y) {
    this.playOverlay('fx_buff', x, y);
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
