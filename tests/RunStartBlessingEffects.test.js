// The run-start blessing effects (RunManager._applySingleRunStartBlessingEffect): what each
// effect type does to a run and what it records, pinned so the handler table that carries them
// (engine/RunStartBlessingEffects.js) cannot drop, rename or reorder one unseen.
//
// Ways this can fail, a test each:
//   1. a type's handler is lost or wired to the wrong type (its card does nothing, or does
//      another card's job): one block per type, asserting the run's state AND its history record;
//   2. a malformed set is applied instead of skipped (or a good one skipped): the `invalid_*`
//      and zero-value paths of the types that have them;
//   3. the dispatcher's own rules drift: an effect with no type or params is ignored silently, a
//      non-finite `value` is dropped silently before any handler runs, an unknown type is
//      recorded as `unhandled_effect_type`;
//   4. a handler writes the wrong stage: a mid-run grant records 'mid_run';
//   5. the order against the other boon modules changes: the earned, twisted and shrine boons
//      and the earned modifiers keep working beside the table, and no type is in two places;
//   6. a new effect type is added to the catalog without a handler, or removed from the table.
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { RUN_START_BLESSING_EFFECTS } from '../src/engine/RunStartBlessingEffects.js';
import { SHRINE_BOON_TYPES } from '../src/engine/ShrineBoons.js';
import { EARNED_BOON_TYPES } from '../src/engine/EarnedBoons.js';
import { TWISTED_BOON_TYPES, TWISTED_TWIST_TYPES } from '../src/engine/TwistedBoons.js';
import { ACT_SEQUENCE, XP_STAT_NAMES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const ID = 'test_blessing';

function freshRun(difficultyId = 'normal') {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 17, difficultyId, applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
const effect = (type, params) => ({ type, params });
/** Apply one effect; return the history records it wrote. */
function apply(rm, type, params, blessingId = ID) {
  const before = rm.blessingHistory.length;
  rm._applySingleRunStartBlessingEffect(blessingId, effect(type, params));
  return rm.blessingHistory.slice(before);
}
/** The one record an effect wrote. */
function applyOne(rm, type, params) {
  const records = apply(rm, type, params);
  expect(records, type).toHaveLength(1);
  expect(records[0].effectType).toBe(type);
  expect(records[0].blessingId).toBe(ID);
  expect(records[0].eventType).toBe('effect_applied');
  return records[0];
}
const unit = (rm, name) => rm.roster.find((u) => u.name === name);
const names = (units) => units.map((u) => u.name);
const mods = (rm) => rm.blessingRuntimeModifiers;
const statsOf = (rm) => Object.fromEntries(rm.roster.map((u) => [u.name, { ...u.stats }]));
const growthsOf = (rm) => Object.fromEntries(rm.roster.map((u) => [u.name, { ...u.growths }]));
const forgeLevels = (rm, lordsOnly = true) =>
  rm.roster
    .filter((u) => !lordsOnly || u.isLord)
    .flatMap((u) => [u.weapon, ...u.inventory].filter(Boolean))
    .filter((w, i, all) => all.indexOf(w) === i)
    .reduce((sum, w) => sum + (w._forgeLevel || 0), 0);

describe('the roster these tests stand on', () => {
  it('is two lords and one recruit (the assertions below name them)', () => {
    const rm = freshRun();
    expect(rm.roster.map((u) => [u.name, u.isLord])).toEqual([
      ['Edric', true],
      ['Sera', true],
      ['Gaspar', false],
    ]);
    expect(rm.currentAct).toBe('act1');
    expect(rm.visionChargesRemaining).toBe(1);
  });
});

describe('the dispatcher', () => {
  it('ignores an effect with no type or no params, writing nothing', () => {
    const rm = freshRun();
    const gold = rm.gold;
    for (const bad of [null, undefined, {}, { type: 'gold_delta' }, { params: { value: 5 } }])
      rm._applySingleRunStartBlessingEffect(ID, bad);
    expect(rm.blessingHistory).toEqual([]);
    expect(rm.gold).toBe(gold);
  });

  it('drops an effect whose value is not a finite number, before any handler', () => {
    const rm = freshRun();
    const gold = rm.gold;
    expect(apply(rm, 'gold_delta', { value: 'abc' })).toEqual([]);
    expect(apply(rm, 'gold_delta', { value: Infinity })).toEqual([]);
    expect(apply(rm, 'church_revive_disabled', { value: 'abc' })).toEqual([]);
    expect(apply(rm, 'no_such_effect', { value: 'abc' })).toEqual([]);
    expect(rm.gold).toBe(gold);
    expect(mods(rm).churchReviveDisabled).toBe(false);
  });

  it('reads a missing or null value as 0', () => {
    const rm = freshRun();
    const gold = rm.gold;
    expect(applyOne(rm, 'gold_delta', {}).details).toEqual({ appliedValue: 0 });
    expect(applyOne(rm, 'gold_delta', { value: null }).details).toEqual({ appliedValue: 0 });
    expect(rm.gold).toBe(gold);
  });

  it('records an unknown type as skipped, and changes nothing', () => {
    const rm = freshRun();
    const before = JSON.stringify(statsOf(rm));
    const record = applyOne(rm, 'no_such_effect', { value: 3 });
    expect(record.details).toEqual({ skipped: true, reason: 'unhandled_effect_type' });
    expect(JSON.stringify(statsOf(rm))).toBe(before);
  });

  it('matches the type exactly (no trimming, no case folding)', () => {
    const rm = freshRun();
    const gold = rm.gold;
    for (const type of [' gold_delta', 'Gold_Delta', 'gold_delta ']) {
      const record = applyOne(rm, type, { value: 9 });
      expect(record.details.reason).toBe('unhandled_effect_type');
    }
    expect(rm.gold).toBe(gold);
  });

  it('stamps a mid-run grant as mid_run and a run-start one as run_start', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'gold_delta', { value: 1 }).stage).toBe('run_start');
    rm._blessingEventStage = 'mid_run';
    expect(applyOne(rm, 'gold_delta', { value: 1 }).stage).toBe('mid_run');
    rm._blessingEventStage = 'gift';
    expect(applyOne(rm, 'vision_delta', { value: 1 }).stage).toBe('gift');
  });

  it('runs the whole chain from applyRunStartBlessingEffects, boons then the rolled price', () => {
    const rm = freshRun();
    rm.activeBlessings = [
      {
        id: 'blessed_vigor',
        rolledCost: {
          label: 'Test price',
          effects: [effect('gold_delta', { value: -25 })],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    const gold = rm.gold;
    const hp = Object.fromEntries(rm.roster.map((u) => [u.name, u.stats.HP]));
    rm.applyRunStartBlessingEffects();
    const boon = data.blessings.blessings.find((b) => b.id === 'blessed_vigor').boons[0];
    expect(boon.type).toBe('run_start_max_hp_bonus');
    expect(boon.params.scope).toBe('lords');
    for (const u of rm.roster)
      expect(u.stats.HP, u.name).toBe(hp[u.name] + (u.isLord ? boon.params.value : 0));
    expect(rm.gold).toBe(gold - 25);
    expect(rm.blessingHistory.map((r) => r.effectType)).toEqual([
      'run_start_max_hp_bonus',
      'gold_delta',
    ]);
  });
});

describe('stats and economy', () => {
  it('run_start_max_hp_bonus: raises max and current HP by scope; 0 is a silent no-op', () => {
    for (const [scope, expected] of [
      ['all', ['Edric', 'Sera', 'Gaspar']],
      [undefined, ['Edric', 'Sera', 'Gaspar']],
      ['lords', ['Edric', 'Sera']],
      ['recruits', ['Gaspar']],
    ]) {
      const rm = freshRun();
      const before = Object.fromEntries(rm.roster.map((u) => [u.name, [u.stats.HP, u.currentHP]]));
      const record = applyOne(rm, 'run_start_max_hp_bonus', { value: 3, scope });
      expect(record.details, String(scope)).toEqual({ appliedValue: 3, scope: scope || 'all' });
      for (const u of rm.roster) {
        const grew = expected.includes(u.name);
        expect(u.stats.HP, `${scope} ${u.name}`).toBe(before[u.name][0] + (grew ? 3 : 0));
        expect(u.currentHP, `${scope} ${u.name}`).toBe(before[u.name][1] + (grew ? 3 : 0));
      }
    }
    const rm = freshRun();
    const stats = statsOf(rm);
    expect(apply(rm, 'run_start_max_hp_bonus', { value: 0 })).toEqual([]);
    expect(statsOf(rm)).toEqual(stats);
  });

  it('run_start_max_hp_bonus: a cut lowers current HP to the new max', () => {
    const rm = freshRun();
    const edric = unit(rm, 'Edric');
    const [max, cur] = [edric.stats.HP, edric.currentHP];
    expect(cur).toBe(max);
    applyOne(rm, 'run_start_max_hp_bonus', { value: -4, scope: 'lords' });
    expect(edric.stats.HP).toBe(max - 4);
    expect(edric.currentHP).toBe(max - 4);
  });

  it('gold_delta: pays the purse, negative included, 0 still records', () => {
    const rm = freshRun();
    const gold = rm.gold;
    expect(applyOne(rm, 'gold_delta', { value: 150 }).details).toEqual({ appliedValue: 150 });
    expect(rm.gold).toBe(gold + 150);
    applyOne(rm, 'gold_delta', { value: -50 });
    expect(rm.gold).toBe(gold + 100);
    applyOne(rm, 'gold_delta', { value: 0 });
    expect(rm.gold).toBe(gold + 100);
  });

  it('battle_gold_multiplier_delta: adds to the battle gold multiplier', () => {
    const rm = freshRun();
    const base = rm.getBattleGoldMultiplier();
    const record = applyOne(rm, 'battle_gold_multiplier_delta', { value: 0.5 });
    expect(record.details).toEqual({ appliedValue: 0.5, total: 0.5 });
    expect(rm.getBattleGoldMultiplier()).toBeCloseTo(base + 0.5);
    expect(applyOne(rm, 'battle_gold_multiplier_delta', { value: -0.25 }).details.total).toBe(0.25);
  });

  it('deploy_cap_delta: whole deploy slots, fractions truncated', () => {
    const rm = freshRun();
    const base = rm.getDeployBonus();
    expect(applyOne(rm, 'deploy_cap_delta', { value: 2.9 }).details).toEqual({
      appliedValue: 2,
      total: 2,
    });
    expect(rm.getDeployBonus()).toBe(base + 2);
    expect(applyOne(rm, 'deploy_cap_delta', { value: -1 }).details.total).toBe(1);
  });

  it('act_deploy_cap_delta: moves one act only; with no act it records and changes nothing', () => {
    const rm = freshRun();
    const base1 = rm.getDeployBonus('act1');
    const base2 = rm.getDeployBonus('act2');
    expect(applyOne(rm, 'act_deploy_cap_delta', { act: 'act1', value: -1 }).details).toEqual({
      act: 'act1',
      appliedValue: -1,
    });
    applyOne(rm, 'act_deploy_cap_delta', { act: 'act1', value: -1 });
    expect(mods(rm).deployCapDeltaByAct).toEqual({ act1: -2 });
    expect(rm.getDeployBonus('act1')).toBe(base1 - 2);
    expect(rm.getDeployBonus('act2')).toBe(base2);
    const none = applyOne(rm, 'act_deploy_cap_delta', { value: 1 });
    expect(none.details).toEqual({ act: null, appliedValue: 1 });
    expect(mods(rm).deployCapDeltaByAct).toEqual({ act1: -2 });
  });

  it('xp_multiplier_delta, shop_price_discount, forge_limit_delta and the other plain counters add up', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'xp_multiplier_delta', { value: 0.25 }).details).toEqual({
      appliedValue: 0.25,
      total: 0.25,
    });
    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.25);
    expect(applyOne(rm, 'shop_price_discount', { value: 0.1 }).details).toEqual({
      appliedValue: 0.1,
      total: 0.1,
    });
    expect(rm.getShopPriceDiscount()).toBeCloseTo(0.1);
    expect(applyOne(rm, 'forge_limit_delta', { value: 1.8 }).details).toEqual({
      appliedValue: 1,
      total: 1,
    });
    expect(applyOne(rm, 'forge_limit_delta', { value: 1 }).details.total).toBe(2);
    expect(applyOne(rm, 'recruit_level_bonus', { value: 2.9 }).details).toEqual({
      appliedValue: 2,
      total: 2,
    });
    expect(mods(rm).recruitLevelBonus).toBe(2);
    expect(applyOne(rm, 'shop_item_count_delta', { value: 2.5 }).details).toEqual({
      appliedValue: 2,
      total: 2,
    });
    expect(rm.getShopItemCountDelta()).toBe(2);
    expect(applyOne(rm, 'shop_item_count_delta', { value: -1 }).details.total).toBe(1);
    expect(applyOne(rm, 'weapon_art_hp_cost_delta', { value: -2.9 }).details).toEqual({
      appliedValue: -2,
      total: -2,
    });
    expect(mods(rm).weaponArtHpCostDelta).toBe(-2);
    expect(applyOne(rm, 'healing_effectiveness_delta', { value: 0.25 }).details).toEqual({
      appliedValue: 0.25,
      total: 1.25,
    });
  });

  it('forge_cost_discount adds, forge_cost_multiplier subtracts (its value is a cost multiplier delta)', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'forge_cost_discount', { value: 0.1 }).details).toEqual({
      appliedValue: 0.1,
      total: 0.1,
    });
    expect(rm.getForgeCostDiscount()).toBeCloseTo(0.1);
    const record = applyOne(rm, 'forge_cost_multiplier', { value: -0.2 });
    expect(record.details.appliedValue).toBe(0.2);
    expect(record.details.total).toBeCloseTo(0.3);
    expect(rm.getForgeCostDiscount()).toBeCloseTo(0.3);
    expect(applyOne(rm, 'forge_cost_multiplier', { value: 0.1 }).details.appliedValue).toBe(-0.1);
  });

  it('shop_first_forge_free: adds free forges per shop; a negative adds none', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'shop_first_forge_free', { value: 1 }).details).toEqual({
      appliedValue: 1,
      total: 1,
    });
    expect(applyOne(rm, 'shop_first_forge_free', { value: -3 }).details).toEqual({
      appliedValue: 0,
      total: 1,
    });
    expect(mods(rm).freeForgesPerShop).toBe(1);
  });

  it('skip_first_shop: on by default, off when disabled', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'skip_first_shop', {}).details).toEqual({ enabled: true });
    expect(mods(rm).skipFirstShop).toBe(true);
    expect(applyOne(rm, 'skip_first_shop', { enabled: false }).details).toEqual({ enabled: false });
    expect(mods(rm).skipFirstShop).toBe(false);
  });

  it('extra_shop_per_act: raises the count and reports the nodes it turned into shops', () => {
    const rm = freshRun();
    const record = applyOne(rm, 'extra_shop_per_act', { value: 1 });
    expect(record.details.appliedValue).toBe(1);
    expect(record.details.total).toBe(1);
    expect(mods(rm).extraShopsPerAct).toBe(1);
    expect(Array.isArray(record.details.converted)).toBe(true);
    for (const id of record.details.converted)
      expect(rm.nodeMap.nodes.find((n) => n.id === id).type, id).toBe('shop');
    const zero = applyOne(freshRun(), 'extra_shop_per_act', { value: 0 });
    expect(zero.details).toEqual({ appliedValue: 0, total: 0, converted: [] });
  });

  it('act_start_gold: files an act-start grant for the next act and pays nothing now', () => {
    const rm = freshRun();
    const gold = rm.gold;
    expect(applyOne(rm, 'act_start_gold', { value: 100 }).details).toEqual({
      recurringValue: 100,
      firstPayment: 'next_act',
    });
    expect(rm.gold).toBe(gold);
    expect(mods(rm).actStartGrants).toEqual([
      { blessingId: ID, kind: 'gold', value: 100, paidActs: ['act1'] },
    ]);
    const zero = applyOne(freshRun(), 'act_start_gold', { value: 0 });
    expect(zero.details).toEqual({ skipped: true, reason: 'invalid_act_start_gold' });
  });

  it('act_start_vision_delta: files a Vision grant for the next act; 0 is skipped', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'act_start_vision_delta', { value: 1 }).details).toEqual({
      recurringValue: 1,
      firstPayment: 'next_act',
    });
    expect(rm.visionChargesRemaining).toBe(1);
    expect(mods(rm).actStartGrants).toEqual([
      { blessingId: ID, kind: 'vision', value: 1, paidActs: ['act1'] },
    ]);
    const bad = applyOne(freshRun(), 'act_start_vision_delta', { value: 0 });
    expect(bad.details).toEqual({ skipped: true, reason: 'invalid_act_start_vision_delta_params' });
  });

  it('act_start_convoy_item: files the grant, pays this act into the convoy now', () => {
    const rm = freshRun();
    const convoy = rm.convoy.consumables.length;
    const records = apply(rm, 'act_start_convoy_item', { itemName: 'Vulnerary', count: 2 });
    expect(records[0].details).toEqual({ itemName: 'Vulnerary', count: 2 });
    expect(records[0].stage).toBe('run_start');
    expect(rm.convoy.consumables.length).toBe(convoy + 2);
    expect(rm.convoy.consumables.slice(-2).map((i) => i.name)).toEqual(['Vulnerary', 'Vulnerary']);
    expect(mods(rm).actStartGrants).toEqual([
      { blessingId: ID, kind: 'item', itemName: 'Vulnerary', count: 2, paidActs: ['act1'] },
    ]);
  });

  it('act_start_convoy_item: a blessing taken mid-run pays under the mid_run stage', () => {
    const rm = freshRun();
    rm.activeBlessings = [{ id: ID, rolledCost: null, midRun: true }];
    const records = apply(rm, 'act_start_convoy_item', { itemName: 'Vulnerary', count: 1 });
    expect(records[0].stage).toBe('run_start');
    const payment = records.find((r) => r.eventType === 'effect_applied' && r !== records[0]);
    expect(payment?.stage).toBe('mid_run');
    // The same blessing held from the start pays under run_start.
    const held = freshRun();
    held.activeBlessings = [ID];
    const heldRecords = apply(held, 'act_start_convoy_item', { itemName: 'Vulnerary', count: 1 });
    const heldPayment = heldRecords.find((r) => r !== heldRecords[0]);
    expect(heldPayment?.stage).toBe('run_start');
  });

  it('act_start_convoy_item: an unknown, non-consumable or zero-count item is skipped, nothing filed', () => {
    for (const [params, reason] of [
      [{ itemName: 'Nope', count: 1 }, 'missing_consumable_template'],
      [{ itemName: 'Iron Sword', count: 1 }, 'missing_consumable_template'],
      [{ itemName: '', count: 1 }, 'missing_consumable_template'],
      [{ itemName: 'Vulnerary', count: 0 }, 'invalid_act_start_item_count'],
    ]) {
      const rm = freshRun();
      const record = applyOne(rm, 'act_start_convoy_item', params);
      expect(record.details, JSON.stringify(params)).toEqual({
        skipped: true,
        reason,
        itemName: params.itemName,
      });
      expect(mods(rm).actStartGrants).toEqual([]);
    }
  });

  it('vision_delta: moves the Vision charges, never below 0', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'vision_delta', { value: 2 }).details).toEqual({ before: 1, after: 3 });
    expect(rm.visionChargesRemaining).toBe(3);
    expect(applyOne(rm, 'vision_delta', { value: -9 }).details).toEqual({ before: 3, after: 0 });
    expect(rm.visionChargesRemaining).toBe(0);
    const odd = freshRun();
    odd.visionChargesRemaining = undefined;
    expect(applyOne(odd, 'vision_delta', { value: 2 }).details).toEqual({ before: 0, after: 2 });
  });

  it('eclipse_shadow_delta: darkens the Eclipse, capped; skipped with none or at 0', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'eclipse_shadow_delta', { value: 15 }).details).toEqual({
      before: 0,
      after: 15,
    });
    expect(rm.eclipse.shadow).toBe(15);
    expect(rm.eclipse.actStartShadow).toBe(15);
    const cap = Math.max(0, Math.trunc(Number(rm.getEclipseConfig()?.cap) || 100));
    expect(applyOne(rm, 'eclipse_shadow_delta', { value: 100000 }).details.after).toBe(cap);
    const lighter = freshRun();
    lighter.eclipse = { ...lighter.eclipse, shadow: 30, actStartShadow: 10 };
    const record = applyOne(lighter, 'eclipse_shadow_delta', { value: -50 });
    expect(record.details).toEqual({ before: 30, after: 0 });
    expect(lighter.eclipse.shadow).toBe(0);
    expect(lighter.eclipse.actStartShadow).toBe(0);
    const off = freshRun();
    off.eclipse = null;
    expect(applyOne(off, 'eclipse_shadow_delta', { value: 7 }).details).toEqual({
      skipped: true,
      reason: 'no_eclipse',
    });
    expect(applyOne(freshRun(), 'eclipse_shadow_delta', { value: 0 }).details).toEqual({
      skipped: true,
      reason: 'zero_eclipse_shadow_delta',
    });
  });

  it('church_revive_disabled: closes church revives', () => {
    const rm = freshRun();
    expect(rm.isChurchReviveDisabled()).toBe(false);
    expect(applyOne(rm, 'church_revive_disabled', {}).details).toEqual({});
    expect(rm.isChurchReviveDisabled()).toBe(true);
  });

  it('burden: files the named burden and says whether it landed', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'burden', { id: 'hunted', battles: 3 }).details).toEqual({
      burden: 'hunted',
      applied: true,
    });
    expect(rm.burdens.find((b) => b.id === 'hunted').battles).toBe(3);
    const unknown = applyOne(rm, 'burden', { id: 'zzz', battles: 1 });
    expect(unknown.details.burden).toBe('zzz');
    expect(unknown.details.applied).toBe(false);
    expect(typeof unknown.details.reason).toBe('string');
  });

  it('burden: Lingering Injury lands on the commander with the stat named', () => {
    const rm = freshRun();
    const record = applyOne(rm, 'burden', {
      id: 'wounded',
      target: 'commander',
      stat: 'STR',
      battles: 5,
    });
    expect(record.details).toEqual({ burden: 'wounded', applied: true });
    const wounded = rm.burdens.find((b) => b.id === 'wounded');
    expect(wounded.unitName).toBe('Edric');
    expect(wounded.stat).toBe('STR');
    expect(wounded.unitUid).toBe(unit(rm, 'Edric').unitUid);
  });

  it('burden: Lingering Injury picks its stat from the blessing seed when "random", the same each time', () => {
    const stats = [0, 1].map(() => {
      const rm = freshRun();
      applyOne(rm, 'burden', { id: 'wounded', target: 'commander', stat: 'random', battles: 5 });
      return rm.burdens.find((b) => b.id === 'wounded').stat;
    });
    expect(stats[0]).toBe(stats[1]);
    expect(XP_STAT_NAMES).toContain(stats[0]);
  });

  it('burden: Lingering Injury with no commander is skipped', () => {
    const rm = freshRun();
    rm.roster = rm.roster.filter((u) => !u.isLord);
    expect(
      applyOne(rm, 'burden', { id: 'wounded', target: 'commander', stat: 'STR' }).details,
    ).toEqual({ skipped: true, reason: 'no_commander' });
    expect((rm.burdens || []).some((b) => b.id === 'wounded')).toBe(false);
  });
});

describe('stat deltas', () => {
  it('lord_stat_bonus: lords only, with their names recorded; HP raises current HP', () => {
    const rm = freshRun();
    const before = statsOf(rm);
    const record = applyOne(rm, 'lord_stat_bonus', { stat: 'STR', value: 2 });
    expect(record.details).toEqual({
      stat: 'STR',
      appliedValue: 2,
      appliedUnits: ['Edric', 'Sera'],
    });
    expect(unit(rm, 'Edric').stats.STR).toBe(before.Edric.STR + 2);
    expect(unit(rm, 'Sera').stats.STR).toBe(before.Sera.STR + 2);
    expect(unit(rm, 'Gaspar').stats.STR).toBe(before.Gaspar.STR);
    const hpRun = freshRun();
    const cur = unit(hpRun, 'Edric').currentHP;
    applyOne(hpRun, 'lord_stat_bonus', { stat: 'HP', value: 3 });
    expect(unit(hpRun, 'Edric').currentHP).toBe(cur + 3);
  });

  it('lord_stat_bonus and all_units_stat_delta: no stat or a 0 value is skipped', () => {
    for (const [type, reason] of [
      ['lord_stat_bonus', 'invalid_lord_stat_bonus_params'],
      ['all_units_stat_delta', 'invalid_all_units_stat_delta_params'],
    ]) {
      const rm = freshRun();
      const before = statsOf(rm);
      expect(applyOne(rm, type, { stat: '', value: 2 }).details).toEqual({ skipped: true, reason });
      expect(applyOne(rm, type, { stat: 'STR', value: 0 }).details).toEqual({
        skipped: true,
        reason,
      });
      expect(statsOf(rm)).toEqual(before);
    }
  });

  it('all_units_stat_delta: every unit, recorded by name', () => {
    const rm = freshRun();
    const before = statsOf(rm);
    const record = applyOne(rm, 'all_units_stat_delta', { stat: 'DEF', value: -1 });
    expect(record.details).toEqual({
      stat: 'DEF',
      appliedValue: -1,
      appliedUnits: ['Edric', 'Sera', 'Gaspar'],
    });
    for (const u of rm.roster) expect(u.stats.DEF).toBe(before[u.name].DEF - 1);
  });

  it('act_stat_delta_all_units: the current act applies now and is tracked; a later act waits', () => {
    const rm = freshRun();
    const before = statsOf(rm);
    const record = applyOne(rm, 'act_stat_delta_all_units', { act: 'act1', stat: 'STR', value: 2 });
    expect(record.details).toEqual({
      act: 'act1',
      stat: 'STR',
      appliedValue: 2,
      appliedNow: true,
    });
    for (const u of rm.roster) expect(u.stats.STR).toBe(before[u.name].STR + 2);
    expect(mods(rm).actStatDeltaAllUnits).toEqual([
      {
        blessingId: ID,
        act: 'act1',
        stat: 'STR',
        value: 2,
        applied: true,
        reverted: false,
        unitUids: rm.roster.map((u) => u.unitUid),
      },
    ]);
    expect(rm.roster.every((u) => typeof u.unitUid === 'string' && u.unitUid)).toBe(true);

    const later = freshRun();
    const laterBefore = statsOf(later);
    const waiting = applyOne(later, 'act_stat_delta_all_units', {
      act: 'act2',
      stat: 'STR',
      value: 2,
    });
    expect(waiting.details.appliedNow).toBe(false);
    expect(statsOf(later)).toEqual(laterBefore);
    expect(mods(later).actStatDeltaAllUnits[0]).toMatchObject({
      act: 'act2',
      applied: false,
      unitUids: [],
    });
  });

  it('act_stat_delta_all_units: no act, no stat or a 0 value is skipped', () => {
    for (const params of [
      { stat: 'STR', value: 2 },
      { act: 'act1', value: 2 },
      { act: 'act1', stat: 'STR', value: 0 },
    ]) {
      const rm = freshRun();
      expect(applyOne(rm, 'act_stat_delta_all_units', params).details).toEqual({
        skipped: true,
        reason: 'invalid_act_stat_delta_all_units_params',
      });
      expect(mods(rm).actStatDeltaAllUnits).toEqual([]);
    }
  });

  it('act_hit_bonus: whole Hit for one act, summed; a player unit reads it', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'act_hit_bonus', { act: 'act2', value: 3.7 }).details).toEqual({
      act: 'act2',
      appliedValue: 3,
      total: 3,
    });
    expect(applyOne(rm, 'act_hit_bonus', { act: 'act2', value: 2 }).details.total).toBe(5);
    expect(mods(rm).actHitBonusByAct).toEqual({ act2: 5 });
    expect(rm.getActHitBonusForUnit(unit(rm, 'Edric'), 'act2')).toBe(5);
    expect(rm.getActHitBonusForUnit(unit(rm, 'Edric'), 'act1')).toBe(0);
  });

  it('act_hit_bonus: no act or a bonus that truncates to 0 is skipped', () => {
    for (const params of [{ value: 3 }, { act: 'act1', value: 0.5 }, { act: '', value: 3 }]) {
      const rm = freshRun();
      expect(applyOne(rm, 'act_hit_bonus', params).details).toEqual({
        skipped: true,
        reason: 'invalid_act_hit_bonus_params',
      });
      expect(mods(rm).actHitBonusByAct).toEqual({});
    }
  });

  it('act_hit_bonus and all_act_hit_bonus: a damaged modifier table is rebuilt', () => {
    const rm = freshRun();
    mods(rm).actHitBonusByAct = 'broken';
    applyOne(rm, 'act_hit_bonus', { act: 'act2', value: 3 });
    expect(mods(rm).actHitBonusByAct).toEqual({ act2: 3 });
    const all = freshRun();
    mods(all).actHitBonusByAct = null;
    applyOne(all, 'all_act_hit_bonus', { value: 1 });
    expect(Object.keys(mods(all).actHitBonusByAct)).toEqual(ACT_SEQUENCE);
  });

  it('all_act_hit_bonus: every act in the sequence, summed on top of the per-act table', () => {
    const rm = freshRun();
    applyOne(rm, 'act_hit_bonus', { act: 'act2', value: 4 });
    const record = applyOne(rm, 'all_act_hit_bonus', { value: 2.9 });
    expect(record.details.appliedValue).toBe(2);
    expect(record.details.acts).toEqual(ACT_SEQUENCE);
    const expected = Object.fromEntries(ACT_SEQUENCE.map((act) => [act, act === 'act2' ? 6 : 2]));
    expect(record.details.totals).toEqual(expected);
    expect(mods(rm).actHitBonusByAct).toEqual(expected);
    expect(applyOne(freshRun(), 'all_act_hit_bonus', { value: 0.4 }).details).toEqual({
      skipped: true,
      reason: 'zero_all_act_hit_bonus',
    });
  });

  it('all_growths_delta: every growth of every unit, scaled by the rung; the modifier keeps the raw delta', () => {
    const rm = freshRun();
    const before = growthsOf(rm);
    const record = applyOne(rm, 'all_growths_delta', { value: 2.9 });
    expect(record.details).toEqual({
      appliedValue: 2,
      total: 2,
      appliedUnits: ['Edric', 'Sera', 'Gaspar'],
    });
    for (const u of rm.roster)
      for (const stat of XP_STAT_NAMES)
        expect(u.growths[stat], `${u.name} ${stat}`).toBe(before[u.name][stat] + 2);
    expect(mods(rm).allGrowthsDelta).toBe(2);
    expect(mods(rm).allGrowthsDeltas).toEqual([2]);

    // Nightfall scales a growth gift by 0.8: +10 is +8 on the units, 10 on the record.
    const hard = freshRun('hard');
    const hardBefore = growthsOf(hard);
    applyOne(hard, 'all_growths_delta', { value: 10 });
    for (const u of hard.roster) expect(u.growths.STR).toBe(hardBefore[u.name].STR + 8);
    expect(mods(hard).allGrowthsDelta).toBe(10);

    const zero = freshRun();
    expect(applyOne(zero, 'all_growths_delta', { value: 0.5 }).details).toEqual({
      skipped: true,
      reason: 'zero_all_growths_delta',
    });
  });

  it('targeted_growths_delta: only the named, de-duplicated stats, by scope', () => {
    const rm = freshRun();
    const before = growthsOf(rm);
    const record = applyOne(rm, 'targeted_growths_delta', {
      scope: ' LORDS ',
      stats: ['STR', 'STR', 'junk', 5, 'SPD'],
      value: 5,
    });
    expect(record.details).toEqual({
      stats: ['STR', 'SPD'],
      scope: 'lords',
      appliedValue: 5,
      appliedUnits: ['Edric', 'Sera'],
    });
    for (const name of ['Edric', 'Sera']) {
      expect(unit(rm, name).growths.STR).toBe(before[name].STR + 5);
      expect(unit(rm, name).growths.SPD).toBe(before[name].SPD + 5);
      expect(unit(rm, name).growths.DEF).toBe(before[name].DEF);
    }
    expect(growthsOf(rm).Gaspar).toEqual(before.Gaspar);
    expect(mods(rm).targetedGrowthsDeltas).toEqual([
      { stats: ['STR', 'SPD'], value: 5, scope: 'lords' },
    ]);
  });

  it('targeted_growths_delta: defaults to all units; no usable stat or a 0 delta is skipped', () => {
    const rm = freshRun();
    expect(
      applyOne(rm, 'targeted_growths_delta', { stats: ['HP'], value: 3 }).details.appliedUnits,
    ).toEqual(['Edric', 'Sera', 'Gaspar']);
    for (const params of [
      { stats: [], value: 3 },
      { stats: ['junk'], value: 3 },
      { value: 3 },
      { stats: ['STR'], value: 0 },
    ]) {
      const bad = freshRun();
      expect(applyOne(bad, 'targeted_growths_delta', params).details).toEqual({
        skipped: true,
        reason: 'invalid_targeted_growths_delta_params',
      });
      expect(mods(bad).targetedGrowthsDeltas).toEqual([]);
    }
  });

  it('disable_personal_skills_until_act: strips the lords personal skills and remembers them', () => {
    const rm = freshRun();
    const edric = unit(rm, 'Edric');
    const personal = (data.lords.find((l) => l.name === 'Edric').personalSkill || '').toString();
    expect(personal).not.toBe('');
    const record = applyOne(rm, 'disable_personal_skills_until_act', { act: 'act2' });
    expect(mods(rm).disablePersonalSkillsUntilAct).toBe('act2');
    expect(record.details.targetAct).toBe('act2');
    expect(record.details.appliedNow).toBe(true);
    expect(Object.keys(record.details.removedByUnit)).toContain('Edric');
    for (const skillId of record.details.removedByUnit.Edric) {
      expect(edric.skills).not.toContain(skillId);
      expect(mods(rm).blockedPersonalSkillsByUnit.Edric).toContain(skillId);
    }
  });

  it('disable_personal_skills_until_act: the later act wins whichever order they come in', () => {
    const a = freshRun();
    applyOne(a, 'disable_personal_skills_until_act', { act: 'act2' });
    applyOne(a, 'disable_personal_skills_until_act', { act: 'act3' });
    expect(mods(a).disablePersonalSkillsUntilAct).toBe('act3');
    const b = freshRun();
    applyOne(b, 'disable_personal_skills_until_act', { act: 'act3' });
    const second = applyOne(b, 'disable_personal_skills_until_act', { act: 'act2' });
    expect(mods(b).disablePersonalSkillsUntilAct).toBe('act3');
    expect(second.details.targetAct).toBe('act3');
  });

  it('disable_personal_skills_until_act: an unknown or missing act is skipped', () => {
    for (const params of [{ act: 'nope' }, { act: '' }, {}]) {
      const rm = freshRun();
      const skills = unit(rm, 'Edric').skills.slice();
      expect(applyOne(rm, 'disable_personal_skills_until_act', params).details).toEqual({
        skipped: true,
        reason: 'invalid_disable_personal_skills_until_act_params',
      });
      expect(unit(rm, 'Edric').skills).toEqual(skills);
      expect(mods(rm).disablePersonalSkillsUntilAct).toBe(null);
    }
  });

  it('first_strike_hit_bonus: sums whole Hit; 0 is skipped', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'first_strike_hit_bonus', { value: 10 }).details).toEqual({
      appliedValue: 10,
      total: 10,
    });
    expect(applyOne(rm, 'first_strike_hit_bonus', { value: 5.5 }).details.total).toBe(15);
    expect(applyOne(rm, 'first_strike_hit_bonus', { value: 0 }).details).toEqual({
      skipped: true,
      reason: 'zero_first_strike_hit_bonus',
    });
    expect(mods(rm).firstStrikeHitBonus).toBe(15);
  });

  it('stationary_combat_bonus: sums DEF and Avoid; an all-zero set is skipped', () => {
    const rm = freshRun();
    expect(
      applyOne(rm, 'stationary_combat_bonus', { defBonus: 2, avoidBonus: 10 }).details,
    ).toEqual({ defBonus: 2, avoidBonus: 10, total: { defBonus: 2, avoidBonus: 10 } });
    expect(applyOne(rm, 'stationary_combat_bonus', { defBonus: 1 }).details.total).toEqual({
      defBonus: 3,
      avoidBonus: 10,
    });
    expect(mods(rm).stationaryCombatBonus).toEqual({ defBonus: 3, avoidBonus: 10 });
    expect(applyOne(rm, 'stationary_combat_bonus', { defBonus: 'x' }).details).toEqual({
      skipped: true,
      reason: 'invalid_stationary_combat_bonus_params',
    });
  });

  it('adjacent_ally_def_bonus (Phalanx Rite): files each held entry; malformed params are skipped', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'adjacent_ally_def_bonus', { perAlly: 2, max: 3 }).details).toEqual({
      perAlly: 2,
      max: 3,
      held: 1,
    });
    expect(applyOne(rm, 'adjacent_ally_def_bonus', { perAlly: 1, max: 2 }).details.held).toBe(2);
    expect(mods(rm).adjacentAllyDefBonuses).toEqual([
      { perAlly: 2, max: 3 },
      { perAlly: 1, max: 2 },
    ]);
    expect(applyOne(rm, 'adjacent_ally_def_bonus', {}).details).toEqual({
      skipped: true,
      reason: 'invalid_adjacent_ally_def_bonus_params',
    });
    expect(mods(rm).adjacentAllyDefBonuses).toHaveLength(2);
  });

  it("isolated_combat_bonus (Duelist's Creed): files each held entry; malformed params are skipped", () => {
    const rm = freshRun();
    expect(
      applyOne(rm, 'isolated_combat_bonus', { radius: 2, avoidBonus: 15, critBonus: 10 }).details,
    ).toEqual({ radius: 2, avoidBonus: 15, critBonus: 10, held: 1 });
    expect(applyOne(rm, 'isolated_combat_bonus', { radius: 3, critBonus: 5 }).details).toEqual({
      radius: 3,
      avoidBonus: 0,
      critBonus: 5,
      held: 2,
    });
    expect(mods(rm).isolatedCombatBonuses).toHaveLength(2);
    // No radius, or no bonus to give, does nothing and says so.
    for (const params of [{ radius: 0, avoidBonus: 5 }, { radius: 2 }]) {
      expect(applyOne(rm, 'isolated_combat_bonus', params).details).toEqual({
        skipped: true,
        reason: 'invalid_isolated_combat_bonus_params',
      });
    }
    expect(mods(rm).isolatedCombatBonuses).toHaveLength(2);
  });

  it('player_weapon_art_boon: sums the HP cost and the map uses; an empty boon is skipped', () => {
    const rm = freshRun();
    expect(
      applyOne(rm, 'player_weapon_art_boon', { hpCostDelta: -1, mapUsesBonus: 1 }).details,
    ).toEqual({ hpCostDelta: -1, mapUsesBonus: 1, totalHpCostDelta: -1, totalMapUsesBonus: 1 });
    expect(
      applyOne(rm, 'player_weapon_art_boon', { hpCostDelta: -1, mapUsesBonus: 1 }).details,
    ).toMatchObject({ totalHpCostDelta: -2, totalMapUsesBonus: 2 });
    expect(mods(rm).playerArtHpCostDelta).toBe(-2);
    expect(mods(rm).playerArtMapUsesBonus).toBe(2);
    expect(
      applyOne(rm, 'player_weapon_art_boon', { hpCostDelta: 0, mapUsesBonus: 0 }).details,
    ).toEqual({ skipped: true, reason: 'invalid_player_weapon_art_boon_params' });
  });

  it('enemy_level_delta: files a world price, optionally for one act; 0 is skipped', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'enemy_level_delta', { value: 2, act: ' act2 ' }).details).toEqual({
      appliedValue: 2,
      act: 'act2',
    });
    expect(applyOne(rm, 'enemy_level_delta', { value: 1 }).details).toEqual({
      appliedValue: 1,
      act: null,
    });
    expect(mods(rm).enemyLevelDeltas).toEqual([
      { value: 2, act: 'act2' },
      { value: 1, act: null },
    ]);
    expect(applyOne(rm, 'enemy_level_delta', { value: 0.4, act: 'act1' }).details).toEqual({
      skipped: true,
      reason: 'zero_enemy_level_delta',
    });
    expect(mods(rm).enemyLevelDeltas).toHaveLength(2);
  });

  it('lord_stat_arc: dips the lords now when the dip act is this one, and files the arc', () => {
    const rm = freshRun();
    const before = statsOf(rm);
    const params = {
      stats: ['STR', 'DEF'],
      dipAct: 'act1',
      dip: -1,
      riseAct: 'act2',
      rise: 1,
    };
    const record = applyOne(rm, 'lord_stat_arc', params);
    expect(record.details).toMatchObject({
      dipAct: 'act1',
      dip: -1,
      riseAct: 'act2',
      rise: 1,
      dipTaken: true,
      riseApplied: false,
    });
    expect(record.details.appliedUnits).toEqual(
      ['Edric', 'Sera'].map((name) => unit(rm, name).unitUid),
    );
    for (const name of ['Edric', 'Sera']) {
      expect(unit(rm, name).stats.STR).toBe(before[name].STR - 1);
      expect(unit(rm, name).stats.DEF).toBe(before[name].DEF - 1);
    }
    expect(unit(rm, 'Gaspar').stats.STR).toBe(before.Gaspar.STR);
    expect(mods(rm).lordStatArcs).toHaveLength(1);
    expect(mods(rm).lordStatArcs[0].blessingId).toBe(ID);
  });

  it('lord_stat_arc: malformed params are skipped, nothing filed', () => {
    const rm = freshRun();
    const before = statsOf(rm);
    expect(
      applyOne(rm, 'lord_stat_arc', {
        stats: ['STR'],
        dipAct: 'act_1',
        dip: -1,
        riseAct: 'act2',
        rise: 1,
      }).details,
    ).toEqual({ skipped: true, reason: 'invalid_lord_stat_arc_params' });
    expect(mods(rm).lordStatArcs).toEqual([]);
    expect(statsOf(rm)).toEqual(before);
  });

  it("battle_gold_gamble (Gambler's Toss): holds the parsed toss; a bad toss is skipped", () => {
    const rm = freshRun();
    const record = applyOne(rm, 'battle_gold_gamble', { chance: 0.5, win: 2, lose: 0.5 });
    expect(record.details).toEqual({ chance: 0.5, win: 2, lose: 0.5 });
    expect(rm.getBattleGoldGamble()).toEqual({ chance: 0.5, win: 2, lose: 0.5 });
    const bad = freshRun();
    expect(applyOne(bad, 'battle_gold_gamble', { chance: 2, win: 2, lose: 0.5 }).details).toEqual({
      skipped: true,
      reason: 'invalid_battle_gold_gamble_params',
    });
    expect(bad.getBattleGoldGamble()).toBe(null);
  });
});

describe('gifts of items, skills and forging', () => {
  it('starting_consumable_all: one of the item to every unit with room', () => {
    const rm = freshRun();
    const before = Object.fromEntries(rm.roster.map((u) => [u.name, u.consumables.length]));
    expect(applyOne(rm, 'starting_consumable_all', { name: 'Vulnerary' }).details).toEqual({
      itemName: 'Vulnerary',
      grantedCount: 3,
      rosterSize: 3,
    });
    for (const u of rm.roster) {
      expect(u.consumables.length).toBe(before[u.name] + 1);
      expect(u.consumables.at(-1).name).toBe('Vulnerary');
    }
    // Everyone fills to 3; a full bag takes nothing.
    applyOne(rm, 'starting_consumable_all', { name: 'Vulnerary' });
    expect(applyOne(rm, 'starting_consumable_all', { name: 'Vulnerary' }).details).toMatchObject({
      grantedCount: 1,
    });
    expect(rm.roster.map((u) => u.consumables.length)).toEqual([3, 3, 3]);
  });

  it('starting_consumable_all: an unknown item is skipped', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'starting_consumable_all', { name: 'Nope' }).details).toEqual({
      skipped: true,
      reason: 'consumable_not_found',
      requestedName: 'Nope',
    });
    expect(applyOne(rm, 'starting_consumable_all', {}).details.requestedName).toBe('');
  });

  it('extra_vulnerary and extra_consumable: count items to each lord, the overflow to the convoy', () => {
    for (const type of ['extra_vulnerary', 'extra_consumable']) {
      const rm = freshRun();
      const lordsBefore = rm.roster.filter((u) => u.isLord).map((u) => u.consumables.length);
      expect(applyOne(rm, type, { count: 1 }).details).toEqual({
        requestedCount: 1,
        lordCount: 2,
        grantedToUnits: 2,
        grantedToConvoy: 0,
        overflow: 0,
      });
      expect(rm.roster.filter((u) => u.isLord).map((u) => u.consumables.length)).toEqual(
        lordsBefore.map((n) => n + 1),
      );
      expect(unit(rm, 'Gaspar').consumables).toHaveLength(0);
      // A second call finds two lords at 2: one fits each, the third goes to the convoy.
      const convoy = rm.convoy.consumables.length;
      expect(applyOne(rm, type, { count: 3 }).details).toEqual({
        requestedCount: 3,
        lordCount: 2,
        grantedToUnits: 2,
        grantedToConvoy: 4,
        overflow: 0,
      });
      expect(rm.convoy.consumables.length).toBe(convoy + 4);
    }
  });

  it('extra_vulnerary: reads the count from value when no count is given; bad counts are skipped', () => {
    const rm = freshRun();
    expect(applyOne(rm, 'extra_vulnerary', { value: 1 }).details.requestedCount).toBe(1);
    expect(applyOne(rm, 'extra_vulnerary', {}).details).toEqual({
      skipped: true,
      reason: 'invalid_extra_consumable_params',
    });
    expect(applyOne(rm, 'extra_consumable', { count: 0, itemName: 'Elixir' }).details.reason).toBe(
      'invalid_extra_consumable_params',
    );
  });

  it('extra_consumable: a named item, and an unknown or non-consumable one is skipped', () => {
    const rm = freshRun();
    expect(
      applyOne(rm, 'extra_consumable', { itemName: 'Elixir', count: 1 }).details,
    ).toMatchObject({ grantedToUnits: 2 });
    expect(unit(rm, 'Edric').consumables.at(-1).name).toBe('Elixir');
    for (const itemName of ['Nope', 'Iron Sword']) {
      expect(applyOne(rm, 'extra_consumable', { itemName, count: 1 }).details).toEqual({
        skipped: true,
        reason: 'missing_consumable_template',
        itemName,
      });
    }
  });

  it('extra_consumable: with the convoy full the surplus is counted as overflow', () => {
    const rm = freshRun();
    const room = rm.getConvoyCapacities().consumables - rm.convoy.consumables.length;
    // 2 lords x 12 attempts; each lord's bag takes 2 (they hold 1), the rest goes to the convoy.
    const details = applyOne(rm, 'extra_consumable', { count: 12 }).details;
    expect(details.grantedToUnits).toBe(4);
    expect(details.grantedToConvoy).toBe(room);
    expect(details.overflow).toBe(24 - 4 - room);
  });

  it('starting_weapon_tier: a weapon of the tier for the first units who can wield one, equipped', () => {
    const rm = freshRun();
    const bagBefore = Object.fromEntries(rm.roster.map((u) => [u.name, u.inventory.length]));
    const record = applyOne(rm, 'starting_weapon_tier', { tier: 'Silver', count: 2 });
    expect(record.details.requestedTier).toBe('Silver');
    expect(record.details.requestedCount).toBe(2);
    expect(record.details.grantedCount).toBe(2);
    expect(record.details.grantedWeapons).toHaveLength(2);
    // At most one per unit, in roster order.
    const rosterOrder = names(rm.roster);
    const grantedUnits = record.details.grantedWeapons.map((g) => g.unit);
    expect(new Set(grantedUnits).size).toBe(2);
    expect(grantedUnits).toEqual(
      [...grantedUnits].sort((a, b) => rosterOrder.indexOf(a) - rosterOrder.indexOf(b)),
    );
    for (const granted of record.details.grantedWeapons) {
      const u = unit(rm, granted.unit);
      expect(u.inventory.length).toBe(bagBefore[u.name] + 1);
      // Equipped weapons lead the bag, so the new one is looked up by name.
      const added = u.inventory.find((w) => w.name === granted.weapon);
      expect(added.tier).toBe('Silver');
      expect(u.weapon).toBe(added);
    }
  });

  it('starting_weapon_tier: no tier or a 0 count is skipped; a tier nobody can wield grants none', () => {
    for (const params of [{ count: 1 }, { tier: 'Silver', count: 0 }, { tier: '' }]) {
      const rm = freshRun();
      expect(applyOne(rm, 'starting_weapon_tier', params).details).toEqual({
        skipped: true,
        reason: 'invalid_starting_weapon_tier_params',
      });
    }
    const rm = freshRun();
    const record = applyOne(rm, 'starting_weapon_tier', { tier: 'NoSuchTier', count: 1 });
    expect(record.details).toEqual({
      requestedTier: 'NoSuchTier',
      requestedCount: 1,
      grantedCount: 0,
      grantedWeapons: [],
    });
  });

  it('starting_random_skill: a pool skill per unit in scope, the same picks on the same seed', () => {
    const run = () => {
      const rm = freshRun();
      const before = Object.fromEntries(rm.roster.map((u) => [u.name, u.skills.slice()]));
      const record = applyOne(rm, 'starting_random_skill', { count: 1, scope: 'lords' });
      return { rm, before, record };
    };
    const { rm, before, record } = run();
    expect(record.details.scope).toBe('lords');
    expect(record.details.requestedCount).toBe(1);
    expect(Object.keys(record.details.grantedByUnit)).toEqual(['Edric', 'Sera']);
    for (const name of ['Edric', 'Sera']) {
      const [picked] = record.details.grantedByUnit[name];
      expect(record.details.grantedByUnit[name]).toHaveLength(1);
      expect(before[name]).not.toContain(picked);
      expect(unit(rm, name).skills).toEqual([...before[name], picked]);
    }
    expect(unit(rm, 'Gaspar').skills).toEqual(before.Gaspar);
    expect(run().record.details).toEqual(record.details);
  });

  it('starting_random_skill: recruits scope, and a 0 count is skipped', () => {
    const rm = freshRun();
    const record = applyOne(rm, 'starting_random_skill', { count: 1, scope: 'recruits' });
    expect(Object.keys(record.details.grantedByUnit)).toEqual(['Gaspar']);
    expect(applyOne(rm, 'starting_random_skill', { count: 0 }).details).toEqual({
      skipped: true,
      reason: 'invalid_starting_random_skill_count',
    });
  });

  it('starting_whetstones: forges the lords weapons once per roll; skipped with 0 or no catalog', () => {
    const rm = freshRun();
    const record = applyOne(rm, 'starting_whetstones', { count: 3 });
    expect(record.details.requestedCount).toBe(3);
    expect(record.details.appliedCount).toBe(3);
    expect(record.details.applied).toHaveLength(3);
    for (const entry of record.details.applied) expect(['Edric', 'Sera']).toContain(entry.unit);
    expect(forgeLevels(rm)).toBe(3);
    expect(forgeLevels(rm, false)).toBe(3);
    // Deterministic on the seed.
    const again = freshRun();
    expect(applyOne(again, 'starting_whetstones', { count: 3 }).details).toEqual(record.details);

    expect(applyOne(freshRun(), 'starting_whetstones', { count: 0 }).details).toEqual({
      skipped: true,
      reason: 'invalid_starting_whetstones_count',
    });
    const bare = freshRun();
    bare.gameData = { ...bare.gameData, whetstones: [] };
    expect(applyOne(bare, 'starting_whetstones', { count: 2 }).details).toEqual({
      skipped: true,
      reason: 'missing_whetstone_catalog',
    });
  });

  it('starting_scroll: scrolls from the roster pool into the scroll bag, deterministically', () => {
    const rm = freshRun();
    const pool = rm.startingArtScrollPool('act2').map((s) => s.name);
    expect(pool.length).toBeGreaterThan(0);
    const record = applyOne(rm, 'starting_scroll', { count: 2, maxUnlockAct: 'act2' });
    expect(record.details.requestedCount).toBe(2);
    expect(record.details.grantedCount).toBe(2);
    expect(rm.scrolls.map((s) => s.name)).toEqual(record.details.granted);
    for (const name of record.details.granted) expect(pool).toContain(name);
    expect(
      applyOne(freshRun(), 'starting_scroll', { count: 2, maxUnlockAct: 'act2' }).details,
    ).toEqual(record.details);
  });

  it('starting_scroll: distinct never repeats an art while the pool has another', () => {
    const rm = freshRun();
    const pool = rm.startingArtScrollPool('act2');
    const count = Math.min(3, pool.length);
    expect(count).toBeGreaterThanOrEqual(2);
    const record = applyOne(rm, 'starting_scroll', { count, maxUnlockAct: 'act2', distinct: true });
    expect(new Set(record.details.granted).size).toBe(count);
  });

  it('starting_scroll: a 0 count, no scroll catalog or no valid scroll is skipped', () => {
    expect(applyOne(freshRun(), 'starting_scroll', { count: 0 }).details).toEqual({
      skipped: true,
      reason: 'invalid_starting_scroll_count',
    });
    const bare = freshRun();
    bare.gameData = {
      ...bare.gameData,
      weapons: bare.gameData.weapons.filter((w) => w.type !== 'Scroll'),
    };
    expect(applyOne(bare, 'starting_scroll', { count: 1 }).details).toEqual({
      skipped: true,
      reason: 'missing_scroll_catalog',
    });
    const none = freshRun();
    none.startingArtScrollPool = () => [];
    expect(applyOne(none, 'starting_scroll', { count: 1 }).details).toEqual({
      skipped: true,
      reason: 'no_valid_scroll_for_roster',
    });
  });

  it('starting_weapon_forge_delta and starting_forge_lords: forge every lord weapon, or deforge', () => {
    for (const [type, params] of [
      ['starting_weapon_forge_delta', { stat: 'might', value: 1 }],
      ['starting_forge_lords', { stat: 'Might', count: 1 }],
    ]) {
      const rm = freshRun();
      const record = applyOne(rm, type, params);
      expect(record.details.requestedDelta).toBe(1);
      expect(record.details.forgeStat).toBe('might');
      expect(record.details.void).toBe(false);
      // Edric's two swords and Sera's tome; the staff and the recruit's weapons are left.
      expect(record.details.changedWeapons.map((c) => [c.unit, c.direction, c.stat])).toEqual([
        ['Edric', 'forge', 'might'],
        ['Edric', 'forge', 'might'],
        ['Sera', 'forge', 'might'],
      ]);
      expect(forgeLevels(rm)).toBe(3);
      expect(forgeLevels(rm, false)).toBe(3);
    }
    const rm = freshRun();
    applyOne(rm, 'starting_weapon_forge_delta', { stat: 'crit', value: 2 });
    expect(forgeLevels(rm)).toBe(6);
    const back = applyOne(rm, 'starting_weapon_forge_delta', { value: -1 });
    expect(back.details.changedWeapons.every((c) => c.direction === 'deforge')).toBe(true);
    expect(back.details.changedWeapons).toHaveLength(3);
    expect(forgeLevels(rm)).toBe(3);
  });

  it('starting_weapon_forge_delta: an unknown stat forges Might; nothing to deforge is void, not skipped', () => {
    const rm = freshRun();
    expect(
      applyOne(rm, 'starting_weapon_forge_delta', { stat: 'junk', value: 1 }).details,
    ).toMatchObject({ forgeStat: 'might' });
    const clean = freshRun();
    const record = applyOne(clean, 'starting_weapon_forge_delta', { value: -1 });
    expect(record.details).toEqual({
      requestedDelta: -1,
      forgeStat: 'might',
      changedWeapons: [],
      void: true,
    });
    expect(applyOne(freshRun(), 'starting_weapon_forge_delta', { value: 0 }).details).toEqual({
      skipped: true,
      reason: 'zero_starting_weapon_forge_delta',
    });
    expect(applyOne(freshRun(), 'starting_forge_lords', { count: 0 }).details).toEqual({
      skipped: true,
      reason: 'zero_starting_weapon_forge_delta',
    });
  });

  it("starting_best_weapon_forge (Blood Forge): each lord's strongest weapon, forged free", () => {
    const rm = freshRun();
    const before = Object.fromEntries(
      ['Edric', 'Sera'].flatMap((name) =>
        unit(rm, name).inventory.map((w) => [`${name}/${w.name}`, w.price]),
      ),
    );
    const record = applyOne(rm, 'starting_best_weapon_forge', { stat: 'might', value: 2 });
    expect(record.details).toEqual({
      forgeStat: 'might',
      requestedSteps: 2,
      changedWeapons: [
        { unit: 'Edric', weapon: 'Steel Sword', stat: 'might', steps: 2 },
        { unit: 'Sera', weapon: 'Glimmer', stat: 'might', steps: 2 },
      ],
    });
    const edric = unit(rm, 'Edric');
    const steel = edric.inventory.find((w) => w._baseName === 'Steel Sword');
    expect(steel.name).toBe('Steel Sword +2');
    expect(steel._forgeLevel).toBe(2);
    // A gift, not a purchase: the resale value did not grow.
    expect(steel.price).toBe(before['Edric/Steel Sword']);
    expect(edric.inventory.find((w) => w.name === 'Iron Sword')._forgeLevel).toBeUndefined();
    expect(forgeLevels(rm, false)).toBe(4);
  });

  it('starting_best_weapon_forge: an unknown stat forges Might; a zero or negative step count is skipped', () => {
    const rm = freshRun();
    expect(
      applyOne(rm, 'starting_best_weapon_forge', { stat: 'junk', value: 1 }).details.forgeStat,
    ).toBe('might');
    for (const value of [0, -1]) {
      expect(applyOne(freshRun(), 'starting_best_weapon_forge', { value }).details).toEqual({
        skipped: true,
        reason: 'zero_starting_best_weapon_forge',
      });
    }
  });
});

describe('beside the other boon modules', () => {
  it('a shrine boon still falls through the table to its own module', () => {
    const rm = freshRun();
    const record = applyOne(rm, 'under_par_gold', { perTurn: 100 });
    expect(record.details).toEqual({ perTurn: 100, total: 100 });
    expect(mods(rm).underParGoldPerTurn).toBe(100);
    const bad = applyOne(freshRun(), 'under_par_gold', {});
    expect(bad.details).toEqual({ skipped: true, reason: 'invalid_under_par_gold_params' });
  });

  it('the earned and twisted boons are answered before the table', () => {
    const rm = freshRun();
    const aura = applyOne(rm, 'commander_aura', { radius: 2, hitBonus: 5, avoidBonus: 5 });
    expect(aura.details.held).toBe(1);
    expect(applyOne(rm, 'reinforcement_delay', { value: 1 }).details).toEqual({
      appliedValue: 1,
      total: 1,
    });
    expect(applyOne(rm, 'master_seals_forbidden', {}).details).toBeTruthy();
    expect(mods(rm).masterSealsForbidden).toBe(true);
  });

  it('the earned modifiers (Unbroken Banner and the two Ember cards) are raised after the table', () => {
    for (const [type, field] of [
      ['battle_last_stand', 'battleLastStand'],
      ['first_kill_heal', 'firstKillHeal'],
      ['first_turn_mov_delta', 'firstTurnMovDelta'],
    ]) {
      const rm = freshRun();
      expect(applyOne(rm, type, { value: 1 }).details).toEqual({ appliedValue: 1, total: 1 });
      expect(applyOne(rm, type, { value: 2 }).details).toEqual({ appliedValue: 2, total: 3 });
      expect(mods(rm)[field]).toBe(3);
      for (const bad of [0, -1]) {
        expect(applyOne(rm, type, { value: bad }).details).toEqual({
          skipped: true,
          reason: `invalid_${type}_params`,
        });
      }
      expect(mods(rm)[field]).toBe(3);
    }
  });

  it('a name from Object.prototype is not an effect type the table answers', () => {
    expect(Object.hasOwn(RUN_START_BLESSING_EFFECTS, 'constructor')).toBe(false);
    expect(Object.hasOwn(RUN_START_BLESSING_EFFECTS, 'toString')).toBe(false);
    expect(Object.hasOwn(RUN_START_BLESSING_EFFECTS, '__proto__')).toBe(false);
    const rm = freshRun();
    const gold = rm.gold;
    const roster = JSON.stringify(rm.roster.map((u) => u.stats));
    for (const type of ['constructor', 'toString', 'hasOwnProperty'])
      rm._applySingleRunStartBlessingEffect(ID, effect(type, { value: 1 }));
    expect(rm.gold).toBe(gold);
    expect(JSON.stringify(rm.roster.map((u) => u.stats))).toBe(roster);
  });
});

describe('the handler table', () => {
  // Every type the old if-chain answered, spelled out: a type dropped from the table, or one
  // added to it, fails here with its name.
  const CHAIN_TYPES = [
    'run_start_max_hp_bonus',
    'gold_delta',
    'battle_gold_multiplier_delta',
    'deploy_cap_delta',
    'starting_weapon_tier',
    'act_stat_delta_all_units',
    'act_hit_bonus',
    'all_act_hit_bonus',
    'lord_stat_bonus',
    'all_units_stat_delta',
    'skip_first_shop',
    'shop_item_count_delta',
    'all_growths_delta',
    'targeted_growths_delta',
    'disable_personal_skills_until_act',
    'starting_consumable_all',
    'extra_consumable',
    'extra_vulnerary',
    'starting_random_skill',
    'starting_whetstones',
    'starting_scroll',
    'starting_forge_lords',
    'starting_weapon_forge_delta',
    'starting_best_weapon_forge',
    'act_start_gold',
    'act_start_convoy_item',
    'eclipse_shadow_delta',
    'xp_multiplier_delta',
    'forge_cost_discount',
    'forge_cost_multiplier',
    'forge_limit_delta',
    'shop_first_forge_free',
    'extra_shop_per_act',
    'shop_price_discount',
    'recruit_level_bonus',
    'first_strike_hit_bonus',
    'stationary_combat_bonus',
    'adjacent_ally_def_bonus',
    'isolated_combat_bonus',
    'healing_effectiveness_delta',
    'weapon_art_hp_cost_delta',
    'player_weapon_art_boon',
    'enemy_level_delta',
    'burden',
    'vision_delta',
    'act_deploy_cap_delta',
    'church_revive_disabled',
    'lord_stat_arc',
    'battle_gold_gamble',
    'act_start_vision_delta',
  ];

  // The effect types the catalog names anywhere a run-start handler can meet them: a card's boon
  // or listed cost, a twist, a price in the v3 catalog or a v2 cost pool, a gift's catch.
  function catalogEffectTypes() {
    const types = new Set();
    const add = (e) => e?.type && types.add(e.type);
    const catalog = data.blessings;
    for (const b of catalog.blessings) {
      (b.boons || []).forEach(add);
      (b.costs || []).forEach(add);
      (b.twist?.effects || []).forEach(add);
    }
    for (const price of Object.values(catalog.priceCatalog)) (price.effects || []).forEach(add);
    for (const pool of Object.values(catalog.costPools))
      for (const entry of pool) (entry.effects || []).forEach(add);
    for (const gift of catalog.gifts.list) (gift.catch?.effects || []).forEach(add);
    return types;
  }
  // Answered by another module, or by the gift code itself (never by the shrine's handlers).
  const ELSEWHERE = new Set([
    ...SHRINE_BOON_TYPES,
    ...EARNED_BOON_TYPES,
    ...TWISTED_BOON_TYPES,
    ...TWISTED_TWIST_TYPES,
    'battle_last_stand',
    'first_kill_heal',
    'first_turn_mov_delta',
    'eclipse_fall_now',
  ]);

  it('is frozen, and answers exactly the types the old chain did', () => {
    expect(Object.isFrozen(RUN_START_BLESSING_EFFECTS)).toBe(true);
    expect(Object.keys(RUN_START_BLESSING_EFFECTS).sort()).toEqual([...CHAIN_TYPES].sort());
    expect(new Set(CHAIN_TYPES).size).toBe(CHAIN_TYPES.length);
    for (const [type, handler] of Object.entries(RUN_START_BLESSING_EFFECTS))
      expect(typeof handler, type).toBe('function');
  });

  it('covers every effect type in the blessings catalog that no other module answers', () => {
    const wanted = [...catalogEffectTypes()].filter((type) => !ELSEWHERE.has(type));
    expect(wanted.length).toBeGreaterThan(30);
    for (const type of wanted)
      expect(Object.hasOwn(RUN_START_BLESSING_EFFECTS, type), type).toBe(true);
    // And nothing else in the catalog slips through unanswered.
    const unanswered = [...catalogEffectTypes()].filter(
      (type) => !ELSEWHERE.has(type) && !Object.hasOwn(RUN_START_BLESSING_EFFECTS, type),
    );
    expect(unanswered).toEqual([]);
  });

  it('shares no type with the earned, twisted or shrine modules, so the order between them is moot', () => {
    for (const type of ELSEWHERE) {
      if (type === 'eclipse_fall_now') continue;
      expect(Object.hasOwn(RUN_START_BLESSING_EFFECTS, type), type).toBe(false);
    }
  });

  it('every type the catalog uses applies with the catalog params and never lands as unhandled', () => {
    const rm = freshRun();
    for (const b of data.blessings.blessings)
      for (const boon of b.boons || []) {
        const records = apply(rm, boon.type, boon.params, b.id);
        expect(
          records.filter((r) => r.details?.reason === 'unhandled_effect_type'),
          `${b.id}/${boon.type}`,
        ).toEqual([]);
      }
  });
});
