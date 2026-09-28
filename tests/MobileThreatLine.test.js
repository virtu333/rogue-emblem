// The phone rail's move preview ("2 foes can reach") in the terrain card. A tile only
// a status staff can reach must never read, or look, like a safe tile.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { threatPreviewLine } from '../src/ui/MobileBattleHUD.js';

/** Enough of a DOM element for the rail: class, dataset, children (nodes or text). */
function fakeElement(tag) {
  const node = { tag, className: '', dataset: {}, children: [], ownText: '' };
  Object.defineProperty(node, 'textContent', {
    get: () =>
      node.ownText + node.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''),
    set: (value) => {
      node.ownText = String(value);
      node.children = [];
    },
  });
  node.append = (...kids) => node.children.push(...kids);
  return node;
}

afterEach(() => vi.unstubAllGlobals());

const staffer = { name: 'Dark Mage', faction: 'enemy' };
const result = (count, staves, fogged = false) => ({
  count,
  status: Array(staves).fill(staffer),
  damage: [],
  ballistas: [],
  fogged,
});
const classes = (line) => line.className.split(/\s+/).filter(Boolean).sort();

describe('rail threat line', () => {
  it('styles a status-staff-only tile as a warning, not as safe', () => {
    vi.stubGlobal('document', { createElement: fakeElement });
    const line = threatPreviewLine(result(0, 1));
    expect(line.textContent).toBe('Only 1 staff can reach');
    expect(classes(line)).toEqual(['mb-threat-line', 'mb-threat-line--status']);
    expect(line.dataset.threatCount).toBe('0');
  });

  it('keeps crimson for foes that can strike and the plain style for a clear tile', () => {
    vi.stubGlobal('document', { createElement: fakeElement });
    const hit = threatPreviewLine(result(2, 1));
    expect(hit.textContent).toBe('2 foes can reach · 1 staff');
    expect(classes(hit)).toEqual(['mb-threat-line', 'mb-threat-line--reached']);
    const clear = threatPreviewLine(result(0, 0, true));
    expect(clear.textContent).toBe('No foe can reach · fog may hide more');
    expect(classes(clear)).toEqual(['mb-threat-line']);
  });

  it('a long line breaks only between whole clauses, never inside one', () => {
    vi.stubGlobal('document', { createElement: fakeElement });
    const line = threatPreviewLine(result(0, 2, true));
    expect(line.textContent).toBe('Only 2 staves can reach · fog may hide more');
    // Clause spans (kept whole) with a plain space between them: the only place the
    // card may wrap the line.
    expect(line.children.map((c) => (typeof c === 'string' ? c : c.className))).toEqual([
      'mb-threat-clause',
      ' ',
      'mb-threat-clause',
    ]);
    expect(line.children.filter((c) => typeof c !== 'string').map((c) => c.textContent)).toEqual([
      'Only 2 staves can reach',
      '· fog may hide more',
    ]);
    const css = readFileSync('src/ui/mobileBattle.css', 'utf8');
    expect(css).toMatch(/\.mb-terrain \.mb-threat-clause\s*\{[^}]*white-space:\s*nowrap/);
    // The compact card (a unit selected) keeps its other spans on one line, but not this one.
    const rail = readFileSync('src/ui/battleRail.css', 'utf8');
    expect(rail).toMatch(
      /\.has-unit \.mb-terrain > \.mb-threat-line\s*\{[^}]*white-space:\s*normal/,
    );
  });

  it('the status tone has its own colour, distinct from the muted safe line', () => {
    const css = readFileSync('src/ui/mobileBattle.css', 'utf8');
    const rule = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
      return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
    };
    const color = (body) => body.match(/(?:^|;|\s)color:\s*([^;]+);/)?.[1].trim();
    const safe = color(rule('.mb-terrain .mb-threat-line'));
    const status = color(rule('.mb-terrain .mb-threat-line--status'));
    expect(safe).toBe('var(--re-muted)');
    expect(status).toBeTruthy();
    expect(status).not.toBe(safe);
  });
});
