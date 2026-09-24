// Phone-scale staging on the approved procedural terrain (and the weathered
// atlases) — mirrors BattleScene.addUnitGraphic for rebuilt 64px textures:
//   texture 64x64 world px centred on the tile (feet on y=44 -> 4px above the
//   tile's bottom edge), 1px contrast halo (BattleContrast), faction ring 24x12
//   at tile centre +6 (2px stroke, 0.7 alpha), HP bar 26x3 at centre +12.
// World px (32 per tile) map to CSS px at 34/32, i.e. 34 CSS px per cell.
import { Img } from './image.mjs';
import { gameHalo, acted as actedFn } from './treat.mjs';
import { STUDY_MAPS, generateStudyMap } from '../../procedural-terrain/lib/maps.mjs';
import { renderTerrain } from '../../procedural-terrain/lib/render.mjs';
import { indexToRgba, upscaleNearest, strokeEllipse } from '../../procedural-terrain/lib/image.mjs';
import { loadWeatheredAtlases, renderWeathered } from '../../procedural-terrain/lib/weathered.mjs';

export const CELL = 34;
const RING = { player: [0x33, 0x66, 0xcc], enemy: [0xcc, 0x33, 0x33] };

let atlases = null;
const boards = new Map();

// Returns { img (48px/cell Img), map } for a terrain-study map key.
export async function loadBoard(key, kind = 'procedural') {
  const k = `${key}:${kind}`;
  if (boards.has(k)) return boards.get(k);
  const spec = STUDY_MAPS.find((s) => s.key === key);
  const map = generateStudyMap(spec);
  let img;
  if (kind === 'procedural') {
    const r = renderTerrain(map.names, { biome: map.biome, seed: spec.seed * 1000 + 7 });
    img = Img.from(r.w * 2, r.h * 2, upscaleNearest(indexToRgba(r.idx, r.w, r.h), r.w, r.h, 2));
  } else {
    atlases ||= await loadWeatheredAtlases();
    const w = renderWeathered(map.names, map.biome, atlases);
    img = Img.from(w.w, w.h, w.data);
  }
  const b = { img, map, spec };
  boards.set(k, b);
  return b;
}

// Passable cells (for placing staged units).
const BLOCK = new Set(['Wall', 'Water', 'Mountain', 'Pillar', 'Lava Crack', 'Peak']);
export function openCells(map, c0, r0, cols, rows) {
  const out = [];
  for (let r = r0; r < r0 + rows; r++)
    for (let c = c0; c < c0 + cols; c++) if (!BLOCK.has(map.names[r]?.[c])) out.push([c, r]);
  return out;
}

/**
 * Stage units on a crop of a board at phone scale.
 * units: [{ col, row, tex: Img64, faction, acted, hp (0..1), halo (default true) }]
 * opts.scale: CSS px per cell (34) — or 102 for a 3x-DPR device-pixel view.
 */
export function stage(board, [c0, r0, cols, rows], units, opts = {}) {
  const T = opts.scale ?? CELL;
  const k = T / 32;
  const cut = board.img.crop(c0 * 48, r0 * 48, cols * 48, rows * 48);
  const out = opts.nearest
    ? cut.resizeNearest(cols * T, rows * T)
    : cut.resizeArea(cols * T, rows * T);
  const sorted = [...units].sort((a, b) => a.row - b.row);
  for (const u of sorted) {
    if (u.ring === false) continue;
    const cx = (u.col - c0 + 0.5) * T,
      cy = (u.row - r0 + 0.5) * T;
    strokeEllipse(
      out.d,
      out.w,
      out.h,
      cx,
      cy + 6 * k,
      12 * k,
      6 * k,
      2 * k,
      RING[u.faction === 'player' ? 'player' : 'enemy'],
      0.7,
    );
  }
  for (const u of sorted) {
    const cx = (u.col - c0 + 0.5) * T,
      cy = (u.row - r0 + 0.5) * T;
    let tex = u.halo === false ? u.tex : gameHalo(u.tex, Img);
    if (u.acted) tex = tex.map(actedFn);
    const size = Math.round(64 * k);
    const scaled = opts.nearest ? tex.resizeNearest(size, size) : tex.resizeArea(size, size);
    out.draw(scaled, Math.round(cx - size / 2), Math.round(cy - size / 2));
    if (u.hp !== false) {
      const bw = Math.round(26 * k),
        bh = Math.max(2, Math.round(3 * k));
      const bx = Math.round(cx - bw / 2),
        by = Math.round(cy + 12 * k - bh / 2);
      const col = RING[u.faction === 'player' ? 'player' : 'enemy'];
      out.fillRect(bx, by, bw, bh, [...col.map((v) => v * 0.3), 255]);
      out.fillRect(
        bx,
        by,
        Math.round(bw * (u.hp ?? 0.8)),
        bh,
        u.faction === 'player' ? [0x44, 0xcc, 0x44, 255] : [0xcc, 0x44, 0x44, 255],
      );
    }
  }
  return out;
}

export { STUDY_MAPS };
