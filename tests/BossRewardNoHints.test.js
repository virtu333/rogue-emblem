// The boss's reward unit picker gives no advice (playtest 2026-09-29, row 12): no
// "Your army lacks …" cue, no "Best in draft / Grows fastest" legend or marks, and
// the Full unit details sheet shows no hold tip. The lord arrival and the arena's
// mercenary board keep theirs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { showArrivalMenu } from '../src/ui/PartyMenus.js';
import { candidateCards } from '../src/ui/choiceContent.js';
import { unitCardLabel } from '../src/ui/choiceCards.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
const store = {};

function recruit(className, name) {
  const cls = gameData.classes.find((c) => c.name === className);
  return createRecruitUnit({ name, className, level: 5 }, cls, gameData.weapons, null, null, null, gameData.classes); // prettier-ignore
}

// A sword and an axe army: a Cleric, a Knight and an Archer would each fill a gap.
const roster = () => [recruit('Myrmidon', 'Ayla'), recruit('Fighter', 'Brom')];
const candidates = () =>
  [recruit('Cleric', 'Cora'), recruit('Knight', 'Dain'), recruit('Archer', 'Esk')].map((unit) => ({
    unit,
    displayName: unit.name,
    className: unit.className,
  }));

function eventsFor() {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    once: (name, fn) => listeners(name).add(fn),
    on: (name, fn) => listeners(name).add(fn),
    off: (name, fn) => listeners(name).delete(fn),
    emit: (name) => [...listeners(name)].forEach((fn) => fn()),
  };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  installFakeDom(vi);
  vi.stubGlobal('localStorage', {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // A phone: the one-time hold tip would show on a touch screen.
  document.documentElement = document.createElement('html');
  document.documentElement.classList.add('touch-ui');
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function open(title, options) {
  const owner = {
    scene: {
      registry: { get: () => null },
      events: eventsFor(),
      sys: { isActive: () => true },
      scene: { isActive: () => true },
    },
    gameData,
    runManager: { roster: roster() },
  };
  showArrivalMenu(owner, title, candidates(), () => {}, options);
  return { owner, root: owner.domMenu.root };
}

const labels = (root) => root.querySelectorAll('.ch-card').map((c) => c.getAttribute('aria-label'));

describe('arrival menus', () => {
  it('boss recruit: no roster cue, no legend, no best/grows marks, nothing spoken', () => {
    const { root } = open('Boss recruit', { skip: true, hints: false });
    expect(root.querySelectorAll('.ch-card')).toHaveLength(3);
    expect(root.querySelectorAll('.ch-cue')).toHaveLength(0);
    expect(root.querySelectorAll('.ch-legend')).toHaveLength(0);
    expect(root.querySelectorAll('.is-best')).toHaveLength(0);
    expect(root.querySelectorAll('.is-grows')).toHaveLength(0);
    expect(root.textContent).not.toContain('Your army lacks');
    expect(root.textContent).not.toContain('Best in draft');
    for (const label of labels(root)) {
      expect(label).not.toMatch(/lacks/);
      expect(label).not.toMatch(/Best /);
    }
    for (const cell of root.querySelectorAll('.ch-stat'))
      expect(cell.getAttribute('title')).not.toMatch(/best of the draft|grows fast/);
  });

  it('boss recruit: Full unit details shows no hold tip and does not spend it', () => {
    const { owner, root } = open('Boss recruit', { skip: true, hints: false });
    const inspect = root
      .querySelectorAll('button')
      .find((b) => b.textContent === 'Full unit details');
    inspect.click();
    expect(owner.inspector.root.querySelectorAll('.re-hold-tip')).toHaveLength(0);
    expect(Object.keys(store)).toEqual([]);
    owner.inspector.destroy();
  });

  it('lord arrival keeps its cue, legend, marks and hold tip', () => {
    const { owner, root } = open('Lord arrival', {});
    // A sword and an axe army: each candidate fills a gap.
    expect(root.querySelectorAll('.ch-cue').map((c) => c.textContent)).toEqual([
      'Your army lacks a healer',
      'Your army lacks armor',
      'Your army lacks an archer',
    ]);
    expect(root.querySelectorAll('.ch-legend')).toHaveLength(1);
    expect(root.querySelectorAll('.is-best').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.is-grows').length).toBeGreaterThan(0);
    expect(labels(root).some((l) => l.includes('Your army lacks a healer'))).toBe(true);
    expect(labels(root).some((l) => / · Best /.test(l))).toBe(true);
    root
      .querySelectorAll('button')
      .find((b) => b.textContent === 'Full unit details')
      .click();
    expect(owner.inspector.root.querySelectorAll('.re-hold-tip')).toHaveLength(1);
    owner.inspector.destroy();
  });
});

describe('candidateCards hints', () => {
  it('the arena default keeps the cue and marks; hints:false drops exactly those', () => {
    const units = candidates().map((c) => c.unit);
    const withHints = candidateCards(units, { roster: roster(), gameData });
    const without = candidateCards(units, { roster: roster(), gameData, hints: false });
    expect(withHints[0].cue).toEqual({ role: 'healer', text: 'Your army lacks a healer' });
    expect(without.map((c) => c.cue)).toEqual([null, null, null]);
    const marks = (cards) =>
      cards.flatMap((c) => [c.board.hp, ...c.board.stats]).filter((r) => r.best || r.grows);
    expect(marks(withHints).length).toBeGreaterThan(0);
    expect(marks(without)).toEqual([]);
    // Everything else on the card is the same.
    const strip = (cards) =>
      cards.map((c) => ({
        ...c,
        cue: null,
        board: {
          ...c.board,
          hp: { ...c.board.hp, best: false, grows: false },
          stats: c.board.stats.map((r) => ({ ...r, best: false, grows: false })),
        },
      }));
    expect(strip(without)).toEqual(strip(withHints));
    expect(unitCardLabel(without[0])).toBe(
      `Cora · Cleric · Lv ${withHints[0].level} · HP ${withHints[0].board.hp.current}/${withHints[0].board.hp.max}`,
    );
  });
});
