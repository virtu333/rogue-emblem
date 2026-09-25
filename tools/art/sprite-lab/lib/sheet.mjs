// Review-sheet layout helpers: rows of labelled cells.
import { Img, textImg } from './image.mjs';

export const BG = [22, 19, 30, 255]; // ink #16131e
export const MEADOW = [111, 122, 78, 255]; // mid meadow value from the terrain study

// rows: [{ title, cells: [{ img, label }] }]
export async function gridSheet(
  rows,
  { pad = 6, labelSize = 11, title = null, titleSize = 14, cellBg = null } = {},
) {
  const cellW = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.img.w)));
  const cellH = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.img.h)));
  const hasLabels = rows.some((r) => r.cells.some((c) => c.label));
  const labelH = hasLabels ? Math.ceil(labelSize * 1.3) + 8 : 0;
  const rowTitleW = rows.some((r) => r.title) ? 150 : 0;
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const titleH = title ? Math.ceil(titleSize * 1.3 * title.split('\n').length) + 12 : 0;
  const W = rowTitleW + cols * (cellW + pad) + pad;
  const H = titleH + rows.length * (cellH + labelH + pad) + pad;
  const out = new Img(W, H, BG);
  if (title) out.draw(await textImg(title, { size: titleSize, color: '#f4ecdb' }), pad, 4);
  let y = titleH + pad;
  for (const r of rows) {
    if (r.title)
      out.draw(
        await textImg(r.title, { size: labelSize + 1, color: '#dca044' }),
        pad,
        y + Math.floor(cellH / 2) - 10,
      );
    let x = rowTitleW + pad;
    for (const c of r.cells) {
      if (cellBg) out.fillRect(x, y, cellW, cellH, cellBg);
      out.draw(c.img, x + Math.floor((cellW - c.img.w) / 2), y + Math.floor((cellH - c.img.h) / 2));
      if (c.label)
        out.draw(await textImg(c.label, { size: labelSize, color: '#bdb0aa' }), x, y + cellH + 2);
      x += cellW + pad;
    }
    y += cellH + labelH + pad;
  }
  return out;
}

// Place a 64px sprite on a solid/terrain tile of given size (for lineups).
export function onGround(tex, ground = MEADOW, crop = [8, 0, 48, 48]) {
  const [x, y, w, h] = crop;
  const out = new Img(w, h, ground);
  out.draw(tex.crop(x, y, w, h), 0, 0);
  return out;
}

export async function caption(img, text, { size = 12 } = {}) {
  const t = await textImg(text, { size, color: '#ddd0bd' });
  const out = new Img(Math.max(img.w, t.w), img.h + t.h + 4, BG);
  out.draw(t, 0, 0);
  out.draw(img, 0, t.h + 4);
  return out;
}

export function hcat(imgs, gap = 8, bg = BG) {
  const W = imgs.reduce((s, i) => s + i.w, 0) + gap * (imgs.length - 1);
  const H = Math.max(...imgs.map((i) => i.h));
  const out = new Img(W, H, bg);
  let x = 0;
  for (const i of imgs) {
    out.draw(i, x, 0);
    x += i.w + gap;
  }
  return out;
}

export function vcat(imgs, gap = 8, bg = BG) {
  const W = Math.max(...imgs.map((i) => i.w));
  const H = imgs.reduce((s, i) => s + i.h, 0) + gap * (imgs.length - 1);
  const out = new Img(W, H, bg);
  let y = 0;
  for (const i of imgs) {
    out.draw(i, 0, y);
    y += i.h + gap;
  }
  return out;
}
