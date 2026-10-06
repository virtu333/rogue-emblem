// EventEffects.js — the effects an event outcome can have (docs/specs/event-nodes.md §5).
// Pure engine code: no Phaser, no DOM, and never Math.random for a choice (every pick is
// a seeded stream; stray draws deeper in the engine, such as item uids, are contained by
// EventCommands under a seeded swap).
//
// PLAN, THEN APPLY. `planEffects` validates and resolves every effect (which item, which
// skill, who gets it, where it goes) against a ledger of what earlier effects of the same
// outcome will already have used (gold, bag slots, convoy room, uses, skills), without
// touching the run. Only a plan with no failure is handed to `applyPlan`, which cannot
// fail by design (and EventCommands rolls the run back if it ever throws). A failed plan
// applies nothing.
//
// Effect types (EVENT_EFFECT_TYPES) and their records (the plain `results` of an outcome):
//   gold        { value | refund: true }        gold ± (a loss floors at 0); `refund` gives back the
//                                                 gold the choice charged (a fallback's "keep your coin")
//                                                 -> { kind:'gold', value, requested }
//   item        { name | pool, to, wear }       a weapon (or named consumable) delivered; a pool of
//                                                 `kind: 'accessory'` ({ tierOffset }) hands out one accessory
//                                                 from the loot table of the act `tierOffset` tiers up, into
//                                                 the army's accessory pool (no room needed)
//                                                 -> { kind:'item', name, unit|null, toConvoy, pooled?, worn:[stat] }
//   learnSkill  { skillId | pool | poolByType }  `to: target`; benched at the cap
//                                                 -> { kind:'skill', unit, skillId, benched }
//   fallenSkill {}                              a skill of the named fallen ally the target can learn
//                                                 -> { kind:'skill', unit, skillId, benched, from }
//   hp          { mode, percent|value|to, scope } damage floors at 1 HP, heals stop at max
//                                                 -> { kind:'hp', mode, scope, units:[{name, amount}], total }
//   shadow      { value }                       the Eclipse (both meters; inactive: no-op)
//                                                 -> { kind:'shadow', value, actValue, requested, fell:[nodeId] }
//   vision      { value }                       Vision charges, floor 0
//                                                 -> { kind:'vision', value }
//   blessing    { tier }                        a seeded mid-run-safe boon blessing the run lacks
//                                                 -> { kind:'blessing', id, name, description, tier }
//   burden      { id, params }                  Burdens.js
//                                                 -> { kind:'burden', id, label, line, detail }
//   flag        { key, value }                  storyFlags
//                                                 -> { kind:'flag', key, value }
//   layToRest   {}                              the named fallen ally can never be revived
//                                                 -> { kind:'layToRest', name }
//   consume     { name, uses }                  the healthiest holder's use, else the convoy's
//                                                 -> { kind:'consume', name, uses, holder }
//   stat        { stat, value, scope }          a permanent boost (the stat booster's path); `stat` may be
//                                                 'best' (the unit's highest of STR MAG SKL SPD DEF RES LCK,
//                                                 a tie seeded); a negative value never takes a stat below 0
//                                                 (HP: below 1) and HP never leaves the unit above its new max
//                                                 -> { kind:'stat', unit, stat, value }
//   battle      { enemyLevelBonus, afterVictory, victoryText, elite?, recruit? }  EventCommands builds the
//                                                 fight; `elite` makes it an elite battle (better loot and
//                                                 gold, the elite rules); `recruit` ({ class | classPool,
//                                                 name? }) puts a green recruit in it, a unit the army can
//                                                 Talk into joining, exactly as a recruit node does
//                                                 -> { kind:'battle', enemyLevelBonus, recruit? }
//   counter     { key, delta }                  an event counter (the Sunken Mine's torches), floor 0
//                                                 -> { kind:'counter', key, label, delta, value }
//   join        { class | classPool, name?, levelOffset?, trait? }  a unit joins the army
//                                                 (EventJoin.js: the recruit-node builder)
//                                                 -> { kind:'join', name, className, level, unitUid }
//   contract    { goal, reward, penalty }       a goal for the next battle (Contracts.js)
//                                                 -> { kind:'contract', goal, label, short, line, reward, penalty }
//   forge       { stat?: 'might'|'crit'|'hit'|'weight'|'random' }  one free forge step on the target's
//                                                equipped weapon (a whetstone, without the gold)
//                                                -> { kind:'forge', unit, weapon, name, stat }
//   wear        {}                              one wear step on the target's equipped weapon (a forge
//                                                gone wrong: WeaponWear.js; nothing to wear -> fallback)
//                                                -> { kind:'wear', unit, weapon, name, stat }
//   mend        {}                              every wear step on every weapon the target carries is
//                                                repaired (WeaponWear.repairWeapon; the gold is the choice's)
//                                                -> { kind:'mend', unit, steps, weapons:[{ from, to, steps }] }
//   routeEdit   { op: 'addRoad' } | { op: 'redraw', toType }  the route map (RouteEdit.js)
//                                                 -> { kind:'route', op:'addRoad', from, to, row, col, type }
//                                                  | { kind:'route', op:'redraw', node, row, col, fromType, type }
//
// An outcome's `fallback` effects replace its `effects` when a learnSkill/fallenSkill has
// nothing left to teach, or a routeEdit has nothing it may change. In `lenient` mode (the spoils after a won battle) an effect that
// cannot be delivered (no room, no blessing left) is skipped with a note rather than
// failing: a won battle never loses its reward to a failed plan.

import { applyRewardTarget } from './LootRewardCommands.js';
import { spendConsumableUse } from './RosterInventory.js';
import { canEquip, learnSkill, applyStatBoost, knowsSkill } from './UnitManager.js';
import { healUnit, damageUnit } from './UnitHealth.js';
import { applyWear, wearableStats, isWorn, repairWeapon, wearCount } from './WeaponWear.js';
import { applyForge, canForgeStat } from './ForgeSystem.js';
import { RECRUIT_PREVIEW_VERSION } from './RecruitNodeSystem.js';
import { ensureItemUid } from '../utils/itemUid.js';
import { commitShadow, actShadowOf, withEclipseSeed } from './EclipseSystem.js';
import { convertNodeToRoutBattle } from './NodeMapGenerator.js';
import { WOUND_STATS, addBurden, burdenDefFor, describeBurden } from './Burdens.js';
import { describeContract, normalizeContract, contractOf } from './Contracts.js';
import { planJoin, applyJoin, pickJoinSelf } from './EventJoin.js';
import { planRouteEdit, applyRouteEdit } from './RouteEdit.js';
import { CONSUMABLE_MAX, INVENTORY_MAX, NODE_TYPES } from '../utils/constants.js';
import { unitUidOf } from './UnitIdentity.js';
import {
  START_PAGE,
  choiceCost,
  availableEventBlessings,
  bestWeaponType,
  byRungValue,
  consumableHolders,
  counterLabel,
  counterValue,
  equippedForgeable,
  eventRng,
  isTeachableSkill,
  learnableFromFallen,
  livingUnits,
  resolveAmount,
  runSeedOf,
  unitWields,
  usesLeft,
  withFlag,
} from './EventSystem.js';

export const EVENT_EFFECT_TYPES = Object.freeze([
  'gold',
  'item',
  'learnSkill',
  'fallenSkill',
  'hp',
  'shadow',
  'vision',
  'blessing',
  'burden',
  'flag',
  'layToRest',
  'consume',
  'stat',
  'battle',
  'counter',
  'join',
  'contract',
  'routeEdit',
  'forge',
  'wear',
  'mend',
]);

/** Effect types that must name a chosen unit (`to: 'target'` / `scope: 'target'`). */
export const TARGETED_EFFECT_TYPES = Object.freeze([
  'learnSkill',
  'fallenSkill',
  'forge',
  'wear',
  'mend',
]);

/** The stats `stat: 'best'` may pick from (never HP or MOV). */
export const BEST_STAT_CHOICES = Object.freeze(['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']);

/** The accessories' tiers: the loot table of an act, one tier up = the next act's (Act IV's is the top). */
export const ACCESSORY_TIER_TABLES = Object.freeze(['act1', 'act2', 'act3', 'act4']);

/** Weapon types and tiers an event's weapon pools draw from. */
export const EVENT_WEAPON_TYPES = Object.freeze(['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light']);
export const EVENT_WEAPON_TIERS = Object.freeze(['Iron', 'Steel', 'Silver']);
const ACT_BASELINE_TIER = Object.freeze({ act1: 0, act2: 1, act3: 2, act4: 2 });

// Every effect's sub-picks hang off its choice's seed key; a page after the first names itself
// (EventSystem.choiceSeedKey), so the first page keeps its Phase 1 streams.
const rngFor = (ctx, index, label) =>
  eventRng(
    `event:${runSeedOf(ctx.run)}:${ctx.nodeId}:${pagePart(ctx)}${ctx.choice?.id || 'choice'}:${ctx.phase}${index}:${label}`,
  );
const pagePart = (ctx) => (ctx.page && ctx.page !== START_PAGE ? `${ctx.page}:` : '');

const pickFrom = (list, rng) => list[Math.floor(rng() * list.length)];

// ── Weapon pools ────────────────────────────────────────────────────────

/** The weapon names any loot table (shop or loot) can hand out, across acts. */
export function lootWeaponNames(lootTables) {
  const names = new Set();
  for (const table of Object.values(lootTables || {})) {
    if (!table || typeof table !== 'object') continue;
    for (const name of table.weapons || []) names.add(name);
    for (const name of table.bossRewards?.weapons || []) names.add(name);
  }
  return names;
}

/**
 * A weapon an event may hand out: a combat weapon type, Iron/Steel/Silver (never Legend or
 * Rare), no lord's signature weapon, nothing that spends per-battle uses, a real price,
 * and loot-eligible (Iron is the baseline everyone starts with; Steel and Silver must be in
 * a loot table, which keeps enemy-only gear and special weapons out).
 */
export function isEventWeapon(weapon, lootNames) {
  if (!weapon || !EVENT_WEAPON_TYPES.includes(weapon.type)) return false;
  if (!EVENT_WEAPON_TIERS.includes(weapon.tier)) return false;
  if (weapon.signatureOf || weapon.perBattleUses || weapon.usesByFaction) return false;
  if (!(Number(weapon.price) > 0)) return false;
  return weapon.tier === 'Iron' || lootNames.has(weapon.name);
}

/** The tier a pool draws from in an act: the act's baseline plus the offset, capped at Silver. */
export function eventWeaponTier(actId, tierOffset = 0) {
  const base = ACT_BASELINE_TIER[actId] ?? 0;
  const index = Math.max(
    0,
    Math.min(EVENT_WEAPON_TIERS.length - 1, base + (Number(tierOffset) || 0)),
  );
  return EVENT_WEAPON_TIERS[Math.trunc(index)];
}

/** Every weapon an event could hand out (the validator and tests read this). */
export function eventWeaponCatalog(gameData) {
  const lootNames = lootWeaponNames(gameData?.lootTables);
  return (gameData?.weapons || []).filter((weapon) => isEventWeapon(weapon, lootNames));
}

function poolWeaponTypes(ctx, pool) {
  if (Array.isArray(pool.weaponTypes)) return pool.weaponTypes;
  if (pool.weaponTypes === '$target')
    return EVENT_WEAPON_TYPES.filter((type) => ctx.target && unitWields(ctx.target, [type]));
  return EVENT_WEAPON_TYPES.filter((type) =>
    (ctx.run.roster || []).some((u) => unitWields(u, [type])),
  );
}

// ── Delivery ────────────────────────────────────────────────────────────

/** A fresh ledger of what the effects planned so far will have used (gold, room, uses). */
export function createLedger(run) {
  return {
    gold: Number(run.gold) || 0,
    invAdds: new Map(),
    consAdds: new Map(),
    convoyAdds: { weapons: 0, consumables: 0 },
    consumed: new Map(),
    learned: new Map(),
    rested: new Set(),
    battle: false,
    joined: new Set(),
    counters: new Map(),
    contract: false,
    routeEdit: false,
    weapons: new Set(),
  };
}

/** A copy of a ledger (to replan an outcome's fallback from the same starting point). */
export function cloneLedger(ledger) {
  return {
    gold: ledger.gold,
    invAdds: new Map(ledger.invAdds),
    consAdds: new Map(ledger.consAdds),
    convoyAdds: { ...ledger.convoyAdds },
    consumed: new Map(ledger.consumed),
    learned: new Map([...ledger.learned].map(([unit, set]) => [unit, new Set(set)])),
    rested: new Set(ledger.rested),
    battle: ledger.battle,
    joined: new Set(ledger.joined),
    counters: new Map(ledger.counters),
    contract: ledger.contract,
    routeEdit: ledger.routeEdit,
    weapons: new Set(ledger.weapons),
  };
}

function unitHasRoom(unit, item, ledger) {
  if (item.type === 'Consumable')
    return (unit.consumables?.length || 0) + (ledger.consAdds.get(unit) || 0) < CONSUMABLE_MAX;
  return (
    (unit.inventory?.length || 0) + (ledger.invAdds.get(unit) || 0) < INVENTORY_MAX &&
    canEquip(unit, item)
  );
}

function convoyHasRoom(run, item, ledger) {
  if (!run.canAddToConvoy?.(item)) return false;
  const bucket = item.type === 'Consumable' ? 'consumables' : 'weapons';
  const caps = run.getConvoyCapacities();
  const counts = run.getConvoyCounts();
  return counts[bucket] + ledger.convoyAdds[bucket] < caps[bucket];
}

/** Where an item goes, by the delivery order of the spec; null when nowhere takes it. */
function chooseDestination(ctx, item, mode, ledger) {
  const { run } = ctx;
  const order = [];
  const push = (dest) => {
    if (dest && !order.includes(dest)) order.push(dest);
  };
  const others = () => (run.roster || []).filter((unit) => unit !== ctx.target);
  if (mode === 'convoy') {
    push('convoy');
  } else if (mode === 'target') {
    push(ctx.target);
    push('convoy');
    for (const unit of [run.getCommander?.(), ...others()]) push(unit);
  } else {
    // auto: the target, the commander, any unit with room that can use it, the convoy.
    push(ctx.target);
    push(run.getCommander?.());
    for (const unit of others()) push(unit);
    push('convoy');
  }
  for (const dest of order) {
    if (
      dest === 'convoy'
        ? convoyHasRoom(run, item, ledger)
        : run.roster.includes(dest) && unitHasRoom(dest, item, ledger)
    )
      return dest;
  }
  return null;
}

function reserve(ledger, item, dest) {
  if (dest === 'convoy')
    ledger.convoyAdds[item.type === 'Consumable' ? 'consumables' : 'weapons'] += 1;
  else {
    const map = item.type === 'Consumable' ? ledger.consAdds : ledger.invAdds;
    map.set(dest, (map.get(dest) || 0) + 1);
  }
}

function pickPoolWeapon(ctx, effect, index, ledger) {
  const { run } = ctx;
  const pool = effect.pool || {};
  const types = poolWeaponTypes(ctx, pool);
  const lootNames = lootWeaponNames(run.gameData?.lootTables);
  const all = (run.gameData?.weapons || []).filter(
    (w) => isEventWeapon(w, lootNames) && types.includes(w.type),
  );
  let tierIndex = EVENT_WEAPON_TIERS.indexOf(eventWeaponTier(run.currentAct, pool.tierOffset));
  while (tierIndex >= 0) {
    const tier = EVENT_WEAPON_TIERS[tierIndex];
    const candidates = all
      .filter((w) => w.tier === tier)
      .filter((w) =>
        pool.weaponTypes === '$target'
          ? ctx.target && canEquip(ctx.target, w)
          : pool.weaponTypes === '$army' || pool.weaponTypes === undefined
            ? (run.roster || []).some((unit) => canEquip(unit, w))
            : true,
      )
      .filter((w) => chooseDestination(ctx, w, effect.to || 'auto', ledger))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (candidates.length) return pickFrom(candidates, rngFor(ctx, index, 'weapon'));
    tierIndex -= 1;
  }
  return null;
}

// ── Plan ────────────────────────────────────────────────────────────────

const NO_ROOM = 'Nowhere to carry anything more. Make room in the convoy.';

function planGold(ctx, effect, index, ledger) {
  // `refund`: the gold the choice charged, handed back (a fallback's "keep your coin").
  const requested =
    effect.refund === true
      ? choiceCost(ctx.run, ctx.choice, ctx.catalog)
      : resolveAmount(effect.value, ctx.run.currentAct);
  const value = requested < 0 ? -Math.min(-requested, Math.max(0, ledger.gold)) : requested;
  ledger.gold += value;
  return { step: { type: 'gold', value, requested } };
}

/** The accessories a pool of `kind: 'accessory'` can hand out here: the loot table `tierOffset` tiers up. */
export function accessoryPoolFor(run, tierOffset = 0) {
  const here = Math.max(0, ACCESSORY_TIER_TABLES.indexOf(run.currentAct));
  const index = Math.max(
    0,
    Math.min(ACCESSORY_TIER_TABLES.length - 1, here + Math.trunc(Number(tierOffset) || 0)),
  );
  const names = run.gameData?.lootTables?.[ACCESSORY_TIER_TABLES[index]]?.accessories || [];
  const byName = new Map((run.gameData?.accessories || []).map((a) => [a.name, a]));
  return [...new Set(names)]
    .map((name) => byName.get(name))
    .filter((a) => a && a.type === 'Accessory')
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

function planAccessory(ctx, effect, index, lenient) {
  const candidates = accessoryPoolFor(ctx.run, effect.pool?.tierOffset);
  if (candidates.length === 0)
    return lenient
      ? skipNote('item', 'There was nothing here worth keeping.')
      : { error: 'There is nothing here worth keeping.' };
  const item = structuredClone(pickFrom(candidates, rngFor(ctx, index, 'accessory')));
  return { step: { type: 'item', item, dest: 'pool', worn: [] } };
}

function planItem(ctx, effect, index, ledger, lenient) {
  const { run } = ctx;
  if (effect.pool?.kind === 'accessory') return planAccessory(ctx, effect, index, lenient);
  let template;
  if (effect.pool) {
    template = pickPoolWeapon(ctx, effect, index, ledger);
    if (!template)
      return lenient ? skipNote('item', NO_ROOM) : { error: NO_ROOM, itemKind: 'weapon' };
  } else {
    template =
      run.getConsumableTemplate?.(effect.name) ||
      (run.gameData?.weapons || []).find((w) => w.name === effect.name) ||
      null;
    if (!template) return { error: `Unknown item "${effect.name}".` };
  }
  const item = structuredClone(template);
  const worn = [];
  const steps = Math.max(0, Math.trunc(Number(effect.wear) || 0));
  if (steps > 0) {
    const rng = rngFor(ctx, index, 'wear');
    for (let i = 0; i < steps; i++) {
      const stats = wearableStats(item);
      if (stats.length === 0) break;
      const stat = pickFrom(stats, rng);
      if (applyWear(item, stat).success) worn.push(stat);
    }
  }
  const dest = chooseDestination(ctx, item, effect.to || 'auto', ledger);
  if (!dest)
    return lenient
      ? skipNote('item', NO_ROOM)
      : { error: NO_ROOM, itemKind: item.type === 'Consumable' ? 'consumable' : 'weapon' };
  reserve(ledger, item, dest);
  return { step: { type: 'item', item, dest, worn } };
}

function skipNote(kind, text) {
  return { step: { type: 'note', note: { kind: 'note', of: kind, text } } };
}

function skillCandidates(ctx, effect, unit, ledger) {
  const skills = new Map((ctx.run.gameData?.skills || []).map((s) => [s.id, s]));
  let ids = [];
  if (typeof effect.skillId === 'string') ids = [effect.skillId];
  else if (Array.isArray(effect.pool)) ids = effect.pool;
  else if (effect.poolByType && typeof effect.poolByType === 'object') {
    const type = bestWeaponType(unit, Object.keys(effect.poolByType));
    ids = type ? effect.poolByType[type] || [] : [];
  }
  const learned = ledger.learned.get(unit) || new Set();
  return ids.filter(
    (id) => isTeachableSkill(skills.get(id)) && !knowsSkill(unit, id) && !learned.has(id),
  );
}

function planLearn(ctx, effect, index, ledger) {
  const unit = ctx.target;
  if (!unit) return { error: 'No one to teach.' };
  const candidates = skillCandidates(ctx, effect, unit, ledger);
  if (candidates.length === 0) return { empty: true };
  const skillId = pickFrom(candidates, rngFor(ctx, index, 'skill'));
  if (!ledger.learned.has(unit)) ledger.learned.set(unit, new Set());
  ledger.learned.get(unit).add(skillId);
  return { step: { type: 'skill', unit, skillId, from: null } };
}

function planFallenSkill(ctx, effect, index, ledger) {
  const unit = ctx.target;
  if (!unit) return { error: 'No one to teach.' };
  if (!ctx.fallenUnit) return { error: 'They are not here.' };
  const learned = ledger.learned.get(unit) || new Set();
  const candidates = learnableFromFallen(ctx.run, ctx.fallenUnit, unit).filter(
    (id) => !learned.has(id),
  );
  if (candidates.length === 0) return { empty: true };
  const skillId = pickFrom(candidates, rngFor(ctx, index, 'skill'));
  if (!ledger.learned.has(unit)) ledger.learned.set(unit, new Set());
  ledger.learned.get(unit).add(skillId);
  return { step: { type: 'skill', unit, skillId, from: ctx.fallenUnit.name } };
}

function hpUnits(ctx, effect, index) {
  const { run } = ctx;
  const living = livingUnits(run);
  switch (effect.scope) {
    case 'target':
      return ctx.target ? [ctx.target] : null;
    case 'all':
      return living;
    case 'commander': {
      const commander = run.getCommander?.() || living.find((u) => u.isLord) || living[0];
      return commander ? [commander] : [];
    }
    case 'randomUnit':
      return living.length ? [pickFrom(living, rngFor(ctx, index, 'unit'))] : [];
    default:
      return null;
  }
}

function planHp(ctx, effect, index) {
  const units = hpUnits(ctx, effect, index);
  if (!units) return { error: 'No one to affect.' };
  const percent = Number(byRungValue(effect.percentByRung, ctx.run.difficultyId, effect.percent));
  return {
    step: {
      type: 'hp',
      mode: effect.mode === 'heal' ? 'heal' : 'damage',
      scope: effect.scope,
      units,
      percent: Number.isFinite(percent) ? percent : null,
      value: Number.isFinite(Number(effect.value)) ? Math.trunc(Number(effect.value)) : null,
      to: Number.isFinite(Number(effect.to)) ? Math.max(1, Math.trunc(Number(effect.to))) : null,
    },
  };
}

function planBlessing(ctx, effect, index, ledger, lenient) {
  const candidates = availableEventBlessings(ctx.run, effect.tier).sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  if (candidates.length === 0)
    return lenient
      ? skipNote('blessing', 'The altar has nothing left to give.')
      : { error: 'There is nothing left to give you.' };
  const blessing = pickFrom(candidates, rngFor(ctx, index, 'blessing'));
  return { step: { type: 'blessing', blessing } };
}

function planBurden(ctx, effect, index) {
  const def = burdenDefFor(ctx.catalog, effect.id, ctx.run.difficultyId);
  if (!def) return { error: `Unknown burden "${effect.id}".` };
  const params = { ...(effect.params || {}) };
  if (params.owed !== undefined) params.owed = resolveAmount(params.owed, ctx.run.currentAct);
  if (effect.id === 'wounded') {
    // Who and where are fixed now, from the seeded stream: the record carries the unit's uid.
    const unit =
      params.scope === 'target'
        ? ctx.target
        : (() => {
            const living = livingUnits(ctx.run);
            return living.length ? pickFrom(living, rngFor(ctx, index, 'wounded')) : null;
          })();
    if (!unit) return { error: 'No one to wound.' };
    const uid = unitUidOf(unit);
    if (!uid) return { error: 'No one to wound.' };
    let stat = params.stat;
    if (stat === 'attack')
      stat = (Number(unit.stats?.MAG) || 0) > (Number(unit.stats?.STR) || 0) ? 'MAG' : 'STR';
    else if (stat === 'random') stat = pickFrom(WOUND_STATS, rngFor(ctx, index, 'wound-stat'));
    if (!WOUND_STATS.includes(stat)) return { error: `A wound cannot fall on "${params.stat}".` };
    delete params.scope;
    Object.assign(params, { unitUid: uid, unitName: unit.name, stat });
  }
  return { step: { type: 'burden', id: effect.id, params } };
}

function planLayToRest(ctx, effect, index, ledger) {
  const unit = ctx.fallenUnit;
  if (!unit) return { error: 'No one to lay to rest.' };
  const uid = unitUidOf(unit) || unit.name;
  if (ledger.rested.has(uid)) return { error: 'Already laid to rest.' };
  ledger.rested.add(uid);
  return { step: { type: 'layToRest', unit } };
}

function planConsume(ctx, effect, index, ledger) {
  const { run } = ctx;
  const name = effect.name;
  const count = Math.max(1, Math.trunc(Number(effect.uses) || 1));
  const picks = [];
  for (let i = 0; i < count; i++) {
    const holders = consumableHolders(run, name).filter(
      ({ item }) => usesLeft(item) - (ledger.consumed.get(item) || 0) > 0,
    );
    if (holders.length === 0) return { error: `You have no ${name} to spare.` };
    const ratio = (unit) =>
      (Number(unit.currentHP) || 0) / Math.max(1, Number(unit.stats?.HP) || 1);
    const bearers = holders.filter((h) => h.holder);
    const pool = bearers.length ? bearers : holders;
    let best = pool[0];
    for (const entry of pool.slice(1)) {
      if (!entry.holder || !best.holder) continue;
      if (
        ratio(entry.holder) > ratio(best.holder) ||
        (ratio(entry.holder) === ratio(best.holder) &&
          Number(entry.holder.currentHP) > Number(best.holder.currentHP))
      )
        best = entry;
    }
    ledger.consumed.set(best.item, (ledger.consumed.get(best.item) || 0) + 1);
    picks.push(best);
  }
  return { step: { type: 'consume', name, picks } };
}

function planStat(ctx, effect, index) {
  const { run } = ctx;
  let unit;
  if (effect.scope === 'lowestLevel') {
    const roster = livingUnits(run);
    unit = roster.reduce(
      (best, u) =>
        !best ||
        (Number(u.level) || 1) < (Number(best.level) || 1) ||
        ((Number(u.level) || 1) === (Number(best.level) || 1) &&
          (Number(u.xp) || 0) < (Number(best.xp) || 0))
          ? u
          : best,
      null,
    );
  } else unit = ctx.target;
  if (!unit) return { error: 'No one to strengthen.' };
  const stats = Array.isArray(effect.stat) ? effect.stat : [effect.stat];
  let stat;
  if (stats.length === 1 && stats[0] === 'best') {
    // The unit's own best: the highest of the seven, a tie settled by the seeded stream.
    const top = Math.max(...BEST_STAT_CHOICES.map((key) => Number(unit.stats?.[key]) || 0));
    const tied = BEST_STAT_CHOICES.filter((key) => (Number(unit.stats?.[key]) || 0) === top);
    stat = tied.length > 1 ? pickFrom(tied, rngFor(ctx, index, 'stat')) : tied[0];
  } else stat = stats.length > 1 ? pickFrom(stats, rngFor(ctx, index, 'stat')) : stats[0];
  // A loss never takes a stat below 0 (max HP: below 1).
  let value = Math.trunc(Number(effect.value) || 0);
  if (value < 0) {
    const floor = stat === 'HP' ? 1 : 0;
    value = Math.max(value, floor - (Number(unit.stats?.[stat]) || 0));
  }
  return { step: { type: 'stat', unit, stat, value } };
}

function planBattle(ctx, effect, index, ledger) {
  if (ctx.phase !== 'o') return { error: 'A battle cannot start another battle.' };
  if (ledger.battle) return { error: 'One battle per outcome.' };
  if (ctx.node?.type !== NODE_TYPES.EVENT) return { error: 'There is no event node here.' };
  // A green recruit in the fight (a recruit node's own unit, Talk and all): who, fixed now.
  let recruit = null;
  if (effect.recruit) {
    const self = pickJoinSelf(ctx, effect.recruit, index, ledger);
    if (self.error) return { error: self.error };
    ledger.joined.add(self.name);
    recruit = { className: self.className, name: self.name };
  }
  ledger.battle = true;
  return {
    step: {
      type: 'battle',
      enemyLevelBonus: Math.trunc(Number(effect.enemyLevelBonus) || 0),
      victoryText: typeof effect.victoryText === 'string' ? effect.victoryText : '',
      afterVictory: structuredClone(effect.afterVictory || []),
      elite: effect.elite === true,
      recruit,
    },
  };
}

// ── Weapon work: forge, wear, mend ──────────────────────────────────────

/** The unit's equipped weapon when it is really carried (the plan and the apply read this one). */
function carriedWeapon(unit) {
  const weapon = unit?.weapon;
  return weapon && (unit.inventory || []).includes(weapon) ? weapon : null;
}

function planForge(ctx, effect, index, ledger) {
  const unit = ctx.target;
  if (!unit) return { error: 'No one to work for.' };
  const weapon = carriedWeapon(unit);
  if (!weapon || !equippedForgeable(unit) || ledger.weapons.has(weapon))
    return { empty: true, reason: 'Their weapon cannot take more.' };
  const wanted = effect.stat === undefined || effect.stat === 'random' ? null : effect.stat;
  const stats = ['might', 'crit', 'hit', 'weight'].filter(
    (stat) => (wanted === null || stat === wanted) && canForgeStat(weapon, stat),
  );
  if (stats.length === 0) return { empty: true, reason: 'Their weapon cannot take more.' };
  ledger.weapons.add(weapon);
  return {
    step: { type: 'forge', unit, weapon, stat: pickFrom(stats, rngFor(ctx, index, 'forge')) },
  };
}

function planWear(ctx, effect, index, ledger) {
  const unit = ctx.target;
  if (!unit) return { error: 'No one to work for.' };
  const weapon = carriedWeapon(unit);
  const stats = weapon && !ledger.weapons.has(weapon) ? wearableStats(weapon) : [];
  if (stats.length === 0) return { empty: true, reason: 'Their weapon cannot wear.' };
  ledger.weapons.add(weapon);
  return {
    step: { type: 'wear', unit, weapon, stat: pickFrom(stats, rngFor(ctx, index, 'wear')) },
  };
}

function planMend(ctx, effect, index, ledger) {
  const unit = ctx.target;
  if (!unit) return { error: 'No one to work for.' };
  const weapons = (unit.inventory || []).filter((w) => isWorn(w) && !ledger.weapons.has(w));
  if (weapons.length === 0) return { empty: true, reason: 'Nothing they carry is worn.' };
  for (const weapon of weapons) ledger.weapons.add(weapon);
  return { step: { type: 'mend', unit, weapons } };
}

function applyForgeStep(ctx, step) {
  const from = step.weapon.name;
  const done = applyForge(step.weapon, step.stat);
  if (!done.success) throw new Error(`Forge "${step.stat}" did not take on ${from}.`);
  return [
    { kind: 'forge', unit: step.unit.name, weapon: from, name: step.weapon.name, stat: step.stat },
  ];
}

function applyWearStep(ctx, step) {
  const from = step.weapon.name;
  const done = applyWear(step.weapon, step.stat);
  if (!done.success) throw new Error(`Wear "${step.stat}" did not take on ${from}.`);
  return [
    { kind: 'wear', unit: step.unit.name, weapon: from, name: step.weapon.name, stat: step.stat },
  ];
}

function applyMendStep(ctx, step) {
  const weapons = [];
  let total = 0;
  for (const weapon of step.weapons) {
    const from = weapon.name;
    const steps = wearCount(weapon);
    while (isWorn(weapon)) if (!repairWeapon(weapon).success) break;
    if (isWorn(weapon)) throw new Error(`${from} could not be mended.`);
    total += steps;
    weapons.push({ from, to: weapon.name, steps });
  }
  return [{ kind: 'mend', unit: step.unit.name, steps: total, weapons }];
}

function planCounter(ctx, effect, index, ledger) {
  const key = effect.key;
  if (!ctx.event || !Object.hasOwn(ctx.event.counters || {}, key))
    return { error: `Unknown counter "${key}".` };
  const current = ledger.counters.has(key)
    ? ledger.counters.get(key)
    : counterValue(ctx.state, key);
  const requested = Math.trunc(Number(effect.delta) || 0);
  const value = Math.max(0, current + requested);
  ledger.counters.set(key, value);
  return { step: { type: 'counter', key, delta: value - current, value, requested } };
}

function planContract(ctx, effect, index, ledger) {
  if (ctx.phase === 'k') return { error: 'A contract cannot open another contract.' };
  if (ledger.contract || contractOf(ctx.run))
    return { error: 'You are already bound by a contract.' };
  const contract = normalizeContract({
    goal: effect.goal,
    reward: effect.reward,
    penalty: effect.penalty,
    eventId: ctx.event?.id,
    nodeId: ctx.nodeId,
    act: ctx.run.currentAct,
  });
  if (!contract) return { error: `Unknown contract goal "${effect.goal}".` };
  ledger.contract = true;
  return { step: { type: 'contract', contract } };
}

function planRoute(ctx, effect, index, ledger) {
  if (ledger.routeEdit) return { error: 'One change to the road at a time.' };
  if (ctx.node?.type !== NODE_TYPES.EVENT) return { error: 'There is no event node here.' };
  const planned = planRouteEdit(ctx.run, effect, ctx.nodeId, rngFor(ctx, index, 'route'));
  if (planned.step) ledger.routeEdit = true;
  return planned;
}

/**
 * Plan a list of effects without touching the run.
 * @param {object} ctx - { run, catalog, nodeId, node, choice, target, fallenUnit, phase }
 *   `phase`: 'c' choice-level, 'o' outcome, 'a' afterVictory (the seed label)
 * @param {object[]} effects
 * @param {{ ledger?: object, lenient?: boolean }} [options]
 * @returns {{ ok: true, steps: object[], ledger: object } | { ok: false, reason: string } | { ok: false, empty: true }}
 */
export function planEffects(
  ctx,
  effects,
  { ledger = createLedger(ctx.run), lenient = false } = {},
) {
  const steps = [];
  const list = Array.isArray(effects) ? effects : [];
  for (let index = 0; index < list.length; index++) {
    const effect = list[index];
    let planned;
    switch (effect?.type) {
      case 'gold':
        planned = planGold(ctx, effect, index, ledger);
        break;
      case 'item':
        planned = planItem(ctx, effect, index, ledger, lenient);
        break;
      case 'learnSkill':
        planned = planLearn(ctx, effect, index, ledger);
        break;
      case 'fallenSkill':
        planned = planFallenSkill(ctx, effect, index, ledger);
        break;
      case 'hp':
        planned = planHp(ctx, effect, index);
        break;
      case 'shadow':
        planned = { step: { type: 'shadow', value: Math.trunc(Number(effect.value) || 0) } };
        break;
      case 'vision':
        planned = { step: { type: 'vision', value: Math.trunc(Number(effect.value) || 0) } };
        break;
      case 'blessing':
        planned = planBlessing(ctx, effect, index, ledger, lenient);
        break;
      case 'burden':
        planned = planBurden(ctx, effect, index);
        break;
      case 'flag':
        planned = { step: { type: 'flag', key: effect.key, value: effect.value ?? true } };
        break;
      case 'layToRest':
        planned = planLayToRest(ctx, effect, index, ledger);
        break;
      case 'consume':
        planned = planConsume(ctx, effect, index, ledger);
        break;
      case 'stat':
        planned = planStat(ctx, effect, index);
        break;
      case 'battle':
        planned = planBattle(ctx, effect, index, ledger);
        break;
      case 'counter':
        planned = planCounter(ctx, effect, index, ledger);
        break;
      case 'join':
        planned = planJoin(ctx, effect, index, ledger);
        break;
      case 'contract':
        planned = planContract(ctx, effect, index, ledger);
        break;
      case 'routeEdit':
        planned = planRoute(ctx, effect, index, ledger);
        break;
      case 'forge':
        planned = planForge(ctx, effect, index, ledger);
        break;
      case 'wear':
        planned = planWear(ctx, effect, index, ledger);
        break;
      case 'mend':
        planned = planMend(ctx, effect, index, ledger);
        break;
      default:
        planned = { error: `Unknown effect "${effect?.type}".` };
    }
    if (planned.empty) {
      if (lenient) {
        steps.push(skipNote(effect.type, 'Nothing left to give.').step);
        continue;
      }
      return { ok: false, empty: true, reason: planned.reason || 'Nothing to learn.' };
    }
    if (planned.error) {
      if (lenient && ['item', 'blessing'].includes(effect.type)) {
        steps.push(skipNote(effect.type, planned.error).step);
        continue;
      }
      return {
        ok: false,
        reason: planned.error,
        ...(planned.itemKind ? { itemKind: planned.itemKind } : {}),
      };
    }
    steps.push(planned.step);
  }
  return { ok: true, steps, ledger };
}

// ── Room for the items a choice could grant ────────────────────────────

// An effect list reduced to its items: every other effect becomes a no-op placeholder, so
// each item keeps the index (and so the seeded pick) it has in the real plan.
const NOTHING = Object.freeze({ type: 'flag', key: '_room', value: true });
const itemsOnly = (effects) =>
  (Array.isArray(effects) ? effects : []).map((effect) =>
    effect?.type === 'item' ? effect : NOTHING,
  );
const spoilsOf = (effects) =>
  (Array.isArray(effects) ? effects : [])
    .filter((effect) => effect?.type === 'battle')
    .map((effect) => effect.afterVictory);

/**
 * Whether every item `choice` could grant can be delivered right now, for the chosen
 * target (`ctx.target`, null when the choice has none). It PLANS the choice's items with
 * the planner itself (`planItem`: its weapon pool, its destinations, a unit's bag and what
 * the unit can wield, the convoy's two compartments, the ledger of what earlier items of
 * the same path will already have used), so what it accepts is exactly what a commit would
 * deliver. Nothing is rolled and nothing depends on which outcome the hidden roll would
 * pick: EVERY path a choice can take must deliver, a path being the choice's own effects,
 * then one outcome's effects (or its fallback), then that outcome's afterVictory.
 *
 * afterVictory is planned strictly here although the spoils themselves are planned
 * leniently after the fight (an item with no room is skipped with a note, because the bags
 * may fill on the loot screen): the player is stopped before committing to a fight whose
 * item would have nowhere to go, as the spec says (§5, "Room for items").
 * @param {object} ctx - { run, catalog, nodeId, node, event, choice, state, target, fallenUnit }
 * @returns {{ ok: true } | { ok: false, reason: string, itemKind?: 'weapon'|'consumable' }}
 */
export function planChoiceItems(ctx, choice) {
  const outcomes = Array.isArray(choice?.outcomes) ? choice.outcomes : [];
  const paths = outcomes.length
    ? outcomes.flatMap((outcome) => [
        outcome.effects,
        ...(Array.isArray(outcome.fallback) ? [outcome.fallback] : []),
      ])
    : [[]];
  for (const effects of paths) {
    const ledger = createLedger(ctx.run);
    const stages = [
      ['c', choice.effects],
      ['o', effects],
      ...spoilsOf(effects).map((spoils) => ['a', spoils]),
    ];
    for (const [phase, list] of stages) {
      const plan = planEffects({ ...ctx, choice, phase }, itemsOnly(list), { ledger });
      if (!plan.ok) return plan;
    }
  }
  return { ok: true };
}

// ── Apply ───────────────────────────────────────────────────────────────

const pct = (unit, percent) =>
  Math.max(1, Math.round(((Number(unit.stats?.HP) || 0) * percent) / 100));

function applyHp(ctx, step) {
  const units = [];
  let total = 0;
  for (const unit of step.units) {
    const max = Number(unit.stats?.HP) || 0;
    let amount;
    if (step.mode === 'heal') {
      const want = step.value ?? (step.percent != null ? pct(unit, step.percent) : max);
      amount = healUnit(unit, want);
    } else if (step.to != null) {
      amount = damageUnit(unit, Math.max(0, (Number(unit.currentHP) || 0) - step.to), { floor: 1 });
    } else {
      const want = step.value ?? (step.percent != null ? pct(unit, step.percent) : 0);
      amount = damageUnit(unit, want, { floor: 1 });
    }
    if (amount > 0) units.push({ name: unit.name, amount });
    total += amount;
  }
  return [
    { kind: 'hp', mode: step.mode, scope: step.scope, units, total, targeted: step.units.length },
  ];
}

function applyShadow(ctx, step) {
  const { run } = ctx;
  if (!run.isEclipseActive?.() || step.value === 0)
    return [{ kind: 'shadow', value: 0, actValue: 0, requested: step.value, fell: [] }];
  const before = run.eclipse.shadow;
  const actBefore = actShadowOf(run.eclipse);
  const commit = commitShadow(
    run.eclipse,
    step.value > 0 ? { gain: step.value } : { relief: -step.value },
    run.getEclipseConfig(),
  );
  run.eclipse = commit.state;
  // The dark takes what it now can (the event node itself is current, so never fallen). A
  // contract's terms settle inside the victory commit (phase 'k'), which applies the falls
  // itself right after the node is complete, so its victory band lists them: not here.
  const fell = ctx.phase === 'k' ? [] : run.applyEclipseNow().map((node) => node.id);
  return [
    {
      kind: 'shadow',
      value: commit.after - before,
      actValue: commit.actAfter - actBefore,
      requested: step.value,
      fell,
    },
  ];
}

function applySkill(ctx, step) {
  const result = learnSkill(step.unit, step.skillId);
  if (!result.learned && !result.benched)
    throw new Error(`Event skill "${step.skillId}" was not learned (${result.reason}).`);
  const record = {
    kind: 'skill',
    unit: step.unit.name,
    skillId: step.skillId,
    benched: result.benched === true,
  };
  if (step.from) record.from = step.from;
  return [record];
}

function applyItem(ctx, step) {
  const dest = step.dest;
  if (dest === 'pool') {
    // An accessory goes to the army's accessory pool (the loot screen's "Added to Accessory Pool").
    const { run } = ctx;
    if (!Array.isArray(run.accessories)) run.accessories = [];
    run.accessories.push(ensureItemUid(structuredClone(step.item)));
    return [
      {
        kind: 'item',
        name: step.item.name,
        tier: null,
        itemType: 'Accessory',
        unit: null,
        toConvoy: false,
        pooled: true,
        worn: [],
      },
    ];
  }
  const result = applyRewardTarget(ctx.run, step.item, dest);
  if (!result.ok) throw new Error(`Event item "${step.item.name}" was not delivered.`);
  return [
    {
      kind: 'item',
      name: step.item.name,
      tier: step.item.tier || null,
      itemType: step.item.type || null,
      unit: dest === 'convoy' ? null : dest.name,
      toConvoy: dest === 'convoy',
      worn: step.worn,
    },
  ];
}

function applyBattle(ctx, step) {
  const { run, node } = ctx;
  const type = node.type;
  withEclipseSeed(`event-battle:${runSeedOf(run)}:${ctx.nodeId}`, () =>
    convertNodeToRoutBattle(
      node,
      run.nodeMap?.actId || run.currentAct,
      run.gameData?.mapTemplates,
      {
        fogChanceBonus: run.getDifficultyModifier?.('fogChanceBonus', 0) || 0,
        halfFogChance: run.difficultyId === 'normal',
        extraParams: {
          isEventBattle: true,
          eventEnemyLevelBonus: step.enemyLevelBonus,
          ...(step.elite ? { isElite: true } : {}),
          ...(step.recruit ? { isRecruitBattle: true } : {}),
        },
      },
    ),
  );
  // The node stays an event node; only its battle params and the marker change.
  node.type = type;
  node.eventBattle = true;
  // A recruit in the fight is a recruit node's own unit: the preview is what the map generator
  // seats and the scene builds (RecruitNodeSystem.isRecruitBattleNode).
  if (step.recruit)
    node.recruitPreview = {
      v: RECRUIT_PREVIEW_VERSION,
      className: step.recruit.className,
      name: step.recruit.name,
    };
  return [
    {
      kind: 'battle',
      enemyLevelBonus: step.enemyLevelBonus,
      ...(step.elite ? { elite: true } : {}),
      ...(step.recruit ? { recruit: { ...step.recruit } } : {}),
    },
  ];
}

/** Apply one planned step to the run; returns the result records (0 or more). */
export function applyStep(ctx, step) {
  const { run } = ctx;
  switch (step.type) {
    case 'gold':
      if (step.value !== 0) run.addGold(step.value);
      return [{ kind: 'gold', value: step.value, requested: step.requested }];
    case 'item':
      return applyItem(ctx, step);
    case 'skill':
      return applySkill(ctx, step);
    case 'hp':
      return applyHp(ctx, step);
    case 'shadow':
      return applyShadow(ctx, step);
    case 'vision': {
      const before = Math.max(0, Math.trunc(Number(run.visionChargesRemaining) || 0));
      run.visionChargesRemaining = Math.max(0, before + step.value);
      return [{ kind: 'vision', value: run.visionChargesRemaining - before }];
    }
    case 'blessing': {
      if (!run.addBlessingMidRun(step.blessing.id))
        throw new Error(`Blessing "${step.blessing.id}" could not be taken.`);
      return [
        {
          kind: 'blessing',
          id: step.blessing.id,
          name: step.blessing.name,
          description: step.blessing.description,
          tier: step.blessing.tier,
        },
      ];
    }
    case 'burden': {
      const added = addBurden(run, step.id, step.params, ctx.catalog);
      if (!added.ok) throw new Error(added.reason);
      const def = burdenDefFor(ctx.catalog, step.id, run.difficultyId) || {};
      const b = added.burden;
      // A record's `detail` is the burden as it now stands (the run may already have held one).
      const words = describeBurden(b, { def, roster: run.roster });
      return [
        {
          kind: 'burden',
          id: step.id,
          label: def.label || step.id,
          line: def.line || '',
          detail:
            step.id === 'ill_omen'
              ? `${b.battles} battles, +${b.extraShadow} shadow each`
              : step.id === 'debt'
                ? `${b.owed} G owed`
                : words.detail,
        },
      ];
    }
    case 'flag':
      // { value, act }: the act the flag was set in, for payoffs that need "an earlier act".
      run.storyFlags = withFlag(run.storyFlags, step.key, step.value, run.currentAct);
      return [{ kind: 'flag', key: step.key, value: step.value }];
    case 'layToRest': {
      // Anything the convoy could not take stays with them; send what fits to the convoy first.
      run._transferFallenUnitItems?.(step.unit);
      const index = run.fallenUnits.indexOf(step.unit);
      if (index < 0) throw new Error('The fallen ally is no longer awaiting revival.');
      run.fallenUnits.splice(index, 1);
      step.unit.laidToRest = { act: run.currentAct || null, node: ctx.nodeId || null };
      run.laidToRest = [...(run.laidToRest || []), step.unit];
      return [{ kind: 'layToRest', name: step.unit.name }];
    }
    case 'consume': {
      const holders = [];
      for (const pick of step.picks) {
        spendConsumableUse(run, pick.holder, pick.item);
        holders.push(pick.holder?.name || 'convoy');
      }
      return [{ kind: 'consume', name: step.name, uses: step.picks.length, holder: holders[0] }];
    }
    case 'stat':
      applyStatBoost(step.unit, { stat: step.stat, value: step.value });
      if (step.stat === 'HP')
        // A lost point of max HP never leaves the unit above its new max or at 0.
        step.unit.currentHP = Math.max(
          1,
          Math.min(Number(step.unit.stats.HP) || 1, Number(step.unit.currentHP) || 1),
        );
      return [{ kind: 'stat', unit: step.unit.name, stat: step.stat, value: step.value }];
    case 'forge':
      return applyForgeStep(ctx, step);
    case 'wear':
      return applyWearStep(ctx, step);
    case 'mend':
      return applyMendStep(ctx, step);
    case 'battle':
      return applyBattle(ctx, step);
    case 'counter':
      ctx.state.counters = { ...(ctx.state.counters || {}), [step.key]: step.value };
      return [
        {
          kind: 'counter',
          key: step.key,
          label: counterLabel(ctx.event, step.key),
          delta: step.delta,
          value: step.value,
        },
      ];
    case 'join':
      return applyJoin(ctx, step);
    case 'contract': {
      run.contract = step.contract;
      return [{ kind: 'contract', ...describeContract(run) }];
    }
    case 'routeEdit':
      return [
        applyRouteEdit(
          run,
          step,
          `event-route:${runSeedOf(run)}:${ctx.nodeId}:${pagePart(ctx)}${ctx.choice?.id}`,
        ),
      ];
    case 'note':
      return [step.note];
    default:
      throw new Error(`Unknown step "${step.type}".`);
  }
}

/** Apply every planned step in order; returns the flat list of result records. */
export function applyPlan(ctx, steps) {
  const results = [];
  for (const step of steps) results.push(...applyStep(ctx, step));
  return results;
}

// ── Rolling back ────────────────────────────────────────────────────────

/**
 * The run fields an event's effects can change. A command snapshots them before it applies a
 * plan and puts them back if applying throws (the plan is built to make that unreachable).
 */
export const RUN_FIELDS = Object.freeze([
  'roster',
  'fallenUnits',
  'laidToRest',
  'convoy',
  'gold',
  'eclipse',
  'visionChargesRemaining',
  'activeBlessings',
  'blessingHistory',
  'blessingRuntimeModifiers',
  'storyFlags',
  'burdens',
  'accessories',
  'nodeMap',
  'currentNodeId',
  'contract',
  'usedRecruitNames',
  'nextUnitUid',
]);

/** A deep copy of the fields in RUN_FIELDS. */
export function snapshotRunState(run) {
  return structuredClone(Object.fromEntries(RUN_FIELDS.map((key) => [key, run[key]])));
}

/** Put a snapshotRunState copy back. */
export function restoreRunState(run, snapshot) {
  for (const key of RUN_FIELDS) run[key] = snapshot[key];
}
