import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { paintCampPlate, campLayout, CAMP_MIN, CAMP_MAX } from '../src/art/keyart/campPlate.js';
import { PALETTE, pack } from '../src/art/keyart/plateKit.js';

const ALLOWED = new Set(Object.values(PALETTE).flat().map(pack));
const HEXES = new Set(Object.values(PALETTE).flat());
const SIZES = [
  [183, 138],
  [183, 80],
  [122, 92],
  [64, 64],
  [130, 64],
  [224, 48],
];
const EMBER = new Set(PALETTE.ember.slice(2).map(pack));

describe('camp plate (Home Base)', () => {
  it('is deterministic and never draws Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const a = paintCampPlate({ width: 183, height: 138 });
    const b = paintCampPlate({ width: 183, height: 138 });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
    expect(a.rects(3100)).toEqual(b.rects(3100));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fills every pixel with palette colours, at every size', () => {
    for (const [w, h] of SIZES) {
      const p = paintCampPlate({ width: w, height: h });
      expect(p.pixels.length).toBe(w * h);
      for (const c of p.pixels) if (!ALLOWED.has(c)) throw new Error(`${w}x${h}: ${c}`);
      for (const t of [0, 777, 5200, 91234])
        for (const [x, y, rw, rh, hex] of p.rects(t)) {
          expect(HEXES.has(hex)).toBe(true);
          expect(rw > 0 && rh > 0 && x < w && y < h && x + rw > 0 && y + rh > 0).toBe(true);
        }
    }
  });

  it('is composed for its box: a short box is its own painting, not a crop', () => {
    const tall = paintCampPlate({ width: 183, height: 138 });
    const short = paintCampPlate({ width: 183, height: 80 });
    expect(short.layout.hz).toBeLessThan(tall.layout.hz);
    expect(short.layout.unit).toBeLessThan(tall.layout.unit);
    // The sky keeps its place above the camp in both.
    for (const p of [tall, short]) expect(p.layout.sun.y).toBeLessThan(p.layout.hz);
  });

  it('keeps the camp on the plate: the fire, the pavilion and every tent, at every size', () => {
    for (const [w, h] of SIZES) {
      const l = campLayout(w, h);
      for (const spot of [l.fire, l.pavilion, ...l.tents]) {
        expect(spot.x).toBeGreaterThanOrEqual(0);
        expect(spot.x).toBeLessThan(w);
        expect(spot.y).toBeGreaterThan(l.hz);
        expect(spot.y).toBeLessThan(h);
      }
    }
  });

  it('lights the ground round the watch fire and leaves the far corners dark', () => {
    const p = paintCampPlate({ width: 183, height: 138 });
    const warm = (cx, cy) => {
      let n = 0;
      for (let y = cy - 4; y <= cy + 4; y++)
        for (let x = cx - 4; x <= cx + 4; x++) if (EMBER.has(p.pixels[y * 183 + x])) n++;
      return n;
    };
    const { fire } = p.layout;
    expect(warm(fire.x - 10, fire.y + 2)).toBeGreaterThan(20);
    expect(warm(6, 132)).toBe(0);
    expect(warm(176, 132)).toBe(0);
  });

  it('moves (flame, sparks, smoke, pennants) and stays a short list', () => {
    const p = paintCampPlate({ width: 183, height: 138 });
    expect(p.rects(1000)).not.toEqual(p.rects(1400));
    expect(p.rects(1000).length).toBeLessThan(200);
  });

  it('clamps the plate size', () => {
    expect(paintCampPlate({ width: 5, height: 9000 })).toMatchObject({
      width: CAMP_MIN,
      height: CAMP_MAX,
    });
  });

  it('is shown only upright, and never takes a tap', () => {
    const css = readFileSync(new URL('../src/ui/mobileUpgrade.css', import.meta.url), 'utf8');
    const base = css.match(/\n\.mh-camp \{([^}]*)\}/);
    expect(base?.[1]).toMatch(/display:\s*none/);
    const upright = css.match(/html\.portrait-ui \.mh-screen \.mh-camp \{([^}]*)\}/);
    expect(upright?.[1]).toMatch(/display:\s*block/);
    expect(upright?.[1]).toMatch(/pointer-events:\s*none/);
  });
});
