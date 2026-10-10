// Boss rematch exchanges (dialogue.json bossEncounters.<boss>.preBattleExchange): once a
// save has met a boss (slain it, or fallen to it), a run Edric commands opens that boss
// fight on one exchange from a pool: the boss's line and Edric's answer, picked as one
// and walked across runs by what the save has heard (NarrativeDirector pools). Some
// exchanges are for a rung (Dusk, Nightfall, Black Sun), some remember the last
// meeting. A first meeting, or another commander, keeps the boss's preBattle line and
// that commander's reply.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { selectDialogueEntries, narrativeLineKey } from '../src/engine/NarrativeDirector.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';
import { BattleScene } from '../src/scenes/BattleScene.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const dialogue = read('../data/dialogue.json');
const enemies = read('../data/enemies.json');
const difficulty = read('../data/difficulty.json');
const prologueBoss = read('../data/prologue.json').boss?.name;

const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];
const bosses = Object.entries(dialogue.bossEncounters).filter(([name]) => name !== prologueBoss);

/** The rungs a boss is fought on, read from the acts each rung includes and the boss's filter. */
function rungsFor(name) {
  return RUNGS.filter((rung) =>
    difficulty.modes[rung].actsIncluded.some((act) =>
      (enemies.bosses[act] || []).some(
        (b) =>
          b.name === name &&
          (!Array.isArray(b.difficultyFilter) || b.difficultyFilter.includes(rung)),
      ),
    ),
  );
}

function rematchPool(boss) {
  const variants = boss.preBattleExchange?.variants || [];
  return variants.find((v) => v.when?.commander === 'Edric' && v.when?.bossMetBefore === true)
    ?.pool;
}

describe('the rematch exchanges in dialogue.json', () => {
  it('every boss but the prologue’s has a pool for Edric, gated on having met it', () => {
    expect(bosses.length).toBeGreaterThanOrEqual(11);
    for (const [name, boss] of bosses) {
      const variants = boss.preBattleExchange?.variants;
      expect(variants, name).toHaveLength(1);
      expect(variants[0].when, name).toEqual({ commander: 'Edric', bossMetBefore: true });
      expect(rematchPool(boss)?.length, name).toBeGreaterThanOrEqual(8);
    }
    expect(dialogue.bossEncounters[prologueBoss].preBattleExchange).toBeUndefined();
  });

  it('each exchange is the boss (or its silence) and then Edric’s answer', () => {
    for (const [name, boss] of bosses) {
      const voice = boss.preBattle.base[0];
      for (const { exchange } of rematchPool(boss)) {
        const [opening, ...rest] = exchange;
        const answer = rest.at(-1);
        expect(opening.speaker, name).toBe(voice.speaker);
        expect(opening.portrait, name).toBe(voice.portrait);
        if (name === 'The Entity') expect(opening.line).toBe('...');
        expect(answer, `${name}: ${opening.line}`).toMatchObject({
          speaker: 'Edric',
          portrait: 'portrait_lord_edric',
        });
        // Between them, at most Sera's sense of the Entity.
        for (const middle of rest.slice(0, -1)) expect(middle.speaker).toBe('Sera');
      }
    }
  });

  it('every line is one short line with no double quotes, and none repeats', () => {
    const seen = new Set();
    for (const [name, boss] of bosses) {
      for (const { exchange } of rematchPool(boss)) {
        for (const { line } of exchange) {
          expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(100);
          expect(line).not.toMatch(/["\n]/);
          if (line === '...') continue;
          expect(seen.has(line), `repeated: ${line}`).toBe(false);
          seen.add(line);
        }
      }
    }
  });

  it('general exchanges, both kinds of memory, and a line for each rung the boss is fought on', () => {
    for (const [name, boss] of bosses) {
      const pool = rematchPool(boss);
      const keys = (e) => Object.keys(e.when || {});
      expect(pool.filter((e) => !e.when).length, name).toBeGreaterThanOrEqual(3);
      expect(
        pool.some((e) => e.when?.bossKilledYouBefore === true),
        name,
      ).toBe(true);
      expect(
        pool.some((e) => e.when?.bossSlainBefore === true),
        name,
      ).toBe(true);
      for (const e of pool) {
        expect(keys(e).length, name).toBeLessThanOrEqual(1);
        if (e.when?.difficulty) expect(rungsFor(name), name).toContain(e.when.difficulty);
      }
      const rungs = rungsFor(name);
      const harder = rungs.filter((r) => r !== 'normal');
      for (const rung of harder.length ? harder : rungs) {
        expect(
          pool.some((e) => e.when?.difficulty === rung),
          `${name} has no exchange for ${rung}`,
        ).toBe(true);
      }
    }
  });

  it('the memory lines a boss already had still play in a rematch Edric leads', () => {
    for (const [name, boss] of bosses) {
      const pool = rematchPool(boss);
      for (const variant of boss.preBattle.variants) {
        const [key] = Object.keys(variant.when);
        const remembered = variant.entries.find((e) => e.line !== '...');
        expect(
          pool.some(
            (e) =>
              e.when?.[key] === true && e.exchange.some((line) => line.line === remembered.line),
          ),
          `${name} lost "${remembered.line}"`,
        ).toBe(true);
      }
    }
  });
});

describe('a save that keeps meeting a boss', () => {
  const ctx = (bossName, runsStarted, extra = {}) => ({
    commander: 'Edric',
    partner: 'Sera',
    difficulty: 'normal',
    runsStarted,
    runsCompleted: 0,
    lastRunResult: 'defeat',
    bossName,
    bossSlainCount: 1,
    bossKilledYouCount: 1,
    linesPlayed: [],
    ...extra,
  });

  // Contextual exchanges (memory, the rung) take the even runs and general ones the odd
  // runs, so each set is walked on its own runs without a repeat.
  it.each(bosses.map(([name]) => name))(
    '%s: every exchange this save can hear plays before any of its set repeats',
    (name) => {
      const boss = dialogue.bossEncounters[name];
      const rung = rungsFor(name).at(-1);
      const pool = rematchPool(boss);
      const text = (e) => e.exchange.map((x) => x.line).join('|');
      const general = pool.filter((e) => !e.when).map(text);
      const contextual = pool
        .filter((e) => e.when && (!e.when.difficulty || e.when.difficulty === rung))
        .map(text);
      const played = [];
      const heard = { general: [], contextual: [] };
      for (let run = 1; run <= 2 * Math.max(general.length, contextual.length); run++) {
        const entries = selectDialogueEntries(
          boss.preBattleExchange,
          ctx(name, run, { difficulty: rung, linesPlayed: [...played] }),
        );
        expect(entries.at(-1).speaker).toBe('Edric');
        heard[run % 2 === 0 ? 'contextual' : 'general'].push(entries.map((e) => e.line).join('|'));
        played.push(entries[0].lineKey);
      }
      expect(new Set(heard.general.slice(0, general.length))).toEqual(new Set(general));
      expect(new Set(heard.contextual.slice(0, contextual.length))).toEqual(new Set(contextual));
    },
  );

  it('a rung’s exchange never plays on another rung', () => {
    const boss = dialogue.bossEncounters['Iron Captain'];
    const blackSun = rematchPool(boss).find((e) => e.when?.difficulty === 'lunatic');
    for (let run = 1; run <= 30; run++) {
      const [first] = selectDialogueEntries(
        boss.preBattleExchange,
        ctx('Iron Captain', run, { difficulty: 'hard' }),
      );
      expect(first.line).not.toBe(blackSun.exchange[0].line);
    }
  });
});

describe('BattleBeatsController.getBossPreBattleEntries', () => {
  const sceneFor = ({ commander = 'Edric', slain = 0, killed = 0, runsStarted = 3 } = {}) => ({
    gameData: { dialogue },
    registry: {
      get: (key) =>
        key === 'meta'
          ? {
              getStoryFlags: () => ({ linesPlayed: [] }),
              getRunsStarted: () => runsStarted,
              getBossSlainCount: () => slain,
              getDefeatedByCount: () => killed,
            }
          : null,
    },
    runManager: {
      difficultyId: 'normal',
      roster: [],
      getStartingLordNames: () => [commander, commander === 'Edric' ? 'Sera' : 'Edric'],
    },
  });
  const entriesFor = (opts) =>
    new BattleBeatsController(sceneFor(opts), () => 0).getBossPreBattleEntries('Warchief');
  const warchief = dialogue.bossEncounters.Warchief;
  const replyOf = (lord) =>
    warchief.preBattleReply.variants.find((v) => v.when.commander === lord).entries[0].line;

  it('a first meeting: the boss’s line, then the commander’s reply', () => {
    expect(entriesFor().map((e) => e.line)).toEqual([
      warchief.preBattle.base[0].line,
      replyOf('Edric'),
    ]);
  });

  it('a rematch Edric leads: one exchange is the whole beat, with no second reply', () => {
    const entries = entriesFor({ slain: 1 });
    const pool = rematchPool(warchief);
    const exchange = pool.find((e) => e.exchange[0].line === entries[0].line);
    expect(exchange).toBeTruthy();
    expect(entries.map((e) => e.line)).toEqual(exchange.exchange.map((e) => e.line));
    expect(entries.map((e) => e.line)).not.toContain(replyOf('Edric'));
    expect(entries[0].lineKey).toBe(
      narrativeLineKey(exchange.exchange.map((e) => e.line).join('\n')),
    );
  });

  it('a rematch another lord leads keeps the boss’s memory line and that lord’s reply', () => {
    const killedYou = warchief.preBattle.variants.find((v) => v.when.bossKilledYouBefore);
    expect(entriesFor({ commander: 'Kira', killed: 1 }).map((e) => e.line)).toEqual([
      killedYou.entries[0].line,
      replyOf('Kira'),
    ]);
  });
});

describe('BattleScene._showStoryDialogueOnce remembers pooled lines as they are shown', () => {
  function fakeScene({ shown = false } = {}) {
    const recorded = [];
    const scene = {
      _battleSession: 1,
      runManager: {
        hasShownDialogue: () => shown,
        markDialogueShown: vi.fn(),
      },
      registry: {
        get: (key) =>
          key === 'meta' ? { recordLinesPlayed: (keys) => recorded.push(keys) } : null,
      },
      _showStorySequence: vi.fn(async () => {}),
    };
    return { scene, recorded };
  }
  const show = (scene, entries) =>
    BattleScene.prototype._showStoryDialogueOnce.call(scene, 'boss_pre_Warchief', entries);

  it('records the exchange’s key once, when the beat first plays', async () => {
    const { scene, recorded } = fakeScene();
    await show(scene, [
      { speaker: 'Warchief', line: 'a', lineKey: 'lkey' },
      { speaker: 'Edric', line: 'b' },
    ]);
    expect(recorded).toEqual([['lkey']]);
    expect(scene._showStorySequence).toHaveBeenCalledOnce();
  });

  it('a resume (the beat already shown) records nothing, so the rotation does not skip ahead', async () => {
    const { scene, recorded } = fakeScene({ shown: true });
    await show(scene, [{ speaker: 'Warchief', line: 'a', lineKey: 'lkey' }]);
    expect(recorded).toEqual([]);
    expect(scene._showStorySequence).not.toHaveBeenCalled();
  });

  it('plain lines record nothing', async () => {
    const { scene, recorded } = fakeScene();
    await show(scene, [{ speaker: 'Warchief', line: 'a' }]);
    expect(recorded).toEqual([]);
  });
});
