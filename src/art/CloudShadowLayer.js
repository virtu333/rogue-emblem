// CloudShadowLayer — cloud shadows drifting over a daylit battlefield (cloudShadows plan).
//
// One small RenderTexture over the map (quarter resolution, linear filtering: the shadows
// are soft) holds the clouds' puffs in white; it is shown tinted with the shade colour at
// the clouds' strength, so overlapping puffs merge into one shadow instead of stacking
// darker. It is redrawn a few times a second (the clouds move a fraction of a pixel a
// frame), never when the clouds are still (Reduce motion), and only while the battle runs.
//
// Layering: above the painted terrain (0), below fog (3), the night/hall light (3.5),
// ranges, rings and units, so it shades the ground and nothing the player reads.
// Presentation only: no game state or RNG (the plan's generator is its own, seeded).

import { TILE_SIZE } from '../utils/constants.js';
import { hexToInt } from './atmosphereConfig.js';
import { ensureGlowTexture, GLOW_KEY } from './BattleLightLayer.js';
import { CLOUD_SHADOW_SPEC, cloudPositionsAt, planCloudShadows } from './cloudShadows.js';

export const CLOUD_LAYER_DEPTH = 2.6;
const RES = 0.25;
const LINEAR = 0;
const REDRAW_MS = 120;

let layerSeq = 0;

export class CloudShadowLayer {
  /**
   * @param {Phaser.Scene} scene BattleScene (needs .grid)
   * @param {object} opts { seed, still (hold the clouds), reduced (lighter) }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.id = ++layerSeq;
    this.seed = opts.seed >>> 0;
    this.still = Boolean(opts.still);
    this.reduced = Boolean(opts.reduced);
    this.rt = null;
    this.brush = null;
    this.plan = null;
    this._elapsed = 0;
    this._sinceDraw = Infinity;
    this.stats = { redraws: 0 };
  }

  create() {
    const { scene } = this;
    const grid = scene?.grid;
    if (!grid || !scene.add?.renderTexture || !scene.make?.image) return this;
    ensureGlowTexture(scene);
    const w = grid.mapPixelWidth ?? grid.cols * TILE_SIZE;
    const h = grid.mapPixelHeight ?? grid.rows * TILE_SIZE;
    this._grid = grid;
    // The plan is laid out as drawn (a portrait board is turned), so the wind keeps
    // blowing across the screen the same way on either orientation.
    const cols = Math.round(w / TILE_SIZE);
    const rows = Math.round(h / TILE_SIZE);
    this.plan = planCloudShadows({ cols, rows, seed: this.seed });
    const rw = Math.max(1, Math.ceil(w * RES));
    const rh = Math.max(1, Math.ceil(h * RES));
    this.rt = scene.add.renderTexture(grid.offsetX, grid.offsetY, rw, rh).setOrigin(0, 0);
    this.rt.setDisplaySize(w, h).setDepth(CLOUD_LAYER_DEPTH);
    this.rt.texture?.setFilter?.(LINEAR);
    this.rt.setTint?.(hexToInt(CLOUD_SHADOW_SPEC.color));
    const strength =
      this.plan.clouds.reduce((sum, c) => sum + c.alpha, 0) / (this.plan.clouds.length || 1);
    this.rt.setAlpha(strength * (this.reduced ? CLOUD_SHADOW_SPEC.reducedAlpha : 1));
    // World camera only (BattleScene's mobile UI camera honours this flag).
    this.rt._forceWorldCamera = true;
    this.brush = scene.make.image({ key: GLOW_KEY, add: false });
    this._onUpdate = (_time, delta) => this.update(delta);
    scene.events?.on?.('update', this._onUpdate);
    this._draw();
    return this;
  }

  setOptions({ still, reduced } = {}) {
    if (typeof still === 'boolean') this.still = still;
    if (typeof reduced === 'boolean' && reduced !== this.reduced) {
      this.reduced = reduced;
      if (this.rt && this.plan) {
        const strength =
          this.plan.clouds.reduce((sum, c) => sum + c.alpha, 0) / (this.plan.clouds.length || 1);
        this.rt.setAlpha(strength * (reduced ? CLOUD_SHADOW_SPEC.reducedAlpha : 1));
      }
    }
    return this;
  }

  _draw() {
    const { rt, brush, plan } = this;
    if (!rt || !brush || !plan) return;
    this.stats.redraws += 1;
    this._sinceDraw = 0;
    rt.clear();
    const positions = cloudPositionsAt(plan, this._elapsed / 1000);
    const px = TILE_SIZE * RES;
    for (let i = 0; i < plan.clouds.length; i++) {
      const at = positions[i];
      for (const puff of plan.clouds[i].puffs) {
        const d = puff.r * 2 * px;
        brush.setDisplaySize(d, d * 0.8);
        brush.setAlpha(0.9);
        rt.draw(brush, (at.x + puff.dx) * px, (at.y + puff.dy) * px);
      }
    }
  }

  /** Per-frame step: the clouds drift; the texture is redrawn a few times a second. */
  update(delta = 0) {
    if (!this.rt) return;
    if (this.scene?.grid !== this._grid) {
      // The battle rebuilt its grid (a new map): start over at its size.
      this._release();
      this.create();
      return;
    }
    if (this.still) return;
    // A stall (hidden tab, pause) steps at most a frame's worth: no jump.
    const dt = Math.max(0, Math.min(50, Number(delta) || 0));
    this._elapsed += dt;
    this._sinceDraw += dt;
    if (this._sinceDraw >= REDRAW_MS) this._draw();
  }

  get objects() {
    return [this.rt].filter(Boolean);
  }

  destroy() {
    this._release();
  }

  _release() {
    if (this._onUpdate) this.scene?.events?.off?.('update', this._onUpdate);
    this._onUpdate = null;
    this.rt?.destroy();
    this.rt = null;
    this.brush?.destroy();
    this.brush = null;
  }
}
