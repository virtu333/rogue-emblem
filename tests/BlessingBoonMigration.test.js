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
 * One record as the old `_recordBlessingEvent` wrote it (RunManager at 2adde771 / d3c4c168:
 * stage 'run_start', eventType 'effect_applied', the effect's type, its figures in details).
 */
function oldRecord(blessingId, effectType, details) {
  return {
    timestamp: 1,
    stage: 'run_start',
    eventType: 'effect_applied',
    blessingId,
    effectType,
    details,
  };
}
/** `act_hit_bonus` (one act): details { act, appliedValue, total }. Steady Hands was +5 in act1 before Feb 19. */
const actHitRecord = (blessingId, act, appliedValue, total = appliedValue) =>
  oldRecord(blessingId, 'act_hit_bonus', { act, appliedValue, total });
/** `forge_cost_multiplier`: details.appliedValue is the DISCOUNT delta (-value), so a boon is positive and a price negative. */
const forgeRecord = (blessingId, value) =>
  oldRecord(blessingId, 'forge_cost_multiplier', { appliedValue: -value, total: -value });
const itemsRecord = (blessingId, appliedValue = 1) =>
  oldRecord(blessingId, 'shop_item_count_delta', { appliedValue, total: appliedValue });
const shopDiscountRecord = (blessingId, appliedValue) =>
  oldRecord(blessingId, 'shop_price_discount', { appliedValue, total: appliedValue });
const goldMultiplierRecord = (blessingId, appliedValue) =>
  oldRecord(blessingId, 'battle_gold_multiplier_delta', { appliedValue, total: appliedValue });

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

  it('a Feb-era save (+5 Hit in Act 1 only, an act_hit_bonus record) takes back exactly that', () => {
    const rm = load(
      oldSave({
        held: ['steady_hands'],
        modifiers: { actHitBonusByAct: { act1: 5 } },
        history: [actHitRecord('steady_hands', 'act1', 5)],
      }),
    );
    // Not the later +3 in every act: nothing negative is left behind.
    expect(mods(rm).actHitBonusByAct).toEqual({});
    expect(mods(rm).firstStrikeHitBonus).toBe(10);
    for (const act of ACT_SEQUENCE)
      expect(rm.getActHitBonusForUnit({ faction: 'player' }, act)).toBe(0);
  });

  it('a Feb-era +5 beside another blessing’s Act 1 -8 price leaves the price', () => {
    // iron_oath holds act1_hit_down: its own negative record is not Steady Hands'.
    const rm = load(
      oldSave({
        held: ['steady_hands', 'iron_oath'],
        modifiers: { actHitBonusByAct: { act1: -3 } },
        history: [
          actHitRecord('steady_hands', 'act1', 5),
          actHitRecord('iron_oath', 'act1', -8, -3),
        ],
      }),
    );
    expect(mods(rm).actHitBonusByAct).toEqual({ act1: -8 });
  });

  it('a Steady Hands record that is not a positive boon is never taken back (and is not a lost history)', () => {
    // A skipped record has no appliedValue; the fallback +3 must not guess over it.
    const rm = load(
      oldSave({
        held: ['steady_hands'],
        modifiers: { actHitBonusByAct: { act1: 4 } },
        history: [
          oldRecord('steady_hands', 'all_act_hit_bonus', {
            skipped: true,
            reason: 'zero_all_act_hit_bonus',
          }),
        ],
      }),
    );
    expect(mods(rm).actHitBonusByAct).toEqual({ act1: 4 });
    expect(mods(rm).firstStrikeHitBonus).toBe(10);
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
    // (No shipped blessing holds forge_dearer now, an older price table did: its record is
    // the sign-separated negative one, filed under whichever blessing held the price.)
    const rm = load(
      oldSave({
        held: ['frugal_smith', 'war_veteran'],
        modifiers: { forgeCostDiscount: 0.3 + -0.2, forgeLimitDelta: 1 },
      }),
    );
    expect(mods(rm).forgeCostDiscount).toBe(-0.2);
    expect(rm.getForgeCostDiscount()).toBe(-0.2);
  });

  it('a Feb-era 20% discount (forge_cost_multiplier -0.2, no extra forge) takes back 20%, not 30%', () => {
    const rm = load(
      oldSave({
        held: ['frugal_smith'],
        modifiers: { forgeCostDiscount: 0.2 },
        history: [forgeRecord('frugal_smith', -0.2)],
      }),
    );
    expect(mods(rm).forgeCostDiscount).toBe(0);
    expect(mods(rm).freeForgesPerShop).toBe(1);
  });

  it('the logged discount is taken back and the logged +20% price (negative record) stays', () => {
    const rm = load(
      oldSave({
        held: ['frugal_smith', 'war_veteran'],
        modifiers: { forgeCostDiscount: 0.2 + -0.2 + 0.1 },
        history: [
          forgeRecord('frugal_smith', -0.2),
          forgeRecord('war_veteran', 0.2),
          oldRecord('frugal_smith', 'forge_cost_discount', { appliedValue: 0.1, total: 0.1 }),
        ],
      }),
    );
    // 0.2 and 0.1 are Frugal Smith's; the -0.2 is the price.
    expect(mods(rm).forgeCostDiscount).toBe(-0.2);
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
    // Shops dearer +15% (a discount of -0.15, held by war_veteran) beside Pilgrim Coin's 0.15
    // discount: 0 in the save.
    const rm = load(
      oldSave({
        held: ['pilgrim_coin', 'war_veteran'],
        modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 + -0.15 },
      }),
    );
    expect(mods(rm).shopPriceDiscount).toBe(-0.15);
    expect(mods(rm).shopItemCountDelta).toBe(0);
  });

  it('a save before Feb 16 (+1 item, no discount record) takes back the item and no discount', () => {
    const rm = load(
      oldSave({
        held: ['pilgrim_coin'],
        modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0 },
        history: [itemsRecord('pilgrim_coin')],
      }),
    );
    expect(mods(rm).shopItemCountDelta).toBe(0);
    expect(mods(rm).shopPriceDiscount).toBe(0);
    expect(mods(rm).extraShopsPerAct).toBe(1);
  });

  it('takes back the logged item and discount and leaves the logged price (negative) alone', () => {
    const rm = load(
      oldSave({
        held: ['pilgrim_coin', 'war_veteran'],
        modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 + -0.15 },
        history: [
          itemsRecord('pilgrim_coin'),
          shopDiscountRecord('pilgrim_coin', 0.15),
          shopDiscountRecord('war_veteran', -0.15),
        ],
      }),
    );
    expect(mods(rm).shopItemCountDelta).toBe(0);
    expect(mods(rm).shopPriceDiscount).toBe(-0.15);
  });

  /** Nodes the pass converted, and the party's row. */
  const shopsOf = (rm) => rm.nodeMap.nodes.filter((n) => n.pilgrimShop);

  /** An Act 2 save with the party standing on a finished row-0 node. */
  function pilgrimActTwoSave() {
    const saved = oldSave({
      held: ['pilgrim_coin'],
      act: 1,
      modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 },
    });
    const here = saved.nodeMap.nodes.find((n) => n.row === 0);
    here.completed = true;
    saved.currentNodeId = here.id;
    return { saved, here };
  }

  it('mid-Act 2: the current map gains one shop ahead of the party, at once', () => {
    const { saved, here } = pilgrimActTwoSave();
    const rm = load(saved);
    const shops = shopsOf(rm);
    expect(shops).toHaveLength(1);
    expect(shops[0].type).toBe('shop');
    expect(shops[0].row).toBeGreaterThan(here.row);
    // Reachable from where the party stands, never a node it can no longer go to.
    const reachable = new Set([here.id]);
    for (const id of reachable) {
      for (const next of rm.nodeMap.nodes.find((n) => n.id === id).edges) reachable.add(next);
    }
    expect(reachable.has(shops[0].id)).toBe(true);
    // The converted node was an event or church before; the rest of the map is as saved.
    const before = saved.nodeMap.nodes.find((n) => n.id === shops[0].id);
    expect(['event', 'church']).toContain(before.type);
    const changed = rm.nodeMap.nodes.filter(
      (n) => n.type !== saved.nodeMap.nodes.find((o) => o.id === n.id).type,
    );
    expect(changed.map((n) => n.id)).toEqual([shops[0].id]);
    expect(
      rm.blessingHistory.find((e) => e.stage === 'migration' && e.blessingId === 'pilgrim_coin')
        .details.converted,
    ).toEqual([shops[0].id]);
  });

  it('a reload (and a second migration call) never stamps a second shop', () => {
    const { saved } = pilgrimActTwoSave();
    const rm = load(saved);
    const ids = shopsOf(rm).map((n) => n.id);
    expect(ids).toHaveLength(1);
    expect(shopsOf(reload(rm)).map((n) => n.id)).toEqual(ids);
    expect(migrateHeldBlessingBoons(rm)).toEqual([]);
    expect(shopsOf(rm).map((n) => n.id)).toEqual(ids);
    // The next act gains its own.
    rm.advanceAct();
    expect(shopsOf(rm)).toHaveLength(1);
  });

  it('the migration does not touch the parsed save’s own map (loading it twice gives the same shop)', () => {
    const { saved } = pilgrimActTwoSave();
    const a = RunManager.fromJSON(saved, data);
    const b = RunManager.fromJSON(saved, data);
    expect(saved.nodeMap.nodes.some((n) => n.pilgrimShop)).toBe(false);
    expect(shopsOf(a).map((n) => n.id)).toEqual(shopsOf(b).map((n) => n.id));
  });

  it('draws nothing from the node-map stream: the same seed converts the same node', () => {
    const one = shopsOf(load(pilgrimActTwoSave().saved)).map((n) => n.id);
    const two = shopsOf(load(pilgrimActTwoSave().saved)).map((n) => n.id);
    expect(two).toEqual(one);
  });

  it('runs after the Eclipse is re-applied: a road already burning never keeps a stamped shop', () => {
    // Shadow at its cap: every node past its threshold falls on load. A shop stamped BEFORE
    // that would be burned at once while keeping its pilgrimShop mark (and so never be
    // replaced); stamped after, only a standing node can be chosen.
    const { saved } = pilgrimActTwoSave();
    saved.eclipse = { ...(saved.eclipse || {}), enabled: true, shadow: 100, actShadow: 100 };
    const rm = load(saved);
    for (const node of shopsOf(rm)) {
      expect(node.type).toBe('shop');
      expect(node.eclipse).toBeFalsy();
    }
    expect(rm.nodeMap.nodes.some((n) => n.eclipse)).toBe(true); // the Eclipse really ran
  });

  it('on the last row of the last act nothing can be added, and nothing throws', () => {
    const saved = oldSave({
      held: ['pilgrim_coin'],
      act: ACT_SEQUENCE.length - 1,
      modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 },
    });
    const lastRow = Math.max(...saved.nodeMap.nodes.map((n) => n.row));
    const here = saved.nodeMap.nodes.find((n) => n.row === lastRow);
    saved.currentNodeId = here.id;
    const typesBefore = saved.nodeMap.nodes.map((n) => n.type);
    let rm;
    expect(() => {
      rm = load(saved);
    }).not.toThrow();
    expect(rm.nodeMap.nodes.map((n) => n.type)).toEqual(typesBefore);
    expect(shopsOf(rm)).toHaveLength(0);
    // The blessing is still converted: the rest of the numbers move.
    expect(mods(rm).extraShopsPerAct).toBe(1);
    expect(mods(rm).shopItemCountDelta).toBe(0);
  });

  it('a save with no map (between acts) converts the numbers and stamps nothing', () => {
    const saved = oldSave({
      held: ['pilgrim_coin'],
      modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 },
    });
    saved.nodeMap = null;
    let rm;
    expect(() => {
      rm = load(saved);
    }).not.toThrow();
    expect(mods(rm).extraShopsPerAct).toBe(1);
    expect(rm.nodeMap).toBeNull();
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

  it('a Feb-era +15% battle gold multiplier (battle_gold_multiplier_delta) is taken back', () => {
    const saved = oldSave({
      held: ['coin_of_fate'],
      modifiers: { battleGoldMultiplierDelta: 0.15 },
      history: [goldMultiplierRecord('coin_of_fate', 0.15)],
    });
    const rm = load(saved);
    expect(mods(rm).battleGoldMultiplierDelta).toBe(0);
    expect(rm.gold).toBe(saved.gold);
    expect(mods(rm).actStartGrants).toHaveLength(1);
  });

  it('a gold multiplier another blessing logged (a price) stays', () => {
    const rm = load(
      oldSave({
        held: ['coin_of_fate', 'war_veteran'],
        modifiers: { battleGoldMultiplierDelta: 0.15 - 0.1 },
        history: [
          goldMultiplierRecord('coin_of_fate', 0.15),
          goldMultiplierRecord('war_veteran', -0.1),
        ],
      }),
    );
    expect(mods(rm).battleGoldMultiplierDelta).toBe(-0.1);
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

describe('the revision gate and each rule’s own skip-guard', () => {
  const OLD_SHAPES = {
    steady_hands: {
      modifiers: { actHitBonusByAct: Object.fromEntries(ACT_SEQUENCE.map((act) => [act, 3])) },
      history: [oldSteadyHandsRecord()],
    },
    frugal_smith: {
      modifiers: { forgeCostDiscount: 0.3, forgeLimitDelta: 1 },
      history: [forgeRecord('frugal_smith', -0.3)],
    },
    terrain_mastery: {
      modifiers: {
        terrainCombatBonuses: [{ terrains: ['Forest', 'Fort'], avoidBonus: 10, defBonus: 1 }],
      },
      history: [],
    },
    pilgrim_coin: {
      modifiers: { shopItemCountDelta: 1, shopPriceDiscount: 0.15 },
      history: [itemsRecord('pilgrim_coin'), shopDiscountRecord('pilgrim_coin', 0.15)],
    },
    coin_of_fate: { modifiers: {}, history: [] },
    quartermaster_cache: { modifiers: {}, history: [] },
  };

  for (const [blessingId, shape] of Object.entries(OLD_SHAPES)) {
    it(`${blessingId}: a migrated run an older client wrote back without its revision loads unchanged`, () => {
      const first = load(oldSave({ held: [blessingId], ...shape }));
      const once = JSON.parse(JSON.stringify(first.toJSON()));
      expect(once.blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
      // An older client does not know the field, so it saves the run without it.
      delete once.blessingBoonRevision;
      const second = load(once);
      expect(second.blessingRuntimeModifiers).toEqual(first.blessingRuntimeModifiers);
      expect(second.blessingHistory.filter((e) => e.stage === 'migration')).toEqual(
        first.blessingHistory.filter((e) => e.stage === 'migration'),
      );
      expect(second.nodeMap).toEqual(first.nodeMap);
      expect(second.toJSON().blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
    });
  }

  it('a save whose battle checkpoint is rejected is still migrated (the early return skips nothing)', () => {
    const saved = oldSave({
      held: ['frugal_smith'],
      modifiers: { forgeCostDiscount: 0.3, forgeLimitDelta: 1 },
    });
    // A v1 checkpoint cannot be resumed: fromJSON returns early for the recovery screen.
    saved.battleInProgress = { nodeId: saved.nodeMap.nodes[0].id, checkpoint: { version: 1 } };
    const rm = load(saved);
    expect(rm._battleRecoveryInvalid).toBe(true);
    expect(mods(rm).forgeCostDiscount).toBe(0);
    expect(mods(rm).freeForgesPerShop).toBe(1);
    expect(rm.blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
  });

  it('a save already at the current revision is not migrated, whatever numbers it holds', () => {
    const saved = oldSave({
      held: ['frugal_smith', 'steady_hands', 'terrain_mastery', 'coin_of_fate'],
      modifiers: { forgeCostDiscount: 0.3, actHitBonusByAct: { act1: 3 } },
    });
    saved.blessingBoonRevision = BLESSING_BOON_REVISION;
    const rm = load(saved);
    // Every field a rule would change is as saved.
    expect(mods(rm).forgeCostDiscount).toBe(0.3);
    expect(mods(rm).freeForgesPerShop).toBe(0);
    expect(mods(rm).firstStrikeHitBonus).toBe(0);
    expect(mods(rm).actHitBonusByAct).toEqual({ act1: 3 });
    expect(mods(rm).stationaryCombatBonus).toEqual({ defBonus: 0, avoidBonus: 0 });
    expect(mods(rm).actStartGrants).toEqual([]);
    expect(rm.blessingHistory.filter((e) => e.stage === 'migration')).toEqual([]);
    expect(rm.toJSON().blessingBoonRevision).toBe(BLESSING_BOON_REVISION);
  });

  it('a save from a newer revision is left alone as well', () => {
    const saved = oldSave({
      held: ['frugal_smith'],
      modifiers: { forgeCostDiscount: 0.3 },
    });
    saved.blessingBoonRevision = BLESSING_BOON_REVISION + 1;
    const rm = load(saved);
    expect(mods(rm).forgeCostDiscount).toBe(0.3);
    expect(mods(rm).freeForgesPerShop).toBe(0);
  });
});
