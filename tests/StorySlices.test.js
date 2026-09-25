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
    const section = data.runComplete.victory_normal;
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
  it.each(['act3_to_act4', 'act4_to_finalBoss', 'finalBoss_to_secretAct', 'secretAct_start'])(
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
    for (const boss of Object.values(data.bossEncounters))
      for (const name of commanders) {
        expect(selectDialogueEntries(boss.preBattleReply, ctx(name))?.[0]?.speaker).toBe(name);
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
          'firstClear',
          'commanderHasEpithet',
        ]);
        for (const [key, condition] of Object.entries(value.when)) {
          expect(KNOWN_WHEN_KEYS.has(key), key).toBe(true);
          if (booleans.has(key)) expect(typeof condition, key).toBe('boolean');
          else if (key === 'minRunsCompleted') {
            expect(Number.isInteger(condition)).toBe(true);
            expect(condition).toBeGreaterThanOrEqual(0);
          } else {
            expect(typeof condition, key).toBe('string');
            expect(condition.length, key).toBeGreaterThan(0);
            if (key === 'commander') expect(commanders).toContain(condition);
            if (key === 'difficulty') expect(['normal', 'hard', 'lunatic']).toContain(condition);
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
