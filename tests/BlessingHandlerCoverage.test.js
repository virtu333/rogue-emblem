// Every effect the blessings catalog can name has a handler (docs/blessings_contract.md §6.5:
// a missing handler is an error, not a silent no-op). RunManager records an
// `unhandled_effect_type` event instead of throwing, so a new card or price whose type nobody
// wired up would ship as a boon that does nothing. This applies each blessing's boons and each
// priced effect (the v3 catalog and the v2 pools old saves still hold) to a fresh run and
// reads that history.
//
// Ways this can fail, a test each:
//   1. a blessing's boon type has no handler (the card does nothing);
//   2. a price's effect type has no handler (the price is never paid);
//   3. a boon's params are malformed, so its handler records `invalid_*_params` and skips: the
//      card ships doing nothing (legitimate context skips such as `no_commander` stay allowed);
//   3b. a blessing's own listed `costs` (the v2 shape some cards still carry) has no handler;
//   4. the check itself is blind (it never sees an unhandled type, a malformed boon, or
//      applies nothing).
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalog = data.blessings;

function freshRun() {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 17, difficultyId: 'dusk', applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
const unhandled = (rm) =>
  rm.blessingHistory.filter((r) => r.details?.reason === 'unhandled_effect_type');
// A skip for malformed data (`invalid_lord_stat_arc_params`...), unlike a context skip.
const invalid = (rm) =>
  rm.blessingHistory.filter((r) => String(r.details?.reason ?? '').startsWith('invalid_'));
const applied = (rm) => rm.blessingHistory.filter((r) => r.eventType === 'effect_applied');

describe('every blessing effect has a handler', () => {
  it.each(catalog.blessings.map((b) => [b.id, b]))('%s: its boons apply', (id, blessing) => {
    const rm = freshRun();
    rm.activeBlessings = [{ id, rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(unhandled(rm).map((r) => r.effectType)).toEqual([]);
    expect(invalid(rm).map((r) => `${r.effectType}: ${r.details.reason}`)).toEqual([]);
    // Something was recorded for each boon: the effect did not vanish before its handler.
    const types = applied(rm).map((r) => r.effectType);
    for (const boon of blessing.boons) expect(types, boon.type).toContain(boon.type);
  });

  it.each(Object.entries(catalog.priceCatalog))('price %s: its effects apply', (id, price) => {
    const rm = freshRun();
    for (const effect of price.effects) rm._applySingleRunStartBlessingEffect('iron_oath', effect);
    expect(unhandled(rm).map((r) => r.effectType)).toEqual([]);
    expect(invalid(rm).map((r) => `${r.effectType}: ${r.details.reason}`)).toEqual([]);
  });

  it('the effects the walk reaches are not a vacuous list: boons, listed costs and prices alike', () => {
    const boons = catalog.blessings.flatMap((b) => b.boons || []);
    const costs = catalog.blessings.flatMap((b) => b.costs || []);
    const priced = Object.values(catalog.priceCatalog).flatMap((p) => p.effects || []);
    expect(boons.length + costs.length + priced.length).toBeGreaterThan(40);
    expect(boons.length).toBeGreaterThan(20);
    expect(priced.length).toBeGreaterThan(10);
  });

  it.each(catalog.blessings.filter((b) => (b.costs || []).length > 0).map((b) => [b.id, b]))(
    '%s: its listed costs apply',
    (id, blessing) => {
      const rm = freshRun();
      for (const effect of blessing.costs) rm._applySingleRunStartBlessingEffect(id, effect);
      expect(unhandled(rm).map((r) => r.effectType)).toEqual([]);
    },
  );

  // A twisted earned blessing's twist is applied by the same handlers as a price
  // (addBlessingMidRun's `price`): every twist the catalog ships must have one, and its params
  // must not be skipped as malformed. PR D3 ships four; the fixtures below prove the walk would
  // see one that is unhandled or malformed.
  const twistsApply = (blessings) => {
    const rm = freshRun();
    for (const b of blessings.filter((x) => x.twist))
      for (const effect of b.twist.effects) rm._applySingleRunStartBlessingEffect(b.id, effect);
    return [
      ...unhandled(rm).map((r) => r.effectType),
      ...invalid(rm).map((r) => `${r.effectType}: ${r.details.reason}`),
    ];
  };
  it.each(catalog.blessings.filter((b) => b.twist).map((b) => [b.id, b]))(
    "%s: its twist's effects apply",
    (id, blessing) => {
      expect(twistsApply([blessing])).toEqual([]);
      const rm = freshRun();
      for (const effect of blessing.twist.effects)
        rm._applySingleRunStartBlessingEffect(id, effect);
      const types = applied(rm).map((r) => r.effectType);
      for (const effect of blessing.twist.effects)
        expect(types, effect.type).toContain(effect.type);
    },
  );
  it("every twisted card's twist applies; the walk sees an unhandled or a malformed twist", () => {
    expect(catalog.blessings.filter((b) => b.twist).length).toBeGreaterThanOrEqual(4);
    expect(twistsApply(catalog.blessings)).toEqual([]);
    expect(
      twistsApply([{ id: 'x', twist: { effects: [{ type: 'no_such_twist', params: {} }] } }]),
    ).toEqual(['no_such_twist']);
    expect(
      twistsApply([
        {
          id: 'x',
          twist: { effects: [{ type: 'eclipse_gain_multiplier_delta', params: { value: 0.3 } }] },
        },
      ]),
    ).toEqual(['eclipse_gain_multiplier_delta: invalid_eclipse_gain_multiplier_delta_params']);
  });

  it('the v2 cost pools old saves hold still apply', () => {
    const rm = freshRun();
    for (const pool of Object.values(catalog.costPools))
      for (const entry of pool)
        for (const effect of entry.effects)
          rm._applySingleRunStartBlessingEffect('iron_oath', effect);
    expect(unhandled(rm).map((r) => r.effectType)).toEqual([]);
  });

  it('the check can see an unhandled type', () => {
    const rm = freshRun();
    rm._applySingleRunStartBlessingEffect('iron_oath', { type: 'no_such_effect', params: {} });
    expect(unhandled(rm).map((r) => r.effectType)).toEqual(['no_such_effect']);
  });

  it('the check can see a malformed boon, which the handler skips', () => {
    const rm = freshRun();
    rm._applySingleRunStartBlessingEffect('slow_fuse', {
      type: 'lord_stat_arc',
      params: { stats: ['STR'], dipAct: 'act_1', dip: -1, riseAct: 'act2', rise: 1 },
    });
    rm._applySingleRunStartBlessingEffect('gamblers_toss', {
      type: 'battle_gold_gamble',
      params: { chance: 2, win: 2, lose: 0.5 },
    });
    rm._applySingleRunStartBlessingEffect('bloodless_art', {
      type: 'player_weapon_art_boon',
      params: { hpCostDelta: 0, mapUsesBonus: 0 },
    });
    // PR D1's earned boons (engine/EarnedBoons.js) skip a malformed set the same way.
    for (const [id, type, params] of [
      ['standard_of_the_sun', 'commander_aura', { radius: 0, hitBonus: 5 }],
      ['hollow_hourglass', 'reinforcement_delay', { value: 0 }],
      ['chronicle', 'xp_per_act_cleared', { value: 3 }],
      ['tithe_box', 'church_entry_gold', { value: 'lots' }],
      ['lantern_of_the_road', 'fog_opening_reveal', {}],
      ['crest_of_the_road', 'recruit_mark_chance', { value: -1 }],
      // PR D3's twisted cards (engine/TwistedBoons.js) skip a malformed set the same way.
      ['blood_covenant', 'army_stat_bonus', { value: 0 }],
      ['kingmakers_oath', 'kingmaker_promotion', { bonus: 2, stats: 9 }],
      ['hollow_sun_favor', 'loot_gold_multiplier_delta', { value: 'lots' }],
      ['darkened_dawn', 'eclipse_gain_multiplier_delta', { value: 0.1 }],
      ['kingmakers_oath', 'master_seals_forbidden', { value: 1 }],
    ])
      rm._applySingleRunStartBlessingEffect(id, { type, params });
    expect(invalid(rm).map((r) => r.details.reason)).toEqual([
      'invalid_lord_stat_arc_params',
      'invalid_battle_gold_gamble_params',
      'invalid_player_weapon_art_boon_params',
      'invalid_commander_aura_params',
      'invalid_reinforcement_delay_params',
      'invalid_xp_per_act_cleared_params',
      'invalid_church_entry_gold_params',
      'invalid_fog_opening_reveal_params',
      'invalid_recruit_mark_chance_params',
      'invalid_army_stat_bonus_params',
      'invalid_kingmaker_promotion_params',
      'invalid_loot_gold_multiplier_delta_params',
      'invalid_eclipse_gain_multiplier_delta_params',
      'invalid_master_seals_forbidden_params',
    ]);
  });
});

describe('the validator refuses a malformed boon that its handler would skip', () => {
  const errorsWith = (id, patch) => {
    const copy = structuredClone(catalog);
    patch(copy.blessings.find((b) => b.id === id).boons[0].params);
    return validateBlessingsConfig(copy).errors.join('\n');
  };

  it('the shipped catalog is clean', () => {
    expect(validateBlessingsConfig(catalog).errors).toEqual([]);
  });

  it('Slow Fuse: an unknown act, no stats, a non-number dip or a zero arc is an error', () => {
    expect(errorsWith('slow_fuse', (p) => (p.dipAct = 'act_1'))).toMatch(/lord_stat_arc/);
    expect(errorsWith('slow_fuse', (p) => (p.riseAct = 'act9'))).toMatch(/lord_stat_arc/);
    expect(errorsWith('slow_fuse', (p) => (p.stats = ['MOV']))).toMatch(/lord_stat_arc/);
    expect(errorsWith('slow_fuse', (p) => (p.dip = 'x'))).toMatch(/lord_stat_arc/);
    expect(
      errorsWith('slow_fuse', (p) => {
        p.dip = 0;
        p.rise = 0;
      }),
    ).toMatch(/lord_stat_arc/);
  });

  it("Gambler's Toss: odds outside 0-1, or faces that are not a cut and a raise, are errors", () => {
    expect(errorsWith('gamblers_toss', (p) => (p.lose = 1.333))).toMatch(/lose < 1 < win/);
    expect(errorsWith('gamblers_toss', (p) => (p.lose = 1))).toMatch(/lose < 1 < win/);
    expect(errorsWith('gamblers_toss', (p) => (p.win = 1))).toMatch(/lose < 1 < win/);
    expect(errorsWith('gamblers_toss', (p) => (p.chance = 1))).toMatch(/battle_gold_gamble/);
    expect(errorsWith('gamblers_toss', (p) => (p.chance = 0))).toMatch(/battle_gold_gamble/);
    expect(errorsWith('gamblers_toss', (p) => delete p.win)).toMatch(/battle_gold_gamble/);
  });

  it('Bloodless Art: the HP delta must be a non-positive integer, the extra uses a non-negative one', () => {
    expect(errorsWith('bloodless_art', (p) => (p.hpCostDelta = 1))).toMatch(/hpCostDelta/);
    expect(errorsWith('bloodless_art', (p) => (p.hpCostDelta = -0.5))).toMatch(/hpCostDelta/);
    expect(errorsWith('bloodless_art', (p) => (p.hpCostDelta = '-1'))).toMatch(/hpCostDelta/);
    expect(errorsWith('bloodless_art', (p) => (p.mapUsesBonus = -1))).toMatch(/mapUsesBonus/);
    expect(errorsWith('bloodless_art', (p) => (p.mapUsesBonus = '1'))).toMatch(/mapUsesBonus/);
  });

  it('Bloodless Art: a boon that changes nothing is an error, like a zero Slow Fuse arc', () => {
    expect(
      errorsWith('bloodless_art', (p) => {
        p.hpCostDelta = 0;
        p.mapUsesBonus = 0;
      }),
    ).toMatch(/change nothing/);
    expect(
      errorsWith('bloodless_art', (p) => {
        delete p.hpCostDelta;
        delete p.mapUsesBonus;
      }),
    ).toMatch(/change nothing/);
    expect(
      errorsWith('bloodless_art', (p) => {
        delete p.hpCostDelta;
        p.mapUsesBonus = 0;
      }),
    ).toMatch(/change nothing/);
  });

  it('Bloodless Art: a missing field counts as 0 (the handler’s reading), so either alone is valid', () => {
    expect(errorsWith('bloodless_art', (p) => delete p.mapUsesBonus)).toBe('');
    expect(errorsWith('bloodless_art', (p) => delete p.hpCostDelta)).toBe('');
    expect(
      errorsWith('bloodless_art', (p) => {
        p.hpCostDelta = 0;
        p.mapUsesBonus = 2;
      }),
    ).toBe('');
  });

  it('Bloodless Art: the validator and the handler agree on every shape', () => {
    const shapes = [
      { hpCostDelta: -1, mapUsesBonus: 1 },
      { hpCostDelta: -1 },
      { mapUsesBonus: 1 },
      { hpCostDelta: 0, mapUsesBonus: 0 },
      {},
      { hpCostDelta: 1, mapUsesBonus: 1 },
      { hpCostDelta: -1, mapUsesBonus: -1 },
      { hpCostDelta: -0.5, mapUsesBonus: 1 },
      { hpCostDelta: 'lots', mapUsesBonus: 1 },
    ];
    for (const params of shapes) {
      const copy = structuredClone(catalog);
      copy.blessings.find((b) => b.id === 'bloodless_art').boons[0].params = params;
      const valid = validateBlessingsConfig(copy).errors.length === 0;
      const rm = freshRun();
      rm._applySingleRunStartBlessingEffect('bloodless_art', {
        type: 'player_weapon_art_boon',
        params,
      });
      const skipped = invalid(rm).length > 0;
      expect(skipped, JSON.stringify(params)).toBe(!valid);
      const mods = rm.blessingRuntimeModifiers;
      const changed = mods.playerArtHpCostDelta !== 0 || mods.playerArtMapUsesBonus !== 0;
      expect(changed, JSON.stringify(params)).toBe(valid);
    }
  });
  it("PR D3's twisted cards: the validator refuses exactly what the handler skips (boons and twists)", () => {
    // Failure: a card the validator passes ships doing nothing (or a valid one is refused).
    const cases = [
      [
        'blood_covenant',
        'boons',
        0,
        [{ value: 1 }, { value: 3 }],
        [{ value: 0 }, { value: 4 }, {}],
      ],
      [
        'kingmakers_oath',
        'boons',
        0,
        [
          { bonus: 2, stats: 2 },
          { bonus: 5, stats: 8 },
        ],
        [{ bonus: 0, stats: 2 }, { bonus: 2, stats: 9 }, { bonus: 2 }],
      ],
      [
        'hollow_sun_favor',
        'boons',
        1,
        [{ value: 0.5 }, { value: 2 }],
        [{ value: 0 }, { value: 3 }],
      ],
      [
        'darkened_dawn',
        'twist',
        1,
        [{ value: 0.25 }, { value: 1 }],
        [{ value: 0.3 }, { value: 0 }],
      ],
      ['kingmakers_oath', 'twist', 0, [{}], [{ value: 1 }]],
    ];
    for (const [id, where, index, good, bad] of cases)
      for (const [params, valid] of [
        ...good.map((p) => [p, true]),
        ...bad.map((p) => [p, false]),
      ]) {
        const copy = structuredClone(catalog);
        const row = copy.blessings.find((b) => b.id === id);
        const effects = where === 'twist' ? row.twist.effects : row.boons;
        effects[index].params = params;
        expect(
          validateBlessingsConfig(copy).errors.length === 0,
          `${id} ${JSON.stringify(params)}`,
        ).toBe(valid);
        const rm = freshRun();
        rm._applySingleRunStartBlessingEffect(id, { type: effects[index].type, params });
        expect(invalid(rm).length > 0, `${id} ${JSON.stringify(params)}`).toBe(!valid);
      }
  });
});
