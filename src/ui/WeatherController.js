// WeatherController — weather particles over a live battle (create()/destroy() controller).
//
// Picks the weather from the battle's mood (pure resolveWeather over the same context
// AtmosphereController reads) and follows the Atmosphere setting live: Full shows the
// kind's full count, Reduced (the phone default) about a third, slower and without
// flicker, Off none; Reduce motion turns weather off; Low effects quality caps it at
// Reduced (resolveWeatherMode over resolveAtmosphereMode). Scripted battles stay clear.
//
// Rendering: a fixed pool of tiny tinted Images in world space at UI_DEPTHS.WEATHER,
// below UI_DEPTHS.SCREEN_UI, so they render on the graded main (world) camera: on
// desktop AtmosphereController routes everything under SCREEN_UI there, and on phones
// BattleScene's pinned UI camera only takes pinned objects and depths of 500 and up.
// The field covers the visible map (map bounds ∩ the main camera's world view) and
// counter-scales by the zoom, so particles keep their screen size and speed. The camera
// is never rotated (portrait battles turn the board through the Grid), so falling along
// world +y reads as down on the screen in either orientation.
//
// RNG: during a battle Math.random IS the battle RNG. The simulation draws only from its
// own seeded generator (weatherConfig), every Phaser call runs inside
// withPresentationRandom, and nothing uses Phaser particle emitters or Phaser.Math
// randoms. Presentation only: no game state, RNG, save or timing is touched.
//
// Lifecycle: steps on the scene's 'update' (delta clamped, so a paused or hidden tab
// never bursts to catch up); the pool is released when the battle ends (BATTLE_END),
// on any failure (reported once, then weather stays off for the battle) and on destroy.

import { atmosphereContextFromScene, atmospherePreference } from './AtmosphereController.js';
import { atmosphereSupported } from '../art/AtmosphereFX.js';
import {
  createWeatherField,
  resolveWeather,
  resolveWeatherMode,
  stepWeather,
  weatherSeed,
  WEATHER_KINDS,
} from '../art/weatherConfig.js';
import { detectMobileRuntime } from '../utils/runtimeFlags.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';

const TEXTURE_PREFIX = 'weather_';
const SHAPE_SIZES = Object.freeze({ streak: [1, 12], dot: [2, 2], soft: [4, 4] });

function devWeather() {
  if (!import.meta.env?.DEV) return null;
  const value = new URLSearchParams(globalThis.location?.search || '').get('weather');
  return WEATHER_KINDS.includes(value) ? value : null;
}

/** A tiny white texture per shape (tinted per particle); null when the host has none. */
function ensureShapeTexture(scene, shape) {
  const key = `${TEXTURE_PREFIX}${shape}`;
  const textures = scene?.textures;
  if (!textures?.exists) return null;
  if (textures.exists(key)) return key;
  const size = SHAPE_SIZES[shape];
  if (!size || typeof textures.createCanvas !== 'function') return null;
  const tex = textures.createCanvas(key, size[0], size[1]);
  const ctx = tex?.getContext?.();
  if (!ctx) return null;
  const px = (x, y, w, h, a) => {
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, w, h);
  };
  if (shape === 'streak') {
    // Faint tail at the top, bright head at the bottom (the texture points along +y).
    for (let y = 0; y < size[1]; y++) px(0, y, 1, 1, ((y + 1) / size[1]).toFixed(3));
  } else if (shape === 'dot') {
    px(0, 0, 2, 2, 1);
  } else {
    px(1, 0, 2, 1, 0.5);
    px(0, 1, 4, 2, 0.5);
    px(1, 1, 2, 2, 1);
    px(1, 3, 2, 1, 0.5);
  }
  tex.refresh?.();
  return key;
}

export class WeatherController {
  constructor(scene) {
    this.scene = scene;
    this.kind = 'none';
    this.state = { kind: 'none', mode: 'off', count: 0 };
    this.field = null;
    this.images = [];
    this._styleRevs = [];
    this._view = { x: 0, y: 0, w: 0, h: 0, zoom: 1 };
    this._info = null;
    this._signature = null;
    this._unsubscribe = null;
    this._onUpdate = null;
    this.supported = false;
    this.failed = false;
    this.destroyed = false;
  }

  create() {
    try {
      const scene = this.scene;
      this.supported = atmosphereSupported(scene?.sys?.game);
      const ctx = atmosphereContextFromScene(scene);
      this.kind = resolveWeather({ ...ctx, weatherOverride: devWeather() });
      this.state.kind = this.kind;
      if (this.kind === 'none') return this;
      const settings = scene?.registry?.get?.('settings');
      this._unsubscribe = settings?.onChange?.(() => this.refresh()) || null;
      this._onUpdate = (_time, delta) => this.update(delta);
      scene?.events?.on?.('update', this._onUpdate);
      this.refresh();
    } catch (error) {
      // Presentation must never break a battle.
      console.warn('[Weather] disabled:', error?.message || error);
      this._fail();
    }
    return this;
  }

  _modeInfo() {
    const settings = this.scene?.registry?.get?.('settings');
    return resolveWeatherMode(atmospherePreference(this.scene), {
      mobile: detectMobileRuntime(),
      webgl: this.supported,
      effectsQuality: settings?.getEffectsQuality?.(),
      reduceMotion: settings?.getReduceMotion?.(),
    });
  }

  /** Re-read settings; a changed mode rebuilds the pool on the next frame. */
  refresh() {
    if (this.destroyed || this.failed || this.kind === 'none') return;
    const info = this._modeInfo();
    const signature = `${info.mode}|${info.flicker}`;
    if (signature === this._signature) return;
    this._signature = signature;
    this._info = info;
    this.state.mode = info.mode;
    this._releasePool();
  }

  _wanted() {
    return (
      !this.destroyed &&
      !this.failed &&
      this.kind !== 'none' &&
      this.state.mode !== 'off' &&
      this.scene?.battleState !== 'BATTLE_END'
    );
  }

  /** One frame: step the field by the frame delta and draw it. */
  update(delta) {
    if (!this._wanted()) {
      if (this.field) this._releasePool();
      return;
    }
    safeBattlePresentation(
      'weather',
      () => {
        try {
          withPresentationRandom(() => {
            if (!this.field) this._buildPool();
            if (!this.field) return;
            stepWeather(this.field, delta, this._visibleRegion());
            this._render();
          });
        } catch (error) {
          this._fail();
          throw error;
        }
      },
      { scene: this.scene },
    );
  }

  /** Map bounds ∩ the main camera's world view, in world units (reused object). */
  _visibleRegion() {
    const scene = this.scene;
    const cam = scene?.cameras?.main;
    const view = cam?.worldView;
    if (!view || !(view.width > 0) || !(view.height > 0)) return null;
    const bounds = scene?._getBattleMapBounds?.();
    let x0 = view.x;
    let y0 = view.y;
    let x1 = view.x + view.width;
    let y1 = view.y + view.height;
    if (bounds) {
      x0 = Math.max(x0, bounds.left);
      y0 = Math.max(y0, bounds.top);
      x1 = Math.min(x1, bounds.left + bounds.width);
      y1 = Math.min(y1, bounds.top + bounds.height);
    }
    if (!(x1 > x0) || !(y1 > y0)) return null;
    const out = this._view;
    out.x = x0;
    out.y = y0;
    out.w = x1 - x0;
    out.h = y1 - y0;
    out.zoom = cam.zoom > 0 ? cam.zoom : 1;
    return out;
  }

  _buildPool() {
    const scene = this.scene;
    const info = this._info;
    if (!info || info.mode === 'off') return;
    // A host that can't draw (headless, no canvas textures) stays off for the battle
    // rather than retrying every frame.
    const unavailable = () => {
      this.failed = true;
    };
    if (typeof scene?.add?.image !== 'function') return unavailable();
    const field = createWeatherField({
      kind: this.kind,
      mode: info.mode,
      seed: weatherSeed(scene.battleParams?.battleSeed, this.kind),
      flicker: info.flicker,
    });
    if (!field.spec) return unavailable();
    const key = ensureShapeTexture(scene, field.spec.shape);
    if (!key) return unavailable();
    const blend = field.spec.blend === 'add' ? 'ADD' : 'NORMAL';
    for (let i = 0; i < field.particles.length; i++) {
      const image = scene.add.image(0, 0, key);
      image.setOrigin?.(0.5, 0.5);
      image.setDepth(UI_DEPTHS.WEATHER);
      image.setBlendMode?.(blend);
      image.setVisible(false);
      // World camera only (BattleScene's mobile UI camera honours this flag).
      image._forceWorldCamera = true;
      this.images.push(image);
      this._styleRevs.push(-1);
    }
    this.field = field;
    this.state.count = field.particles.length;
  }

  _render() {
    const { field, images } = this;
    const zoom = this._view.zoom || 1;
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      if (!image.scene) {
        // Something tore the display list down (a scene restart): rebuild next frame.
        this._releasePool();
        return;
      }
      const p = field.particles[i];
      if (!p.visible) {
        if (image.visible) image.setVisible(false);
        continue;
      }
      if (this._styleRevs[i] !== p.styleRev) {
        this._styleRevs[i] = p.styleRev;
        image.setTint(p.color);
        image.setRotation(p.rotation);
      }
      image.setPosition(p.drawX, p.drawY);
      image.setAlpha(p.drawAlpha);
      image.setScale(p.scale / zoom);
      if (!image.visible) image.setVisible(true);
    }
  }

  _releasePool() {
    const images = this.images;
    this.images = [];
    this._styleRevs = [];
    this.field = null;
    this.state.count = 0;
    if (!images.length) return;
    withPresentationRandom(() => {
      for (const image of images) {
        try {
          image?.destroy?.();
        } catch {
          /* already gone with the scene */
        }
      }
    });
  }

  _fail() {
    this.failed = true;
    try {
      this._releasePool();
    } catch {
      /* scene already torn down */
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._unsubscribe?.();
    this._unsubscribe = null;
    if (this._onUpdate) this.scene?.events?.off?.('update', this._onUpdate);
    this._onUpdate = null;
    try {
      this._releasePool();
    } catch {
      /* scene already torn down */
    }
    this.state.mode = 'off';
  }
}
