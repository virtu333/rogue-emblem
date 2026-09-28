// An Oath earned at promotion while all five skill slots are full is not lost: it
// waits on the unit until the player gives up a skill for it or lets it go.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  createLordUnit,
  createUnit,
  getClassInnateSkills,
  resolvePromotionTargets,
} from '../src/engine/UnitManager.js';
import { promoteAtChurch } from '../src/engine/ChurchCommands.js';
import {
  applyPromotionOath,
  commitBattleDeeds,
  emptyBattleDeeds,
  oathTradeableSkills,
  promotionOathCandidates,
  releaseWaitingOath,
  rosterOathsWaiting,
  swearWaitingOath,
  waitingOath,
} from '../src/engine/DeedSystem.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { MAX_SKILLS } from '../src/utils/constants.js';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
let key = 0;
// Three enemy phases held on a bridge: "Who Held the Bridge", Oath of the Bridge → Pavise.
function held(unit) {
  unit._battleDeeds = {
    ...emptyBattleDeeds(),
    heldPhases: 3,
    heldPlaces: ['Bridge', 'Bridge', 'Bridge'],
  };
  commitBattleDeeds([unit], data.deeds, { battleKey: `oath:${++key}` });
  return unit;
}
const FULL = ['sol', 'luna', 'astra', 'vantage', 'wrath'];

/** A Fighter with five skills promoted at a church: its Oath has to wait. */
function promotedAtCap(name = 'Bram') {
  const run = new RunManager(data);
  run.startRun();
  run.gold = 99999;
  const unit = held(createUnit(cls('Fighter'), 10, data.weapons, { name }));
  unit.skills = [...FULL];
  run.roster.push(unit);
  const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
  const result = promoteAtChurch(run, unit, 'c1', target, data);
  return { run, unit, result };
}

describe('the waiting Oath (engine)', () => {
  it('a promotion at the cap keeps the Oath waiting and the skills as they were', () => {
    const { unit, result } = promotedAtCap();
    expect(result.ok).toBe(true);
    expect(unit.skills.slice(0, 5)).toEqual(FULL);
    expect(unit.skills).not.toContain('pavise');
    expect(waitingOath(unit)).toMatchObject({ skillId: 'pavise', name: 'Oath of the Bridge' });
    expect(unit.deeds.oath).toBeUndefined();
    // It is not offered again: one Oath per unit.
    expect(promotionOathCandidates(unit, data.deeds, data.skills)).toEqual([]);
  });

  it("giving up a skill swears it, in that skill's place", () => {
    const { unit } = promotedAtCap();
    const at = unit.skills.indexOf('luna');
    expect(swearWaitingOath(unit, 'luna', data)).toEqual({ ok: true, givenUp: 'luna' });
    expect(unit.skills[at]).toBe('pavise');
    expect(unit.skills).not.toContain('luna');
    expect(unit.skills).toHaveLength(MAX_SKILLS);
    expect(unit.deeds.oath).toMatchObject({ skillId: 'pavise', name: 'Oath of the Bridge' });
    expect(waitingOath(unit)).toBeNull();
    // Sworn once: nothing more to swear.
    expect(swearWaitingOath(unit, 'sol', data).ok).toBe(false);
  });

  it('a skill the unit does not have, or a protected one, cannot be given up', () => {
    const { unit } = promotedAtCap();
    expect(swearWaitingOath(unit, 'aegis', data).ok).toBe(false);
    const innate = getClassInnateSkills(unit.className, data.skills);
    for (const id of innate) {
      if (!unit.skills.includes(id)) unit.skills[4] = id;
      expect(oathTradeableSkills(unit, data)).not.toContain(id);
      expect(swearWaitingOath(unit, id, data).ok).toBe(false);
    }
    expect(waitingOath(unit)).not.toBeNull();
  });

  it("a lord's personal skill is never offered", () => {
    const edric = createLordUnit(data.lords.find((l) => l.name === 'Edric'), data.classes, data.weapons); // prettier-ignore
    expect(edric.skills).toContain('charisma');
    expect(oathTradeableSkills(edric, data)).not.toContain('charisma');
  });

  it('with a slot free it is sworn without giving anything up', () => {
    const { unit } = promotedAtCap();
    unit.skills = unit.skills.slice(0, 4);
    expect(swearWaitingOath(unit, null, data)).toEqual({ ok: true, givenUp: null });
    expect(unit.skills.at(-1)).toBe('pavise');
    // At the cap, null is refused: a skill has to be chosen.
    const other = promotedAtCap('Hale').unit;
    expect(swearWaitingOath(other, null, data).ok).toBe(false);
  });

  it('letting it go keeps every skill and ends the Oath for good', () => {
    const { unit } = promotedAtCap();
    const before = [...unit.skills];
    expect(releaseWaitingOath(unit)).toBe(true);
    expect(unit.skills).toEqual(before);
    expect(waitingOath(unit)).toBeNull();
    expect(unit.deeds.oath).toBeUndefined();
    expect(promotionOathCandidates(unit, data.deeds, data.skills)).toEqual([]);
    expect(applyPromotionOath(unit, data)).toBeNull();
  });

  it('the waiting Oath survives a save and load', () => {
    const { run, unit } = promotedAtCap();
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const again = restored.roster.find((u) => u.name === unit.name);
    expect(waitingOath(again)).toMatchObject({ skillId: 'pavise' });
    expect(swearWaitingOath(again, 'wrath', data).ok).toBe(true);
    expect(again.skills).toContain('pavise');
  });
});

describe('the waiting Oath in the roster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeDom(vi);
    _resetInputFocus();
    vi.mocked(saveServiceRun).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  function open({ hints = null, tab = 'stats' } = {}) {
    const { run, unit } = promotedAtCap();
    const events = new Map();
    const scene = {
      gameData: data,
      runManager: run,
      events: { once: () => {}, on: () => {}, off: () => {}, emit: () => {} },
      registry: { get: (k) => (k === 'hints' ? hints : null) },
      textures: { exists: () => false },
      sys: { settings: { key: 'NodeMap' } },
    };
    void events;
    const sheet = new MobileRosterSheet({ scene, units: run.roster, run, gameData: data, onClose: vi.fn() }); // prettier-ignore
    sheet.index = sheet.units.indexOf(unit);
    sheet.tab = tab;
    sheet.render();
    const buttons = () => sheet.root.querySelectorAll('button').map((b) => b.textContent);
    const press = (label) => {
      const b = sheet.root.querySelectorAll('button').find((x) => x.textContent === label);
      expect(b, label).toBeTruthy();
      b.click();
    };
    return { sheet, unit, buttons, press };
  }

  it('offers each skill that can be given up, and saves the swap', () => {
    const { sheet, unit, buttons, press } = open();
    expect(sheet.root.textContent).toContain('Oath of the Bridge · waiting');
    expect(sheet.root.textContent).toContain('Skill slots full (5/5)');
    const offers = buttons().filter((t) => t.startsWith('Give up '));
    expect(offers).toEqual(oathTradeableSkills(unit, data).map((id) => `Give up ${data.skills.find((s) => s.id === id).name}`)); // prettier-ignore
    press('Give up Luna');
    expect(unit.skills).toContain('pavise');
    expect(unit.skills).not.toContain('luna');
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    expect(sheet.root.textContent).toContain('Oath of the Bridge · sworn');
    sheet.destroy();
  });

  it('letting it go asks twice, then saves', () => {
    const { sheet, unit, buttons, press } = open();
    press('Keep my skills');
    expect(waitingOath(unit)).not.toBeNull();
    expect(saveServiceRun).not.toHaveBeenCalled();
    expect(buttons()).toContain('Let Oath of the Bridge go for good?');
    press('Let Oath of the Bridge go for good?');
    expect(waitingOath(unit)).toBeNull();
    expect(unit.skills).not.toContain('pavise');
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  /** HintManager's contract: shouldShow is true once per id, then marks it seen. */
  function fakeHints(seen = []) {
    const ids = new Set(seen);
    return {
      shouldShow: vi.fn((id) => (ids.has(id) ? false : (ids.add(id), true))),
      hasSeen: (id) => ids.has(id),
    };
  }
  const LESSON = /New: a unit swears one Oath when it promotes/;
  const callout = (sheet) => sheet.root.querySelector('.mr-oath-callout');

  // Playtest 2026-09-28: the waiting card sits at the foot of Stats; a promotion that
  // leaves an Oath waiting must say so where the player is looking.
  it('a waiting Oath heads the unit pane, flags the unit, and is taught once per save', () => {
    const hints = fakeHints();
    const { sheet, unit, press } = open({ hints, tab: 'skills' });
    const box = callout(sheet);
    expect(box).toBeTruthy();
    expect(box.textContent).toContain('Oath of the Bridge is waiting');
    expect(box.textContent).toContain('All 5 skill slots are full');
    expect(box.textContent).toMatch(LESSON);
    // It comes before any tab's content (right after the unit summary).
    const pane = sheet.root.querySelector('.mr-content');
    expect(pane.children.indexOf(box)).toBe(1);
    const card = sheet.root
      .querySelectorAll('.mr-unit-card')
      .find((b) => b.textContent.includes(unit.name));
    expect(card.textContent).toContain('Oath waiting');
    expect(card.getAttribute('aria-label')).toMatch(/, Oath waiting$/);
    // The lesson stays while this sheet is open (re-renders), and is told only once.
    press('Choose in Deeds');
    expect(sheet.tab).toBe('stats');
    expect(callout(sheet).textContent).toMatch(LESSON);
    expect(sheet.root.querySelector('.mr-oath-waiting')).toBeTruthy();
    expect(hints.shouldShow).toHaveBeenCalledTimes(1);
    sheet.destroy();

    const again = open({ hints });
    expect(callout(again.sheet).textContent).not.toMatch(LESSON);
    expect(callout(again.sheet).textContent).toContain('Oath of the Bridge is waiting');
    again.sheet.destroy();
  });

  it('once the Oath is sworn, the callout and the flag are gone', () => {
    const { sheet, unit, press } = open({ hints: fakeHints(['roster_oath_waiting']) });
    press('Give up Luna');
    expect(waitingOath(unit)).toBeNull();
    expect(callout(sheet)).toBeFalsy();
    expect(sheet.root.textContent).not.toContain('Oath waiting');
    sheet.destroy();
  });

  it('read-only inspection (no run) shows no callout', () => {
    const { unit } = promotedAtCap();
    const scene = {
      gameData: data,
      events: { once: () => {}, on: () => {}, off: () => {}, emit: () => {} },
      registry: { get: () => fakeHints() },
      textures: { exists: () => false },
      sys: { settings: { key: 'Battle' } },
    };
    const sheet = new MobileRosterSheet({ scene, units: [unit], gameData: data, onClose: vi.fn() }); // prettier-ignore
    sheet.render();
    expect(callout(sheet)).toBeFalsy();
    expect(sheet.root.textContent).not.toContain('Oath waiting');
    sheet.destroy();
  });

  it('rosterOathsWaiting counts the units with an Oath waiting', () => {
    const { run, unit } = promotedAtCap();
    expect(rosterOathsWaiting(run.roster)).toBe(1);
    releaseWaitingOath(unit);
    expect(rosterOathsWaiting(run.roster)).toBe(0);
    expect(rosterOathsWaiting(null)).toBe(0);
  });
});
