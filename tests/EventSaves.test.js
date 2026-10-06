// Saves and run lifecycle of the story-event state (docs/specs/event-nodes.md §4 "State and
// saves", §12 Saves and Prologue).
//
// Ways this goes wrong:
//   - a new field is written but not read back (a refresh loses the choice, the log, a flag, a
//     burden, a pending settlement or an ally laid to rest);
//   - a malformed save field crashes the loader or poisons the run (the sanitizer must drop it);
//   - an old save (from before events) fails to load or loads with undefined fields;
//   - the act change keeps last act's choices (event nodes are per act) or throws away the
//     run-long state (log, flags, burdens, laid-to-rest);
//   - a new run inherits the last run's burdens or flags;
//   - the prologue grows an event: its map, its run state, its guidance.
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  arriveAtEvent,
  chooseEventOption,
  eventState,
  eventView,
} from '../src/engine/EventCommands.js';
import { GUIDANCE_NOTES, guidanceText } from '../src/engine/Guidance.js';
import {
  sanitizeEventLog,
  sanitizeEventStates,
  sanitizeLaidToRest,
  sanitizeStoryFlags,
} from '../src/engine/EventSystem.js';
import { canShowRunNote } from '../src/ui/guidanceGate.js';
import { addUnit, arriveAs, baseData, fallAlly, newRun } from './eventKit.js';

const roundTrip = (run) =>
  RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

describe('round trip', () => {
  it('keeps every event field: states, log, flags, burdens, pending settlement, laid to rest', () => {
    const run = newRun({ seed: 41 });
    const node = arriveAs(run, 'abandoned_armory');
    expect(chooseEventOption(run, node.id, 'door').ok).toBe(true);
    run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 5, turnPar: 5 });
    run.storyFlags = { sold_dispatch: true, count: 3, name: 'x' };
    run.burdens = [
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
      { id: 'debt', owed: 120, garnish: 0.25 },
    ];
    const archer = addUnit(run, 'Archer', { name: 'Hale' });
    fallAlly(run, archer);
    run.laidToRest = [run.fallenUnits.pop()];

    const loaded = roundTrip(run);
    expect(loaded.eventStateByNodeId).toEqual(run.eventStateByNodeId);
    expect(loaded.eventLog).toEqual(run.eventLog);
    expect(loaded.storyFlags).toEqual(run.storyFlags);
    expect(loaded.burdens).toEqual(run.burdens);
    expect(loaded.pendingEventNodeId).toBe(node.id);
    expect(loaded.laidToRest.map((u) => u.name)).toEqual(['Hale']);
    // And again: a second save of the loaded run is the same save.
    expect(roundTrip(loaded).eventStateByNodeId).toEqual(run.eventStateByNodeId);
  });

  it('an outcome page reopens identically after a reload; nothing re-rolls', () => {
    const run = newRun({ seed: 52 });
    const node = arriveAs(run, 'twin_altar');
    run.gold = 1000;
    const chosen = chooseEventOption(run, node.id, 'dawn');
    expect(chosen.ok).toBe(true);
    const loaded = roundTrip(run);
    expect(eventView(loaded, node.id)).toEqual(eventView(run, node.id));
    expect(chooseEventOption(loaded, node.id, 'dawn').ok).toBe(false);
    expect(loaded.getActiveBlessingIds()).toEqual(run.getActiveBlessingIds());
    expect(loaded.gold).toBe(run.gold);
    // The recorded event is the recorded event even if the pick would now differ.
    expect(arriveAtEvent(loaded, node.id)).toEqual(eventState(run, node.id));
  });
});

describe('old and malformed saves', () => {
  it('an old save (no event fields) loads with them empty', () => {
    const saved = JSON.parse(JSON.stringify(newRun({ seed: 7 }).toJSON()));
    for (const key of [
      'eventStateByNodeId',
      'eventLog',
      'storyFlags',
      'burdens',
      'pendingEventNodeId',
      'laidToRest',
    ])
      delete saved[key];
    const loaded = RunManager.fromJSON(saved, baseData);
    expect(loaded.eventStateByNodeId).toEqual({});
    expect(loaded.eventLog).toEqual([]);
    expect(loaded.storyFlags).toEqual({});
    expect(loaded.burdens).toEqual([]);
    expect(loaded.pendingEventNodeId).toBeNull();
    expect(loaded.laidToRest).toEqual([]);
  });

  it('malformed fields are dropped, not trusted', () => {
    const saved = JSON.parse(JSON.stringify(newRun({ seed: 7 }).toJSON()));
    saved.eventStateByNodeId = {
      good: {
        eventId: 'drill_yard',
        results: [{ kind: 'hp' }, 'junk', { nokind: 1 }, null],
        battle: 'pending',
        afterVictory: [{ type: 'gold' }, 5],
      },
      noEvent: { choiceId: 'x' },
      numeric: { eventId: 12 },
      array: [],
      '': { eventId: 'drill_yard' },
      unknownEvent: { eventId: 'from_a_later_build', choiceId: 'c' },
      badBattle: { eventId: 'drill_yard', battle: 'sideways' },
    };
    saved.eventLog = [
      { eventId: 'a', choiceId: 'b', outcomeId: 'c', act: 'act1' },
      { eventId: 5, choiceId: 'b', outcomeId: 'c' },
      { eventId: 'a' },
      'x',
      null,
    ];
    saved.storyFlags = { ok: true, n: 1, s: 'x', obj: {}, arr: [], nil: null, '': true };
    saved.burdens = [{ id: 'debt', owed: 'lots' }, { id: 'ill_omen', battles: 1 }, 'x'];
    saved.pendingEventNodeId = 42;
    saved.laidToRest = [{ name: 'A', stats: { HP: 1 } }, { name: 'B' }, 'x', null];
    const loaded = RunManager.fromJSON(saved, baseData);
    expect(Object.keys(loaded.eventStateByNodeId).sort()).toEqual([
      'badBattle',
      'good',
      'unknownEvent',
    ]);
    expect(loaded.eventStateByNodeId.good.results).toEqual([{ kind: 'hp' }]);
    expect(loaded.eventStateByNodeId.good.afterVictory).toEqual([{ type: 'gold' }]);
    expect(loaded.eventStateByNodeId.good.battle).toBe('pending');
    expect(loaded.eventStateByNodeId.badBattle.battle).toBeNull();
    expect(loaded.eventStateByNodeId.unknownEvent.eventId).toBe('from_a_later_build'); // kept
    expect(loaded.eventLog).toEqual([{ eventId: 'a', choiceId: 'b', outcomeId: 'c', act: 'act1' }]);
    expect(loaded.storyFlags).toEqual({ ok: true, n: 1, s: 'x' });
    expect(loaded.burdens).toEqual([{ id: 'ill_omen', battles: 1, extraShadow: 1 }]);
    expect(loaded.pendingEventNodeId).toBeNull();
    expect(loaded.laidToRest.map((u) => u.name)).toEqual(['A']);
  });

  it('an event state whose event is unknown loads and shows nothing rather than throwing', () => {
    const run = newRun();
    const node = arriveAs(run, 'drill_yard');
    run.eventStateByNodeId[node.id].eventId = 'from_a_later_build';
    const loaded = roundTrip(run);
    expect(eventView(loaded, node.id)).toBeNull();
    expect(chooseEventOption(loaded, node.id, 'rest').ok).toBe(false);
  });

  it('the sanitizers are total: junk in, empty out', () => {
    for (const junk of [undefined, null, 5, 'x', [], true]) {
      expect(sanitizeEventStates(junk)).toEqual({});
      expect(sanitizeEventLog(junk)).toEqual([]);
      expect(sanitizeStoryFlags(junk)).toEqual({});
      expect(sanitizeLaidToRest(junk)).toEqual([]);
    }
  });
});

describe('run lifecycle', () => {
  it('advanceAct resets only the per-act choices; the log, flags, burdens and the dead stay', () => {
    const run = newRun({ seed: 9, difficulty: 'dusk' });
    const node = arriveAs(run, 'drill_yard');
    chooseEventOption(run, node.id, 'rest');
    run.storyFlags = { sold_dispatch: true };
    run.burdens = [{ id: 'ill_omen', battles: 2, extraShadow: 1 }];
    run.laidToRest = [{ name: 'Old', stats: { HP: 1 } }];
    run.pendingEventNodeId = node.id;
    for (const n of run.nodeMap.nodes) n.completed = true;
    run.advanceAct();
    expect(run.currentAct).toBe('act2');
    expect(run.eventStateByNodeId).toEqual({});
    expect(run.pendingEventNodeId).toBeNull();
    expect(run.eventLog).toHaveLength(1);
    expect(run.storyFlags).toEqual({ sold_dispatch: true });
    expect(run.burdens).toHaveLength(1);
    expect(run.laidToRest).toHaveLength(1);
  });

  it("a new run starts with none of the last one's state", () => {
    const run = newRun({ seed: 9 });
    run.eventLog = [{ eventId: 'a', choiceId: 'b', outcomeId: 'c', act: 'act1' }];
    run.storyFlags = { a: 1 };
    run.burdens = [{ id: 'debt', owed: 5, garnish: 0.5 }];
    run.laidToRest = [{ name: 'Old', stats: { HP: 1 } }];
    run.eventStateByNodeId = { x: { eventId: 'drill_yard' } };
    run.pendingEventNodeId = 'x';
    run.startRun({ runSeed: 10, difficultyId: 'normal', applyBlessingsAtStart: false });
    expect(run.eventLog).toEqual([]);
    expect(run.storyFlags).toEqual({});
    expect(run.burdens).toEqual([]);
    expect(run.laidToRest).toEqual([]);
    expect(run.eventStateByNodeId).toEqual({});
    expect(run.pendingEventNodeId).toBeNull();
  });
});

describe('the prologue has no events', () => {
  function prologueRun() {
    const run = new RunManager({ ...baseData });
    run.startPrologue(run.gameData);
    return run;
  }

  it('its map holds none, its event state is empty, and no command works on it', () => {
    const run = prologueRun();
    expect(run.nodeMap.nodes.some((n) => n.type === 'event')).toBe(false);
    expect(run.eventStateByNodeId).toEqual({});
    expect(run.burdens).toEqual([]);
    for (const node of run.nodeMap.nodes) expect(arriveAtEvent(run, node.id)).toBeNull();
  });

  it('even a node forced to be an event is refused in a prologue run', () => {
    const run = prologueRun();
    const node = run.nodeMap.nodes[1];
    node.type = 'event';
    expect(arriveAtEvent(run, node.id)).toBeNull();
    expect(chooseEventOption(run, node.id, 'rest').ok).toBe(false);
  });

  it('guide_first_event is an essential note with the spec text, never shown in the prologue', () => {
    expect(GUIDANCE_NOTES.guide_first_event).toEqual({ tier: 'essential' });
    expect(guidanceText('guide_first_event')).toBe(
      "An event: choose how to meet it. You won't see what a choice brings until you make it, but the words are honest.",
    );
    const scene = (runManager) => ({
      runManager,
      registry: {
        get: (key) =>
          key === 'hints'
            ? { hasSeen: () => false, markSeen: () => {} }
            : key === 'settings'
              ? { getGuidance: () => 'full', getHints: () => true }
              : null,
      },
    });
    expect(canShowRunNote(scene(newRun()), 'guide_first_event')).toBe(true);
    expect(canShowRunNote(scene(prologueRun()), 'guide_first_event')).toBe(false);
  });
});
