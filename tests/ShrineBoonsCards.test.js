// The rest of the §5 starting blessings (docs/specs/blessings-v3.md §5, PR D4): the twelve cards
// as data, the validator and the handler (engine/ShrineBoons.js), and what a save keeps.
//
// Ways this can fail, a test each:
//   1. a card is mispriced (a price outside its tier's band, a gold price on a gold card, a
//      card with no price), or its text is too long or repeats itself, or it takes an item's
//      name (names are identity);
//   2. a malformed boon validates and the handler then skips it (a card that ships doing
//      nothing), or the validator and the handler disagree on a shape;
//   3. an event or a church hands out a card whose cost is in the card (Lone Banner), or never
//      hands out one that is a plain gift;
//   4. a save from before D4 loads with undefined fields (NaN totals), or a hand-edited save
//      keeps a nonsense value, or a held boon is lost on a round trip;
//   5. taking a card shifts the shrine's other draws (it may not: the boon is applied after).
import { afterEach, describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import {
  SAFE_BLESSING_BOON_TYPES,
  availableEventBlessings,
  isSafeEventBlessing,
} from '../src/engine/EventSystem.js';
import { churchBlessingOffers } from '../src/engine/ChurchVow.js';
import {
  SHRINE_BOON_TYPES,
  applyShrineBoon,
  createShrineBoonModifiers,
  sanitizeShrineBoonModifiers,
  shrineBoonErrors,
  shrineBoonsOf,
} from '../src/engine/ShrineBoons.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());
const catalog = data.blessings;
const byId = new Map(catalog.blessings.map((b) => [b.id, b]));

// The twelve cards, their tiers and boons, as the spec and the plan name them.
const D4 = {
  late_bloom: { tier: 3, name: 'Late Bloom', boons: ['act_clear_army_stats'] },
  dawn_tithe: { tier: 2, name: 'Dawn Tithe', boons: ['under_par_gold'] },
  lone_banner: { tier: 3, name: 'Lone Banner', boons: ['deploy_cap_delta', 'xp_multiplier_delta'] },
  cavaliers_hour: { tier: 3, name: "Cavalier's Hour", boons: ['move_type_battle_stats'] },
  saints_reserve: { tier: 2, name: "Saint's Reserve", boons: ['staff_uses_bonus'] },
  cutpurses_luck: { tier: 3, name: "Cutpurse's Luck", boons: ['carrier_luck'] },
  open_roll: { tier: 3, name: 'Open Roll', boons: ['recruit_alternate'] },
  watchers_grace: { tier: 2, name: "Watcher's Grace", boons: ['boss_battle_vision'] },
  patient_dawn: { tier: 3, name: 'Patient Dawn', boons: ['par_turn_delta'] },
  twin_chapel: { tier: 2, name: 'Twin Chapel', boons: ['church_extra_vows'] },
  omen_reader: { tier: 2, name: 'Omen Reader', boons: ['eclipse_omen'] },
  lottery_loot: { tier: 3, name: 'Lottery Loot', boons: ['next_act_loot_card'] },
};

function freshRun(seed = 17) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'dusk', applyBlessingsAtStart: false });
  return rm;
}
function hold(rm, ...ids) {
  rm.activeBlessings = ids.map((id) => ({ id, rolledCost: null }));
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
function pointsOf(option) {
  return (Array.isArray(option) ? option : [option]).reduce(
    (sum, id) => sum + catalog.priceCatalog[id].points,
    0,
  );
}

describe('the twelve cards', () => {
  it.each(Object.entries(D4))('%s: tier, name and boons as the plan names them', (id, want) => {
    const card = byId.get(id);
    expect(card, id).toBeTruthy();
    expect(card.tier).toBe(want.tier);
    expect(card.name).toBe(want.name);
    expect(card.boons.map((b) => b.type)).toEqual(want.boons);
    expect(card.weight).toBe(1);
  });

  it.each(Object.keys(D4))(
    '%s: text fits (≤90 / ≤85) and the lore is not the description',
    (id) => {
      const card = byId.get(id);
      expect(card.description.length).toBeLessThanOrEqual(90);
      expect(card.lore.length).toBeLessThanOrEqual(85);
      expect(card.lore).not.toBe(card.description);
    },
  );

  it('every price sits in its tier band (literal points, worked by hand)', () => {
    // The band is [1, 2] for II, [2.5, 3.5] for III; each candidate's points by hand.
    const expected = {
      late_bloom: [3.5, 2.5],
      dawn_tithe: [1.5, 1],
      cavaliers_hour: [3.5, 2.5],
      saints_reserve: [2, 1.5],
      cutpurses_luck: [2.5, 2.5],
      open_roll: [2.5, 3.5],
      watchers_grace: [1.5, 2],
      patient_dawn: [3, 3.5],
      twin_chapel: [2],
      omen_reader: [1.5],
      lottery_loot: [3.5, 2.5],
    };
    for (const [id, points] of Object.entries(expected))
      expect(byId.get(id).prices.map(pointsOf), id).toEqual(points);
    // Lone Banner's cost is the card: one fewer deploy, a tier III intrinsic price (D-17).
    expect(byId.get('lone_banner').intrinsicPrice).toEqual({
      label: 'Deploy one fewer unit in every battle',
      points: 3,
    });
    expect(byId.get('lone_banner').prices).toBeUndefined();
    expect(validateBlessingsConfig(catalog).errors).toEqual([]);
  });

  it('the validator refuses a D4 price outside the band (the band check reaches the new rows)', () => {
    const copy = structuredClone(catalog);
    copy.blessings.find((b) => b.id === 'twin_chapel').prices = ['debt_large'];
    expect(validateBlessingsConfig(copy).errors.join('\n')).toMatch(
      /twin_chapel\.prices\[0\] costs 3\.5 points, outside tier 2's band/,
    );
  });

  it('Dawn Tithe is a gold card and none of its prices is gold', () => {
    const tithe = byId.get('dawn_tithe');
    expect(tithe.tags).toEqual(['gold']);
    for (const option of tithe.prices)
      for (const id of Array.isArray(option) ? option : [option])
        expect(catalog.priceCatalog[id].tags || []).not.toContain('gold');
  });

  it('no card takes an item, weapon, skill or blessing name already in use', () => {
    const names = new Set([
      ...(data.weapons || []).map((w) => w.name),
      ...(data.consumables || []).map((c) => c.name),
      ...(data.accessories || []).map((a) => a.name),
      ...(data.whetstones || []).map((w) => w.name),
      ...(data.skills || []).map((s) => s.name),
    ]);
    for (const id of Object.keys(D4)) expect(names.has(byId.get(id).name), id).toBe(false);
    const all = catalog.blessings.map((b) => b.name);
    expect(new Set(all).size).toBe(all.length);
  });

  it('the twelve were appended: no older card moved', () => {
    // After the 28 older offered cards; the 4 earned blessings (PR C) stay last.
    const ids = catalog.blessings.map((b) => b.id);
    expect(ids.slice(0, 28)).not.toContain('late_bloom');
    expect(ids.slice(28, 40)).toEqual(Object.keys(D4));
    expect(catalog.blessings.slice(40).every((b) => b.earned === true)).toBe(true);
  });
});

describe('the validator and the handler read every boon the same way', () => {
  const shapes = {
    act_clear_army_stats: [
      { value: 1, stats: 2 },
      { value: 1, stats: 8 },
      { value: 1 },
      { value: 1, stats: 0 },
      { value: 1, stats: 9 },
      { value: 1, stats: 2.5 },
      { value: 0, stats: 2 },
      { value: 4, stats: 2 },
      { value: 1.5, stats: 2 },
      {},
    ],
    under_par_gold: [
      { perTurn: 100 },
      { perTurn: 500 },
      { perTurn: 501 },
      { perTurn: 0 },
      { perTurn: -5 },
      { value: 100 },
    ],
    move_type_battle_stats: [
      { bonuses: [{ moveTypes: ['Cavalry'], stat: 'MOV', value: 1 }] },
      { bonuses: [] },
      { bonuses: [{ moveTypes: ['Boat'], stat: 'MOV', value: 1 }] },
      { bonuses: [{ moveTypes: ['Cavalry'], stat: 'ATK', value: 1 }] },
      { bonuses: [{ moveTypes: ['Cavalry'], stat: 'MOV', value: 0 }] },
      {
        bonuses: [
          { moveTypes: ['Cavalry'], stat: 'MOV', value: 1 },
          { moveTypes: ['Cavalry'], stat: 'DEF', value: 1 },
        ],
      },
    ],
    staff_uses_bonus: [{ value: 1 }, { value: 3 }, { value: 4 }, { value: 0 }, { value: '1' }],
    carrier_luck: [
      { carryMultiplier: 2, stealIgnoresSpeed: true },
      { carryMultiplier: 2 },
      { stealIgnoresSpeed: true },
      { carryMultiplier: 1, stealIgnoresSpeed: false },
      { carryMultiplier: 9 },
      { carryMultiplier: 2, stealIgnoresSpeed: 'yes' },
    ],
    recruit_alternate: [{ value: 1 }, { value: 2 }, { value: 0 }],
    boss_battle_vision: [{ value: 1 }, { value: 3 }, { value: 4 }, { value: -1 }],
    par_turn_delta: [{ value: 2 }, { value: 5 }, { value: 6 }, { value: 0 }, { value: 2.5 }],
    church_extra_vows: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 0 }],
    eclipse_omen: [
      { foretell: 2, spare: ['recruit'] },
      { foretell: 2 },
      { spare: ['shop'] },
      { foretell: 0, spare: [] },
      { foretell: 2, spare: ['battle'] },
      { foretell: 9 },
    ],
    next_act_loot_card: [{ count: 1 }, { count: 2 }, { count: 3 }, { count: 0 }],
  };
  const validFor = (type, params) => {
    const copy = structuredClone(catalog);
    const card = copy.blessings.find((b) => b.boons.some((boon) => boon.type === type));
    card.boons.find((boon) => boon.type === type).params = params;
    return validateBlessingsConfig(copy).errors.length === 0;
  };

  it('every new type has shapes here', () => {
    expect(Object.keys(shapes).sort()).toEqual([...SHRINE_BOON_TYPES].sort());
  });

  it.each(Object.entries(shapes))('%s: valid exactly when the handler applies it', (type, list) => {
    let valid = 0;
    let invalid = 0;
    for (const params of list) {
      const rm = freshRun();
      const details = applyShrineBoon(rm, 'test', { type, params });
      const accepted = validFor(type, params);
      expect(details?.skipped === true, `${type} ${JSON.stringify(params)}`).toBe(!accepted);
      if (!accepted) expect(details.reason).toBe(`invalid_${type}_params`);
      if (accepted) valid++;
      else invalid++;
    }
    // The list really holds both kinds (the check is not vacuous).
    expect(valid).toBeGreaterThan(0);
    expect(invalid).toBeGreaterThan(0);
  });

  it('a hand-edited save or stacked cards never go past the caps the validator holds a card to', () => {
    for (const [type, params] of [
      ['under_par_gold', { perTurn: 501 }],
      ['staff_uses_bonus', { value: 4 }],
      ['boss_battle_vision', { value: 4 }],
      ['par_turn_delta', { value: 6 }],
    ]) {
      expect(shrineBoonErrors(type, params).length, type).toBe(1);
      expect(validFor(type, params), type).toBe(false);
    }
    const mods = sanitizeShrineBoonModifiers({
      ...createShrineBoonModifiers(),
      underParGoldPerTurn: 99999,
      staffUsesBonus: 40,
      bossBattleVision: 12,
      parTurnDelta: 30,
    });
    expect(mods).toMatchObject({
      underParGoldPerTurn: 500,
      staffUsesBonus: 3,
      bossBattleVision: 3,
      parTurnDelta: 5,
    });
    // Cards taken one after another stop at the same caps as a load would.
    const rm = freshRun();
    for (let i = 0; i < 4; i++) {
      applyShrineBoon(rm, 'a', { type: 'under_par_gold', params: { perTurn: 200 } });
      applyShrineBoon(rm, 'b', { type: 'staff_uses_bonus', params: { value: 1 } });
      applyShrineBoon(rm, 'c', { type: 'boss_battle_vision', params: { value: 1 } });
      applyShrineBoon(rm, 'd', { type: 'par_turn_delta', params: { value: 2 } });
    }
    expect(rm.blessingRuntimeModifiers).toMatchObject({
      underParGoldPerTurn: 500,
      staffUsesBonus: 3,
      bossBattleVision: 3,
      parTurnDelta: 5,
    });
  });

  it('a type that is not one of these is left to RunManager (null), never claimed', () => {
    expect(shrineBoonErrors('gold_delta', { value: 1 })).toBeNull();
    expect(applyShrineBoon(freshRun(), 'x', { type: 'gold_delta', params: { value: 1 } })).toBe(
      null,
    );
  });
});

describe('events and churches', () => {
  it('every new type is on the mid-run-safe list; Lone Banner (intrinsic) never is offered', () => {
    for (const type of SHRINE_BOON_TYPES) expect(SAFE_BLESSING_BOON_TYPES).toContain(type);
    for (const id of Object.keys(D4))
      expect(isSafeEventBlessing(byId.get(id)), id).toBe(id !== 'lone_banner');
    const rm = freshRun();
    expect(availableEventBlessings(rm, 3).map((b) => b.id)).not.toContain('lone_banner');
    expect(rm.addBlessingMidRun('lone_banner')).toBe(false);
  });

  it('a church altar offers none of them (they are tier II-III)', () => {
    const rm = freshRun();
    for (let i = 0; i < 20; i++)
      for (const b of churchBlessingOffers(rm, `act1_${i}_2`, data))
        expect(Object.keys(D4)).not.toContain(b.id);
  });

  it('an event grant applies the boon mid-run and is recorded as such', () => {
    const rm = freshRun();
    expect(rm.addBlessingMidRun('saints_reserve')).toBe(true);
    expect(shrineBoonsOf(rm).staffUsesBonus).toBe(1);
    const record = rm.blessingHistory.find((r) => r.effectType === 'staff_uses_bonus');
    expect(record.stage).toBe('mid_run');
  });
});

describe('seeded draws', () => {
  it.each(Object.keys(D4))(
    '%s: taking it draws nothing from Math.random (the battle and node-map streams never move)',
    (id) => {
      const plain = freshRun(23);
      const holder = freshRun(23);
      installSeed(4);
      hold(plain);
      const control = Math.random();
      installSeed(4);
      hold(holder, id);
      expect(Math.random()).toBe(control);
      // The map the run stands on is the same map (Open Roll only adds its alternates).
      const strip = (rm) => rm.nodeMap.nodes.map(({ recruitAlternate: _a, ...node }) => node);
      expect(strip(holder)).toEqual(strip(plain));
    },
  );
});

describe('saves', () => {
  it('a fresh run holds the defaults, and taking every card sets its field', () => {
    const rm = freshRun();
    expect(shrineBoonsOf(rm)).toEqual(createShrineBoonModifiers());
    hold(rm, ...Object.keys(D4).filter((id) => id !== 'lone_banner'));
    expect(shrineBoonsOf(rm)).toMatchObject({
      underParGoldPerTurn: 100,
      staffUsesBonus: 1,
      carryMultiplier: 2,
      stealIgnoresSpeed: true,
      recruitAlternates: 1,
      bossBattleVision: 1,
      parTurnDelta: 2,
      extraChurchVows: 1,
      eclipseForetell: 2,
      eclipseSpareTypes: ['recruit'],
      nextActLootCards: 1,
    });
    expect(shrineBoonsOf(rm).moveTypeBattleStats).toHaveLength(2);
    const grant = rm.blessingRuntimeModifiers.actStartGrants.find(
      (g) => g.blessingId === 'late_bloom',
    );
    expect(grant).toEqual({
      blessingId: 'late_bloom',
      kind: 'army_stats',
      value: 1,
      stats: 2,
      paidActs: ['act1'],
    });
  });

  it('a round trip keeps every held boon', () => {
    const rm = hold(freshRun(), ...Object.keys(D4).filter((id) => id !== 'lone_banner'));
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(shrineBoonsOf(back)).toEqual(shrineBoonsOf(rm));
    expect(back.blessingRuntimeModifiers.actStartGrants).toEqual(
      rm.blessingRuntimeModifiers.actStartGrants,
    );
  });

  it('a save from before D4 (no fields) loads with the defaults, not undefined or NaN', () => {
    const rm = freshRun();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    for (const key of Object.keys(createShrineBoonModifiers()))
      delete saved.blessingRuntimeModifiers[key];
    const back = RunManager.fromJSON(saved, data);
    for (const [key, value] of Object.entries(createShrineBoonModifiers()))
      expect(back.blessingRuntimeModifiers[key], key).toEqual(value);
  });

  it('a hand-edited save keeps nothing malformed', () => {
    const mods = sanitizeShrineBoonModifiers({
      underParGoldPerTurn: 'lots',
      moveTypeBattleStats: [{ moveTypes: ['Boat'], stat: 'MOV', value: 1 }, 7],
      staffUsesBonus: -3,
      carryMultiplier: 99,
      stealIgnoresSpeed: 'true',
      recruitAlternates: 5,
      bossBattleVision: 1.7,
      parTurnDelta: null,
      extraChurchVows: 9,
      eclipseForetell: -1,
      eclipseSpareTypes: ['recruit', 'boss', 'recruit'],
      nextActLootCards: 8,
    });
    expect(mods).toEqual({
      underParGoldPerTurn: 0,
      moveTypeBattleStats: [],
      staffUsesBonus: 0,
      carryMultiplier: 4,
      stealIgnoresSpeed: false,
      recruitAlternates: 1,
      bossBattleVision: 1,
      parTurnDelta: 0,
      extraChurchVows: 2,
      eclipseForetell: 0,
      eclipseSpareTypes: ['recruit'],
      nextActLootCards: 2,
    });
  });

  it('an Army Stats grant survives a save; a malformed one is dropped', () => {
    const rm = hold(freshRun(), 'late_bloom');
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.blessingRuntimeModifiers.actStartGrants.push({
      blessingId: 'late_bloom',
      kind: 'army_stats',
      value: 0,
      paidActs: [],
    });
    // A grant saved without its count (before the re-tune) gave every stat but Move: kept so.
    saved.blessingRuntimeModifiers.actStartGrants.push({
      blessingId: 'old_bloom',
      kind: 'army_stats',
      value: 1,
      paidActs: ['act1'],
    });
    const back = RunManager.fromJSON(saved, data);
    expect(back.blessingRuntimeModifiers.actStartGrants).toEqual([
      { blessingId: 'late_bloom', kind: 'army_stats', value: 1, stats: 2, paidActs: ['act1'] },
      { blessingId: 'old_bloom', kind: 'army_stats', value: 1, stats: 8, paidActs: ['act1'] },
    ]);
  });
});
