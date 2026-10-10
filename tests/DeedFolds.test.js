// A unit's titles and Oaths take one line each until the player opens them (playtest
// 2026-10-10: five deeds and five Oaths filled the Stats tab). The roster shows the title
// the unit goes by in full and folds the rest; the Oath it will swear shows, the others
// fold behind "Change Oath"; the promotion chooser folds its Oath picker the same way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { PromotionPathChooser } from '../src/ui/PromotionPathChooser.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  TITLE_NONE,
  chooseTitle,
  commitBattleDeeds,
  emptyBattleDeeds,
  unitEpithet,
} from '../src/engine/DeedSystem.js';
import { createUnit, resolvePromotionTargets } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
let key = 0;

/** A Myrmidon with five deeds, each with an Oath: Bossbane is the title. */
function decorated(name = 'Ayla') {
  const unit = createUnit(
    gameData.classes.find((c) => c.name === 'Myrmidon'),
    10,
    gameData.weapons,
    { name },
  );
  unit.skills = [];
  for (const battle of [
    { heldPhases: 3, heldPlaces: ['Bridge', 'Bridge', 'Bridge'] },
    { crits: 3, kills: 5 },
    { strikesFaced: 6, bossKills: 1, bossNames: ['Iron Captain'] },
  ]) {
    unit._battleDeeds = { ...emptyBattleDeeds(), ...battle };
    commitBattleDeeds([unit], gameData.deeds, { battleKey: `fold:${++key}` });
  }
  return unit;
}

function makeScene() {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    gameData,
    textures: { exists: () => false, get: () => null },
    registry: { get: () => null },
    events: {
      once: (name, fn) => listeners(name).add(fn),
      on: (name, fn) => listeners(name).add(fn),
      off: (name, fn) => listeners(name).delete(fn),
      emit: () => {},
    },
  };
}

let dom;
beforeEach(() => {
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

function manage(units, persist = vi.fn(() => true)) {
  const run = new RunManager(gameData);
  run.roster = units;
  const sheet = new MobileRosterSheet({
    scene: makeScene(),
    units,
    run,
    gameData,
    persist,
    onClose: vi.fn(),
  });
  return { sheet, run, persist };
}

const q = (sheet, selector) => sheet.root.querySelector(selector);
const qa = (sheet, selector) => sheet.root.querySelectorAll(selector);
const pressText = (sheet, text) => {
  const b = qa(sheet, 'button').find((x) => x.textContent === text && !x.disabled);
  expect(b, text).toBeTruthy();
  b.click();
};

describe('roster: the title in full, the other deeds folded', () => {
  it('shows only the title card and one line naming the rest, until opened', () => {
    const unit = decorated();
    const { sheet } = manage([unit]);
    const cards = qa(sheet, '.mr-deed');
    expect(cards).toHaveLength(1);
    expect(cards[0].classList.contains('is-title')).toBe(true);
    expect(cards[0].textContent).toContain('Bane of the Iron Captain');
    const toggle = q(sheet, '.mr-deed-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('.re-disclosure-label').textContent).toBe('Other deeds');
    expect(toggle.querySelector('.re-disclosure-count').textContent).toBe('4');
    // The folded line names every other title, so nothing is hidden without a trace.
    const preview = toggle.querySelector('.re-disclosure-preview').textContent;
    for (const text of [
      'Who Held the Bridge',
      'the Keen Edge',
      'of the Red Harvest',
      'the Untouched',
    ])
      expect(preview).toContain(text);
    expect(preview).not.toContain('Bane of the Iron Captain');
    // Folded: no "Use as title" to tab or pad onto.
    expect(sheet.root.textContent).not.toContain('Use as title');

    toggle.click();
    const open = q(sheet, '.mr-deed-toggle');
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.querySelector('.re-disclosure-preview')).toBeNull();
    expect(qa(sheet, '.mr-deed')).toHaveLength(5);
    expect(qa(sheet, 'button').filter((b) => b.textContent === 'Use as title')).toHaveLength(4);
    sheet.destroy();
  });

  it('stays open after picking a title and while flipping units; a new sheet starts folded', () => {
    const first = decorated('Ayla');
    const second = decorated('Bram');
    const { sheet, persist } = manage([first, second]);
    q(sheet, '.mr-deed-toggle').click();
    const keen = qa(sheet, '.mr-deed').find((c) => c.textContent.includes('the Keen Edge'));
    keen.querySelector('button').click();
    expect(unitEpithet(first).text).toBe('the Keen Edge');
    expect(persist).toHaveBeenCalled();
    // The pick re-rendered the sheet: the list is still open, the new title leads.
    expect(q(sheet, '.mr-deed-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(qa(sheet, '.mr-deed')[0].textContent).toContain('the Keen Edge');
    // Another unit: the fold is the sheet's, not the unit's.
    sheet.index = 1;
    sheet.render();
    expect(q(sheet, '.mr-deed-toggle').getAttribute('aria-expanded')).toBe('true');
    sheet.destroy();
    const again = manage([first, second]).sheet;
    expect(q(again, '.mr-deed-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(qa(again, '.mr-deed')).toHaveLength(1);
    again.destroy();
  });

  it('with no title, every deed is folded under "Deeds earned"', () => {
    const unit = decorated();
    chooseTitle(unit, TITLE_NONE);
    const { sheet } = manage([unit]);
    expect(qa(sheet, '.mr-deed')).toHaveLength(0);
    expect(sheet.root.textContent).toContain('Title: none. Goes by name alone.');
    const toggle = q(sheet, '.mr-deed-toggle');
    expect(toggle.querySelector('.re-disclosure-label').textContent).toBe('Deeds earned');
    expect(toggle.querySelector('.re-disclosure-count').textContent).toBe('5');
    sheet.destroy();
  });

  it('a single deed has nothing to fold', () => {
    const unit = createUnit(gameData.classes.find((c) => c.name === 'Fighter'), 5, gameData.weapons, { name: 'Bo' }); // prettier-ignore
    unit._battleDeeds = { ...emptyBattleDeeds(), crits: 3 };
    commitBattleDeeds([unit], gameData.deeds, { battleKey: `fold:${++key}` });
    const { sheet } = manage([unit]);
    expect(qa(sheet, '.mr-deed')).toHaveLength(1);
    expect(q(sheet, '.mr-deed-toggle')).toBeNull();
    sheet.destroy();
  });
});

describe('roster: the Oath it will swear, the others folded', () => {
  it('shows the Oath in full; Change Oath opens the others; a pick pledges and folds', () => {
    const unit = decorated();
    const { sheet } = manage([unit]);
    const card = q(sheet, '.mr-oath-choice');
    expect(card.querySelector('.mr-oath-current').textContent).toBe(
      'Oath of the Bane · Fiendish Blow',
    );
    expect(qa(sheet, '.mr-oath-option')).toHaveLength(0);
    const toggle = q(sheet, '.mr-oath-toggle');
    expect(toggle.querySelector('.re-disclosure-label').textContent).toBe('Change Oath');
    expect(toggle.querySelector('.re-disclosure-count').textContent).toBe('4');

    toggle.click();
    expect(q(sheet, '.mr-oath-toggle').getAttribute('aria-expanded')).toBe('true');
    const options = qa(sheet, '.mr-oath-option');
    expect(options.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    pressText(sheet, 'Oath of the Bridge · Pavise');
    expect(unit.deeds.pledge).toBe('held_the_line');
    // Like a select: the list closes on the pick and focus returns to its toggle.
    expect(qa(sheet, '.mr-oath-option')).toHaveLength(0);
    expect(q(sheet, '.mr-oath-current').textContent).toBe('Oath of the Bridge · Pavise');
    expect(dom.doc.activeElement).toBe(q(sheet, '.mr-oath-toggle'));
    expect(q(sheet, '.mr-oath-toggle').getAttribute('aria-expanded')).toBe('false');
    sheet.destroy();
  });

  it('inspecting (no run) folds the Oaths as read-only lines', () => {
    const unit = decorated();
    const sheet = new MobileRosterSheet({ scene: makeScene(), units: [unit], gameData, onClose: vi.fn() }); // prettier-ignore
    const toggle = q(sheet, '.mr-oath-toggle');
    expect(toggle.querySelector('.re-disclosure-label').textContent).toBe('Other Oaths');
    toggle.click();
    const options = qa(sheet, '.mr-oath-option');
    expect(options).toHaveLength(5);
    expect(options.every((o) => o.tagName === 'P')).toBe(true);
    expect(unit.deeds.pledge).toBeUndefined();
    sheet.destroy();
  });
});

describe('promotion chooser: the Oath picker folds to one line', () => {
  const open = (unit) =>
    new PromotionPathChooser({
      scene: makeScene(),
      unit,
      targets: resolvePromotionTargets(unit, gameData.classes, gameData.lords),
      gameData,
    });

  it('names the Oath it will swear; opening lists the rest; a pick pledges and folds', () => {
    const unit = decorated();
    const chooser = open(unit);
    const toggle = () => dom.doc.querySelector('.gr-oath-toggle');
    expect(dom.doc.querySelectorAll('.gr-oath-option')).toHaveLength(0);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().querySelector('.re-disclosure-label').textContent).toBe(
      'Oath of the Bane · Fiendish Blow',
    );
    // Every path card still says which Oath it swears.
    expect(dom.doc.querySelectorAll('.gr-path-oath').length).toBeGreaterThan(0);

    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const options = dom.doc.querySelectorAll('.gr-oath-option');
    expect(options.length).toBeGreaterThan(1);
    options.find((b) => b.textContent === 'Oath of the Bridge · Pavise').click();
    expect(unit.deeds.pledge).toBe('held_the_line');
    expect(dom.doc.querySelectorAll('.gr-oath-option')).toHaveLength(0);
    expect(toggle().querySelector('.re-disclosure-label').textContent).toBe(
      'Oath of the Bridge · Pavise',
    );
    expect(dom.doc.activeElement).toBe(toggle());
    // Only a preview: nothing is learned until the promotion is confirmed.
    expect(unit.skills).not.toContain('pavise');
    chooser.destroy();
  });

  it('the pad and arrow keys never land on a folded Oath', () => {
    const chooser = open(decorated());
    const focusables = chooser.surface.root.querySelectorAll('button:not(:disabled)');
    expect(focusables.some((b) => b.classList.contains('gr-oath-option'))).toBe(false);
    expect(focusables.some((b) => b.classList.contains('gr-oath-toggle'))).toBe(true);
    chooser.destroy();
  });
});
