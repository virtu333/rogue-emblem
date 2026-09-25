/**
 * CombatFxController — the presentation primitives for combat (Combat v2).
 *
 * Owns every Phaser object, tween and timer the combat presentation creates, so
 * all of it can be torn down in one place:
 *   strike-owned   overlays, projectiles, ghosts, vignette, impact light, motion tweens,
 *                  timers, poses          -> finishStrike() (and destroy / reset)
 *   lingering      overlays still animating when their strike ends (they finish their
 *                  last frames and destroy themselves) -> destroy / reset
 *   ambient        pooled motes (FxMotePool) and death dissolves -> destroy / reset /
 *                  releaseUnit
 *
 * Effects come from one atlas (`fx_atlas`, baked by tools/art/combat-fx) described by
 * src/art/combatFx/fxAnims.json: per-frame hand-tuned durations, anchors and an optional
 * ink layer drawn with normal blending under or over the additive glow layer.
 * CombatChoreography sequences these primitives for a strike; the older entry points
 * (lungeForward, playImpact, playProcOverlays, deathFade, ...) keep their contracts.
 *
 * Rules every primitive follows:
 *   - Presentation only; never Math.random (seeded fxRandom), never battle state.
 *   - Honors battleSpeed (combatDuration/combatTween), reduced motion (no displacement,
 *     static frames), effects quality (low = no overlays) and Instant (no added waits).
 *   - Units always return to their home tile at scale 1, untinted, on their idle frame.
 */

import { battleSpeed, combatDuration, combatTween } from '../utils/combatTiming.js';
import Phaser from 'phaser';
import { fxForActivation, findArtByName, artBurstsForTier } from './ProcVisualTheme.js';
import FX_TABLE from '../art/combatFx/fxAnims.json';
import { MOTE_COLORS, lerpColor } from '../art/combatFx/fxPalette.js';
import {
  fxFamily,
  fxFamilyIdForWeapon,
  statusFxKey,
  dustKeyFor,
  DEATH_STYLES,
  deathStyleFor,
} from '../art/combatFx/fxFamilies.js';
import {
  facing,
  arcHeight,
  planDeath,
  fxSeed,
  fxRandom,
  STRIKE_TIMING,
} from '../art/combatFx/strikePlan.js';
import { buildDissolve, paintDissolve, pickMotes } from '../art/combatFx/deathDissolve.js';
import { FxMotePool } from './FxMotePool.js';

const LUNGE_PX = STRIKE_TIMING.lungePx.melee;
const DODGE_PX = 8;
const RECOIL_PX = STRIKE_TIMING.knockPx.normal;
const WINDUP_PX = 4;

// Effect layering, all in the world (below UI_DEPTHS.SCREEN_UI, so the act grade and
// fog apply to effects exactly as to the units they land on):
//   8       faction rings          10..10.9  unit sprites (by row)   11  unit labels
//   11.8    crit ink vignette      11.85     projectiles in flight
//   11.9    effect overlays (ink layers +-0.01)   11.95  pooled motes
//   12..14  HP bars and affix pips stay on top of every effect, readable mid-strike
//   90      fog (an effect in fog stays hidden)   300  damage numbers
export const FX_DEPTH = 11.9;
const MOTE_DEPTH = 11.95;
const VIGNETTE_DEPTH = 11.8; // darkens the world around a crit, under its burst
const PROJECTILE_DEPTH = 11.85;
const IMPACT_LIGHT_DEPTH = 3.6; // just above the night darkness (3.5), below ranges and units
export const FX_ATLAS = 'fx_atlas';
const FX_ANIMS = FX_TABLE.anims;
const VIGNETTE_KEY = 'fx-ink-vignette';
const GLOW_KEY = 'art_light_glow'; // BattleLightLayer's soft pool texture (night maps only)
const LINEAR = 0; // Phaser.Textures.FilterMode.LINEAR

const GHOST_BY_FACTION = {
  player: MOTE_COLORS.steel,
  enemy: MOTE_COLORS.crimson,
  npc: MOTE_COLORS.verdigris,
};

let dissolveSeq = 0;

/** Frame shown when an effect cannot animate (reduced motion, Instant). */
export function staticFrameIndex(anim) {
  if (!anim) return 0;
  if (anim.role === 'impact' || anim.role === 'signature' || anim.frames <= 1) return 0;
  return Math.min(anim.frames - 1, Math.max(1, Math.floor(anim.frames / 3)));
}

/** Where effects land on a unit: its body (a little above the tile centre) and feet. */
export function unitPoints(unit) {
  const g = unit?.graphic;
  if (!g) return null;
  const x = g._fxHomeX ?? g.x;
  const y = g._fxHomeY ?? g.y;
  const tall = (g.displayHeight || 32) > 40;
  const entity = unit?.isEntity === true;
  return {
    x,
    y,
    body: { x, y: entity ? y : y - (tall ? 6 : 1) },
    feet: { x, y: entity ? y + 40 : y + (tall ? 13 : 12) },
  };
}

/** A unit's body point, or a plain {x, y} point as given. */
function pointOf(u) {
  if (u?.graphic) return unitPoints(u)?.body || null;
  if (Number.isFinite(u?.x) && Number.isFinite(u?.y)) return { x: u.x, y: u.y };
  return null;
}

export class CombatFxController {
  constructor(scene) {
    this.scene = scene;
    this._motionTweens = new Set();
    this._timers = new Set();
    this._sprites = new Set();
    this._lingering = new Set();
    this._units = new Set();
    this._poses = new Map(); // graphic -> frame name to restore
    this._poseList = []; // same graphics, iterated per frame without allocating
    this._tinted = new Set(); // graphics this strike tinted (flash, struck crimson)
    this._dissolves = new Map(); // unit -> { key, graphic }
    this._zoomCamera = null;
    this._lastSoundAt = new Map();
    this.motes = null;
    this._travelState = { u: 0 };
    this._onPostUpdate = () => this._reassertPoses();
    this._poseGuard = false;
    // Bumped by reset() and destroy(): a sequence that started before (a strike, a
    // flight, a dissolve) sees it changed after its next await and stops there, so a
    // rewind, restore or shutdown mid-strike never lets it spawn or move anything more.
    this.epoch = 0;
    this.dead = false;
  }

  /** True once reset() or destroy() ran since `epoch` was read (see `epoch`). */
  stale(epoch) {
    return this.dead || this.epoch !== epoch;
  }

  // ------------------------------------------------------------------ settings --

  _reduced() {
    return Boolean(this.scene._reduceMotion?.());
  }

  _low() {
    return this.scene._effectsQuality?.() === 'low';
  }

  _speed() {
    return battleSpeed(this.scene);
  }

  _active() {
    return !this.scene.sys || this.scene.sys.isActive?.() !== false;
  }

  /**
   * May this controller draw? Not after destroy(), and not on a scene that is not
   * running (shut down, or still starting): anything made there would outlive the
   * scene's display list and leak into the next battle.
   */
  _live() {
    return !this.dead && this._active();
  }

  // ------------------------------------------------------------------ ownership --

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
    return tween;
  }

  _later(ms, callback) {
    let timer;
    timer = this.scene.time?.delayedCall?.(combatDuration(this.scene, ms), () => {
      this._timers.delete(timer);
      callback();
    });
    if (timer) this._timers.add(timer);
    return timer;
  }

  _own(obj) {
    if (obj) this._sprites.add(obj);
    return obj;
  }

  _dispose(obj) {
    if (!obj) return;
    this._sprites.delete(obj);
    this._lingering.delete(obj);
    obj.destroy?.();
  }

  _motePool() {
    if (!this.motes)
      this.motes = new FxMotePool(this.scene, { depth: MOTE_DEPTH, atlas: FX_ATLAS });
    return this.motes;
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
    this.clearPoses();
    // A strike cut short (rewind, shutdown, error) must not leave a unit flashed or red.
    for (const g of this._tinted) if (g && g.active !== false) g.clearTint?.();
    this._tinted.clear();
    if (this._zoomCamera) this._zoomCamera.setZoom(1);
    this._zoomCamera = null;
    // Strike-owned effects must settle even if a held speed override was released.
    for (const timer of this._timers) timer.remove?.(false);
    this._timers.clear();
    for (const sprite of this._sprites) {
      // An overlay still animating finishes its last frames on its own (it destroys
      // itself on completion); everything else goes now.
      if (sprite?._fxLinger && sprite.anims?.isPlaying && sprite.scene) this._lingering.add(sprite);
      else sprite.destroy?.();
    }
    this._sprites.clear();
  }

  /** Drop everything, including lingering overlays, motes and dissolves. */
  reset() {
    this.epoch++;
    // A strike cut short mid-lunge: the lunge / windup / return run as scene tweens on the
    // unit (awaited by the choreography, not owned by _motionTweens). Stop them (stop
    // fires onStop, which releases the awaiting step) so none carries the unit on after
    // finishStrike has put it home.
    for (const unit of this._units) {
      const g = unit?.graphic;
      if (g?._fxHomeX === undefined) continue;
      for (const tween of this.scene.tweens?.getTweensOf?.(g) || []) tween.stop?.();
    }
    this.finishStrike();
    for (const sprite of this._lingering) sprite.destroy?.();
    this._lingering.clear();
    this.motes?.releaseAll();
    for (const unit of [...this._dissolves.keys()]) this.releaseUnit(unit);
  }

  destroy() {
    this.reset();
    this.dead = true;
    for (const timer of this._timers) timer.remove?.(false);
    for (const sprite of this._sprites) sprite.destroy?.();
    this._timers.clear();
    this._sprites.clear();
    this.motes?.destroy();
    this.motes = null;
    this._stopPoseGuard();
  }

  /** A unit's graphic is going away (death, rewind, restore): free what refers to it. */
  releaseUnit(unit) {
    if (!unit) return;
    const g = unit.graphic;
    if (g) {
      if (this._poses.delete(g)) this._poseList.splice(this._poseList.indexOf(g), 1);
      if (g._fxHomeX !== undefined) this._clearHome(g);
    }
    this._units.delete(unit);
    const d = this._dissolves.get(unit);
    if (d) {
      this._dissolves.delete(unit);
      if (d.graphic?.scene && d.graphic.texture?.key === d.key) d.graphic.setVisible?.(false);
      if (d.graphic?.scene && d.graphic.texture?.key === d.key && d.restoreKey)
        d.graphic.setTexture?.(d.restoreKey, d.restoreFrame);
      if (this.scene.textures?.exists?.(d.key)) this.scene.textures.remove(d.key);
    }
  }

  get liveObjects() {
    return {
      strike: this._sprites.size,
      lingering: this._lingering.size,
      motes: this.motes?.liveCount ?? 0,
      tweens: this._motionTweens.size,
      timers: this._timers.size,
      dissolves: this._dissolves.size,
      poses: this._poses.size,
    };
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

  /** Unit vector from `fromG` toward `toG` (falls back to pointing down). */
  _dir(fromG, toG) {
    if (!fromG || !toG) return { nx: 0, ny: 1 };
    const dx = (toG._fxHomeX ?? toG.x) - (fromG._fxHomeX ?? fromG.x);
    const dy = (toG._fxHomeY ?? toG.y) - (fromG._fxHomeY ?? fromG.y);
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

  /** Tint a unit for this strike only (cleared by finishStrike if not before). */
  tintUnit(unit, color, { fill = false } = {}) {
    const g = unit?.graphic;
    if (!g) return;
    if (fill && g.setTintFill) g.setTintFill(color);
    else if (g.setTint) g.setTint(color);
    else return;
    this._tinted.add(g);
  }

  // ------------------------------------------------------------------ poses --

  /**
   * Traced sprites carry `windup` and `strike` frames. Hold one during the lunge;
   * units without them (rebuilt, classic, rectangles) simply keep their frame.
   */
  setPose(unit, pose) {
    const g = unit?.graphic;
    if (!g || !pose || typeof g.setFrame !== 'function' || !g.texture?.has?.(pose)) return false;
    if (!this._poses.has(g)) {
      this._poses.set(g, g.frame?.name ?? null);
      this._poseList.push(g);
    }
    g._fxPose = pose;
    if (g.frame?.name !== pose) g.setFrame(pose, false, false);
    if (!this._poseGuard && this.scene.events?.on) {
      // The traced idle ticker may repaint idle frames mid-lunge; win every frame.
      this.scene.events.on('postupdate', this._onPostUpdate);
      this._poseGuard = true;
    }
    return true;
  }

  _reassertPoses() {
    const list = this._poseList;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g.scene || !g._fxPose) continue;
      if (g.frame?.name !== g._fxPose && g.texture?.has?.(g._fxPose))
        g.setFrame(g._fxPose, false, false);
    }
  }

  clearPoses() {
    for (const [g, frame] of this._poses) {
      delete g._fxPose;
      if (!g.scene || typeof g.setFrame !== 'function') continue;
      const rest =
        frame && g.texture?.has?.(frame) && !['windup', 'strike'].includes(frame) ? frame : 'idle0';
      if (g.texture?.has?.(rest)) g.setFrame(rest, false, false);
    }
    this._poses.clear();
    this._poseList.length = 0;
    this._stopPoseGuard();
  }

  _stopPoseGuard() {
    if (this._poseGuard) this.scene.events?.off?.('postupdate', this._onPostUpdate);
    this._poseGuard = false;
  }

  // ------------------------------------------------------------------ ghosts --

  /** Afterimage of a unit's current frame, fading where it stood. */
  ghost(unit, { x, y, alpha = 0.42, fadeMs = 130, color = null } = {}) {
    const g = unit?.graphic;
    if (!g?.texture?.key || !g.frame || !this.scene.add?.image || this._low()) return null;
    if (!this._live()) return null;
    if (g.visible === false || !(g.alpha > 0.05)) return null;
    const img = this._own(
      this.scene.add
        .image(x ?? g.x, y ?? g.y, g.texture.key, g.frame.name)
        .setOrigin(g.originX ?? 0.5, g.originY ?? 0.5),
    );
    img.setScale?.(g.scaleX, g.scaleY);
    img.setFlipX?.(Boolean(g.flipX));
    img.setDepth?.((g.depth ?? 10) - 0.01);
    img.setBlendMode?.(Phaser.BlendModes.ADD);
    img.setTintFill?.(color ?? GHOST_BY_FACTION[unit.faction] ?? MOTE_COLORS.steel);
    img.setAlpha?.(alpha);
    this._motion({
      targets: img,
      alpha: 0,
      duration: fadeMs,
      ease: 'Quad.easeIn',
      onComplete: () => this._dispose(img),
    });
    return img;
  }

  // ------------------------------------------------------------------ motion --

  /**
   * Move the striker's sprite toward the target ("contact" point).
   * Awaits the forward motion; call lungeBack() after impact effects.
   * With no graphic, waits the legacy flash delay so pacing is unchanged.
   *
   * opts.windUp: brief pull-back before the lunge (offensive procs / arts).
   * opts.tempo 'followup' | 'ranged': shorter lunges (flurries; a draw or a cast).
   * opts.px: lunge distance; opts.ghost: leave afterimages; opts.pose: traced frames.
   */
  async lungeForward(striker, target, opts = {}) {
    if (!this._live()) return;
    const g = striker?.graphic;
    const reduced = this._reduced();
    const epoch = this.epoch;
    if (!g) {
      await this.scene._awaitSceneDelay(reduced ? 70 : 120, { label: 'combat_fx_lunge_fallback' });
      return;
    }
    this.settle(striker);
    if (target?.graphic) this.settle(target);
    const pose = opts.pose !== false;
    if (reduced) {
      if (pose) this.setPose(striker, 'strike');
      return;
    }
    const { nx, ny } = this._dir(g, target?.graphic);
    const followUp = opts.tempo === 'followup';
    const ranged = opts.tempo === 'ranged';
    if (pose) this.setPose(striker, 'windup');
    if (opts.windUp && !followUp) {
      await this.scene._awaitSceneTween(
        {
          targets: g,
          x: g._fxHomeX - nx * WINDUP_PX,
          y: g._fxHomeY - ny * WINDUP_PX,
          duration: STRIKE_TIMING.windup,
          ease: 'Quad.easeOut',
        },
        { label: 'combat_fx_windup' },
      );
      if (this.stale(epoch)) return;
    }
    const dist = opts.px ?? (followUp ? LUNGE_PX * 0.7 : LUNGE_PX);
    const duration = ranged
      ? STRIKE_TIMING.lunge.ranged
      : followUp
        ? STRIKE_TIMING.lunge.followUp
        : STRIKE_TIMING.lunge.melee;
    if (opts.ghost && g._fxHomeX !== undefined) {
      this.ghost(striker, { x: g._fxHomeX, y: g._fxHomeY, alpha: 0.38, fadeMs: 140 });
      this._later(duration * 0.55, () => this.ghost(striker, { alpha: 0.3, fadeMs: 110 }));
    }
    await this.scene._awaitSceneTween(
      {
        targets: g,
        x: g._fxHomeX + nx * dist,
        y: g._fxHomeY + ny * dist,
        duration,
        ease: ranged ? 'Sine.easeOut' : 'Quad.easeOut',
      },
      { label: 'combat_fx_lunge_forward' },
    );
    if (this.stale(epoch)) return;
    if (pose) this.setPose(striker, 'strike');
  }

  /**
   * Return the striker's sprite to its home tile, then clear stored homes on
   * both units. Clearing matters: units move between combats, so a stale home
   * must never survive past the strike (settle() would snap to it).
   * Settle owned reaction tweens explicitly: Instant can finish the hold first.
   * opts.wait false: the striker is already (nearly) home; just settle.
   */
  async lungeBack(striker, target, opts = {}) {
    const g = striker?.graphic;
    const epoch = this.epoch;
    if (g && g._fxHomeX !== undefined && opts.wait !== false) {
      if (!this._reduced())
        await this.scene._awaitSceneTween(
          {
            targets: g,
            x: g._fxHomeX,
            y: g._fxHomeY,
            duration: STRIKE_TIMING.recover.melee,
            ease: 'Quad.easeIn',
          },
          { label: 'combat_fx_lunge_back' },
        );
      if (this.stale(epoch)) return;
      if (g._fxHomeX !== undefined) {
        g.x = g._fxHomeX;
        g.y = g._fxHomeY;
      }
    }
    this.finishStrike(striker, target);
  }

  /** Ease a barely-moved (ranged) striker home during the hold; no wait. */
  driftHome(striker) {
    const g = striker?.graphic;
    if (!g || g._fxHomeX === undefined || this._reduced()) return;
    this._motion({
      targets: g,
      x: g._fxHomeX,
      y: g._fxHomeY,
      duration: STRIKE_TIMING.recover.ranged,
      ease: 'Quad.easeIn',
    });
  }

  /** Side-step for a missed strike, leaving an afterimage where the target stood. */
  dodge(target, striker, { ghost = false } = {}) {
    if (this._reduced()) return;
    const g = target?.graphic;
    if (!g || g._fxHomeX === undefined) return;
    const { nx, ny } = this._dir(striker?.graphic, g);
    // Perpendicular to the attack direction reads as a side-step.
    const px = -ny;
    const py = nx;
    if (ghost) this.ghost(target, { x: g._fxHomeX, y: g._fxHomeY, alpha: 0.5, fadeMs: 200 });
    this._motion({
      targets: g,
      x: g._fxHomeX + px * DODGE_PX,
      y: g._fxHomeY + py * DODGE_PX,
      duration: 80,
      hold: ghost ? 40 : 0,
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
  recoil(target, striker, px = RECOIL_PX) {
    if (this._reduced()) return;
    const g = target?.graphic;
    if (!g || g._fxHomeX === undefined) return;
    const { nx, ny } = this._dir(striker?.graphic, g);
    this._motion({
      targets: g,
      x: g._fxHomeX + nx * px,
      y: g._fxHomeY + ny * px,
      duration: px > RECOIL_PX ? 60 : 50,
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

  /**
   * Crit punch-up: a scale pop on the striker. No camera shake: Phaser's shake draws
   * Math.random every frame, which is the battle RNG during combat, and a shake whose
   * length depends on playback speed would change the next combat's rolls. The crit's
   * weight comes from the hit-stop, the ink vignette and the shock ring instead.
   */
  critImpact(striker) {
    if (this._reduced()) return;
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

  // ------------------------------------------------------------------ overlays --

  _atlasReady() {
    return Boolean(this.scene.textures?.exists?.(FX_ATLAS));
  }

  /** Register an effect's animations (every layer) once per game. */
  _ensureAnim(key) {
    const anims = this.scene.anims;
    const def = FX_ANIMS[key];
    if (!def || !anims?.exists) return false; // headless/stub scene: overlays are a no-op
    if (!this._atlasReady()) return false;
    for (const layer of def.layers) {
      const animKey = `${key}${layer.suffix}`;
      if (anims.exists(animKey)) continue;
      anims.create({
        key: animKey,
        frames: def.durations.map((duration, i) => ({
          key: FX_ATLAS,
          frame: `${animKey}/${i}`,
          duration,
        })),
        frameRate: 1000 / def.durations[0],
        repeat: def.loop ? -1 : 0,
      });
    }
    return true;
  }

  /**
   * Spawn an effect's layer sprites at (x, y). Returns the sprites (primary first) or
   * null. Frames are exact: rotation only in quarter turns for directional effects,
   * scale only in whole pixels.
   */
  _spawn(
    key,
    x,
    y,
    { rotation = 0, flipX = false, scale = 1, depth = FX_DEPTH, frame = 0, tint = null } = {},
  ) {
    const def = FX_ANIMS[key];
    if (!def || !this.scene.add?.sprite || !this._live()) return null;
    const sprites = [];
    def.layers.forEach((layer, n) => {
      const sprite = this.scene.add.sprite(x, y, FX_ATLAS, `${key}${layer.suffix}/${frame}`);
      sprite.setOrigin?.(def.anchor[0], def.anchor[1]);
      sprite.setDepth(n === 0 ? depth : depth + (layer.above ? 0.01 : -0.01));
      sprite.setBlendMode(layer.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      sprite.setRotation(rotation);
      if (flipX) sprite.setFlipX?.(true);
      sprite.setScale(Math.max(1, Math.round(scale)));
      if (tint !== null && layer.blend === 'add') sprite.setTint(tint);
      sprite._fxLayer = `${key}${layer.suffix}`;
      sprites.push(this._own(sprite));
    });
    return sprites;
  }

  /**
   * Play a one-shot effect at (x, y). Fire-and-forget; the sprites destroy themselves
   * when the animation ends. Omitted at low quality; one static frame with reduced
   * motion or at Instant speed.
   *   rotation / flipX  orientation (see strikePlan.facing)
   *   holdMs            hold the impact frame this long first (hit-stop), then play
   *   delay             stagger stacked bursts
   */
  playOverlay(key, x, y, opts = {}) {
    const { delay = 0 } = opts;
    if (this._low()) return;
    const def = FX_ANIMS[key];
    if (!def) return;
    const staticFrame = this._reduced() || this._speed() === 'instant';
    if (staticFrame ? !this._atlasReady() : !this._ensureAnim(key)) return;
    const spawn = () => {
      if (!this._active()) return;
      const frame = staticFrame ? staticFrameIndex(def) : 0;
      const sprites = this._spawn(key, x, y, { ...opts, frame: 0 });
      if (!sprites) return;
      const dispose = () => sprites.forEach((s) => this._dispose(s));
      if (staticFrame) {
        sprites.forEach((s, n) => s.setFrame(`${key}${def.layers[n].suffix}/${frame}`));
        this._later(250, dispose);
        return;
      }
      const timeScale = this._speed() === 'fast' ? 2 : 1;
      const start = (startFrame) => {
        sprites.forEach((s, n) => {
          if (s.active === false) return;
          if (s.anims) s.anims.timeScale = timeScale;
          s._fxLinger = true;
          s.play({ key: `${key}${def.layers[n].suffix}`, startFrame });
        });
      };
      sprites[0].once?.('animationcomplete', dispose);
      if (opts.holdMs > 0 && def.frames > 1) this._later(opts.holdMs, () => start(1));
      else start(0);
    };
    if (delay > 0) this._later(delay, spawn);
    else spawn();
  }

  /**
   * Weapon-family effect at the point of contact, plus the ink-lined starburst and
   * shock ring on crits. opts.signatureKey (Legendary art) replaces the weapon impact
   * with the signature effect; opts.holdMs holds the impact frame through hit-stop.
   */
  playImpact(event, striker, target, opts = {}) {
    const pts = unitPoints(target);
    if (!pts) return;
    const sg = striker?.graphic;
    const dx = pts.x - (sg?._fxHomeX ?? sg?.x ?? pts.x);
    const dy = pts.y - (sg?._fxHomeY ?? sg?.y ?? pts.y - 1);
    const face = facing(dx, dy);
    const holdMs = opts.holdMs || 0;
    const family =
      opts.family ||
      fxFamily(
        fxFamilyIdForWeapon(striker?.weapon, {
          distance: opts.distance ?? 1,
          entity: striker?.isEntity === true,
        }),
      );
    const key =
      opts.signatureKey && FX_ANIMS[opts.signatureKey] ? opts.signatureKey : family.impact;
    const def = FX_ANIMS[key];
    const orient = def?.directional ? face : { rotation: 0, flipX: false };
    this.playOverlay(key, pts.body.x, pts.body.y, { ...orient, holdMs });
    if (!opts.signatureKey && family.extra) {
      const extra = FX_ANIMS[family.extra];
      const reach = def?.directional ? 6 : 0;
      this.playOverlay(
        family.extra,
        pts.body.x + (face.flipX ? -reach : face.rotation ? 0 : reach),
        pts.body.y + (face.rotation ? Math.sign(face.rotation) * reach : 0),
        { holdMs, ...(extra?.directional ? orient : {}) },
      );
    }
    if (event?.isCrit) {
      this.playOverlay('fx_crit', pts.body.x, pts.body.y, { holdMs });
      this.playOverlay('fx_shock', pts.body.x, pts.body.y, { delay: holdMs });
    }
    if (opts.signatureKey) {
      this.playOverlay('fx_ring', pts.body.x, pts.body.y, { delay: holdMs });
      if (!event?.isCrit) this.playOverlay('fx_shock', pts.body.x, pts.body.y, { delay: holdMs });
    }
  }

  /**
   * Category effect overlays for a strike's procs (split comes from
   * splitStrikeActivations). Each proc's effect plays on the unit it
   * belongs to (drain on the striker, shield on the defender, ...).
   * Deduplicated per key+position; capped at 2 per strike to avoid clutter.
   * Drain also pulls crimson motes from the target to the striker.
   */
  playProcOverlays(split, striker, target, { seed = 0 } = {}) {
    if (this._low()) return;
    const seen = new Set();
    let played = 0;
    for (const entry of [...(split?.striker || []), ...(split?.target || [])]) {
      if (entry.id === 'weapon_art') continue; // arts get the ring burst
      const fx = fxForActivation(entry);
      if (!fx) continue;
      const dedupe = `${fx.key}@${fx.at}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const pts = unitPoints(fx.at === 'striker' ? striker : target);
      if (!pts) continue;
      this.playOverlay(fx.key, pts.body.x, pts.body.y);
      if (fx.key === 'fx_drain') this.moteStream(target, striker, { kind: 'drain', seed });
      if (++played >= 2) break;
    }
  }

  /**
   * Gilt rune ring under a weapon-art strike. Higher-tier arts stack extra, staggered
   * rings (Iron/Steel 1, Silver 2, Legendary 3).
   */
  playArtBurst(split, target, artCatalog) {
    if (this._low()) return;
    const pts = unitPoints(target);
    if (!pts) return;
    const artEntry = (split?.striker || []).find((e) => e.id === 'weapon_art');
    if (!artEntry) return;
    const art = findArtByName(artEntry.name, artCatalog);
    const bursts = this._reduced() ? 1 : artBurstsForTier(art?.tierAffinity);
    for (let i = 0; i < bursts; i++) {
      this.playOverlay('fx_ring', pts.body.x, pts.body.y, { delay: i * 90 });
    }
  }

  /** Heal: verdigris motes rising on the healed unit; with a source, motes cross first. */
  playHeal(x, y, { from = null, seed = 0 } = {}) {
    if (from && (from.x !== x || from.y !== y) && !this._reduced() && this._speed() !== 'instant') {
      this.moteStream({ x: from.x, y: from.y }, { x, y }, { kind: 'heal', seed, points: true });
      this.playOverlay('fx_heal', x, y, { delay: 90 });
    } else this.playOverlay('fx_heal', x, y);
  }

  /** Ailment overlay by type (sleep, silence, acid/poison, root; generic otherwise). */
  playStatus(x, y, conditionId = null, { from = null, seed = 0 } = {}) {
    if (from && !this._reduced() && this._speed() !== 'instant')
      this.moteStream({ x: from.x, y: from.y }, { x, y }, { kind: 'status', seed, points: true });
    this.playOverlay(statusFxKey(conditionId), x, y, { delay: from ? 90 : 0 });
  }

  /** Rising ember sparks for buffs and action refreshes (Dance). */
  playBuff(x, y) {
    this.playOverlay('fx_buff', x, y);
  }

  /** Ground reaction at a unit's feet, chosen by the terrain it stands on. */
  playDust(unit, striker) {
    if (this._low() || this._reduced() || this._speed() === 'instant') return;
    const pts = unitPoints(unit);
    const grid = this.scene.grid;
    if (!pts || !grid) return;
    const terrain = grid.getTerrainAt?.(unit.col, unit.row)?.name;
    const biome = this.scene.battleConfig?.biome || grid.biome || null;
    const key = dustKeyFor(terrain, biome);
    const sg = striker?.graphic;
    const flipX = sg ? (sg._fxHomeX ?? sg.x) > pts.x : false;
    this.playOverlay(key, pts.feet.x, pts.feet.y, {
      flipX,
      depth: (unit.graphic.depth ?? 10) + 0.02,
    });
  }

  // ------------------------------------------------------------------ beats --

  /** Soft ink texture for the crit vignette (a transparent hole in darkness). */
  _vignetteTexture() {
    const textures = this.scene.textures;
    if (textures?.exists?.(VIGNETTE_KEY)) return true;
    if (!textures?.createCanvas || typeof document === 'undefined') return false;
    const size = 128;
    const tex = textures.createCanvas(VIGNETTE_KEY, size, size);
    const ctx = tex?.getContext?.();
    if (!ctx) return false;
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(7,6,11,0)');
    g.addColorStop(0.1, 'rgba(7,6,11,0)');
    g.addColorStop(0.28, 'rgba(7,6,11,0.85)');
    g.addColorStop(1, 'rgba(7,6,11,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
    tex.setFilter?.(LINEAR);
    return true;
  }

  /**
   * A short ink vignette pulse around a point: the world darkens around the blow for
   * a beat (no displacement, no randomness). Covers the view from any impact point.
   */
  vignettePulse(x, y, { peak = 0.5, inMs = 40, holdMs = 60, outMs = 220 } = {}) {
    if (this._low() || this._reduced() || this._speed() === 'instant' || !this._live()) return;
    if (!this.scene.add?.image || !this._vignetteTexture()) return;
    const cam = this.scene.cameras?.main;
    const zoom = cam?.zoom || 1;
    const view = Math.max(cam?.width || 640, cam?.height || 480) / zoom;
    const size = Math.max(1400, view * 2.6);
    const img = this._own(this.scene.add.image(x, y, VIGNETTE_KEY));
    img.setDisplaySize(size, size).setDepth(VIGNETTE_DEPTH).setAlpha(0);
    this._motion({
      targets: img,
      alpha: peak,
      duration: inMs,
      ease: 'Quad.easeOut',
      onComplete: () =>
        this._motion({
          targets: img,
          alpha: 0,
          delay: holdMs,
          duration: outMs,
          ease: 'Sine.easeIn',
          onComplete: () => this._dispose(img),
        }),
    });
  }

  /**
   * Night maps: the blow briefly lights (or, for unlight, darkens) the ground around
   * the impact, above the darkness layer and below the units.
   */
  impactLight(x, y, color) {
    if (!color || this._low() || this._reduced() || this._speed() === 'instant') return;
    if (!this._live()) return;
    if (!this.scene._atmosphere?.light || !this.scene.textures?.exists?.(GLOW_KEY)) return;
    const img = this._own(this.scene.add.image(x, y + 6, GLOW_KEY));
    const unlight = color === 'unlight';
    img.setDisplaySize(unlight ? 88 : 104, unlight ? 88 : 104).setDepth(IMPACT_LIGHT_DEPTH);
    img.setBlendMode(unlight ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
    img.setTint(unlight ? MOTE_COLORS.unlight : color);
    img.setAlpha(unlight ? 0.5 : 0.48);
    this._motion({
      targets: img,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeIn',
      onComplete: () => this._dispose(img),
    });
  }

  /** Burst of seeded motes at a point (hits, signature climaxes, boss ignition). */
  moteBurst(
    x,
    y,
    {
      count = 12,
      colors,
      radius = 18,
      rise = 10,
      lifeMs = 520,
      seed = 0,
      blend = 'add',
      size = 1,
    } = {},
  ) {
    if (this._low() || this._reduced() || this._speed() === 'instant' || !this._live()) return;
    const pool = this._motePool();
    const rand = fxRandom(seed);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = radius * (0.4 + 0.6 * rand());
      pool.spawn({
        x,
        y,
        dx: Math.cos(a) * d,
        dy: Math.sin(a) * d * 0.7 - rise * (0.5 + rand()),
        curve: 1,
        sway: 1 + rand() * 1.5,
        cycles: 1 + rand(),
        phase: rand() * 6.28,
        lifeMs: combatDuration(this.scene, lifeMs * (0.7 + 0.5 * rand())),
        size: rand() < 0.3 ? size + 1 : size,
        colors,
        alpha: [1, 0],
        blend,
      });
    }
  }

  /**
   * Motes carried from one unit (or point) to another: drain (crimson, pulled toward
   * the striker), heal and status (verdigris / violet, from caster to target).
   */
  moteStream(from, to, { kind = 'heal', seed = 0, points = false, ms = 180 } = {}) {
    if (this._low() || this._reduced() || this._speed() === 'instant' || !this._live()) return;
    const a = points ? from : unitPoints(from)?.body;
    const b = points ? to : unitPoints(to)?.body;
    if (!a || !b) return;
    const colors =
      kind === 'drain'
        ? [MOTE_COLORS.crimsonHot, MOTE_COLORS.crimson, MOTE_COLORS.crimsonDim]
        : kind === 'status'
          ? [MOTE_COLORS.violetPale, MOTE_COLORS.violet, MOTE_COLORS.violetDim]
          : kind === 'light'
            ? [MOTE_COLORS.gilt, MOTE_COLORS.ember, MOTE_COLORS.emberDim]
            : [MOTE_COLORS.verdigrisPale, MOTE_COLORS.verdigris, MOTE_COLORS.verdigrisDim];
    const pool = this._motePool();
    const rand = fxRandom(seed ^ 0x5bd1e995);
    const n = kind === 'drain' ? 9 : 7;
    for (let i = 0; i < n; i++) {
      const jx = (rand() - 0.5) * 12;
      const jy = (rand() - 0.5) * 10;
      pool.spawn({
        x: a.x + jx,
        y: a.y + jy,
        dx: b.x - a.x - jx * 0.5,
        dy: b.y - a.y - jy * 0.5,
        curve: kind === 'drain' ? 2 : 1,
        sway: 2 + rand() * 2,
        cycles: 0.5 + rand() * 0.5,
        phase: rand() * 6.28,
        delayMs: combatDuration(this.scene, i * 18),
        lifeMs: combatDuration(this.scene, ms + rand() * 60),
        size: rand() < 0.35 ? 1 : 0,
        colors,
        alpha: [1, 0.2],
      });
    }
  }

  // ------------------------------------------------------------------ travel --

  /**
   * Fly the family's projectile from striker to target (awaited). Arrows arc (higher
   * for longer shots), bolts chain jagged segments, streams roll puffs, heal/holy
   * light sends motes. `miss` flies past the target. Skips (no wait) when either
   * unit is hidden or effects are off.
   */
  async travel(family, striker, target, { tiles = 1, miss = false, ms = 90, seed = 0 } = {}) {
    const proj = family?.projectile;
    const a = pointOf(striker);
    const b = pointOf(target);
    const sg = striker?.graphic;
    const tg = target?.graphic;
    if (!proj || !a || !b || this._low() || this._reduced() || this._speed() === 'instant') return;
    if (!this._live()) return;
    if (sg?.visible === false || tg?.visible === false || !this._atlasReady()) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Leave from the striker's leading edge; a miss sails a tile past the target.
    const sx = a.x + ux * 10;
    const sy = a.y + uy * 10;
    const over = miss ? 22 : 0;
    const ex = b.x + ux * over - ux * (miss ? 0 : 6);
    const ey = b.y + uy * over - uy * (miss ? 0 : 6) + (miss ? 7 : 0);
    const height = proj.kind === 'arc' ? arcHeight(tiles, proj.arc ?? 1) : 0;
    const pool = this._motePool();
    const rand = fxRandom(seed);
    const sprites = [];
    const def = FX_ANIMS[proj.key];
    const animate = def && def.frames > 1 && proj.kind !== 'bolt' && this._ensureAnim(proj.key);
    const makeSprite = (frame = 0) => {
      const s = this._spawn(proj.key, sx, sy, { frame, depth: PROJECTILE_DEPTH });
      if (!s) return null;
      if (animate)
        s.forEach((sp, n) => {
          if (sp.anims) sp.anims.timeScale = this._speed() === 'fast' ? 2 : 1;
          sp.play({ key: `${proj.key}${def.layers[n].suffix}` });
        });
      sprites.push(s);
      return s;
    };
    let chain = null;
    if (proj.kind === 'bolt') {
      // Thunder: the bolt forms along the whole path at once and flickers.
      const segs = Math.max(1, Math.round(len / 32));
      const segLen = len / segs;
      const ang = Math.atan2(dy, dx);
      chain = [];
      for (let k = 0; k < segs; k++) {
        const frame = Math.floor(rand() * 4);
        const s = this._spawn(proj.key, a.x + ux * segLen * k, a.y + uy * segLen * k, {
          frame,
          rotation: ang,
          depth: PROJECTILE_DEPTH,
        });
        if (!s) continue;
        s.forEach((sp) => sp.setScale?.(segLen / 32, 1));
        chain.push({ sprites: s, frame });
      }
    } else if (proj.kind === 'stream') {
      for (let k = 0; k < 3; k++) makeSprite(k % 4);
    } else if (proj.kind !== 'motes') {
      makeSprite(0);
    }
    if (proj.kind === 'motes') {
      this.moteStream(
        { x: sx, y: sy },
        { x: ex, y: ey },
        { kind: family.impact === 'fx_light' ? 'light' : 'heal', seed, points: true, ms },
      );
    }
    const directional = Boolean(def?.directional);
    const epoch = this.epoch;
    const state = this._travelState;
    state.u = 0;
    let lastTrail = -1;
    let lastFlicker = -1;
    const place = () => {
      const u = state.u;
      if (chain) {
        const step = Math.floor(u * 4);
        if (step !== lastFlicker) {
          lastFlicker = step;
          for (const c of chain) {
            c.frame = (c.frame + 1 + Math.floor(rand() * 2)) % 4;
            c.sprites.forEach((sp) => sp.setFrame?.(`${proj.key}/${c.frame}`));
          }
        }
        return;
      }
      // Per-frame path: plain loops, no allocation.
      const stream = proj.kind === 'stream';
      const tx = ex - sx;
      for (let k = 0; k < sprites.length; k++) {
        const lag = stream ? k * 0.2 : 0;
        const v = Math.max(0, Math.min(1, (u - lag) / (stream ? 0.6 : 1)));
        const x = sx + tx * v;
        const y = sy + (ey - sy) * v - height * 4 * v * (1 - v);
        // Tangent of the arc for the heading (flat for straight flights).
        const heading = directional ? Math.atan2(ey - sy - height * 4 * (1 - 2 * v), tx) : 0;
        const visible = !stream || (u >= lag && v < 1);
        const layers = sprites[k];
        for (let n = 0; n < layers.length; n++) {
          const sp = layers[n];
          sp.setPosition?.(x, y);
          if (directional) sp.setRotation(heading);
          sp.setVisible?.(visible);
        }
      }
      // Trail motes (pooled): a few per flight, never per frame.
      if (proj.trail && sprites.length) {
        const slot = Math.floor(u * 7);
        if (slot !== lastTrail && slot < 7) {
          lastTrail = slot;
          const [s0] = sprites[0];
          pool.spawn({
            x: s0.x,
            y: s0.y,
            dx: (rand() - 0.5) * 3,
            dy: -2 - rand() * 3,
            curve: 1,
            lifeMs: combatDuration(this.scene, 160 + rand() * 80),
            size: 0,
            colors: [proj.trail, proj.trail, lerpColor(proj.trail, 0, 0.5)],
            alpha: [0.9, 0],
          });
        }
      }
    };
    place();
    await this.scene._awaitSceneTween(
      { targets: state, u: 1, duration: ms, ease: 'Linear', onUpdate: place },
      {
        label: 'combat_fx_travel',
        onCancel: () => sprites.flat().forEach((s) => this._dispose(s)),
      },
    );
    state.u = 1;
    for (const s of sprites) s.forEach((sp) => this._dispose(sp));
    if (this.stale(epoch)) return;
    if (chain) {
      // The bolt lingers one flicker past contact, then goes.
      const keep = chain.flatMap((c) => c.sprites);
      this._later(40, () => keep.forEach((sp) => this._dispose(sp)));
    }
  }

  /**
   * A ballista bolt from its emplacement to the target (awaited travel, then the
   * impact). The shot is already resolved; this is only its flight.
   */
  async ballistaShot(ballista, target, { hit = true, seed = 0 } = {}) {
    if (!this._live()) return;
    const grid = this.scene.grid;
    if (!ballista || !target?.graphic || !grid?.gridToPixel) return;
    if (grid.fogEnabled && grid.isVisible && !grid.isVisible(ballista.col, ballista.row)) return;
    const from = grid.gridToPixel(ballista.col, ballista.row);
    const family = fxFamily('ballista');
    const tiles = Math.abs(ballista.col - target.col) + Math.abs(ballista.row - target.row) || 1;
    const ms = Math.min(220, 50 + 16 * tiles);
    const epoch = this.epoch;
    await this.travel(family, { x: from.x, y: from.y - 4 }, target, {
      tiles,
      miss: !hit,
      ms,
      seed,
    });
    if (!hit || this.stale(epoch) || !target.graphic) return;
    const pts = unitPoints(target);
    const face = facing(pts.x - from.x, pts.y - from.y);
    const emplacement = { graphic: { x: from.x, y: from.y } };
    this.settle(target);
    this.playOverlay(family.impact, pts.body.x, pts.body.y, { ...face, holdMs: 60 });
    this.playDust(target, emplacement);
    // A heavy bolt: the same held impact frame and knockback as a strike, then home.
    this.tintUnit(target, MOTE_COLORS.emberHot, { fill: true });
    // Instant and reduced motion add no wait (a 1 ms delay still costs a frame).
    if (!this._reduced() && this._speed() !== 'instant')
      await this.scene._awaitSceneDelay(STRIKE_TIMING.hitStop.normal, {
        label: 'combat_fx_hit_stop',
      });
    if (this.stale(epoch)) return;
    this.tintUnit(target, MOTE_COLORS.crimson);
    this.recoil(target, emplacement, STRIKE_TIMING.knockPx.heavy);
    this._later(150, () => this.finishStrike(target));
  }

  /** Boss enrage: a crown of crimson flame, an ink beat and embers rising. */
  playEnrage(boss) {
    const pts = unitPoints(boss);
    if (!pts) return;
    this.playOverlay('fx_sig_enrage', pts.body.x, pts.body.y - 4);
    this.vignettePulse(pts.body.x, pts.body.y, { peak: 0.4, holdMs: 120, outMs: 360 });
    this.moteBurst(pts.body.x, pts.body.y, {
      count: 16,
      radius: 24,
      rise: 26,
      lifeMs: 800,
      colors: [MOTE_COLORS.emberHot, MOTE_COLORS.crimson, MOTE_COLORS.crimsonDeep],
      seed: fxSeed(boss.battleEntityId || boss.name, this.scene.turnManager?.turnNumber, 'enrage'),
    });
  }

  // ------------------------------------------------------------------ death --

  /**
   * "Fading to embers": the unit's own pixels break up and drift upward as motes,
   * then the sprite is gone. Bosses burn bigger; the Entity collapses into unlight.
   * Reduced motion / Instant / low quality keep the short legacy fade.
   */
  async deathFade(unit) {
    const g = unit?.graphic;
    if (!g || !this._live()) return;
    const reduced = this._reduced();
    this.scene.tweens.killTweensOf(g);
    const others = [
      unit.label,
      unit.factionIndicator,
      unit.hpBar?.bg,
      unit.hpBar?.fill,
      ...(unit.affixPips || []),
    ].filter(Boolean);
    const styleId = deathStyleFor(unit);
    const style = DEATH_STYLES[styleId];
    const plan = planDeath(style, {
      speed: this._speed(),
      reduced,
      quality: this.scene._effectsQuality?.(),
    });
    const epoch = this.epoch;
    const dissolve = plan.mode === 'full' ? this._prepareDissolve(unit, style) : null;
    if (!dissolve) {
      if (!reduced && g.setTintFill) g.setTintFill(plan.mode === 'low' ? style.edge : 0xffffff);
      await this.scene._awaitSceneTween(
        {
          targets: [g, ...others],
          alpha: 0,
          duration: reduced ? 140 : 300,
          ease: 'Quad.easeIn',
        },
        { label: 'combat_fx_death_fade' },
      );
      return;
    }
    const pts = unitPoints(unit);
    const seed = fxSeed(
      unit.battleEntityId || unit.name,
      this.scene.turnManager?.turnNumber,
      'death',
    );
    if (styleId === 'boss') {
      this.vignettePulse(pts.body.x, pts.body.y, { peak: 0.45, holdMs: 160, outMs: 380 });
      this.playOverlay('fx_shock', pts.body.x, pts.body.y);
      this.playOverlay('fx_ring', pts.body.x, pts.body.y, { delay: 120 });
    }
    if (styleId === 'entity') this.playOverlay('fx_sig_entity', pts.body.x, pts.body.y);
    // One budget per death (<= 60 live motes): the Entity spends a third of it on
    // the violet sparks it pulls inward, so its body gives up fewer pixels.
    const budget = plan.motes;
    const motes = pickMotes(dissolve.d, style.inward ? Math.round(budget * 0.67) : budget, seed);
    let extras = budget - motes.length; // inward sparks the Entity may still spend
    let next = 0;
    let lastStep = -1;
    const state = { p: 0 };
    const pool = this._motePool();
    const rand = fxRandom(seed ^ 0x2545f491);
    const [riseMin, riseMax] = style.rise;
    const [lifeMin, lifeMax] = style.lifeMs;
    const repaint = () => {
      if (this.stale(epoch) || !this._dissolves.has(unit)) return;
      const step = Math.min(plan.steps, Math.floor(state.p * plan.steps + 0.0001));
      if (step !== lastStep) {
        lastStep = step;
        paintDissolve(dissolve.d, dissolve.src, dissolve.out.data, step / plan.steps, style.edge);
        dissolve.ctx.putImageData(dissolve.out, 0, 0);
        dissolve.tex.refresh();
      }
      while (next < motes.length && motes[next].t <= state.p) {
        const m = motes[next++];
        const wx = dissolve.toWorldX(m.bx);
        const wy = dissolve.toWorldY(m.by);
        const rise = riseMin + (riseMax - riseMin) * rand();
        const inward = style.inward;
        pool.spawn({
          x: wx,
          y: wy,
          dx: inward ? (pts.body.x - wx) * 0.8 : (rand() - 0.5) * 10,
          dy: inward ? (pts.body.y - wy) * 0.8 + rise : -rise,
          curve: inward ? 2 : 1,
          sway: inward ? 0.5 : 1.5 + rand() * 2,
          cycles: 0.6 + rand(),
          phase: rand() * 6.28,
          lifeMs: combatDuration(this.scene, lifeMin + (lifeMax - lifeMin) * rand()),
          size: rand() < 0.45 ? 1 : 0,
          colors: [m.color, style.heat[rand() < 0.5 ? 0 : 1], style.heat[3]],
          alpha: [1, 0],
          blend: style.blend,
        });
        if (inward && extras > 0 && rand() < 0.5) {
          extras--;
          pool.spawn({
            x: wx,
            y: wy,
            dx: (pts.body.x - wx) * 0.9,
            dy: (pts.body.y - wy) * 0.9,
            curve: 2,
            lifeMs: combatDuration(this.scene, lifeMin * 0.8),
            size: 0,
            colors: [style.heat[0], style.heat[1], style.heat[2]],
            alpha: [0.9, 0],
            blend: 'add',
          });
        }
      }
    };
    repaint();
    this._motion({ targets: others, alpha: 0, duration: plan.baseMs, ease: 'Quad.easeIn' });
    await this.scene._awaitSceneTween(
      { targets: state, p: 1, duration: plan.baseMs, ease: 'Linear', onUpdate: repaint },
      { label: 'combat_fx_death_fade' },
    );
    // A rewind or shutdown mid-dissolve already released the texture (releaseUnit).
    if (this.stale(epoch) || !this._dissolves.has(unit)) return;
    state.p = 1;
    repaint();
    if (g.scene) g.setAlpha?.(0);
    for (const o of others) o.setAlpha?.(0);
  }

  /** Copy the unit's current frame into a canvas texture the dissolve can erase. */
  _prepareDissolve(unit, style) {
    const g = unit.graphic;
    const scene = this.scene;
    const frame = g?.frame;
    if (!frame || !g.texture?.key || frame.trimmed || typeof document === 'undefined') return null;
    if (!scene.textures?.createCanvas || !scene.add?.image) return null;
    try {
      const w = Math.round(frame.cutWidth);
      const h = Math.round(frame.cutHeight);
      if (!(w > 0 && h > 0) || w > 512 || h > 512) return null;
      const source = frame.source?.image;
      if (!source) return null;
      const key = `fx-dissolve-${++dissolveSeq}`;
      const tex = scene.textures.createCanvas(key, w, h);
      const ctx = tex?.getContext?.();
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
      const src = ctx.getImageData(0, 0, w, h).data.slice();
      const out = ctx.createImageData(w, h);
      // Blocks of ~2 world px whatever the texture density.
      const worldPerPx = Math.abs(g.scaleX || 1);
      const block = Math.max(1, Math.round(2 / worldPerPx));
      const d = buildDissolve(src, w, h, {
        block,
        seed: fxSeed(unit.battleEntityId || unit.name, 'dissolve'),
        inward: Boolean(style.inward),
      });
      const restoreKey = g.texture.key;
      const restoreFrame = frame.name;
      g.clearTint?.();
      g.setAlpha?.(1);
      g.setTexture(key);
      this._dissolves.set(unit, { key, graphic: g, restoreKey, restoreFrame });
      const ox = g.originX ?? 0.5;
      const oy = g.originY ?? 0.5;
      const sx = g.scaleX || 1;
      const sy = g.scaleY || 1;
      const flip = g.flipX ? -1 : 1;
      const x0 = g.x;
      const y0 = g.y;
      return {
        d,
        src,
        out,
        ctx,
        tex,
        toWorldX: (bx) => x0 + flip * ((bx + 0.5) * block - w * ox) * sx,
        toWorldY: (by) => y0 + ((by + 0.5) * block - h * oy) * sy,
      };
    } catch (err) {
      console.warn('[CombatFx] dissolve unavailable:', err?.message || err);
      return null;
    }
  }
}
