// The roster sheet's trade wiring (docs/specs/item-trade.md, "Roster") on the fake
// DOM with the real engine: Trade… on item cards, Trade with… in the Equipment
// heading, Trade… for a convoy item when the bag is full, and the accessory swap.
// Every expectation below is derived by hand from the spec's rules:
//   swap: src[i] = toItem, dst[j] = fromItem; give: splice + append;
//   settleEquipped: keep a carried usable weapon, else the incoming one if usable,
//   else the first usable combat weapon; then move it to slot 0.
// Failure modes covered: the trade never reaches the run (or reaches it twice), a
// commit is not saved (or saved through the wrong hook), a held convoy clone never
// resolves, the menu outlives the sheet, a read-only sheet offers trading, and the
// picker blocks a full bag instead of offering a swap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { FakeEvent, installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { TradeMenu } from '../src/ui/TradeMenu.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);
const ironBow = gameData.weapons.find((w) => w.name === 'Iron Bow');
const ironAxe = gameData.weapons.find((w) => w.name === 'Iron Axe');
const vulnerary = gameData.consumables.find((c) => c.name === 'Vulnerary');
const accessory = (name) => structuredClone(gameData.accessories.find((a) => a.name === name));

const named = (base, name) => ({ ...structuredClone(base), name, uid: `uid-${name}` });
const bows = (...names) => names.map((n) => named(ironBow, n));
const axes = (...names) => names.map((n) => named(ironAxe, n));
const names = (list) => list.map((item) => item.name);

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

/** Daska (Archer, bows) and Brom (Fighter, axes), each with a full weapon bag. */
function setup({ persist = null, run: withRun = true } = {}) {
  const run = new RunManager(gameData);
  run.startRun();
  const archer = createRecruitUnit({ name: 'Daska', level: 3 }, cls('Archer'), gameData.weapons);
  const fighter = createRecruitUnit({ name: 'Brom', level: 3 }, cls('Fighter'), gameData.weapons);
  archer.inventory = bows('B1', 'B2', 'B3', 'B4', 'B5');
  archer.weapon = archer.inventory[0];
  fighter.inventory = axes('A1', 'A2', 'A3', 'A4', 'A5');
  fighter.weapon = fighter.inventory[0];
  archer.consumables = [];
  fighter.consumables = [];
  run.roster = [archer, fighter];
  const scene = {
    gameData,
    runManager: run,
    events: eventsFor(),
    registry: { get: () => null },
    textures: { exists: () => false },
    sys: { settings: { key: 'NodeMap' } },
  };
  const onClose = vi.fn();
  const sheet = new MobileRosterSheet({
    scene,
    units: run.roster,
    run: withRun ? run : null,
    gameData,
    persist,
    onClose,
  });
  sheet.tab = 'gear';
  sheet.render();
  return { run, sheet, archer, fighter, onClose };
}

const buttons = (root) => root.querySelectorAll('button');
const buttonTexts = (root) => buttons(root).map((b) => b.textContent);
function card(sheet, name) {
  const found = sheet.root
    .querySelectorAll('article')
    .find((a) => a.querySelector('h4')?.textContent.startsWith(name));
  expect(found, `card ${name}`).toBeTruthy();
  return found;
}
function press(root, label) {
  const b = buttons(root).find((el) => el.textContent === label && !el.disabled);
  expect(b, label).toBeTruthy();
  b.click();
}
async function pickPartner(sheet, label) {
  const picker = sheet.picker;
  expect(picker).toBeTruthy();
  picker.selected = picker.choices.find((c) => picker.label(c) === label);
  expect(picker.selected, label).toBeTruthy();
  await picker.confirm();
  return sheet.picker;
}
const tm = (sheet) => {
  expect(sheet.picker).toBeInstanceOf(TradeMenu);
  return sheet.picker.surface.root;
};
const row = (root, side, index) =>
  root
    .querySelectorAll('.tm-row')
    .find((el) => el.dataset.side === side && el.dataset.index === String(index));
const tmStatus = (root) => root.querySelector('.tm-status').textContent;
/** Where DOM focus is, as a string (a failed toBe on DOM nodes would print the whole tree). */
const focusedAt = (root) => {
  const el = document.activeElement;
  if (el === root) return 'dialog';
  return el?.dataset?.side ? `${el.dataset.side}:${el.dataset.index}` : String(el?.tagName);
};
const pressed = (root) =>
  root
    .querySelectorAll('.tm-row')
    .filter((el) => el.getAttribute('aria-pressed') === 'true')
    .map((el) => `${el.dataset.side}:${el.dataset.index}`);
const key = (name) => document.activeElement.dispatchEvent(new FakeEvent('keydown', { key: name }));

beforeEach(() => {
  installFakeDom(vi);
  _resetInputFocus();
  vi.mocked(saveServiceRun).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

describe('roster sheet: trade controls', () => {
  it('item cards offer Trade… (never Give…); the heading offers Trade with…', () => {
    const { sheet, archer, run } = setup();
    archer.consumables = [structuredClone(vulnerary)];
    archer.accessory = accessory('Power Ring');
    run.accessories = [];
    sheet.render();
    const texts = buttonTexts(sheet.root);
    expect(texts).not.toContain('Give…');
    expect(texts.filter((t) => t === 'Trade with…')).toHaveLength(1);
    // Five weapons, one supply and the accessory.
    expect(texts.filter((t) => t === 'Trade…')).toHaveLength(7);
    expect(buttonTexts(card(sheet, 'B3'))).toContain('Trade…');
    expect(buttonTexts(card(sheet, 'Vulnerary'))).toContain('Trade…');
    expect(buttonTexts(card(sheet, 'Power Ring'))).toContain('Trade…');
    sheet.destroy();
  });

  it('a read-only sheet (in battle) shows no trade controls', () => {
    const { sheet, archer } = setup({ run: false });
    archer.accessory = accessory('Power Ring');
    sheet.render();
    const texts = buttonTexts(sheet.root);
    expect(texts).not.toContain('Trade…');
    expect(texts).not.toContain('Trade with…');
    sheet.tradeWith(archer);
    sheet.openTrade(archer, sheet.units[1]);
    expect(sheet.picker).toBeFalsy();
    sheet.destroy();
  });

  it('a lone unit gets no accessory Trade… (accessories trade only between units)', () => {
    const { sheet, archer, run } = setup();
    archer.accessory = accessory('Power Ring');
    // The run re-filters its roster into a new array; the sheet keeps the one it got.
    for (const list of [run.roster, sheet.units]) list.splice(1);
    sheet.render();
    expect(buttonTexts(card(sheet, 'Power Ring'))).not.toContain('Trade…');
    sheet.destroy();
  });
});

describe('roster sheet: Trade… on an item card', () => {
  it('lists every other unit and the convoy, blocking nobody, full bags included', () => {
    const { sheet, run } = setup();
    press(card(sheet, 'B3'), 'Trade…');
    const picker = sheet.picker;
    expect(picker.surface.root.getAttribute('aria-label')).toBe('Trade B3 with…');
    expect(picker.choices.map((c) => picker.label(c))).toEqual(['Brom', 'Convoy']);
    expect(picker.choices.map((c) => picker.blocked(c))).toEqual(['', '']);
    // Brom: 5/5 axes, and a Fighter has no bow proficiency.
    expect(picker.describe(picker.choices[0])).toBe(
      'Items 5/5 · full: pick an item to trade · Needs Bow proficiency',
    );
    const caps = run.getConvoyCapacities();
    expect(picker.describe(picker.choices[1])).toBe(`Weapons 0/${caps.weapons}`);
    sheet.destroy();
  });

  it("opens with nothing held; the hidden cursor starts on the card's item", async () => {
    const { sheet } = setup();
    press(card(sheet, 'B3'), 'Trade…');
    await pickPartner(sheet, 'Brom');
    const root = tm(sheet);
    expect(pressed(root)).toEqual([]);
    expect(tmStatus(root)).toBe('Choose an item to trade.');
    expect(focusedAt(root)).toBe('dialog');
    // The first key shows the cursor on B3 (slot 3) without holding it.
    key('ArrowDown');
    expect(focusedAt(root)).toBe('left:2');
    expect(pressed(root)).toEqual([]);
    expect(saveServiceRun).not.toHaveBeenCalled();
    sheet.destroy();
  });

  it('full–full: each swap lands in both bags and is saved once', async () => {
    const { sheet, archer, fighter } = setup();
    const [b1, b2, b3, b4, b5] = archer.inventory;
    const [a1, a2, a3, a4, a5] = fighter.inventory;
    press(card(sheet, 'B3'), 'Trade…');
    await pickPartner(sheet, 'Brom');
    let root = tm(sheet);
    row(root, 'left', 2).click();
    expect(pressed(root)).toEqual(['left:2']);
    expect(tmStatus(root)).toBe("Holding B3. Brom can't wield B3. Choose where it goes.");
    expect(saveServiceRun).not.toHaveBeenCalled();

    row(root, 'right', 3).click();
    // src[2] = A4, dst[3] = B3; both equipped weapons stay.
    expect(archer.inventory).toEqual([b1, b2, a4, b4, b5]);
    expect(fighter.inventory).toEqual([a1, a2, a3, b3, a5]);
    expect(fighter.inventory[3]).toBe(b3);
    expect(fighter.inventory[3].uid).toBe('uid-B3');
    expect([archer.weapon, fighter.weapon]).toEqual([b1, a1]);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    // Warnings ride the message: the receiver of B3 first, then of A4.
    expect(tmStatus(root)).toBe("Traded B3 for A4. Brom can't wield B3. Daska can't wield A4.");

    // Swap both equipped weapons: neither can use what it receives, so each
    // re-equips its first usable weapon and moves it to slot 0.
    row(root, 'left', 0).click();
    row(root, 'right', 0).click();
    expect(archer.inventory).toEqual([b2, a1, a4, b4, b5]);
    expect(fighter.inventory).toEqual([a2, b1, a3, b3, a5]);
    expect([archer.weapon, fighter.weapon]).toEqual([b2, a2]);
    expect(saveServiceRun).toHaveBeenCalledTimes(2);

    // Done closes the menu and re-renders the sheet with the last message.
    press(root, 'Done');
    expect(sheet.picker).toBeNull();
    await Promise.resolve();
    expect(sheet.root.querySelector('.mr-status').textContent).toBe(
      "Traded B1 for A1. Brom can't wield B1. Daska can't wield A1.",
    );
    expect(sheet.root.querySelectorAll('h4').map((h) => h.textContent)).toContain('A4');
    expect(saveServiceRun).toHaveBeenCalledTimes(2);
    sheet.destroy();
  });

  it('supplies open on the Supplies tab and give into a free slot', async () => {
    const { sheet, archer, fighter } = setup();
    const potion = structuredClone(vulnerary);
    archer.consumables = [potion];
    sheet.render();
    press(card(sheet, 'Vulnerary'), 'Trade…');
    expect(sheet.picker.describe(fighter)).toBe('Supplies 0/3');
    await pickPartner(sheet, 'Brom');
    const root = tm(sheet);
    const selected = root
      .querySelectorAll('.tm-tab')
      .find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.textContent).toBe('Supplies 1/3 · 0/3');
    expect(pressed(root)).toEqual([]);
    row(root, 'left', 0).click();
    row(root, 'right', 0).click();
    expect(archer.consumables).toEqual([]);
    expect(fighter.consumables).toEqual([potion]);
    expect(tmStatus(root)).toBe('Gave Vulnerary to Brom.');
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });

  it('a blocked target commits nothing and saves nothing', async () => {
    const { sheet, archer, fighter } = setup();
    const before = [names(archer.inventory), names(fighter.inventory)];
    press(card(sheet, 'B2'), 'Trade…');
    await pickPartner(sheet, 'Brom');
    const root = tm(sheet);
    // The item left the bag behind the menu's back: the plan now says stale.
    archer.inventory.splice(1, 1);
    const result = sheet.picker.commitTrade(
      { holder: { kind: 'unit', unit: archer }, bag: 'inventory', item: before[0][1] },
      { holder: { kind: 'unit', unit: fighter }, bag: 'inventory', item: fighter.inventory[0] },
    );
    expect(result).toEqual({ ok: false, reason: 'Item is no longer available.' });
    expect(names(fighter.inventory)).toEqual(before[1]);
    expect(saveServiceRun).not.toHaveBeenCalled();
    expect(root).toBeTruthy();
    sheet.destroy();
  });

  it('a context persist (rewards) saves each commit instead of a direct save', async () => {
    const persist = vi.fn(() => true);
    const { sheet } = setup({ persist });
    press(card(sheet, 'B3'), 'Trade…');
    await pickPartner(sheet, 'Brom');
    const root = tm(sheet);
    row(root, 'left', 2).click();
    row(root, 'right', 0).click();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(saveServiceRun).not.toHaveBeenCalled();
    persist.mockReturnValue(false);
    row(root, 'left', 1).click();
    row(root, 'right', 1).click();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(tmStatus(root)).toMatch(/ Save failed\.$/);
    sheet.destroy();
  });

  it('closing the sheet destroys an open trade menu without re-rendering', async () => {
    const { sheet } = setup();
    press(card(sheet, 'B3'), 'Trade…');
    const menu = await pickPartner(sheet, 'Brom');
    const shield = menu.surface.shield;
    expect(shield.parentNode).toBeTruthy();
    const render = vi.spyOn(sheet, 'render');
    sheet.destroy();
    expect(menu.closed).toBe(true);
    expect(shield.parentNode).toBeFalsy();
    expect(render).not.toHaveBeenCalled();
    expect(sheet.picker).toBeNull();
  });
});

describe('roster sheet: Trade with…', () => {
  it('opens the trade menu with nothing held after choosing a partner', async () => {
    const { sheet, archer, run } = setup();
    archer.consumables = [structuredClone(vulnerary)];
    sheet.render();
    press(sheet.root, 'Trade with…');
    const picker = sheet.picker;
    expect(picker.surface.root.getAttribute('aria-label')).toBe('Daska: trade with…');
    const caps = run.getConvoyCapacities();
    expect(picker.choices.map((c) => [picker.label(c), picker.describe(c)])).toEqual([
      ['Brom', 'Items 5/5 · Supplies 0/3'],
      ['Convoy', `Weapons 0/${caps.weapons} · Supplies 0/${caps.consumables}`],
    ]);
    await pickPartner(sheet, 'Brom');
    const root = tm(sheet);
    expect(
      root.querySelectorAll('.tm-row').some((r) => r.getAttribute('aria-pressed') === 'true'),
    ).toBe(false);
    expect(tmStatus(root)).toBe('Choose an item to trade.');
    sheet.destroy();
  });

  it('closing the partner picker opens nothing', () => {
    const { sheet } = setup();
    press(sheet.root, 'Trade with…');
    press(sheet.picker.surface.root, 'Close');
    expect(sheet.picker).toBeNull();
    sheet.destroy();
  });
});

describe('roster sheet: convoy tab', () => {
  it('Withdraw while there is room; Trade… (a swap) once the bag is full', async () => {
    const { sheet, run, archer } = setup();
    const caps = run.getConvoyCapacities();
    const fill = bows(...Array.from({ length: caps.weapons }, (_, i) => `C${i + 1}`));
    run.convoy.weapons = fill;
    run.convoy.consumables = [named(vulnerary, 'Tonic')];
    sheet.tab = 'convoy';
    sheet.render();
    // Weapons: the archer's bag is 5/5, so Trade…; supplies: 0/3, so Withdraw.
    expect(buttonTexts(card(sheet, 'C2'))).toEqual(['Trade…', 'Discard']);
    expect(card(sheet, 'C2').querySelector('small').textContent).toBe(
      'Equipment full: trade to swap it for a carried item.',
    );
    expect(buttonTexts(card(sheet, 'Tonic'))).toContain('Withdraw');

    const [b1, b2, b3, b4, b5] = archer.inventory;
    const c2 = fill[1];
    press(card(sheet, 'C2'), 'Trade…');
    const root = tm(sheet);
    // Nothing held on open; the hidden cursor is on C2 (the card shows a clone).
    expect(pressed(root)).toEqual([]);
    key('Enter');
    expect(focusedAt(root)).toBe('right:1');
    expect(pressed(root)).toEqual([]);
    row(root, 'right', 1).click();
    expect(pressed(root)).toEqual(['right:1']);
    // Both sides full: only a swap can land. Swap C2 for B4.
    row(root, 'left', 3).click();
    expect(archer.inventory).toEqual([b1, b2, b3, c2, b5]);
    expect(run.convoy.weapons[1]).toBe(b4);
    expect(run.convoy.weapons).toHaveLength(caps.weapons);
    expect(archer.inventory[3].uid).toBe('uid-C2');
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    expect(tmStatus(root)).toBe('Traded C2 for B4.');
    sheet.destroy();
  });
});

describe('roster sheet: convoy tab (an item without a uid)', () => {
  it('holds the live convoy item, so a uid-less one (old save) still trades', () => {
    const { sheet, run, archer } = setup();
    const plain = { ...structuredClone(ironBow), name: 'Old Bow' };
    delete plain.uid;
    run.convoy.weapons = [plain];
    sheet.tab = 'convoy';
    sheet.render();
    const b2 = archer.inventory[1];
    press(card(sheet, 'Old Bow'), 'Trade…');
    const root = tm(sheet);
    expect(pressed(root)).toEqual([]);
    row(root, 'right', 0).click();
    expect(pressed(root)).toEqual(['right:0']);
    row(root, 'left', 1).click();
    expect(archer.inventory[1]).toBe(plain);
    expect(run.convoy.weapons).toEqual([b2]);
    sheet.destroy();
  });
});

describe('roster sheet: accessory Trade…', () => {
  it('lists units only and swaps accessories with their stats and HP', async () => {
    const { sheet, archer, fighter } = setup();
    // Daska wears the Seraph Robe (+5 HP), 7 HP down; Brom wears the Power Ring (+2 STR).
    const robe = accessory('Seraph Robe');
    const ringItem = accessory('Power Ring');
    archer.stats.HP = 20;
    archer.accessory = null;
    const archerSTR = archer.stats.STR;
    fighter.stats.HP = 30;
    fighter.currentHP = 30;
    const fighterSTR = fighter.stats.STR;
    // Worn through the engine so the stats include them: 25 max, 18 current.
    const { equipAccessory } = await import('../src/engine/UnitManager.js');
    archer.currentHP = 13;
    equipAccessory(archer, robe);
    equipAccessory(fighter, ringItem);
    expect([archer.stats.HP, archer.currentHP, fighter.stats.STR]).toEqual([
      25,
      18,
      fighterSTR + 2,
    ]);
    sheet.render();

    press(card(sheet, 'Seraph Robe'), 'Trade…');
    const picker = sheet.picker;
    expect(picker.choices.map((c) => picker.label(c))).toEqual(['Brom']);
    expect(picker.describe(fighter)).toBe('Wears Power Ring');
    await pickPartner(sheet, 'Brom');
    const root = tm(sheet);
    const selected = root
      .querySelectorAll('.tm-tab')
      .find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.textContent).toBe('Accessory');
    expect(pressed(root)).toEqual([]);
    row(root, 'left', 0).click();
    row(root, 'right', 0).click();
    expect(archer.accessory).toBe(ringItem);
    expect(fighter.accessory).toBe(robe);
    // Daska: robe off keeps 7 missing (25/18 → 20/13); ring on: STR +2.
    expect([archer.stats.HP, archer.currentHP, archer.stats.STR]).toEqual([20, 13, archerSTR + 2]);
    // Brom: ring off, robe on: 35 max, current +5.
    expect([fighter.stats.HP, fighter.currentHP, fighter.stats.STR]).toEqual([35, 35, fighterSTR]);
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    sheet.destroy();
  });
});

describe('roster sheet: reorder in the trade menu', () => {
  it('two taps in a unit column swap places; slot 1 is equipped; each change is saved once', async () => {
    const { sheet, archer, fighter } = setup();
    const [b1, b2, b3, b4, b5] = archer.inventory;
    press(sheet.root, 'Trade with…');
    await pickPartner(sheet, 'Brom');
    const root = tm(sheet);
    row(root, 'left', 2).click();
    expect(row(root, 'left', 0).getAttribute('aria-label')).toBe('Equip B3');
    row(root, 'left', 0).click();
    expect(archer.inventory).toEqual([b3, b2, b1, b4, b5]);
    expect(archer.weapon).toBe(b3);
    expect(tmStatus(root)).toBe('B3 is now equipped.');
    expect(saveServiceRun).toHaveBeenCalledTimes(1);
    // Order only, further down the bag.
    row(root, 'left', 1).click();
    row(root, 'left', 4).click();
    expect(archer.inventory).toEqual([b3, b5, b1, b4, b2]);
    expect(archer.weapon).toBe(b3);
    expect(tmStatus(root)).toBe('Swapped B2 and B5.');
    expect(saveServiceRun).toHaveBeenCalledTimes(2);
    // An axe (after a trade) can't be moved into Daska's slot 1: refused, not saved.
    const a2 = fighter.inventory[1];
    row(root, 'left', 3).click();
    row(root, 'right', 1).click();
    expect(archer.inventory[3]).toBe(a2);
    expect(saveServiceRun).toHaveBeenCalledTimes(3);
    row(root, 'left', 3).click();
    expect(row(root, 'left', 0).getAttribute('aria-disabled')).toBe('true');
    row(root, 'left', 0).click();
    expect(tmStatus(root)).toBe("Daska can't wield A2.");
    expect(archer.inventory[0]).toBe(b3);
    expect(saveServiceRun).toHaveBeenCalledTimes(3);
    press(root, 'Done');
    await Promise.resolve();
    expect(sheet.root.querySelector('.mr-status').textContent).toBe(
      "Traded B4 for A2. Brom can't wield B4. Daska can't wield A2.",
    );
    sheet.destroy();
  });

  it('the convoy column never reorders the convoy', () => {
    const { sheet, run } = setup();
    run.convoy.weapons = bows('C1', 'C2');
    sheet.tab = 'convoy';
    sheet.render();
    press(card(sheet, 'C1'), 'Trade…');
    const root = tm(sheet);
    row(root, 'right', 0).click();
    row(root, 'right', 1).click();
    expect(pressed(root)).toEqual(['right:1']);
    expect(names(run.convoy.weapons)).toEqual(['C1', 'C2']);
    expect(saveServiceRun).not.toHaveBeenCalled();
    sheet.destroy();
  });
});
