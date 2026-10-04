// The roster lesson in the roster sheet (ui/PrologueRosterCoach.js; docs/specs/
// prologue-chapter.md §6 "Route map, row 2"): every Roster entry point in a browser is
// the same sheet — the route map's Roster on desktop (RosterOverlay hands its DOM host
// to MobileRosterSheet) and on a phone, the Market's and the Chapel's Roster buttons —
// so the lesson attaches there. Each step completes on the button the player presses,
// Skip step / Skip lesson work, nothing is ever blocked, it runs once, and the in-run
// convoy note is read on the slot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { RosterOverlay } from '../src/ui/RosterOverlay.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { RunManager } from '../src/engine/RunManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { isRosterLessonLive } from '../src/engine/PrologueRosterLesson.js';

const gameData = loadGameData();

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

/** The prologue run at the Market, Tamsin just joined, her bow in the convoy. */
function forkRun({ nodeId = 'prologue_2a' } = {}) {
  const run = new RunManager(gameData, null);
  run.startPrologue(gameData, gameData.prologue);
  run.completeBattle(run.roster, 'prologue_0', 0);
  run.completeBattle(run.roster, 'prologue_1', 0);
  run.addToConvoy(structuredClone(gameData.weapons.find((w) => w.name === 'Iron Bow')));
  run.currentNodeId = nodeId;
  run.arriveAtPrologueNode(nodeId);
  return run;
}

function sceneFor(run, hints = { markSeen: vi.fn() }) {
  return {
    gameData,
    runManager: run,
    events: eventsFor(),
    registry: { get: (key) => (key === 'hints' ? hints : null) },
    textures: { exists: () => false },
    sys: { settings: { key: 'NodeMap' } },
    isMobileInput: false,
  };
}

function open(run, scene = sceneFor(run)) {
  const sheet = new MobileRosterSheet({
    scene,
    units: run.roster,
    run,
    gameData,
    onClose: vi.fn(),
  });
  return { sheet, scene };
}

const strip = (sheet) => sheet.root.querySelector('.mr-lesson');
const press = (sheet, label, { within = sheet.root } = {}) => {
  const button = within
    .querySelectorAll('button')
    .find((b) => b.textContent === label && !b.disabled);
  expect(button, label).toBeTruthy();
  button.click();
};
const show = (sheet, unitName, tab) => {
  sheet.index = sheet.units.findIndex((u) => u.name === unitName);
  sheet.tab = tab;
  sheet.render();
};
const cardFor = (sheet, itemName) =>
  sheet.root.querySelectorAll('.mr-item-card').find((c) => c.querySelector('h4')?.textContent?.startsWith(itemName)); // prettier-ignore

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

describe('the roster lesson in the sheet', () => {
  it('opens on Withdraw with the convoy note, and marks the in-run convoy note read', () => {
    const run = forkRun();
    const hints = { markSeen: vi.fn() };
    const { sheet } = open(run, sceneFor(run, hints));
    const box = strip(sheet);
    expect(box).toBeTruthy();
    expect(box.getAttribute('aria-label')).toBe('Roster lesson');
    expect(box.dataset.step).toBe('withdraw');
    expect(box.textContent).toContain('Roster lesson · 1 of 4 · Withdraw');
    expect(box.textContent).toContain('Give Tamsin the Iron Bow from the convoy');
    expect(box.textContent).toContain('shared storage between battles');
    expect(hints.markSeen).toHaveBeenCalledWith('guide_convoy');
    // The lesson started is saved with the run (a refresh keeps its place).
    expect(run.prologueRosterLesson).toEqual({ completed: [], skipped: [], dismissed: false });
    expect(saveServiceRun).toHaveBeenCalled();
    sheet.destroy();
  });

  it("Tamsin's roster card says what her problem is and where the answer is", () => {
    const run = forkRun();
    const { sheet } = open(run);
    const card = sheet.root
      .querySelectorAll('.mr-unit-card')
      .find((c) => c.textContent.includes('Tamsin'));
    expect(card.textContent).toContain('No weapon. A bow is in the convoy.');
    sheet.destroy();
  });

  it('each step completes on the real button: Withdraw, Equip, Trade, Store', async () => {
    const run = forkRun();
    const { sheet } = open(run);
    // Withdraw: Tamsin selected, Convoy tab, the bow's Withdraw.
    show(sheet, 'Tamsin', 'convoy');
    press(sheet, 'Withdraw', { within: cardFor(sheet, 'Iron Bow') });
    const tamsin = run.roster.find((u) => u.name === 'Tamsin');
    expect(tamsin.weapon?.name).toBe('Iron Bow');
    expect(strip(sheet).dataset.step).toBe('equip');
    expect(strip(sheet).textContent).toContain('Withdraw: done.');
    expect(strip(sheet).textContent).toContain("Equip Gaspar's Iron Sword");
    // Equip: Gaspar's Iron Sword on his Equipment tab.
    show(sheet, 'Gaspar', 'gear');
    press(sheet, 'Equip', { within: cardFor(sheet, 'Iron Sword') });
    expect(strip(sheet).dataset.step).toBe('trade');
    expect(strip(sheet).textContent).toContain("Give Tamsin Edric's Vulnerary");
    // Trade: Edric's Vulnerary → Tamsin through the trade menu.
    show(sheet, 'Edric', 'gear');
    press(sheet, 'Trade…', { within: cardFor(sheet, 'Vulnerary') });
    sheet.picker.selected = tamsin;
    await sheet.picker.confirm();
    await vi.advanceTimersByTimeAsync(0);
    const row = (side) =>
      sheet.picker.surface.root.querySelectorAll('.tm-row').find((el) => el.dataset.side === side && el.dataset.index === '0'); // prettier-ignore
    row('left').click();
    row('right').click();
    expect(tamsin.consumables.map((c) => c.name)).toEqual(['Vulnerary']);
    sheet.picker.destroy?.();
    sheet.picker = null;
    sheet.render();
    expect(strip(sheet).dataset.step).toBe('store');
    // Store: Gaspar's spare (the Steel Lance now that the sword is equipped).
    show(sheet, 'Gaspar', 'gear');
    press(sheet, 'Store', { within: cardFor(sheet, 'Steel Lance') });
    expect(run.prologueRosterLesson.completed).toEqual(['withdraw', 'equip', 'trade', 'store']);
    expect(strip(sheet).textContent).toContain('Roster lesson complete.');
    // Done once: the next render (and the next sheet) has no lesson.
    sheet.render();
    expect(strip(sheet)).toBeNull();
    sheet.destroy();
    const { sheet: again } = open(run);
    expect(strip(again)).toBeNull();
    again.destroy();
  });

  it('Skip step moves on, Skip lesson ends it, and every other button keeps working', () => {
    const run = forkRun();
    const { sheet } = open(run);
    press(sheet, 'Skip step', { within: strip(sheet) });
    expect(strip(sheet).dataset.step).toBe('equip');
    expect(run.prologueRosterLesson.skipped).toEqual(['withdraw']);
    // Not a gate: the bow can still be withdrawn with the lesson on Equip.
    show(sheet, 'Tamsin', 'convoy');
    press(sheet, 'Withdraw', { within: cardFor(sheet, 'Iron Bow') });
    expect(run.roster.find((u) => u.name === 'Tamsin').weapon?.name).toBe('Iron Bow');
    press(sheet, 'Skip lesson', { within: strip(sheet) });
    expect(strip(sheet)).toBeNull();
    expect(run.prologueRosterLesson.dismissed).toBe(true);
    expect(isRosterLessonLive(run)).toBe(false);
    sheet.destroy();
  });

  it('Close leaves the lesson where it was; the next open picks it up', () => {
    const run = forkRun();
    const { sheet } = open(run);
    press(sheet, 'Skip step', { within: strip(sheet) });
    sheet.destroy();
    const { sheet: again } = open(run);
    expect(strip(again).dataset.step).toBe('equip');
    again.destroy();
  });

  it('desktop entry: the route map Roster (RosterOverlay) shows the same lesson', () => {
    const run = forkRun();
    const scene = sceneFor(run);
    const overlay = new RosterOverlay(scene, run, gameData, { onClose: vi.fn() });
    overlay.show();
    expect(overlay._mobileSheet).toBeTruthy();
    expect(strip(overlay._mobileSheet).dataset.step).toBe('withdraw');
    overlay.hide();
  });

  it('no lesson away from the fork, in a standard run, or in a read-only sheet', () => {
    const run = forkRun();
    run.currentNodeId = 'prologue_3';
    const { sheet } = open(run);
    expect(strip(sheet)).toBeNull();
    sheet.destroy();
    const standard = new RunManager(gameData, null);
    standard.startRun({ difficultyId: 'normal' });
    const { sheet: plain } = open(standard);
    expect(strip(plain)).toBeNull();
    plain.destroy();
    const fork = forkRun();
    const readOnly = new MobileRosterSheet({
      scene: sceneFor(fork),
      units: fork.roster,
      run: null,
      gameData,
      onClose: vi.fn(),
    });
    expect(strip(readOnly)).toBeNull();
    readOnly.destroy();
  });
});
