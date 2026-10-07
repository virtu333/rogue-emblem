// Who a roster unit can trade with, and what each partner row says
// (docs/specs/item-trade.md, "Roster"). Pure: no DOM. The picker blocks nobody;
// the trade menu's rows say why a slot is closed, so these lines only inform.

import {
  CONVOY_HOLDER,
  TRADE_REASONS,
  bagCapacity,
  bagItems,
  unitHolder,
} from '../engine/ItemTrade.js';
import { canEquip } from '../engine/UnitManager.js';
import { getStaticCombatStats } from '../engine/Combat.js';
import { CONVOY_WEAPON_TYPES } from '../utils/constants.js';
import { rankRequirementText } from './rosterDisplay.js';
import { itemDisplayName } from '../utils/itemNames.js';

/** The trade bag an item lives in: accessory, supplies or weapons. */
export function tradeBagFor(item) {
  if (item?.type === 'Accessory') return 'accessory';
  if (item?.type === 'Consumable') return 'consumables';
  return 'inventory';
}

export const isConvoyChoice = (choice) => choice?.kind === 'convoy';

/** A partner choice as a trade holder (units are wrapped; the convoy passes through). */
export function partnerHolder(choice) {
  return isConvoyChoice(choice) ? CONVOY_HOLDER : unitHolder(choice);
}

export function partnerLabel(choice) {
  return isConvoyChoice(choice) ? 'Convoy' : choice?.name || 'Unit';
}

/**
 * Trade partners for `source`: every other unit, then the convoy. An accessory
 * trades only between units, so its list has no convoy.
 */
export function rosterTradePartners(units, source, bag = null) {
  const others = (Array.isArray(units) ? units : []).filter((unit) => unit && unit !== source);
  return bag === 'accessory' ? others : [...others, CONVOY_HOLDER];
}

const UNIT_BAG_WORD = { inventory: 'Items', consumables: 'Supplies' };
const CONVOY_BAG_WORD = { inventory: 'Weapons', consumables: 'Supplies' };

/**
 * "Items 2/5", or "Items 5/5 · full: pick an item to trade" when a give has no
 * room (a swap still works). The convoy counts "Weapons" and "Supplies".
 */
export function bagFillText(ctx, holder, bag, { fullHint = true } = {}) {
  const count = bagItems(ctx, holder, bag).length;
  const capacity = bagCapacity(ctx, holder, bag);
  const word = (isConvoyChoice(holder) ? CONVOY_BAG_WORD : UNIT_BAG_WORD)[bag] || 'Items';
  const full = fullHint && count >= capacity ? ' · full: pick an item to trade' : '';
  return `${word} ${count}/${capacity}${full}`;
}

function equipText(unit, item) {
  if (!canEquip(unit, item)) return rankRequirementText(item.type, item.rankRequired);
  if (item.type === 'Staff') return 'Can equip';
  const now = getStaticCombatStats(unit, unit.weapon).as;
  const then = getStaticCombatStats(unit, item).as;
  return `Can equip · AS ${now} → ${then} if equipped`;
}

/** The line under a partner when an item is being traded (Trade… on an item card). */
export function tradePartnerItemText(ctx, partner, item) {
  const bag = tradeBagFor(item);
  if (isConvoyChoice(partner)) {
    if (bag === 'inventory' && !CONVOY_WEAPON_TYPES.has(item?.type))
      return TRADE_REASONS.convoyCannotStore;
    return bagFillText(ctx, CONVOY_HOLDER, bag);
  }
  if (bag === 'accessory')
    return partner.accessory ? `Wears ${itemDisplayName(partner.accessory)}` : 'No accessory';
  const fill = bagFillText(ctx, unitHolder(partner), bag);
  return bag === 'inventory' ? `${fill} · ${equipText(partner, item)}` : fill;
}

/** The line under a partner for Trade with… (nothing held): both bags' counts. */
export function tradePartnerText(ctx, partner) {
  const holder = partnerHolder(partner);
  const counts = ['inventory', 'consumables']
    .map((bag) => bagFillText(ctx, holder, bag, { fullHint: false }))
    .join(' · ');
  if (isConvoyChoice(partner)) return counts;
  return partner.accessory ? `${counts} · ${itemDisplayName(partner.accessory)}` : counts;
}
