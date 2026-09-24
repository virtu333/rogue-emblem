// Pack baked frames into one atlas + a runtime manifest. Each sprite is a strip of
// equal square cells (idle 0..3, attack windup, strike); strips are laid out in a
// few columns so the atlas stays under 2048 px on each side (safe on every WebGL
// device). Pure.
import { Raster } from './raster.mjs';
import { textureSize, footRow } from './place.mjs';

export const FRAME_ORDER = ['idle0', 'idle1', 'idle2', 'idle3', 'windup', 'strike'];

export function packAtlas(baked, { density = 1.5, maxSide = 2048 } = {}) {
  const cell = textureSize(density);
  const stripW = cell * FRAME_ORDER.length;
  const perRow = Math.max(1, Math.floor(maxSide / stripW));
  const rows = Math.ceil(baked.length / perRow);
  if (rows * cell > maxSide) throw new Error(`Atlas overflow: ${baked.length} sprites exceed ${maxSide}px`);
  const atlas = new Raster(stripW * Math.min(perRow, baked.length), cell * rows);
  const sprites = {};
  baked.forEach((b, i) => {
    const x = (i % perRow) * stripW,
      y = Math.floor(i / perRow) * cell;
    b.frames.forEach((f, col) => atlas.draw(f, x + col * cell, y));
    sprites[b.key] = { x, y, kind: b.kind };
  });
  return {
    atlas,
    manifest: {
      version: 1,
      density,
      cell,
      footRow: footRow(density),
      frames: FRAME_ORDER,
      sprites,
    },
  };
}
