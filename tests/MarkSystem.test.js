// Marks (docs/specs/phase3.md 3C): the catalog, what a unit reads, and the roll's rules.
// Ways this goes wrong, each caught below:
//   - the catalog drifts from the spec (a Mark's chance or trigger changes, or its text stops
//     naming its own chance);
//   - an unknown id on a unit is read as a Mark, or a missing catalog throws;
//   - the roll is not a function of (run seed, name): a reload re-rolls the recruit;
//   - the roll draws from Math.random or the caller's stream (it must own its stream);
//   - the rate is not the configured rate, or the five Marks are not picked evenly;
//   - a proc rolls at chance 0, or at the wrong edge of its percentage.
// Rates are checked over thousands of names against a 4-sigma binomial band; the expected
// numbers are written out by hand from the spec, never read back from the code under test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MARK_CHANCE,
  getMarkDef,
  getUnitMark,
  getUnitMarkFor,
  markActivation,
  markChanceFor,
  markProcs,
  markRng,
  rollMark,
  roadBuffEntry,
} from '../src/engine/MarkSystem.js';
import { loadGameData } from './testData.js';

const marks = loadGameData().marks;
afterEach(() => vi.restoreAllMocks());

const names = (n, prefix = 'Recruit') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`);
const roll = (name, opts) => {
  const unit = { name };
  rollMark(unit, { marksData: marks, ...opts });
  return unit.markId ?? null;
};
const band = (n, p) => 4 * Math.sqrt(n * p * (1 - p)); // 4 sigma of a binomial count

describe('the catalog', () => {
  it('holds the five Marks with the spec chances and triggers', () => {
    expect(marks.map((m) => [m.id, m.chance, m.trigger])).toEqual([
      ['forge', 20, 'weapon-art-cost'],
      ['hunt', 15, 'on-attack'],
      ['ember', 20, 'on-kill'],
      ['veil', 15, 'on-defend'],
      ['road', 25, 'on-turn-start'],
    ]);
    expect(marks.map((m) => m.name)).toEqual([
      'Mark of the Forge',
      'Mark of the Hunt',
      'Mark of the Ember',
      'Mark of the Veil',
      'Mark of the Road',
    ]);
  });

  it("each description names the Mark's own chance, so the text and the number cannot part", () => {
    for (const mark of marks) expect(mark.description).toContain(`${mark.chance}%`);
  });

  it('the Hunt reads +5 damage (owner question Q6)', () => {
    const hunt = getMarkDef('hunt', marks);
    expect(hunt.effect).toEqual({ damageBonus: 5 });
    expect(hunt.description).toBe('15% per strike: +5 damage on that strike.');
  });
});

describe('reading a unit’s Mark', () => {
  it('returns the catalog entry for a known id', () => {
    expect(getUnitMark({ markId: 'veil' }, marks)?.name).toBe('Mark of the Veil');
    expect(getUnitMarkFor({ markId: 'veil' }, 'on-defend', marks)?.id).toBe('veil');
    expect(getUnitMarkFor({ markId: 'veil' }, 'on-attack', marks)).toBeNull();
  });

  it('ignores an unknown id, a unit with none, and a missing catalog', () => {
    expect(getUnitMark({ markId: 'mark_of_nothing' }, marks)).toBeNull();
    expect(getUnitMark({ markId: 42 }, marks)).toBeNull();
    expect(getUnitMark({}, marks)).toBeNull();
    expect(getUnitMark(null, marks)).toBeNull();
    expect(getUnitMark({ markId: 'hunt' }, null)).toBeNull();
    expect(getUnitMark({ markId: 'hunt' }, undefined)).toBeNull();
  });

  it('is never read from `unit.mark` (crest art owns that key)', () => {
    expect(getUnitMark({ mark: 'hunt' }, marks)).toBeNull();
  });
});

describe('the rate', () => {
  it('defaults to one in ten and honours the run’s markChance, clamped to [0, 1]', () => {
    expect(DEFAULT_MARK_CHANCE).toBe(0.1);
    expect(markChanceFor(null)).toBe(0.1);
    expect(markChanceFor({})).toBe(0.1);
    expect(markChanceFor({ markChance: undefined })).toBe(0.1);
    expect(markChanceFor({ markChance: 0.1667 })).toBe(0.1667);
    expect(markChanceFor({ markChance: 0.25 })).toBe(0.25);
    expect(markChanceFor({ markChance: 0 })).toBe(0);
    expect(markChanceFor({ markChance: 7 })).toBe(1);
    expect(markChanceFor({ markChance: -1 })).toBe(0);
  });

  it.each([
    [0.1, 'the base rate'],
    [0.1667, 'Marked Blood I'],
    [0.25, 'Marked Blood II'],
  ])('bears a Mark on about %s of recruits (%s)', (chance) => {
    const n = 6000;
    const bearers = names(n).filter((name) =>
      roll(name, { runSeed: 77, metaEffects: { markChance: chance } }),
    );
    expect(Math.abs(bearers.length - n * chance)).toBeLessThan(band(n, chance));
  });

  it('is exactly none at 0 and every recruit at 1', () => {
    for (const name of names(200)) {
      expect(roll(name, { runSeed: 5, metaEffects: { markChance: 0 } })).toBeNull();
      expect(roll(name, { runSeed: 5, metaEffects: { markChance: 1 } })).not.toBeNull();
    }
  });

  it('picks the five Marks evenly: about a fifth each of the bearers', () => {
    const n = 5000;
    const counts = Object.fromEntries(marks.map((m) => [m.id, 0]));
    for (const name of names(n))
      counts[roll(name, { runSeed: 9, metaEffects: { markChance: 1 } })]++;
    for (const id of Object.keys(counts))
      expect(Math.abs(counts[id] - n / 5), id).toBeLessThan(band(n, 0.2));
  });
});

describe('the roll’s stream', () => {
  it('is a function of run seed and name: the same pair always gives the same Mark', () => {
    for (const name of names(60)) {
      const first = roll(name, { runSeed: 1234, metaEffects: { markChance: 0.5 } });
      for (let i = 0; i < 3; i++)
        expect(roll(name, { runSeed: 1234, metaEffects: { markChance: 0.5 } })).toBe(first);
    }
  });

  it('changes with the run seed and with the name', () => {
    const at = (seed) =>
      names(80).map((name) => roll(name, { runSeed: seed, metaEffects: { markChance: 0.5 } }));
    expect(at(1)).not.toEqual(at(2));
    const unit = (name) => roll(name, { runSeed: 3, metaEffects: { markChance: 1 } });
    expect(new Set(names(60).map(unit)).size).toBeGreaterThan(1);
  });

  it('keys on the run seed as an unsigned 32-bit number, like the run’s other streams', () => {
    // -1 and 2^32 - 1 are the same seed once truncated, as `runSeed >>> 0` does elsewhere.
    expect(roll('Brant', { runSeed: -1, metaEffects: { markChance: 1 } })).toBe(
      roll('Brant', { runSeed: 2 ** 32 - 1, metaEffects: { markChance: 1 } }),
    );
    expect(markRng(5, 'Brant')()).toBe(markRng(5, 'Brant')());
    expect(markRng(5, 'Brant')()).not.toBe(markRng(5, 'Brent')());
  });

  it('never touches Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('the Mark roll must not draw from Math.random');
    });
    for (const name of names(40)) roll(name, { runSeed: 8, metaEffects: { markChance: 0.5 } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rolls nothing without a run seed, a catalog or a name, and clears a stale id', () => {
    const meta = { markChance: 1 };
    expect(roll('A', { runSeed: undefined, metaEffects: meta })).toBeNull();
    expect(roll('A', { runSeed: null, metaEffects: meta })).toBeNull();
    expect(roll('A', { runSeed: Number.NaN, metaEffects: meta })).toBeNull();
    expect(roll('A', { runSeed: 1, metaEffects: meta, marksData: null })).toBeNull();
    expect(roll('A', { runSeed: 1, metaEffects: meta, marksData: [] })).toBeNull();
    expect(roll('', { runSeed: 1, metaEffects: meta })).toBeNull();
    const stale = { name: 'A', markId: 'hunt' };
    rollMark(stale, { runSeed: 1, metaEffects: { markChance: 0 }, marksData: marks });
    expect(stale.markId).toBeUndefined();
  });
});

describe('a proc’s roll', () => {
  const withRoll = (value, fn) => {
    vi.spyOn(Math, 'random').mockReturnValue(value);
    return fn();
  };
  const hunt = () => getMarkDef('hunt', marks);

  it('fires below its percentage and not at it (Hunt: 15)', () => {
    expect(withRoll(0.1499, () => markProcs(hunt()))).toBe(true);
    expect(withRoll(0.15, () => markProcs(hunt()))).toBe(false);
    expect(withRoll(0.9999, () => markProcs(hunt()))).toBe(false);
  });

  it('never fires at chance 0, not even on a roll of 0', () => {
    expect(withRoll(0, () => markProcs({ ...hunt(), chance: 0 }))).toBe(false);
    expect(withRoll(0, () => markProcs({}))).toBe(false);
    expect(withRoll(0, () => markProcs(null))).toBe(false);
  });

  it('takes exactly one roll from the battle stream', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    markProcs(hunt());
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the strike activation and Road’s buff', () => {
  it('names a Mark’s activation `mark_<id>` and says which side it belongs to', () => {
    expect(markActivation(getMarkDef('hunt', marks))).toEqual({
      id: 'mark_hunt',
      name: 'Mark of the Hunt',
      mark: true,
    });
    expect(markActivation(getMarkDef('veil', marks), 'target')).toEqual({
      id: 'mark_veil',
      name: 'Mark of the Veil',
      mark: true,
      side: 'target',
    });
  });

  it('Road’s entry is +1 MOV until the enemy phase of the same turn begins', () => {
    const entry = roadBuffEntry({ name: 'Brant', faction: 'player' }, getMarkDef('road', marks), 3);
    expect(entry).toMatchObject({
      key: 'mark_road::Brant',
      expiryPhase: 'enemy',
      expiryTurn: 3,
      stats: { MOV: 1 },
      sourceFaction: 'player',
    });
  });
});
