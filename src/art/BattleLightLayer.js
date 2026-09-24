// BattleLightLayer — darkness with carried light, for night acts (Ashfall, the Deep)
// and fog-heavy maps.
//
// A world-space RenderTexture over the map is filled with ink, then soft light pools
// are erased from it: your units carry warm light, allies carry a dimmer one, and
// lava, forts, villages and thrones glow in place. Enemies carry none; they are seen
// only where your light reaches them. The ambient floor keeps every tile readable.
// Presentation only: never changes vision, fog rules or any game state.

import { TILE_SIZE } from '../utils/constants.js';

const GLOW_KEY = 'art_light_glow';

// Terrain that emits light, as [radius in tiles, strength 0..1]
// Terrain that emits light, as [radius in tiles, strength 0..1, glow color]
const EMISSIVE_TERRAIN = Object.freeze({
  'Lava Crack': [1.5, 0.8, 0xff7a2e],
  Fort: [1.8, 0.6, 0xffb45a],
  Village: [1.8, 0.6, 0xffb45a],
  Throne: [2.2, 0.75, 0xffc870],
  'Acidic Swamp': [1.1, 0.35, 0x9ad06a],
  'Acidic Bog': [1.1, 0.35, 0x9ad06a],
});
const UNIT_LIGHT = 0xffc27a; // warm lantern carried by the warband
const ALLY_LIGHT = 0xa8e0b8;

function ensureGlowTexture(scene) {
  if (scene.textures.exists(GLOW_KEY)) return;
  const size = 128;
  const tex = scene.textures.createCanvas(GLOW_KEY, size, size);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export class BattleLightLayer {
  /**
   * @param {Phaser.Scene} scene BattleScene (needs .grid, .playerUnits, .npcUnits)
   * @param {object} opts { darkness 0..1, color 0xRRGGBB, unitRadius tiles, depth }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.darkness = opts.darkness ?? 0.55;
    this.color = opts.color ?? 0x0e0c14;
    this.unitRadius = opts.unitRadius ?? 2.6;
    this.depth = opts.depth ?? 4.6; // above tiles + fog, below range highlights (5) and units (10+)
    this.flicker = opts.flicker ?? true;
    this.glowStrength = opts.glowStrength ?? 0.28;
    this.rt = null;
    this.brush = null;
    this._emitters = [];
  }

  create() {
    const { scene } = this;
    const grid = scene.grid;
    if (!grid || !scene.add?.renderTexture) return this;
    ensureGlowTexture(scene);
    const w = grid.cols * TILE_SIZE;
    const h = grid.rows * TILE_SIZE;
    this.rt = scene.add.renderTexture(grid.offsetX, grid.offsetY, w, h).setOrigin(0, 0);
    this.rt.setDepth(this.depth);
    // Additive colored light on top of the darkness: the pools have a hue, not just less ink.
    this.glow = scene.add.renderTexture(grid.offsetX, grid.offsetY, w, h).setOrigin(0, 0);
    this.glow.setDepth(this.depth + 0.01).setBlendMode('ADD');
    this.brush = scene.make.image({ key: GLOW_KEY, add: false });
    this._emitters = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const name = grid.getTerrainAt?.(col, row)?.name;
        const e = name && EMISSIVE_TERRAIN[name];
        if (e)
          this._emitters.push({
            col,
            row,
            radius: e[0],
            strength: e[1],
            color: e[2],
            seed: col * 7 + row * 13,
          });
      }
    }
    this._onUpdate = (time) => this.redraw(time);
    scene.events.on('update', this._onUpdate);
    this.redraw(0);
    return this;
  }

  _erase(x, y, radiusTiles, strength, color) {
    const d = radiusTiles * 2 * TILE_SIZE;
    this.brush.setDisplaySize(d, d);
    this.brush.setAlpha(strength);
    this.brush.clearTint();
    this.rt.erase(this.brush, x, y);
    if (color !== undefined && this.glow) {
      this.brush.setDisplaySize(d * 0.8, d * 0.8);
      this.brush.setTint(color);
      this.brush.setAlpha(strength * this.glowStrength);
      this.glow.draw(this.brush, x, y);
    }
  }

  redraw(time = 0) {
    const { rt, scene } = this;
    if (!rt || !scene.grid) return;
    const grid = scene.grid;
    rt.clear();
    rt.fill(this.color, this.darkness);
    this.glow?.clear();
    const ox = grid.offsetX;
    const oy = grid.offsetY;
    for (const e of this._emitters) {
      const f = this.flicker ? 0.9 + 0.1 * Math.sin(time * 0.006 + e.seed) : 1;
      this._erase(
        (e.col + 0.5) * TILE_SIZE,
        (e.row + 0.5) * TILE_SIZE,
        e.radius * f,
        e.strength,
        e.color,
      );
    }
    const carry = (units, radius, strength, color) => {
      for (const u of units || []) {
        const g = u?.graphic;
        if (!g || !g.visible || u.currentHP <= 0) continue;
        this._erase(g.x - ox, g.y - oy, radius, strength, color);
      }
    };
    carry(scene.playerUnits, this.unitRadius, 0.95, UNIT_LIGHT);
    carry(scene.npcUnits, this.unitRadius * 0.7, 0.7, ALLY_LIGHT);
  }

  setDarkness(v) {
    this.darkness = v;
    return this;
  }

  destroy() {
    if (this._onUpdate) this.scene?.events?.off('update', this._onUpdate);
    this._onUpdate = null;
    this.rt?.destroy();
    this.glow?.destroy();
    this.glow = null;
    this.brush?.destroy();
    this.rt = null;
    this.brush = null;
  }
}
