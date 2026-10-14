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

export const GLOW_KEY = 'art_light_glow';
const LINEAR = 0; // Phaser.Textures.FilterMode.LINEAR (avoid importing Phaser here)
export const LIGHT_LAYER_DEPTH = 3.5;
const RES = 0.5; // light textures render at half resolution

let layerSeq = 0;

export function ensureGlowTexture(scene) {
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

/**
 * Where a hall's wall sconces hang (pure; reads the layout only, no draw): on the face
 * of a wall the camera sees (its south face, over open floor), every `spacing`-th cell
 * along the wall. A wall block's inner and back cells carry none.
 * @param {{ cols:number, rows:number, nameAt:(col:number,row:number)=>string|undefined }} map
 * @param {{ spacing?:number }} spec
 * @returns {{ col:number, row:number, faceCol:number, faceRow:number }[]} the wall cell and
 *   the floor cell it lights
 */
export function wallTorchSites(map, spec = {}) {
  const spacing = Math.max(1, Math.trunc(Number(spec.spacing) || 4));
  const out = [];
  const isOpen = (c, r) => {
    if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return false;
    const n = map.nameAt(c, r);
    return Boolean(n) && n !== 'Wall' && n !== 'Pillar';
  };
  for (let row = 0; row < map.rows; row += 1) {
    // Each run of south-facing wall gets a sconce one cell in from its west end (a
    // one-cell stub on that cell), then every `spacing` cells.
    let col = 0;
    while (col < map.cols) {
      if (!(map.nameAt(col, row) === 'Wall' && isOpen(col, row + 1))) {
        col += 1;
        continue;
      }
      let end = col;
      while (end + 1 < map.cols && map.nameAt(end + 1, row) === 'Wall' && isOpen(end + 1, row + 1))
        end += 1;
      for (let c = col + Math.min(1, end - col); c <= end; c += spacing) {
        out.push({ col: c, row, faceCol: c, faceRow: row + 1 });
      }
      col = end + 1;
    }
  }
  return out;
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
    this.castShadows = Boolean(opts.castShadows);
    const torches = opts.wallTorches;
    this.wallTorches = torches
      ? {
          spacing: torches.spacing ?? 3,
          radius: Number(torches.radius) || 1.7,
          strength: Number(torches.strength) || 0.7,
          color: toColor(torches.color, 0xffb45a),
        }
      : null;
    this.entityUnlight = opts.entityUnlight ? toColor(opts.entityUnlight, 0x170c24) : null;
  }

  create() {
    const { scene } = this;
    const grid = scene?.grid;
    if (!grid || !scene.add?.renderTexture || !scene.textures?.addDynamicTexture) return this;
    ensureGlowTexture(scene);
    const w = grid.mapPixelWidth ?? grid.cols * TILE_SIZE;
    const h = grid.mapPixelHeight ?? grid.rows * TILE_SIZE;
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
    // Emitter cells are game coordinates; the light texture is laid out as drawn.
    const drawn = (col, row) => grid.displayCellOf?.(col, row) || { col, row };
    const seen = (col, row) => !grid.fogEnabled || grid.isVisible?.(col, row);
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const name = grid.getTerrainAt?.(col, row)?.name;
        const e = name && this.emitterSpecs[name];
        if (!e) continue;
        // Fogged tiles stay dark: a hidden lava vent or fort does not glow through fog.
        if (!seen(col, row)) continue;
        const cell = drawn(col, row);
        this._emitters.push({
          x: (cell.col + 0.5) * TILE_SIZE,
          y: (cell.row + 0.5) * TILE_SIZE,
          radius: e[0],
          strength: e[1],
          color: e[2],
        });
      }
    }
    const board = grid.board;
    const shown = (col, row) => (board?.fromDisplay ? board.fromDisplay(col, row) : { col, row });
    const displayMap = {
      cols: board?.displayCols ?? grid.cols,
      rows: board?.displayRows ?? grid.rows,
      nameAt: (c, r) => {
        const g = shown(c, r);
        return grid.getTerrainAt?.(g.col, g.row)?.name;
      },
    };
    // Shadow casters (pillars) are found as drawn: the light falls across the screen.
    this._casters = [];
    if (this.castShadows) {
      for (let r = 0; r < displayMap.rows; r += 1)
        for (let c = 0; c < displayMap.cols; c += 1) {
          if (displayMap.nameAt(c, r) !== 'Pillar') continue;
          const g = shown(c, r);
          if (!seen(g.col, g.row)) continue;
          this._casters.push({ x: (c + 0.5) * TILE_SIZE, y: (r + 0.5) * TILE_SIZE });
        }
    }
    const torch = this.wallTorches;
    if (!torch) return;
    // Sconces hang on the face of a wall as drawn (the face the camera sees).
    for (const site of wallTorchSites(displayMap, torch)) {
      // A sconce lights the floor it faces; hidden floor keeps it dark.
      const floor = shown(site.faceCol, site.faceRow);
      if (!seen(floor.col, floor.row)) continue;
      // Hung on the wall's face: 0.45 of the way from the wall's centre to the floor's.
      const x = (site.col + 0.5) * TILE_SIZE;
      const y = (site.row + 0.5 + 0.45) * TILE_SIZE;
      this._emitters.push({
        x,
        y,
        radius: torch.radius,
        strength: torch.strength,
        color: torch.color,
        flame: true,
      });
    }
  }

  /**
   * Each pillar near a light throws a soft shadow away from it (pure geometry over the
   * collected emitters; the nearest light within reach wins).
   */
  _pillarShadows() {
    const out = [];
    for (const p of this._casters || []) {
      let best = null;
      for (const e of this._emitters) {
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = Math.hypot(dx, dy);
        const reach = e.radius * TILE_SIZE * 1.4;
        if (dist < 4 || dist > reach) continue;
        if (!best || dist < best.dist) best = { dx, dy, dist, reach, strength: e.strength };
      }
      if (!best) continue;
      const ux = best.dx / best.dist;
      const uy = best.dy / best.dist;
      // Nearer the light, the darker and shorter the shadow.
      const near = 1 - best.dist / best.reach;
      const length = 1 + (1 - near) * 0.5;
      out.push({
        x: p.x + ux * TILE_SIZE * (0.2 + length * 0.5),
        y: p.y + uy * TILE_SIZE * (0.2 + length * 0.5),
        length,
        rotation: Math.atan2(uy, ux),
        alpha: Math.min(0.5, (0.2 + near * 0.4) * best.strength),
      });
    }
    return out;
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
      this._stampBrush(tex, e.x, e.y, e.radius, e.strength, null, true);
      this._stampBrush(
        this.glowStatic,
        e.x,
        e.y,
        e.radius * 0.8,
        e.strength * this.glowStrength,
        e.color,
        false,
      );
      // A sconce shows its flame: a small hot point on the wall face.
      if (e.flame) this._stampBrush(this.glowStatic, e.x, e.y, 0.16, 0.75, 0xffa848, false);
    }
    // Shadows go on after the light: they fall inside the pools the light opened.
    const brush = this.brush;
    for (const sh of this._pillarShadows()) {
      const d = TILE_SIZE * RES;
      brush.setDisplaySize(sh.length * d, 0.8 * d);
      brush.setRotation?.(sh.rotation);
      brush.setAlpha(sh.alpha);
      brush.setTint(this.color);
      tex.draw(brush, sh.x * RES, sh.y * RES);
    }
    brush.setRotation?.(0);
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
