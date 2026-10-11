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

/** True when the rung's road passes the Emperor (Act IV), so `roadThroughEmperor` holds on it. */
const passesEmperor = (rung) => difficulty.modes[rung].actsIncluded.includes('act4');

/** An exchange meant for this rung: it names the rung, or the road past the Emperor and the rung's road goes there. */
const isForRung = (e, rung) =>
  e.when?.difficulty === rung || (e.when?.roadThroughEmperor === true && passesEmperor(rung));

function rematchPool(boss) {
  const variants = boss.preBattleExchange?.variants || [];
  return variants.find(
    (v) => v.when?.commander === 'Edric' && v.when?.bossMetBefore === true && !v.when?.bossRole,
  )?.pool;
}

/** The Lieutenant's pool at the Descent's gate (Nightfall, Black Sun): his door, not his end. */
function gatePool(boss) {
  return (boss.preBattleExchange?.variants || []).find((v) => v.when?.bossRole === 'gate')?.pool;
}

/** Every rematch pool a boss has: its own, and the gate's for the Lieutenant. */
const poolsOf = (boss) => [rematchPool(boss), gatePool(boss)].filter(Boolean);

describe('the rematch exchanges in dialogue.json', () => {
  it('every boss but the prologue’s has a pool for Edric, gated on having met it', () => {
    expect(bosses.length).toBeGreaterThanOrEqual(11);
    for (const [name, boss] of bosses) {
      const variants = boss.preBattleExchange?.variants;
      // The Lieutenant alone has a second pool: the Descent's gate, ahead of his own so it wins
      // there (bossRole 'gate').
      const gate = name === 'The Lieutenant';
      expect(variants, name).toHaveLength(gate ? 2 : 1);
      if (gate)
        expect(variants[0].when).toEqual({ bossRole: 'gate', commander: 'Edric', bossMetBefore: true }); // prettier-ignore
      expect(variants.at(-1).when, name).toEqual({ commander: 'Edric', bossMetBefore: true });
      for (const pool of poolsOf(boss)) expect(pool.length, name).toBeGreaterThanOrEqual(8);
    }
    expect(dialogue.bossEncounters[prologueBoss].preBattleExchange).toBeUndefined();
  });

  it('each exchange is the boss (or its silence) and then Edric’s answer', () => {
    for (const [name, boss] of bosses) {
      const voice = boss.preBattle.base[0];
      for (const { exchange } of poolsOf(boss).flat()) {
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
      for (const { exchange } of poolsOf(boss).flat()) {
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
        if (e.when?.roadThroughEmperor)
          expect(rungsFor(name).some(passesEmperor), `${name}: no rung passes the Emperor`).toBe(
            true,
          );
      }
      const rungs = rungsFor(name);
      const harder = rungs.filter((r) => r !== 'normal');
      for (const rung of harder.length ? harder : rungs) {
        expect(
          pool.some((e) => isForRung(e, rung)),
          `${name} has no exchange for ${rung}`,
        ).toBe(true);
      }
    }
  });

  it('the memory lines a boss already had still play in a rematch Edric leads', () => {
    // A variant's line (a memory, the road, the Rite's tier) is in the pool that plays where the
    // variant would: the gate's pool for a gate variant, the boss's own pool otherwise.
    for (const [name, boss] of bosses) {
      for (const variant of boss.preBattle.variants) {
        const pool = variant.when.bossRole === 'gate' ? gatePool(boss) : rematchPool(boss);
        const conditions = Object.entries(variant.when).filter(([key]) => key !== 'bossRole');
        if (conditions.length === 0) continue; // the gate's own opening: every exchange is one
        const [key, value] = conditions[0];
        const remembered = variant.entries.find((e) => e.line !== '...');
        expect(
          pool.some(
            (e) =>
              e.when?.[key] === value && e.exchange.some((line) => line.line === remembered.line),
          ),
          `${name} lost "${remembered.line}"`,
        ).toBe(true);
      }
    }
  });

  it('the gate’s pool: general exchanges, both memories, and Black Sun’s own, none of them final', () => {
    // Failure: the gate opens on a line that ends the story ("my master's work is done"), or a
    // memory or Black Sun has no exchange of its own there.
    const pool = gatePool(dialogue.bossEncounters['The Lieutenant']);
    expect(pool.filter((e) => !e.when).length).toBeGreaterThanOrEqual(3);
    expect(pool.some((e) => e.when?.bossKilledYouBefore === true)).toBe(true);
    expect(pool.some((e) => e.when?.bossSlainBefore === true)).toBe(true);
    expect(pool.some((e) => e.when?.difficulty === 'lunatic')).toBe(true);
    for (const e of pool) {
      expect(Object.keys(e.when || {}).length).toBeLessThanOrEqual(1);
      // only rungs that meet him at a gate
      if (e.when?.difficulty) expect(['hard', 'lunatic']).toContain(e.when.difficulty);
      expect(e.exchange.map((x) => x.line).join(' ')).not.toMatch(/already done|it ends here/i);
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
        .filter(
          (e) =>
            e.when &&
            (!e.when.difficulty || e.when.difficulty === rung) &&
            (e.when.roadThroughEmperor === undefined || passesEmperor(rung)) &&
            // a Rite tier is never this context's (no Descent battle here)
            e.when.riteBand === undefined,
        )
        .map(text);
      const played = [];
      const heard = { general: [], contextual: [] };
      for (let run = 1; run <= 2 * Math.max(general.length, contextual.length); run++) {
        const entries = selectDialogueEntries(
          boss.preBattleExchange,
          ctx(name, run, {
            difficulty: rung,
            roadThroughEmperor: passesEmperor(rung),
            linesPlayed: [...played],
          }),
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

  it('the Lieutenant’s emperor-is-ash exchanges play on a road past the Emperor and never on First Light’s', () => {
    // Failure: a rematch on Dusk opens on First Light's "his work is done" register (or the
    // reverse: First Light's Lieutenant mourns an emperor who still lives).
    const boss = dialogue.bossEncounters['The Lieutenant'];
    const dusk = rematchPool(boss).filter((e) => e.when?.roadThroughEmperor === true);
    expect(dusk.length).toBeGreaterThanOrEqual(3);
    const duskLines = new Set(dusk.map((e) => e.exchange[0].line));
    // Each road walks its own save: the lines it has heard are remembered, as a played run does.
    const walk = (road) => {
      const played = [];
      const heard = new Set();
      for (let run = 2; run <= 24; run += 2) {
        const entries = selectDialogueEntries(
          boss.preBattleExchange,
          ctx('The Lieutenant', run, { ...road, linesPlayed: [...played] }),
        );
        heard.add(entries[0].line);
        played.push(entries[0].lineKey);
      }
      return heard;
    };
    // Even runs take the contextual set: the memories and, on Dusk, the exchanges above.
    const heard = {
      dusk: walk({ difficulty: 'dusk', roadThroughEmperor: true }),
      firstLight: walk({ difficulty: 'normal', roadThroughEmperor: false }),
    };
    for (const line of duskLines) {
      expect(heard.dusk.has(line), line).toBe(true);
      expect(heard.firstLight.has(line), line).toBe(false);
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

describe('the Lieutenant by role: the gate (Nightfall, Black Sun) and the finale (First Light, Dusk)', () => {
  // Failures: the gate plays a finale line ("my master's work is already done", Dusk's "his
  // work is not") or a finale plays a gate line ("go down, then"); a gate variant is put after
  // a road or memory variant and never wins; a commander's reply at the gate answers the
  // finale's "you fall" instead of the door.
  const L = dialogue.bossEncounters['The Lieutenant'];
  const LORDS = ['Edric', 'Kira', 'Voss', 'Sera', 'Rowan', 'Astrid', 'Cael'];
  const ROADS = {
    firstLight: { difficulty: 'normal', roadThroughEmperor: false, bossRole: 'finale' },
    dusk: { difficulty: 'dusk', roadThroughEmperor: true, bossRole: 'finale' },
    nightfall: { difficulty: 'hard', roadThroughEmperor: true, bossRole: 'gate' },
    blackSun: { difficulty: 'lunatic', roadThroughEmperor: true, bossRole: 'gate' },
  };
  const ctx = (road, extra = {}) => ({
    commander: 'Kira',
    runsStarted: 3,
    linesPlayed: [],
    bossSlainCount: 0,
    bossKilledYouCount: 0,
    ...ROADS[road],
    ...extra,
  });
  const lines = (section, c) => (selectDialogueEntries(section, c) || []).map((e) => e.line);
  const gateLines = (section) =>
    new Set(
      section.variants
        .filter((v) => v.when.bossRole === 'gate')
        .flatMap((v) => v.entries.map((e) => e.line)),
    );

  it('every section that speaks at the gate opens with its gate variants', () => {
    for (const key of ['preBattle', 'halfHealth', 'defeat', 'preBattleReply']) {
      const roles = L[key].variants.map((v) => v.when.bossRole === 'gate');
      const firstNonGate = roles.indexOf(false);
      expect(roles.slice(0, firstNonGate).length, key).toBeGreaterThan(0);
      expect(roles.slice(firstNonGate).includes(true), `${key}: a gate variant after another`).toBe(false); // prettier-ignore
    }
  });

  it('preBattle, halfHealth and defeat: gate lines at the gate on both rungs, never at a finale', () => {
    for (const key of ['preBattle', 'halfHealth', 'defeat']) {
      const gate = gateLines(L[key]);
      for (const memory of [{}, { bossKilledYouCount: 1 }, { bossSlainCount: 1 }]) {
        for (const road of ['nightfall', 'blackSun']) {
          const said = lines(L[key], ctx(road, memory));
          expect(said.length, `${key} ${road}`).toBeGreaterThan(0);
          for (const line of said) expect(gate.has(line), `${key} ${road}: ${line}`).toBe(true);
        }
        for (const road of ['firstLight', 'dusk']) {
          for (const line of lines(L[key], ctx(road, memory)))
            expect(gate.has(line), `${key} ${road}: ${line}`).toBe(false);
        }
      }
    }
    // The gate's own fall line, and the finales' kept as they were.
    expect(lines(L.defeat, ctx('nightfall'))).toEqual(['Go down, then. It is awake, and it remembers you.']); // prettier-ignore
    expect(lines(L.defeat, ctx('dusk'))).toEqual([
      'You found the one path I could not block. His Majesty is ash. His work is not.',
    ]);
    expect(lines(L.defeat, ctx('firstLight'))).toEqual([L.defeat.base[0].line]);
    // A save without the Descent (bossRole 'none') hears what it heard before.
    expect(lines(L.defeat, ctx('dusk', { bossRole: 'none' }))).toEqual(lines(L.defeat, ctx('dusk'))); // prettier-ignore
  });

  it('each commander answers the door at the gate, and the finale’s line at a finale', () => {
    const replies = gateLines(L.preBattleReply);
    for (const commander of LORDS) {
      const atGate = lines(L.preBattleReply, ctx('nightfall', { commander }));
      expect(atGate).toHaveLength(1);
      expect(replies.has(atGate[0]), commander).toBe(true);
      const atFinale = lines(L.preBattleReply, ctx('firstLight', { commander }));
      expect(atFinale).toHaveLength(1);
      expect(replies.has(atFinale[0]), commander).toBe(false);
    }
  });

  it('Edric’s rematch at the gate walks the gate’s pool only; a finale never hears it', () => {
    const gate = new Set(gatePool(L).map((e) => e.exchange[0].line));
    for (const road of ['nightfall', 'blackSun', 'firstLight', 'dusk']) {
      const played = [];
      for (let run = 1; run <= 24; run++) {
        const entries = selectDialogueEntries(
          L.preBattleExchange,
          ctx(road, {
            commander: 'Edric',
            runsStarted: run,
            bossSlainCount: 1,
            bossKilledYouCount: 1,
            linesPlayed: [...played],
          }),
        );
        played.push(entries[0].lineKey);
        expect(gate.has(entries[0].line), `${road} run ${run}`).toBe(
          ROADS[road].bossRole === 'gate',
        );
      }
    }
    // Black Sun's own exchange plays on Black Sun's gate, never on Nightfall's.
    const blackSun = gatePool(L).find((e) => e.when?.difficulty === 'lunatic').exchange[0].line;
    const heard = (road) => {
      const played = [];
      const out = new Set();
      for (let run = 2; run <= 30; run += 2) {
        const [first] = selectDialogueEntries(
          L.preBattleExchange,
          ctx(road, { commander: 'Edric', runsStarted: run, bossSlainCount: 1, linesPlayed: [...played] }), // prettier-ignore
        );
        out.add(first.line);
        played.push(first.lineKey);
      }
      return out;
    };
    expect(heard('blackSun').has(blackSun)).toBe(true);
    expect(heard('nightfall').has(blackSun)).toBe(false);
  });

  it('BattleBeatsController composes the gate’s opening from the battle’s bossRole', () => {
    const scene = (bossRole, commander = 'Cael') => ({
      gameData: { dialogue },
      battleParams: { bossRole },
      registry: {
        get: (key) =>
          key === 'meta'
            ? {
                getStoryFlags: () => ({ linesPlayed: [] }),
                getRunsStarted: () => 3,
                getBossSlainCount: () => 0,
                getDefeatedByCount: () => 0,
              }
            : null,
      },
      runManager: {
        difficultyId: 'hard',
        actSequence: ['act1', 'act2', 'act3', 'act4', 'finalBoss'],
        roster: [],
        getStartingLordNames: () => [commander, 'Edric'],
      },
    });
    const opening = (bossRole) =>
      new BattleBeatsController(scene(bossRole), () => 0)
        .getBossPreBattleEntries('The Lieutenant')
        .map((e) => e.line);
    const gate = L.preBattle.variants.find((v) => Object.keys(v.when).join() === 'bossRole');
    const caelGate = L.preBattleReply.variants.find(
      (v) => v.when.bossRole === 'gate' && v.when.commander === 'Cael',
    );
    expect(opening('gate')).toEqual([...gate.entries.map((e) => e.line), caelGate.entries[0].line]);
    // The same run without a role (a save on the old two-node act) keeps the road's lines.
    expect(opening(undefined)).not.toContain(gate.entries[0].line);
  });
});
