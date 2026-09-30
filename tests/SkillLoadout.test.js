// The skill bench (playtest 2026-09-28): a unit keeps every skill it learns. Five are
// equipped (all battle reads); a skill learned with every slot full waits on the
// bench instead of being lost, and the roster swaps skills between battles. An Oath
// sworn at the cap goes to the bench too (it used to wait, or be given up for).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  checkLevelUpSkills,
  createLordUnit,
  createUnit,
  getClassInnateSkills,
  learnSkill,
  resolvePromotionTargets,
} from '../src/engine/UnitManager.js';
import { promoteAtChurch } from '../src/engine/ChurchCommands.js';
import {
  applyPromotionOath,
  commitBattleDeeds,
  emptyBattleDeeds,
  promotionOathCandidates,
} from '../src/engine/DeedSystem.js';
import {
  benchSkill,
  equipSkill,
  lockedSkillIds,
  markBenchSeen,
  migrateWaitingOath,
  rosterBenchedUnseen,
  unseenBenchedSkills,
} from '../src/engine/SkillLoadout.js';
import { teachRosterScroll } from '../src/engine/RosterTransfers.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { MAX_SKILLS } from '../src/utils/constants.js';

const data = loadGameData();
data.dialogue = JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url)));
const cls = (name) => data.classes.find((c) => c.name === name);
let key = 0;
// Three enemy phases held on a bridge: "Who Held the Bridge", Oath of the Bridge → Pavise.
function held(unit) {
  unit._battleDeeds = { ...emptyBattleDeeds(), heldPhases: 3, heldPlaces: ['Bridge', 'Bridge', 'Bridge'] }; // prettier-ignore
  commitBattleDeeds([unit], data.deeds, { battleKey: `bench:${++key}` });
  return unit;
}
const FULL = ['sol', 'luna', 'astra', 'vantage', 'wrath'];
const fighter = (name, level = 10) => {
  const unit = createUnit(cls('Fighter'), level, data.weapons, { name });
  unit.faction = 'player';
  return unit;
};

/** A Fighter with five skills promoted at a church: its Oath goes to the bench. */
function promotedAtCap(name = 'Bram') {
  const run = new RunManager(data);
  run.startRun();
  run.gold = 99999;
  const unit = held(fighter(name));
  unit.skills = [...FULL];
  run.roster.push(unit);
  const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
  const result = promoteAtChurch(run, unit, 'c1', target, data);
  return { run, unit, result, target };
}

describe('learning at the cap', () => {
  it('a player unit keeps the skill on its bench, marked new; an enemy simply does not learn', () => {
    const unit = fighter('Kira');
    unit.skills = [...FULL];
    expect(learnSkill(unit, 'pavise')).toEqual({ learned: false, benched: true, skillId: 'pavise', reason: 'at_cap' }); // prettier-ignore
    expect(unit.skills).toEqual(FULL);
    expect(unit.benchedSkills).toEqual(['pavise']);
    expect(unseenBenchedSkills(unit)).toEqual(['pavise']);
    // Known once, benched or not.
    expect(learnSkill(unit, 'pavise').reason).toBe('already_known');
    expect(learnSkill(unit, 'sol').reason).toBe('already_known');
    const foe = { ...fighter('Foe'), faction: 'enemy', skills: [...FULL] };
    expect(learnSkill(foe, 'pavise')).toEqual({ learned: false, reason: 'at_cap' });
    expect(foe.benchedSkills).toBeUndefined();
  });

  it('a Myrmidon at the cap reaching Lv 10 benches Vantage once, never twice', () => {
    const unit = createUnit(cls('Myrmidon'), 10, data.weapons, { name: 'Ren' });
    unit.faction = 'player';
    unit.skills = ['sol', 'luna', 'astra', 'wrath', 'pavise'];
    const dropped = [];
    checkLevelUpSkills(unit, data.classes, dropped);
    expect(dropped).toEqual(['vantage']);
    expect(unit.benchedSkills).toEqual(['vantage']);
    const again = [];
    checkLevelUpSkills(unit, data.classes, again);
    expect(again).toEqual([]);
    expect(unit.benchedSkills).toEqual(['vantage']);
  });

  it('a skill scroll teaches onto the bench when every slot is full, and is spent', () => {
    const run = new RunManager(data);
    run.startRun();
    const unit = fighter('Tess');
    unit.skills = [...FULL];
    run.roster.push(unit);
    const scroll = { name: 'Pavise Scroll', type: 'Scroll', skillId: 'pavise' };
    run.scrolls = [scroll];
    expect(teachRosterScroll(run, unit, scroll, data.skills)).toEqual({ ok: true, benched: true });
    expect(unit.benchedSkills).toEqual(['pavise']);
    expect(run.scrolls).toEqual([]);
  });
});

describe('an Oath at the cap', () => {
  it('is sworn onto the bench, and the promotion says so', () => {
    const { unit, result } = promotedAtCap();
    expect(result.ok).toBe(true);
    expect(unit.skills).not.toContain('pavise');
    expect(unit.benchedSkills).toContain('pavise');
    expect(unit.deeds.oath).toMatchObject({ skillId: 'pavise', name: 'Oath of the Bridge' });
    expect(unit.deeds.waitingOath).toBeUndefined();
    expect(result.message).toContain("Oath of the Bridge: Pavise is on Bram's bench");
    // One Oath per unit: nothing more to swear.
    expect(promotionOathCandidates(unit, data.deeds, data.skills)).toEqual([]);
  });

  it('a save from before the bench: a waiting Oath is sworn on load (benched at the cap)', () => {
    const { run, unit } = promotedAtCap();
    // Rebuild the old state: the Oath waiting, the skill nowhere.
    unit.benchedSkills = unit.benchedSkills.filter((id) => id !== 'pavise');
    const { oath, ...rest } = unit.deeds;
    unit.deeds = { ...rest, waitingOath: oath };
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const again = restored.roster.find((u) => u.name === unit.name);
    expect(again.deeds.waitingOath).toBeUndefined();
    expect(again.deeds.oath).toMatchObject({ skillId: 'pavise' });
    expect([...again.skills, ...again.benchedSkills]).toContain('pavise');
    expect(migrateWaitingOath(again)).toBe(false); // nothing left to migrate
  });
});

describe('swapping skills between battles', () => {
  it('bench frees a slot; equip fills it; with every slot full, equip swaps', () => {
    const unit = fighter('Kira');
    unit.skills = [...FULL];
    learnSkill(unit, 'pavise');
    // Full: equipping needs a skill to give its place.
    expect(equipSkill(unit, 'pavise', null, data)).toMatch(/choose a skill to bench/);
    const at = unit.skills.indexOf('luna');
    expect(equipSkill(unit, 'pavise', 'luna', data)).toBe('');
    expect(unit.skills[at]).toBe('pavise');
    expect(unit.benchedSkills).toEqual(['luna']);
    expect(unseenBenchedSkills(unit)).toEqual([]); // equipped: no longer news
    expect(benchSkill(unit, 'sol', data)).toBe('');
    expect(unit.skills).toHaveLength(MAX_SKILLS - 1);
    expect(equipSkill(unit, 'luna', null, data)).toBe('');
    expect(unit.skills).toHaveLength(MAX_SKILLS);
    expect(unit.benchedSkills).toEqual(['sol']);
    // Nothing known is ever lost.
    expect(new Set([...unit.skills, ...unit.benchedSkills])).toEqual(new Set([...FULL, 'pavise']));
  });

  it('class skills and a lord’s own skills stay equipped', () => {
    const { unit } = promotedAtCap();
    for (const id of getClassInnateSkills(unit.className, data.skills)) {
      expect(lockedSkillIds(unit, data).has(id)).toBe(true);
      if (unit.skills.includes(id)) expect(benchSkill(unit, id, data)).toMatch(/can’t be benched/);
    }
    const edric = createLordUnit(data.lords.find((l) => l.name === 'Edric'), data.classes, data.weapons); // prettier-ignore
    expect(edric.skills).toContain('charisma');
    expect(benchSkill(edric, 'charisma', data)).toMatch(/can’t be benched/);
    // Nor can a locked skill be swapped out for a benched one.
    edric.skills = ['charisma', ...FULL.slice(0, 4)];
    edric.benchedSkills = ['pavise'];
    expect(equipSkill(edric, 'pavise', 'charisma', data)).toMatch(/can’t be benched/);
  });

  it('the bench survives a save and load', () => {
    const { run, unit } = promotedAtCap();
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const again = restored.roster.find((u) => u.name === unit.name);
    expect(again.benchedSkills).toEqual(unit.benchedSkills);
    expect(unseenBenchedSkills(again)).toEqual(unseenBenchedSkills(unit));
    expect(unseenBenchedSkills(again)).toContain('pavise');
  });

  it('rosterBenchedUnseen counts the units with news on the bench', () => {
    const { run, unit } = promotedAtCap();
    expect(rosterBenchedUnseen(run.roster)).toBe(1);
    expect(markBenchSeen(unit)).toBe(true);
    expect(rosterBenchedUnseen(run.roster)).toBe(0);
    expect(rosterBenchedUnseen(null)).toBe(0);
  });
});

describe('the bench in the roster', () => {
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

  /** HintManager's contract: shouldShow is true once per id, then marks it seen. */
  function fakeHints(seen = []) {
    const ids = new Set(seen);
    return {
      shouldShow: vi.fn((id) => (ids.has(id) ? false : (ids.add(id), true))),
      hasSeen: (id) => ids.has(id),
    };
  }
  function open({ hints = null, tab = 'stats', setup = promotedAtCap() } = {}) {
    const { run, unit } = setup;
    const scene = {
      gameData: data,
      runManager: run,
      events: { once: () => {}, on: () => {}, off: () => {}, emit: () => {} },
      registry: { get: (k) => (k === 'hints' ? hints : null) },
      textures: { exists: () => false },
      sys: { settings: { key: 'NodeMap' } },
    };
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
    return { sheet, unit, run, buttons, press };
  }
  const LESSON = /New: a unit keeps every skill it learns/;
  const callout = (sheet) => sheet.root.querySelector('.mr-bench-callout');

  it('new bench news heads the pane, flags the unit, and is taught once per save', () => {
    const hints = fakeHints();
    const { sheet, unit, press } = open({ hints });
    const box = callout(sheet);
    expect(box.textContent).toContain("New on Bram's bench:");
    expect(box.textContent).toContain('Pavise');
    expect(box.textContent).toContain('all 5 skill slots full');
    expect(box.textContent).toMatch(LESSON);
    const pane = sheet.root.querySelector('.mr-content');
    expect(pane.children.indexOf(box)).toBe(1); // right after the unit summary
    const card = sheet.root.querySelectorAll('.mr-unit-card').find((b) => b.textContent.includes(unit.name)); // prettier-ignore
    expect(card.textContent).toContain('New skill benched');
    expect(card.getAttribute('aria-label')).toMatch(/, new skill benched$/);
    // Go to Skills: there the skill is marked new, and looking at it clears the news
    // (saved, so the route map's pip stays down after a reload).
    press('Go to Skills');
    expect(sheet.tab).toBe('skills');
    expect(callout(sheet)).toBeFalsy();
    const fresh = sheet.root.querySelectorAll('.mr-bench-new').map((c) => c.textContent);
    expect(fresh.some((t) => t.includes('Pavise'))).toBe(true);
    expect(unseenBenchedSkills(unit)).toEqual([]);
    expect(
      sheet.root.querySelector('.mr-unit-card.is-selected, .mr-units')?.textContent || '',
    ).not.toContain('New skill benched');
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    expect(hints.shouldShow).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('Skills lists equipped and benched skills; Swap in… trades places and saves', async () => {
    const { sheet, unit, buttons, press } = open({ tab: 'skills' });
    expect(sheet.root.textContent).toContain(`Equipped · ${MAX_SKILLS}/${MAX_SKILLS}`);
    expect(sheet.root.textContent).toContain(`Bench · ${unit.benchedSkills.length}`);
    // Locked skills say so instead of offering Bench.
    const locked = [...lockedSkillIds(unit, data)].filter((id) => unit.skills.includes(id));
    expect(buttons().filter((t) => t === 'Bench')).toHaveLength(unit.skills.length - locked.length);
    const swap = sheet.root
      .querySelectorAll('.mr-card')
      .find((c) => c.textContent.includes('Pavise') && c.textContent.includes('Swap in…'));
    swap
      .querySelectorAll('button')
      .find((b) => b.textContent === 'Swap in…')
      .click();
    expect(sheet.picker).toBeTruthy();
    sheet.picker.selected = 'luna';
    await sheet.picker.confirm();
    expect(unit.skills).toContain('pavise');
    expect(unit.benchedSkills).toContain('luna');
    expect(unit.benchedSkills).not.toContain('pavise');
    expect(saveServiceRun).toHaveBeenCalled();
    expect(sheet.root.textContent).toContain('Pavise in, Luna to the bench.');
    sheet.destroy();
  });

  it('Bench then Equip, each saved', () => {
    const { sheet, unit } = open({ tab: 'skills' });
    const benched = unit.benchedSkills.length;
    const firstBench = sheet.root.querySelectorAll('button').find((b) => b.textContent === 'Bench');
    firstBench.click();
    expect(unit.skills).toHaveLength(MAX_SKILLS - 1);
    expect(unit.benchedSkills).toHaveLength(benched + 1);
    sheet.root
      .querySelectorAll('button')
      .find((b) => b.textContent === 'Equip')
      .click();
    expect(unit.skills).toHaveLength(MAX_SKILLS);
    expect(unit.benchedSkills).toHaveLength(benched);
    expect(saveServiceRun.mock.calls.length).toBeGreaterThanOrEqual(2);
    sheet.destroy();
  });

  it('keeps Gaspar personal skills locked in the rendered Skills tab', () => {
    const run = new RunManager(data);
    run.startRun();
    const unit = run.roster.find((u) => u.specialCharId);
    const { sheet, buttons } = open({ tab: 'skills', setup: { run, unit } });
    expect(sheet.root.textContent).toContain('Measured Step');
    expect(sheet.root.textContent).toContain('Personal skills can’t be benched.');
    expect(buttons()).not.toContain('Bench');
    sheet.destroy();
  });

  it('renders Gear and Convoy seal refusals stably without writing narrative history', () => {
    const run = new RunManager(data);
    run.startRun();
    const unit = run.roster.find((u) => u.specialCharId);
    for (const effect of ['promote', 'reclass']) {
      const seal = data.consumables.find((c) => c.effect === effect);
      unit.consumables.push(structuredClone(seal));
      run.convoy.consumables.push(structuredClone(seal));
    }
    const before = structuredClone(run.narrativeSeen);
    const { sheet } = open({ tab: 'gear', setup: { run, unit } });
    const refusals = () =>
      sheet.root
        .querySelectorAll('small')
        .map((n) => n.textContent)
        .filter((t) => t.startsWith('Gaspar:'));
    const gear = refusals();
    expect(gear).toHaveLength(2);
    for (let i = 0; i < 3; i++) {
      sheet.render();
      expect(refusals()).toEqual(gear);
      sheet.tab = 'convoy';
      sheet.render();
      expect(refusals()).toEqual(gear);
      sheet.tab = 'gear';
      sheet.render();
    }
    expect(run.narrativeSeen).toEqual(before);
    expect(saveServiceRun).not.toHaveBeenCalled();
    sheet.destroy();
  });

  it('read-only inspection (no run) shows the bench, but no callout or buttons', () => {
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
    sheet.tab = 'skills';
    sheet.render();
    expect(sheet.root.textContent).toContain(`Bench · ${unit.benchedSkills.length}`);
    const labels = sheet.root.querySelectorAll('button').map((b) => b.textContent);
    expect(labels).not.toContain('Bench');
    expect(labels).not.toContain('Swap in…');
    expect(unseenBenchedSkills(unit)).toContain('pavise'); // inspecting mid-battle is not seeing it
    sheet.destroy();
  });
});

it('applyPromotionOath below the cap equips the Oath', () => {
  const run = new RunManager(data);
  run.startRun();
  run.gold = 99999;
  const unit = held(fighter('Ada'));
  unit.skills = ['sol'];
  run.roster.push(unit);
  const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
  expect(promoteAtChurch(run, unit, 'c', target, data).ok).toBe(true);
  expect(unit.skills).toContain('pavise');
  expect(unit.benchedSkills || []).not.toContain('pavise');
  expect(applyPromotionOath(unit, data)).toBeNull();
});
