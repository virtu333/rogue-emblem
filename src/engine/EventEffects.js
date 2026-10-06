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
//   gold        { value }                       gold ± (a loss floors at 0)
//                                                 -> { kind:'gold', value, requested }
//   item        { name | pool, to, wear }       a weapon (or named consumable) delivered
//                                                 -> { kind:'item', name, unit|null, toConvoy, worn:[stat] }
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
//   stat        { stat, value, scope }          a permanent boost (the stat booster's path)
//                                                 -> { kind:'stat', unit, stat, value }
//   battle      { enemyLevelBonus, afterVictory, victoryText }  EventCommands builds the fight
//                                                 -> { kind:'battle', enemyLevelBonus }
//
// An outcome's `fallback` effects replace its `effects` when a learnSkill/fallenSkill has
// nothing left to teach. In `lenient` mode (the spoils after a won battle) an effect that
// cannot be delivered (no room, no blessing left) is skipped with a note rather than
// failing: a won battle never loses its reward to a failed plan.

import { applyRewardTarget } from './LootRewardCommands.js';
import { spendConsumableUse } from './RosterInventory.js';
import { canEquip, learnSkill, applyStatBoost, knowsSkill } from './UnitManager.js';
import { healUnit, damageUnit } from './UnitHealth.js';
import { applyWear, wearableStats } from './WeaponWear.js';
import { commitShadow, actShadowOf, withEclipseSeed } from './EclipseSystem.js';
import { convertNodeToRoutBattle } from './NodeMapGenerator.js';
import { addBurden, burdenDefFor } from './Burdens.js';
import { CONSUMABLE_MAX, INVENTORY_MAX, NODE_TYPES } from '../utils/constants.js';
import { unitUidOf } from './UnitIdentity.js';
import {
  availableEventBlessings,
  bestWeaponType,
  byRungValue,
  consumableHolders,
  eventRng,
  isTeachableSkill,
  learnableFromFallen,
  livingUnits,
  resolveAmount,
  runSeedOf,
  unitWields,
  usesLeft,
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
]);

/** Effect types that must name a chosen unit (`to: 'target'` / `scope: 'target'`). */
export const TARGETED_EFFECT_TYPES = Object.freeze(['learnSkill', 'fallenSkill']);

/** Weapon types and tiers an event's weapon pools draw from. */
export const EVENT_WEAPON_TYPES = Object.freeze(['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light']);
export const EVENT_WEAPON_TIERS = Object.freeze(['Iron', 'Steel', 'Silver']);
const ACT_BASELINE_TIER = Object.freeze({ act1: 0, act2: 1, act3: 2, act4: 2 });

const rngFor = (ctx, index, label) =>
  eventRng(
    `event:${runSeedOf(ctx.run)}:${ctx.nodeId}:${ctx.choice?.id || 'choice'}:${ctx.phase}${index}:${label}`,
  );

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
  const requested = resolveAmount(effect.value, ctx.run.currentAct);
  const value = requested < 0 ? -Math.min(-requested, Math.max(0, ledger.gold)) : requested;
  ledger.gold += value;
  return { step: { type: 'gold', value, requested } };
}

function planItem(ctx, effect, index, ledger, lenient) {
  const { run } = ctx;
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

function planBurden(ctx, effect) {
  const def = burdenDefFor(ctx.catalog, effect.id, ctx.run.difficultyId);
  if (!def) return { error: `Unknown burden "${effect.id}".` };
  const params = { ...(effect.params || {}) };
  if (params.owed !== undefined) params.owed = resolveAmount(params.owed, ctx.run.currentAct);
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
  const stat = stats.length > 1 ? pickFrom(stats, rngFor(ctx, index, 'stat')) : stats[0];
  return { step: { type: 'stat', unit, stat, value: Math.trunc(Number(effect.value) || 0) } };
}

function planBattle(ctx, effect, index, ledger) {
  if (ctx.phase !== 'o') return { error: 'A battle cannot start another battle.' };
  if (ledger.battle) return { error: 'One battle per outcome.' };
  if (ctx.node?.type !== NODE_TYPES.EVENT) return { error: 'There is no event node here.' };
  ledger.battle = true;
  return {
    step: {
      type: 'battle',
      enemyLevelBonus: Math.trunc(Number(effect.enemyLevelBonus) || 0),
      victoryText: typeof effect.victoryText === 'string' ? effect.victoryText : '',
      afterVictory: structuredClone(effect.afterVictory || []),
    },
  };
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
        planned = planBurden(ctx, effect);
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
      default:
        planned = { error: `Unknown effect "${effect?.type}".` };
    }
    if (planned.empty) {
      if (lenient) {
        steps.push(skipNote(effect.type, 'Nothing left to give.').step);
        continue;
      }
      return { ok: false, empty: true, reason: 'Nothing to learn.' };
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
  // The dark takes what it now can (the event node itself is current, so never fallen).
  const fell = run.applyEclipseNow().map((node) => node.id);
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
        },
      },
    ),
  );
  // The node stays an event node; only its battle params and the marker change.
  node.type = type;
  node.eventBattle = true;
  return [{ kind: 'battle', enemyLevelBonus: step.enemyLevelBonus }];
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
      return [
        {
          kind: 'burden',
          id: step.id,
          label: def.label || step.id,
          line: def.line || '',
          detail:
            step.id === 'ill_omen'
              ? `${b.battles} battles, +${b.extraShadow} shadow each`
              : `${b.owed} G owed`,
        },
      ];
    }
    case 'flag':
      run.storyFlags = { ...(run.storyFlags || {}), [step.key]: step.value };
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
      return [{ kind: 'stat', unit: step.unit.name, stat: step.stat, value: step.value }];
    case 'battle':
      return applyBattle(ctx, step);
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
