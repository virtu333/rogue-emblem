// Terrain swatches for review sheets, painted by the game's own procedural terrain
// (src/art/terrain) at 48 texels per cell — the same lattice as D = 1.5 sprites, so a
// 96 px sprite texture composites 1:1 over a 2x2-cell window centred on its tile.
import { renderBattlefieldTerrain } from '../../../../src/art/terrain/index.js';
import { STUDY_MAPS, generateStudyMap, terrainSeed } from '../../procedural-terrain/lib/maps.mjs';
import { Raster } from './raster.mjs';

const boards = new Map();

export function studyBoard(key) {
  if (boards.has(key)) return boards.get(key);
  const spec = STUDY_MAPS.find((s) => s.key === key);
  if (!spec) throw new Error(`No study map ${key}`);
  const map = generateStudyMap(spec);
  const r = renderBattlefieldTerrain({
    names: map.names,
    biome: map.biome,
    seed: terrainSeed(spec),
    cellPx: 48,
  });
  const img = Raster.from(r.width, r.height, r.pixels);
  const board = { map, img, spec };
  boards.set(key, board);
  return board;
}

/** The cell of one of `names` with the most same-named neighbours (a clean patch). */
export function findCell(board, names) {
  const { map } = board;
  let best = null;
  for (let r = 1; r < map.rows - 1; r++)
    for (let c = 1; c < map.cols - 1; c++) {
      if (!names.includes(map.names[r][c])) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) if (names.includes(map.names[r + dr][c + dc])) n++;
      const score = n * 100 - Math.abs(c - map.cols / 2) - Math.abs(r - map.rows / 2);
      if (!best || score > best.score) best = { c, r, score };
    }
  return best;
}

/** 96x96 texel window centred on a cell (what a unit texture covers). */
export function cellWindow(board, cell, size = 96) {
  const cx = cell.c * 48 + 24,
    cy = cell.r * 48 + 24;
  return board.img.crop(cx - size / 2, cy - size / 2, size, size);
}

/** Named review swatches: [label, study map, terrain names]. */
export const SWATCHES = [
  ['grass', 'river', ['Plain']],
  ['forest', 'river', ['Forest']],
  ['stone', 'castle', ['Floor']],
  ['snow', 'frozen', ['Plain', 'Snow', 'Ice']],
  ['swamp', 'mire', ['Swamp', 'Bog', 'Acidic Swamp']],
  ['lava', 'caldera', ['Plain', 'Ash', 'Lava Crack']],
];

export function swatch(label) {
  const [, key, names] = SWATCHES.find((s) => s[0] === label);
  const board = studyBoard(key);
  const cell = findCell(board, names);
  if (!cell) throw new Error(`No ${names} cell in ${key}`);
  return cellWindow(board, cell);
}
