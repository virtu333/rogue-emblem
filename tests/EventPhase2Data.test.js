// The Phase 2 event vocabulary in data/events.json (docs/specs/event-nodes-phase2.md §2A): pages,
// counters, join, contract, routeEdit, roster tells and flag acts, in the schema and the
// semantic validator (`npm run validate:data`).
//
// Every new check is planted once below (a good fixture must pass; then one bug at a time must
// fail for ITS reason). Ways a data edit goes wrong:
//   pages      a page called `start` or with no text/choices; `next` naming no page or sitting
//              beside a battle; an orphan page; a loop with no guaranteed way out
//   counters   a bad number, a rung table or label for a counter that does not exist, a counter
//              effect or requirement on one that does not exist, a counter requirement on the event
//   join       an unknown, enemy-only, boss, lord or promoted-out-of-pool class; neither or both of
//              class / classPool; a bad name, level offset or trait
//   contract   a bad goal, a term that needs a chosen unit, a battle or a second contract
//              beside it, a contract in a battle's spoils
//   routeEdit  a bad op or type, one outside an outcome, with no fallback, or twice
//   tells      a `when` that names nothing real, a long line or a stray token, `reveals` a lie (an
//              outcome the choice lacks or that cannot happen) or on a check choice, `tilts` on a
//              plain choice, both or neither
//   flags      `flagAct` without `flag` or with a word that is not an act
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { validateEventsConfig, EVENT_TEXT_LIMITS } from '../src/engine/EventValidation.js';
import { baseData } from './eventKit.js';

const root = path.resolve(__dirname, '..');
const schema = JSON.parse(readFileSync(path.join(root, 'schemas', 'events.schema.json'), 'utf-8'));

/** One event that uses every Phase 2 feature correctly. */
const goodEvent = () => ({
  id: 'phase2_fixture',
  title: 'Everything At Once',
  acts: ['act2', 'act3'],
  weight: 1,
  intro: 'A crossroads with a table, a map and a captain.',
  counters: { torches: 3 },
  countersByRung: { torches: { lunatic: 2 } },
  counterLabels: { torches: 'Torches' },
  choices: [
    {
      id: 'sign',
      label: 'Sign the paper',
      outcomes: [
        {
          id: 'signed',
          weight: 100,
          text: 'Ink dries.',
          effects: [
            {
              type: 'contract',
              goal: 'underPar',
              reward: [
                { type: 'gold', value: { base: 100, perAct: 100 } },
                { type: 'item', pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 1 } },
              ],
              penalty: [{ type: 'burden', id: 'debt', params: { owed: 300 } }],
            },
          ],
        },
      ],
    },
    {
      id: 'map',
      label: 'Buy a road',
      outcomes: [
        {
          id: 'drawn',
          weight: 100,
          text: 'She draws.',
          effects: [{ type: 'routeEdit', op: 'addRoad' }],
          fallbackText: 'No road to draw.',
          fallback: [{ type: 'gold', value: 5 }],
        },
        {
          id: 'redrawn',
          weight: 10,
          text: 'She redraws.',
          effects: [{ type: 'routeEdit', op: 'redraw', toType: 'shop' }],
          fallback: [{ type: 'gold', value: 5 }],
        },
      ],
    },
    {
      id: 'hire',
      label: 'Hire the deserter',
      outcomes: [
        {
          id: 'hired',
          weight: 100,
          text: 'He joins.',
          effects: [
            { type: 'join', classPool: ['Mercenary', 'Fighter'], levelOffset: -1, trait: 'hardy' },
          ],
        },
      ],
    },
    {
      id: 'deeper',
      label: 'Go deeper',
      requires: { counterAtLeast: { key: 'torches', n: 1 } },
      effects: [{ type: 'counter', key: 'torches', delta: -1 }],
      outcomes: [{ id: 'down', weight: 100, text: 'Down.', next: 'cellar', effects: [] }],
    },
    {
      id: 'bluff',
      label: 'Bluff',
      check: { stats: ['LCK'], of: 'bestInArmy', base: 0.4, perPoint: 0.03, against: 8 },
      tells: [{ when: { class: 'Thief' }, line: '{name}: Let me talk.', tilts: 'pass' }],
      outcomes: [
        { id: 'pass', text: 'They believe you.', effects: [] },
        { id: 'fail', text: 'They do not.', effects: [] },
      ],
    },
    {
      id: 'search',
      label: 'Search the tent',
      tells: [
        { when: { class: 'Thief' }, line: '{name}: That is a tripwire.', reveals: 'tripwire' },
        {
          when: { classes: ['Archer', 'Sniper'] },
          line: '{name}: Someone watches.',
          reveals: 'cache',
        },
        { when: { weaponType: 'Staff' }, line: '{name}: It is the well.', reveals: 'cache' },
        { when: { trait: 'hardy' }, line: '{name}: Worse before.', reveals: 'cache' },
        { when: { skill: 'vantage' }, line: '{name}: High ground.', reveals: 'cache' },
      ],
      outcomes: [
        { id: 'cache', weight: 55, text: 'A cache.', effects: [] },
        { id: 'tripwire', weight: 45, text: 'A wire.', effects: [] },
      ],
    },
    {
      id: 'old_debt',
      label: 'Call in the favour',
      requires: { flag: 'spared_deserters', flagAct: 'earlier' },
      outcomes: [{ id: 'paid', weight: 100, text: 'Paid.', effects: [] }],
    },
    {
      id: 'leave',
      label: 'Walk on',
      outcomes: [{ id: 'gone', weight: 100, text: 'Gone.', effects: [] }],
    },
  ],
  pages: {
    cellar: {
      text: 'A cellar. The torch gutters.',
      choices: [
        {
          id: 'deeper',
          label: 'Deeper still',
          requires: { counterAtLeast: { key: 'torches', n: 1 } },
          effects: [{ type: 'counter', key: 'torches', delta: -1 }],
          outcomes: [
            { id: 'again', weight: 50, text: 'Again.', next: 'cellar', effects: [] },
            { id: 'out', weight: 50, text: 'Out.', effects: [] },
          ],
        },
        {
          id: 'climb',
          label: 'Climb out',
          outcomes: [{ id: 'out', weight: 100, text: 'Daylight.', effects: [] }],
        },
      ],
    },
  },
});

const withFixture = (mutate = () => {}) => {
  const config = structuredClone(baseData.events);
  const event = goodEvent();
  config.events.push(event);
  mutate(event, config);
  return config;
};
const validate = (config) => validateEventsConfig(config, baseData);
const page = (event, id = 'start') => (id === 'start' ? event : event.pages[id]);
const choiceOf = (event, id, pageId = 'start') =>
  page(event, pageId).choices.find((c) => c.id === id);
const outcomeOf = (event, choiceId, outcomeId, pageId = 'start') =>
  choiceOf(event, choiceId, pageId).outcomes.find((o) => o.id === outcomeId);

/** Plant one bug in the good fixture: the validator must fail and name `needle`. */
function plant(mutate, needle) {
  const result = validate(withFixture(mutate));
  expect(result.valid, `expected an error containing "${needle}"`).toBe(false);
  expect(result.errors.join('\n')).toContain(needle);
}

describe('a Phase 2 event written correctly', () => {
  it('passes the semantic checks and the schema, and the shipped data still does', () => {
    expect(validate(withFixture()).errors).toEqual([]);
    expect(validate(structuredClone(baseData.events)).errors).toEqual([]);
    const ajv = new Ajv({ allErrors: true });
    const check = ajv.compile(schema);
    expect(check(withFixture()), JSON.stringify(check.errors)).toBe(true);
  });

  it('the schema refuses a Phase 2 field of the wrong shape', () => {
    const ajv = new Ajv({ allErrors: true });
    const check = ajv.compile(schema);
    const bad = (mutate) => {
      const config = withFixture(mutate);
      return check(config);
    };
    expect(bad((e) => (e.counters.torches = -1))).toBe(false);
    expect(bad((e) => (e.pages.cellar.text = ''))).toBe(false);
    expect(bad((e) => delete e.pages.cellar.choices)).toBe(false);
    expect(bad((e) => (e.choices[3].requires.counterAtLeast.n = 0))).toBe(false);
    expect(bad((e) => (e.choices[6].requires.flagAct = 'sometime'))).toBe(false);
    expect(
      bad((e) => (choiceOf(e, 'search').tells[0].when = { class: 'Thief', trait: 'hardy' })),
    ).toBe(false);
    expect(bad((e) => (choiceOf(e, 'bluff').tells[0].tilts = 'fail'))).toBe(false);
    expect(bad((e) => (outcomeOf(e, 'deeper', 'down').next = 'Not An Id'))).toBe(false);
    expect(bad((e) => (outcomeOf(e, 'sign', 'signed').effects[0].type = 'teleport'))).toBe(false);
  });

  it('every Phase 2 effect type is in the schema (the shipped list is the engine list)', () => {
    const types = schema.$defs.effect.properties.type.enum;
    for (const type of ['counter', 'join', 'contract', 'routeEdit']) expect(types).toContain(type);
  });
});

describe('pages', () => {
  it('a page may not be called start', () => {
    plant((e) => {
      e.pages.start = structuredClone(e.pages.cellar);
    }, 'page id must be lower_snake_case and not "start"');
  });
  it('a page needs text', () => {
    plant((e) => (e.pages.cellar.text = ''), 'text is missing');
    plant((e) => (e.pages.cellar.text = 'x'.repeat(EVENT_TEXT_LIMITS.intro + 1)), 'text is');
  });
  it('a page needs a choice', () => {
    plant((e) => (e.pages.cellar.choices = []), 'needs at least one choice');
  });
  it('next must name a page of the event', () => {
    plant((e) => (outcomeOf(e, 'deeper', 'down').next = 'nowhere'), 'next must name a page');
    plant((e) => (outcomeOf(e, 'deeper', 'down').next = 'start'), 'next must name a page');
  });
  it('an outcome that starts a battle cannot lead on', () => {
    plant((e) => {
      const outcome = outcomeOf(e, 'deeper', 'down');
      outcome.effects = [{ type: 'battle', victoryText: 'Won.', afterVictory: [] }];
    }, 'cannot also lead on');
  });
  it('a page nothing leads to is refused', () => {
    plant(
      (e) => (outcomeOf(e, 'deeper', 'down').next = undefined),
      'no outcome leads to this page',
    );
  });
  it('a page with no always-available way out is refused (a loop the player cannot leave)', () => {
    plant((e) => {
      // the only unconditional choice always goes round again
      e.pages.cellar.choices = [
        {
          id: 'again',
          label: 'Again',
          outcomes: [{ id: 'round', weight: 100, text: 'Round.', next: 'cellar', effects: [] }],
        },
      ];
    }, 'no guaranteed way out');
  });
  it('a loop is fine while one choice always ends it', () => {
    const result = validate(
      withFixture((e) => {
        e.pages.cellar.choices.push({
          id: 'again',
          label: 'Again',
          outcomes: [{ id: 'round', weight: 100, text: 'Round.', next: 'cellar', effects: [] }],
        });
      }),
    );
    expect(result.errors).toEqual([]);
  });
  it('a page whose every choice can be blocked soft-locks', () => {
    plant(
      (e) => (e.pages.cellar.choices = [e.pages.cellar.choices[0]]),
      'no choice is always available',
    );
  });
  it('a chain of pages must reach an end: A -> B -> A with nothing else leaves the player circling', () => {
    plant((e) => {
      e.pages.cellar.choices = [
        {
          id: 'on',
          label: 'On',
          outcomes: [{ id: 'o', weight: 100, text: 'On.', next: 'vault', effects: [] }],
        },
      ];
      e.pages.vault = {
        text: 'A vault.',
        choices: [
          {
            id: 'back',
            label: 'Back',
            outcomes: [{ id: 'o', weight: 100, text: 'Back.', next: 'cellar', effects: [] }],
          },
        ],
      };
    }, 'no guaranteed way out');
  });
  it('duplicate choice ids are fine across pages, refused within one', () => {
    expect(validate(withFixture()).errors).toEqual([]); // `deeper` is on two pages
    plant(
      (e) => e.pages.cellar.choices.push(structuredClone(e.pages.cellar.choices[1])),
      'duplicate choice id',
    );
  });
});

describe('counters', () => {
  it('a counter is a whole number from 0', () => {
    plant((e) => (e.counters.torches = -1), 'must be a whole number >= 0');
    plant((e) => (e.counters.torches = 1.5), 'must be a whole number >= 0');
    plant((e) => (e.counters.Torches = 2), 'must be lower_snake_case');
  });
  it('a rung table or a label names a declared counter', () => {
    plant(
      (e) => (e.countersByRung.candles = { hard: 1 }),
      'names a counter the event does not declare ("candles")',
    );
    plant(
      (e) => (e.counterLabels.candles = 'Candles'),
      'names a counter the event does not declare ("candles")',
    );
    plant((e) => (e.countersByRung.torches.black = 1), 'unknown rung "black"');
    plant((e) => (e.countersByRung.torches.hard = -1), 'must be a whole number >= 0');
    plant(
      (e) => (e.counterLabels.torches = 'A label far too long to draw'),
      'counterLabels.torches must be',
    );
  });
  it('a counter effect needs a declared counter and a real delta', () => {
    plant(
      (e) => (choiceOf(e, 'deeper').effects[0].key = 'candles'),
      'does not declare ("candles")',
    );
    plant(
      (e) => (choiceOf(e, 'deeper').effects[0].delta = 0),
      'counter.delta must be a non-zero whole number',
    );
    plant(
      (e) => (choiceOf(e, 'deeper').effects[0].delta = 0.5),
      'counter.delta must be a non-zero whole number',
    );
  });
  it('counterAtLeast needs a declared counter, a whole n >= 1, and a choice to sit on', () => {
    plant(
      (e) => (choiceOf(e, 'deeper').requires.counterAtLeast.key = 'candles'),
      'counterAtLeast names a counter the event does not declare',
    );
    plant((e) => (choiceOf(e, 'deeper').requires.counterAtLeast.n = 0), 'must be { key, n }');
    plant(
      (e) => (e.requires = { counterAtLeast: { key: 'torches', n: 1 } }),
      'an event cannot require a counter',
    );
  });
});

describe('join', () => {
  const join = (e) => outcomeOf(e, 'hire', 'hired').effects[0];
  it('needs exactly one of class and classPool', () => {
    plant((e) => (join(e).class = 'Fighter'), 'exactly one of class, classPool');
    plant((e) => {
      delete join(e).classPool;
    }, 'exactly one of class, classPool');
    plant((e) => (join(e).classPool = []), 'non-empty list of class names');
  });
  it('refuses a class a recruit cannot be', () => {
    plant((e) => (join(e).classPool = ['Wizard']), 'unknown class "Wizard"');
    plant((e) => (join(e).classPool = ['Zombie']), 'enemy-only');
    plant((e) => (join(e).classPool = ['Entity']), 'boss class');
    plant((e) => (join(e).classPool = ['Lord']), "no act's recruit pool");
    plant((e) => (join(e).classPool = ['Great Lord']), "no act's recruit pool");
  });
  it('a promoted class must be in the pool of every act the choice can play in', () => {
    // Hero is in Acts III and IV; the event plays in Acts II and III
    plant((e) => (join(e).classPool = ['Hero']), "not in act2's recruit pool");
    // narrowing the choice to Act III makes it valid
    const ok = validate(
      withFixture((e) => {
        join(e).classPool = ['Hero'];
        choiceOf(e, 'hire').requires = { acts: ['act3'] };
      }),
    );
    expect(ok.errors).toEqual([]);
  });
  it('checks the name, the level offset and the trait', () => {
    plant((e) => (join(e).name = ''), 'join.name must be 1-20 characters');
    plant(
      (e) => (join(e).name = 'A name that is much too long'),
      'join.name must be 1-20 characters',
    );
    plant((e) => (join(e).levelOffset = 9), 'levelOffset must be a whole number from -5 to 5');
    plant((e) => (join(e).levelOffset = 1.5), 'levelOffset must be a whole number from -5 to 5');
    plant((e) => (join(e).trait = 'bogus'), 'unknown trait "bogus"');
  });
});

describe('contract', () => {
  const contract = (e) => outcomeOf(e, 'sign', 'signed').effects[0];
  it('needs a known goal', () => {
    plant(
      (e) => (contract(e).goal = 'speedrun'),
      'contract.goal must be one of underPar, noLosses',
    );
  });
  it('a reward or penalty holds only effects that need no chosen unit', () => {
    plant(
      (e) => (contract(e).reward = [{ type: 'learnSkill', skillId: 'vantage' }]),
      "a contract's reward may only hold",
    );
    plant(
      (e) => (contract(e).penalty = [{ type: 'join', class: 'Fighter' }]),
      "a contract's penalty may only hold",
    );
    plant(
      (e) => (contract(e).reward = [{ type: 'contract', goal: 'noLosses' }]),
      "a contract's reward may only hold",
    );
    plant(
      (e) => (contract(e).reward = [{ type: 'hp', mode: 'heal', percent: 10, scope: 'target' }]),
      'reads the chosen unit but the choice has no target',
    );
    plant(
      (e) =>
        (contract(e).reward = [{ type: 'item', pool: { kind: 'weapon', weaponTypes: '$target' } }]),
      'reads the chosen unit',
    );
    plant((e) => (contract(e).reward = 'gold'), 'contract.reward must be a list');
  });
  it('its terms are checked like any effect', () => {
    plant(
      (e) => (contract(e).penalty = [{ type: 'burden', id: 'ghost' }]),
      'unknown burden "ghost"',
    );
    plant(
      (e) => (contract(e).reward = [{ type: 'gold', value: 'lots' }]),
      'gold value must be a number',
    );
  });
  it("is not paired with a battle in the same choice, and never rides in a battle's spoils", () => {
    plant((e) => {
      choiceOf(e, 'sign').outcomes.push({
        id: 'ambush',
        weight: 10,
        text: 'A trap.',
        effects: [{ type: 'battle', victoryText: 'Won.', afterVictory: [] }],
      });
    }, 'a choice that opens a contract cannot also start a battle');
    plant((e) => {
      outcomeOf(e, 'leave', 'gone').effects = [
        {
          type: 'battle',
          victoryText: 'Won.',
          afterVictory: [{ type: 'contract', goal: 'underPar' }],
        },
      ];
    }, 'can only be opened by a choice or an outcome');
  });
  it('counts as a conditional choice (one may already be open): a lone contract choice soft-locks', () => {
    plant((e) => {
      e.choices = [e.choices[0], ...e.choices.filter((c) => c.id === 'deeper')];
      e.choices[1].requires = { counterAtLeast: { key: 'torches', n: 1 } };
    }, 'no choice is always available');
  });
});

describe('routeEdit', () => {
  const edit = (e) => outcomeOf(e, 'map', 'drawn').effects[0];
  it('needs a known op and, for a redraw, a known type', () => {
    plant((e) => (edit(e).op = 'bend'), 'routeEdit.op must be addRoad or redraw');
    plant(
      (e) => (outcomeOf(e, 'map', 'redrawn').effects[0].toType = 'recruit'),
      'routeEdit.toType must be one of shop, church, battle',
    );
    plant(
      (e) => delete outcomeOf(e, 'map', 'redrawn').effects[0].toType,
      'routeEdit.toType must be one of',
    );
  });
  it('needs a fallback: the road may have nothing to change', () => {
    plant((e) => {
      delete outcomeOf(e, 'map', 'drawn').fallback;
    }, 'needs a `fallback`');
  });
  it('at most one per outcome; a fallback cannot edit again or teach', () => {
    plant(
      (e) => outcomeOf(e, 'map', 'drawn').effects.push({ type: 'routeEdit', op: 'addRoad' }),
      'at most one routeEdit',
    );
    plant(
      (e) => (outcomeOf(e, 'map', 'drawn').fallback = [{ type: 'routeEdit', op: 'addRoad' }]),
      'a fallback cannot hold a routeEdit',
    );
  });
  it("belongs in an outcome, not a choice's own effects or a battle's spoils", () => {
    plant(
      (e) => (choiceOf(e, 'leave').effects = [{ type: 'routeEdit', op: 'addRoad' }]),
      'routeEdit belongs in an outcome',
    );
    plant((e) => {
      outcomeOf(e, 'leave', 'gone').effects = [
        {
          type: 'battle',
          victoryText: 'Won.',
          afterVictory: [{ type: 'routeEdit', op: 'addRoad' }],
        },
      ];
    }, 'routeEdit belongs in an outcome');
  });
  it('a fallback is only for outcomes that teach or edit the route', () => {
    plant(
      (e) => (outcomeOf(e, 'leave', 'gone').fallback = [{ type: 'gold', value: 1 }]),
      'only for outcomes that teach a skill or edit the route',
    );
  });
});

describe('tells', () => {
  const tells = (e, choiceId = 'search') => choiceOf(e, choiceId).tells;
  it('`when` needs exactly one key naming something real', () => {
    plant((e) => (tells(e)[0].when = {}), 'when needs exactly one of');
    plant(
      (e) => (tells(e)[0].when = { class: 'Thief', trait: 'hardy' }),
      'when needs exactly one of',
    );
    plant((e) => (tells(e)[0].when = { mood: 'sad' }), 'when needs exactly one of');
    plant((e) => (tells(e)[0].when = { class: 'Wizard' }), 'unknown class "Wizard"');
    plant((e) => (tells(e)[0].when = { class: 'Zombie' }), 'unknown class "Zombie"');
    plant(
      (e) => (tells(e)[1].when = { classes: ['Archer', 'Wizard'] }),
      'when.classes must list known classes',
    );
    plant((e) => (tells(e)[1].when = { classes: [] }), 'when.classes must list known classes');
    plant((e) => (tells(e)[2].when = { weaponType: 'Spoon' }), 'unknown weapon type "Spoon"');
    plant((e) => (tells(e)[3].when = { trait: 'bogus' }), 'unknown trait "bogus"');
    plant((e) => (tells(e)[4].when = { skill: 'bogus' }), 'unknown skill "bogus"');
  });
  it('the line is short and may only use {name}', () => {
    plant((e) => (tells(e)[0].line = ''), 'line is missing');
    plant(
      (e) => (tells(e)[0].line = 'x'.repeat(EVENT_TEXT_LIMITS.tell + 1)),
      `limit ${EVENT_TEXT_LIMITS.tell}`,
    );
    plant((e) => (tells(e)[0].line = '{fallen}: Hm.'), 'may only use the {name} token');
    plant((e) => (tells(e)[0].line = '{name}: {skill}.'), 'may only use the {name} token');
    // exactly at the limit is fine
    expect(
      validate(
        withFixture(
          (e) => (tells(e)[0].line = `{name}: ${'x'.repeat(EVENT_TEXT_LIMITS.tell - 8)}`),
        ),
      ).errors,
    ).toEqual([]);
  });
  it('a tell reveals OR tilts, never both or neither', () => {
    plant((e) => (tells(e)[0].tilts = 'pass'), 'exactly one of reveals, tilts');
    plant((e) => delete tells(e)[0].reveals, 'exactly one of reveals, tilts');
  });
  it('`reveals` must name an outcome the choice has (a tell never lies about what cannot happen)', () => {
    plant(
      (e) => (tells(e)[0].reveals = 'explosion'),
      'reveals names an outcome the choice does not have ("explosion")',
    );
    // on a check choice the outcomes are pass and fail
    plant(
      (e) =>
        (choiceOf(e, 'bluff').tells = [
          { when: { class: 'Thief' }, line: '{name}: Hm.', reveals: 'tripwire' },
        ]),
      'does not have ("tripwire")',
    );
    // an outcome that cannot happen is a lie too (its weight must be positive)
    plant(
      (e) => (outcomeOf(e, 'search', 'tripwire').weight = 0),
      'reveals names an outcome that cannot happen ("tripwire")',
    );
  });
  it('`reveals` is not for a check choice: its outcome depends on who is chosen', () => {
    plant(
      (e) =>
        (choiceOf(e, 'bluff').tells = [
          { when: { class: 'Thief' }, line: '{name}: Hm.', reveals: 'fail' },
        ]),
      'reveals is not for a check choice',
    );
  });
  it('`tilts` is only for a check, only "pass", and once per choice', () => {
    plant(
      (e) => tells(e).push({ when: { class: 'Mage' }, line: '{name}: Trust me.', tilts: 'pass' }),
      'tilts is only for a choice with a check',
    );
    plant((e) => (tells(e, 'bluff')[0].tilts = 'fail'), 'tilts must be "pass"');
    plant(
      (e) =>
        tells(e, 'bluff').push({ when: { class: 'Mage' }, line: '{name}: Me too.', tilts: 'pass' }),
      'at most one tell per choice may tilt',
    );
  });
  it('tells must be a list of objects', () => {
    plant((e) => (choiceOf(e, 'search').tells = 'a rumour'), '`tells` must be a list');
    plant((e) => (choiceOf(e, 'search').tells = ['a rumour']), 'a tell must be an object');
  });
});

describe('story flags', () => {
  it('flagAct needs a flag beside it and a word that means an act', () => {
    plant(
      (e) => delete choiceOf(e, 'old_debt').requires.flag,
      '`requires.flagAct` needs `requires.flag`',
    );
    plant(
      (e) => (choiceOf(e, 'old_debt').requires.flagAct = 'sometime'),
      'must be earlier, current or an act id',
    );
    for (const word of ['earlier', 'current', 'act1', 'act4'])
      expect(
        validate(withFixture((e) => (choiceOf(e, 'old_debt').requires.flagAct = word))).errors,
      ).toEqual([]);
  });
});
