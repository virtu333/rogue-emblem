// The EXP bar in unit profiles (docs/specs/exp-bars.md §3.1): createXpBar /
// createXpRow, and the roster sheet that shows them. Ways it can fail, one test each:
// the meter's aria values disagree with unit.xp; the cap reads as a number instead of
// MAX (or extended leveling reads as MAX); an enemy or NPC gets an EXP row ("XP 0/100"
// on inspected enemies); the summary keeps "XP n/100" in its text line; the list cards
// lose their EXP line. Expected values are written out by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createXpBar, createXpRow } from '../src/ui/xpBar.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';

const data = loadGameData();
const unit = (extra = {}) => ({
  name: 'Kira',
  className: 'Myrmidon',
  tier: 'base',
  faction: 'player',
  level: 7,
  xp: 45,
  ...extra,
});
const attrs = (el) => ({
  role: el.getAttribute('role'),
  label: el.getAttribute('aria-label'),
  min: el.getAttribute('aria-valuemin'),
  max: el.getAttribute('aria-valuemax'),
  now: el.getAttribute('aria-valuenow'),
  text: el.getAttribute('aria-valuetext'),
});

describe('createXpBar / createXpRow', () => {
  beforeEach(() => installFakeDom(vi));
  afterEach(() => vi.unstubAllGlobals());

  it('a player unit: a meter at its XP out of 100, filled in proportion', () => {
    const bar = createXpBar(unit());
    expect(bar.className).toBe('re-xp');
    expect(attrs(bar)).toEqual({
      role: 'meter',
      label: 'Kira EXP',
      min: '0',
      max: '100',
      now: '45',
      text: '45 of 100 EXP',
    });
    const fill = bar.querySelector('.re-xp-fill');
    expect(fill.style.width).toBe('45%');
  });

  it('the row reads EXP, the bar, then n/100', () => {
    const row = createXpRow(unit({ xp: 0 }));
    expect(row.className).toBe('re-xp-row');
    expect(row.children.map((c) => c.className)).toEqual(['re-xp-label', 're-xp', 're-xp-value']);
    expect(row.children[0].textContent).toBe('EXP');
    expect(row.children[2].textContent).toBe('0/100');
    expect(row.children[1].getAttribute('aria-valuenow')).toBe('0');
  });

  it('at the level cap: a full muted bar that reads MAX, whatever XP is left over', () => {
    // Lv 20 with 20 XP left from the gain that reached the cap: that XP can never count.
    const capped = unit({ level: 20, xp: 20 });
    const bar = createXpBar(capped);
    expect(bar.className).toBe('re-xp is-max');
    expect(attrs(bar)).toMatchObject({ now: '100', text: 'EXP MAX, at the level cap' });
    expect(bar.querySelector('.re-xp-fill').style.width).toBe('100%');
    expect(createXpRow(capped).children[2].textContent).toBe('MAX');
    // A promoted unit at 20 too, without extended leveling.
    expect(createXpBar(unit({ tier: 'promoted', level: 20, xp: 0 })).className).toBe(
      're-xp is-max',
    );
  });

  it('extended leveling: a promoted unit at 20 keeps a normal bar', () => {
    const veteran = unit({ tier: 'promoted', level: 20, extendedLevels: 2, xp: 30 });
    const bar = createXpBar(veteran, { extendedLevelingEnabled: true });
    expect(bar.className).toBe('re-xp');
    expect(attrs(bar)).toMatchObject({ now: '30', text: '30 of 100 EXP' });
    expect(createXpRow(veteran, { extendedLevelingEnabled: true }).children[2].textContent).toBe(
      '30/100',
    );
    // A base unit at 20 is still capped with it on.
    expect(createXpBar(unit({ level: 20 }), { extendedLevelingEnabled: true }).className).toBe(
      're-xp is-max',
    );
  });

  it('enemies and NPCs show no EXP', () => {
    for (const faction of ['enemy', 'npc']) {
      expect(createXpBar(unit({ faction }))).toBeNull();
      expect(createXpRow(unit({ faction }))).toBeNull();
    }
  });
});

describe('the roster sheet’s EXP', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeDom(vi);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const sceneFor = (run = null) => ({
    gameData: data,
    runManager: run,
    events: { once: () => {}, on: () => {}, off: () => {}, emit: () => {} },
    registry: { get: () => null },
    textures: { exists: () => false },
    sys: { settings: { key: run ? 'NodeMap' : 'Battle' } },
  });
  function openSheet(units, { run = null, sceneRun = run } = {}) {
    const sheet = new MobileRosterSheet({
      scene: sceneFor(sceneRun),
      units,
      run,
      gameData: data,
      onClose: vi.fn(),
    });
    sheet.render();
    return sheet;
  }
  const summaryOf = (sheet) => sheet.root.querySelector('.mr-summary');

  it('the summary drops XP from its text line and shows the EXP row under the HP bar', () => {
    const run = new RunManager(data);
    run.startRun();
    const edric = run.roster[0];
    edric.xp = 63;
    const sheet = openSheet(run.roster, { run });
    const summary = summaryOf(sheet);
    const line = summary.querySelectorAll('p').map((p) => p.textContent);
    expect(line.some((t) => /HP \d+\/\d+$/.test(t))).toBe(true);
    expect(line.some((t) => /XP/.test(t))).toBe(false);
    const kids = summary.children.map((c) => c.className);
    expect(kids.indexOf('re-xp-row')).toBe(kids.indexOf('re-health') + 1);
    const meter = summary.querySelector('.re-xp');
    expect(meter.getAttribute('aria-valuenow')).toBe('63');
    expect(summary.querySelector('.re-xp-value').textContent).toBe('63/100');
    sheet.destroy();
  });

  it('each unit card carries a 2px EXP line under its HP bar, and says it', () => {
    const run = new RunManager(data);
    run.startRun();
    run.roster[0].xp = 12;
    const sheet = openSheet(run.roster, { run });
    const card = sheet.root.querySelector('.mr-unit-card');
    const bars = card.querySelector('.mr-unit-bars');
    expect(bars.children.map((c) => c.className)).toEqual(['re-health', 're-xp is-line']);
    const line = bars.children[1];
    expect(line.getAttribute('aria-hidden')).toBe('true');
    expect(line.getAttribute('aria-valuenow')).toBe('12');
    expect(card.getAttribute('aria-label')).toContain(', 12 of 100 EXP');
    sheet.destroy();
  });

  it('an inspected enemy or NPC has no EXP anywhere on the sheet', () => {
    const run = new RunManager(data);
    run.startRun();
    const enemy = { ...structuredClone(run.roster[0]), name: 'Brigand', faction: 'enemy' };
    const npc = { ...structuredClone(run.roster[0]), name: 'Villager', faction: 'npc' };
    const sheet = openSheet([enemy, npc]);
    for (const index of [0, 1]) {
      sheet.index = index;
      sheet.render();
      expect(sheet.root.querySelectorAll('.re-xp')).toHaveLength(0);
      expect(sheet.root.querySelectorAll('.re-xp-row')).toHaveLength(0);
      expect(summaryOf(sheet).textContent).not.toMatch(/XP|EXP/);
    }
    sheet.destroy();
  });

  it('battle inspect (no run) reads extended leveling from the scene’s run', () => {
    const run = new RunManager(data);
    run.startRun();
    const veteran = run.roster[0];
    Object.assign(veteran, { tier: 'promoted', level: 20, xp: 40 });
    // Without extended leveling: MAX.
    let sheet = openSheet([veteran], { run: null, sceneRun: run });
    expect(summaryOf(sheet).querySelector('.re-xp-value').textContent).toBe('MAX');
    sheet.destroy();
    // With it (Nightfall and Black Sun): a normal bar.
    run.difficultyModifiers = { ...run.difficultyModifiers, extendedLevelingEnabled: true };
    sheet = openSheet([veteran], { run: null, sceneRun: run });
    expect(summaryOf(sheet).querySelector('.re-xp-value').textContent).toBe('40/100');
    sheet.destroy();
  });
});
