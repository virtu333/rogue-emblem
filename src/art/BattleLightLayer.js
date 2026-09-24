// BattleLightLayer — darkness with carried light, for night moods (Ashfall, Rime Night,
// the Throne, the Deep).
//
// A world-space RenderTexture over the map is filled with ink, then soft light pools
// are erased from it: your units carry warm light, allies a dimmer one, and lava,
// forts, villages and thrones glow in place. Enemies carry none. An additive layer on
// top gives the pools a hue. The ambient floor keeps every tile readable.
//
// Layering: above terrain (0) and fog (3), below the danger zone (4), pinned threats
// (4.5), range highlights (5), path (6), faction rings (8), units (10+), HP bars and
// the cursor. Units and HP bars therefore always read at full strength.
//
// Cost model: nothing is redrawn per frame unless something changed. Terrain emitters
// are cached in a static texture (rebuilt only when terrain, fog visibility or the
// options change); the displayed darkness is that cache plus one erase per lit unit,
// redrawn only when a lit unit moves, appears, dies or hides. All textures render at
// half resolution with linear filtering (soft gradients survive it). Flicker (Full
// mode only) animates the static glow's alpha — no redraw.
//
// Presentation only: never changes vision, fog rules, RNG or any game state.

import { TILE_SIZE } from '../utils/constants.js';
import { hexToInt } from './atmosphereConfig.js';

const GLOW_KEY = 'art_light_glow';
const LINEAR = 0; // Phaser.Textures.FilterMode.LINEAR (avoid importing Phaser here)
export const LIGHT_LAYER_DEPTH = 3.5;
const RES = 0.5; // light textures render at half resolution

let layerSeq = 0;

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
  tex.setFilter?.(LINEAR);
}

function toColor(value, fallback) {
  if (Number.isFinite(value)) return value >>> 0;
  if (typeof value === 'string') return hexToInt(value);
  return fallback;
}

function normalizeEmitters(emitters = {}) {
  const out = {};
  for (const [name, spec] of Object.entries(emitters)) {
    if (!Array.isArray(spec)) continue;
    out[name] = [Number(spec[0]) || 1, Number(spec[1]) || 0.5, toColor(spec[2], 0xffb45a)];
  }
  return out;
}

export class BattleLightLayer {
  /**
   * @param {Phaser.Scene} scene BattleScene (needs .grid, .playerUnits, .npcUnits, .enemyUnits)
   * @param {object} opts { darkness 0..1, color, unitRadius tiles, unitLight, allyLight,
   *   glowStrength, flicker, emitters, entityUnlight, depth }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.id = ++layerSeq;
    this.depth = opts.depth ?? LIGHT_LAYER_DEPTH;
    this._lastOpts = { ...opts };
    this._applyOptions(opts);
    this.dark = null;
    this.glowStatic = null;
    this.glowUnits = null;
    this.brush = null;
    this.staticKey = null;
    this._emitters = [];
    this._staticDirty = true;
    this._unitSig = null;
    this._terrainRev = null;
    this._fogRef = null;
    this.stats = { staticRedraws: 0, unitRedraws: 0 };
  }

  _applyOptions(opts) {
    this.darkness = opts.darkness ?? 0.55;
    this.color = toColor(opts.color, 0x0e0c14);
    this.unitRadius = opts.unitRadius ?? 2.6;
    this.unitLight = toColor(opts.unitLight, 0xffc27a);
    this.allyLight = toColor(opts.allyLight, 0xa8e0b8);
    this.glowStrength = opts.glowStrength ?? 0.28;
    this.flicker = opts.flicker ?? false;
    this.emitterSpecs = normalizeEmitters(opts.emitters);
    this.entityUnlight = opts.entityUnlight ? toColor(opts.entityUnlight, 0x170c24) : null;
  }

  create() {
    const { scene } = this;
    const grid = scene?.grid;
    if (!grid || !scene.add?.renderTexture || !scene.textures?.addDynamicTexture) return this;
    ensureGlowTexture(scene);
    const w = grid.cols * TILE_SIZE;
    const h = grid.rows * TILE_SIZE;
    this.w = w;
    this.h = h;
    const rw = Math.max(1, Math.ceil(w * RES));
    const rh = Math.max(1, Math.ceil(h * RES));
    this.staticKey = `art-light-static-${this.id}`;
    this.staticTex = scene.textures.addDynamicTexture(this.staticKey, rw, rh);
    const layer = (depth, blend) => {
      const rt = scene.add.renderTexture(grid.offsetX, grid.offsetY, rw, rh).setOrigin(0, 0);
      rt.setDisplaySize(w, h).setDepth(depth);
      if (blend) rt.setBlendMode(blend);
      rt.texture?.setFilter?.(LINEAR);
      return rt;
    };
    this.dark = layer(this.depth);
    this.glowStatic = layer(this.depth + 0.01, 'ADD');
    this.glowUnits = layer(this.depth + 0.02, 'ADD');
    this.staticTex?.setFilter?.(LINEAR);
    this.brush = scene.make.image({ key: GLOW_KEY, add: false });
    this._grid = grid;
    this._onUpdate = (time) => this.update(time);
    scene.events?.on?.('update', this._onUpdate);
    this.update(0);
    return this;
  }

  /** Change strength/flicker/palette live (Atmosphere setting changed). */
  setOptions(opts = {}) {
    this._applyOptions({ ...this._lastOpts, ...opts });
    this._lastOpts = { ...this._lastOpts, ...opts };
    this._staticDirty = true;
    this._unitSig = null;
    if (!this.flicker && this.glowStatic) this.glowStatic.setAlpha(1);
    this.update(0);
    return this;
  }

  /** Force a full rebuild (e.g. after a checkpoint restore rebuilt everything). */
  invalidate() {
    this._staticDirty = true;
    this._unitSig = null;
  }

  _collectEmitters() {
    const grid = this.scene.grid;
    this._emitters = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const name = grid.getTerrainAt?.(col, row)?.name;
        const e = name && this.emitterSpecs[name];
        if (!e) continue;
        // Fogged tiles stay dark: a hidden lava vent or fort does not glow through fog.
        if (grid.fogEnabled && !grid.isVisible?.(col, row)) continue;
        this._emitters.push({ col, row, radius: e[0], strength: e[1], color: e[2] });
      }
    }
  }

  _stampBrush(target, x, y, radiusTiles, alpha, tint, erase) {
    const d = radiusTiles * 2 * TILE_SIZE * RES;
    const b = this.brush;
    b.setDisplaySize(d, d);
    b.setAlpha(alpha);
    if (tint === null) b.clearTint();
    else b.setTint(tint);
    if (erase) target.erase(b, x * RES, y * RES);
    else target.draw(b, x * RES, y * RES);
  }

  _redrawStatic() {
    const tex = this.staticTex;
    if (!tex) return;
    this.stats.staticRedraws += 1;
    this._collectEmitters();
    tex.clear();
    tex.fill(this.color, this.darkness);
    this.glowStatic.clear();
    for (const e of this._emitters) {
      const x = (e.col + 0.5) * TILE_SIZE;
      const y = (e.row + 0.5) * TILE_SIZE;
      this._stampBrush(tex, x, y, e.radius, e.strength, null, true);
      this._stampBrush(
        this.glowStatic,
        x,
        y,
        e.radius * 0.8,
        e.strength * this.glowStrength,
        e.color,
        false,
      );
    }
    this._unitSig = null; // the displayed darkness is derived from the cache
  }

  _litUnits() {
    const s = this.scene;
    const out = [];
    const push = (units, kind) => {
      for (const u of units || []) {
        const g = u?.graphic;
        if (!g || !g.visible || !(g.alpha > 0.05) || !(u.currentHP > 0) || u._removing) continue;
        out.push({ x: g.x, y: g.y, kind });
      }
    };
    push(s.playerUnits, 'player');
    push(s.npcUnits, 'ally');
    if (this.entityUnlight)
      push(
        (s.enemyUnits || []).filter((u) => u?.isEntity),
        'entity',
      );
    return out;
  }

  _signature(lit) {
    let h = 2166136261 >>> 0;
    const mix = (v) => {
      h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
    };
    mix(lit.length);
    for (const l of lit) {
      mix(Math.round(l.x));
      mix(Math.round(l.y));
      mix(l.kind === 'player' ? 1 : l.kind === 'ally' ? 2 : 3);
    }
    return h;
  }

  _redrawUnits(lit) {
    const grid = this.scene.grid;
    this.stats.unitRedraws += 1;
    this.dark.clear();
    this.dark.drawFrame(this.staticKey, undefined, 0, 0);
    this.glowUnits.clear();
    // Unlight first, so the light your units carry still cuts through it.
    const ordered = [...lit].sort((a, b) => (b.kind === 'entity') - (a.kind === 'entity'));
    for (const l of ordered) {
      const x = l.x - grid.offsetX;
      const y = l.y - grid.offsetY;
      if (l.kind === 'entity') {
        // Unlight: deepen the darkness around the Entity instead of lighting it.
        this._stampBrush(this.dark, x, y, 3.4, Math.min(0.6, this.darkness), this.entityUnlight);
        continue;
      }
      const player = l.kind === 'player';
      const radius = player ? this.unitRadius : this.unitRadius * 0.7;
      this._stampBrush(this.dark, x, y, radius, player ? 0.95 : 0.7, null, true);
      this._stampBrush(
        this.glowUnits,
        x,
        y,
        radius * 0.8,
        (player ? 0.95 : 0.7) * this.glowStrength,
        player ? this.unitLight : this.allyLight,
        false,
      );
    }
  }

  /** Per-frame check; redraws only what changed. */
  update(time = 0) {
    const grid = this.scene?.grid;
    if (!this.dark || !grid) return;
    if (grid !== this._grid) {
      // The battle rebuilt its grid (new map): start over at the new size/offset.
      this._releaseObjects();
      this._staticDirty = true;
      this._unitSig = null;
      this.create();
      return;
    }
    const rev = grid.terrainRevision ?? 0;
    const fogRef = grid.fogEnabled ? grid.visibleSet : null;
    if (this._staticDirty || rev !== this._terrainRev || fogRef !== this._fogRef) {
      this._terrainRev = rev;
      this._fogRef = fogRef;
      this._staticDirty = false;
      this._redrawStatic();
    }
    const lit = this._litUnits();
    const sig = this._signature(lit);
    if (sig !== this._unitSig) {
      this._unitSig = sig;
      this._redrawUnits(lit);
    }
    if (this.flicker && this._emitters.length) {
      const t = Number(time) || 0;
      this.glowStatic.setAlpha(0.88 + 0.08 * Math.sin(t * 0.006) + 0.04 * Math.sin(t * 0.017));
    }
  }

  get objects() {
    return [this.dark, this.glowStatic, this.glowUnits].filter(Boolean);
  }

  destroy() {
    this._releaseObjects();
  }

  _releaseObjects() {
    if (this._onUpdate) this.scene?.events?.off?.('update', this._onUpdate);
    this._onUpdate = null;
    for (const o of this.objects) o.destroy();
    this.dark = null;
    this.glowStatic = null;
    this.glowUnits = null;
    this.brush?.destroy();
    this.brush = null;
    if (this.staticKey && this.scene?.textures?.exists?.(this.staticKey)) {
      this.scene.textures.remove(this.staticKey);
    }
    this.staticTex = null;
    this.staticKey = null;
  }
}
