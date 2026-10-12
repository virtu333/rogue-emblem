import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  buildNarrativeContext,
  evaluateWhen,
  selectDialogueEntries,
} from '../src/engine/NarrativeDirector.js';
import { compactNarrativeSeen, pickFresh } from '../src/utils/pickFresh.js';
import { narrativeLineKey } from '../src/utils/lineKey.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const store = {};
vi.stubGlobal('localStorage', {
  getItem: (key) => store[key] ?? null,
  setItem: (key, value) => {
    store[key] = value;
  },
  removeItem: (key) => {
    delete store[key];
  },
});

const KEY = 'narrative_history_test_meta';
const freshMeta = () => new MetaProgressionManager(gameData.metaUpgrades, KEY);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('the save remembers run history for lines', () => {
  it('counts defeats in a row, resets on a victory, and keeps it across a reload', () => {
    const meta = freshMeta();
    meta.recordRunEnd({ result: 'defeat', act: 'act1' });
    meta.recordRunEnd({ result: 'defeat', act: 'act2' });
    expect(freshMeta().getStoryFlags().lossStreak).toBe(2);
    meta.recordRunEnd({ result: 'victory', act: 'act3' });
    expect(freshMeta().getStoryFlags().lossStreak).toBe(0);
  });

  it('records which lords fell on the last run, and only the last run', () => {
    const meta = freshMeta();
    meta.recordRunEnd({ result: 'defeat', lordFalls: ['Kira', 'Kira', 7] });
    expect(freshMeta().getStoryFlags().lastRun.lordsFell).toEqual(['Kira']);
    meta.recordRunEnd({ result: 'defeat' });
    expect(freshMeta().getStoryFlags().lastRun.lordsFell).toEqual([]);
  });

  it('stores the barks bags compactly (line keys) and drops anything malformed', () => {
    const meta = freshMeta();
    meta.recordRunEnd({
      result: 'defeat',
      narrativeSeen: compactNarrativeSeen({
        'quip:onKill:Edric': { cycle: 1, seen: ['One step closer.', 'Rest now.'] },
        bad: 'nope',
      }),
    });
    const bags = freshMeta().getNarrativeSeen();
    expect(bags).toEqual({
      'quip:onKill:Edric': {
        cycle: 1,
        seen: [narrativeLineKey('One step closer.'), narrativeLineKey('Rest now.')],
      },
    });
    // A save carrying junk loads as no memory, never throws.
    store[KEY] = JSON.stringify({ storyFlags: { narrativeSeen: [1], lossStreak: 'x' } });
    expect(freshMeta().getNarrativeSeen()).toEqual({});
    expect(freshMeta().getStoryFlags().lossStreak).toBe(0);
  });
});

describe('barks walk their whole pool across runs', () => {
  const pool = ['a line', 'b line', 'c line', 'd line', 'e line'];

  it('a bag carried out of one run keeps walking in the next (no repeat until the pool is spent)', () => {
    const runA = {};
    const first = [0, 1, 2].map(() => pickFresh(pool, 'quip', runA, 11));
    const carried = compactNarrativeSeen(runA); // what the save keeps
    const runB = structuredClone(carried);
    const second = [0, 1].map(() => pickFresh(pool, 'quip', runB, 99)); // another run seed
    expect(new Set([...first, ...second]).size).toBe(5);
  });

  it('without the carry, a new run could repeat a line the last run used (the old behaviour)', () => {
    const repeats = [];
    for (let seed = 0; seed < 50; seed++) {
      const runA = {};
      const first = [0, 1, 2].map(() => pickFresh(pool, 'quip', runA, seed));
      const runB = {};
      const second = [0, 1].map(() => pickFresh(pool, 'quip', runB, seed + 1000));
      if (second.some((line) => first.includes(line))) repeats.push(seed);
    }
    expect(repeats.length).toBeGreaterThan(0);
  });

  it('RunManager.startRun takes the save’s bags and pickNarrativeLine continues them', () => {
    const run = new RunManager(gameData, null);
    const seenKeys = pool.slice(0, 4).map(narrativeLineKey);
    run.startRun({
      runSeed: 5,
      applyBlessingsAtStart: false,
      narrativeSeen: { 'node:act1:battle': { cycle: 0, seen: seenKeys } },
    });
    expect(run.pickNarrativeLine(pool, 'node:act1:battle')).toBe('e line');
    // The next pick starts a new cycle over the whole pool.
    expect(pool).toContain(run.pickNarrativeLine(pool, 'node:act1:battle'));
    expect(run.narrativeSeen['node:act1:battle'].cycle).toBe(1);
  });

  it('a run with no carried bags starts empty, as before', () => {
    const run = new RunManager(gameData, null);
    run.startRun({ runSeed: 5, applyBlessingsAtStart: false });
    expect(run.narrativeSeen).toEqual({});
  });

  it('a run save from before (bags holding whole lines) still reads', () => {
    const state = { k: { cycle: 0, seen: ['a line', 'b line', 'c line', 'd line'] } };
    expect(pickFresh(pool, 'k', state, 3)).toBe('e line');
  });
});

describe('history conditions and tokens', () => {
  const metaWith = (flags, milestones = []) => ({
    getStoryFlags: () => flags,
    hasMilestone: (id) => milestones.includes(id),
    getBossSlainCount: (name) => (name === 'Warchief' ? 3 : 0),
    getDefeatedByCount: () => 0,
  });

  it('minLossStreak reads the save’s streak', () => {
    const ctx = buildNarrativeContext({ meta: metaWith({ lossStreak: 3 }) });
    expect(evaluateWhen({ minLossStreak: 3 }, ctx)).toBe(true);
    expect(evaluateWhen({ minLossStreak: 4 }, ctx)).toBe(false);
    expect(evaluateWhen({ minLossStreak: 1 }, buildNarrativeContext())).toBe(false);
  });

  it('fallenThisRun and {fallen} name the latest unit lost, laid to rest included', () => {
    const runManager = {
      fallenUnits: [{ name: 'Galvin' }],
      laidToRest: [{ name: 'Bjorn' }],
    };
    const ctx = buildNarrativeContext({ runManager });
    expect(evaluateWhen({ fallenThisRun: true }, ctx)).toBe(true);
    const [entry] = selectDialogueEntries([{ speaker: 'Sera', line: 'For {fallen}.' }], ctx);
    expect(entry.line).toBe('For Bjorn.');
    expect(evaluateWhen({ fallenThisRun: true }, buildNarrativeContext({ runManager: {} }))).toBe(
      false,
    );
  });

  it('lastRunLordFell and {lastFallenLord} read the last finished run', () => {
    const ctx = buildNarrativeContext({
      meta: metaWith({ lastRun: { result: 'defeat', lordsFell: ['Voss'] } }),
    });
    expect(evaluateWhen({ lastRunLordFell: true }, ctx)).toBe(true);
    const [entry] = selectDialogueEntries([{ speaker: 'Sera', line: '{lastFallenLord}.' }], ctx);
    expect(entry.line).toBe('Voss.');
    const none = buildNarrativeContext({ meta: metaWith({ lastRun: { result: 'defeat' } }) });
    expect(evaluateWhen({ lastRunLordFell: false }, none)).toBe(true);
  });

  it('rungChanged is true only when a last run exists on another difficulty', () => {
    const meta = metaWith({ lastRun: { result: 'victory', difficultyId: 'normal' } });
    const same = buildNarrativeContext({ meta, runManager: { difficultyId: 'normal' } });
    const moved = buildNarrativeContext({ meta, runManager: { difficultyId: 'dusk' } });
    expect(evaluateWhen({ rungChanged: true }, same)).toBe(false);
    expect(evaluateWhen({ rungChanged: true }, moved)).toBe(true);
    expect(evaluateWhen({ rungChanged: true }, buildNarrativeContext())).toBe(false);
  });

  it('minBestActCleared reads the milestones', () => {
    const ctx = buildNarrativeContext({ meta: metaWith({}, ['beatAct1', 'beatAct2']) });
    expect(evaluateWhen({ minBestActCleared: 2 }, ctx)).toBe(true);
    expect(evaluateWhen({ minBestActCleared: 3 }, ctx)).toBe(false);
  });

  it('minBossSlain counts the scene’s boss', () => {
    const meta = metaWith({});
    const ctx = buildNarrativeContext({ meta, bossName: 'Warchief' });
    expect(evaluateWhen({ minBossSlain: 3 }, ctx)).toBe(true);
    expect(evaluateWhen({ minBossSlain: 4 }, ctx)).toBe(false);
    const other = buildNarrativeContext({ meta, bossName: 'Iron Captain' });
    expect(evaluateWhen({ minBossSlain: 1 }, other)).toBe(false);
  });
});
