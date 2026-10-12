/**
 * ScreenShakeController — a short camera shake for heavy blows (presentation only).
 *
 * How it moves the picture: it never writes the camera's scroll, zoom or position. While a
 * shake plays it listens to the WORLD camera's `prerender` event (Phaser emits it after
 * the camera has built its matrix for the frame, before any object is drawn) and adds the
 * shake's offset to that matrix's translation, the same seam Phaser's own shake uses. The
 * matrix is rebuilt from scroll/zoom/position every frame, so when the shake ends, is
 * replaced, interrupted or torn down the camera is exactly where its owner left it: there
 * is no home position to restore and nothing to drift (a pinch pan or a recentre in the
 * middle of a shake just carries on). The offsets are in screen pixels, whatever the zoom.
 *
 * Rules:
 *   - Only the world camera. A separate UI camera is required (the phone's pinned one,
 *     BattleScene._uiCamera, or desktop's ungraded one, AtmosphereController.uiCamera), and
 *     it is never touched, so the HUD and menus hold still. With no separate UI camera the
 *     HUD would share the shaken picture, so there is no shake.
 *   - Never Math.random: the offsets come from the plan's own seeded generator
 *     (art/combatFx/screenShake.js). During a battle Math.random is the battle RNG.
 *   - Off with Reduce motion (read the way CombatFxController does) and at Instant speed;
 *     Fast halves the length. No setting of its own.
 *   - Orthogonal to the portrait battle's board turn: that is a Grid presentation transform,
 *     not a camera one, so the two compose.
 *   - One shake at a time: a new one replaces the one playing only if it starts at least as
 *     strong as what is left of it, else it is dropped.
 */

import { combatDuration, battleSpeed } from '../utils/combatTiming.js';
import {
  SHAKE_KINDS,
  planShake,
  shakeEnvelope,
  shakeOffsetAt,
  shakeSeed,
} from '../art/combatFx/screenShake.js';

/** Phaser.Cameras.Scene2D.Events.PRE_RENDER (kept as a literal: no Phaser import here). */
export const CAMERA_PRE_RENDER = 'prerender';

export class ScreenShakeController {
  constructor(scene) {
    this.scene = scene;
    this._camera = null; // the camera the listener sits on
    this._active = null; // { plan, startedAt }
    this._count = 0; // shakes started, the seed's counter
    this.dead = false;
    this._onPreRender = (camera) => this._apply(camera);
  }

  /** Is a shake playing right now. */
  get playing() {
    return this._active !== null;
  }

  _reduced() {
    return Boolean(this.scene?._reduceMotion?.());
  }

  _now() {
    return this.scene?.time?.now ?? globalThis.performance?.now?.() ?? Date.now();
  }

  /** The world camera, only when the UI is drawn by a camera of its own. */
  _worldCamera() {
    const scene = this.scene;
    const main = scene?.cameras?.main;
    if (!main) return null;
    const ui = scene._uiCamera || scene._atmosphere?.uiCamera;
    if (!ui || ui === main) return null;
    return main;
  }

  /**
   * Start a shake: a kind name from SHAKE_KINDS, or `{ intensity, durationMs }`.
   * Returns true when one started. Presentation only: it never throws.
   */
  shake(spec, { seed } = {}) {
    try {
      if (this.dead || !this.scene || this._reduced()) return false;
      if (this.scene.sys?.isActive?.() === false) return false;
      if (battleSpeed(this.scene) === 'instant') return false;
      const kind = typeof spec === 'string' ? spec : null;
      const base = kind ? SHAKE_KINDS[kind] : spec;
      if (!base) return false;
      const camera = this._worldCamera();
      if (!camera?.on) return false;
      const plan = planShake({
        seed: seed ?? shakeSeed(kind || 'custom', this._count),
        intensity: base.intensity,
        durationMs: combatDuration(this.scene, base.durationMs),
      });
      if (plan.offsets.length === 0) return false;
      const now = this._now();
      const current = this._active;
      if (current) {
        const left =
          current.plan.intensity *
          shakeEnvelope((now - current.startedAt) / current.plan.durationMs);
        if (plan.intensity < left) return false;
      }
      this._count++;
      if (this._camera && this._camera !== camera) this._detach();
      this._active = { plan, startedAt: now };
      if (!this._camera) {
        camera.on(CAMERA_PRE_RENDER, this._onPreRender);
        this._camera = camera;
      }
      return true;
    } catch (err) {
      console.warn('[ScreenShake] shake failed:', err?.message || err);
      this._stop();
      return false;
    }
  }

  /** Per camera frame: add this frame's offset to the matrix, or let go once it is over. */
  _apply(camera) {
    try {
      const active = this._active;
      if (!active || this.dead || this._reduced()) {
        this._stop();
        return;
      }
      const elapsed = this._now() - active.startedAt;
      if (!(elapsed < active.plan.durationMs)) {
        this._stop();
        return;
      }
      const { x, y } = shakeOffsetAt(active.plan, elapsed);
      const matrix = (camera || this._camera)?.matrix;
      if (matrix && (x !== 0 || y !== 0)) {
        matrix.tx += x;
        matrix.ty += y;
      }
    } catch (err) {
      console.warn('[ScreenShake] frame failed:', err?.message || err);
      this._stop();
    }
  }

  _detach() {
    const camera = this._camera;
    this._camera = null;
    try {
      camera?.off?.(CAMERA_PRE_RENDER, this._onPreRender);
    } catch {
      /* a camera already destroyed with its scene */
    }
  }

  _stop() {
    this._active = null;
    this._detach();
  }

  /** Cut any shake now (a rewind, a restore): the picture is at rest from the next frame. */
  reset() {
    this._stop();
    this._count = 0;
  }

  destroy() {
    this.dead = true;
    this._stop();
    this.scene = null;
  }
}
