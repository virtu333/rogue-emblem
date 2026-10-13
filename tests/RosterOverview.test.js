// The Roster's overview (playtest 2026-10-13): opening the Roster shows every unit as a
// small card at once (count, deploy cap, level, class, HP and EXP, a few marks); a card
// opens that unit's detail and Back returns to the grid.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom, FakeEvent } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { rosterOverviewModel, unitMarks, isUnarmed } from '../src/ui/rosterOverviewModel.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus, dispatchInputAction } from '../src/utils/inputFocus.js';
import { InputAction } from '../src/utils/InputActions.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);

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

function makeRun() {
  const run = new RunManager(gameData);
  run.startRun();
  const archer = createRecruitUnit({ name: 'Daska', level: 3 }, cls('Archer'), gameData.weapons);
  const fighter = createRecruitUnit({ name: 'Brom', level: 3 }, cls('Fighter'), gameData.weapons);
  archer.faction = fighter.faction = 'player';
  run.roster.push(archer, fighter);
  return { run, archer, fighter };
}

function open(options = {}) {
  const { run, archer, fighter } = makeRun();
  const onClose = vi.fn();
  const scene = {
    gameData,
    runManager: run,
    events: eventsFor(),
    registry: { get: () => null },
    textures: { exists: () => false },
    sys: { settings: { key: 'NodeMap' } },
  };
  const sheet = new MobileRosterSheet({
    scene,
    units: run.roster,
    run,
    gameData,
    onClose,
    ...options,
  });
  return { run, sheet, archer, fighter, onClose };
}

const cards = (sheet) => sheet.root.querySelectorAll('button.mr-ov-card');
const tabs = (sheet) =>
  (sheet.root.querySelector('.mr-tabs')?.querySelectorAll('button') || []).map(
    (b) => b.textContent,
  );
const headerButton = (sheet) => sheet.root.querySelector('header').children.at(-1);

beforeEach(() => {
  vi.useFakeTimers();
  installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

describe('roster overview model', () => {
  it('counts the units, names the deploy cap and gives each card its bars', () => {
    const { run, archer } = makeRun();
    archer.currentHP = 5;
    archer.xp = 42;
    const model = rosterOverviewModel({
      units: run.roster,
      run,
      deploy: { slots: 6, bonus: 0, capped: false },
    });
    expect(model.countText).toBe(`${run.roster.length} units`);
    expect(model.deployText).toBe('Deploy up to 6');
    const card = model.cards.find((c) => c.name === 'Daska');
    expect(card.className).toBe('Archer');
    expect(card.hp).toEqual({ current: 5, max: archer.stats.HP, ratio: 5 / archer.stats.HP });
    expect(card.xp.xp).toBe(42);
    expect(card.label).toContain(`HP 5 of ${archer.stats.HP}`);
    expect(card.label).toContain('42 of 100 EXP');
  });

  it('says how many are deployed when the caller knows the formation', () => {
    const { run, archer } = makeRun();
    const model = rosterOverviewModel({
      units: run.roster,
      run,
      deploy: { slots: 4, bonus: 0, capped: true },
      isDeployed: (u) => u === archer,
    });
    expect(model.deployText).toBe('1 of 4 deployed');
    const ids = (name) => model.cards.find((c) => c.name === name).marks.map((m) => m.id);
    expect(ids('Daska')).toContain('deployed');
    expect(ids('Brom')).toContain('benched');
  });

  it('marks the commander, an injury, a promotion and an unarmed unit', () => {
    const { run, archer, fighter } = makeRun();
    const edric = run.roster.find((u) => u.isCommander);
    expect(unitMarks(edric, { run }).map((m) => m.id)).toContain('commander');
    fighter.level = 10;
    fighter.tier = 'base';
    expect(unitMarks(fighter, { run }).map((m) => m.id)).toContain('promote');
    archer.inventory = [];
    expect(isUnarmed(archer)).toBe(true);
    expect(unitMarks(archer, { run }).map((m) => m.id)).toContain('unarmed');
    archer.unitUid = 'ru77';
    run.burdens = [{ id: 'wounded', unitUid: 'ru77', stat: 'STR', value: -2, battles: 2 }];
    expect(unitMarks(archer, { run, injured: new Set(['ru77']) })[0].id).toBe('injured');
    const model = rosterOverviewModel({ units: run.roster, run });
    expect(model.cards.find((c) => c.name === 'Daska').marks.map((m) => m.id)).toContain('injured');
  });

  it('a staff-only healer is not unarmed', () => {
    const cleric = createRecruitUnit({ name: 'Ilse', level: 2 }, cls('Cleric'), gameData.weapons);
    expect(isUnarmed(cleric)).toBe(false);
  });

  it('lists the fallen apart, at no HP', () => {
    const { run, archer } = makeRun();
    const model = rosterOverviewModel({ units: [archer], fallen: [structuredClone(archer)], run });
    expect(model.fallen).toHaveLength(1);
    expect(model.fallen[0].hp.current).toBe(0);
    expect(model.fallen[0].marks.map((m) => m.id)).toEqual(['fallen']);
  });
});

describe('roster sheet overview', () => {
  it('opens on a card per unit, with no view tabs', () => {
    const { sheet, run } = open({ overview: true });
    expect(sheet.view).toBe('overview');
    expect(cards(sheet)).toHaveLength(run.roster.length);
    expect(tabs(sheet)).toEqual([]);
    expect(sheet.root.querySelector('.mr-ov-count').textContent).toBe(`${run.roster.length} units`);
    expect(headerButton(sheet).textContent).toBe('Close');
    sheet.destroy();
  });

  it('a card opens that unit on Stats; Back returns to the grid on that card', () => {
    const { sheet, archer } = open({ overview: true });
    const index = sheet.units.indexOf(archer);
    cards(sheet)[index].click();
    expect(sheet.view).toBe('detail');
    expect(sheet.index).toBe(index);
    expect(tabs(sheet)).toEqual(['Stats', 'Skills', 'Equipment', 'Convoy']);
    expect(sheet.root.querySelector('.mr-summary h3').textContent).toContain('Daska');
    expect(headerButton(sheet).textContent).toBe('Back');
    headerButton(sheet).click();
    expect(sheet.view).toBe('overview');
    expect(document.activeElement).toBe(cards(sheet)[index]);
    sheet.destroy();
  });

  it('Escape and Cancel step back to the grid first, then close', () => {
    const { sheet, onClose } = open({ overview: true });
    cards(sheet)[1].click();
    sheet.root.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(sheet.view).toBe('overview');
    expect(onClose).not.toHaveBeenCalled();
    cards(sheet)[0].click();
    dispatchInputAction(InputAction.CANCEL);
    expect(sheet.view).toBe('overview');
    expect(onClose).not.toHaveBeenCalled();
    dispatchInputAction(InputAction.CANCEL);
    expect(onClose).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('the Roster button closes from either page', () => {
    const { sheet, onClose } = open({ overview: true });
    cards(sheet)[0].click();
    dispatchInputAction(InputAction.ROSTER);
    expect(onClose).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('a sheet opened on one unit (startInDetail) still has the grid behind Back', () => {
    const { sheet, archer } = open({ overview: true, startInDetail: true, index: 1 });
    expect(sheet.view).toBe('detail');
    expect(headerButton(sheet).textContent).toBe('Back');
    headerButton(sheet).click();
    expect(sheet.view).toBe('overview');
    expect(sheet.units).toContain(archer);
    sheet.destroy();
  });

  it('without the overview the sheet opens on the detail and Close closes', () => {
    const { sheet, onClose } = open();
    expect(sheet.view).toBe('detail');
    expect(cards(sheet)).toHaveLength(0);
    expect(headerButton(sheet).textContent).toBe('Close');
    sheet.root.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('shows the fallen as cards that open nothing', () => {
    const { sheet, run, archer } = open({ overview: true });
    run.fallenUnits.push(structuredClone(archer));
    sheet.render();
    const fallen = sheet.root.querySelectorAll('.mr-ov-card.is-fallen');
    expect(fallen).toHaveLength(1);
    expect(fallen[0].tagName).toBe('DIV');
    expect(cards(sheet)).toHaveLength(run.roster.length);
    sheet.destroy();
  });
});
