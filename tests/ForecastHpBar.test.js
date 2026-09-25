// Playtest 2026-09-25 (screenshot: Myrmidon vs Cavalier at 9/20 HP): the
// canvas forecast drew the projected HP loss as a translucent accent fill —
// the same colour as a 40–70% HP bar — so the damage preview vanished for any
// unit in that band. The loss is now a dark, hatched segment on every band.
import { describe, expect, it } from 'vitest';

import { drawForecastHpBar } from '../src/ui/ForecastOverlay.js';
import { UI_HEX, getHPBarColor } from '../src/utils/uiStyles.js';

/** Paint the fills into a one-row pixel buffer (last write wins). */
function rasterize(opts) {
  const pixels = new Array(opts.width).fill(null);
  let color = null;
  const gfx = {
    fillStyle(c) {
      color = c;
    },
    fillRect(x, _y, w) {
      for (let px = Math.max(0, x - opts.x); px < Math.min(opts.width, x - opts.x + w); px++)
        pixels[px] = color;
    },
  };
  const loss = drawForecastHpBar(gfx, { y: 0, height: 6, ...opts });
  return { pixels, loss };
}

describe('forecast HP bar', () => {
  it.each([
    ['high', 20, 20, 17],
    ['medium (the screenshot: 9/20 → 6)', 9, 20, 6],
    ['low', 6, 20, 3],
    ['lethal', 9, 20, 0],
  ])('the projected loss is visible on a %s bar', (_label, current, max, projected) => {
    const width = 100;
    const { pixels, loss } = rasterize({ x: 40, width, current, max, projected });
    const hpColor = getHPBarColor(current / max);
    const keep = Math.round((width * projected) / max);
    const end = Math.round((width * current) / max);
    // Remaining HP keeps its health colour.
    expect(pixels.slice(0, keep).every((c) => c === hpColor)).toBe(true);
    // The loss segment covers exactly the projected damage...
    expect(loss).toEqual({ x: 40 + keep, width: end - keep });
    // ...and no pixel of it is the health colour it sits on.
    const segment = pixels.slice(keep, end);
    expect(segment.length).toBeGreaterThan(0);
    expect(segment.some((c) => c === hpColor)).toBe(false);
    expect(new Set(segment)).toEqual(new Set([UI_HEX.sunken, UI_HEX.accentText]));
    // Missing HP beyond the current value stays the empty track.
    expect(pixels.slice(end).every((c) => c === UI_HEX.raised)).toBe(true);
  });

  it('draws no loss segment without a projection or when nothing is lost', () => {
    expect(rasterize({ x: 0, width: 80, current: 10, max: 20 }).loss).toBeNull();
    expect(rasterize({ x: 0, width: 80, current: 10, max: 20, projected: 10 }).loss).toEqual({
      x: 40,
      width: 0,
    });
  });

  it('the medium HP colour is the old overlay colour (why the preview disappeared)', () => {
    expect(getHPBarColor(9 / 20)).toBe(UI_HEX.accent);
  });
});
