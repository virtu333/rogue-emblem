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
  it.each(['act3_to_finalBoss_normal'])('%s prefers history over the commander fallback', (key) => {
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
  });
  // Act I and II close on a pool per commander (run-to-run lines): the history exchanges
  // are contextual items, heard every other run while they apply, the rest general.
  it.each(['act1_to_act2', 'act2_to_act3'])(
    '%s rotates a pool per commander, history on the contextual runs',
    (key) => {
      const section = data.actTransitions[key];
      const text = (entries) => entries.map((e) => e.line).join('\n');
      for (const name of commanders) {
        const variant = section.variants.find(
          (v) => v.when.commander === name && Array.isArray(v.pool),
        );
        expect(variant, name).toBeTruthy();
        const general = variant.pool.filter((item) => !item.when).map((i) => text(i.exchange));
        const history = (when) =>
          variant.pool.filter(
            (i) => i.when && Object.entries(when).every(([k, v]) => i.when[k] === v),
          );
        expect(general.length, name).toBeGreaterThanOrEqual(2);
        expect(history({ minRunsCompleted: 5 }).length, name).toBeGreaterThan(0);
        expect(history({ lastRunResult: 'defeat' }).length, name).toBeGreaterThan(0);
        // An odd run with nothing to remember: a general exchange.
        expect(general).toContain(
          text(selectDialogueEntries(section, ctx(name, { runsStarted: 1 }))),
        );
        // An even run after a loss: a loss exchange.
        const lost = selectDialogueEntries(
          section,
          ctx(name, { runsStarted: 2, lastRunResult: 'defeat' }),
        );
        const lossTexts = history({ lastRunResult: 'defeat' }).map((i) => text(i.exchange));
        expect(lossTexts).toContain(text(lost));
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
  it.each([
    'act3_to_act4',
    'act4_to_finalBoss_lieutenant',
    'finalBoss_to_secretAct',
    'secretAct_start',
  ])('%s renders all seven commander replies through the cast adapter', (key) => {
    for (const name of commanders) {
      const lines = selectDialogueEntries(data.actTransitions[key], ctx(name));
      const adapted = adaptDialogueEntries(lines, [name, name === 'Sera' ? 'Edric' : 'Sera']);
      expect(adapted.at(-1).speaker).toBe(name);
      expect(adapted.at(-1).line).toBeTruthy();
    }
  });
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
          'roadThroughEmperor',
          'descent',
          'glassBroken',
          'fallenThisRun',
          'lastRunLordFell',
          'rungChanged',
        ]);
        for (const [key, condition] of Object.entries(value.when)) {
          expect(KNOWN_WHEN_KEYS.has(key), key).toBe(true);
          if (booleans.has(key)) expect(typeof condition, key).toBe('boolean');
          else if (
            [
              'minRunsCompleted',
              'maxRunsStarted',
              'minBossSlain',
              'minLossStreak',
              'minBestActCleared',
            ].includes(key)
          ) {
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
            if (key === 'finale') expect(['lieutenant', 'entity', 'emperor']).toContain(condition);
            if (key === 'bossRole') expect(['gate', 'finale', 'none']).toContain(condition);
            if (key === 'riteBand')
              expect(['broken', 'spoken', 'answered', 'none']).toContain(condition);
          }
        }
      }
      if (value.line) expect(value.line.length).toBeLessThan(300);
      for (const child of Object.values(value)) walk(child);
    };
    walk(data);
  });
});

describe('Dusk goes on to the Lieutenant: the words', () => {
  const dusk = { roadThroughEmperor: true, finale: 'lieutenant' };
  const firstLight = { roadThroughEmperor: false, finale: 'lieutenant' };
  const lieutenant = data.bossEncounters['The Lieutenant'];
  const textOf = (entries) => entries.map((e) => e.line).join('\n');
  // Every memory a save can bring to the meeting.
  const memories = [
    {},
    { bossKilledYouCount: 1 },
    { bossSlainCount: 1 },
    { bossKilledYouCount: 1, bossSlainCount: 1 },
  ];

  it('the ending names both losses and no longer points at the Emperor', () => {
    // Failure: Dusk's ending still says the harder road "runs to the Emperor's door", who is dead.
    for (const name of commanders) {
      for (const firstClear of [false, true]) {
        const lines = selectDialogueEntries(
          data.runComplete.victory_lieutenant,
          ctx(name, { ...dusk, firstClear, runsCompleted: 9 }),
        );
        const text = textOf(lines);
        expect(text, name).not.toMatch(/Emperor's door/);
        expect(text, name).toMatch(/emperor/);
        expect(text, name).toMatch(/lieutenant/);
        expect(text, name).toMatch(/Master and seer/);
        expect(text, name).toMatch(/darker one/);
        // The commander answers between Sera's lines (the cast adapter keeps the speaker).
        expect(
          lines.map((e) => e.speaker),
          name,
        ).toContain(name);
        // It points at the harder road without naming the rung.
        expect(text, name).not.toMatch(/Nightfall|Black Sun/);
      }
    }
  });

  it('First Light keeps its ending word for word, tease included', () => {
    // Failure: the Dusk variants win on a road that never passed the Emperor.
    for (const name of commanders)
      for (const road of [firstLight, {}]) {
        const lines = selectDialogueEntries(
          data.runComplete.victory_lieutenant,
          ctx(name, { ...road, runsCompleted: 9 }),
        );
        expect(textOf(lines), name).toMatch(/Emperor's door/);
        expect(textOf(lines), name).not.toMatch(/Master and seer/);
      }
    const first = selectDialogueEntries(
      data.runComplete.victory_lieutenant,
      ctx('Edric', { ...firstLight, firstClear: true }),
    );
    expect(textOf(first)).toMatch(/army can finally breathe/);
  });

  it('on Dusk his master is ash: no line of his claims the work is done by a living master', () => {
    // Failure: "My master's work is already done" plays on a road where the Emperor fell an act ago.
    for (const memory of memories)
      for (const section of ['preBattle', 'halfHealth', 'defeat']) {
        const lines = selectDialogueEntries(
          lieutenant[section],
          ctx('Edric', { ...dusk, ...memory }),
        );
        expect(textOf(lines), `${section} ${JSON.stringify(memory)}`).not.toMatch(
          /master's work is already done|master, the pattern/i,
        );
      }
    const defeat = selectDialogueEntries(lieutenant.defeat, ctx('Edric', dusk));
    expect(defeat.at(-1).line).toMatch(/His Majesty is ash\. His work is not\./);
    const first = selectDialogueEntries(lieutenant.preBattle, ctx('Edric', dusk));
    expect(textOf(first)).toMatch(/His Majesty is ash/);
    // His memories of having killed this army are still his: that meeting beats the road's.
    expect(
      textOf(
        selectDialogueEntries(lieutenant.defeat, ctx('Edric', { ...dusk, bossKilledYouCount: 1 })),
      ),
    ).toMatch(/I ended you once/);
  });

  it('First Light keeps his lines: the master still lives there', () => {
    // Failure: the Dusk variants replace First Light's plain meeting, half-health and defeat.
    const defeat = selectDialogueEntries(lieutenant.defeat, ctx('Edric', firstLight));
    expect(textOf(defeat)).toMatch(/My master's work is already done/);
    expect(selectDialogueEntries(lieutenant.defeat, ctx('Edric', {}))).toEqual(defeat);
    expect(textOf(selectDialogueEntries(lieutenant.preBattle, ctx('Edric', firstLight)))).toMatch(
      /I've seen every future you could reach/,
    );
    expect(
      textOf(selectDialogueEntries(lieutenant.preBattle, ctx('Edric', firstLight))),
    ).not.toMatch(/His Majesty/);
  });

  it('his Dusk opening still says "every future", the line the commanders answer', () => {
    // Failure: Kira answers "Every future?" to a Lieutenant who no longer said it.
    const opening = selectDialogueEntries(lieutenant.preBattle, ctx('Kira', dusk));
    expect(textOf(opening)).toMatch(/every future/);
    expect(selectDialogueEntries(lieutenant.preBattleReply, ctx('Kira', dusk))[0].line).toMatch(
      /^Every future\?/,
    );
  });

  it('the new transition closes Act IV on the emperor and sends the army down after the seer', () => {
    // Failure: the Act IV close is lost (nothing ends at the Emperor now), or the descent reads as
    // the Entity's waking.
    for (const name of commanders) {
      const lines = selectDialogueEntries(
        data.actTransitions.act4_to_finalBoss_lieutenant,
        ctx(name),
      );
      const text = textOf(lines);
      expect(text, name).toMatch(/emperor is defeated/);
      expect(text, name).toMatch(/turns over/);
      expect(text, name).toMatch(/His sight is back against mine/);
      expect(text, name).toMatch(/went down to where the rite is spoken/);
      expect(lines.at(-1).speaker, name).toBe(name);
    }
    expect(
      textOf(selectDialogueEntries(data.actTransitions.act4_to_finalBoss_lieutenant, {})),
    ).toMatch(/emperor is defeated/);
  });

  it('victory_emperor stays intact for the saves that still end at him', () => {
    expect(data.runComplete.victory_emperor.base[0].line).toMatch(/The emperor is defeated\./);
    expect(data.runComplete.victory_emperor.variants).toHaveLength(7);
  });

  it('every line these roads add is one short line with no double quotes', () => {
    // Failure: a new line breaks the lore style guide's spoken-line limits (90 characters).
    const added = [];
    const collect = (entries) => {
      for (const e of entries) added.push(e.line);
    };
    const road = (when) =>
      Object.keys(when || {}).some((key) => key === 'roadThroughEmperor' || key === 'finale');
    for (const variant of data.actTransitions.act4_to_finalBoss_lieutenant.variants)
      collect(variant.entries);
    collect(data.actTransitions.act4_to_finalBoss_lieutenant.base);
    // The vision's variant repeats the base's first three lines: only its last is new.
    collect(lieutenant.vision.variants[0].entries.slice(3));
    for (const section of [
      lieutenant.preBattle,
      lieutenant.halfHealth,
      lieutenant.defeat,
      data.runComplete.victory_lieutenant,
    ])
      for (const variant of section.variants)
        if (road(variant.when) && variant.when.roadThroughEmperor !== false)
          collect(variant.entries);
    for (const poolVariant of lieutenant.preBattleExchange.variants)
      for (const entry of poolVariant.pool)
        if (road(entry.when)) for (const line of entry.exchange) added.push(line.line);
    expect(added.length).toBeGreaterThanOrEqual(30);
    for (const line of added) {
      expect(line.length, line).toBeLessThanOrEqual(90);
      expect(line).not.toMatch(/["\n]/);
    }
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
