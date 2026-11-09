import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  paintCampPlate,
  campLayout,
  campArm,
  CAMP_ARMS,
  CAMP_MIN,
  CAMP_MAX,
} from '../src/art/keyart/campPlate.js';
import { PALETTE, pack } from '../src/art/keyart/plateKit.js';
import { loadGameData } from './testData.js';

const ALLOWED = new Set(Object.values(PALETTE).flat().map(pack));
const HEXES = new Set(Object.values(PALETTE).flat());
const SIZES = [
  [147, 110],
  [167, 100],
  [64, 64],
  [130, 64],
];
const lords = loadGameData().lords.map((l) => l.name);

describe('camp plate (Home Base)', () => {
  it('names an arm for every lord in the data', () => {
    for (const name of lords) expect(CAMP_ARMS[name], name).toBeTruthy();
    expect(campArm('Nobody')).toBe('sword');
  });

  it('is deterministic and never draws Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const a = paintCampPlate({ commander: 'Edric', partner: 'Sera', width: 147, height: 110 });
    const b = paintCampPlate({ commander: 'Edric', partner: 'Sera', width: 147, height: 110 });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
    expect(a.rects(3100)).toEqual(b.rects(3100));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('uses only palette colours, at every size and for every lord', () => {
    for (const [w, h] of SIZES)
      for (const name of lords) {
        const p = paintCampPlate({ commander: name, partner: 'Edric', width: w, height: h });
        expect(p.pixels.length).toBe(w * h);
        for (const c of p.pixels) if (!ALLOWED.has(c)) throw new Error(`${name} ${w}x${h}: ${c}`);
        for (const t of [0, 777, 5200, 91234])
          for (const [x, y, rw, rh, hex] of p.rects(t)) {
            expect(HEXES.has(hex)).toBe(true);
            expect(rw > 0 && rh > 0 && x < w && y < h && x + rw > 0 && y + rh > 0).toBe(true);
          }
      }
  });

  it('paints the chosen pair: a different commander or partner is a different plate', () => {
    const px = (commander, partner) =>
      Array.from(paintCampPlate({ commander, partner, width: 147, height: 110 }).pixels).join();
    const base = px('Edric', 'Sera');
    expect(px('Rowan', 'Sera')).not.toBe(base);
    expect(px('Edric', 'Cael')).not.toBe(base);
    // A lone commander stands alone: no second figure right of the fire.
    expect(px('Edric', null)).not.toBe(base);
    expect(px('Edric', 'Edric')).toBe(px('Edric', null));
  });

  it('moves (flame, sparks, banner) and stays a short list', () => {
    const p = paintCampPlate({ commander: 'Edric', partner: 'Sera', width: 147, height: 110 });
    expect(p.rects(1000)).not.toEqual(p.rects(1400));
    expect(p.rects(1000).length).toBeLessThan(200);
  });

  it('clamps the plate size and keeps the figures either side of the fire, on the plate', () => {
    expect(paintCampPlate({ width: 5, height: 9000 })).toMatchObject({
      width: CAMP_MIN,
      height: CAMP_MAX,
    });
    for (const [w, h] of SIZES) {
      const l = campLayout(w, h);
      expect(l.commander.x).toBeLessThan(l.fire.x);
      expect(l.partner.x).toBeGreaterThan(l.fire.x);
      expect(l.commander.x - l.tall * 0.5).toBeGreaterThan(0);
      expect(l.fire.y).toBeLessThan(h);
      expect(l.fire.y - l.tall).toBeGreaterThan(0);
    }
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
