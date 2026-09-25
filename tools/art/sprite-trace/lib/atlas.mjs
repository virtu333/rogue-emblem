// Pack baked frames into atlas pages + a runtime manifest. Pure.
//
// Each sprite is a strip of equal frames (the runtime ships the four idle frames). Every
// frame of a sprite is trimmed to the union of the sprite's opaque bounds, so the
// transparent margin around a figure (most of its square texture: the empty rows under
// the feet, the air around an infantry unit) costs no texture memory. The runtime
// registers each frame on the page with that trim (Phaser Frame#setTrim), so the logical
// frame stays the square texture the placement rules were written for (96 px at D = 1.5,
// feet on row 66). Strips are shelf-packed into pages of at most `maxSide` px (2048: safe
// on every WebGL device), 1 px of transparent gutter around every frame so nearest
// sampling never picks a neighbour's texel.
import { Raster } from './raster.mjs';
import { textureSize, footRow } from './place.mjs';

export const FRAME_ORDER = ['idle0', 'idle1', 'idle2', 'idle3', 'windup', 'strike'];
/** Frames shipped to the game: idle loop plus the attack key poses (combat choreography). */
export const RUNTIME_FRAMES = FRAME_ORDER;

const GUTTER = 1;

/** Union of the opaque bounds of every frame (null when all are empty). */
function unionBounds(frames) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (const f of frames) {
    const b = f.alphaBounds(0);
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * baked: [{ key, kind, frames: [Raster] }] (all frames of a sprite the same square size).
 * Returns { pages: [Raster], manifest }.
 */
export function packAtlas(baked, { density = 1.5, maxSide = 2048, frames = RUNTIME_FRAMES } = {}) {
  const items = baked.map((b) => {
    const size = b.frames[0].w;
    const box = unionBounds(b.frames) || { x: 0, y: 0, width: 1, height: 1 };
    const w = box.width,
      h = box.height;
    return {
      key: b.key,
      kind: b.kind,
      size,
      box,
      frames: b.frames.map((f) => f.crop(box.x, box.y, w, h)),
      w,
      h,
      stripW: b.frames.length * (w + GUTTER * 2),
      stripH: h + GUTTER * 2,
    };
  });
  // tallest strips first (stable on key) keeps the shelves tight and the output deterministic
  const order = [...items].sort((a, b) => b.stripH - a.stripH || (a.key < b.key ? -1 : 1));
  const pages = [];
  let page = null;
  const newPage = () => {
    page = { shelves: [], height: 0, width: 0, placed: [] };
    pages.push(page);
  };
  newPage();
  for (const it of order) {
    if (it.stripW > maxSide || it.stripH > maxSide)
      throw new Error(`Sprite ${it.key} (${it.stripW}x${it.stripH}) exceeds ${maxSide}px`);
    let shelf = page.shelves.find((s) => s.x + it.stripW <= maxSide && it.stripH <= s.h);
    if (!shelf) {
      if (page.height + it.stripH > maxSide) newPage();
      shelf = { y: page.height, h: it.stripH, x: 0 };
      page.shelves.push(shelf);
      page.height += it.stripH;
    }
    page.placed.push({ it, x: shelf.x, y: shelf.y });
    shelf.x += it.stripW;
    page.width = Math.max(page.width, shelf.x);
  }
  const rasters = [];
  const sprites = {};
  pages.forEach((p, index) => {
    const r = new Raster(p.width, p.height);
    for (const { it, x, y } of p.placed) {
      it.frames.forEach((f, i) => r.draw(f, x + i * (it.w + GUTTER * 2) + GUTTER, y + GUTTER));
      sprites[it.key] = {
        page: index,
        x: x + GUTTER,
        y: y + GUTTER,
        w: it.w,
        h: it.h,
        step: it.w + GUTTER * 2,
        ox: it.box.x,
        oy: it.box.y,
        size: it.size,
        kind: it.kind,
      };
    }
    rasters.push(r);
  });
  // manifest keys in bake order (readable diffs)
  const ordered = {};
  for (const b of baked) ordered[b.key] = sprites[b.key];
  return {
    pages: rasters,
    manifest: {
      version: 2,
      density,
      cell: textureSize(density),
      footRow: footRow(density),
      frames,
      pages: rasters.map((_, i) => `traced-atlas-${i}.png`),
      sprites: ordered,
    },
  };
}
