// ItemTrade.js — Fire Emblem-style item trading (pure; no Phaser).
//
// A trade moves one held item from a slot on one holder to a slot on another:
// into an empty slot it is a **give** (append), onto an item it is a **swap**
// (each item takes the slot the other left, so it works with both bags full).
// Holders are player units or, between battles, the convoy. Spec:
// docs/specs/item-trade.md ("Engine").
//
//   ctx:    { context: 'battle' | 'roster', run?: RunManager }
//   holder: unitHolder(unit) | CONVOY_HOLDER
//   slot:   { holder, bag: 'inventory' | 'consumables' | 'accessory', item: object | null }
//
// planTrade validates (first failure wins; the reason is the UI string) and
// never mutates. applyTrade re-plans, then performs only writes that cannot
// fail. Items move as the same instance: uid, _usesSpent, _imbueId, forge
// fields and weapon arts travel with the item.

import {
  canEquip,
  getCombatWeapons,
  normalizeEquippedFirst,
  equipAccessory,
  unequipAccessory,
} from './UnitManager.js';
import { ensureItemUid } from '../utils/itemUid.js';
import { INVENTORY_MAX, CONSUMABLE_MAX, CONVOY_WEAPON_TYPES } from '../utils/constants.js';

export const TRADE_REASONS = Object.freeze({
  invalid: 'Invalid trade.',
  convoyInBattle: 'The convoy is available between battles.',
  accessoryInBattle: 'Accessories can be traded between battles.',
  notInRoster: 'Unit is no longer in the roster.',
  sameHolder: 'Choose another unit.',
  differentBags: 'Items trade only within the same bag.',
  stale: 'Item is no longer available.',
  accessoryUnitsOnly: 'Accessories trade only between units.',
  convoyCannotStore: 'The convoy cannot store this item.',
  bagFull: 'Bag full.',
  convoyFull: 'Convoy is full.',
});

export const TRADE_WARNINGS = Object.freeze({
  cannotEquip: 'cannot_equip',
  leavesUnarmed: 'leaves_unarmed',
});

const BAGS = new Set(['inventory', 'consumables', 'accessory']);
const UNIT_BAG_CAPACITY = { inventory: INVENTORY_MAX, consumables: CONSUMABLE_MAX, accessory: 1 };
const NOT_WEAPONS = new Set(['Consumable', 'Scroll', 'Accessory']);

/** The convoy as a trade holder (between battles only). */
export const CONVOY_HOLDER = Object.freeze({ kind: 'convoy' });

/** A unit as a trade holder. */
export function unitHolder(unit) {
  return { kind: 'unit', unit };
}

function isUnitHolder(holder) {
  return holder?.kind === 'unit' && !!holder.unit && typeof holder.unit === 'object';
}

function isConvoyHolder(holder) {
  return holder?.kind === 'convoy';
}

function isSlot(slot) {
  return (
    !!slot &&
    typeof slot === 'object' &&
    (isUnitHolder(slot.holder) || isConvoyHolder(slot.holder)) &&
    BAGS.has(slot.bag)
  );
}

function sameHolder(a, b) {
  if (isConvoyHolder(a) && isConvoyHolder(b)) return true;
  return isUnitHolder(a) && isUnitHolder(b) && a.unit === b.unit;
}

/** Proficiency view of a unit over a (possibly hypothetical) inventory. */
function equipView(unit, inventory) {
  return {
    proficiencies: Array.isArray(unit?.proficiencies) ? unit.proficiencies : [],
    inventory: Array.isArray(inventory) ? inventory : [],
  };
}

function canUnitEquip(unit, item) {
  return !!item && typeof item === 'object' && canEquip(equipView(unit), item);
}

function hasCombatWeapon(unit, inventory) {
  return getCombatWeapons(equipView(unit, inventory)).length > 0;
}

/** The live array backing a unit or convoy bag (accessory has none). */
function liveList(ctx, holder, bag, create = false) {
  if (bag === 'accessory') return null;
  if (isUnitHolder(holder)) {
    const unit = holder.unit;
    if (!Array.isArray(unit[bag])) {
      if (!create) return null;
      unit[bag] = [];
    }
    return unit[bag];
  }
  if (isConvoyHolder(holder)) {
    const convoy = ctx?.run?.convoy;
    const key = bag === 'inventory' ? 'weapons' : 'consumables';
    return Array.isArray(convoy?.[key]) ? convoy[key] : null;
  }
  return null;
}

/**
 * Items in a holder's bag, in slot order (a new array; items are the live
 * instances). The convoy has no accessory bag. Never mutates.
 */
export function bagItems(ctx, holder, bag) {
  if (!BAGS.has(bag)) return [];
  if (bag === 'accessory') {
    return isUnitHolder(holder) && holder.unit.accessory ? [holder.unit.accessory] : [];
  }
  const list = liveList(ctx, holder, bag);
  return list ? [...list] : [];
}

/** Slot count of a bag: units 5 / 3 / 1; the convoy from run.getConvoyCapacities(). */
export function bagCapacity(ctx, holder, bag) {
  if (!BAGS.has(bag)) return 0;
  if (isUnitHolder(holder)) return UNIT_BAG_CAPACITY[bag];
  if (isConvoyHolder(holder)) {
    if (bag === 'accessory') return 0;
    const caps = ctx?.run?.getConvoyCapacities?.();
    const cap = bag === 'inventory' ? caps?.weapons : caps?.consumables;
    return Number.isFinite(cap) ? cap : 0;
  }
  return 0;
}

/**
 * Index of `item` in a holder's bag, or -1. Unit bags match by identity; the
 * convoy by identity, then by uid (getConvoyItems hands out clones).
 */
function indexInBag(ctx, holder, bag, item) {
  if (!item || typeof item !== 'object') return -1;
  if (bag === 'accessory') {
    return isUnitHolder(holder) && holder.unit.accessory === item ? 0 : -1;
  }
  const list = liveList(ctx, holder, bag);
  if (!list) return -1;
  const exact = list.indexOf(item);
  if (exact !== -1 || !isConvoyHolder(holder)) return exact;
  const uid = typeof item.uid === 'string' ? item.uid : '';
  return uid ? list.findIndex((candidate) => candidate?.uid === uid) : -1;
}

function itemAt(ctx, holder, bag, index) {
  if (bag === 'accessory') return holder.unit.accessory;
  return liveList(ctx, holder, bag)[index];
}

/** Type sanity: '' when `item` may sit in `holder`'s `bag`, else the reason. */
function typeBlock(holder, bag, item) {
  const type = item?.type;
  if (bag === 'consumables') return type === 'Consumable' ? '' : TRADE_REASONS.differentBags;
  if (bag === 'accessory') return type === 'Accessory' ? '' : TRADE_REASONS.differentBags;
  if (NOT_WEAPONS.has(type) || typeof type !== 'string') return TRADE_REASONS.differentBags;
  if (isConvoyHolder(holder) && !CONVOY_WEAPON_TYPES.has(type))
    return TRADE_REASONS.convoyCannotStore;
  return '';
}

function isPlayerUnit(unit) {
  return (unit.faction ?? 'player') === 'player';
}

function resolveTrade(ctx, from, to) {
  const fail = (reason) => ({ ok: false, reason });
  if (!ctx || (ctx.context !== 'battle' && ctx.context !== 'roster'))
    return fail(TRADE_REASONS.invalid);
  if (!isSlot(from) || !isSlot(to)) return fail(TRADE_REASONS.invalid);
  const holders = [from.holder, to.holder];

  // 1. Battle: player units only; no convoy, no accessories.
  if (ctx.context === 'battle') {
    if (holders.some(isConvoyHolder)) return fail(TRADE_REASONS.convoyInBattle);
    if (from.bag === 'accessory' || to.bag === 'accessory')
      return fail(TRADE_REASONS.accessoryInBattle);
    if (holders.some((h) => !isPlayerUnit(h.unit))) return fail(TRADE_REASONS.sameHolder);
  }
  // 2. Roster: every unit is still on the roster (membership, never array identity).
  if (ctx.context === 'roster') {
    const roster = ctx.run?.roster;
    for (const holder of holders) {
      if (isUnitHolder(holder) && !(Array.isArray(roster) && roster.includes(holder.unit)))
        return fail(TRADE_REASONS.notInRoster);
    }
  }
  // 3. Same holder.
  if (sameHolder(from.holder, to.holder)) return fail(TRADE_REASONS.sameHolder);
  // 4. Same bag: weapons never exchange with supplies or accessories.
  if (from.bag !== to.bag) return fail(TRADE_REASONS.differentBags);
  const bag = from.bag;
  // 5. Stale items.
  const fromIndex = indexInBag(ctx, from.holder, bag, from.item);
  if (fromIndex < 0) return fail(TRADE_REASONS.stale);
  let toIndex = -1;
  if (to.item != null) {
    toIndex = indexInBag(ctx, to.holder, bag, to.item);
    if (toIndex < 0) return fail(TRADE_REASONS.stale);
  }
  const fromItem = itemAt(ctx, from.holder, bag, fromIndex);
  const toItem = toIndex >= 0 ? itemAt(ctx, to.holder, bag, toIndex) : null;
  // 6. Type sanity (the convoy holds no accessories).
  if (bag === 'accessory' && holders.some(isConvoyHolder))
    return fail(TRADE_REASONS.accessoryUnitsOnly);
  const typeReason =
    typeBlock(to.holder, bag, fromItem) || (toItem ? typeBlock(from.holder, bag, toItem) : '');
  if (typeReason) return fail(typeReason);
  // 7. Capacity: a give needs room; a swap never does.
  if (!toItem) {
    if (isUnitHolder(to.holder)) {
      if (bagItems(ctx, to.holder, bag).length >= bagCapacity(ctx, to.holder, bag))
        return fail(TRADE_REASONS.bagFull);
    } else if (!ctx.run?.canAddToConvoy?.(fromItem)) {
      return fail(TRADE_REASONS.convoyFull);
    }
  }

  // 8. Warnings (never block): a weapon its receiver can't wield, and a unit left
  // with no combat weapon (either side, the convoy included).
  const warnings = [];
  if (bag === 'inventory') {
    const fromList = liveList(ctx, from.holder, bag) || [];
    const toList = liveList(ctx, to.holder, bag) || [];
    const fromAfter = toItem
      ? fromList.map((item, index) => (index === fromIndex ? toItem : item))
      : fromList.filter((_, index) => index !== fromIndex);
    const toAfter = toItem
      ? toList.map((item, index) => (index === toIndex ? fromItem : item))
      : [...toList, fromItem];
    const sides = [
      { holder: from.holder, before: fromList, after: fromAfter },
      { holder: to.holder, before: toList, after: toAfter },
    ];
    const unarmed = [];
    for (const side of sides) {
      if (!isUnitHolder(side.holder)) continue;
      const unit = side.holder.unit;
      if (hasCombatWeapon(unit, side.before) && !hasCombatWeapon(unit, side.after))
        unarmed.push(unit);
    }
    if (isUnitHolder(to.holder) && !canUnitEquip(to.holder.unit, fromItem))
      warnings.push({ code: TRADE_WARNINGS.cannotEquip, unit: to.holder.unit, item: fromItem });
    if (toItem && isUnitHolder(from.holder) && !canUnitEquip(from.holder.unit, toItem))
      warnings.push({ code: TRADE_WARNINGS.cannotEquip, unit: from.holder.unit, item: toItem });
    for (const unit of unarmed) warnings.push({ code: TRADE_WARNINGS.leavesUnarmed, unit });
  }

  return {
    ok: true,
    kind: toItem ? 'swap' : 'give',
    warnings,
    detail: toItem ? `${fromItem.name} for ${toItem.name}` : fromItem.name,
    resolved: { bag, fromIndex, toIndex, fromItem, toItem },
  };
}

function publicResult(result) {
  if (!result.ok) return { ok: false, reason: result.reason };
  const { ok, kind, warnings, detail } = result;
  return { ok, kind, warnings, detail };
}

/**
 * Validate a trade without mutating anything.
 * @returns {{ok: true, kind: 'give'|'swap', warnings: {code: string, unit: object}[], detail: string}
 *          | {ok: false, reason: string}}
 * Warnings list `cannot_equip` (the receiver of from.item, then the receiver of
 * to.item) before `leaves_unarmed` (from's unit, then to's unit).
 */
export function planTrade(ctx, from, to) {
  return publicResult(resolveTrade(ctx, from, to));
}

/** Plan, then perform the trade. Same result shape as planTrade. */
export function applyTrade(ctx, from, to) {
  const plan = resolveTrade(ctx, from, to);
  if (!plan.ok) return publicResult(plan);
  const { bag, fromIndex, toIndex, fromItem, toItem } = plan.resolved;
  ensureItemUid(fromItem);
  if (toItem) ensureItemUid(toItem);

  if (bag === 'accessory') {
    // Roster only (rule 1). Unequip both first, then equip crosswise, so each
    // unit's stats, HP and move type reverse before the other item applies.
    const giver = from.holder.unit;
    const receiver = to.holder.unit;
    unequipAccessory(giver);
    if (toItem) unequipAccessory(receiver);
    if (toItem) equipAccessory(giver, toItem);
    equipAccessory(receiver, fromItem);
    return publicResult(plan);
  }

  const src = liveList(ctx, from.holder, bag, true);
  const dst = liveList(ctx, to.holder, bag, true);
  if (toItem) {
    src[fromIndex] = toItem;
    dst[toIndex] = fromItem;
  } else {
    src.splice(fromIndex, 1);
    dst.push(fromItem);
  }
  if (bag === 'inventory') {
    if (isUnitHolder(from.holder)) settleEquipped(from.holder.unit, toItem);
    if (isUnitHolder(to.holder)) settleEquipped(to.holder.unit, fromItem);
  }
  return publicResult(plan);
}

/** True when two distinct units could trade: either carries a weapon or a supply. */
export function canTradeBetween(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || a === b) return false;
  const carries = (unit) =>
    (Array.isArray(unit.inventory) && unit.inventory.length > 0) ||
    (Array.isArray(unit.consumables) && unit.consumables.length > 0);
  return carries(a) || carries(b);
}

/**
 * Re-point `unit.weapon` after its inventory changed:
 *   1. keep the equipped weapon if still carried and equippable;
 *   2. else `preferred` (the incoming item) if it is a combat weapon the unit can equip;
 *   3. else the first combat weapon;
 *   4. else the first staff the unit can equip (staff-only classes);
 *   5. else null.
 * Then moves the equipped weapon to slot 0. Returns the equipped weapon.
 */
export function settleEquipped(unit, preferred = null) {
  if (!unit || typeof unit !== 'object') return null;
  const inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
  const view = equipView(unit, inventory);
  let next = null;
  if (unit.weapon && inventory.includes(unit.weapon) && canUnitEquip(unit, unit.weapon)) {
    next = unit.weapon;
  } else {
    const combat = getCombatWeapons(view);
    if (preferred && combat.includes(preferred)) next = preferred;
    else if (combat.length > 0) next = combat[0];
    else next = inventory.find((w) => w?.type === 'Staff' && canUnitEquip(unit, w)) || null;
  }
  unit.weapon = next;
  normalizeEquippedFirst(unit);
  return next;
}
