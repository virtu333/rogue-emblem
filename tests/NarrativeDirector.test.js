import { describe, it, expect } from 'vitest';
import {
  KNOWN_WHEN_KEYS,
  buildNarrativeContext,
  evaluateWhen,
  selectDialogueEntries,
} from '../src/engine/NarrativeDirector.js';

const CTX = Object.freeze({
  commander: 'Kira',
  partner: 'Voss',
  difficulty: 'hard',
  runsCompleted: 5,
  lastRunResult: 'defeat',
  lastRunDefeatedBy: 'Iron Captain',
  bossName: 'Iron Captain',
  bossSlainCount: 2,
  bossKilledYouCount: 1,
  firstClear: false,
});

describe('evaluateWhen', () => {
  it('matches each known condition key', () => {
    expect(evaluateWhen({ commander: 'Kira' }, CTX)).toBe(true);
    expect(evaluateWhen({ commander: 'Edric' }, CTX)).toBe(false);
    expect(evaluateWhen({ difficulty: 'hard' }, CTX)).toBe(true);
    expect(evaluateWhen({ difficulty: 'lunatic' }, CTX)).toBe(false);
    expect(evaluateWhen({ minRunsCompleted: 5 }, CTX)).toBe(true);
    expect(evaluateWhen({ minRunsCompleted: 6 }, CTX)).toBe(false);
    expect(evaluateWhen({ lastRunResult: 'defeat' }, CTX)).toBe(true);
    expect(evaluateWhen({ lastRunResult: 'victory' }, CTX)).toBe(false);
    expect(evaluateWhen({ lastRunDefeatedByKnown: true }, CTX)).toBe(true);
    expect(evaluateWhen({ lastRunDefeatedByKnown: false }, CTX)).toBe(false);
    expect(evaluateWhen({ bossSlainBefore: true }, CTX)).toBe(true);
    expect(evaluateWhen({ bossSlainBefore: false }, CTX)).toBe(false);
    expect(evaluateWhen({ bossKilledYouBefore: true }, CTX)).toBe(true);
    expect(evaluateWhen({ firstClear: false }, CTX)).toBe(true);
    expect(evaluateWhen({ firstClear: true }, CTX)).toBe(false);
  });

  it('ANDs multiple conditions together', () => {
    expect(evaluateWhen({ commander: 'Kira', lastRunResult: 'defeat' }, CTX)).toBe(true);
    expect(evaluateWhen({ commander: 'Kira', lastRunResult: 'victory' }, CTX)).toBe(false);
  });

  it('fails on unknown condition keys (forward compatibility)', () => {
    expect(evaluateWhen({ someFutureCondition: true }, CTX)).toBe(false);
    expect(evaluateWhen({ commander: 'Kira', someFutureCondition: true }, CTX)).toBe(false);
  });

  it('fails on garbage input without throwing', () => {
    expect(evaluateWhen(null, CTX)).toBe(false);
    expect(evaluateWhen('commander', CTX)).toBe(false);
    expect(evaluateWhen(['commander'], CTX)).toBe(false);
    expect(evaluateWhen({ commander: 'Kira' }, null)).toBe(false);
    expect(evaluateWhen({ minRunsCompleted: 'five' }, CTX)).toBe(false);
  });

  it('empty when matches (unconditional variant)', () => {
    expect(evaluateWhen({}, CTX)).toBe(true);
  });
});

describe('selectDialogueEntries', () => {
  const base = [{ speaker: 'Sera', line: 'Base line.' }];
  const kiraEntries = [{ speaker: 'Kira', line: 'Kira line.' }];
  const defeatEntries = [{ speaker: 'Sera', line: 'Defeat line.' }];

  it('passes plain arrays through (backward compatibility)', () => {
    expect(selectDialogueEntries(base, CTX)).toEqual(base);
  });

  it('falls back to base when no variant matches', () => {
    const value = { base, variants: [{ when: { commander: 'Edric' }, entries: kiraEntries }] };
    expect(selectDialogueEntries(value, CTX)).toEqual(base);
  });

  it('picks the first matching variant top-down', () => {
    const value = {
      base,
      variants: [
        { when: { lastRunResult: 'defeat' }, entries: defeatEntries },
        { when: { commander: 'Kira' }, entries: kiraEntries },
      ],
    };
    expect(selectDialogueEntries(value, CTX)).toEqual(defeatEntries);
  });

  it('skips malformed and empty variants', () => {
    const value = {
      base,
      variants: [
        null,
        { when: { commander: 'Kira' } }, // no entries
        { when: { commander: 'Kira' }, entries: [] }, // empty entries
        { when: { commander: 'Kira' }, entries: kiraEntries },
      ],
    };
    expect(selectDialogueEntries(value, CTX)).toEqual(kiraEntries);
  });

  it('returns null for malformed section values', () => {
    expect(selectDialogueEntries(null, CTX)).toBeNull();
    expect(selectDialogueEntries('lines', CTX)).toBeNull();
    expect(selectDialogueEntries(42, CTX)).toBeNull();
    expect(selectDialogueEntries({}, CTX)).toBeNull();
    expect(selectDialogueEntries({ variants: [] }, CTX)).toBeNull();
  });

  it('substitutes {lastFoe} without mutating source entries', () => {
    const src = [{ speaker: 'Sera', line: 'I saw {lastFoe} strike you down.' }];
    const out = selectDialogueEntries(src, CTX);
    expect(out[0].line).toBe('I saw Iron Captain strike you down.');
    expect(src[0].line).toBe('I saw {lastFoe} strike you down.');
  });

  it('falls back to generic text when {lastFoe} is unknown', () => {
    const src = [{ line: '{lastFoe} waits ahead.' }];
    const out = selectDialogueEntries(src, { ...CTX, lastRunDefeatedBy: null });
    expect(out[0].line).toBe('the enemy waits ahead.');
  });
});

describe('buildNarrativeContext', () => {
  it('returns safe defaults with no sources at all', () => {
    const ctx = buildNarrativeContext();
    expect(ctx).toEqual({
      commander: null,
      partner: null,
      difficulty: 'normal',
      runsCompleted: 0,
      lastRunResult: 'none',
      lastRunDefeatedBy: null,
      bossName: null,
      bossSlainCount: 0,
      bossKilledYouCount: 0,
      firstClear: false,
    });
  });

  it('returns safe defaults when meta and runManager are null', () => {
    const ctx = buildNarrativeContext({ meta: null, runManager: null, bossName: 'Warchief' });
    expect(ctx.commander).toBeNull();
    expect(ctx.bossName).toBe('Warchief');
    expect(ctx.bossSlainCount).toBe(0);
    expect(ctx.bossKilledYouCount).toBe(0);
  });

  it('reads meta story flags and run manager state', () => {
    const meta = {
      runsCompleted: 7,
      getStoryFlags: () => ({
        lastRun: { result: 'defeat', defeatedBy: 'Warchief' },
      }),
      getBossSlainCount: (name) => (name === 'Warchief' ? 3 : 0),
      getDefeatedByCount: (name) => (name === 'Warchief' ? 2 : 0),
    };
    const runManager = {
      difficultyId: 'lunatic',
      getStartingLordNames: () => ['Astrid', 'Cael'],
      endRunRewards: { firstClear: true },
    };
    const ctx = buildNarrativeContext({ meta, runManager, bossName: 'Warchief' });
    expect(ctx).toEqual({
      commander: 'Astrid',
      partner: 'Cael',
      difficulty: 'lunatic',
      runsCompleted: 7,
      lastRunResult: 'defeat',
      lastRunDefeatedBy: 'Warchief',
      bossName: 'Warchief',
      bossSlainCount: 3,
      bossKilledYouCount: 2,
      firstClear: true,
    });
  });

  it('tolerates a throwing runManager', () => {
    const runManager = {
      getStartingLordNames: () => {
        throw new Error('boom');
      },
    };
    const ctx = buildNarrativeContext({ runManager });
    expect(ctx.commander).toBeNull();
  });
});

describe('KNOWN_WHEN_KEYS', () => {
  it('exports the v1 condition vocabulary', () => {
    expect([...KNOWN_WHEN_KEYS].sort()).toEqual([
      'bossKilledYouBefore',
      'bossSlainBefore',
      'commander',
      'difficulty',
      'firstClear',
      'lastRunDefeatedByKnown',
      'lastRunResult',
      'minRunsCompleted',
    ]);
  });
});
