// Procedural battlefield terrain: public API (pure ES module, no Phaser, no
// DOM, no Node APIs). See README.md in this folder for the integration
// contract. Browser helpers (canvas, time-slicing, worker, shimmer overlay)
// live in canvas.js.
import { TerrainState, ART_CELL } from './state.js';
import { renderSteps, renderAll, dirtyRects, renderRects, writeRGBA } from './pipeline.js';
import { BIOMES } from './biomes.js';
import { seedFrom } from './noise.js';

export { ART_CELL } from './state.js';
export { PALETTE, HEX, RAMP, PALETTE_RGBA32, PALETTE_SIZE } from './palette.js';
export { BIOME_NAMES, PAINTED_TERRAIN } from './biomes.js';
export { OBJECT_LIMITS, buildCellObject } from './objects.js';
export { ANIM, CYCLES, collectShimmer, shimmerFrame } from './shimmer.js';
export { seedFrom } from './noise.js';
export { TerrainState } from './state.js';

/** Output px per map cell by default (the weathered texture size; the world cell is 32). */
export const DEFAULT_CELL_PX = 48;
/** The game's world tile size, for reference: draw the output scaled by WORLD_CELL_PX / cellPx. */
export const WORLD_CELL_PX = 32;

/** Map a Grid/MapGenerator biome (possibly null) to a painted biome. */
export function resolveBiome(biome) {
  return biome && BIOMES[biome] ? biome : 'grassland';
}

/** Terrain names [row][col] from the game's mapLayout indices + terrain.json rows. */
export function namesFromLayout(mapLayout, terrainData) {
  if (!Array.isArray(mapLayout) || !mapLayout.length) throw new Error('mapLayout is empty');
  return mapLayout.map((row) =>
    row.map((i) => (typeof i === 'string' ? i : (terrainData?.[i]?.name ?? 'Plain'))),
  );
}

function checkCellPx(cellPx) {
  if (!Number.isInteger(cellPx) || cellPx <= 0 || cellPx % ART_CELL !== 0)
    throw new Error(`cellPx must be a positive multiple of ${ART_CELL} (got ${cellPx})`);
  return cellPx / ART_CELL;
}

/**
 * Prepare a render without painting (for time-sliced / worker painting).
 * @param {object} o
 * @param {number[][]} [o.mapLayout]  terrain indices [row][col] (Grid.mapLayout)
 * @param {object[]} [o.terrainData]  data/terrain.json rows (Grid.terrainData)
 * @param {string[][]} [o.names]      alternatively, terrain names [row][col]
 * @param {string|null} [o.biome]
 * @param {number|string} [o.seed]
 * @param {number} [o.cellPx=48]      output px per cell (multiple of 24)
 */
export function createTerrainJob({
  mapLayout,
  terrainData,
  names,
  biome = null,
  seed = 1,
  cellPx = DEFAULT_CELL_PX,
} = {}) {
  const scale = checkCellPx(cellPx);
  const state = new TerrainState({
    names: names || namesFromLayout(mapLayout, terrainData),
    biome: resolveBiome(biome),
    seed: seedFrom(seed),
  });
  return {
    state,
    cellPx,
    scale,
    /** Generator of work units (each one pass over one band of rows). */
    steps: (bandCells = 2) => renderSteps(state, { bandCells }),
    /** Assemble the result once every step has run. */
    finish() {
      if (!state.rendered) renderAll(state);
      return makeResult(state, cellPx, scale);
    },
  };
}

function makeResult(state, cellPx, scale) {
  const width = state.W * scale,
    height = state.H * scale;
  const pixels = new Uint8ClampedArray(width * height * 4);
  writeRGBA(state, pixels, scale);
  return {
    width,
    height,
    cellPx,
    scale,
    cols: state.cols,
    rows: state.rows,
    biome: state.biome,
    seed: state.seed,
    pixels,
    state,
  };
}

/**
 * Paint a whole battlefield synchronously.
 * @returns {{width:number,height:number,cellPx:number,scale:number,cols:number,rows:number,
 *   biome:string,seed:number,pixels:Uint8ClampedArray,state:TerrainState}}
 */
export function renderBattlefieldTerrain(options = {}) {
  const job = createTerrainJob(options);
  renderAll(job.state);
  return job.finish();
}

/**
 * Mid-battle terrain changes: repaint only the 3x3 neighbourhoods of the
 * given cells, in place, in `result.pixels`.
 *
 * @param {object} result  from renderBattlefieldTerrain / a finished job
 * @param {{col:number,row:number,name?:string}[]} cells
 *   the changed cells; `name` is the new terrain name, otherwise it is read
 *   from `mapLayout` + `terrainData`
 * @param {{mapLayout?:number[][], terrainData?:object[]}} [source]
 * @returns {{x:number,y:number,width:number,height:number}[]} updated
 *   rectangles in output pixels (empty when nothing changed)
 */
export function repaintCells(result, cells, { mapLayout, terrainData } = {}) {
  const S = result.state;
  if (!S) throw new Error('repaintCells needs a live result (was it disposed?)');
  const changed = [];
  for (const cell of cells || []) {
    const { col, row } = cell;
    if (!S.inMap(col, row)) continue;
    let name = cell.name;
    if (name === undefined && mapLayout) {
      const v = mapLayout[row]?.[col];
      name = typeof v === 'string' ? v : terrainData?.[v]?.name;
    }
    if (name === undefined) continue;
    if (S.setCellName(col, row, name)) changed.push({ col, row });
  }
  if (!changed.length) return [];
  const rects = dirtyRects(S, changed);
  renderRects(S, rects);
  const k = result.scale;
  for (const r of rects) writeRGBA(S, result.pixels, k, r);
  return rects.map((r) => ({
    x: r.x0 * k,
    y: r.y0 * k,
    width: (r.x1 - r.x0) * k,
    height: (r.y1 - r.y0) * k,
  }));
}

/**
 * Diff a whole layout against the painted one and repaint what changed
 * (e.g. after a snapshot restore). Same return value as repaintCells.
 */
export function syncTerrainLayout(result, mapLayout, terrainData) {
  const S = result.state;
  const names = namesFromLayout(mapLayout, terrainData);
  const cells = [];
  for (let r = 0; r < S.rows; r++)
    for (let c = 0; c < S.cols; c++)
      if (names[r]?.[c] !== undefined && names[r][c] !== S.names[r][c])
        cells.push({ col: c, row: r, name: names[r][c] });
  return repaintCells(result, cells);
}

/** Output-pixel rectangle of one map cell. */
export function cellRect(result, col, row) {
  return {
    x: col * result.cellPx,
    y: row * result.cellPx,
    width: result.cellPx,
    height: result.cellPx,
  };
}

/**
 * Drop the intermediate buffers (~2 MB for the largest maps) once no more
 * repaints are expected. The pixels stay valid; repaintCells will throw.
 */
export function disposeTerrain(result) {
  result.state = null;
}
