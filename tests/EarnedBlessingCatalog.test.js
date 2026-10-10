// Earned blessings, the catalog side (docs/specs/blessings-v3.md §6): `earned: true` rows have
// no tier, no price and no cost, are never offered at a shrine, and their boons are checked by
// the validator. Each test names a realistic way the flag goes wrong.
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import fs from 'node:fs';
import path from 'node:path';
import {
  createSeededRng,
  isEarnedBlessing,
  selectBlessingOptionsWithTelemetry,
  validateBlessingsConfig,
} from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalog = data.blessings;
// Every earned row: PR C's four, then PR D1's six, then PR D2's five.
const EARNED_IDS = [
  'unbroken_banner',
  'second_dawn',
  'ember_lantern',
  'captains_whistle',
  'standard_of_the_sun',
  'hollow_hourglass',
  'chronicle',
  'tithe_box',
  'lantern_of_the_road',
  'crest_of_the_road',
  'saints_reliquary',
  'mercenary_ledger',
  'smiths_covenant',
  'thiefs_lantern',
  'seers_eye',
];
const earnedRows = () => catalog.blessings.filter((b) => b.earned === true);

function errorsOf(patch) {
  const copy = structuredClone(catalog);
  patch(copy);
  return validateBlessingsConfig(copy).errors.join('\n');
}
const row = (copy, id) => copy.blessings.find((b) => b.id === id);

describe('the shipped earned rows', () => {
  it('the earned blessings sit at the end of the list, after every offered card', () => {
    const list = catalog.blessings;
    const n = EARNED_IDS.length;
    expect(list.slice(-n).map((b) => b.id)).toEqual(EARNED_IDS);
    expect(list.slice(0, -n).some(isEarnedBlessing)).toBe(false);
    expect(validateBlessingsConfig(catalog).errors).toEqual([]);
  });

  it('an earned card carries no tier, price, pact or cost, and a draw weight', () => {
    for (const b of earnedRows()) {
      for (const key of ['tier', 'prices', 'pact', 'intrinsicPrice'])
        expect(b[key], `${b.id}.${key}`).toBeUndefined();
      expect(b.costs, b.id).toEqual([]);
      expect(b.weight, b.id).toBeGreaterThan(0);
    }
  });

  it('each one has lore of its own that is not its description and fits the budget', () => {
    for (const b of earnedRows()) {
      expect(b.lore.length, b.id).toBeGreaterThan(0);
      expect(b.lore.length, b.id).toBeLessThanOrEqual(85);
      expect(b.lore.trim().toLowerCase(), b.id).not.toBe(b.description.trim().toLowerCase());
    }
  });

  it('the pick odds sit in the data: two cards, 1 / 0.85 / 0.7 by earned blessings held', () => {
    // PR D1 adds the eclipsed elite's flat third (D-4) and the Old Sanctum's stamp chance (D-5).
    expect(catalog.earnedOffer).toEqual({
      actBoss: 2,
      weightByHeld: [1, 0.85, 0.7],
      eclipsedEliteChance: 0.3333,
      sanctum: { chance: 0.5 },
    });
  });
});

describe('the schema (draft-07 if/then)', () => {
  const schema = JSON.parse(
    fs.readFileSync(path.resolve('schemas/blessings.schema.json'), 'utf-8'),
  );
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const check = (patch) => {
    const copy = structuredClone(catalog);
    patch(copy);
    return validate(copy);
  };

  it('the shipped catalog passes', () => {
    expect(validate(catalog)).toBe(true);
  });

  it.each(['tier', 'prices', 'pact', 'intrinsicPrice'])(
    'an earned row carrying %s is refused (an earned card is free and has no tier)',
    (key) => {
      const value = { tier: 2, prices: ['debt_small'], pact: ['debt_large'] }[key] ?? {
        label: 'x',
        points: 1,
      };
      expect(check((c) => (row(c, 'second_dawn')[key] = value))).toBe(false);
    },
  );

  it('an ordinary row without a tier is still refused', () => {
    expect(check((c) => delete row(c, 'steady_hands').tier)).toBe(false);
  });

  it('earned must be a boolean', () => {
    expect(check((c) => (row(c, 'second_dawn').earned = 'yes'))).toBe(false);
  });

  it('earnedOffer is checked: a card count of 0 or odds above 1 are refused', () => {
    expect(check((c) => (c.earnedOffer.actBoss = 0))).toBe(false);
    expect(check((c) => (c.earnedOffer.weightByHeld = [1.5]))).toBe(false);
  });
});

describe('the validator', () => {
  it.each([
    ['tier', (b) => (b.tier = 2)],
    ['prices', (b) => (b.prices = ['debt_small'])],
    ['pact', (b) => (b.pact = ['debt_large'])],
    ['intrinsicPrice', (b) => (b.intrinsicPrice = { label: 'x', points: 2 })],
  ])('refuses an earned blessing that carries %s', (key, patch) => {
    expect(errorsOf((c) => patch(row(c, 'ember_lantern')))).toMatch(
      new RegExp(`${key} is not allowed on an earned blessing`),
    );
  });

  it('names only what is wrong with an earned card that wears a tier, not the prices it lacks', () => {
    const errors = errorsOf((c) => (row(c, 'ember_lantern').tier = 2));
    expect(errors).toMatch(/tier is not allowed/);
    expect(errors).not.toMatch(/prices must name|band/);
  });

  it('refuses an earned blessing with a cost, and a non-boolean earned flag', () => {
    expect(errorsOf((c) => (row(c, 'ember_lantern').costs = [{ type: 'x', params: {} }]))).toMatch(
      /costs must be empty for an earned blessing/,
    );
    expect(errorsOf((c) => (row(c, 'ember_lantern').earned = 'true'))).toMatch(
      /earned must be a boolean/,
    );
  });

  it('accepts an earned blessing with none (v3 pricing does not ask it for prices)', () => {
    expect(errorsOf(() => {})).toBe('');
  });

  it('still requires a tier of an ordinary blessing', () => {
    expect(errorsOf((c) => delete row(c, 'steady_hands').tier)).toMatch(
      /missing required key: tier/,
    );
  });

  it('a catalog of earned cards alone has no tier-1 blessing, which a shrine needs', () => {
    expect(
      errorsOf((c) => {
        c.blessings = c.blessings.filter((b) => b.earned);
      }),
    ).toMatch(/at least one tier-1/);
  });

  it.each([
    ['unbroken_banner', 'battle_last_stand'],
    ['second_dawn', 'act_start_vision_delta'],
    ['ember_lantern', 'first_kill_heal'],
    ['captains_whistle', 'first_turn_mov_delta'],
  ])(
    '%s: a %s value that is not a positive integer would ship a card that does nothing',
    (id, type) => {
      for (const bad of [0, -1, 1.5, '2', null]) {
        expect(
          errorsOf((c) => (row(c, id).boons[0].params.value = bad)),
          `value ${bad}`,
        ).toMatch(new RegExp(`${type}.*positive integer|positive integer.*${type}`));
      }
      expect(errorsOf((c) => delete row(c, id).boons[0].params.value)).toMatch(/positive integer/);
      expect(errorsOf((c) => (row(c, id).boons[0].params.value = 3))).toBe('');
    },
  );
});

describe('offers never include an earned blessing', () => {
  const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];

  it('1,000 seeds on each rung: neither the free card nor a later slot is earned', () => {
    for (const difficultyId of RUNGS) {
      for (let seed = 1; seed <= 1000; seed++) {
        const { selected } = selectBlessingOptionsWithTelemetry(catalog, createSeededRng(seed), {
          count: 3,
          difficultyId,
        });
        expect(selected).toHaveLength(3);
        for (const b of selected) {
          if (b.earned) throw new Error(`seed ${seed} on ${difficultyId} offered ${b.id}`);
          expect(b.tier, `${b.id} (seed ${seed})`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('a four-card draw and a draw without the free card skip them too', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const options of [
        { count: 4 },
        { count: 4, forceTier1: false },
        { count: 2, allowTier4: false },
      ]) {
        const { selected, telemetry } = selectBlessingOptionsWithTelemetry(
          catalog,
          createSeededRng(seed),
          options,
        );
        expect(selected.some(isEarnedBlessing)).toBe(false);
        // The pool the draw reads names none of them either.
        expect(telemetry.candidatePoolIds.filter((id) => EARNED_IDS.includes(id))).toEqual([]);
      }
    }
  });

  describe('a v2 catalog (a draw by weight over the whole pool, no tier slots)', () => {
    // The v3 draw picks by tier, so an earned row (no tier) is out of reach of it even with no
    // filter at all. The v2 draw walks the whole pool, so here the filter is the only guard.
    function v2Catalog() {
      const c = structuredClone(catalog);
      c.version = 2;
      for (const key of ['priceCatalog', 'tierBands', 'debtScale']) delete c[key];
      c.blessings = c.blessings.filter((b) => !b.intrinsicPrice);
      for (const b of c.blessings) delete b.prices;
      return c;
    }
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const offersEarned = (config) =>
      seeds.filter((seed) => {
        const { selected } = selectBlessingOptionsWithTelemetry(config, createSeededRng(seed), {
          count: 3,
        });
        return selected.some((b) => EARNED_IDS.includes(b.id));
      });

    it('the catalog is valid as v2, and the draw would reach an earned row if it were ordinary', () => {
      expect(validateBlessingsConfig(v2Catalog()).errors).toEqual([]);
      // Control: the same rows with the flag lifted (a tier given, so the validator accepts
      // them) are offered on many seeds, so the draw can reach them and the next test can fail.
      const ordinary = v2Catalog();
      for (const b of ordinary.blessings)
        if (b.earned) {
          delete b.earned;
          delete b.sources; // an earned row's own field (an ordinary row may not carry it)
          b.tier = 1;
        }
      expect(offersEarned(ordinary).length).toBeGreaterThan(20);
    });

    it('200 seeds: an earned card is never offered, and none is in the pool the draw reads', () => {
      const config = v2Catalog();
      expect(offersEarned(config)).toEqual([]);
      for (const seed of seeds) {
        const { telemetry } = selectBlessingOptionsWithTelemetry(config, createSeededRng(seed), {
          count: 3,
        });
        expect(telemetry.candidatePoolIds.filter((id) => EARNED_IDS.includes(id))).toEqual([]);
      }
    });
  });

  it('a heavily weighted earned card still never reaches a shrine', () => {
    const copy = structuredClone(catalog);
    for (const b of copy.blessings.filter((x) => x.earned)) b.weight = 1000;
    for (let seed = 1; seed <= 200; seed++) {
      const { selected } = selectBlessingOptionsWithTelemetry(copy, createSeededRng(seed), {
        count: 4,
      });
      expect(selected.some(isEarnedBlessing)).toBe(false);
    }
  });

  it("the offered pool's draws are unchanged by the earned rows (same seeds, same cards)", () => {
    // The earned rows are appended and filtered out before any draw, so a catalog without
    // them offers exactly the same cards for the same seed.
    const without = structuredClone(catalog);
    without.blessings = without.blessings.filter((b) => !b.earned);
    for (let seed = 1; seed <= 200; seed++) {
      const a = selectBlessingOptionsWithTelemetry(catalog, createSeededRng(seed), { count: 3 });
      const b = selectBlessingOptionsWithTelemetry(without, createSeededRng(seed), { count: 3 });
      expect(a.selected.map((x) => x.id)).toEqual(b.selected.map((x) => x.id));
      expect(a.selected.map((x) => x.rolledCost?.label)).toEqual(
        b.selected.map((x) => x.rolledCost?.label),
      );
    }
  });
});
