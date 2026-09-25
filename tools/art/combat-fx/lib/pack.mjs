// Trim, dedupe and shelf-pack every layer frame into one palette-indexed atlas, and
// describe it as a Phaser JSON-hash atlas plus the runtime animation table.
import { createHash } from 'crypto';
import { encodeIndexedPng } from '../../pc98/lib/png.mjs';

const PAD = 1;

function trim(ids, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (ids[y * w + x]) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const data = new Uint16Array(tw * th);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) data[y * tw + x] = ids[(y0 + y) * w + x0 + x];
  return { x0, y0, w: tw, h: th, data };
}

function shelf(rects, width) {
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  const pos = [];
  for (const r of rects) {
    if (x + r.w + PAD > width) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    pos.push([x, y]);
    x += r.w + PAD;
    rowH = Math.max(rowH, r.h);
  }
  return { pos, height: y + rowH + PAD };
}

/**
 * @param {Array} rendered renderAnim() results
 * @param {Palette} palette
 */
export function packAtlas(rendered, palette, { image = 'fx_atlas.png' } = {}) {
  const unique = new Map(); // hash -> rect
  const frames = []; // { name, rect, trim, w, h }
  const empty = { w: 1, h: 1, data: new Uint16Array(1), hash: 'empty' };
  unique.set('empty', empty);
  const anims = {};
  for (const r of rendered) {
    const { def } = r;
    const layers = r.layers.map((layer) => {
      const primary = layer === r.layers[0];
      return {
        layer,
        suffix: primary ? '' : '~ink',
        blend: layer === 'glow' ? 'add' : 'normal',
        above: layer === 'solid' ? Boolean(def.solidOnTop) : !def.solidOnTop,
      };
    });
    for (const L of layers) {
      r.frames.forEach((fr, i) => {
        const ids = L.layer === 'glow' ? fr.glow : fr.solid;
        const t = ids ? trim(ids, r.w, r.h) : null;
        let rect = empty;
        if (t) {
          const hash = createHash('sha1')
            .update(`${t.w}x${t.h}:`)
            .update(Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength))
            .digest('hex');
          rect = unique.get(hash);
          if (!rect) {
            rect = { w: t.w, h: t.h, data: t.data, hash };
            unique.set(hash, rect);
          }
        }
        frames.push({
          name: `${def.key}${L.suffix}/${i}`,
          rect,
          sx: t ? t.x0 : 0,
          sy: t ? t.y0 : 0,
          w: r.w,
          h: r.h,
        });
      });
    }
    anims[def.key] = {
      size: [r.w, r.h],
      anchor: def.anchor || [0.5, 0.5],
      frames: def.durations.length,
      durations: def.durations,
      role: def.role,
      directional: Boolean(def.directional),
      loop: Boolean(def.loop),
      layers: layers.map(({ suffix, blend, above }) => ({ suffix, blend, above })),
    };
  }
  // Tallest first, then widest; deterministic tie-break on the content hash.
  const rects = [...unique.values()].sort(
    (a, b) => b.h - a.h || b.w - a.w || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
  );
  let best = null;
  for (let width = 256; width <= 1024; width += 32) {
    const { pos, height } = shelf(rects, width);
    const H = Math.ceil(height / 4) * 4;
    // Both sides stay within 1024 (safe on every mobile GPU's texture limit).
    if (H > 1024) continue;
    const area = width * H;
    if (!best || area < best.area || (area === best.area && Math.max(width, H) < best.max))
      best = { width, height: H, pos, area, max: Math.max(width, H) };
  }
  const W = best.width;
  const H = best.height;
  rects.forEach((rect, k) => {
    [rect.x, rect.y] = best.pos[k];
  });
  const indices = new Uint8Array(W * H);
  for (const rect of rects)
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++)
        indices[(rect.y + y) * W + rect.x + x] = rect.data[y * rect.w + x];
  const pal = palette.hex.map((hex) =>
    hex ? [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) : [0, 0, 0],
  );
  const alpha = palette.hex.map((hex) => (hex ? 255 : 0));
  const png = encodeIndexedPng(W, H, indices, pal, alpha);
  const json = {
    frames: {},
    meta: {
      app: 'tools/art/combat-fx',
      image,
      format: 'RGBA8888',
      size: { w: W, h: H },
      scale: '1',
    },
  };
  for (const fr of frames) {
    const { rect } = fr;
    json.frames[fr.name] = {
      frame: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      rotated: false,
      trimmed: true,
      spriteSourceSize: { x: fr.sx, y: fr.sy, w: rect.w, h: rect.h },
      sourceSize: { w: fr.w, h: fr.h },
    };
  }
  return {
    png,
    json,
    anims,
    stats: {
      width: W,
      height: H,
      decodedBytes: W * H * 4,
      pngBytes: png.length,
      frames: frames.length,
      uniqueRects: rects.length,
      colors: palette.hex.length - 1,
    },
  };
}
