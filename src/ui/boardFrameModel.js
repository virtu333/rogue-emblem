// boardFrameModel.js — the rectangles of the board's frame (pure, no Phaser).
// Each entry is [x, y, w, h, colour name, alpha] in world pixels.

export const FRAME_COLORS = Object.freeze({
  ink: 0x07060b,
  shadow: 0x2e293a,
  ember: 0xb3702c,
  gold: 0xdca044,
  bone: 0xf4ecdb,
});

export const FRAME_STYLE = Object.freeze({
  skirt: 20, // how far the dithered ground reaches past the border
  cell: 2, // dither cell size
  gap: 3, // dark gap between the map's edge and the ember line
  shade: 6, // inner shade depth
});

// 4x4 Bayer thresholds (0..15).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * @param {{x:number,y:number,width:number,height:number}} rect the board as drawn
 */
export function planBoardFrame(rect, style = FRAME_STYLE) {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const x1 = x0 + w;
  const y1 = y0 + h;
  const plan = { skirt: [], border: [], shade: [], corners: [] };
  const { skirt, cell, gap, shade } = style;

  // Skirt: a dithered band that thins with distance from the border. Each cell is on
  // when its Bayer threshold is under the band's coverage there.
  const edge = gap + 2;
  const cells = Math.ceil((skirt + edge) / cell);
  const outside = (cx, cy) => {
    const dx = cx < x0 ? x0 - cx : cx >= x1 ? cx - x1 + 1 : 0;
    const dy = cy < y0 ? y0 - cy : cy >= y1 ? cy - y1 + 1 : 0;
    return Math.max(dx, dy);
  };
  for (let gy = -cells; gy < Math.ceil(h / cell) + cells; gy++) {
    let run = null;
    for (let gx = -cells; gx <= Math.ceil(w / cell) + cells; gx++) {
      const cx = x0 + gx * cell;
      const cy = y0 + gy * cell;
      const d = outside(cx, cy);
      const cover = d > edge && d <= skirt + edge ? 1 - (d - edge) / skirt : 0;
      const on = cover > 0 && BAYER[(gy & 3) * 4 + (gx & 3)] < cover * cover * 14;
      if (on && run === null) run = cx;
      if (!on && run !== null) {
        plan.skirt.push([run, cy, cx - run, cell, 'shadow', 1]);
        run = null;
      }
    }
  }

  // Border: ink against the map, then a thin ember line, then ink again.
  const ring = (inset, t, color, alpha) => {
    const a = x0 - inset - t;
    const b = y0 - inset - t;
    const ww = w + (inset + t) * 2;
    const hh = h + (inset + t) * 2;
    plan.border.push(
      [a, b, ww, t, color, alpha],
      [a, b + hh - t, ww, t, color, alpha],
      [a, b + t, t, hh - t * 2, color, alpha],
      [a + ww - t, b + t, t, hh - t * 2, color, alpha],
    );
  };
  ring(0, gap, 'ink', 1);
  ring(gap, 1, 'ember', 0.9);
  ring(gap + 1, 1, 'ink', 1);

  // Inner shade: steps of ink that fade toward the middle of the map.
  for (let i = 0; i < shade; i++) {
    const alpha = 0.34 * (1 - i / shade) ** 1.6;
    plan.shade.push(
      [x0 + i, y0 + i, w - i * 2, 1, 'ink', alpha],
      [x0 + i, y1 - i - 1, w - i * 2, 1, 'ink', alpha],
      [x0 + i, y0 + i + 1, 1, h - i * 2 - 2, 'ink', alpha],
      [x1 - i - 1, y0 + i + 1, 1, h - i * 2 - 2, 'ink', alpha],
    );
  }

  // Corner diamonds on the ember line.
  for (const [cx, cy] of [
    [x0 - gap - 1, y0 - gap - 1],
    [x1 + gap, y0 - gap - 1],
    [x0 - gap - 1, y1 + gap],
    [x1 + gap, y1 + gap],
  ]) {
    for (let r = 3; r >= 0; r--) {
      const color = r === 3 ? 'ink' : r === 0 ? 'bone' : 'gold';
      for (let dy = -r; dy <= r; dy++) {
        const half = r - Math.abs(dy);
        plan.corners.push([cx - half, cy + dy, half * 2 + 1, 1, color, 1]);
      }
    }
  }
  return plan;
}
