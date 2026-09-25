// proceduralTerrainRenderer — the approved procedural terrain (src/art/terrain) behind
// the BattlefieldArt seam. Paints the whole battlefield from the map layout in the
// Ink & Ember ramps: no atlases, no cell grid, objects kept inside their own cells.
//
// Battle start paints off the main thread (module Worker, else ≤8 ms time slices) via
// renderAsync, so entering a battle on a phone never stalls; the classic tiles stay on
// screen until the paint lands. Mid-battle terrain changes (temporary terrain, villages,
// rewinds, checkpoint restores) repaint only the changed cells' 3×3 neighbourhoods by
// diffing the grid layout against the painted one, bit-identical to a full repaint.

import {
  paintTerrainCanvas,
  paintTerrainCanvasAsync,
  syncTerrainCanvas,
} from '../art/terrain/canvas.js';
import { disposeTerrain } from '../art/terrain/index.js';

export const PROCEDURAL_TERRAIN_ID = 'procedural';

function paintOptions(input) {
  return {
    mapLayout: input.mapLayout,
    terrainData: input.terrainData,
    biome: input.biome || null,
    seed: input.seed,
    cellPx: 48,
  };
}

function wrap(painted) {
  return { canvas: painted.canvas, terrain: painted.result, painted: () => true };
}

export const proceduralTerrainRenderer = {
  id: PROCEDURAL_TERRAIN_ID,
  cellSize: 48,
  prepare: () => Promise.resolve(null),
  /** Synchronous full paint (fallback path; tests and tools). */
  render(_resources, input) {
    return wrap(paintTerrainCanvas(paintOptions(input)));
  },
  /** Battle-start paint that never blocks the main thread for long. */
  async renderAsync(_resources, input, { signal } = {}) {
    return wrap(await paintTerrainCanvasAsync(paintOptions(input), { signal }));
  },
  /**
   * Bring the painted canvas in line with the grid. The layout diff finds every changed
   * cell itself, so `cells` (the caller's dirty neighbourhood) is informational.
   * @returns {Array<{x:number,y:number,width:number,height:number}>} repainted rects
   */
  renderCells(_resources, input, canvas, _cells, result) {
    if (!result?.terrain) return [];
    return syncTerrainCanvas(canvas, result.terrain, input.mapLayout, input.terrainData);
  },
  dispose(result) {
    if (result?.terrain?.state) disposeTerrain(result.terrain);
  },
};
