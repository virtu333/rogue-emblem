// The roster sheet's Discard (docs: CLAUDE.md "Roster Discard") on the fake DOM with the real
// engine: the button on bag and convoy item cards, the confirmation that names the item, and
// what Confirm / Cancel / Escape do to the run and its save.
// Failure modes covered: Discard acts on the first tap without asking; Cancel or Escape still
// removes the item or saves; the confirmation hides that the unit is left unarmed; the wrong
// instance of two same-named items goes; a discard is not saved (or saved twice); the
// prologue, a read-only sheet or a lord's personal weapon offers a live Discard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { FakeEvent, installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { ChoicePicker } from '../src/ui/ChoicePicker.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);
const ironBow = gameData.weapons.find((w) => w.name === 'Iron Bow');
const vulnerary = gameData.consumables.find((c) => c.name === 'Vulnerary');
const named = (base, name) => ({ ...structuredClone(base), name, uid: `uid-${name}` });

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

/** Daska (Archer) with two bows named alike, one supply and a stored bow; a read-only option. */
function setup({ run: withRun = true, run: _ignored, prologue = false } = {}) {
  const run = new RunManager(gameData);
  if (prologue) run.startPrologue(gameData, gameData.prologue);
  else run.startRun();
  const archer = createRecruitUnit({ name: 'Daska', level: 3 }, cls('Archer'), gameData.weapons);
  archer.inventory = [named(ironBow, 'Bow'), named(ironBow, 'Bow')];
  archer.inventory[1].uid = 'uid-Bow-2';
  archer.weapon = archer.inventory[0];
  archer.consumables = [named(vulnerary, 'Tonic')];
  run.roster = [archer];
  run.convoy.weapons = [named(ironBow, 'Stored Bow')];
  run.convoy.consumables = [];
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
    run: withRun ? run : null,
    gameData,
    onClose: vi.fn(),
  });
  sheet.tab = 'gear';
  sheet.render();
  return { run, sheet, archer };
}

const buttons = (root) => root.querySelectorAll('button');
const buttonTexts = (root) => buttons(root).map((b) => b.textContent);
const cards = (sheet, name) =>
  sheet.root
    .querySelectorAll('article')
    .filter((a) => a.querySelector('h4')?.textContent.startsWith(name));
const discardOf = (article) => buttons(article).find((b) => b.textContent === 'Discard');
// The sheet writes its status line in a microtask.
const status = async (sheet) => {
  await Promise.resolve();
  return sheet.root.querySelector('.mr-status').textContent;
};
const confirmButton = (picker) =>
  buttons(picker.surface.root).find((b) => b.textContent === 'Discard');
const cancelButton = (picker) =>
  buttons(picker.surface.root).find((b) => b.textContent === 'Cancel');

beforeEach(() => {
  installFakeDom(vi);
  _resetInputFocus();
  vi.mocked(saveServiceRun).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

describe('roster sheet: Discard is offered', () => {
  it('on every bag weapon and consumable, and on convoy items', () => {
    const { sheet } = setup();
    expect(cards(sheet, 'Bow').map((a) => !!discardOf(a))).toEqual([true, true]);
    expect(!!discardOf(cards(sheet, 'Tonic')[0])).toBe(true);
    sheet.tab = 'convoy';
    sheet.render();
    expect(!!discardOf(cards(sheet, 'Stored Bow')[0])).toBe(true);
    sheet.destroy();
  });

  it('not on a read-only sheet (in battle) and not in the prologue', () => {
    const readOnly = setup({ run: false });
    expect(buttonTexts(readOnly.sheet.root)).not.toContain('Discard');
    readOnly.sheet.destroy();
    const prologue = setup({ prologue: true });
    prologue.sheet.tab = 'gear';
    prologue.sheet.render();
    expect(buttonTexts(prologue.sheet.root)).not.toContain('Discard');
    prologue.sheet.tab = 'convoy';
    prologue.sheet.render();
    expect(buttonTexts(prologue.sheet.root)).not.toContain('Discard');
    prologue.sheet.destroy();
  });

  it("a lord's personal weapon shows Discard greyed, with the reason", () => {
    const { sheet, archer } = setup();
    const personal = gameData.weapons.find((w) => w.signatureOf);
    archer.inventory.push({ ...structuredClone(personal), uid: 'uid-sig' });
    sheet.render();
    const button = discardOf(cards(sheet, personal.name)[0]);
    expect(button.disabled).toBe(true);
    expect(
      cards(sheet, personal.name)[0]
        .querySelectorAll('small')
        .map((s) => s.textContent),
    ).toContain("A lord's personal weapon cannot be discarded.");
    sheet.destroy();
  });
});

describe('roster sheet: Discard asks first', () => {
  it('the first tap changes nothing and names the item; Confirm throws that one away and saves', async () => {
    const { sheet, archer } = setup();
    const [first, second] = archer.inventory;
    discardOf(cards(sheet, 'Bow')[1]).click();
    const picker = sheet.picker;
    expect(picker).toBeInstanceOf(ChoicePicker);
    expect(picker.surface.root.getAttribute('aria-label')).toBe('Discard Bow?');
    expect(picker.describe(second)).toBe(
      'It is gone for good: not stored in the convoy, and it pays no gold.',
    );
    expect(archer.inventory).toEqual([first, second]);
    expect(saveServiceRun).not.toHaveBeenCalled();

    confirmButton(picker).click();
    expect(archer.inventory).toEqual([first]);
    expect(archer.inventory[0]).toBe(first);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    expect(await status(sheet)).toBe('Discarded Bow.');
    expect(sheet.picker).toBeNull();
    expect(cards(sheet, 'Bow')).toHaveLength(1);
    sheet.destroy();
  });

  it('Cancel and Escape change nothing and save nothing', () => {
    const { sheet, archer, run } = setup();
    discardOf(cards(sheet, 'Tonic')[0]).click();
    cancelButton(sheet.picker).click();
    expect(sheet.picker).toBeNull();
    expect(archer.consumables).toHaveLength(1);

    sheet.tab = 'convoy';
    sheet.render();
    discardOf(cards(sheet, 'Stored Bow')[0]).click();
    sheet.picker.surface.root.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(sheet.picker).toBeNull();
    expect(run.convoy.weapons).toHaveLength(1);
    expect(saveServiceRun).not.toHaveBeenCalled();
    sheet.destroy();
  });

  it("warns that the unit is left unarmed when it is the unit's last combat weapon", async () => {
    const { sheet, archer } = setup();
    archer.inventory = [archer.inventory[0]];
    sheet.render();
    discardOf(cards(sheet, 'Bow')[0]).click();
    const picker = sheet.picker;
    expect(picker.describe(picker.selected)).toBe(
      'It is gone for good: not stored in the convoy, and it pays no gold. Leaves Daska unarmed.',
    );
    confirmButton(picker).click();
    expect(archer.inventory).toEqual([]);
    expect(archer.weapon).toBeNull();
    expect(await status(sheet)).toBe('Discarded Bow. Leaves Daska unarmed.');
    sheet.destroy();
  });

  it('a convoy item is thrown away from the convoy, not the unit', async () => {
    const { sheet, archer, run } = setup();
    sheet.tab = 'convoy';
    sheet.render();
    discardOf(cards(sheet, 'Stored Bow')[0]).click();
    expect(sheet.picker.describe(sheet.picker.selected)).toBe(
      'It is gone for good: not stored in the convoy, and it pays no gold.',
    );
    confirmButton(sheet.picker).click();
    expect(run.convoy.weapons).toEqual([]);
    expect(archer.inventory).toHaveLength(2);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    expect(await status(sheet)).toBe('Discarded Stored Bow.');
    sheet.destroy();
  });

  it('an item that vanished before Confirm is refused, not saved', () => {
    const { sheet, archer } = setup();
    discardOf(cards(sheet, 'Tonic')[0]).click();
    archer.consumables = [];
    const picker = sheet.picker;
    picker.render();
    expect(picker.blocked(picker.selected)).toBe('Item is no longer here.');
    expect(confirmButton(picker).disabled).toBe(true);
    expect(saveServiceRun).not.toHaveBeenCalled();
    picker.close();
    sheet.destroy();
  });
});
