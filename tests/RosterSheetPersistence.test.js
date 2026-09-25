// Playtest 2026-09-25 (iOS save audit): the roster sheet saved some changes as
// they applied (item use, equip, store, withdraw) but left gifts, scroll
// teaching, weapon-art binds, reclassing and accessory changes in memory until
// the sheet closed — closing the iOS app with the sheet open dropped them.
// Every roster mutation now saves the moment it applies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

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

function setup({ persist = null } = {}) {
  const run = new RunManager(gameData);
  run.startRun();
  const archer = createRecruitUnit({ name: 'Daska', level: 3 }, cls('Archer'), gameData.weapons);
  const fighter = createRecruitUnit({ name: 'Brom', level: 3 }, cls('Fighter'), gameData.weapons);
  run.roster.push(archer, fighter);
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
    persist,
    onClose: vi.fn(),
  });
  return { run, sheet, archer, fighter };
}

async function confirm(sheet, choice) {
  const picker = sheet.picker;
  expect(picker).toBeTruthy();
  if (choice !== undefined) picker.selected = choice;
  await picker.confirm();
  await vi.advanceTimersByTimeAsync(0);
}

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

describe('roster sheet saves each change as it applies', () => {
  it('giving an item to another unit', async () => {
    const { sheet, archer, fighter } = setup();
    const vulnerary = structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'));
    archer.consumables = [vulnerary];
    sheet.giveItem(archer, vulnerary);
    await confirm(sheet, fighter);
    expect(fighter.consumables.map((c) => c.name)).toContain('Vulnerary');
    expect(archer.consumables).toEqual([]);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('teaching a scroll', async () => {
    const { run, sheet, fighter } = setup();
    const scroll = structuredClone(gameData.weapons.find((w) => w.type === 'Scroll'));
    run.scrolls = [scroll];
    sheet.teachScroll(scroll);
    await confirm(sheet, fighter);
    expect(fighter.skills).toContain(scroll.skillId);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('reclassing with a seal', async () => {
    const { sheet, fighter } = setup();
    const seal = structuredClone(
      gameData.consumables.find((c) => c.effect === 'reclass' && c.subEffect === 'infantry'),
    );
    fighter.level = 10;
    fighter.consumables = [seal];
    sheet.changeClass(fighter, seal);
    const target = sheet.picker.choices.find((c) => c.name !== 'Fighter');
    await confirm(sheet, target);
    expect(fighter.className).toBe(target.name);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('equipping and unequipping an accessory', () => {
    const { run, sheet, archer } = setup();
    const ring = structuredClone(gameData.accessories[0]);
    run.accessories = [ring];
    sheet.index = sheet.units.indexOf(archer);
    sheet.tab = 'gear';
    sheet.render();
    const press = (label) => {
      const button = sheet.root
        .querySelectorAll('button')
        .find((b) => b.textContent === label && !b.disabled);
      expect(button, label).toBeTruthy();
      button.click();
    };
    press('Equip accessory');
    expect(archer.accessory?.name).toBe(ring.name);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    press('Unequip accessory');
    expect(archer.accessory).toBeFalsy();
    expect(saveServiceRun).toHaveBeenCalledTimes(2);
    sheet.destroy();
  });

  it('uses the context persist (rewards) instead of a direct save when given', async () => {
    const persist = vi.fn(() => true);
    const { sheet, archer, fighter } = setup({ persist });
    const vulnerary = structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'));
    archer.consumables = [vulnerary];
    sheet.giveItem(archer, vulnerary);
    await confirm(sheet, fighter);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(saveServiceRun).not.toHaveBeenCalled();
    sheet.destroy();
  });

  it('read-only inspection (no run) never saves', () => {
    const { sheet } = setup();
    sheet.run = null;
    expect(sheet.persistNow()).toBe('');
    expect(saveServiceRun).not.toHaveBeenCalled();
    sheet.destroy();
  });
});
