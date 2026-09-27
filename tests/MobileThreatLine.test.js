// The phone rail's move preview ("2 foes can reach") in the terrain card. A tile only
// a status staff can reach must never read, or look, like a safe tile.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { threatPreviewLine } from '../src/ui/MobileBattleHUD.js';

function fakeElement(tag) {
  return { tag, className: '', textContent: '', dataset: {} };
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
