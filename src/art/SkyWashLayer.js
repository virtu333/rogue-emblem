// SkyWashLayer — the low sun of a dawn or dusk battle (skyWash data).
//
// Two gradient quads over the map, drawn once: an additive warm glow from the sun's corner
// and a cool shade toward the far one. Layering: above the painted terrain and the cloud
// shadows (2.6), below fog (3), the light layer (3.5), ranges, rings and units, so it colours
// the ground and nothing the player reads. Presentation only: no game state or RNG.

import { TILE_SIZE } from '../utils/constants.js';
import { hexToInt } from './atmosphereConfig.js';
import { skyWashCorners } from './skyWash.js';

export const SKY_WASH_DEPTH = 2.7;
const ADD = 1;

export class SkyWashLayer {
  /**
   * @param {Phaser.Scene} scene BattleScene (needs .grid)
   * @param {object} opts { wash (a SKY_WASH entry), reduced }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.wash = opts.wash || null;
    this.reduced = Boolean(opts.reduced);
    this.glow = null;
    this.shade = null;
  }

  create() {
    const { scene } = this;
    const grid = scene?.grid;
    if (!grid || !scene.add?.graphics || !this.wash) return this;
    this._grid = grid;
    this.shade = scene.add.graphics().setDepth(SKY_WASH_DEPTH);
    this.glow = scene.add.graphics().setDepth(SKY_WASH_DEPTH + 0.01);
    this.glow.setBlendMode?.(ADD);
    for (const g of [this.shade, this.glow]) g._forceWorldCamera = true;
    this._onUpdate = () => {
      if (this.scene?.grid !== this._grid) {
        this._release();
        this.create();
      }
    };
    scene.events?.on?.('update', this._onUpdate);
    this._draw();
    return this;
  }

  setOptions({ reduced } = {}) {
    if (typeof reduced === 'boolean' && reduced !== this.reduced) {
      this.reduced = reduced;
      this._draw();
    }
    return this;
  }

  _draw() {
    const grid = this._grid;
    const corners = skyWashCorners(this.wash, { reduced: this.reduced });
    if (!grid || !corners || !this.glow || !this.shade) return;
    const w = grid.mapPixelWidth ?? grid.cols * TILE_SIZE;
    const h = grid.mapPixelHeight ?? grid.rows * TILE_SIZE;
    const x = grid.offsetX || 0;
    const y = grid.offsetY || 0;
    const paint = (g, hex, alphas) => {
      const c = hexToInt(hex);
      g.clear();
      g.fillGradientStyle(c, c, c, c, ...alphas);
      g.fillRect(x, y, w, h);
    };
    paint(this.shade, this.wash.shade, corners.shade);
    paint(this.glow, this.wash.glow, corners.glow);
  }

  get objects() {
    return [this.shade, this.glow].filter(Boolean);
  }

  destroy() {
    this._release();
  }

  _release() {
    if (this._onUpdate) this.scene?.events?.off?.('update', this._onUpdate);
    this._onUpdate = null;
    this.glow?.destroy();
    this.shade?.destroy();
    this.glow = null;
    this.shade = null;
  }
}
