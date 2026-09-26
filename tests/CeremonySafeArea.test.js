// Ceremony layers and the notch: a layer framed on the map already sits inside
// the safe area on the sides it does not share with the screen, so its cards
// must not add the raw env() insets again (on a notched iPhone that squeezed
// the deed card's words to ~90 px and cut the Oath line off).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { frameEdges } from '../src/ui/ceremonyDom.js';

describe('frameEdges', () => {
  it('measures a map frame beside the side panel from each screen edge', () => {
    // iPhone 13 landscape: 844 x 390, the map starts after the 47 px notch
    // inset and ends at the 300 px side panel.
    const map = { left: 47, top: 0, width: 497, height: 369 };
    expect(frameEdges(map, { width: 844, height: 390 })).toEqual({ l: 47, r: 300, t: 0, b: 21 });
  });
  it('a full-screen layer touches every edge', () => {
    expect(
      frameEdges({ left: 0, top: 0, width: 844, height: 390 }, { width: 844, height: 390 }),
    ).toEqual({ l: 0, r: 0, t: 0, b: 0 });
  });
  it('never reports a negative distance (a frame larger than the viewport)', () => {
    expect(
      frameEdges({ left: -4, top: -2, width: 900, height: 400 }, { width: 844, height: 390 }),
    ).toEqual({ l: 0, r: 0, t: 0, b: 0 });
    expect(frameEdges(null)).toEqual({ l: 0, r: 0, t: 0, b: 0 });
  });
});

describe('ceremony stylesheets', () => {
  const sheets = ['ceremony.css', 'growth.css', 'deeds.css'];
  it('use the frame-relative insets, never the raw env() ones, inside layers', () => {
    for (const name of sheets) {
      const css = readFileSync(`src/ui/${name}`, 'utf8');
      const uses = css.match(/env\(\s*safe-area-inset-[a-z]+[^)]*\)/g) || [];
      // only the four --ce-safe-* definitions on .ce-layer may read env()
      const allowed = name === 'ceremony.css' ? 4 : 0;
      expect(uses.length, `${name}: ${uses.join(', ')}`).toBe(allowed);
    }
    const ceremony = readFileSync('src/ui/ceremony.css', 'utf8');
    for (const side of ['left', 'right', 'top', 'bottom'])
      expect(ceremony).toMatch(
        new RegExp(
          `--ce-safe-${side[0]}: max\\(0px, env\\(safe-area-inset-${side}, 0px\\) - var\\(--ce-frame-${side[0]}, 0px\\)\\)`,
        ),
      );
  });
});
