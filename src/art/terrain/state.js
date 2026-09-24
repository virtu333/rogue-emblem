// TerrainState: the per-battle buffers of the procedural terrain renderer.
//
// Coordinates: one map cell is ART_CELL (24) art pixels square. The output
// is upscaled by an integer factor (default 2 -> 48 px per cell, the size of
// the game's weathered textures), so every art pixel is a clean block.
//
// Every buffer value at an art pixel depends only on the terrain of the
// pixel's own cell and its 8 neighbours (plus world-space hash noise and the
// seed). That is what lets `repaintCells` recompute only the 3x3
// neighbourhood of a changed cell and still match a full render exactly.
import { BIOMES, MASONRY, groundOf } from './biomes.js';
import { createNoiseCache } from './noise.js';

export const ART_CELL = 24;

export class TerrainState {
  /**
   * @param {object} o
   * @param {string[][]} o.names  terrain name per cell, [row][col]
   * @param {string} [o.biome]    grassland | tundra | volcano | swamp | castle | void
   * @param {number} [o.seed]
   */
  constructor({ names, biome = 'grassland', seed = 1 }) {
    if (!Array.isArray(names) || !names.length || !names[0]?.length)
      throw new Error('TerrainState needs a non-empty names grid');
    this.rows = names.length;
    this.cols = names[0].length;
    this.W = this.cols * ART_CELL;
    this.H = this.rows * ART_CELL;
    this.biome = BIOMES[biome] ? biome : 'grassland';
    this.style = BIOMES[this.biome];
    this.masonry = MASONRY[this.biome] || MASONRY.default;
    this.seed = seed | 0;
    this.names = names.map((row) => {
      if (row.length !== this.cols) throw new Error('Terrain names grid must be rectangular');
      return row.map((n) => (typeof n === 'string' ? n : 'Plain'));
    });
    this.ground = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) this.ground[r * this.cols + c] = this._groundFor(c, r);
    const n = this.W * this.H;
    this.matRaw = new Uint8Array(n); // materials before spur clean-up
    this.mat1 = new Uint8Array(n); // after one clean-up pass
    this.mat = new Uint8Array(n); // final per-pixel ground material
    this.dU = new Uint8Array(n); // capped distance to a different material class
    this.dD = new Uint8Array(n);
    this.dL = new Uint8Array(n);
    this.dR = new Uint8Array(n);
    this.shadow = new Uint8Array(n); // ramp steps of cast shadow
    this.anim = new Uint8Array(n); // palette-cycling class (see shimmer.js)
    this.idx = new Uint8Array(n); // final palette indices
    this.owner = new Uint16Array(n); // 1 + cell index of the object covering the pixel
    // Per-cell object cache (trees / peaks / structures depend only on
    // their own cell, so a cell's entry is dropped only when it changes).
    this.objects = new Array(this.cols * this.rows).fill(undefined);
    this.rendered = false;
    this.nz = createNoiseCache(Math.max(this.W, this.H));
    this._floor = null;
  }

  _groundFor(c, r) {
    return groundOf(this.names[r][c], this.style.defaultGround);
  }

  inMap(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  /** Terrain name, clamped to the map edge (edges extend outward). */
  name(c, r) {
    c = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    r = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return this.names[r][c];
  }

  /** Ground material, clamped to the map edge. */
  groundAt(c, r) {
    c = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    r = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return this.ground[r * this.cols + c];
  }

  /** Exact (unclamped) test used by object / structure logic. */
  is(c, r, name) {
    return this.inMap(c, r) && this.names[r][c] === name;
  }

  matAt(x, y) {
    x = x < 0 ? 0 : x >= this.W ? this.W - 1 : x;
    y = y < 0 ? 0 : y >= this.H ? this.H - 1 : y;
    return this.mat[y * this.W + x];
  }

  dAny(i) {
    const a = this.dU[i],
      b = this.dD[i],
      c = this.dL[i],
      d = this.dR[i];
    return Math.min(a, b, c, d);
  }

  /** Change one cell's terrain. Returns true when it actually changed. */
  setCellName(c, r, name) {
    if (!this.inMap(c, r)) return false;
    name = typeof name === 'string' ? name : 'Plain';
    if (this.names[r][c] === name) return false;
    this.names[r][c] = name;
    this.ground[r * this.cols + c] = this._groundFor(c, r);
    this.objects[r * this.cols + c] = undefined;
    return true;
  }
}
