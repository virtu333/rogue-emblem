// Dev helper: write a zoomed comparison strip of RGBA 64x64 sprites.
//   compose([{img, label}], file, {zoom, bg, crop})
import { Img, textImg } from '../lib/image.mjs';

export async function strip(
  items,
  file,
  { zoom = 8, bg = [110, 118, 80, 255], crop = [8, 2, 48, 44], gap = 4 } = {},
) {
  const [cx, cy, cw, ch] = crop;
  const cellW = cw * zoom;
  const out = new Img(
    items.length * (cellW + gap) + gap,
    ch * zoom + 40 + 2 * gap,
    [22, 19, 30, 255],
  );
  let x = gap;
  for (const it of items) {
    const tile = new Img(cw, ch, bg);
    tile.draw(it.img.crop(cx, cy, cw, ch), 0, 0);
    out.draw(tile.scale(zoom), x, gap);
    // 1x inset
    const one = new Img(cw, ch, bg);
    one.draw(it.img.crop(cx, cy, cw, ch), 0, 0);
    out.draw(one, x + 2, gap + 2);
    if (it.label) out.draw(await textImg(it.label, { size: 12 }), x, ch * zoom + gap + 4);
    x += cellW + gap;
  }
  await out.png(file);
}
