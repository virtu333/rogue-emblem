import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { friendlySavedTime, slotCardModel, templateName } from '../src/ui/slotCardModel.js';

const gameData = loadGameData();
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

function activeSummary(extra = {}) {
  return {
    slot: 1,
    milestones: ['beatAct1'],
    valor: 1240,
    supply: 860,
    runsStarted: 5,
    runsCompleted: 4,
    hasActiveRun: true,
    actReached: 2,
    runCorrupt: false,
    savedAt: NOW - 42 * 60 * 1000,
    rosterNames: ['Edric', 'Sera', 'Bram'],
    rosterSize: 4,
    roster: [
      { name: 'Sera', className: 'Light Sage', isLord: true, tier: 'base', isCommander: false },
      { name: 'Edric', className: 'Lord', isLord: true, tier: 'base', isCommander: true },
      { name: 'Bram', className: 'Fighter', isLord: false, tier: 'base', isCommander: false },
      { name: 'Elara', className: 'Mage', isLord: false, tier: 'base', isCommander: false },
    ],
    actId: 'act2',
    actCount: 4,
    difficultyId: 'normal',
    nodeType: 'battle',
    stage: 3,
    templateId: 'river_crossing',
    battleIsBoss: false,
    battleSuspended: true,
    completedBattles: 9,
    ...extra,
  };
}

describe('friendlySavedTime', () => {
  it('reads as a relative, friendly phrase', () => {
    expect(friendlySavedTime(NOW - 20 * 1000, NOW).text).toBe('Saved just now');
    expect(friendlySavedTime(NOW - 42 * 60 * 1000, NOW).text).toBe('Saved 42 min ago');
    expect(friendlySavedTime(NOW - 5 * 3600 * 1000, NOW).text).toBe('Saved 5 h ago');
    expect(friendlySavedTime(NOW - 30 * 3600 * 1000, NOW).text).toBe('Saved yesterday');
    expect(friendlySavedTime(NOW - 4 * 86400 * 1000, NOW).text).toBe('Saved 4 days ago');
    expect(friendlySavedTime(NOW - 20 * 86400 * 1000, NOW).text).toMatch(/^Saved \S/);
    expect(friendlySavedTime(null, NOW).text).toBe('Save time unknown');
    // A clock skewed into the future never reads as negative.
    expect(friendlySavedTime(NOW + 60000, NOW).text).toBe('Saved just now');
    expect(friendlySavedTime(NOW - 42 * 60 * 1000, NOW).title).not.toBe('');
  });
});

describe('slotCardModel', () => {
  it('names the map a suspended battle waits on, the commander first', () => {
    expect(templateName(gameData.mapTemplates, 'river_crossing')).toBe('River Crossing');
    const model = slotCardModel(1, activeSummary(), { gameData, now: NOW });
    expect(model.state).toBe('battle');
    expect(model.kicker).toBe('Slot I');
    expect(model.actKicker).toBe('Act II');
    expect(model.title).toBe('Old Kingdom Roads');
    expect(model.gradeName).toBe('Iron Rain');
    expect(model.grade).toBe('act2');
    expect(model.status).toBe('Battle suspended at River Crossing');
    expect(model.commander.name).toBe('Edric');
    expect(model.commander.line).toBe('with Sera, Bram +1');
    expect(model.commander.portraitId).toMatch(/edric/);
    expect(model.thread).toEqual({ count: 4, index: 1 });
    expect(model.saved.text).toBe('Saved 42 min ago');
    expect(model.primary).toEqual({ ariaLabel: 'Select Slot 1', label: 'Resume battle' });
    expect(model.seals.filter((s) => s.lit).map((s) => s.id)).toEqual(['beatAct1']);
    // Hard/Lunatic seals appear only once earned.
    expect(model.seals.map((s) => s.id)).not.toContain('beatHard');
    expect(model.canDelete).toBe(true);
  });

  it('boss and unknown maps still read clearly', () => {
    const boss = slotCardModel(1, activeSummary({ battleIsBoss: true }), { gameData, now: NOW });
    expect(boss.status).toBe('Boss battle suspended at River Crossing');
    const unknown = slotCardModel(1, activeSummary({ templateId: 'nope' }), { gameData, now: NOW });
    expect(unknown.status).toBe('Battle suspended mid-fight');
  });

  it('a run on the route map continues; act start says where it sets out', () => {
    const route = slotCardModel(2, activeSummary({ battleSuspended: false }), {
      gameData,
      now: NOW,
    });
    expect(route.state).toBe('route');
    expect(route.status).toBe('On the road · Battle, stage 3');
    expect(route.primary.label).toBe('Continue run');
    const start = slotCardModel(
      2,
      activeSummary({ battleSuspended: false, stage: null, actId: 'act1', actReached: 1 }),
      { gameData, now: NOW },
    );
    expect(start.status).toBe('Setting out into the Border Marches');
  });

  it('between runs, fresh saves, corrupt runs and cloud conflicts', () => {
    const home = slotCardModel(2, { ...activeSummary(), hasActiveRun: false }, { gameData });
    expect([home.state, home.title, home.primary.label]).toEqual([
      'home',
      'Home Base',
      'Enter Home Base',
    ]);
    const fresh = slotCardModel(
      2,
      { ...activeSummary(), hasActiveRun: false, runsStarted: 0, runsCompleted: 0 },
      { gameData },
    );
    expect([fresh.state, fresh.primary.label]).toEqual(['fresh', 'Begin first run']);
    const corrupt = slotCardModel(2, { ...activeSummary(), runCorrupt: true }, { gameData });
    expect(corrupt.state).toBe('corrupt');
    expect(corrupt.primary.label).toBe('Enter Home Base');
    const conflict = slotCardModel(1, activeSummary(), { gameData, conflict: true });
    expect(conflict.primary.label).toBe('Choose version');
    expect(conflict.note).toMatch(/Cloud and device differ/);
  });

  it('an empty slot is an unlit candle that begins a new run', () => {
    const empty = slotCardModel(3, null, { gameData });
    expect(empty).toMatchObject({
      state: 'empty',
      title: 'An unlit candle',
      status: 'Begin a new chronicle.',
      canDelete: false,
      primary: { label: 'New run', ariaLabel: 'New run in Slot 3' },
    });
  });

  it('old saves without the presentation fields still render', () => {
    const legacy = slotCardModel(
      1,
      {
        slot: 1,
        valor: 0,
        supply: 0,
        runsStarted: 1,
        runsCompleted: 0,
        hasActiveRun: true,
        actReached: 1,
        runCorrupt: false,
        savedAt: null,
        rosterNames: ['Edric'],
        battleSuspended: false,
        completedBattles: 0,
      },
      { gameData, now: NOW },
    );
    expect(legacy.title).toBe('Border Marches');
    expect(legacy.commander).toMatchObject({ name: 'Edric', line: 'marching alone' });
    expect(legacy.commander.portraitId).toMatch(/edric/);
    expect(legacy.saved.text).toBe('Save time unknown');
    expect(legacy.seals.every((s) => !s.lit)).toBe(true);
  });
});
