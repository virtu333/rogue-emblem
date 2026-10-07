// Story flags that remember their act (docs/specs/event-nodes-phase2.md §2A "Story-flag reads"):
// `storyFlags[key] = { value, act }` for new writes, plain values from old saves still read, and
// `requires.flagAct` lets a payoff ask for a flag set in an earlier act.
//
// Ways this goes wrong:
//   - a new write loses its act (a payoff in Act II can never tell Act I's deed from its own);
//   - setting a flag again moves its act forward, so "an earlier act" stops being true;
//   - an old save's plain flag stops reading (every Phase 1 payoff gate breaks) or reads as
//     "set in this act";
//   - `flagAct` without a flag grants the choice, an unknown value grants it, or the act match is
//     off by one;
//   - a save with a malformed flag poisons the run.
import { describe, expect, it } from 'vitest';
import { chooseEventOption, leaveEvent } from '../src/engine/EventCommands.js';
import {
  eligibleEvents,
  evaluateRequires,
  flagActMatches,
  flagEntry,
  flagValue,
  sanitizeStoryFlags,
  withFlag,
} from '../src/engine/EventSystem.js';
import { arriveAs, baseData, eventNode, newRun, runWithEvents, soloEvent } from './eventKit.js';
import { roundTrip } from './eventPhase2Kit.js';

const inAct = (run, index) => {
  run.actSequence = ['act1', 'act2', 'act3', 'act4'];
  run.actIndex = index;
  return run;
};

describe('writing a flag', () => {
  it('the flag effect stores the value and the act it was set in', () => {
    for (const [index, act] of [
      [0, 'act1'],
      [2, 'act3'],
    ]) {
      const run = inAct(
        runWithEvents([soloEvent([{ type: 'flag', key: 'spared', value: true }])]),
        index,
      );
      const node = arriveAs(run, 'solo');
      const result = chooseEventOption(run, node.id, 'go');
      expect(run.storyFlags).toEqual({ spared: { value: true, act } });
      expect(result.results).toEqual([{ kind: 'flag', key: 'spared', value: true }]); // the record is the plain value
    }
  });

  it('setting the same value again keeps the act it was first set in; a different value replaces it', () => {
    let flags = withFlag({}, 'k', true, 'act1');
    flags = withFlag(flags, 'k', true, 'act3');
    expect(flags.k).toEqual({ value: true, act: 'act1' });
    flags = withFlag(flags, 'k', 'other', 'act3');
    expect(flags.k).toEqual({ value: 'other', act: 'act3' });
    // a legacy plain value has no act to keep
    expect(withFlag({ k: true }, 'k', true, 'act2').k).toEqual({ value: true, act: 'act2' });
  });

  it('does not touch the other flags', () => {
    const flags = withFlag({ a: true, b: { value: 2, act: 'act1' } }, 'c', 'x', 'act2');
    expect(flags).toEqual({
      a: true,
      b: { value: 2, act: 'act1' },
      c: { value: 'x', act: 'act2' },
    });
  });
});

describe('reading a flag', () => {
  it('flagEntry and flagValue read both shapes and unset keys', () => {
    const flags = {
      plain: true,
      num: 0,
      wrapped: { value: 'x', act: 'act2' },
      wrappedNoAct: { value: 3 },
    };
    expect(flagEntry(flags, 'plain')).toEqual({ value: true, act: null });
    expect(flagEntry(flags, 'wrapped')).toEqual({ value: 'x', act: 'act2' });
    expect(flagEntry(flags, 'wrappedNoAct')).toEqual({ value: 3, act: null });
    expect(flagEntry(flags, 'missing')).toBeNull();
    expect(flagEntry(undefined, 'x')).toBeNull();
    expect(flagValue(flags, 'plain')).toBe(true);
    expect(flagValue(flags, 'wrapped')).toBe('x');
    expect(flagValue(flags, 'missing')).toBeUndefined();
    // inherited keys are not flags
    expect(flagEntry({}, 'toString')).toBeNull();
  });

  it('flag and notFlag read a plain value and a wrapped one alike', () => {
    const run = newRun();
    run.storyFlags = {
      old: true,
      fresh: { value: true, act: 'act1' },
      off: { value: false, act: 'act1' },
      zero: 0,
    };
    const check = (requires) => evaluateRequires(run, requires, {});
    expect(check({ flag: 'old' })).toBe('');
    expect(check({ flag: 'fresh' })).toBe('');
    expect(check({ flag: 'off' })).toBe('Not something you have done.'); // set, but false
    expect(check({ flag: 'zero' })).toBe('Not something you have done.');
    expect(check({ flag: 'missing' })).toBe('Not something you have done.');
    expect(check({ notFlag: 'old' })).toBe('You have already done this.');
    expect(check({ notFlag: 'fresh' })).toBe('You have already done this.');
    expect(check({ notFlag: 'off' })).toBe('');
    expect(check({ notFlag: 'missing' })).toBe('');
  });
});

describe('requires.flagAct', () => {
  const run = (act, flags) => {
    const r = inAct(newRun(), act);
    r.storyFlags = flags;
    return r;
  };
  const check = (r, flagAct) => evaluateRequires(r, { flag: 'k', flagAct }, {});
  const MISMATCH = 'That was not on a road behind you.';

  it('earlier: set in an act before this one', () => {
    const r = run(1, { k: { value: true, act: 'act1' } });
    expect(check(r, 'earlier')).toBe('');
    expect(check(run(2, { k: { value: true, act: 'act1' } }), 'earlier')).toBe('');
    expect(check(run(1, { k: { value: true, act: 'act2' } }), 'earlier')).toBe(MISMATCH); // this act
    expect(check(run(1, { k: { value: true, act: 'act3' } }), 'earlier')).toBe(MISMATCH); // a later one
    expect(check(run(0, { k: { value: true, act: 'act1' } }), 'earlier')).toBe(MISMATCH);
  });

  it('current: set in this act', () => {
    expect(check(run(1, { k: { value: true, act: 'act2' } }), 'current')).toBe('');
    expect(check(run(1, { k: { value: true, act: 'act1' } }), 'current')).toBe(MISMATCH);
  });

  it('an act id: set in exactly that act', () => {
    const r = run(2, { k: { value: true, act: 'act1' } });
    expect(check(r, 'act1')).toBe('');
    expect(check(r, 'act2')).toBe(MISMATCH);
    expect(check(r, 'act3')).toBe(MISMATCH);
  });

  it('a flag from a save that recorded no acts counts as earlier, never as this act or a named one', () => {
    const r = run(1, { k: true });
    expect(check(r, 'earlier')).toBe('');
    expect(check(r, 'current')).toBe(MISMATCH);
    expect(check(r, 'act1')).toBe(MISMATCH);
  });

  it('an unset flag fails on the flag, not the act', () => {
    expect(check(run(1, {}), 'earlier')).toBe('Not something you have done.');
  });

  it('flagAct alone, or with an unknown word, grants nothing', () => {
    const r = run(1, { k: { value: true, act: 'act1' } });
    expect(evaluateRequires(r, { flagAct: 'earlier' }, {})).toBe('Unavailable.');
    expect(check(r, 'later')).toBe(MISMATCH);
    expect(check(r, undefined)).toBe(''); // no flagAct: the plain flag read
  });

  it('a custom reason replaces the default line', () => {
    const r = run(1, { k: { value: true, act: 'act2' } });
    expect(
      evaluateRequires(r, { flag: 'k', flagAct: 'earlier', reason: 'Only old debts.' }, {}),
    ).toBe('Only old debts.');
  });

  it('flagActMatches table', () => {
    expect(flagActMatches(null, 'earlier', 'act2')).toBe(false);
    expect(flagActMatches({ value: true, act: 'act1' }, 'earlier', 'act2')).toBe(true);
    expect(flagActMatches({ value: true, act: 'act2' }, 'earlier', 'act2')).toBe(false);
    expect(flagActMatches({ value: true, act: null }, 'earlier', 'act2')).toBe(true);
  });
});

describe('a payoff in a later act', () => {
  it("Act I's spared deserters unlock an event that asks for a flag set in an earlier act, in Act II only", () => {
    const payoff = soloEvent([], {
      id: 'old_faces',
      requires: { flag: 'spared_deserters', flagAct: 'earlier' },
    });
    const deserters = structuredClone(
      baseData.events.events.find((e) => e.id === 'deserters_fire'),
    );
    const run = runWithEvents([payoff, deserters]);
    // the real Phase 1 event writes the flag in Act I
    const node = eventNode(run);
    arriveAs(run, 'deserters_fire', node);
    expect(chooseEventOption(run, node.id, 'spare').ok).toBe(true);
    expect(leaveEvent(run, node.id).ok).toBe(true);
    expect(run.storyFlags.spared_deserters).toEqual({ value: true, act: 'act1' });
    const open = () =>
      eligibleEvents(run, { id: 'n', row: 3 }, run.gameData.events).map((e) => e.id);
    expect(open()).toEqual([]); // the same act: not yet "behind you"
    inAct(run, 1);
    expect(open()).toEqual(['old_faces']);
  });
});

describe('saved flags', () => {
  it('sanitize keeps plain values and { value, act }, drops everything else', () => {
    expect(
      sanitizeStoryFlags({
        plain: true,
        n: 1,
        s: 'x',
        wrapped: { value: 'v', act: 'act2' },
        noAct: { value: 3 },
        badAct: { value: 3, act: 5 },
        badValue: { value: {}, act: 'act1' },
        arrayValue: { value: [1], act: 'act1' },
        nil: null,
        arr: [],
        obj: {},
        '': true,
      }),
    ).toEqual({
      plain: true,
      n: 1,
      s: 'x',
      wrapped: { value: 'v', act: 'act2' },
      noAct: { value: 3, act: null },
      badAct: { value: 3, act: null },
    });
  });

  it('round-trips through a save, in both shapes', () => {
    const run = newRun();
    run.storyFlags = { old: true, fresh: { value: 7, act: 'act2' } };
    expect(roundTrip(run).storyFlags).toEqual(run.storyFlags);
    // and the run keeps working with the mix
    const loaded = roundTrip(run);
    expect(flagValue(loaded.storyFlags, 'fresh')).toBe(7);
  });
});
