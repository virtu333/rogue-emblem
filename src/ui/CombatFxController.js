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
 * Reduced motion removes displacement and camera shake; quality controls overlay art.
 */

import { battleSpeed, combatDuration, combatTween } from '../utils/combatTiming.js';
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
    this._motionTweens = new Set();
    this._timers = new Set();
    this._sprites = new Set();
    this._units = new Set();
    this._zoomCamera = null;
    this._shakeCamera = null;
    this._lastSoundAt = new Map();
  }

  _motion(config) {
    let tween;
    tween = this.scene.tweens.add(
      combatTween(this.scene, {
        ...config,
        onComplete: (...args) => {
          this._motionTweens.delete(tween);
          config.onComplete?.(...args);
        },
      }),
    );
    if (tween) this._motionTweens.add(tween);
  }

  _later(ms, callback) {
    let timer;
    timer = this.scene.time.delayedCall(combatDuration(this.scene, ms), () => {
      this._timers.delete(timer);
      callback();
    });
    if (timer) this._timers.add(timer);
  }

  finishStrike(...units) {
    for (const tween of this._motionTweens) tween.remove?.();
    this._motionTweens.clear();
    for (const unit of new Set([...this._units, ...units])) {
      const g = unit?.graphic;
      if (g?._fxHomeX !== undefined) {
        g.x = g._fxHomeX;
        g.y = g._fxHomeY;
        g.scaleX = g._fxHomeScaleX;
        g.scaleY = g._fxHomeScaleY;
      }
      this._clearHome(g);
    }
    this._units.clear();
    if (this._zoomCamera) this._zoomCamera.setZoom(1);
    this._zoomCamera = null;
    if (this._shakeCamera) this._shakeCamera.camera.rotation = this._shakeCamera.rotation;
    this._shakeCamera = null;
    // Strike-owned effects must settle even if a held speed override was released.
    for (const timer of this._timers) timer.remove?.(false);
    this._timers.clear();
    for (const sprite of this._sprites) sprite.destroy();
    this._sprites.clear();
  }

  destroy() {
    this.finishStrike();
    for (const timer of this._timers) timer.remove?.(false);
    for (const sprite of this._sprites) sprite.destroy();
    this._timers.clear();
    this._sprites.clear();
  }

  playStrikeSound(key) {
    const now = this.scene.time?.now ?? 0;
    if (
      battleSpeed(this.scene) === 'instant' &&
      now - (this._lastSoundAt.get(key) ?? -Infinity) < 100
    )
      return;
    this._lastSoundAt.set(key, now);
    this.scene.registry?.get?.('audio')?.playSFX(key);
  }

  _reduced() {
    return this.scene._reduceMotion();
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
    this._units.add(unit);
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
    if (reduced) return;
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
        duration: followUp ? 55 : 90,
        ease: 'Quad.easeOut',
      },
      { label: 'combat_fx_lunge_forward' },
    );
  }

  /**
   * Return the striker's sprite to its home tile, then clear stored homes on
   * both units. Clearing matters: units move between combats, so a stale home
   * must never survive past the strike (settle() would snap to it).
   * Settle owned reaction tweens explicitly: Instant can finish the hold first.
   */
  async lungeBack(striker, target) {
    const g = striker?.graphic;
    if (g && g._fxHomeX !== undefined) {
      if (!this._reduced())
        await this.scene._awaitSceneTween(
          {
            targets: g,
            x: g._fxHomeX,
            y: g._fxHomeY,
            duration: 90,
            ease: 'Quad.easeIn',
          },
          { label: 'combat_fx_lunge_back' },
        );
      if (g._fxHomeX !== undefined) {
        g.x = g._fxHomeX;
        g.y = g._fxHomeY;
      }
    }
    this.finishStrike(striker, target);
  }

  /** Side-step hop for a missed strike. Fire-and-forget (yoyo restores position). */
  dodge(target, striker) {
    if (this._reduced()) return;
    const g = target?.graphic;
    if (!g || g._fxHomeX === undefined) return;
    const { nx, ny } = this._dir(striker?.graphic, g);
    // Perpendicular to the attack direction reads as a side-step.
    const px = -ny;
    const py = nx;
    this._motion({
      targets: g,
      x: g._fxHomeX + px * DODGE_PX,
      y: g._fxHomeY + py * DODGE_PX,
      duration: 80,
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
    if (this._reduced()) return;
    const g = target?.graphic;
    if (!g || g._fxHomeX === undefined) return;
    const { nx, ny } = this._dir(striker?.graphic, g);
    this._motion({
      targets: g,
      x: g._fxHomeX + nx * RECOIL_PX,
      y: g._fxHomeY + ny * RECOIL_PX,
      duration: 50,
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
    if (this._reduced()) return;
    const g = target?.graphic;
    if (!g || g._fxHomeScaleX === undefined) return;
    this._motion({
      targets: g,
      scaleX: g._fxHomeScaleX * 1.08,
      scaleY: g._fxHomeScaleY * 0.86,
      duration: 60,
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
    this._zoomCamera = cam;
    this._motion({
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
    if (this._reduced()) return;
    // Phaser's random shake consumes Math.random on every frame, changing the
    // next combat's RNG when playback speed changes. Use a fixed oscillation.
    const camera = this.scene.cameras?.main;
    if (camera && battleSpeed(this.scene) !== 'instant') {
      const rotation = this._shakeCamera?.rotation ?? camera.rotation ?? 0;
      this._shakeCamera = { camera, rotation };
      this._motion({
        targets: camera,
        rotation: rotation + 0.004,
        duration: 30,
        yoyo: true,
        repeat: 1,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          camera.rotation = rotation;
        },
      });
    }
    const g = striker?.graphic;
    if (!g || g._fxHomeScaleX === undefined) return;
    this._motion({
      targets: g,
      scaleX: g._fxHomeScaleX * 1.18,
      scaleY: g._fxHomeScaleY * 1.18,
      duration: 70,
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
   * destroys itself when the animation ends. Omitted at low quality; static with reduced motion.
   * tint colors the (white/light) art; delay staggers stacked bursts.
   */
  playOverlay(key, x, y, { rotation = 0, scale = 1, tint = null, delay = 0 } = {}) {
    if (this.scene._effectsQuality?.() === 'low') return;
    const staticFrame = this._reduced() || battleSpeed(this.scene) === 'instant';
    if (staticFrame ? !this.scene.textures?.exists?.(key) : !this._ensureAnim(key)) return;
    const spawn = () => {
      if (!this.scene.sys || !this.scene.sys.isActive()) return;
      const sprite = this.scene.add
        .sprite(x, y, key, 0)
        .setDepth(FX_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setRotation(rotation)
        .setScale(scale);
      this._sprites.add(sprite);
      const dispose = () => {
        this._sprites.delete(sprite);
        sprite.destroy();
      };
      if (tint !== null) sprite.setTint(tint);
      if (staticFrame) {
        sprite.setFrame(1);
        this._later(250, dispose);
      } else {
        sprite.once('animationcomplete', dispose);
        if (sprite.anims) sprite.anims.timeScale = battleSpeed(this.scene) === 'fast' ? 2 : 1;
        sprite.play(`${key}_anim`);
      }
    };
    if (delay > 0) this._later(delay, spawn);
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
    if (this.scene._effectsQuality?.() === 'low') return;
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
    if (this.scene._effectsQuality?.() === 'low') return;
    const tg = target?.graphic;
    if (!tg) return;
    const artEntry = (split?.striker || []).find((e) => e.id === 'weapon_art');
    if (!artEntry) return;
    const art = findArtByName(artEntry.name, artCatalog);
    const bursts = this._reduced() ? 1 : artBurstsForTier(art?.tierAffinity);
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
    if (!reduced && g.setTintFill) g.setTintFill(0xffffff);
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
