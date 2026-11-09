// BattlefieldArt — the single entry point for painting battlefield terrain, shared by
// phones (BattlefieldLab layout) and desktop (BattleScene). Presentation only: terrain
// IDs, passability, spawns and RNG never change; Grid keeps its per-cell tile objects
// and this module only swaps their texture frames.
//
// Seam for terrain renderers. A renderer turns a whole map into one canvas at
// `cellSize` texels per cell; frames are cut per cell and applied to Grid.tiles, so
// cross-cell art (shores, canopies, ridges) survives. Two shapes are accepted:
//
//   {
//     id: 'weathered',
//     cellSize: 48,
//     prepare(): Promise<resources>,                 // one-time asset load (cache it)
//     render(resources, input): { canvas, painted?(col, row): boolean },
//     renderCells?(resources, input, canvas, cells, result): void,  // optional incremental
//     renderAsync?(resources, input, { signal }): Promise<result>,  // optional off-thread paint
//     dispose?(result): void,                                       // optional cleanup
//   }
//
// or a pure canvas function wrapped with terrainRendererFromCanvasFunction(id, fn),
// where fn({ mapLayout, terrainData, biome, seed, cols, rows }) returns an
// HTMLCanvasElement of cols*48 × rows*48 (the procedural renderer's contract).
// Register with registerBattlefieldTerrainRenderer(); make it the default with
// setDefaultBattlefieldTerrainRenderer(id). Callers never see atlases.

import { attachRangeDressing } from './RangeDressing.js';
import { attachBoardFrame, boardRect } from './BoardFrame.js';
import { collectShimmer, shimmerFrame } from '../art/terrain/shimmer.js';
import { collectWater, waterFrame, WATER_MOTION } from '../art/terrain/waterMotion.js';
import { loadWeatheredArt, drawWeatheredTile, WEATHERED_TILE_SIZE } from './WeatheredTerrain.js';
import { softenGrassTexture } from './BattleContrast.js';
import { TILE_SIZE } from '../utils/constants.js';
import { displayLayout } from '../utils/boardOrientation.js';
import { proceduralTerrainRenderer } from './proceduralTerrainRenderer.js';
import {
  battlefieldArtEnabled,
  battlefieldTerrainArtEnabled,
  battlefieldSpriteArtEnabled,
  battlefieldContrastEnabled,
  boardDressingEnabled,
  requestedTerrainRenderer,
} from './battlefieldArtFlags.js';

export {
  battlefieldArtEnabled,
  battlefieldTerrainArtEnabled,
  battlefieldSpriteArtEnabled,
  battlefieldContrastEnabled,
};

// --- Renderer registry ------------------------------------------------------------

const renderers = new Map();
// The approved procedural terrain is the default; the weathered atlases stay registered
// as the dev comparison / fallback (?terrainArt=weathered).
let defaultRendererId = 'procedural';

export function registerBattlefieldTerrainRenderer(renderer) {
  if (!renderer?.id || typeof renderer.render !== 'function') {
    throw new Error('Terrain renderer needs an id and render()');
  }
  renderers.set(renderer.id, renderer);
  return renderer;
}

export function setDefaultBattlefieldTerrainRenderer(id) {
  if (!renderers.has(id)) throw new Error(`Unknown terrain renderer: ${id}`);
  defaultRendererId = id;
}

export function getBattlefieldTerrainRenderer(id = null) {
  return renderers.get(id || '') || renderers.get(defaultRendererId) || null;
}

/** Adapt a pure `(input) => canvas` renderer (e.g. the procedural terrain) to the seam. */
export function terrainRendererFromCanvasFunction(id, fn, { prepare, cellSize = 48 } = {}) {
  return {
    id,
    cellSize,
    prepare: prepare || (() => Promise.resolve(null)),
    render: (_resources, input) => ({ canvas: fn(input), painted: () => true }),
  };
}

/** Deterministic presentation seed from the layout (never touches the battle RNG). */
export function terrainPresentationSeed(mapLayout, biome = null) {
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    h = Math.imul(h ^ (v & 0xffff), 16777619) >>> 0;
  };
  for (const row of mapLayout || []) {
    mix(0xfe);
    for (const v of row || []) mix(Number(v) + 1);
  }
  for (const ch of String(biome || '')) mix(ch.charCodeAt(0));
  return h;
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// --- Default renderer: weathered atlases -------------------------------------------

let weatheredArtPromise = null;

function weatheredAt(input) {
  const { mapLayout, terrainData } = input;
  return (col, row) => terrainData[mapLayout[row]?.[col]]?.name;
}

function paintWeatheredCell(art, input, ctx, scratch, col, row) {
  const size = WEATHERED_TILE_SIZE;
  const sctx = scratch.getContext('2d');
  sctx.clearRect(0, 0, size, size);
  const at = weatheredAt(input);
  if (!drawWeatheredTile(sctx, art, at, col, row, { biome: input.biome })) return false;
  if (input.softenGrass && at(col, row) === 'Plain') softenGrassTexture(sctx, size);
  ctx.clearRect(col * size, row * size, size, size);
  ctx.drawImage(scratch, col * size, row * size);
  return true;
}

export const weatheredTerrainRenderer = {
  id: 'weathered',
  cellSize: WEATHERED_TILE_SIZE,
  prepare() {
    weatheredArtPromise ||= loadWeatheredArt(
      `${import.meta.env.BASE_URL}assets/terrain/weathered`,
    ).catch((error) => {
      weatheredArtPromise = null; // allow a retry on the next battle
      throw error;
    });
    return weatheredArtPromise;
  },
  render(art, input) {
    const size = WEATHERED_TILE_SIZE;
    const canvas = makeCanvas(input.cols * size, input.rows * size);
    const ctx = canvas.getContext('2d');
    const scratch = makeCanvas(size, size);
    const painted = new Set();
    for (let row = 0; row < input.rows; row++) {
      for (let col = 0; col < input.cols; col++) {
        if (paintWeatheredCell(art, input, ctx, scratch, col, row)) painted.add(`${col},${row}`);
      }
    }
    return { canvas, painted: (col, row) => painted.has(`${col},${row}`), paintedSet: painted };
  },
  renderCells(art, input, canvas, cells, result) {
    const ctx = canvas.getContext('2d');
    const scratch = makeCanvas(WEATHERED_TILE_SIZE, WEATHERED_TILE_SIZE);
    for (const { col, row } of cells) {
      const ok = paintWeatheredCell(art, input, ctx, scratch, col, row);
      if (result?.paintedSet) {
        if (ok) result.paintedSet.add(`${col},${row}`);
        else result.paintedSet.delete(`${col},${row}`);
      }
    }
  },
};
registerBattlefieldTerrainRenderer(weatheredTerrainRenderer);
registerBattlefieldTerrainRenderer(proceduralTerrainRenderer);

// --- Painting a live battle --------------------------------------------------------

let paintingSeq = 0;

/**
 * Texel density for the displayed texture. A fixed 1:1 desktop camera reads best from
 * terrain pre-filtered to exactly one texel per world pixel; zoomable phone cameras
 * keep the renderer's full density.
 */
export function displayCellSize(rendererCellSize, { zoomable }) {
  return zoomable ? rendererCellSize : TILE_SIZE;
}

export class BattlefieldTerrainPainting {
  constructor(scene, grid, renderer, { zoomable = false, softenGrass = false } = {}) {
    this.scene = scene;
    this.grid = grid;
    this.renderer = renderer;
    this.rendererId = renderer.id;
    this.zoomable = zoomable;
    this.softenGrass = softenGrass;
    this.id = ++paintingSeq;
    this.key = `battlefield-terrain-${this.id}`;
    this.records = new Map(); // tile object → original { key, frame, hidden[] }
    this.painted = false;
    this.destroyed = false;
    this.ready = Promise.resolve(false);
  }

  start() {
    this._abort = typeof AbortController === 'function' ? new AbortController() : null;
    // A late load after shutdown or a rebuilt grid must not touch stale tiles.
    const stale = () => this.destroyed || this.scene?.grid !== this.grid || !this.scene?.textures;
    this.ready = Promise.resolve()
      .then(() => this.renderer.prepare())
      .then(async (resources) => {
        if (stale()) return false;
        this.resources = resources;
        let prerendered = null;
        if (typeof this.renderer.renderAsync === 'function') {
          prerendered = await this.renderer.renderAsync(resources, this._input(), {
            signal: this._abort?.signal,
          });
          if (stale()) {
            this.renderer.dispose?.(prerendered);
            return false;
          }
        }
        return this._paintAll(prerendered);
      })
      .catch((error) => {
        if (!this.destroyed && error?.name !== 'AbortError')
          console.warn('[BattlefieldArt]', error?.message || error);
        return false;
      });
    return this;
  }

  // Renderers paint the board as drawn: on a rotated (portrait) board they receive the
  // layout re-indexed by display cell, so shores, walls and bridges join the neighbors
  // they are drawn beside and upright art (trees, forts) stays upright.
  _dims() {
    const g = this.grid;
    return {
      cols: g.board?.displayCols ?? g.cols,
      rows: g.board?.displayRows ?? g.rows,
    };
  }

  _cell(col, row) {
    return this.grid.board?.toDisplay?.(col, row) || { col, row };
  }

  _input() {
    const g = this.grid;
    const { cols, rows } = this._dims();
    return {
      mapLayout: displayLayout(g.mapLayout, g.board),
      terrainData: g.terrainData,
      cols,
      rows,
      biome: g.biome || null,
      seed: terrainPresentationSeed(g.mapLayout, g.biome),
      softenGrass: this.softenGrass,
    };
  }

  _paintAll(prerendered = null) {
    const { scene, grid, renderer } = this;
    const input = this._input();
    const result = prerendered || renderer.render(this.resources, input);
    if (!result?.canvas) return false;
    this.result = result;
    this.source = result.canvas;
    // An off-thread paint started from an earlier layout: catch up on any terrain that
    // changed while it ran (temporary terrain, an early restore) before first display.
    if (prerendered && typeof renderer.renderCells === 'function') {
      renderer.renderCells(this.resources, input, this.source, [], result);
    }
    const cell = displayCellSize(renderer.cellSize || WEATHERED_TILE_SIZE, {
      zoomable: this.zoomable,
    });
    this.cell = cell;
    const dims = this._dims();
    this.canvas =
      cell === (renderer.cellSize || WEATHERED_TILE_SIZE)
        ? this.source
        : makeCanvas(dims.cols * cell, dims.rows * cell);
    this._resample(0, 0, dims.cols, dims.rows);
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key);
    this.texture = scene.textures.addCanvas(this.key, this.canvas);
    if (!this.texture) return false;
    // Frames are keyed by drawn cell.
    for (let row = 0; row < dims.rows; row++) {
      for (let col = 0; col < dims.cols; col++) {
        this.texture.add(`${col},${row}`, 0, col * cell, row * cell, cell, cell);
      }
    }
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) this._applyTile(col, row);
    }
    this._unlisten = grid.addTerrainListener?.((col, row) => this.onTerrainChanged(col, row));
    this.painted = true;
    this._startShimmer();
    return true;
  }

  // Living liquids: the painter's palette-cycled glints (water, lava, acid) and the
  // river's drifting streaks and bank foam, recoloured on one small overlay just above
  // the tiles (below the fog). Off under Reduce motion, low effects or Atmosphere off;
  // a failure here only loses the motion.
  _startShimmer() {
    const { scene, grid } = this;
    const state = this.result?.terrain?.state;
    if (!state || !scene?.add?.image || !scene.time?.addEvent || !boardDressingEnabled()) return;
    try {
      const settings = scene.registry?.get?.('settings');
      if (settings?.getReduceMotion?.()) return;
      if (settings?.getEffectsQuality?.() === 'low' || settings?.getAtmosphere?.() === 'off')
        return;
      const canvas = makeCanvas(state.W, state.H);
      const ctx = canvas.getContext('2d');
      const key = `${this.key}-shimmer`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const texture = scene.textures.addCanvas(key, canvas);
      const rect = boardRect(grid);
      this._shimmerKey = key;
      this._shimmerImage = scene.add
        .image(rect.x, rect.y, key)
        .setOrigin(0, 0)
        .setDisplaySize(rect.width, rect.height)
        .setDepth(0.5);
      const life = { image: null, out32: null, glints: null, water: null, started: scene.time.now };
      life.collect = () => {
        life.image = new ImageData(state.W, state.H);
        life.out32 = new Uint32Array(life.image.data.buffer);
        life.glints = collectShimmer(state);
        life.water = collectWater(state);
      };
      life.draw = () => {
        if (!life.glints.count && !life.water.count) return;
        const t = scene.time.now - life.started;
        waterFrame(life.water, life.out32, t);
        shimmerFrame(life.glints, life.out32, t);
        ctx.putImageData(life.image, 0, 0);
        texture.refresh();
      };
      life.collect();
      if (!life.glints.count && !life.water.count) return this._stopShimmer();
      life.draw();
      life.timer = scene.time.addEvent({
        delay: WATER_MOTION.frameMs,
        loop: true,
        callback: () => {
          try {
            life.draw();
          } catch (error) {
            this._stopShimmer();
            console.warn('[BattlefieldArt] shimmer', error?.message || error);
          }
        },
      });
      // After a repaint (temporary terrain, a rewind) the animated pixels may have moved.
      life.refresh = () => {
        life.collect();
        ctx.clearRect(0, 0, state.W, state.H);
        life.draw();
      };
      this._shimmer = life;
    } catch (error) {
      this._stopShimmer();
      console.warn('[BattlefieldArt] shimmer', error?.message || error);
    }
  }

  _stopShimmer() {
    this._shimmer?.timer?.remove?.();
    this._shimmer = null;
    if (this._shimmerImage?.scene) this._shimmerImage.destroy();
    this._shimmerImage = null;
    this._shimmerTexture = null;
    if (this._shimmerKey && this.scene?.textures?.exists?.(this._shimmerKey))
      this.scene.textures.remove(this._shimmerKey);
    this._shimmerKey = null;
  }

  // Area-average the renderer's canvas down to the display density (desktop).
  _resample(col, row, cols, rows) {
    if (this.canvas === this.source) return;
    const src = this.renderer.cellSize || WEATHERED_TILE_SIZE;
    const ctx = this.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const c = this.cell;
    ctx.clearRect(col * c, row * c, cols * c, rows * c);
    ctx.drawImage(
      this.source,
      col * src,
      row * src,
      cols * src,
      rows * src,
      col * c,
      row * c,
      cols * c,
      rows * c,
    );
  }

  _isPainted(col, row) {
    const cell = this._cell(col, row);
    return this.result?.painted ? this.result.painted(cell.col, cell.row) : true;
  }

  // (col, row) are game coordinates: the tile object lives at grid.tiles[row][col] and
  // shows the frame of the cell it is drawn in.
  _applyTile(col, row) {
    const tile = this.grid.tiles?.[row]?.[col];
    if (!tile || !this._isPainted(col, row)) return;
    const drawn = this._cell(col, row);
    const frame = `${drawn.col},${drawn.row}`;
    // Ballista cells are containers (ground + siege engine overlay); the painted cell
    // already contains the engine, so paint the ground child and hide the overlay.
    const target = tile.setTexture ? tile : tile.list?.find?.((child) => child?.setTexture);
    if (!target) return;
    if (!this.records.has(target)) {
      const hidden =
        target === tile ? [] : (tile.list || []).filter((c) => c !== target && c.visible);
      this.records.set(target, {
        key: target.texture?.key,
        frame: target.frame?.name,
        hidden,
      });
      for (const child of hidden) child.setVisible?.(false);
    }
    target.setTexture(this.key, frame).setDisplaySize(TILE_SIZE, TILE_SIZE);
  }

  /**
   * Grid.setTerrainAt rebuilt a tile (temporary terrain, villages, rewinds). The new
   * tile object gets its frame immediately; the pixels of it and its neighbors (edge
   * art depends on them) are repainted once per burst — a checkpoint restore can
   * change many cells in one call stack — before the next frame renders.
   */
  onTerrainChanged(col, row) {
    if (!this.painted || this.destroyed) return;
    const { grid } = this;
    this._pending ||= new Set();
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        if (c >= 0 && r >= 0 && c < grid.cols && r < grid.rows) this._pending.add(`${c},${r}`);
      }
    }
    this._applyTile(col, row);
    if (this._flushQueued) return;
    this._flushQueued = true;
    queueMicrotask(() => {
      this._flushQueued = false;
      this.flushTerrainChanges();
    });
  }

  flushTerrainChanges() {
    const pending = this._pending;
    this._pending = null;
    if (!pending?.size || !this.painted || this.destroyed) return;
    const cells = [...pending].map((k) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row };
    });
    const input = this._input();
    // Pending cells are game coordinates (a 3x3 block stays a 3x3 block when turned).
    const drawnCells = cells.map(({ col, row }) => this._cell(col, row));
    if (typeof this.renderer.renderCells === 'function') {
      this.renderer.renderCells(this.resources, input, this.source, drawnCells, this.result);
      for (const { col, row } of drawnCells) this._resample(col, row, 1, 1);
    } else {
      const next = this.renderer.render(this.resources, input);
      if (!next?.canvas) return;
      this.result = next;
      const ctx = this.source.getContext('2d');
      ctx.clearRect(0, 0, this.source.width, this.source.height);
      ctx.drawImage(next.canvas, 0, 0);
      const dims = this._dims();
      this._resample(0, 0, dims.cols, dims.rows);
    }
    this.texture.refresh();
    for (const { col, row } of cells) this._applyTile(col, row);
    this._shimmer?.refresh?.();
  }

  restore() {
    for (const [target, original] of this.records) {
      if (!target.scene) continue;
      if (original.key) target.setTexture(original.key, original.frame);
      target.setDisplaySize?.(TILE_SIZE, TILE_SIZE);
      for (const child of original.hidden) if (child.scene) child.setVisible?.(true);
    }
    this.records.clear();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._abort?.abort();
    this._unlisten?.();
    this._unlisten = null;
    this._stopShimmer();
    this.restore();
    if (this.scene?.textures?.exists?.(this.key)) this.scene.textures.remove(this.key);
    this.renderer.dispose?.(this.result);
    this.result = null;
    this.texture = null;
    this.painted = false;
  }
}

/**
 * Paint a live battle's terrain. Returns the painting (await `.ready` for completion)
 * or null when terrain art is off or the scene cannot host it (tests, no DOM).
 */
export function paintBattlefieldTerrain(scene, grid, options = {}) {
  // The board's dressing (range overlays, walk ribbon) rides with its art.
  if (boardDressingEnabled()) {
    attachRangeDressing(scene, grid);
    attachBoardFrame(scene, grid);
  }
  if (!battlefieldTerrainArtEnabled()) return null;
  if (typeof document === 'undefined' || !grid?.tiles?.length || !scene?.textures?.addCanvas)
    return null;
  const renderer = getBattlefieldTerrainRenderer(options.rendererId || requestedTerrainRenderer());
  if (!renderer) return null;
  return new BattlefieldTerrainPainting(scene, grid, renderer, {
    zoomable: options.zoomable ?? Boolean(scene.mobileCameraEnabled),
    softenGrass: options.softenGrass ?? battlefieldContrastEnabled(),
  }).start();
}

/** Put the classic tiles back and release the painted texture. */
export function restoreBattlefieldTerrain(painting) {
  painting?.destroy?.();
}
