// Pages and counters of the story events (docs/specs/event-nodes-phase2.md §2A "Pages",
// "Counters"): an outcome may lead on to another page of the same event, and an event may keep
// counters (the Sunken Mine's torches) that choices spend and read.
//
// Ways this goes wrong:
//   - a refresh or reload mid-event re-rolls a step already taken, shows the wrong page, drops
//     the trail or lets the same step be taken twice (a double tap on "Go deeper" spends two
//     torches); pages share one seed so two pages' same-named choices always roll alike;
//   - the first page stops rolling from its Phase 1 key (every Phase 1 event would change its
//     outcomes) or a Phase 1 state saved before pages existed no longer loads or displays;
//   - leaveEvent works on a page with no resolved choice (a way to skip the event's rest) or
//     during a fight;
//   - counters start at the wrong value for a rung, go below 0, are spent by a step that then
//     fails (the apply rolls the run back but not the event's own counters), or `counterAtLeast`
//     does not block;
//   - a malformed saved page, step or counter is trusted.
// Expected values are derived by hand from the documented seed keys (EventSystem header).
import { describe, expect, it, vi } from 'vitest';
import {
  arriveAtEvent,
  chooseEventOption,
  completeEventBattle,
  eventChoiceBlock,
  eventState,
  eventView,
  leaveEvent,
  pendingEventBattle,
} from '../src/engine/EventCommands.js';
import {
  eventRng,
  initialCounters,
  sanitizeEventLog,
  sanitizeEventStates,
} from '../src/engine/EventSystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import { baseData, eventNode, newRun, runWithEvents, soloEvent } from './eventKit.js';
import { coinEvent, loopEvent, mineEvent, ringEvent, roundTrip } from './eventPhase2Kit.js';

/** A run whose only event is `event`, standing on its node. */
function standAt(event, options = {}) {
  const run = runWithEvents([event], options);
  const node = eventNode(run);
  expect(arriveAtEvent(run, node.id).eventId).toBe(event.id);
  return { run, node };
}

describe('seeds: each page rolls on its own', () => {
  it('a choice on the first page rolls from the Phase 1 key', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { run, node } = standAt(coinEvent(), { seed });
      const roll = eventRng(`event:${run.runSeed}:${node.id}:go`)();
      // heads has weight 50 of 100: the cumulative cursor is roll x 100
      expect(chooseEventOption(run, node.id, 'go').outcomeId).toBe(
        roll * 100 < 50 ? 'heads' : 'tails',
      );
    }
  });

  it('a later page rolls from a key that names the page, independent of the first', () => {
    let same = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { run, node } = standAt(coinEvent(), { seed });
      const first = chooseEventOption(run, node.id, 'go');
      const roll = eventRng(`event:${run.runSeed}:${node.id}:b:go`)();
      const second = chooseEventOption(run, node.id, 'go');
      expect(second.outcomeId).toBe(roll * 100 < 50 ? 'heads' : 'tails');
      if (first.outcomeId === second.outcomeId) same++;
    }
    // two fair coins agree about half the time; one shared seed would agree always
    expect(same).toBeGreaterThan(25);
    expect(same).toBeLessThan(75);
  });
});

describe('seeds: a page the event loops back to rolls afresh', () => {
  /** Step into the ring, then toss three times; each toss's outcome and stat pick. */
  const tosses = (seed) => {
    const { run, node } = standAt(ringEvent(), { seed });
    chooseEventOption(run, node.id, 'go');
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      const step = chooseEventOption(run, node.id, 'toss');
      expect(step.ok, step.reason).toBe(true);
      rounds.push({
        outcome: step.outcomeId,
        stat: step.results.find((r) => r.kind === 'stat').stat,
      });
    }
    return { run, node, rounds };
  };
  const coin = (key) => (eventRng(key)() * 100 < 50 ? 'heads' : 'tails');
  const STATS = ['STR', 'SKL', 'SPD', 'DEF'];

  it('the first visit keeps the page-id key; the n-th revisit names itself `ring#n`', () => {
    // The start page was visited once ('go'); 'ring' is entered by it, so its first toss is
    // visit 0 of ring (key `ring`), the second toss visit 1 (`ring#1`), the third visit 2.
    for (let seed = 1; seed <= 40; seed++) {
      const { run, node, rounds } = tosses(seed);
      const keys = ['ring', 'ring#1', 'ring#2'];
      keys.forEach((page, i) => {
        const base = `event:${run.runSeed}:${node.id}:${page}:toss`;
        expect(rounds[i].outcome, `seed ${seed} visit ${i}`).toBe(coin(base));
        // the stat pick is the effect's own sub-stream (phase o, index 0, label stat)
        expect(rounds[i].stat, `seed ${seed} visit ${i} stat`).toBe(
          STATS[Math.floor(eventRng(`${base}:o0:stat`)() * STATS.length)],
        );
      });
    }
  });

  it('a revisit can roll differently from the first visit (one shared key would always agree)', () => {
    let differ = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { rounds } = tosses(seed);
      if (rounds[0].outcome !== rounds[1].outcome || rounds[0].stat !== rounds[1].stat) differ++;
    }
    expect(differ).toBeGreaterThan(20);
  });

  it('a reload keeps the revisit roll: the next toss is visit 3 either way', () => {
    const { run, node } = tosses(11);
    const loaded = roundTrip(run);
    // the next toss is visit 3 either way: the same outcome from the same key
    const a = chooseEventOption(run, node.id, 'toss');
    const b = chooseEventOption(loaded, node.id, 'toss');
    expect(a.outcomeId).toBe(b.outcomeId);
    expect(a.outcomeId).toBe(coin(`event:${run.runSeed}:${node.id}:ring#3:toss`));
  });

  it('a roster tell on a revisit only says what is true: shown exactly when the toss will be heads', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const probe = newRun({ seed });
      const className = probe.roster[0].className;
      const { run, node } = standAt(ringEvent({ tellFor: className }), { seed });
      chooseEventOption(run, node.id, 'go');
      for (let visit = 0; visit < 4; visit++) {
        const view = eventView(run, node.id);
        const shown = view.choices.find((c) => c.id === 'toss').tells.length > 0;
        const outcome = chooseEventOption(run, node.id, 'toss').outcomeId;
        expect(shown, `seed ${seed} visit ${visit}`).toBe(outcome === 'heads');
      }
    }
  });
});

describe('walking the pages', () => {
  it('moves to the next page at once: the step goes to the trail, the page opens', () => {
    const { run, node } = standAt(mineEvent(), { seed: 7 });
    const first = eventView(run, node.id);
    expect(first).toMatchObject({
      page: 'start',
      phase: 'choosing',
      intro: 'A shaft, a rope and three torches.',
      trail: [],
      counters: [{ key: 'torches', label: 'Torches', value: 3, max: 3 }],
      canLeave: false,
    });
    expect(first.choices.map((c) => c.id)).toEqual(['deeper', 'climb']);

    const step = chooseEventOption(run, node.id, 'deeper');
    expect(step).toMatchObject({ ok: true, next: 'level_two', battle: false });
    expect(['ore', 'dust']).toContain(step.outcomeId);
    // the choice's own effect comes first: the torch, then the outcome's gold
    expect(step.results[0]).toEqual({
      kind: 'counter',
      key: 'torches',
      label: 'Torches',
      delta: -1,
      value: 2,
    });

    const view = eventView(run, node.id);
    expect(view).toMatchObject({
      page: 'level_two',
      phase: 'choosing',
      intro: 'The tunnel narrows.',
      outcome: null,
      canLeave: false,
      counters: [{ key: 'torches', value: 2, max: 3 }],
    });
    expect(view.choices.map((c) => c.id)).toEqual(['deeper', 'climb']);
    expect(view.trail).toHaveLength(1);
    expect(view.trail[0]).toMatchObject({
      page: 'start',
      choiceId: 'deeper',
      choiceLabel: 'Go deeper',
      outcomeId: step.outcomeId,
      text: step.text,
    });
    expect(view.trail[0].results).toEqual(step.results);
    // the state: the page, the path, the counters; the top-level choice is the NEXT page's
    const state = eventState(run, node.id);
    expect(state).toMatchObject({ page: 'level_two', counters: { torches: 2 } });
    expect(state.path).toHaveLength(1);
    expect(state.choiceId).toBeUndefined();
    expect(run.eventLog).toEqual([
      { eventId: 'mine', choiceId: 'deeper', outcomeId: step.outcomeId, act: 'act1' },
    ]);
  });

  it('the log names the page of every step after the first', () => {
    const { run, node } = standAt(mineEvent(), { seed: 3 });
    chooseEventOption(run, node.id, 'deeper');
    chooseEventOption(run, node.id, 'climb');
    expect(run.eventLog.map((e) => e.page)).toEqual([undefined, 'level_two']);
    expect(Object.hasOwn(run.eventLog[0], 'page')).toBe(false);
  });

  it('a page that ends the event shows its outcome, then Continue leaves', () => {
    const { run, node } = standAt(mineEvent(), { seed: 5 });
    chooseEventOption(run, node.id, 'deeper');
    const out = chooseEventOption(run, node.id, 'climb');
    expect(out).toMatchObject({
      ok: true,
      next: null,
      outcomeId: 'out',
      text: 'Daylight, with a coin.',
    });
    const view = eventView(run, node.id);
    expect(view).toMatchObject({ phase: 'outcome', page: 'level_two', canLeave: true });
    expect(view.outcome).toMatchObject({ choiceId: 'climb', choiceLabel: 'Climb out' });
    expect(view.trail).toHaveLength(1); // the step behind it; this one is the outcome
    expect(leaveEvent(run, node.id)).toEqual({ ok: true, nodeId: node.id });
    expect(node.completed).toBe(true);
  });

  it('every step survives a reload and nothing re-rolls: a walk with a reload before each step equals a straight walk', () => {
    const walk = ['deeper', 'deeper', 'wake'];
    const straight = standAt(mineEvent(), { seed: 21 });
    for (const id of walk)
      expect(chooseEventOption(straight.run, straight.node.id, id).ok).toBe(true);

    let run = standAt(mineEvent(), { seed: 21 }).run;
    const nodeId = straight.node.id;
    for (const id of walk) {
      const before = eventView(run, nodeId);
      run = roundTrip(run);
      expect(eventView(run, nodeId)).toEqual(before); // a refresh reopens the same page
      expect(chooseEventOption(run, nodeId, id).ok).toBe(true);
    }
    expect(run.eventStateByNodeId).toEqual(straight.run.eventStateByNodeId);
    expect(run.eventLog).toEqual(straight.run.eventLog);
    expect(run.gold).toBe(straight.run.gold);
    // The page that was resolved cannot be chosen on again, after a reload either.
    run = roundTrip(run);
    expect(chooseEventOption(run, nodeId, 'wake')).toEqual({
      ok: false,
      reason: 'You have already chosen.',
    });
    expect(chooseEventOption(run, nodeId, 'climb').ok).toBe(false);
    expect(run.eventLog).toHaveLength(3);
  });

  it('the page guard refuses a second tap on a choice that exists on the next page too', () => {
    const { run, node } = standAt(mineEvent(), { seed: 9 });
    expect(chooseEventOption(run, node.id, 'deeper', { page: 'start' }).ok).toBe(true);
    expect(chooseEventOption(run, node.id, 'deeper', { page: 'start' })).toEqual({
      ok: false,
      reason: 'That page has moved on.',
    });
    expect(eventState(run, node.id).counters.torches).toBe(2); // one torch, not two
    // Without the guard the same call is a legitimate choice on the new page.
    expect(chooseEventOption(run, node.id, 'deeper').ok).toBe(true);
    expect(eventState(run, node.id).counters.torches).toBe(1);
  });

  it('leaveEvent needs a resolved choice on the CURRENT page', () => {
    const { run, node } = standAt(mineEvent(), { seed: 4 });
    expect(leaveEvent(run, node.id)).toEqual({ ok: false, reason: 'Make a choice first.' });
    chooseEventOption(run, node.id, 'deeper');
    // a step behind it is not enough: this page has no choice yet
    expect(leaveEvent(run, node.id)).toEqual({ ok: false, reason: 'Make a choice first.' });
    expect(node.completed).toBeFalsy();
    chooseEventOption(run, node.id, 'climb');
    expect(leaveEvent(run, node.id).ok).toBe(true);
  });

  it('a fight on the last page: Fight is owed, the spoils apply once, and a reload in between changes nothing', () => {
    let { run, node } = standAt(mineEvent(), { seed: 11 });
    for (const id of ['deeper', 'deeper', 'wake']) {
      expect(chooseEventOption(run, node.id, id).ok).toBe(true);
      run = roundTrip(run);
    }
    expect(node.type).toBe('event');
    node = run.nodeMap.nodes.find((n) => n.id === node.id);
    expect(node).toMatchObject({ type: 'event', eventBattle: true });
    expect(pendingEventBattle(run, node.id)).toMatchObject({ choiceId: 'wake', text: 'It wakes.' });
    expect(eventView(run, node.id)).toMatchObject({
      page: 'level_three',
      canFight: true,
      canLeave: false,
    });
    expect(leaveEvent(run, node.id)).toEqual({ ok: false, reason: 'The fight is not over.' });

    expect(run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 5, turnPar: 5 })).toBe(
      true,
    );
    run = roundTrip(run);
    const gold = run.gold;
    const done = completeEventBattle(run, node.id);
    expect(done).toMatchObject({ ok: true, text: 'It lies still. The hoard is yours.' });
    expect(done.results).toEqual([{ kind: 'gold', value: 200, requested: 200 }]);
    expect(run.gold).toBe(gold + 200);
    expect(completeEventBattle(roundTrip(run), node.id)).toMatchObject({
      ok: false,
      already: true,
    });
    expect(run.gold).toBe(gold + 200);
    expect(leaveEvent(run, node.id).ok).toBe(true);
  });

  it('an outcome that starts a battle never also moves the page on (the engine ignores a stray `next`)', () => {
    const event = soloEvent([{ type: 'battle', victoryText: 'Won.', afterVictory: [] }], {
      outcome: { next: 'elsewhere' },
    });
    event.pages = { elsewhere: { text: 'Elsewhere.', choices: [event.choices[0]] } };
    const { run, node } = standAt(event);
    const result = chooseEventOption(run, node.id, 'go');
    expect(result).toMatchObject({ ok: true, battle: true, next: null });
    expect(eventState(run, node.id)).toMatchObject({ choiceId: 'go', battle: 'pending' });
    expect(eventState(run, node.id).page).toBeUndefined();
  });

  it('a step that fails while applying leaves the page, the path, the counters and the log as they were', () => {
    const event = {
      id: 'brittle',
      title: 'Brittle',
      weight: 1,
      intro: 'Careful.',
      counters: { torches: 3 },
      choices: [
        {
          id: 'go',
          label: 'Go',
          effects: [{ type: 'counter', key: 'torches', delta: -1 }],
          outcomes: [
            {
              id: 'on',
              weight: 100,
              text: 'On.',
              next: 'two',
              effects: [{ type: 'gold', value: 10 }],
            },
          ],
        },
      ],
      pages: {
        two: {
          text: 'Two.',
          choices: [
            {
              id: 'out',
              label: 'Out',
              outcomes: [{ id: 'o', weight: 100, text: 'Out.', effects: [] }],
            },
          ],
        },
      },
    };
    const { run, node } = standAt(event);
    const gold = run.gold;
    const spy = vi.spyOn(run, 'addGold').mockImplementation(() => {
      throw new Error('boom');
    });
    const result = chooseEventOption(run, node.id, 'go');
    spy.mockRestore();
    expect(result).toEqual({ ok: false, reason: 'That did not work out (boom). Nothing changed.' });
    expect(run.gold).toBe(gold);
    const state = eventState(run, node.id);
    expect(state.counters).toEqual({ torches: 3 });
    expect(state.page).toBeUndefined();
    expect(state.path).toBeUndefined();
    expect(state.choiceId).toBeUndefined();
    expect(run.eventLog).toEqual([]);
    // and the same step goes through afterwards
    expect(chooseEventOption(run, node.id, 'go')).toMatchObject({ ok: true, next: 'two' });
  });

  it('a state on a page the event no longer has reads as unknown instead of offering the wrong choices', () => {
    const { run, node } = standAt(mineEvent(), { seed: 2 });
    run.eventStateByNodeId[node.id].page = 'deleted_page';
    expect(eventView(run, node.id)).toBeNull();
    expect(chooseEventOption(run, node.id, 'deeper')).toEqual({
      ok: false,
      reason: 'This part of the event is no longer known.',
    });
  });
});

describe('a Phase 1 save, from before pages existed', () => {
  /** A run holding a drill_yard record exactly as Phase 1 wrote it. */
  function savedWith(state) {
    const run = newRun({ seed: 19 });
    const node = eventNode(run);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    saved.eventStateByNodeId = { [node.id]: state };
    saved.currentNodeId = node.id;
    return { saved, nodeId: node.id, run };
  }

  it('an outcome page loads and displays as a one-page event, and Continue still leaves', () => {
    const literal = {
      eventId: 'drill_yard',
      arrivedAct: 'act1',
      choiceId: 'rest',
      outcomeId: 'rested',
      text: 'Real beds. Lumpy, but real.',
      results: [
        {
          kind: 'hp',
          mode: 'heal',
          scope: 'all',
          units: [{ name: 'Edric', amount: 12 }],
          total: 12,
          targeted: 3,
        },
      ],
      battle: null,
      afterVictory: [],
      victoryText: '',
      victoryResults: [],
    };
    const { saved, nodeId } = savedWith(structuredClone(literal));
    const loaded = RunManager.fromJSON(saved, baseData);
    expect(loaded.eventStateByNodeId[nodeId]).toEqual(literal); // no page, path or counters invented
    const view = eventView(loaded, nodeId);
    expect(view).toMatchObject({
      eventId: 'drill_yard',
      phase: 'outcome',
      page: 'start',
      trail: [],
      counters: [],
      canLeave: true,
      intro: baseData.events.events.find((e) => e.id === 'drill_yard').intro,
    });
    expect(view.outcome).toMatchObject({
      choiceId: 'rest',
      choiceLabel: 'Rest in the barracks',
      text: literal.text,
    });
    expect(view.choices.every((c) => c.tells.length === 0)).toBe(true);
    expect(leaveEvent(loaded, nodeId).ok).toBe(true);
  });

  it('a just-arrived state loads, shows its choices and rolls from the Phase 1 key', () => {
    const literal = {
      eventId: 'toll_bridge',
      arrivedAct: 'act1',
      results: [],
      victoryResults: [],
      battle: null,
      afterVictory: [],
    };
    const { saved, nodeId } = savedWith(literal);
    const loaded = RunManager.fromJSON(saved, baseData);
    const view = eventView(loaded, nodeId);
    expect(view).toMatchObject({ phase: 'choosing', page: 'start', trail: [], counters: [] });
    expect(view.choices.map((c) => c.id)).toEqual(['pay', 'bluff', 'ford']);
    // the bluff is a check: the Phase 1 stream decides it
    const roll = eventRng(`event:${loaded.runSeed}:${nodeId}:bluff`)();
    const result = chooseEventOption(loaded, nodeId, 'bluff');
    expect(result.ok).toBe(true);
    const chance = 0.35 + (Math.max(...loaded.roster.map((u) => u.stats.LCK)) - 8) * 0.03;
    expect(result.outcomeId).toBe(roll < Math.max(0.05, Math.min(0.95, chance)) ? 'pass' : 'fail');
    expect(result.next).toBeNull();
  });
});

describe('counters', () => {
  it('start by rung: the table holds from its rung up (Black Sun inherits Nightfall)', () => {
    const event = mineEvent();
    expect(
      ['normal', 'dusk', 'hard', 'lunatic'].map((r) => initialCounters(event, r).torches),
    ).toEqual([3, 3, 3, 2]);
    event.countersByRung = { torches: { hard: 1 } };
    expect(
      ['normal', 'dusk', 'hard', 'lunatic'].map((r) => initialCounters(event, r).torches),
    ).toEqual([3, 3, 1, 1]);
    event.countersByRung = { torches: { dusk: 5, lunatic: 0 } };
    expect(
      ['normal', 'dusk', 'hard', 'lunatic'].map((r) => initialCounters(event, r).torches),
    ).toEqual([3, 5, 5, 0]);
    expect(initialCounters(soloEvent([]), 'normal')).toEqual({});
  });

  it('arriving records them for the rung, and the view shows value and starting value', () => {
    for (const [difficulty, torches] of [
      ['normal', 3],
      ['lunatic', 2],
    ]) {
      const { run, node } = standAt(mineEvent(), { seed: 5, difficulty });
      expect(eventState(run, node.id).counters).toEqual({ torches });
      expect(eventView(run, node.id).counters).toEqual([
        { key: 'torches', label: 'Torches', value: torches, max: torches },
      ]);
    }
  });

  it("a choice that needs a torch is blocked when none is left, with the event's own reason", () => {
    const { run, node } = standAt(loopEvent(), { seed: 8 });
    const seen = [];
    for (let i = 0; i < 3; i++) {
      seen.push(eventView(run, node.id).counters[0].value);
      expect(eventChoiceBlock(run, node.id, 'again')).toBe('');
      expect(
        chooseEventOption(run, node.id, 'again', { page: eventView(run, node.id).page }).ok,
      ).toBe(true);
    }
    seen.push(eventView(run, node.id).counters[0].value);
    expect(seen).toEqual([3, 2, 1, 0]);
    expect(eventChoiceBlock(run, node.id, 'again')).toBe('The last torch is gone.');
    expect(chooseEventOption(run, node.id, 'again')).toEqual({
      ok: false,
      reason: 'The last torch is gone.',
    });
    expect(eventState(run, node.id).counters.torches).toBe(0);
    // the way out is never blocked
    expect(eventChoiceBlock(run, node.id, 'climb')).toBe('');
    expect(eventView(run, node.id).choices.find((c) => c.id === 'again').block).toBe(
      'The last torch is gone.',
    );
  });

  it('a counter never goes below 0 and the record says what was actually taken', () => {
    const event = soloEvent([{ type: 'counter', key: 'torches', delta: -5 }]);
    event.counters = { torches: 3 };
    const { run, node } = standAt(event);
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.results).toEqual([
      { kind: 'counter', key: 'torches', label: 'Torches', delta: -3, value: 0 },
    ]);
    expect(eventState(run, node.id).counters).toEqual({ torches: 0 });
  });

  it('two counter effects in one step add up on a ledger (3 - 2 - 2 stops at 0, then +4 makes 4)', () => {
    const event = soloEvent([
      { type: 'counter', key: 'torches', delta: -2 },
      { type: 'counter', key: 'torches', delta: -2 },
      { type: 'counter', key: 'torches', delta: 4 },
    ]);
    event.counters = { torches: 3 };
    const { run, node } = standAt(event);
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.results.map((r) => [r.delta, r.value])).toEqual([
      [-2, 1],
      [-1, 0],
      [4, 4],
    ]);
    expect(eventState(run, node.id).counters.torches).toBe(4);
  });

  it('a counter the event does not declare is refused with nothing changed', () => {
    const event = soloEvent([
      { type: 'gold', value: 50 },
      { type: 'counter', key: 'torches', delta: -1 },
    ]);
    const { run, node } = standAt(event);
    const gold = run.gold;
    expect(chooseEventOption(run, node.id, 'go')).toEqual({
      ok: false,
      reason: 'Unknown counter "torches".',
    });
    expect(run.gold).toBe(gold);
    expect(eventState(run, node.id).choiceId).toBeUndefined();
  });

  it('counters, the page and the path survive a save and a load', () => {
    const { run, node } = standAt(mineEvent(), { seed: 13 });
    chooseEventOption(run, node.id, 'deeper');
    const loaded = roundTrip(run);
    expect(eventState(loaded, node.id)).toEqual(eventState(run, node.id));
    expect(eventView(loaded, node.id).counters[0].value).toBe(2);
  });
});

describe('saved pages are sanitized', () => {
  it('keeps a good page, path and counters; drops malformed steps and counters', () => {
    const states = sanitizeEventStates({
      n1: {
        eventId: 'loop',
        page: 'ring',
        path: [
          {
            page: 'start',
            choiceId: 'again',
            outcomeId: 'round',
            text: 'Round.',
            results: [{ kind: 'counter' }, 'junk'],
            targetName: 'Edric',
          },
          { page: 5, choiceId: 'x', outcomeId: 'y' },
          null,
          'x',
          { page: 'start', choiceId: 'x' },
          { page: 'start', choiceId: '', outcomeId: 'y' },
        ],
        counters: { torches: '2', neg: -4, bad: 'abc', flag: true, frac: 1.9 },
      },
      n2: { eventId: 'loop', page: 'start', path: [], counters: {} },
      n3: { eventId: 'loop', page: 7, path: 'no', counters: [1, 2] },
    });
    expect(states.n1.page).toBe('ring');
    expect(states.n1.path).toEqual([
      {
        page: 'start',
        choiceId: 'again',
        outcomeId: 'round',
        text: 'Round.',
        results: [{ kind: 'counter' }],
        targetName: 'Edric',
      },
    ]);
    expect(states.n1.counters).toEqual({ torches: 2, neg: 0, frac: 1 });
    // defaults are omitted: an explicit first page, no steps and no counters read as none
    for (const id of ['n2', 'n3']) {
      expect(states[id].page).toBeUndefined();
      expect(states[id].path).toBeUndefined();
      expect(states[id].counters).toBeUndefined();
    }
  });

  it('log entries keep a later page and drop a first-page marker', () => {
    expect(
      sanitizeEventLog([
        { eventId: 'mine', choiceId: 'deeper', outcomeId: 'ore', act: 'act1' },
        { eventId: 'mine', choiceId: 'climb', outcomeId: 'out', act: 'act1', page: 'level_two' },
        { eventId: 'mine', choiceId: 'climb', outcomeId: 'out', act: 'act1', page: 'start' },
        { eventId: 'mine', choiceId: 'climb', outcomeId: 'out', act: 'act1', page: 9 },
      ]).map((e) => e.page),
    ).toEqual([undefined, 'level_two', undefined, undefined]);
  });
});
