// BlessingBoonMigration.js — blessings held across the v3 reworks (docs/specs/blessings-v3.md
// §4, "Old saves"). Pure but for the run it is handed.
//
// A run saves its blessings' effects whole (`blessingRuntimeModifiers`) and never re-runs a
// handler on load, so a save that holds a blessing whose boon changed would keep the OLD
// boon's numbers forever. This module turns each held blessing's old effect into the new
// one, once: RunManager.fromJSON calls it for a save below BLESSING_BOON_REVISION and then
// stamps the revision (the way ITEM_NAMES_REVISION gates the item renames). A new run, and
// the prologue, start at the current revision and are never migrated.
//
// What changed, per blessing id (the ids are save data and never change):
//   steady_hands      Steady Hands (+3 Hit, every act)   -> Keen Eye (+10 Hit on the first
//                     strike): take back the recorded per-act Hit, grant the first strike.
//   frugal_smith      Frugal Smith (forge -30%)          -> Smith's Mark (first forge free):
//                     take back the 30%, grant the free forge. The extra forge stays.
//   terrain_mastery   Terrain Mastery (Forest/Fort)      -> Hold the Line (unmoved): drop the
//                     terrain entry (and the retired field), grant the stationary bonus.
//   pilgrim_coin      Pilgrim Coin (+1 item, -15%)       -> Pilgrim's Road (one extra shop per
//                     act): take back both, grant the extra shop on the current map (what
//                     is still ahead of the party) and on every later act's.
//   coin_of_fate      Coin of Fate (+750 gold)           -> Advance Pay (+500, +250 per act):
//                     nothing taken back (but a logged +15% battle gold multiplier of the
//                     Feb 2026 build); the 250 starts with the next act.
//   quartermaster_cache  an Elixir per lord              -> an Elixir per act: nothing taken
//                     back; the delivery starts with the next act.
//   blood_forge, nomad_pact: the effect is the same (their reach widened), nothing to do.
//
// Taking back subtracts exactly what the old handler added, so a number another blessing
// or price put in the same field stays (an Act 1 -8 Hit price beside Steady Hands; a +20%
// forge price beside Frugal Smith). The amount is what the blessing's OWN logged boon records
// say (`blessingHistory`: blessingId + effectType + details.appliedValue, positive for a
// boon, negative for a price), because the numbers changed over the game's life: before
// Feb 19 2026 Steady Hands was +5 Hit in Act 1 only (`act_hit_bonus`), Frugal Smith -20%
// forge (`forge_cost_multiplier` -0.2), Pilgrim Coin +1 item with no discount until Feb 16,
// and Coin of Fate a +15% battle gold multiplier. Only a blessing with no boon records at
// all (a history that was lost) falls back to the figures below, frozen at this revision:
// the data rows may change later, a migration may not.

import { ACT_SEQUENCE } from '../utils/constants.js';
import { isPrologueRun } from './ScriptedBattle.js';

/** Bump when a new migration is added below (and add its rules to `MIGRATIONS`). */
export const BLESSING_BOON_REVISION = 1;

const KEEN_EYE_FIRST_STRIKE_HIT = 10;
const STEADY_HANDS_OLD_ACT_HIT = 3;
const FRUGAL_SMITH_OLD_DISCOUNT = 0.3;
const PILGRIM_COIN_OLD_ITEMS = 1;
const PILGRIM_COIN_OLD_DISCOUNT = 0.15;
const HOLD_THE_LINE = Object.freeze({ defBonus: 2, avoidBonus: 10 });
const OLD_TERRAIN_MASTERY = Object.freeze({
  terrains: ['Forest', 'Fort'],
  avoidBonus: 10,
  defBonus: 1,
});
const ADVANCE_PAY_RECURRING_GOLD = 250;
const QUARTERMASTER_ITEM = 'Elixir';

/** A float field minus an old amount, without leaving 0.1 + 0.2 style dust behind. */
function takeBack(current, amount) {
  return Math.round(((Number(current) || 0) - amount) * 1e6) / 1e6;
}

/** Round a sum of logged amounts the way `takeBack` does. */
function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The boon records the OLD handlers logged for one blessing: every history entry with its
 * id, leaving out what this module wrote itself (`stage: 'migration'`).
 */
function boonHistory(run, blessingId) {
  return (Array.isArray(run.blessingHistory) ? run.blessingHistory : []).filter(
    (entry) => entry?.blessingId === blessingId && entry?.stage !== 'migration',
  );
}

/** A logged record's positive `appliedValue` (a price is negative; a skipped record has none). */
function positiveApplied(entry) {
  const value = Number(entry?.details?.appliedValue);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The sum of the positive `appliedValue`s of the records whose effectType passes `match`. */
function loggedTotal(records, match) {
  let total = 0;
  for (const entry of records) {
    if (typeof entry?.effectType === 'string' && match(entry.effectType))
      total += positiveApplied(entry);
  }
  return round6(total);
}

function record(run, blessingId, effectType, details) {
  if (!Array.isArray(run.blessingHistory)) run.blessingHistory = [];
  run.blessingHistory.push({
    timestamp: Date.now(),
    stage: 'migration',
    eventType: 'migrated',
    blessingId,
    effectType,
    details,
  });
}

/** The acts the run has begun: every act up to and including the current one. */
function actsReached(run) {
  const sequence =
    Array.isArray(run.actSequence) && run.actSequence.length > 0 ? run.actSequence : ACT_SEQUENCE;
  const index = Math.max(0, sequence.indexOf(run.currentAct));
  return sequence.slice(0, index + 1);
}

function hasGrant(modifiers, blessingId) {
  return (
    Array.isArray(modifiers.actStartGrants) &&
    modifiers.actStartGrants.some((grant) => grant?.blessingId === blessingId)
  );
}

function migrateSteadyHands(run, modifiers) {
  // A run already on Keen Eye has the first-strike bonus (a save from this build's earlier
  // commits, before the revision existed): nothing old to take back.
  if (Math.trunc(Number(modifiers.firstStrikeHitBonus) || 0) > 0) return;
  // The old handlers logged exactly which acts they raised and by how much: `act_hit_bonus`
  // (one act, +5 in Act 1 before Feb 19 2026) and `all_act_hit_bonus` (every act, +3).
  const records = boonHistory(run, 'steady_hands');
  const taken = {}; // act -> Hit this blessing added
  for (const entry of records) {
    const amount = Math.trunc(positiveApplied(entry));
    if (amount <= 0) continue;
    if (entry.effectType === 'act_hit_bonus' && typeof entry.details?.act === 'string') {
      taken[entry.details.act] = (taken[entry.details.act] || 0) + amount;
    } else if (entry.effectType === 'all_act_hit_bonus') {
      const acts =
        Array.isArray(entry.details?.acts) && entry.details.acts.length > 0
          ? entry.details.acts.filter((act) => typeof act === 'string')
          : ACT_SEQUENCE;
      for (const act of acts) taken[act] = (taken[act] || 0) + amount;
    }
  }
  // With no record of the blessing at all (a lost history) fall back to the +3 of every act;
  // any record that says otherwise (even a skipped one) is believed instead.
  if (records.length === 0) {
    for (const act of ACT_SEQUENCE) taken[act] = STEADY_HANDS_OLD_ACT_HIT;
  }
  const byAct =
    modifiers.actHitBonusByAct && typeof modifiers.actHitBonusByAct === 'object'
      ? modifiers.actHitBonusByAct
      : {};
  for (const [act, amount] of Object.entries(taken)) {
    const left = Math.trunc(Number(byAct[act]) || 0) - amount;
    if (left === 0) delete byAct[act];
    else byAct[act] = left;
  }
  modifiers.actHitBonusByAct = byAct;
  modifiers.firstStrikeHitBonus =
    Math.trunc(Number(modifiers.firstStrikeHitBonus) || 0) + KEEN_EYE_FIRST_STRIKE_HIT;
  record(run, 'steady_hands', 'first_strike_hit_bonus', {
    tookBack: { byAct: { ...taken } },
    firstStrikeHitBonus: modifiers.firstStrikeHitBonus,
  });
}

function migrateFrugalSmith(run, modifiers) {
  if (Math.trunc(Number(modifiers.freeForgesPerShop) || 0) > 0) return;
  // The discount the handler logged (a forge price is a negative record and stays); it was
  // 20% before Feb 19 2026 and 30% after.
  const records = boonHistory(run, 'frugal_smith');
  const discount =
    records.length === 0
      ? FRUGAL_SMITH_OLD_DISCOUNT
      : loggedTotal(records, (type) => type.startsWith('forge_cost_'));
  modifiers.forgeCostDiscount = takeBack(modifiers.forgeCostDiscount, discount);
  modifiers.freeForgesPerShop = Math.trunc(Number(modifiers.freeForgesPerShop) || 0) + 1;
  record(run, 'frugal_smith', 'shop_first_forge_free', {
    tookBack: discount,
    forgeCostDiscount: modifiers.forgeCostDiscount,
    freeForgesPerShop: modifiers.freeForgesPerShop,
  });
}

function sameTerrains(a, b) {
  return (
    Array.isArray(a) && a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
  );
}

function migrateTerrainMastery(run, modifiers) {
  const held = modifiers.stationaryCombatBonus;
  if (Math.trunc(Number(held?.defBonus) || 0) > 0 || Math.trunc(Number(held?.avoidBonus) || 0) > 0)
    return;
  // The old boon's one entry (Forest and Fort), found by its terrains; the exact numbers
  // are preferred when the list somehow holds more than one such entry.
  const list = Array.isArray(modifiers.terrainCombatBonuses) ? modifiers.terrainCombatBonuses : [];
  let index = list.findIndex(
    (entry) =>
      sameTerrains(entry?.terrains, OLD_TERRAIN_MASTERY.terrains) &&
      entry.avoidBonus === OLD_TERRAIN_MASTERY.avoidBonus &&
      entry.defBonus === OLD_TERRAIN_MASTERY.defBonus,
  );
  if (index < 0) {
    index = list.findIndex((entry) => sameTerrains(entry?.terrains, OLD_TERRAIN_MASTERY.terrains));
  }
  if (index >= 0) list.splice(index, 1);
  modifiers.stationaryCombatBonus = {
    defBonus: Math.trunc(Number(held?.defBonus) || 0) + HOLD_THE_LINE.defBonus,
    avoidBonus: Math.trunc(Number(held?.avoidBonus) || 0) + HOLD_THE_LINE.avoidBonus,
  };
  record(run, 'terrain_mastery', 'stationary_combat_bonus', {
    tookBack: index >= 0,
    stationaryCombatBonus: { ...modifiers.stationaryCombatBonus },
  });
}

function migratePilgrimCoin(run, modifiers) {
  if (Math.trunc(Number(modifiers.extraShopsPerAct) || 0) > 0) return;
  // What the handlers logged: +1 item always, the 15% discount only from Feb 16 2026 on.
  const records = boonHistory(run, 'pilgrim_coin');
  const items =
    records.length === 0
      ? PILGRIM_COIN_OLD_ITEMS
      : Math.trunc(loggedTotal(records, (type) => type === 'shop_item_count_delta'));
  const discount =
    records.length === 0
      ? PILGRIM_COIN_OLD_DISCOUNT
      : loggedTotal(records, (type) => type === 'shop_price_discount');
  modifiers.shopItemCountDelta = Math.trunc(Number(modifiers.shopItemCountDelta) || 0) - items;
  modifiers.shopPriceDiscount = takeBack(modifiers.shopPriceDiscount, discount);
  modifiers.extraShopsPerAct = Math.trunc(Number(modifiers.extraShopsPerAct) || 0) + 1;
  // The blessing is taken away at once, so the shop must not wait for an act that may never
  // come (the last act has no later map): the current map gains it now, from the next row on
  // and only where the party can still go, as a blessing taken at a church does. The map is
  // copied first (it is shared with the parsed save); no map or no free node changes nothing.
  let converted = [];
  if (run.nodeMap && typeof run.nodeMap === 'object' && Array.isArray(run.nodeMap.nodes)) {
    run.nodeMap = structuredClone(run.nodeMap);
    const here = run.nodeMap.nodes.find((node) => node.id === run.currentNodeId);
    converted = run._stampExtraShops({
      fromRow: here ? here.row + 1 : 0,
      currentNodeId: run.currentNodeId,
    });
  }
  record(run, 'pilgrim_coin', 'extra_shop_per_act', {
    tookBack: { items, discount },
    shopItemCountDelta: modifiers.shopItemCountDelta,
    shopPriceDiscount: modifiers.shopPriceDiscount,
    extraShopsPerAct: modifiers.extraShopsPerAct,
    converted,
  });
}

function migrateCoinOfFate(run, modifiers) {
  if (hasGrant(modifiers, 'coin_of_fate')) return;
  // Between Feb 16 and Feb 19 2026 the blessing was a +15% battle gold multiplier
  // (`battle_gold_multiplier_delta`); take back what it logged. The gold paid up front stays.
  const multiplier = loggedTotal(
    boonHistory(run, 'coin_of_fate'),
    (type) => type === 'battle_gold_multiplier_delta',
  );
  if (multiplier > 0) {
    modifiers.battleGoldMultiplierDelta = takeBack(modifiers.battleGoldMultiplierDelta, multiplier);
  }
  if (!Array.isArray(modifiers.actStartGrants)) modifiers.actStartGrants = [];
  // The 750 paid up front stays; the recurring 250 begins with the act after this one.
  modifiers.actStartGrants.push({
    blessingId: 'coin_of_fate',
    kind: 'gold',
    value: ADVANCE_PAY_RECURRING_GOLD,
    paidActs: actsReached(run),
  });
  record(run, 'coin_of_fate', 'act_start_gold', {
    value: ADVANCE_PAY_RECURRING_GOLD,
    firstPayment: 'next_act',
    ...(multiplier > 0 ? { tookBack: { battleGoldMultiplierDelta: multiplier } } : {}),
  });
}

function migrateQuartermasterCache(run, modifiers) {
  if (hasGrant(modifiers, 'quartermaster_cache')) return;
  if (!Array.isArray(modifiers.actStartGrants)) modifiers.actStartGrants = [];
  // The Elixirs already handed to the lords stay; one more arrives with each later act.
  modifiers.actStartGrants.push({
    blessingId: 'quartermaster_cache',
    kind: 'item',
    itemName: QUARTERMASTER_ITEM,
    count: 1,
    paidActs: actsReached(run),
  });
  record(run, 'quartermaster_cache', 'act_start_convoy_item', {
    itemName: QUARTERMASTER_ITEM,
    count: 1,
    firstDelivery: 'next_act',
  });
}

/** Revision 1 (the v3 reworks): blessing id -> the rule that converts its old boon. */
const REVISION_1 = Object.freeze({
  steady_hands: migrateSteadyHands,
  frugal_smith: migrateFrugalSmith,
  terrain_mastery: migrateTerrainMastery,
  pilgrim_coin: migratePilgrimCoin,
  coin_of_fate: migrateCoinOfFate,
  quartermaster_cache: migrateQuartermasterCache,
});

/**
 * Convert the old boons of every blessing the run holds (taken at the shrine, a church or an
 * event alike) to their v3 form, in place. The caller (RunManager.fromJSON) gates on the saved
 * revision and stamps the new one; this function itself never runs for the prologue and each
 * rule skips a blessing whose new effect is already on the run, so it is safe to call again.
 * Also drops the retired `terrainCombatBonuses` field.
 * @param {object} run  a RunManager whose activeBlessings, blessingHistory, blessingRuntimeModifiers
 *   and act position are already loaded
 * @returns {string[]} the blessing ids migrated
 */
export function migrateHeldBlessingBoons(run) {
  if (!run || isPrologueRun(run)) return [];
  const modifiers = run.blessingRuntimeModifiers;
  if (!modifiers || typeof modifiers !== 'object') return [];
  const held = new Set(run.getActiveBlessingIds?.() || []);
  const migrated = [];
  for (const [blessingId, rule] of Object.entries(REVISION_1)) {
    if (!held.has(blessingId)) continue;
    const recorded = (run.blessingHistory || []).length;
    rule(run, modifiers);
    if ((run.blessingHistory || []).length > recorded) migrated.push(blessingId);
  }
  // Terrain Mastery's field is gone for every save, held or not.
  delete modifiers.terrainCombatBonuses;
  return migrated;
}
