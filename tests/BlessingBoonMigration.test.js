// Old saves across the blessing reworks (engine/BlessingBoonMigration.js, docs/specs/blessings-v3.md
// §4): a run saved holding Steady Hands / Frugal Smith / Terrain Mastery / Pilgrim Coin /
// Coin of Fate / Quartermaster Cache keeps the OLD boon's numbers in its saved runtime
// modifiers (handlers never re-run on load), so fromJSON converts them once per save. Each
// test names a way that could break: a boon left doubled, a price taken back with the boon,
// a second load migrating again, a new run or the prologue migrated, a payment repeated.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  BLESSING_BOON_REVISION,
  migrateHeldBlessingBoons,
} from '../src/engine/BlessingBoonMigration.js';
import { ACT_SEQUENCE } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  configurable: true,
  writable: true,
});

const data = loadGameData();

/** What the old `all_act_hit_bonus` handler logged (d3c4c16 RunManager ~1749). */
function oldSteadyHandsRecord(acts = ACT_SEQUENCE, appliedValue = 3) {
  return {
    timestamp: 1,
    stage: 'run_start',
    eventType: 'effect_applied',
    blessingId: 'steady_hands',
    effectType: 'all_act_hit_bonus',
    details: { appliedValue, acts: [...acts], totals: {} },
  };
}

/**
 * A save as the build before the reworks wrote it: a plain run at `act`, then the held
 * blessings, their old runtime numbers and history, and no `blessingBoonRevision`.
 */
function oldSave({ held = [], midRun = false, act = 0, modifiers = {}, history = [] } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 7001, applyBlessingsAtStart: false });
  for (let i = 0; i < act; i++) rm.advanceAct();
  const saved = JSON.parse(JSON.stringify(rm.toJSON()));
  delete saved.blessingBoonRevision;
  saved.activeBlessings = held.map((id) =>
    midRun ? { id, rolledCost: null, midRun: true } : { id, rolledCost: null },
  );
  // The old build had none of the new fields.
  for (const key of [
    'firstStrikeHitBonus',
    'stationaryCombatBonus',
    'freeForgesPerShop',
    'extraShopsPerAct',
    'actStartGrants',
  ])
    delete saved.blessingRuntimeModifiers[key];
  saved.blessingRuntimeModifiers = { ...saved.blessingRuntimeModifiers, ...modifiers };
  saved.blessingHistory = history;
  return saved;
}

const load = (saved) => RunManager.fromJSON(JSON.parse(JSON.stringify(saved)), data);
const reload = (rm) => load(rm.toJSON());
const mods = (rm) => rm.blessingRuntimeModifiers;

describe('the revision', () => {
  it('is 1 and a new run saves it', () => {
    expect(BLESSING_BOON_REVISION).toBe(1);
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 7001, applyBlessingsAtStart: false });
    expect(rm.toJSON().blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
  });

  it('an old save has none, loads at the current revision and saves it', () => {
    const saved = oldSave();
    expect(saved.blessingBoonRevision).toBeUndefined();
    expect(load(saved).toJSON().blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
  });
});

describe('Steady Hands -> Keen Eye', () => {
  const acts = Object.fromEntries(ACT_SEQUENCE.map((act) => [act, 3]));

  it('takes back the +3 Hit of every act and grants the +10 first-strike Hit', () => {
    const rm = load(
      oldSave({
        held: ['steady_hands'],
        modifiers: { actHitBonusByAct: { ...acts } },
        history: [oldSteadyHandsRecord()],
      }),
    );
    expect(mods(rm).actHitBonusByAct).toEqual({});
    expect(mods(rm).firstStrikeHitBonus).toBe(10);
    for (const act of ACT_SEQUENCE)
      expect(rm.getActHitBonusForUnit({ faction: 'player' }, act)).toBe(0);
  });

  it('an Act 1 -8 Hit price from another blessing survives (it shared the act-1 slot)', () => {
    // Steady Hands +3 on top of a -8 price: the save holds -5 for Act 1.
    const rm = load(
      oldSave({
        held: ['steady_hands', 'iron_oath'],
        modifiers: { actHitBonusByAct: { ...acts, act1: -5 } },
        history: [oldSteadyHandsRecord()],
      }),
    );
    expect(mods(rm).actHitBonusByAct).toEqual({ act1: -8 });
    expect(rm.getActHitBonusForUnit({ faction: 'player' }, 'act1')).toBe(-8);
    expect(rm.getActHitBonusForUnit({ faction: 'player' }, 'act2')).toBe(0);
    expect(rm.getBlessingCombatProfile('act1').actHitBonus).toBe(-8);
  });

  it('subtracts what the history says it added, not a guess', () => {
    // A hypothetical +2 version of the old boon over two acts only.
    const rm = load(
      oldSave({
        held: ['steady_hands'],
        modifiers: { actHitBonusByAct: { act1: 2, act2: 2 } },
        history: [oldSteadyHandsRecord(['act1', 'act2'], 2)],
      }),
    );
    expect(mods(rm).actHitBonusByAct).toEqual({});
  });

  it('a save whose history lost the record falls back to the data’s +3 in every act', () => {
    const rm = load(
      oldSave({ held: ['steady_hands'], modifiers: { actHitBonusByAct: { ...acts } } }),
    );
    expect(mods(rm).actHitBonusByAct).toEqual({});
    expect(mods(rm).firstStrikeHitBonus).toBe(10);
  });

  it('taken at a church mid-run (history from the same handler) migrates too', () => {
    const rm = load(
      oldSave({
        held: ['steady_hands'],
        midRun: true,
        act: 1,
        modifiers: { actHitBonusByAct: { ...acts } },
        history: [oldSteadyHandsRecord()],
      }),
    );
    expect(mods(rm).actHitBonusByAct).toEqual({});
    expect(mods(rm).firstStrikeHitBonus).toBe(10);
  });
});

describe('Frugal Smith -> Smith’s Mark', () => {
  it('takes back the 30% and grants the free forge, keeping the extra forge', () => {
    const rm = load(
      oldSave({
        held: ['frugal_smith'],
        modifiers: { forgeCostDiscount: 0.3, forgeLimitDelta: 1 },
      }),
    );
    expect(mods(rm).forgeCostDiscount).toBe(0);
    expect(mods(rm).freeForgesPerShop).toBe(1);
    expect(rm.getFreeForgesPerShop()).toBe(1);
    expect(mods(rm).forgeLimitDelta).toBe(1);
  });

  it('a +20% forge price from another blessing survives', () => {
    // forge_cost_multiplier +0.2 reads as a -0.2 discount; Frugal Smith's 0.3 on top is 0.1.
    const rm = load(
      oldSave({
        held: ['frugal_smith', 'some_forge_price_holder'],
        modifiers: { forgeCostDiscount: 0.3 + -0.2, forgeLimitDelta: 1 },
      }),
    );
    expect(mods(rm).forgeCostDiscount).toBe(-0.2);
    expect(rm.getForgeCostDiscount()).toBe(-0.2);
  });
});

describe('Terrain Mastery -> Hold the Line', () => {
  const entry = { terrains: ['Forest', 'Fort'], avoidBonus: 10, defBonus: 1 };

  it('drops the Forest/Fort entry and grants the stationary bonus', () => {
    const rm = load(
      oldSave({ held: ['terrain_mastery'], modifiers: { terrainCombatBonuses: [entry] } }),
    );
    expect(mods(rm).stationaryCombatBonus).toEqual({ defBonus: 2, avoidBonus: 10 });
    expect(rm.getBlessingCombatProfile().stationary).toEqual({ defBonus: 2, avoidBonus: 10 });
    // The retired field is gone from the run and from its next save.
    expect(mods(rm).terrainCombatBonuses).toBeUndefined();
    expect(rm.getBlessingCombatProfile()).not.toHaveProperty('legacyTerrainBonuses');
    expect(rm.toJSON().blessingRuntimeModifiers).not.toHaveProperty('terrainCombatBonuses');
  });

  it('a save holding the blessing but a missing entry still gets the new bonus', () => {
    const rm = load(
      oldSave({ held: ['terrain_mastery'], modifiers: { terrainCombatBonuses: [] } }),
    );
    expect(mods(rm).stationaryCombatBonus).toEqual({ defBonus: 2, avoidBonus: 10 });
  });
});

describe('Pilgrim Coin -> Pilgrim’s Road', () => {
  it('takes back the extra item and the 15% and grants the extra shop', () => {
    const rm = load(
      oldSave({
        held: ['pilgrim_coin'],
        modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 },
      }),
    );
    expect(mods(rm).shopItemCountDelta).toBe(0);
    expect(mods(rm).shopPriceDiscount).toBe(0);
    expect(mods(rm).extraShopsPerAct).toBe(1);
  });

  it('keeps a price another blessing put on the same fields', () => {
    // Shops dearer +15% (a discount of -0.15) beside Pilgrim Coin's 0.15 discount: 0 in the save.
    const rm = load(
      oldSave({
        held: ['pilgrim_coin', 'some_shop_price_holder'],
        modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 + -0.15 },
      }),
    );
    expect(mods(rm).shopPriceDiscount).toBe(-0.15);
    expect(mods(rm).shopItemCountDelta).toBe(0);
  });

  it('does not re-draw the current act’s map; the next act gains its shop', () => {
    const saved = oldSave({
      held: ['pilgrim_coin'],
      modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 },
    });
    const rm = load(saved);
    const shopsBefore = rm.nodeMap.nodes.filter((n) => n.pilgrimShop).length;
    expect(shopsBefore).toBe(0);
    rm.advanceAct();
    expect(rm.nodeMap.nodes.filter((n) => n.pilgrimShop)).toHaveLength(1);
  });
});

describe('Coin of Fate -> Advance Pay and Quartermaster Cache', () => {
  it('Coin of Fate in Act 2: no gold taken back, 250 paid from Act 3, once', () => {
    const saved = oldSave({ held: ['coin_of_fate'], act: 1 });
    const gold = saved.gold;
    const rm = load(saved);
    expect(rm.currentAct).toBe('act2');
    expect(rm.gold).toBe(gold);
    expect(mods(rm).actStartGrants).toEqual([
      { blessingId: 'coin_of_fate', kind: 'gold', value: 250, paidActs: ['act1', 'act2'] },
    ]);
    // Nothing is owed for the act already begun, however often the save loads.
    expect(reload(rm)._payActStartGrants('act_transition')).toEqual([]);
    expect(rm.advanceAct().actStartGrants).toHaveLength(1);
    expect(rm.currentAct).toBe('act3');
    expect(rm.gold).toBe(gold + 250);
    // The recurring part does not ride the next load.
    expect(reload(rm)._payActStartGrants('act_transition')).toEqual([]);
  });

  it('Quartermaster Cache in Act 1: the Elixirs already handed out stay, one arrives each later act', () => {
    const saved = oldSave({ held: ['quartermaster_cache'] });
    const convoyBefore = saved.convoy.consumables.length;
    const rm = load(saved);
    expect(rm.getConvoyItems().consumables).toHaveLength(convoyBefore);
    expect(mods(rm).actStartGrants).toEqual([
      {
        blessingId: 'quartermaster_cache',
        kind: 'item',
        itemName: 'Elixir',
        count: 1,
        paidActs: ['act1'],
      },
    ]);
    expect(reload(rm)._payActStartGrants('act_transition')).toEqual([]);
    rm.advanceAct();
    expect(rm.getConvoyItems().consumables.filter((i) => i.name === 'Elixir')).toHaveLength(1);
  });

  it('a Coin of Fate taken mid-run migrates the same way', () => {
    const rm = load(oldSave({ held: ['coin_of_fate'], midRun: true, act: 2 }));
    expect(mods(rm).actStartGrants[0].paidActs).toEqual(['act1', 'act2', 'act3']);
  });
});

describe('Blood Forge and Nomad’s Pact', () => {
  it('change nothing: their effect is the same', () => {
    const saved = oldSave({ held: ['blood_forge', 'nomad_pact'] });
    saved.blessingRuntimeModifiers.recruitLevelBonus = 2;
    const rm = load(saved);
    const expected = JSON.parse(JSON.stringify(saved.blessingRuntimeModifiers));
    // Only the new fields' defaults differ from the raw old shape.
    for (const [key, value] of Object.entries(expected)) expect(mods(rm)[key], key).toEqual(value);
    expect(rm.getRecruitLevelBonus()).toBe(2);
  });
});

describe('who is migrated', () => {
  it('loading an old save twice (the save written between) migrates once', () => {
    const first = load(
      oldSave({
        held: ['steady_hands', 'frugal_smith', 'terrain_mastery', 'pilgrim_coin', 'coin_of_fate'],
        modifiers: {
          actHitBonusByAct: Object.fromEntries(ACT_SEQUENCE.map((act) => [act, 3])),
          forgeCostDiscount: 0.3,
          shopItemCountDelta: 1,
          shopPriceDiscount: 0.15,
          terrainCombatBonuses: [{ terrains: ['Forest', 'Fort'], avoidBonus: 10, defBonus: 1 }],
        },
        history: [oldSteadyHandsRecord()],
      }),
    );
    const once = JSON.parse(JSON.stringify(first.blessingRuntimeModifiers));
    const second = reload(first);
    expect(second.blessingRuntimeModifiers).toEqual(once);
    expect(reload(second).blessingRuntimeModifiers).toEqual(once);
    expect(second.blessingHistory.filter((e) => e.stage === 'migration')).toHaveLength(
      first.blessingHistory.filter((e) => e.stage === 'migration').length,
    );
  });

  it('loading the same raw save object twice gives the same result (the save is not mutated)', () => {
    const saved = oldSave({
      held: ['frugal_smith'],
      modifiers: { forgeCostDiscount: 0.3, forgeLimitDelta: 1 },
    });
    const a = RunManager.fromJSON(saved, data);
    const b = RunManager.fromJSON(saved, data);
    expect(mods(a).forgeCostDiscount).toBe(0);
    expect(mods(b).forgeCostDiscount).toBe(0);
    expect(mods(b).freeForgesPerShop).toBe(1);
    // The parsed save itself is left as it was read (still the old numbers, no revision).
    expect(saved.blessingRuntimeModifiers.forgeCostDiscount).toBe(0.3);
    expect(saved.blessingBoonRevision).toBeUndefined();
  });

  it('a save holding Terrain Mastery keeps its old terrain entry in the parsed object', () => {
    const entry = { terrains: ['Forest', 'Fort'], avoidBonus: 10, defBonus: 1 };
    const saved = oldSave({
      held: ['terrain_mastery'],
      modifiers: { terrainCombatBonuses: [entry] },
    });
    RunManager.fromJSON(saved, data);
    const again = RunManager.fromJSON(saved, data);
    expect(saved.blessingRuntimeModifiers.terrainCombatBonuses).toEqual([entry]);
    expect(mods(again).stationaryCombatBonus).toEqual({ defBonus: 2, avoidBonus: 10 });
  });

  it('a new run holding the new blessings never migrates when it is saved and loaded', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 7001, applyBlessingsAtStart: false });
    rm.activeBlessings = [
      'steady_hands',
      'frugal_smith',
      'terrain_mastery',
      'pilgrim_coin',
      'coin_of_fate',
    ].map((id) => ({ id, rolledCost: null }));
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    const before = JSON.parse(JSON.stringify(rm.blessingRuntimeModifiers));
    expect(before.firstStrikeHitBonus).toBe(10);
    expect(before.freeForgesPerShop).toBe(1);
    const loaded = reload(rm);
    expect(loaded.blessingRuntimeModifiers).toEqual(before);
    expect(loaded.blessingHistory.filter((e) => e.stage === 'migration')).toEqual([]);
    expect(loaded.getFreeForgesPerShop()).toBe(1);
    expect(loaded.getForgeCostDiscount()).toBe(0);
  });

  it('a new run’s mid-run Keen Eye (a church) is not migrated on load either', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 7001, applyBlessingsAtStart: false });
    rm.advanceAct();
    expect(rm.addBlessingMidRun('steady_hands')).toBe(true);
    const loaded = reload(rm);
    expect(mods(loaded).firstStrikeHitBonus).toBe(10);
    expect(mods(loaded).actHitBonusByAct).toEqual({});
  });

  it('the prologue is never migrated, whatever its save holds', () => {
    const rm = new RunManager(data);
    rm.startPrologue(data, data.prologue);
    expect(rm.toJSON().blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.blessingBoonRevision;
    saved.activeBlessings = [{ id: 'frugal_smith', rolledCost: null }];
    saved.blessingRuntimeModifiers.forgeCostDiscount = 0.3;
    const loaded = load(saved);
    expect(loaded.mode).toBe('prologue');
    expect(mods(loaded).forgeCostDiscount).toBe(0.3);
    expect(mods(loaded).freeForgesPerShop).toBe(0);
    expect(loaded.toJSON().blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
  });

  it('an old save holding none of them is untouched but for the revision', () => {
    const saved = oldSave({ held: ['blessed_vigor'], modifiers: { forgeCostDiscount: -0.2 } });
    const rm = load(saved);
    expect(mods(rm).forgeCostDiscount).toBe(-0.2);
    expect(mods(rm).firstStrikeHitBonus).toBe(0);
    expect(rm.blessingHistory.filter((e) => e.stage === 'migration')).toEqual([]);
  });

  it('migrateHeldBlessingBoons run twice on one run does not take back twice', () => {
    const rm = load(
      oldSave({
        held: ['frugal_smith'],
        modifiers: { forgeCostDiscount: 0.3, forgeLimitDelta: 1 },
      }),
    );
    expect(migrateHeldBlessingBoons(rm)).toEqual([]);
    expect(mods(rm).forgeCostDiscount).toBe(0);
  });
});
