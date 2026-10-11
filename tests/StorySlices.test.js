import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildNarrativeContext,
  selectDialogueEntries,
  KNOWN_WHEN_KEYS,
} from '../src/engine/NarrativeDirector.js';
import { adaptDialogueEntries } from '../src/engine/DialogueCast.js';
const data = JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8'));
const commanders = ['Edric', 'Kira', 'Voss', 'Sera', 'Rowan', 'Astrid', 'Cael'];
const ctx = (commander, overrides = {}) => ({
  commander,
  runsCompleted: 0,
  lastRunResult: 'none',
  lastRunDefeatedBy: null,
  lastRunAct: null,
  currentDefeatWasBoss: false,
  ...overrides,
});
describe('story slice selection contracts', () => {
  it('preserves the first-clear beat even after many failed runs', () => {
    const section = data.runComplete.victory_lieutenant;
    const firstClear = section.variants.find((v) => v.when.firstClear === true);
    for (const commander of commanders) {
      expect(
        selectDialogueEntries(section, ctx(commander, { runsCompleted: 9, firstClear: true })),
      ).toEqual(firstClear.entries);
      expect(
        selectDialogueEntries(section, ctx(commander, { runsCompleted: 9, firstClear: false })),
      ).not.toEqual(firstClear.entries);
    }
  });
  it.each(['act1_to_act2', 'act2_to_act3', 'act3_to_finalBoss_normal'])(
    '%s prefers history over the commander fallback',
    (key) => {
      const section = data.actTransitions[key];
      for (const name of commanders) {
        const plain = section.variants.find(
          (v) => v.when.commander === name && Object.keys(v.when).length === 1,
        );
        expect(selectDialogueEntries(section, ctx(name))).toEqual(plain.entries);
        const veteran = selectDialogueEntries(section, ctx(name, { runsCompleted: 5 }));
        const defeat = selectDialogueEntries(section, ctx(name, { lastRunResult: 'defeat' }));
        expect(veteran).not.toEqual(plain.entries);
        expect(defeat).not.toEqual(plain.entries);
        expect(
          selectDialogueEntries(section, ctx(name, { runsCompleted: 5, lastRunResult: 'defeat' })),
        ).toEqual(veteran);
      }
    },
  );
  it('uses settled defeat context and substitutes a known boss without leaking tokens', () => {
    const context = buildNarrativeContext({
      meta: {
        getStoryFlags: () => ({
          lastRun: { result: 'defeat', act: 'act1', defeatedBy: 'Iron Captain' },
        }),
      },
      runManager: {
        getStartingLordNames: () => ['Kira', 'Sera'],
        defeatContext: { wasBoss: true },
      },
    });
    const lines = selectDialogueEntries(data.runComplete.defeat, context);
    expect(lines[0].line).toContain('Iron Captain');
    expect(lines[1].line).toContain('commander');
    expect(JSON.stringify(lines)).not.toContain('{lastFoe}');
    const generic = selectDialogueEntries(data.runComplete.defeat, {
      ...context,
      currentDefeatWasBoss: false,
    });
    expect(generic).not.toEqual(lines);
  });
  it.each(commanders)('distinguishes early and late unknown losses for %s', (name) => {
    const early = selectDialogueEntries(data.runComplete.defeat, ctx(name, { lastRunAct: 'act1' }));
    const late = selectDialogueEntries(data.runComplete.defeat, ctx(name, { lastRunAct: 'act3' }));
    expect(early).not.toEqual(late);
    expect(JSON.stringify([...early, ...late])).not.toContain('{lastFoe}');
    expect(selectDialogueEntries(data.runComplete.defeat, ctx(name))).toBeTruthy();
  });
  it.each(['act3_to_act4', 'finalBoss_to_secretAct', 'secretAct_start'])(
    '%s renders all seven commander replies through the cast adapter',
    (key) => {
      for (const name of commanders) {
        const lines = selectDialogueEntries(data.actTransitions[key], ctx(name));
        const adapted = adaptDialogueEntries(lines, [name, name === 'Sera' ? 'Edric' : 'Sera']);
        expect(adapted.at(-1).speaker).toBe(name);
        expect(adapted.at(-1).line).toBeTruthy();
      }
    },
  );
  it('every boss supplies a reply for every commander', () => {
    // The prologue's own boss (Varro) only ever meets Edric: his reply is in his preBattle.
    const prologueBoss = JSON.parse(readFileSync('data/prologue.json', 'utf8')).boss?.name;
    for (const [bossName, boss] of Object.entries(data.bossEncounters)) {
      if (bossName === prologueBoss) {
        expect(boss.preBattle.base.at(-1).speaker).toBe('Edric');
        continue;
      }
      for (const name of commanders) {
        expect(selectDialogueEntries(boss.preBattleReply, ctx(name))?.[0]?.speaker).toBe(name);
      }
    }
  });
  it('all dialogue variants use supported conditions and keep lines readable', () => {
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      if (value.when) {
        expect(Array.isArray(value.when)).toBe(false);
        const booleans = new Set([
          'lastRunDefeatedByKnown',
          'currentDefeatWasBoss',
          'bossSlainBefore',
          'bossKilledYouBefore',
          'bossMetBefore',
          'firstClear',
          'commanderHasEpithet',
        ]);
        for (const [key, condition] of Object.entries(value.when)) {
          expect(KNOWN_WHEN_KEYS.has(key), key).toBe(true);
          if (booleans.has(key)) expect(typeof condition, key).toBe('boolean');
          else if (key === 'minRunsCompleted' || key === 'maxRunsStarted') {
            expect(Number.isInteger(condition)).toBe(true);
            expect(condition).toBeGreaterThanOrEqual(0);
          } else if (key === 'prologue') {
            // One state or any of several ('none' | 'skipped' | 'complete').
            const states = Array.isArray(condition) ? condition : [condition];
            expect(states.length, key).toBeGreaterThan(0);
            for (const state of states) expect(['none', 'skipped', 'complete']).toContain(state);
          } else {
            expect(typeof condition, key).toBe('string');
            expect(condition.length, key).toBeGreaterThan(0);
            if (key === 'commander' || key === 'partner') expect(commanders).toContain(condition);
            if (key === 'difficulty')
              expect(['normal', 'dusk', 'hard', 'lunatic']).toContain(condition);
            if (key === 'lastRunResult') expect(['none', 'victory', 'defeat']).toContain(condition);
          }
        }
      }
      if (value.line) expect(value.line.length).toBeLessThan(300);
      for (const child of Object.values(value)) walk(child);
    };
    walk(data);
  });
});

describe("Edric's run-start lines", () => {
  const section = data.actTransitions.runStartCommander;
  const pool = section.variants.find((v) => v.when.commander === 'Edric' && v.pool).pool;
  const edric = (runsStarted, overrides = {}) =>
    selectDialogueEntries(section, ctx('Edric', { partner: 'Sera', runsStarted, ...overrides }));
  /** Runs in a row, each remembering what the save has heard, as NodeMapScene records it. */
  const edricRuns = (from, count, overrides = {}) => {
    const heard = [];
    return Array.from({ length: count }, (_, i) => {
      const [entry] = edric(from + i, { ...overrides, linesPlayed: [...heard] });
      if (entry.lineKey) heard.push(entry.lineKey);
      return entry;
    });
  };

  it('the first run keeps its opening line; later runs draw from the pool', () => {
    const first = edric(1)[0].line;
    expect(first).toBe(
      'Then the banner goes forward. Rally to me \u2014 we finish this march together.',
    );
    const later = edric(2, { lastRunResult: 'defeat' })[0].line;
    expect(pool.map((e) => e.line)).toContain(later);
  });

  it('many lines, each short, plain and spoken by Edric', () => {
    const general = pool.filter((e) => !e.when);
    expect(general.length).toBeGreaterThanOrEqual(40);
    expect(new Set(pool.map((e) => e.line)).size).toBe(pool.length);
    for (const entry of pool) {
      expect(entry.speaker).toBe('Edric');
      expect(entry.portrait).toBe('portrait_lord_edric');
      expect(entry.line.replace('{lastFoe}', 'Knight Commander').length).toBeLessThanOrEqual(90);
      expect(entry.line).not.toContain('"');
      // A line names a lord only when that lord is the partner beside him.
      for (const name of commanders.filter((n) => n !== 'Edric'))
        if (entry.line.includes(name)) expect(entry.when?.partner).toBe(name);
    }
  });

  it('a string of lost runs hears a new line every run for dozens of runs', () => {
    const lines = [];
    for (const picked of edricRuns(2, 40, { lastRunResult: 'defeat' })) {
      const [entry] = adaptDialogueEntries([picked], ['Edric', 'Sera']);
      expect(entry.speaker).toBe('Edric');
      expect(entry.line).not.toMatch(/[{}]/);
      lines.push(entry.line);
    }
    // No line twice in a row, and at least 30 different lines across 40 runs.
    lines.forEach((line, i) => i && expect(line).not.toBe(lines[i - 1]));
    expect(new Set(lines).size).toBeGreaterThanOrEqual(30);
  });

  it('context lines play only in their context', () => {
    const lines = (overrides) => new Set(edricRuns(2, 60, overrides).map((e) => e.line));
    const lunatic = pool.filter((e) => e.when?.difficulty === 'lunatic').map((e) => e.line);
    const onLunatic = lines({ lastRunResult: 'victory', difficulty: 'lunatic' });
    expect(lunatic.every((l) => onLunatic.has(l))).toBe(true);
    const onNormal = lines({ lastRunResult: 'victory', difficulty: 'normal' });
    expect(lunatic.some((l) => onNormal.has(l))).toBe(false);
    const known = pool.filter((e) => e.when?.lastRunDefeatedByKnown).map((e) => e.line);
    const unknownLoss = lines({ lastRunResult: 'defeat', lastRunDefeatedBy: null });
    expect(known.some((l) => unknownLoss.has(l))).toBe(false);
    const withKira = lines({ lastRunResult: 'victory', partner: 'Kira' });
    expect([...withKira].some((l) => l.includes('Sera'))).toBe(false);
    expect([...withKira].some((l) => l.includes('Kira'))).toBe(true);
  });
});
