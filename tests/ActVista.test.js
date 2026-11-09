// The act vistas (src/art/keyart/actVista.js): code-drawn plates behind the act title cards.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACT_VISTA_IDS,
  VISTA_MAX,
  VISTA_MIN,
  actVistaId,
  paintActVista,
  vistaLayout,
} from '../src/art/keyart/actVista.js';
import { PALETTE, pack } from '../src/art/keyart/plateKit.js';
import { computeComposedFrame } from '../src/art/keyart/keyArtBackdrop.js';
import { ACT_GRADE_KEYS, actCardContent } from '../src/ui/ceremonyContent.js';
import regions from '../data/regions.json';
import { ACT_SEQUENCE } from '../src/utils/constants.js';

const PACKED = new Set(Object.values(PALETTE).flatMap((ramp) => ramp.map(pack)));
const HEXES = new Set(Object.values(PALETTE).flat());
const SIZES = [
  [422, 195], // phone held sideways
  [195, 422], // phone held upright
  [320, 240], // the 640x480 stage
];

afterEach(() => vi.restoreAllMocks());

describe('act vistas', () => {
  it('every act the game can title has a vista of its own', () => {
    const acts = new Set([
      ...Object.keys(ACT_GRADE_KEYS),
      ...Object.keys(regions),
      ...ACT_SEQUENCE,
    ]);
    for (const act of acts) {
      expect(actCardContent(act).title, act).toBeTruthy();
      expect(actVistaId(act), act).toBe(act);
    }
    expect(new Set(ACT_VISTA_IDS).size).toBe(ACT_VISTA_IDS.length);
  });

  it('an unknown act or the prologue shows the Border Marches', () => {
    for (const act of ['prologue', 'act9', '', null, undefined])
      expect(actVistaId(act)).toBe('act1');
    expect(paintActVista({ act: 'nope', width: 120, height: 120 }).id).toBe('act1');
  });

  it('is deterministic for an act, a size and a seed', () => {
    for (const act of ACT_VISTA_IDS) {
      const a = paintActVista({ act, width: 211, height: 98, seed: 7 });
      const b = paintActVista({ act, width: 211, height: 98, seed: 7 });
      expect(Buffer.from(a.pixels.buffer).equals(Buffer.from(b.pixels.buffer)), act).toBe(true);
      for (const t of [0, 5200, 61234]) expect(a.rects(t), `${act}@${t}`).toEqual(b.rects(t));
    }
  });

  it('paints a different plate for every act', () => {
    const seen = new Set();
    for (const act of ACT_VISTA_IDS) {
      const { pixels } = paintActVista({ act, width: 160, height: 120 });
      seen.add(Buffer.from(pixels.buffer).toString('base64'));
    }
    expect(seen.size).toBe(ACT_VISTA_IDS.length);
  });

  it('fills every pixel, and only with palette colours, in both orientations', () => {
    for (const act of ACT_VISTA_IDS)
      for (const [width, height] of SIZES) {
        const plate = paintActVista({ act, width, height });
        expect(plate.pixels.length).toBe(width * height);
        const stray = new Set();
        for (const p of plate.pixels) if (!PACKED.has(p)) stray.add(p);
        expect([...stray], `${act} ${width}x${height}`).toEqual([]);
      }
  });

  it('moving things are palette-coloured, on the plate and few', () => {
    for (const act of ACT_VISTA_IDS)
      for (const [width, height] of SIZES) {
        const plate = paintActVista({ act, width, height });
        for (const t of [0, 1234, 5200, 9800, 98_765]) {
          const rects = plate.rects(t);
          expect(rects.length, `${act} ${width}x${height}`).toBeLessThan(900);
          for (const [x, y, w, h, hex, alpha] of rects) {
            expect(HEXES.has(hex), `${act} ${hex}`).toBe(true);
            expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
            expect(w).toBeGreaterThan(0);
            expect(h).toBeGreaterThan(0);
            expect(x + w > 0 && y + h > 0 && x < width && y < height).toBe(true);
            if (alpha != null) expect(alpha).toBeLessThanOrEqual(0.15);
          }
        }
      }
  });

  it('something moves in every vista', () => {
    for (const act of ACT_VISTA_IDS) {
      const plate = paintActVista({ act, width: 211, height: 98 });
      expect(plate.rects(1000), act).not.toEqual(plate.rects(4000));
    }
  });

  it('never draws from Math.random (painting or animating)', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random in key art');
    });
    for (const act of ACT_VISTA_IDS) {
      const plate = paintActVista({ act, width: 140, height: 110 });
      plate.rects(777);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('clamps absurd plate sizes', () => {
    const tiny = paintActVista({ act: 'act2', width: 3, height: 0 });
    expect([tiny.width, tiny.height]).toEqual([VISTA_MIN, VISTA_MIN]);
    const huge = paintActVista({ act: 'finalBoss', width: 4000, height: 9000 });
    expect([huge.width, huge.height]).toEqual([VISTA_MAX, VISTA_MAX]);
  });

  it('keeps the horizon under the title in both orientations', () => {
    for (const [w, h] of SIZES) {
      const layout = vistaLayout(w, h);
      expect(layout.titleZone.y1).toBeLessThan(layout.hz);
      expect(layout.hz).toBeLessThan(h * 0.6);
    }
    expect(vistaLayout(422, 195).wide).toBe(true);
    expect(vistaLayout(195, 422).wide).toBe(false);
  });

  it('the title zone stays dark enough to read ivory text over', () => {
    // Before the card's own wash: the plate under the title averages well under mid grey
    // (the title is #f4ecdb), in every act and both orientations.
    const luma = new Map(
      Object.values(PALETTE)
        .flat()
        .map((hex) => {
          const n = parseInt(hex.slice(1), 16);
          return [pack(hex), 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)];
        }),
    );
    for (const act of ACT_VISTA_IDS)
      for (const [width, height] of SIZES.slice(0, 2)) {
        const plate = paintActVista({ act, width, height });
        const { x0, x1, y1 } = plate.layout.titleZone;
        let sum = 0;
        let n = 0;
        for (let y = Math.round(y1 * 0.25); y < y1; y++)
          for (let x = x0; x < x1; x++, n++) sum += luma.get(plate.pixels[y * width + x]);
        expect(sum / n, `${act} ${width}x${height}`).toBeLessThan(96);
      }
  });
});

describe('a composed backdrop frame', () => {
  it('is the box itself at an integer device scale', () => {
    expect(computeComposedFrame({ width: 844, height: 390, dpr: 3 })).toMatchObject({
      scale: 6,
      cw: 422,
      ch: 195,
      sx: 0,
      sy: 0,
      cssW: 844,
      cssH: 390,
    });
    expect(computeComposedFrame({ width: 390, height: 844, dpr: 2 })).toMatchObject({
      scale: 4,
      cw: 195,
      ch: 422,
    });
  });

  it('always covers the box and never asks for an oversized plate', () => {
    for (const w of [320, 390, 640, 844, 1366, 2560])
      for (const h of [240, 390, 480, 844, 1440])
        for (const dpr of [1, 1.5, 2, 2.625, 3]) {
          const f = computeComposedFrame({ width: w, height: h, dpr });
          expect(Number.isInteger(f.scale)).toBe(true);
          expect(f.cw * f.scale).toBeGreaterThanOrEqual(Math.round(w * dpr));
          expect(f.ch * f.scale).toBeGreaterThanOrEqual(Math.round(h * dpr));
          expect(Math.max(f.cw, f.ch)).toBeLessThanOrEqual(VISTA_MAX);
        }
    expect(computeComposedFrame({ width: 0, height: 0, dpr: 0 }).cw).toBeGreaterThanOrEqual(1);
  });
});
