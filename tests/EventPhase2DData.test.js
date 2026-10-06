// The Phase 2D vocabulary in data/events.json, in the schema and the semantic validator
// (`npm run validate:data`): accessory pools, `stat: 'best'`, forge / wear / mend with their
// target filters, a gold refund, an elite or recruit battle, `requires.notContract`, and an
// outcome only a rung brings.
//
// A good fixture must pass; then one bug at a time must fail for ITS reason. Ways a data edit
// goes wrong:
//   accessory   a tier far above the table, a `weaponTypes`, a `wear` or a `to` on an accessory, a
//               pool kind that is neither weapon nor accessory
//   best stat   "best" beside other stats, an unknown stat name
//   forge       no `forgeableWeapon` filter on the choice (the plan could come up empty), a stat the
//               forge has not got
//   wear        no fallback (a forged blade does not wear), a fallback holding a forge or mend
//   mend        no `wornWeapon` filter
//   one weapon  two forge/wear/mend in one outcome
//   refund      a value beside it, no price to give back, a choice-level refund
//   battle      an unknown elite value, a recruit that is a boss/enemy-only/promoted-out-of-pool class,
//               both or neither of class/classPool, a long name, a stray key
//   requires    notContract that is not true; filters that are not booleans
//   weights     weight 0 with no rung to bring it; a rung where no outcome has weight
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { baseData } from './eventKit.js';

const root = path.resolve(__dirname, '..');
const schema = JSON.parse(readFileSync(path.join(root, 'schemas', 'events.schema.json'), 'utf-8'));

const forgeable = { forgeableWeapon: true, living: true };
const worn = { wornWeapon: true, living: true };

/** One event that uses every Phase 2D feature correctly. */
const goodEvent = () => ({
  id: 'phase2d_fixture',
  title: 'Everything At Once',
  acts: ['act2', 'act3'],
  weight: 1,
  requires: { notContract: true },
  intro: 'A forge, a shelf and a stranger at a crossroads.',
  choices: [
    {
      id: 'relic',
      label: 'Take the relic',
      outcomes: [
        {
          id: 'taken',
          weight: 100,
          text: 'It is warm.',
          effects: [{ type: 'item', pool: { kind: 'accessory', tierOffset: 1 } }],
        },
      ],
    },
    {
      id: 'feed',
      label: 'Feed the dark',
      target: { prompt: 'Who?', filter: { living: true } },
      outcomes: [
        {
          id: 'fed',
          weight: 100,
          text: 'It feeds.',
          effects: [
            { type: 'stat', stat: 'best', value: 2, scope: 'target' },
            { type: 'stat', stat: 'HP', value: -3, scope: 'target' },
          ],
        },
      ],
    },
    {
      id: 'temper',
      label: 'Temper a weapon',
      target: { prompt: 'Whose?', filter: { ...forgeable } },
      outcomes: [
        { id: 'good', weight: 70, text: 'Good.', effects: [{ type: 'forge', stat: 'random' }] },
        {
          id: 'hot',
          weight: 30,
          text: 'Hot.',
          effects: [{ type: 'wear' }],
          fallbackText: 'Burnt.',
          fallback: [{ type: 'hp', mode: 'damage', percent: 15, scope: 'target' }],
        },
      ],
    },
    {
      id: 'mend',
      label: 'Mend a weapon',
      cost: { gold: { base: 100, perAct: 50 } },
      target: { prompt: 'Whose?', filter: { ...worn } },
      outcomes: [{ id: 'mended', weight: 100, text: 'Mended.', effects: [{ type: 'mend' }] }],
    },
    {
      id: 'guide',
      label: 'Hire a guide',
      cost: { gold: { base: 100, perAct: 50 } },
      outcomes: [
        {
          id: 'drawn',
          weight: 100,
          text: 'Drawn.',
          effects: [{ type: 'routeEdit', op: 'addRoad' }],
          fallbackText: 'Nothing to add.',
          fallback: [{ type: 'gold', refund: true }],
        },
      ],
    },
    {
      id: 'fight',
      label: 'Fight',
      outcomes: [
        {
          id: 'fought',
          weight: 100,
          text: 'Blades.',
          effects: [
            {
              type: 'battle',
              enemyLevelBonus: 1,
              elite: true,
              recruit: { classPool: ['Mercenary', 'Fighter'], name: 'Old Wen' },
              victoryText: 'Won.',
              afterVictory: [{ type: 'gold', value: 50 }],
            },
          ],
        },
      ],
    },
    {
      id: 'trust',
      label: 'Trust him',
      tells: [{ when: { class: 'Thief' }, line: '{name}: He is lying.', reveals: 'liar' }],
      outcomes: [
        { id: 'kind', weight: 100, weightByRung: { lunatic: 65 }, text: 'Kind.', effects: [] },
        { id: 'liar', weight: 0, weightByRung: { lunatic: 35 }, text: 'Lies.', effects: [] },
      ],
    },
    {
      id: 'leave',
      label: 'Walk on',
      outcomes: [{ id: 'gone', weight: 100, text: 'Gone.', effects: [] }],
    },
  ],
});

const withFixture = (mutate = () => {}) => {
  const config = structuredClone(baseData.events);
  const event = goodEvent();
  config.events.push(event);
  mutate(event, config);
  return config;
};
const validate = (config) => validateEventsConfig(config, baseData);
const choiceOf = (event, id) => event.choices.find((c) => c.id === id);
const outcomeOf = (event, choiceId, outcomeId) =>
  choiceOf(event, choiceId).outcomes.find((o) => o.id === outcomeId);
const effectOf = (event, choiceId, outcomeId, type) =>
  outcomeOf(event, choiceId, outcomeId).effects.find((e) => e.type === type);

/** Plant one bug in the good fixture: the validator must fail and name `needle`. */
function plant(mutate, needle) {
  const result = validate(withFixture(mutate));
  expect(result.valid, `expected an error containing "${needle}"`).toBe(false);
  expect(result.errors.join('\n')).toContain(needle);
}

describe('a Phase 2D event written correctly', () => {
  it('passes the semantic checks and the schema, and the shipped data still does', () => {
    expect(validate(withFixture()).errors).toEqual([]);
    expect(validate(structuredClone(baseData.events)).errors).toEqual([]);
    const ajv = new Ajv({ allErrors: true });
    const check = ajv.compile(schema);
    expect(check(withFixture()), JSON.stringify(check.errors)).toBe(true);
  });

  it('the schema knows the new effect types and requirement', () => {
    const types = schema.$defs.effect.properties.type.enum;
    for (const type of ['forge', 'wear', 'mend']) expect(types).toContain(type);
    expect(schema.$defs.requires.properties.notContract).toEqual({ type: 'boolean' });
  });
});

describe('accessory pools', () => {
  it('a tier offset beyond 0-3', () => {
    plant(
      (e) => (effectOf(e, 'relic', 'taken', 'item').pool.tierOffset = 4),
      'tierOffset must be 0-3',
    );
    plant(
      (e) => (effectOf(e, 'relic', 'taken', 'item').pool.tierOffset = -1),
      'tierOffset must be 0-3',
    );
  });
  it('weaponTypes, wear and `to` mean nothing on an accessory', () => {
    plant(
      (e) => (effectOf(e, 'relic', 'taken', 'item').pool.weaponTypes = '$army'),
      'no weaponTypes',
    );
    plant((e) => (effectOf(e, 'relic', 'taken', 'item').wear = 1), 'does not wear');
    plant((e) => (effectOf(e, 'relic', 'taken', 'item').to = 'target'), 'no `to`');
  });
  it('a pool kind that is neither weapon nor accessory', () => {
    plant(
      (e) => (effectOf(e, 'relic', 'taken', 'item').pool.kind = 'potion'),
      'must be "weapon" or "accessory"',
    );
  });
  it('an act whose table has nothing at that tier is refused', () => {
    const config = withFixture();
    config.events.at(-1);
    const result = validateEventsConfig(config, { ...baseData, lootTables: { ...baseData.lootTables, act3: { ...baseData.lootTables.act3, accessories: [] } } }); // prettier-ignore
    expect(result.errors.join('\n')).toContain("no accessory exists in act2's pool at that tier");
  });
  it('an accessory grant needs no room: the choice may stay "always available"', () => {
    // Without any other free choice the relic choice alone must satisfy the soft-lock rule.
    const config = withFixture((e) => (e.choices = [choiceOf(e, 'relic')]));
    expect(validate(config).errors).toEqual([]);
    // A weapon grant in its place is conditional (it needs room): no always-available choice.
    const weapon = withFixture((e) => {
      e.choices = [choiceOf(e, 'relic')];
      effectOf(e, 'relic', 'taken', 'item').pool = { kind: 'weapon', weaponTypes: '$army' };
    });
    expect(validate(weapon).errors.join('\n')).toContain('no choice is always available');
  });
});

describe("stat 'best'", () => {
  it('"best" stands alone', () => {
    plant((e) => (effectOf(e, 'feed', 'fed', 'stat').stat = ['best', 'STR']), 'or "best"');
  });
  it('an unknown stat name', () => {
    plant((e) => (effectOf(e, 'feed', 'fed', 'stat').stat = 'LUCK'), 'stat must be one or more of');
  });
});

describe('forge, wear, mend', () => {
  it('a forge needs the forgeableWeapon filter on its choice', () => {
    plant(
      (e) => delete choiceOf(e, 'temper').target.filter.forgeableWeapon,
      'needs the choice target filter `forgeableWeapon`',
    );
  });
  it('a forge names a stat the forge has', () => {
    plant((e) => (effectOf(e, 'temper', 'good', 'forge').stat = 'range'), 'forge.stat must be');
  });
  it('a wear needs a fallback', () => {
    plant((e) => {
      delete outcomeOf(e, 'temper', 'hot').fallback;
      delete outcomeOf(e, 'temper', 'hot').fallbackText;
    }, 'needs a `fallback`');
  });
  it('a fallback cannot hold a forge, a wear or a mend (nothing further to fall back to)', () => {
    for (const type of ['forge', 'wear', 'mend'])
      plant(
        (e) => (outcomeOf(e, 'temper', 'hot').fallback = [{ type }]),
        `a fallback cannot hold a ${type}`,
      );
  });
  it('a mend needs the wornWeapon filter', () => {
    plant(
      (e) => delete choiceOf(e, 'mend').target.filter.wornWeapon,
      'needs the choice target filter `wornWeapon`',
    );
  });
  it('they read the chosen unit: a choice with no target is refused', () => {
    plant(
      (e) => delete choiceOf(e, 'mend').target,
      'reads the chosen unit but the choice has no target',
    );
  });
  it('at most one of them per outcome (they work on one weapon)', () => {
    plant(
      (e) => outcomeOf(e, 'temper', 'good').effects.push({ type: 'wear' }),
      'at most one forge, wear or mend per outcome',
    );
  });
  it('the filters are true/false', () => {
    plant(
      (e) => (choiceOf(e, 'mend').target.filter.wornWeapon = 'yes'),
      'filter.wornWeapon must be true or false',
    );
    plant(
      (e) => (choiceOf(e, 'temper').target.filter.forgeableWeapon = 1),
      'filter.forgeableWeapon must be true or false',
    );
  });
});

describe('a gold refund', () => {
  const refund = (e) => outcomeOf(e, 'guide', 'drawn').fallback[0];
  it('stands alone: no value beside it', () => {
    plant((e) => (refund(e).value = 10), 'gold.refund must be true and then stands alone');
    plant((e) => (refund(e).refund = false), 'gold.refund must be true and then stands alone');
  });
  it('needs a price to give back', () => {
    plant((e) => delete choiceOf(e, 'guide').cost, 'gold.refund needs a choice with a cost');
  });
  it('belongs in an outcome, never a choice-level effect', () => {
    plant(
      (e) => (choiceOf(e, 'guide').effects = [{ type: 'gold', refund: true }]),
      'belongs in an outcome or its fallback',
    );
  });
});

describe('battles: elite and recruit', () => {
  const battle = (e) => effectOf(e, 'fight', 'fought', 'battle');
  it('elite is true or false', () => {
    plant((e) => (battle(e).elite = 'yes'), 'battle.elite must be true or false');
  });
  it('a recruit needs exactly one of class and classPool', () => {
    plant((e) => (battle(e).recruit = {}), 'needs exactly one of class, classPool');
    plant(
      (e) => (battle(e).recruit = { class: 'Fighter', classPool: ['Archer'] }),
      'needs exactly one of class, classPool',
    );
  });
  it('a recruit class must be one a recruit can be, in every act the choice can play in', () => {
    plant(
      (e) => (battle(e).recruit = { class: 'Hero' }),
      'battle.recruit: "Hero" is not in act2\'s recruit pool',
    );
    plant((e) => (battle(e).recruit = { class: 'Entity' }), 'battle.recruit:');
    plant((e) => (battle(e).recruit = { class: 'Zombie' }), 'battle.recruit:');
    plant((e) => (battle(e).recruit = { class: 'Edric' }), 'battle.recruit: unknown class');
  });
  it('a name is short, and nothing else is a key', () => {
    plant(
      (e) => (battle(e).recruit.name = 'x'.repeat(21)),
      'battle.recruit.name must be 1-20 characters',
    );
    plant((e) => (battle(e).recruit.lord = true), 'unknown battle.recruit key "lord"');
  });
  it('a recruit battle cannot sit in the spoils of a battle', () => {
    plant(
      (e) => (battle(e).afterVictory = [structuredClone(battle(e))]),
      'a battle cannot start inside a battle',
    );
  });
});

describe('requires.notContract', () => {
  it('must be true', () => {
    plant((e) => (e.requires.notContract = false), '`requires.notContract` must be true');
    plant((e) => (e.requires.notContract = 'yes'), '`requires.notContract` must be true');
  });
});

describe('requires.roadAhead', () => {
  it('must be true', () => {
    plant(
      (e) => (choiceOf(e, 'guide').requires = { roadAhead: false }),
      '`requires.roadAhead` must be true',
    );
  });
  it('a choice that needs a road is not "always available" (it can be greyed)', () => {
    const only = withFixture((e) => {
      e.choices = [choiceOf(e, 'guide')];
      delete choiceOf(e, 'guide').cost;
      choiceOf(e, 'guide').requires = { roadAhead: true };
      outcomeOf(e, 'guide', 'drawn').fallback = [];
    });
    expect(validate(only).errors.join('\n')).toContain('no choice is always available');
  });
});

describe('an outcome only a rung brings', () => {
  it('weight 0 with no rung table is refused (nothing could ever bring it)', () => {
    plant(
      (e) => delete outcomeOf(e, 'trust', 'liar').weightByRung,
      'weight must be a positive number',
    );
  });
  it('a negative weight is refused whatever the table says', () => {
    plant((e) => (outcomeOf(e, 'trust', 'liar').weight = -1), 'weight must be a positive number');
  });
  it('a rung where no outcome could be rolled is refused, naming the rung', () => {
    plant((e) => {
      // Normal: kind and liar both 0.
      outcomeOf(e, 'trust', 'kind').weight = 0;
      outcomeOf(e, 'trust', 'kind').weightByRung = { hard: 10 };
    }, 'no outcome has a positive weight on normal');
  });
  it('a tell may reveal an outcome only a rung brings, but not one that can never happen', () => {
    expect(validate(withFixture()).errors).toEqual([]); // the fixture already does
    plant((e) => {
      delete outcomeOf(e, 'trust', 'liar').weightByRung;
      outcomeOf(e, 'trust', 'liar').weight = 0;
    }, 'reveals names an outcome that cannot happen');
  });
});
