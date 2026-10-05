import { describe, it, expect } from 'vitest';
import dialogue from '../data/dialogue.json';
import {
  KNOWN_WHEN_KEYS,
  buildNarrativeContext,
  evaluateWhen,
  pickPoolEntry,
  narrativeLineKey,
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
      commanderTitled: null,
      partner: null,
      difficulty: 'normal',
      runsStarted: 0,
      runsCompleted: 0,
      lastRunResult: 'none',
      lastRunAct: null,
      currentDefeatWasBoss: false,
      lastRunDefeatedBy: null,
      bossName: null,
      bossSlainCount: 0,
      bossKilledYouCount: 0,
      firstClear: false,
      linesPlayed: [],
      prologue: 'none',
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
      commanderTitled: null,
      partner: 'Cael',
      difficulty: 'lunatic',
      runsStarted: 0,
      runsCompleted: 7,
      lastRunResult: 'defeat',
      lastRunAct: null,
      currentDefeatWasBoss: false,
      lastRunDefeatedBy: 'Warchief',
      bossName: 'Warchief',
      bossSlainCount: 3,
      bossKilledYouCount: 2,
      firstClear: true,
      linesPlayed: [],
      prologue: 'none',
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
  it('exports the supported condition vocabulary', () => {
    expect([...KNOWN_WHEN_KEYS].sort()).toEqual([
      'bossKilledYouBefore',
      'bossSlainBefore',
      'commander',
      'commanderHasEpithet',
      'currentDefeatWasBoss',
      'difficulty',
      'firstClear',
      'lastRunAct',
      'lastRunDefeatedByKnown',
      'lastRunResult',
      'maxRunsStarted',
      'minRunsCompleted',
      'partner',
      'prologue',
    ]);
  });
});

describe('pools: one line per run, walked without repeats', () => {
  const line = (text, when) => ({ speaker: 'Edric', line: text, ...(when ? { when } : {}) });
  const general = Array.from({ length: 7 }, (_, i) => line(`general ${i}`));
  const lost = [
    line('lost a', { lastRunResult: 'defeat' }),
    line('lost b', { lastRunResult: 'defeat' }),
  ];
  const run = (runsStarted, extra = {}) => ({
    ...CTX,
    lastRunResult: 'none',
    runsStarted,
    ...extra,
  });

  /** Play `count` runs in order, recording each line as NodeMapScene does. */
  function playRuns(pool, count, ctxFor = (i) => run(i)) {
    const played = [];
    const picks = [];
    for (let i = 0; i < count; i++) {
      const picked = pickPoolEntry(pool, { ...ctxFor(i), linesPlayed: [...played] });
      picks.push(picked.line);
      played.push(picked.lineKey);
    }
    return { picks, played };
  }

  it('plays every general line once before any repeats, then laps in the same order', () => {
    const { picks } = playRuns(general, 14);
    expect(new Set(picks.slice(0, 7)).size).toBe(7);
    expect(picks.slice(7)).toEqual(picks.slice(0, 7));
  });

  it('the same save state gives the same line (a reload replays it)', () => {
    const { played } = playRuns(general, 3);
    const ctx = { ...run(3), linesPlayed: played };
    expect(pickPoolEntry(general, ctx)).toEqual(pickPoolEntry(general, ctx));
  });

  it('alternates contextual and general lines while the context holds', () => {
    const pool = [...general, ...lost];
    const { picks } = playRuns(pool, 14, (i) => run(i, { lastRunResult: 'defeat' }));
    picks.forEach((text, i) =>
      expect(text.startsWith(i % 2 === 0 ? 'lost' : 'general')).toBe(true),
    );
    // Both lost lines, all seven general lines.
    expect(new Set(picks.filter((t) => t.startsWith('lost'))).size).toBe(2);
    expect(new Set(picks.filter((t) => t.startsWith('general'))).size).toBe(7);
    // Out of that context the lost lines never play.
    expect(playRuns(pool, 14).picks.every((t) => t.startsWith('general'))).toBe(true);
  });

  it('a changing context never repeats a line before its set has all played', () => {
    // Partner lines join and leave the set as the partner changes run to run.
    const withSera = [line('sera a', { partner: 'Sera' }), line('sera b', { partner: 'Sera' })];
    const pool = [...general, ...lost, ...withSera];
    const contexts = [
      { lastRunResult: 'defeat', partner: 'Sera' },
      { lastRunResult: 'victory', partner: 'Voss' },
      { lastRunResult: 'defeat', partner: 'Voss' },
      { lastRunResult: 'victory', partner: 'Sera' },
      { lastRunResult: 'defeat', partner: 'Sera' },
      { lastRunResult: 'defeat', partner: 'Sera' },
    ];
    const { picks } = playRuns(pool, 12, (i) => run(i, contexts[i % contexts.length]));
    // The 4 contextual lines (2 lost, 2 Sera) play before any of them repeats.
    const contextual = picks.filter((t) => !t.startsWith('general'));
    const firstRepeat = contextual.findIndex((t, k) => contextual.indexOf(t) !== k);
    expect(firstRepeat === -1 || firstRepeat >= 4).toBe(true);
    const generalPicks = picks.filter((t) => t.startsWith('general'));
    expect(new Set(generalPicks).size).toBe(generalPicks.length);
  });

  it("the review case: a new result does not bring last run's commander line back", () => {
    const section = dialogue.actTransitions.runStartCommander;
    const ctx = {
      commander: 'Edric',
      partner: 'Sera',
      runsCompleted: 1,
      difficulty: 'normal',
      lastRunResult: 'defeat',
      runsStarted: 2,
      linesPlayed: [],
    };
    const [a] = selectDialogueEntries(section, ctx);
    const [b] = selectDialogueEntries(section, {
      ...ctx,
      runsStarted: 4,
      runsCompleted: 3,
      lastRunResult: 'victory',
      linesPlayed: [a.lineKey],
    });
    expect(b.line).not.toBe(a.line);
  });

  it('strips the entry condition, names its key and leaves the source untouched', () => {
    const picked = pickPoolEntry(lost, run(0, { lastRunResult: 'defeat' }));
    expect(picked).toEqual({
      speaker: 'Edric',
      line: expect.stringMatching(/^lost/),
      lineKey: narrativeLineKey(picked.line),
    });
    expect(lost[0].when).toEqual({ lastRunResult: 'defeat' });
  });

  it('a variant whose pool has no line for this context falls through', () => {
    const section = {
      base: [line('base')],
      variants: [{ when: { commander: 'Kira' }, pool: lost }],
    };
    expect(selectDialogueEntries(section, run(0))).toEqual([line('base')]);
    expect(selectDialogueEntries(section, run(0, { lastRunResult: 'defeat' }))[0].line).toMatch(
      /^lost/,
    );
  });

  it('matches the partner and counts runs from the save', () => {
    expect(evaluateWhen({ partner: 'Voss' }, CTX)).toBe(true);
    expect(evaluateWhen({ partner: 'Sera' }, CTX)).toBe(false);
    expect(buildNarrativeContext({ meta: { getRunsStarted: () => 12 } }).runsStarted).toBe(12);
    expect(buildNarrativeContext({ meta: { runsStarted: 3 } }).runsStarted).toBe(3);
    expect(buildNarrativeContext().runsStarted).toBe(0);
  });
});
