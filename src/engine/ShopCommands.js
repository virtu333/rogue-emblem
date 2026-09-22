import { rosterAccessoryAction } from './RosterInventory.js';
import {
  addToInventory,
  addToConsumables,
  removeFromInventory,
  removeFromConsumables,
  isLastCombatWeapon,
} from './UnitManager.js';
import { getSellPrice } from './LootSystem.js';
import { forgeStatBlock, applyForge, getForgeCost } from './ForgeSystem.js';
import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';

export function shopOwnedItems(run) {
  return [
    ...(run.roster || []).flatMap((unit) => [
      ...(unit.inventory || []).map((item) => ({
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
  else
    added = supply
      ? addToConsumables(recipient, entry.item)
      : addToInventory(recipient, entry.item);
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
export function shopSellBlock(run, row) {
  if (!shopItemOwned(run, row)) return 'This item is no longer available.';
  if (getSellPrice(row.item) <= 0) return 'This item cannot be sold.';
  if (row.kind === 'inventory' && isLastCombatWeapon(row.unit, row.item))
    return 'Keep at least one combat weapon.';
  return '';
}
export function sellShopItem(run, row) {
  const reason = shopSellBlock(run, row);
  if (reason) return { ok: false, reason };
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
  return { ok: true, message: `Sold ${row.item.name} for ${price}G.` };
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
  const cost = Math.max(1, Math.floor(getForgeCost(weapon, stat) * (1 - discount)));
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
