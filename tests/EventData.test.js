// data/events.json (docs/specs/event-nodes.md §2, §9): the shipped content passes the
// shape and semantic checks, and every check actually fires.
//
// Ways a data edit goes wrong (each is planted once below):
//   an effect type the engine does not know / a skill, item or burden id that does not
//   exist / a lord's personal skill or an enemy-only class's innate in a teaching pool /
//   a blessing tier with no mid-run-safe blessing / a target filter no class can meet /
//   an outcome with no positive weight / duplicate event, choice or outcome ids / text over
//   its length / a check without pass and fail / {fallen} in an event that names no fallen
//   ally / an event whose every choice can be blocked (the road would soft-lock) / a
//   teaching outcome with no fallback / a battle inside a battle's spoils / a `to: target`
//   effect with nobody to target / an unknown requirement or rung / a missing fallback event.
// And the file travels: public/data mirrors it, and the AJV schema's effect list is the
// engine's.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { validateEventsConfig, EVENT_TEXT_LIMITS } from '../src/engine/EventValidation.js';
import { EVENT_EFFECT_TYPES } from '../src/engine/EventEffects.js';
import { SAFE_BLESSING_BOON_TYPES, isSafeEventBlessing } from '../src/engine/EventSystem.js';
import { baseData } from './eventKit.js';

const root = path.resolve(__dirname, '..');
const read = (...parts) => JSON.parse(readFileSync(path.join(root, ...parts), 'utf-8'));

const data = baseData;
const clone = () => structuredClone(data.events);
const validate = (config, overrides = {}) =>
  validateEventsConfig(config, { ...data, ...overrides });
const event = (config, id) => config.events.find((e) => e.id === id);
const choice = (config, eventId, choiceId) =>
  event(config, eventId).choices.find((c) => c.id === choiceId);
const outcome = (config, eventId, choiceId, outcomeId) =>
  choice(config, eventId, choiceId).outcomes.find((o) => o.id === outcomeId);

/** Plant a bug; the validator must report an error containing `needle` and nothing else breaks. */
function plant(mutate, needle, overrides) {
  const config = clone();
  mutate(config);
  const result = validate(config, overrides);
  expect(result.valid).toBe(false);
  expect(result.errors.join('\n')).toContain(needle);
}

describe('the shipped events.json', () => {
  it('passes the semantic checks', () => {
    const result = validate(clone());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('holds the ten Phase 1 events, the twelve Phase 2D events and the fallback', () => {
    const phase1 = [
      'abandoned_armory',
      'deserters_fire',
      'drill_yard',
      'moneylender',
      'old_swordmaster',
      'quiet_road',
      'the_echo',
      'toll_bridge',
      'twin_altar',
      'wounded_courier',
    ];
    // Eight events and four payoffs (docs/specs/event-nodes-phase2.md §2D).
    const phase2d = [
      'bad_map',
      'cartographer',
      'chained_shelf',
      'collectors',
      'deserters_revenge',
      'hollow_herald',
      'merc_contract',
      'old_faces',
      'plague_village',
      'sunken_mine',
      'turncoat',
      'wandering_smith',
    ];
    expect(data.events.events.map((e) => e.id).sort()).toEqual([...phase1, ...phase2d].sort());
  });

  it('passes the AJV schema', () => {
    const ajv = new Ajv({ allErrors: true });
    const validateSchema = ajv.compile(read('schemas', 'events.schema.json'));
    expect(validateSchema(data.events), JSON.stringify(validateSchema.errors)).toBe(true);
  });

  it('the schema lists exactly the effect types the engine handles', () => {
    const schema = read('schemas', 'events.schema.json');
    expect([...schema.$defs.effect.properties.type.enum].sort()).toEqual(
      [...EVENT_EFFECT_TYPES].sort(),
    );
  });

  it('public/data mirrors data/', () => {
    expect(read('public', 'data', 'events.json')).toEqual(read('data', 'events.json'));
  });

  it('keeps every text inside its limit (checked directly, not through the validator)', () => {
    for (const e of data.events.events) {
      expect(e.intro.length).toBeLessThanOrEqual(EVENT_TEXT_LIMITS.intro);
      for (const c of e.choices) {
        expect(c.label.length).toBeLessThanOrEqual(EVENT_TEXT_LIMITS.label);
        for (const o of c.outcomes) {
          expect(o.text.length).toBeLessThanOrEqual(EVENT_TEXT_LIMITS.outcome);
          for (const fx of o.effects) {
            if (fx.type === 'battle')
              expect(fx.victoryText.length).toBeLessThanOrEqual(EVENT_TEXT_LIMITS.outcome);
          }
        }
      }
    }
  });

  it('every event keeps at least one choice that is always available', () => {
    for (const e of data.events.events) {
      const free = e.choices.filter(
        (c) =>
          !c.requires &&
          !c.cost &&
          !c.target &&
          !JSON.stringify(c).includes('"type":"item"') &&
          !JSON.stringify(c).includes('"blessing"') &&
          !JSON.stringify(c).includes('"consume"'),
      );
      expect(free.length, e.id).toBeGreaterThan(0);
    }
  });

  it('every blessing tier an event asks for has a mid-run-safe blessing (the allow-list)', () => {
    const tiers = new Set();
    for (const e of data.events.events)
      for (const c of e.choices) {
        if (c.requires?.blessingTier) tiers.add(c.requires.blessingTier);
        for (const o of c.outcomes)
          for (const fx of o.effects) if (fx.type === 'blessing') tiers.add(fx.tier);
      }
    expect([...tiers].sort()).toEqual([1, 3]);
    for (const tier of tiers) {
      const safe = data.blessings.blessings.filter(
        (b) => b.tier === tier && isSafeEventBlessing(b),
      );
      expect(safe.length, `tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it('the allow-list leaves out run-start grants, gold and prices', () => {
    for (const type of [
      'starting_weapon_tier',
      'starting_random_skill',
      'starting_whetstones',
      'starting_scroll',
      'skip_first_shop',
      'deploy_cap_delta',
      'gold_delta',
      'act_stat_delta_all_units',
      'enemy_level_delta',
      'disable_personal_skills_until_act',
    ])
      expect(SAFE_BLESSING_BOON_TYPES, type).not.toContain(type);
    // Every listed type is one the run's blessing code actually handles.
    const source = readFileSync(path.join(root, 'src/engine/RunManager.js'), 'utf-8');
    for (const type of SAFE_BLESSING_BOON_TYPES) expect(source, type).toContain(`'${type}'`);
  });
});

describe('every semantic check fires (one planted bug each)', () => {
  it('an unknown effect type', () =>
    plant(
      (c) => (outcome(c, 'drill_yard', 'rest', 'rested').effects[0].type = 'teleport'),
      'unknown effect type "teleport"',
    ));

  it('an unknown skill in a teaching pool', () =>
    plant(
      (c) =>
        (outcome(c, 'old_swordmaster', 'train', 'taught').effects[0].poolByType.Sword[0] =
          'no_such_skill'),
      'unknown skill "no_such_skill"',
    ));

  it("a lord's personal skill in a teaching pool", () =>
    plant(
      (c) =>
        (outcome(c, 'old_swordmaster', 'train', 'taught').effects[0].poolByType.Sword[0] =
          'charisma'),
      'personal or an enemy-only skill',
    ));

  it("an enemy-only class's innate skill in a teaching pool", () =>
    plant(
      (c) =>
        (outcome(c, 'old_swordmaster', 'train', 'taught').effects[0].poolByType.Axe[0] =
          'dragon_scale'),
      'personal or an enemy-only skill',
    ));

  it('an unknown item name', () =>
    plant((c) => {
      outcome(c, 'abandoned_armory', 'racks', 'issued').effects[0] = {
        type: 'item',
        name: 'Excalibur',
      };
    }, 'unknown item "Excalibur"'));

  it('an unknown burden id', () =>
    plant(
      (c) => (outcome(c, 'twin_altar', 'shadow', 'answered').effects[1].id = 'curse'),
      'unknown burden "curse"',
    ));

  it('a burden table that lacks a burden', () =>
    plant((c) => delete c.burdens.debt, 'burden "debt" is not defined'));

  it('a blessing tier with no mid-run-safe blessing', () =>
    plant(() => {}, 'blessing tier 3 has no mid-run-safe blessing', {
      blessings: {
        ...data.blessings,
        blessings: data.blessings.blessings.filter((b) => b.tier !== 3),
      },
    }));

  it('a blessing tier whose only blessings are unsafe (run-start grants)', () =>
    plant(() => {}, 'blessing tier 1 has no mid-run-safe blessing', {
      blessings: {
        ...data.blessings,
        blessings: data.blessings.blessings.map((b) =>
          b.tier === 1
            ? {
                ...b,
                boons: [{ type: 'starting_weapon_tier', params: { tier: 'Silver', count: 1 } }],
              }
            : b,
        ),
      },
    }));

  it('a target filter no class can meet', () =>
    plant(
      (c) =>
        (choice(c, 'old_swordmaster', 'train').target.filter = {
          weaponTypes: ['Breath'],
          minLevel: 99,
        }),
      'unsatisfiable filter',
    ));

  it('a weapon filter naming a type no class wields', () =>
    plant(
      (c) => (choice(c, 'old_swordmaster', 'train').target.filter = { weaponTypes: ['Breath'] }),
      'no class wields Breath',
    ));

  it('a roster requirement no class can meet', () =>
    plant(
      (c) => (event(c, 'drill_yard').requires = { roster: { weaponTypes: ['Breath'] } }),
      'no class wields Breath',
    ));

  it('an outcome with a non-positive weight', () =>
    plant(
      (c) => (outcome(c, 'toll_bridge', 'ford', 'forded').weight = 0),
      'weight must be a positive number',
    ));

  it('a rung override with a non-positive weight', () =>
    plant(
      (c) => (outcome(c, 'moneylender', 'borrow', 'fair').weightByRung.hard = -5),
      'weightByRung values must be positive',
    ));

  it('a duplicate event id', () =>
    plant((c) => c.events.push(structuredClone(event(c, 'drill_yard'))), 'duplicate event id'));

  it('a duplicate choice id', () =>
    plant(
      (c) => event(c, 'drill_yard').choices.push(structuredClone(choice(c, 'drill_yard', 'rest'))),
      'duplicate choice id',
    ));

  it('a duplicate outcome id', () =>
    plant(
      (c) =>
        choice(c, 'toll_bridge', 'pay').outcomes.push(
          structuredClone(outcome(c, 'toll_bridge', 'pay', 'paid')),
        ),
      'duplicate outcome id',
    ));

  it('an intro over its limit', () =>
    plant((c) => (event(c, 'drill_yard').intro = 'x'.repeat(261)), 'intro is 261 characters'));

  it('a choice label over its limit', () =>
    plant(
      (c) => (choice(c, 'drill_yard', 'rest').label = 'y'.repeat(33)),
      'label is 33 characters',
    ));

  it('an outcome text over its limit', () =>
    plant(
      (c) => (outcome(c, 'drill_yard', 'rest', 'rested').text = 'z'.repeat(201)),
      'text is 201 characters',
    ));

  it('a check without a pass and a fail outcome', () =>
    plant(
      (c) => (outcome(c, 'toll_bridge', 'bluff', 'fail').id = 'lose'),
      'exactly a "pass" and a "fail"',
    ));

  it('a check choice whose outcomes carry weights', () =>
    plant((c) => (outcome(c, 'toll_bridge', 'bluff', 'pass').weight = 50), 'carry no weights'));

  it('{fallen} outside an event that names a fallen ally', () =>
    plant(
      (c) => (outcome(c, 'drill_yard', 'rest', 'rested').text = '{fallen} is here.'),
      '{fallen} is only for an event that requires a fallen ally',
    ));

  it('layToRest outside an event that names a fallen ally', () =>
    plant(
      (c) => outcome(c, 'drill_yard', 'rest', 'rested').effects.push({ type: 'layToRest' }),
      'layToRest needs an event that requires a fallen ally',
    ));

  it('an event whose every choice can be blocked', () =>
    plant((c) => {
      for (const ch of event(c, 'drill_yard').choices) ch.cost = { gold: 100 };
    }, 'no choice is always available'));

  it('a teaching outcome with no fallback', () =>
    plant(
      (c) => delete outcome(c, 'old_swordmaster', 'train', 'taught').fallback,
      'needs a `fallback`',
    ));

  it('a battle inside the spoils of a battle', () =>
    plant(
      (c) =>
        outcome(c, 'toll_bridge', 'bluff', 'fail').effects[0].afterVictory.push({
          type: 'battle',
          victoryText: 'x',
        }),
      'a battle cannot start inside a battle',
    ));

  it('a battle with no victory text', () =>
    plant(
      (c) => delete outcome(c, 'toll_bridge', 'bluff', 'fail').effects[0].victoryText,
      'battle needs a victoryText',
    ));

  it('an effect that reads the target on a choice with none', () =>
    plant(
      (c) =>
        outcome(c, 'drill_yard', 'rest', 'rested').effects.push({
          type: 'hp',
          mode: 'damage',
          percent: 10,
          scope: 'target',
        }),
      'the choice has no target',
    ));

  it('an unknown requirement key', () =>
    plant(
      (c) => (event(c, 'drill_yard').requires = { moonPhase: 'full' }),
      'unknown requirement "moonPhase"',
    ));

  it('an unknown rung', () =>
    plant(
      (c) => (event(c, 'drill_yard').requires = { difficultyAtLeast: 'impossible' }),
      'unknown rung "impossible"',
    ));

  it('an unknown Eclipse phase', () =>
    plant(
      (c) => (event(c, 'drill_yard').requires = { phaseAtLeast: 'noon' }),
      'unknown Eclipse phase "noon"',
    ));

  it('a consume with no matching requirement', () =>
    plant(
      (c) => delete choice(c, 'wounded_courier', 'tend').requires,
      'needs the choice to require that consumable',
    ));

  it('a missing fallback event', () =>
    plant((c) => (c.events = c.events.filter((e) => !e.fallback)), 'exactly one fallback event'));

  it('a rung missing from costScale', () =>
    plant((c) => delete c.costScale.lunatic, 'costScale: needs a positive number for "lunatic"'));

  it('the AJV schema also refuses an unknown effect type and stray fields', () => {
    const ajv = new Ajv({ allErrors: true });
    const validateSchema = ajv.compile(read('schemas', 'events.schema.json'));
    const unknown = clone();
    outcome(unknown, 'drill_yard', 'rest', 'rested').effects[0].type = 'teleport';
    expect(validateSchema(unknown)).toBe(false);
    const stray = clone();
    event(stray, 'drill_yard').secret = true;
    expect(validateSchema(stray)).toBe(false);
  });
});
