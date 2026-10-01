import { rosterAccessoryAction } from './RosterInventory.js';
import { TRADE_WARNINGS } from './ItemTrade.js';
import {
  addToInventory,
  addToConsumables,
  equipIfUnarmed,
  removeFromInventory,
  removeFromConsumables,
  inventoryDisplayOrder,
  canEquip,
  getCombatWeapons,
} from './UnitManager.js';
import { weaponTypeNoun } from './ItemKeywords.js';
import { getSellPrice } from './LootSystem.js';
import { forgeStatBlock, applyForge, forgePrice } from './ForgeSystem.js';
import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';

export function shopOwnedItems(run) {
  return [
    ...(run.roster || []).flatMap((unit) => [
      ...inventoryDisplayOrder(unit).map((item) => ({
        unit,
        item,
        kind: 'inventory',
        owner: unit.name,
      })),
      ...(unit.consumables || []).map((item) => ({
        unit,
        item,
        kind: 'consumable',
        owner: unit.name,
      })),
    ]),
    ...(run.convoy?.weapons || []).map((item) => ({
      item,
      kind: 'convoy_weapon',
      owner: 'Convoy',
    })),
    ...(run.convoy?.consumables || []).map((item) => ({
      item,
      kind: 'convoy_consumable',
      owner: 'Convoy',
    })),
    ...(run.scrolls || []).map((item) => ({ item, kind: 'scroll', owner: 'Team scrolls' })),
    ...(run.accessories || []).map((item) => ({
      item,
      kind: 'accessory',
      owner: 'Team accessories',
    })),
  ];
}
export function shopItemOwned(run, row) {
  return shopOwnedItems(run).some(
    (r) => r.item === row.item && r.unit === row.unit && r.kind === row.kind,
  );
}
export function shopBuyBlock(run, stock, entry) {
  if (!stock.includes(entry)) return 'This item is no longer in stock.';
  if (!Number.isFinite(entry.price) || entry.price < 0) return 'Item price is unavailable.';
  if (run.gold < entry.price) return 'Not enough gold.';
  return '';
}
export function purchaseShopItem(run, stock, entry, recipient) {
  const reason = shopBuyBlock(run, stock, entry);
  if (reason) return { ok: false, reason };
  const pool =
    entry.type === 'scroll' ? 'scrolls' : entry.type === 'accessory' ? 'accessories' : null;
  if (
    pool === 'accessories' &&
    recipient != null &&
    recipient !== 'pool' &&
    !run.roster.includes(recipient)
  )
    return { ok: false, reason: 'Choose a current roster member.' };
  const supply = entry.item.type === 'Consumable';
  if (!pool && recipient !== 'convoy' && !run.roster.includes(recipient))
    return { ok: false, reason: 'Choose a current roster member.' };
  const full =
    !pool &&
    recipient !== 'convoy' &&
    (supply
      ? (recipient.consumables || []).length >= CONSUMABLE_MAX
      : (recipient.inventory || []).length >= INVENTORY_MAX);
  const convoy = !pool && (recipient === 'convoy' || full);
  if (!run.spendGold(entry.price)) return { ok: false, reason: 'Not enough gold.' };
  let added;
  if (pool) {
    const copy = structuredClone(entry.item);
    (run[pool] ||= []).push(copy);
    if (pool === 'accessories' && recipient != null && recipient !== 'pool')
      rosterAccessoryAction(run, recipient, copy);
    added = true;
  } else if (convoy) added = run.addToConvoy(entry.item);
  else {
    added = supply
      ? addToConsumables(recipient, entry.item)
      : addToInventory(recipient, entry.item);
    // An unarmed buyer equips the usable weapon it bought (as a trade or Withdraw does).
    if (added && !supply) equipIfUnarmed(recipient, recipient.inventory.at(-1));
  }
  if (!added) {
    run.addGold(entry.price);
    return {
      ok: false,
      reason: convoy ? 'Convoy is full. Nothing purchased.' : 'No space for this item.',
    };
  }
  stock.splice(stock.indexOf(entry), 1);
  return {
    ok: true,
    message: `${entry.item.name} → ${pool === 'accessories' && recipient != null && recipient !== 'pool' ? `${recipient.name} (equipped)` : pool ? (pool === 'scrolls' ? 'Scroll pool' : 'Accessory pool') : convoy ? 'Convoy' : recipient.name}.`,
  };
}
// Selling a unit's last combat weapon (or staff) is allowed (a unit may carry
// nothing); shopSellWarnings says so first.
export function shopSellBlock(run, row) {
  if (!shopItemOwned(run, row)) return 'This item is no longer available.';
  if (getSellPrice(row.item) <= 0) return 'This item cannot be sold.';
  return '';
}

/** Sell-row risk codes (shopSellRisk). */
export const SELL_RISKS = Object.freeze({
  onlyWeapon: 'only_weapon',
  onlyStaff: 'only_staff',
  onlyType: 'only_type',
});

/**
 * What selling this row would take from its owner, before anything is chosen:
 * - `only_weapon`: the owner's last combat weapon it can wield (it would be unarmed);
 * - `only_staff`: the last staff a staff user can wield (no more healing);
 * - `only_type`: the last weapon of its type the owner can wield while it keeps
 *   another (a bow-and-sword unit's only bow; `weaponType` names the type in
 *   plain words), the softer note.
 * Items the owner can't use, spares (another usable item of the kind), supplies,
 * convoy and team-pool items carry none. [] when the row is stale or unsellable.
 * Pure; never mutates. Returns `[{ code, unit, weaponType? }]` (at most one).
 */
export function shopSellRisk(run, row) {
  if (row?.kind !== 'inventory' || !row.unit || shopSellBlock(run, row)) return [];
  const { unit, item } = row;
  const usable = (other) => canEquip(unit, other);
  if (item?.type === 'Staff') {
    if (!usable(item)) return [];
    const spare = unit.inventory.some((o) => o !== item && o?.type === 'Staff' && usable(o));
    return spare ? [] : [{ code: SELL_RISKS.onlyStaff, unit }];
  }
  const combat = getCombatWeapons(unit);
  if (!combat.includes(item)) return [];
  if (combat.length === 1) return [{ code: SELL_RISKS.onlyWeapon, unit }];
  if (combat.some((o) => o !== item && o.type === item.type)) return [];
  return [{ code: SELL_RISKS.onlyType, unit, weaponType: weaponTypeNoun(item.type) }];
}

/** The sell row's tag for a risk: "Only weapon", "Only staff", "Only bow". */
export function sellRiskLabel(risk) {
  if (risk?.code === SELL_RISKS.onlyWeapon) return 'Only weapon';
  if (risk?.code === SELL_RISKS.onlyStaff) return 'Only staff';
  if (risk?.code === SELL_RISKS.onlyType && risk.weaponType)
    return `Only ${String(risk.weaponType).toLowerCase()}`;
  return '';
}

const RISK_WARNINGS = {
  [SELL_RISKS.onlyWeapon]: TRADE_WARNINGS.leavesUnarmed,
  [SELL_RISKS.onlyStaff]: TRADE_WARNINGS.leavesNoStaff,
  [SELL_RISKS.onlyType]: TRADE_WARNINGS.leavesNoType,
};

/**
 * What an allowed sale costs the seller, as ItemTrade-style warnings worded by
 * tradeWarningText: `leaves_unarmed` (its last combat weapon), `leaves_no_staff`
 * (its last staff) or `leaves_no_type` (its last weapon of a type, `weaponType`),
 * each `{ code, unit }`. [] when blocked or when there is nothing to say.
 */
export function shopSellWarnings(run, row) {
  return shopSellRisk(run, row).map(({ code, unit, weaponType }) =>
    weaponType
      ? { code: RISK_WARNINGS[code], unit, weaponType }
      : { code: RISK_WARNINGS[code], unit },
  );
}
export function sellShopItem(run, row) {
  const reason = shopSellBlock(run, row);
  if (reason) return { ok: false, reason };
  const risk = shopSellRisk(run, row)[0]?.code;
  const price = getSellPrice(row.item);
  if (row.kind === 'inventory') removeFromInventory(row.unit, row.item);
  else if (row.kind === 'consumable') removeFromConsumables(row.unit, row.item);
  else if (row.kind === 'scroll' || row.kind === 'accessory') {
    const pool = row.kind === 'scroll' ? run.scrolls : run.accessories;
    pool.splice(pool.indexOf(row.item), 1);
  } else {
    const type = row.kind === 'convoy_weapon' ? 'weapon' : 'consumable';
    const list = type === 'weapon' ? run.convoy.weapons : run.convoy.consumables;
    run.takeFromConvoy(type, list.indexOf(row.item));
  }
  if (typeof run.awardGold === 'function') run.awardGold(price);
  else run.addGold(price);
  const after =
    risk === SELL_RISKS.onlyWeapon
      ? ` ${row.unit.name} is now unarmed.`
      : risk === SELL_RISKS.onlyStaff
        ? ` ${row.unit.name} has no staff now.`
        : '';
  return { ok: true, message: `Sold ${row.item.name} for ${price}G.${after}` };
}
export function shopForgeBlock(
  run,
  weapon,
  stat,
  { forgesUsed = 0, forgeLimit = 0, discount = 0, expectedLevel } = {},
) {
  if (
    !['might', 'hit', 'crit', 'weight'].includes(stat) ||
    !Number.isFinite(discount) ||
    discount < 0 ||
    discount >= 1
  )
    return 'Invalid forge choice.';
  if (!shopOwnedItems(run).some((row) => row.item === weapon))
    return 'This weapon is no longer available.';
  if (expectedLevel != null && (weapon._forgeLevel || 0) !== expectedLevel)
    return 'Weapon changed. Review it again.';
  if (forgesUsed >= forgeLimit) return 'No forges remain at this shop.';
  const statBlock = forgeStatBlock(weapon, stat);
  if (statBlock) return statBlock;
  const cost = forgePrice(weapon, stat, discount);
  return run.gold < cost ? 'Not enough gold.' : '';
}
export function forgeShopWeapon(run, weapon, stat, options) {
  const reason = shopForgeBlock(run, weapon, stat, options);
  if (reason) return { ok: false, reason };
  const result = applyForge(weapon, stat, options.discount);
  if (!result.success) return { ok: false, reason: 'This forge is unavailable.' };
  run.spendGold(result.cost);
  return { ok: true, message: `Forged ${weapon.name} for ${result.cost}G.` };
}
