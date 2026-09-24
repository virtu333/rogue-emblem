// AtmosphereController — act moods for a live battle (create()/destroy() controller).
//
// Picks the grade from the run's act and the map biome (pure resolveAtmosphere), applies
// it as a post-process on the MAIN battle camera only, and adds the night light layer
// for night moods. Follows the Atmosphere setting (Full / Reduced / Off) live.
//
// UI is never graded. Phones already render screen UI through BattleScene's pinned UI
// camera (and the DOM HUD). Desktop has one camera, so while a grade is active this
// controller adds an ungraded UI camera that mirrors the main camera's view exactly and
// routes every object at or above UI_DEPTHS.SCREEN_UI (the HUD, menus, banners,
// overlays) to it; the world below that depth stays on the graded main camera. Draw
// order and positions are unchanged because both cameras share one transform.
//
// Canvas renderer, missing WebGL and headless test mocks: silently Off.
// Presentation only: no game state, RNG, save or timing is touched.

import {
  resolveAtmosphere,
  resolveAtmosphereMode,
  lightOptionsForMode,
} from '../art/atmosphereConfig.js';
import { applyAtmosphere, clearAtmosphere, atmosphereSupported } from '../art/AtmosphereFX.js';
import { BattleLightLayer } from '../art/BattleLightLayer.js';
import { detectMobileRuntime } from '../utils/runtimeFlags.js';
import { BATTLEFIELD_LAB_MAPS } from '../utils/battlefieldLabMaps.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { isEntity } from '../engine/EntitySystem.js';

function devQuery() {
  if (!import.meta.env?.DEV) return null;
  return new URLSearchParams(globalThis.location?.search || '');
}

/** Gather the pure resolver's inputs from a BattleScene (read-only). */
export function atmosphereContextFromScene(scene) {
  const params = scene?.battleParams || {};
  const query = devQuery();
  let act = params.act || 'act1';
  // Dev battlefield lab maps generate a different act's template than the preset's
  // battleParams; review them in their own act's mood (mirrors BattleScene's lab path).
  if (query?.get('battleLab') === '1' && !params.tutorialMode && !scene?._resumeCheckpoint) {
    const lab = BATTLEFIELD_LAB_MAPS.find((map) => map.id === query.get('labMap'));
    if (lab) act = lab.act;
  }
  const enemies = scene?.enemyUnits || [];
  return {
    act,
    biome: scene?.battleConfig?.biome || scene?.grid?.biome || null,
    isBoss: Boolean(scene?.isBoss),
    isSecret: act === 'secretAct',
    isFinalBoss: act === 'finalBoss',
    isTutorial: Boolean(params.tutorialMode),
    hasEntity: enemies.some((u) => isEntity(u)),
    override: query?.get('atmosphere') || null,
  };
}

export class AtmosphereController {
  constructor(scene) {
    this.scene = scene;
    this.state = { mode: 'off', supported: false, gradeKey: null, label: null, night: false };
    this.light = null;
    this.uiCamera = null;
    this._signature = null;
    this._unsubscribe = null;
    this._onPreRender = null;
    this._onResize = null;
    this.destroyed = false;
  }

  create() {
    try {
      const game = this.scene?.sys?.game;
      this.state.supported = atmosphereSupported(game);
      this.atmosphere = resolveAtmosphere(atmosphereContextFromScene(this.scene));
      Object.assign(this.state, {
        gradeKey: this.atmosphere.gradeKey,
        label: this.atmosphere.label,
        night: this.atmosphere.night,
      });
      const settings = this.scene?.registry?.get?.('settings');
      this._unsubscribe = settings?.onChange?.(() => this.refresh()) || null;
      this.refresh();
    } catch (error) {
      // Presentation must never break a battle.
      console.warn('[Atmosphere] disabled:', error?.message || error);
      this._teardownVisuals();
    }
    return this;
  }

  _preference() {
    const forced = devQuery()?.get('atmosphereMode');
    if (['full', 'reduced', 'off'].includes(forced)) return forced;
    return this.scene?.registry?.get?.('settings')?.getAtmosphere?.() || 'auto';
  }

  _modeInfo() {
    const settings = this.scene?.registry?.get?.('settings');
    return resolveAtmosphereMode(this._preference(), {
      mobile: detectMobileRuntime(),
      webgl: this.state.supported,
      effectsQuality: settings?.getEffectsQuality?.(),
      reduceMotion: settings?.getReduceMotion?.(),
    });
  }

  /** Re-read settings and apply if anything that matters changed. */
  refresh() {
    if (this.destroyed || !this.atmosphere) return;
    const info = this._modeInfo();
    const signature = `${info.mode}|${info.flicker}|${info.animatedGrain}`;
    if (signature === this._signature) return;
    this._signature = signature;
    this.state.mode = info.mode;
    if (info.mode === 'off') {
      this._teardownVisuals();
      return;
    }
    withPresentationRandom(() => {
      this._ensureUiCamera();
      applyAtmosphere(this.scene.cameras?.main, this.atmosphere.grade, {
        mode: info.mode,
        animatedGrain: info.animatedGrain,
        frameProvider: () => this.frameUv(),
      });
      this._applyLight(info);
    });
  }

  /**
   * The visible battlefield (map ∩ camera view) in framebuffer UV (v runs bottom-up),
   * so the vignette and key light frame the map rather than the empty canvas margin.
   */
  frameUv() {
    const scene = this.scene;
    const cam = scene?.cameras?.main;
    const bounds = scene?._getBattleMapBounds?.();
    if (!cam || !bounds || !cam.width || !cam.height) return null;
    const view = cam.worldView;
    const zoom = cam.zoom || 1;
    const sx0 = (bounds.left - view.x) * zoom;
    const sy0 = (bounds.top - view.y) * zoom;
    const sx1 = sx0 + bounds.width * zoom;
    const sy1 = sy0 + bounds.height * zoom;
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const u0 = clamp(sx0 / cam.width);
    const u1 = clamp(sx1 / cam.width);
    const v0 = clamp(1 - sy1 / cam.height);
    const v1 = clamp(1 - sy0 / cam.height);
    if (u1 - u0 < 0.05 || v1 - v0 < 0.05) return null;
    return [u0, v0, u1, v1];
  }

  _applyLight(info) {
    const options = lightOptionsForMode(this.atmosphere.lightOptions, info.mode, {
      flicker: info.flicker,
    });
    if (!options) {
      this.light?.destroy();
      this.light = null;
      return;
    }
    if (this.light) this.light.setOptions(options);
    else this.light = new BattleLightLayer(this.scene, options).create();
  }

  // --- Desktop: keep UI off the graded camera --------------------------------------

  _ensureUiCamera() {
    const scene = this.scene;
    // Phones already split UI onto BattleScene's pinned UI camera.
    if (scene._uiCamera || this.uiCamera || !scene.cameras?.add) return;
    const main = scene.cameras.main;
    this.uiCamera = scene.cameras.add(0, 0, main.width, main.height, false, 'atmosphere-ui');
    this.uiCamera.setRoundPixels?.(main.roundPixels);
    this.uiCamera.transparent = true;
    this._onPreRender = () => this._routeCameras();
    scene.events?.on?.('prerender', this._onPreRender);
    this._onResize = () => {
      const m = scene.cameras?.main;
      if (m && this.uiCamera) this.uiCamera.setSize(m.width, m.height);
    };
    scene.scale?.on?.('resize', this._onResize);
  }

  _routeCameras() {
    const scene = this.scene;
    const ui = this.uiCamera;
    const main = scene.cameras?.main;
    if (!ui || !main) return;
    if (scene._uiCamera) {
      // A pinned UI camera appeared later (mobile camera system): hand over.
      this._removeUiCamera();
      return;
    }
    // Mirror the main view (crit zoom punch, shake) so routed objects never drift.
    if (ui.zoom !== main.zoom) ui.setZoom(main.zoom);
    if (ui.rotation !== main.rotation) ui.setRotation(main.rotation);
    if (ui.scrollX !== main.scrollX || ui.scrollY !== main.scrollY)
      ui.setScroll(main.scrollX, main.scrollY);
    if (ui.width !== main.width || ui.height !== main.height) ui.setSize(main.width, main.height);
    const mainId = main.id;
    const uiId = ui.id;
    const both = mainId | uiId;
    const list = scene.children?.list || [];
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (!obj) continue;
      const isUi = (obj.depth || 0) >= UI_DEPTHS.SCREEN_UI;
      obj.cameraFilter = ((obj.cameraFilter || 0) & ~both) | (isUi ? mainId : uiId);
    }
  }

  _removeUiCamera() {
    const scene = this.scene;
    if (this._onPreRender) scene.events?.off?.('prerender', this._onPreRender);
    this._onPreRender = null;
    if (this._onResize) scene.scale?.off?.('resize', this._onResize);
    this._onResize = null;
    if (!this.uiCamera) return;
    const both = (scene.cameras?.main?.id || 0) | this.uiCamera.id;
    for (const obj of scene.children?.list || []) {
      if (obj && obj.cameraFilter) obj.cameraFilter &= ~both;
    }
    scene.cameras?.remove?.(this.uiCamera);
    this.uiCamera = null;
  }

  _teardownVisuals() {
    this.light?.destroy();
    this.light = null;
    clearAtmosphere(this.scene?.cameras?.main);
    this._removeUiCamera();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._unsubscribe?.();
    this._unsubscribe = null;
    try {
      this._teardownVisuals();
    } catch {
      /* scene already torn down */
    }
    this.state.mode = 'off';
  }
}
