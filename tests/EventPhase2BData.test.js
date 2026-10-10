// The Phase 2B vocabulary in data/events.json (docs/specs/event-nodes-phase2.md §2B): the three
// new burdens (their tables, their effect params) and the `dark` face, in the schema and the
// semantic validator. Each check is planted once: the shipped data must pass, then one bug at a
// time must fail for ITS reason.
//
// Ways a data edit goes wrong:
//   burdens   a burden with no definition, no battles, a wave out of range (turn, count, rewards),
//             a wound that is not a small negative, an onRung override that breaks the same rules
//   effects   a wound with no scope or stat, a stat that is not a stat (HP), a target scope on a
//             choice with no target, a wound in a contract's terms that names a target, a hunted
//             with a bad battle count
//   dark      `dark` that is not an object, has an unknown key, no intro, text over the limit, or a
//             face that soft-locks (every choice conditional) or has a page nothing leads to
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { baseData } from './eventKit.js';

const root = path.resolve(__dirname, '..');
const schema = JSON.parse(readFileSync(path.join(root, 'schemas', 'events.schema.json'), 'utf-8'));
const clone = () => structuredClone(baseData.events);
const validate = (config) => validateEventsConfig(config, baseData);
const event = (config, id) => config.events.find((e) => e.id === id);

function plant(mutate, needle) {
  const config = clone();
  mutate(config);
  const result = validate(config);
  expect(result.valid, `expected an error containing "${needle}"`).toBe(false);
  expect(result.errors.join('\n')).toContain(needle);
}

describe('the shipped Phase 2B data', () => {
  it('passes the validator and the schema', () => {
    expect(validate(clone()).errors).toEqual([]);
    const check = new Ajv({ allErrors: true }).compile(schema);
    expect(check(baseData.events), JSON.stringify(check.errors)).toBe(true);
  });

  it('defines all five burdens, gentler on First Light where the data says so', () => {
    const { burdens } = baseData.events;
    expect(Object.keys(burdens).sort()).toEqual([
      'debt',
      'hunted',
      'ill_omen',
      'sworn_enemy',
      'wounded',
    ]);
    expect(burdens.hunted.wave).toEqual({ turn: 3, count: [2, 2], xpMultiplier: 0.5 });
    expect(burdens.hunted.onRung.normal.wave.count).toEqual([1, 2]);
    expect(burdens.hunted.onRung.lunatic.wave.count).toEqual([2, 3]);
    expect(burdens.wounded).toMatchObject({ battles: 3, value: -2 });
    expect(burdens.wounded.onRung.normal.battles).toBe(2);
  });
});

describe('burden tables', () => {
  it('a burden left undefined', () =>
    plant((c) => delete c.burdens.hunted, 'burden "hunted" is not defined'));
  it('an unknown burden defined', () =>
    plant((c) => (c.burdens.curse = { label: 'Curse' }), 'unknown burden "curse"'));
  it('a Hunted with no wave', () =>
    plant((c) => delete c.burdens.hunted.wave, 'burdens.hunted: needs a `wave`'));
  it('a wave turn out of range', () =>
    plant((c) => (c.burdens.hunted.wave.turn = 13), 'wave.turn must be 1-12'));
  it('a wave count that is backwards or too large', () => {
    plant((c) => (c.burdens.hunted.wave.count = [3, 2]), 'wave.count must be [min, max]');
    plant((c) => (c.burdens.hunted.wave.count = [1, 9]), 'wave.count must be [min, max]');
  });
  it('wave rewards out of 0-1', () =>
    plant((c) => (c.burdens.hunted.wave.xpMultiplier = 1.5), 'wave.xpMultiplier must be 0-1'));
  it('a rung override that breaks the same rules', () =>
    plant(
      (c) => (c.burdens.hunted.onRung.lunatic.wave.count = [0, 2]),
      'burdens.hunted.onRung.lunatic: wave.count must be',
    ));
  it('battles that are not whole numbers from 1', () => {
    plant((c) => (c.burdens.wounded.battles = 0), 'battles must be a whole number >= 1');
    plant((c) => delete c.burdens.hunted.battles, 'burdens.hunted: needs `battles`');
  });
  it('a wound that is not a small negative', () => {
    plant((c) => (c.burdens.wounded.value = 2), 'value must be a whole number from -5 to -1');
    plant((c) => (c.burdens.wounded.value = -9), 'value must be a whole number from -5 to -1');
  });
  it('the schema refuses a stray field and a positive wound', () => {
    const check = new Ajv({ allErrors: true }).compile(schema);
    const config = clone();
    config.burdens.wounded.value = 2;
    expect(check(config)).toBe(false);
    const stray = clone();
    stray.burdens.hunted.secret = true;
    expect(check(stray)).toBe(false);
  });
});

describe('burden effects', () => {
  const wound = (params) => ({ type: 'burden', id: 'wounded', params });
  /** Put an effect on the Drill Yard's rest choice (it has no target). */
  const rest = (c) => event(c, 'drill_yard').choices.find((x) => x.id === 'rest').outcomes[0];

  it('a wound with a scope and a stat is fine; `attack` and `random` are stats too', () => {
    for (const stat of ['STR', 'random', 'attack']) {
      const config = clone();
      rest(config).effects = [wound({ scope: 'randomUnit', stat })];
      expect(validate(config).errors).toEqual([]);
    }
  });
  it('a wound with no scope', () =>
    plant((c) => (rest(c).effects = [wound({ stat: 'STR' })]), 'wounded needs params.scope'));
  it('a wound with no stat, or HP', () => {
    plant((c) => (rest(c).effects = [wound({ scope: 'randomUnit' })]), 'wounded needs params.stat');
    plant(
      (c) => (rest(c).effects = [wound({ scope: 'randomUnit', stat: 'HP' })]),
      'wounded needs params.stat',
    );
  });
  it('a target scope on a choice with nobody to target', () =>
    plant(
      (c) => (rest(c).effects = [wound({ scope: 'target', stat: 'STR' })]),
      'reads the chosen unit but the choice has no target',
    ));
  it('a wound that is not a small negative, or lasts no battles', () => {
    plant(
      (c) => (rest(c).effects = [wound({ scope: 'randomUnit', stat: 'STR', value: 3 })]),
      'wounded.value must be',
    );
    plant(
      (c) => (rest(c).effects = [wound({ scope: 'randomUnit', stat: 'STR', battles: 0 })]),
      'wounded.battles must be a positive whole number',
    );
  });
  it('a Hunted with a bad battle count', () =>
    plant(
      (c) => (rest(c).effects = [{ type: 'burden', id: 'hunted', params: { battles: 0 } }]),
      'hunted.battles must be a positive whole number',
    ));
  it('a contract may not wound a chosen unit', () =>
    plant(
      (c) =>
        (rest(c).effects = [
          {
            type: 'contract',
            goal: 'underPar',
            reward: [],
            penalty: [wound({ scope: 'target', stat: 'STR' })],
          },
        ]),
      'reads the chosen unit but the choice has no target',
    ));
  it('a contract may wound a seeded unit', () => {
    const config = clone();
    rest(config).effects = [
      {
        type: 'contract',
        goal: 'underPar',
        reward: [],
        penalty: [wound({ scope: 'randomUnit', stat: 'random' })],
      },
    ];
    expect(validate(config).errors).toEqual([]);
  });
});

describe('the dark face', () => {
  const dark = (c, id = 'drill_yard') => event(c, id).dark;

  it('is not an object', () =>
    plant((c) => (event(c, 'drill_yard').dark = 'dark'), '`dark` must be an object'));
  it('has an unknown key', () =>
    plant((c) => (dark(c).title = 'Darker'), 'drill_yard.dark: unknown key "title"'));
  it('has no intro, or one over the limit', () => {
    plant((c) => delete dark(c).intro, 'drill_yard.dark: intro is missing');
    plant((c) => (dark(c).intro = 'x'.repeat(300)), 'drill_yard.dark: intro is 300 characters');
  });
  it('has no choices', () =>
    plant((c) => delete dark(c).choices, 'drill_yard.dark: needs at least one choice'));
  it('soft-locks: every choice needs something', () =>
    plant((c) => {
      for (const choice of dark(c).choices) choice.requires = { goldAtLeast: 99999 };
    }, 'drill_yard.dark: no choice is always available'));
  it('is checked as hard as the plain face: an unknown effect, a long label', () => {
    plant((c) => (dark(c).choices[0].outcomes[0].effects[0].type = 'teleport'), 'unknown effect');
    plant((c) => (dark(c).choices[0].label = 'L'.repeat(40)), 'label is 40 characters');
  });
  it('has a page nothing leads to', () =>
    plant(
      (c) =>
        (dark(c).pages = {
          orphan: { text: 'Nobody comes here.', choices: dark(c).choices.slice(2) },
        }),
      'no outcome leads to this page',
    ));
  it('the schema refuses a dark block with no intro or an unknown key', () => {
    const check = new Ajv({ allErrors: true }).compile(schema);
    const noIntro = clone();
    delete dark(noIntro).intro;
    expect(check(noIntro)).toBe(false);
    const stray = clone();
    dark(stray).extra = 1;
    expect(check(stray)).toBe(false);
  });
});
