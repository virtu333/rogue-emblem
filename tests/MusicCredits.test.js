import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { HELP_TABS } from '../src/data/helpContent.js';

const ROOT = join(import.meta.dirname, '..');
const MUSIC = join(ROOT, 'tools', 'music');

// The candidates the shipped music plays: the house palette plus the scores' own changes.
function shippedCandidates() {
  const palette = readFileSync(join(MUSIC, 'engine', 'palette.py'), 'utf8');
  const house = palette.match(/^HOUSE = \{([\s\S]*?)^\}/m);
  expect(house, 'palette.py defines HOUSE').toBeTruthy();
  const picks = [...house[1].matchAll(/'[\w]+': '([\w]+)'/g)].map((m) => m[1]);
  for (const folder of ['scores', 'stingers']) {
    for (const f of readdirSync(join(MUSIC, folder)).filter((x) => x.endsWith('.py'))) {
      const src = readFileSync(join(MUSIC, folder, f), 'utf8');
      for (const m of src.matchAll(/\.palette = \{([^}]*)\}/g)) {
        picks.push(...[...m[1].matchAll(/'[\w]+': '([\w]+)'/g)].map((x) => x[1]));
      }
    }
  }
  return picks;
}

const LIBRARIES = [
  { prefix: 'sso', name: 'Sonatina Symphonic Orchestra' },
  { prefix: 'vpo', name: 'Virtual Playing Orchestra' },
  { prefix: 'vcsl', name: 'VCSL' },
];

describe('music credits', () => {
  const page = HELP_TABS.flatMap((t) => t.pages).find((p) => p.title === 'Music Credits');
  const inGame = page ? page.lines.map((l) => l.text).join('\n') : '';
  const doc = readFileSync(join(ROOT, 'docs', 'music-credits.md'), 'utf8');

  it('the help overlay has a credits page that fits its panel', () => {
    expect(page).toBeTruthy();
    expect(page.lines.length).toBeLessThanOrEqual(19);
    for (const line of page.lines) expect(line.text.length).toBeLessThanOrEqual(38);
    expect(inGame).toContain('CC BY-SA 4.0');
  });

  it('credits every library the shipped music plays', () => {
    const picks = shippedCandidates();
    expect(picks.length).toBeGreaterThan(0);
    for (const { prefix, name } of LIBRARIES) {
      if (!picks.some((p) => p.startsWith(prefix))) continue;
      expect(inGame, `in-game credit for ${name}`).toContain(name);
      expect(doc, `docs/music-credits.md credits ${name}`).toContain(name);
    }
  });
});
