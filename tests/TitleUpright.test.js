// The upright title's key-art band (TitleScreen.js): the plate is shown as a band at a
// whole device-pixel scale, sized to the room above the menu, and cropped so the
// Hollow Sun stays whole and clear of the lockup. Pure maths; the portrait-screens e2e
// spec checks the drawn result on real phones.
import { describe, expect, it } from 'vitest';
import {
  TITLE_ART_ANCHORS,
  UPRIGHT_BAND,
  uprightArtAnchor,
  uprightArtHeight,
  uprightArtScale,
} from '../src/ui/TitleScreen.js';
import { PLATE_H, PLATE_W } from '../src/art/keyart/hollowSun.js';
import { scrollEdges } from '../src/ui/scrollEdgeCue.js';

describe('upright title band scale', () => {
  it('grows with the room above the menu, within the band widths', () => {
    // 375 wide at 3x: 1125 device px. At least ceil(1125/300) = 4, at most
    // floor(1125/215) = 5; a 303 px room fits floor(303*3/240) = 3, so 4.
    expect(uprightArtScale(375, 3, 303)).toBe(4);
    // A 480 px room would fit 6; the band caps it at 5 (1125/5 = 225 plate px wide).
    expect(uprightArtScale(375, 3, 480)).toBe(5);
    // 390 at 3x, 480 px of room: floor(480*3/240) = 6 > floor(1170/215) = 5.
    expect(uprightArtScale(390, 3, 480)).toBe(5);
    // 430 at 3x, 568 px: fit 7, cap floor(1290/215) = 6.
    expect(uprightArtScale(430, 3, 568)).toBe(6);
    // The 2x iPhone SE: 750 device px, never below ceil(750/300) = 3.
    expect(uprightArtScale(375, 2, 303)).toBe(3);
    // No room at all still shows a band no wider than the plate's width allows.
    expect(uprightArtScale(375, 3, 0)).toBe(4);
  });

  it('always shows between the narrowest and widest band, and covers the width', () => {
    for (const dpr of [2, 2.625, 3])
      for (let width = 320; width <= 480; width += 5)
        for (const room of [0, 250, 400, 700, Infinity]) {
          const scale = uprightArtScale(width, dpr, room);
          const dev = Math.round(width * dpr);
          expect(Number.isInteger(scale)).toBe(true);
          expect(dev / scale, `${width}@${dpr}`).toBeLessThanOrEqual(PLATE_W);
          expect(dev / scale).toBeLessThanOrEqual(UPRIGHT_BAND.widest + 1e-9);
          if (dev / Math.ceil(dev / UPRIGHT_BAND.widest) >= UPRIGHT_BAND.narrowest)
            expect(dev / scale).toBeGreaterThanOrEqual(UPRIGHT_BAND.narrowest);
          // The CSS height never asks for more than the whole plate at that scale.
          expect(uprightArtHeight(width, dpr, room) * dpr).toBeLessThanOrEqual(PLATE_H * scale);
        }
  });
});

describe('upright title band crop', () => {
  const sun = TITLE_ART_ANCHORS.sun.dusk;
  const figure = TITLE_ART_ANCHORS.figure;
  // The dusk plate at 4 device px per plate px on a 375 px 3x phone.
  const visW = 1125 / 4;
  const k = 4 / 3;

  it('centres the plate when the sun sits below the lockup', () => {
    const { sx, anchorX } = uprightArtAnchor({
      visW,
      k,
      top: 0,
      lockup: { right: 330, bottom: 20 },
      sun,
      figure,
    });
    expect(sx).toBe(Math.round((PLATE_W - visW) / 2));
    expect(anchorX).toBeCloseTo(sx / (PLATE_W - visW), 6);
  });

  it('moves the sun right of a lockup it shares rows with, the corona whole', () => {
    const lockup = { right: 262, bottom: 125 };
    const { sx } = uprightArtAnchor({ visW, k, top: 0, lockup, sun, figure });
    // The corona's left edge (6 plate px of margin) clears the lockup by 10 px.
    expect((sun.x - sun.r - 6 - sx) * k).toBeGreaterThanOrEqual(lockup.right + 10 - k);
    // The corona's right edge and the figure stay in view.
    expect(sun.x + sun.r + 6 - sx).toBeLessThanOrEqual(visW + 1);
    expect(figure.x - sx).toBeGreaterThan(0);
  });

  it('keeps the title clear when everything cannot fit: the disc may run off the edge', () => {
    const wide = { right: 330, bottom: 125 };
    const { sx } = uprightArtAnchor({ visW, k, top: 0, lockup: wide, sun, figure });
    expect((sun.x - sun.r - sx) * k).toBeGreaterThanOrEqual(wide.right + 4 - k);
  });

  it('has no crop to choose when the plate fits the width', () => {
    expect(uprightArtAnchor({ visW: PLATE_W, k: 1, sun, figure })).toEqual({
      sx: 0,
      anchorX: 0.5,
    });
  });
});

describe('scroll edge cues', () => {
  const box = (o) => ({
    scrollHeight: 100,
    clientHeight: 100,
    scrollTop: 0,
    scrollWidth: 100,
    clientWidth: 100,
    scrollLeft: 0,
    ...o,
  });

  it('names only the edges with more past them', () => {
    expect(scrollEdges(box())).toEqual({ above: false, below: false, left: false, right: false });
    expect(scrollEdges(box({ scrollHeight: 300 }))).toMatchObject({ above: false, below: true });
    expect(scrollEdges(box({ scrollHeight: 300, scrollTop: 100 }))).toMatchObject({
      above: true,
      below: true,
    });
    expect(scrollEdges(box({ scrollHeight: 300, scrollTop: 200 }))).toMatchObject({
      above: true,
      below: false,
    });
    expect(scrollEdges(box({ scrollWidth: 250, scrollLeft: 150 }))).toMatchObject({
      left: true,
      right: false,
    });
    // A pixel of rounding is not "more".
    expect(scrollEdges(box({ scrollHeight: 101 }))).toMatchObject({ below: false });
  });
});
