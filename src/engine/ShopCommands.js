import { bumpRunFeat } from './RunFeats.js';
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
import { isDuplicateLegendary, recordLegendaryGrant } from './LegendaryOwnership.js';
import { weaponTypeNoun } from './ItemKeywords.js';
import { getSellPrice } from './LootSystem.js';
import { itemDisplayName } from '../utils/itemNames.js';
import { forgeStatBlock, applyForge, forgePrice } from './ForgeSystem.js';
import { isWorn, wearCount, repairPrice, repairWeapon } from './WeaponWear.js';
import { arrivalCopy, forgeBlockReason } from './SmithsExile.js';
import {
  INVENTORY_MAX,
  CONSUMABLE_MAX,
  AMBUSH_SHOP_DISCOUNT,
  SHOP_FORGE_LIMITS,
  SHOP_FORGE_CREDIT,
} from '../utils/constants.js';

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
  // Stock rolled before the first one was bought (or loaded from an older save).
  if (isDuplicateLegendary(run, entry.item)) return 'Already owned this run.';
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
  } else {
    // Smith's Exile: a weapon arrives forged (a copy; the stock's row is never touched).
    const bought = supply ? entry.item : arrivalCopy(run, entry.item);
    if (convoy) added = run.addToConvoy(bought);
    else {
      added = supply ? addToConsumables(recipient, bought) : addToInventory(recipient, bought);
      // An unarmed buyer equips the usable weapon it bought (as a trade or Withdraw does).
      if (added && !supply) equipIfUnarmed(recipient, recipient.inventory.at(-1));
    }
  }
  if (!added) {
    run.addGold(entry.price);
    return {
      ok: false,
      reason: convoy ? 'Convoy is full. Nothing purchased.' : 'No space for this item.',
    };
  }
  stock.splice(stock.indexOf(entry), 1);
  recordLegendaryGrant(run, entry.item);
  bumpRunFeat(run, 'shopBuys'); // Self-Reliant reads it (engine/RunFeats.js)
  return {
    ok: true,
    message: `${itemDisplayName(entry.item, run.gameData?.skills)} → ${pool === 'accessories' && recipient != null && recipient !== 'pool' ? `${recipient.name} (equipped)` : pool ? (pool === 'scrolls' ? 'Scroll pool' : 'Accessory pool') : convoy ? 'Convoy' : recipient.name}.`,
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
  return {
    ok: true,
    message: `Sold ${itemDisplayName(row.item, run.gameData?.skills)} for ${price}G.${after}`,
  };
}
// A forge price ratio: 0.3 is 30% off, -0.2 is 20% dearer (a blessing's forge-cost price).
// The engine accepts [FORGE_DISCOUNT_MIN, 1): never more than double, never free. A shop
// offers at most FORGE_DISCOUNT_MAX off.
export const FORGE_DISCOUNT_MIN = -1;
export const FORGE_DISCOUNT_MAX = 0.95;

function validForgeDiscount(discount) {
  return Number.isFinite(discount) && discount >= FORGE_DISCOUNT_MIN && discount < 1;
}

/**
 * The forge price ratio a shop charges: the run's blessing forge discount (a +20% forge
 * cost price as -0.2, or a discount from a blessing's boon), composed with a liberated
 * village's own discount. Forging and repair both read it.
 * @param {object} run - RunManager
 * @param {{ ambushDiscount?: boolean }} [options]
 */
export function shopForgeDiscount(run, { ambushDiscount = false } = {}) {
  const clamp = (v) => Math.max(FORGE_DISCOUNT_MIN, Math.min(FORGE_DISCOUNT_MAX, v));
  const raw = Number(run?.getForgeCostDiscount?.() || 0);
  const blessing = clamp(Number.isFinite(raw) ? raw : 0);
  return clamp(ambushDiscount ? 1 - (1 - blessing) * AMBUSH_SHOP_DISCOUNT : blessing);
}

/**
 * Whether this forge use takes the shop credit (Smith's Mark: a shop's first forge or repair,
 * per card held, costs up to SHOP_FORGE_CREDIT less). The engine decides from the run and the
 * shop's count of uses; a caller's own `free` or `credit` is never read, so a stale or forged
 * flag cannot make anything cheaper. The count itself is the caller's (`forgesUsed`, with
 * `forgeLimit`): the engine trusts it, as it trusts the limit, and the shop menu reads it fresh
 * from the scene's saved shop state before every command.
 */
export function freeForgeAvailable(run, forgesUsed = 0) {
  const free = Math.max(0, Math.trunc(Number(run?.getFreeForgesPerShop?.()) || 0));
  return (Number(forgesUsed) || 0) < free;
}

/** The gold this forge use takes off its price: SHOP_FORGE_CREDIT while the credit holds, else 0. */
export function shopForgeCredit(run, forgesUsed = 0) {
  return freeForgeAvailable(run, forgesUsed) ? SHOP_FORGE_CREDIT : 0;
}

/**
 * What a shop's forge asks right now: the uses spent and allowed (the act's limit plus a
 * blessing's extra forges), the price ratio, and whether the next use is free. The shop menu
 * reads this to show the forge and passes it back to the commands below, which recompute
 * `free` themselves.
 * @param {object} run - RunManager
 * @param {{ act?: string, forgesUsed?: number, ambushDiscount?: boolean }} [options]
 */
export function shopForgeTerms(
  run,
  { act = run?.currentAct, forgesUsed = 0, ambushDiscount = false } = {},
) {
  return {
    forgesUsed,
    // `||`, not `??`: an act the table lists at 0 (the final act, which has no forge tab)
    // has always read as the default 2.
    forgeLimit:
      (SHOP_FORGE_LIMITS[act] || 2) + (run?.blessingRuntimeModifiers?.forgeLimitDelta || 0),
    discount: shopForgeDiscount(run, { ambushDiscount }),
    // `free`: the next use takes the shop credit (`credit` gold off: Smith's Mark).
    free: freeForgeAvailable(run, forgesUsed),
    credit: shopForgeCredit(run, forgesUsed),
  };
}

/** Gold off a listed price under `terms` (the shop credit), never below 0. -1 stays -1. */
function afterCredit(listed, terms) {
  if (listed < 0) return listed;
  return Math.max(0, listed - Math.max(0, Math.trunc(Number(terms?.credit) || 0)));
}

/** What one forge costs under `terms`: the discounted price less the credit (-1: not forgeable). */
export function shopForgePrice(weapon, stat, terms) {
  return afterCredit(forgePrice(weapon, stat, terms?.discount || 0), terms);
}

/** What one repair costs under `terms`: the discounted price less the credit. */
export function shopRepairPrice(weapon, terms) {
  return afterCredit(repairPrice(weapon, terms?.discount || 0), terms);
}

/** The gold the credit takes off this forge under `terms` (0 without one). */
export function shopForgeSaving(weapon, stat, terms) {
  const listed = forgePrice(weapon, stat, terms?.discount || 0);
  return listed < 0 ? 0 : listed - shopForgePrice(weapon, stat, terms);
}

/** The gold the credit takes off this repair under `terms` (0 without one). */
export function shopRepairSaving(weapon, terms) {
  const listed = repairPrice(weapon, terms?.discount || 0);
  return listed < 0 ? 0 : listed - shopRepairPrice(weapon, terms);
}

export function shopForgeBlock(
  run,
  weapon,
  stat,
  { forgesUsed = 0, forgeLimit = 0, discount = 0, expectedLevel } = {},
) {
  if (!['might', 'hit', 'crit', 'weight'].includes(stat) || !validForgeDiscount(discount))
    return 'Invalid forge choice.';
  if (!shopOwnedItems(run).some((row) => row.item === weapon))
    return 'This weapon is no longer available.';
  if (expectedLevel != null && (weapon._forgeLevel || 0) !== expectedLevel)
    return 'Weapon changed. Review it again.';
  // Smith's Exile: no forge anywhere (a repair is a mend, and stays open).
  const exiled = forgeBlockReason(run);
  if (exiled) return exiled;
  if (forgesUsed >= forgeLimit) return 'No forges remain at this shop.';
  const statBlock = forgeStatBlock(weapon, stat);
  if (statBlock) return statBlock;
  // The shop credit (Smith's Mark) comes off first: a forge it covers needs no gold at all.
  const cost = Math.max(0, forgePrice(weapon, stat, discount) - shopForgeCredit(run, forgesUsed));
  return run.gold < cost ? 'Not enough gold.' : '';
}

/** The result's words for a forge or repair that took the shop credit, or that paid in full. */
function creditMessage(verb, name, cost, saved) {
  if (saved <= 0) return `${verb} ${name} for ${cost}G.`;
  if (cost <= 0) return `${verb} ${name} for free (Smith's Mark).`;
  return `${verb} ${name} for ${cost}G (Smith's Mark took ${saved}G off).`;
}

export function forgeShopWeapon(run, weapon, stat, options) {
  const reason = shopForgeBlock(run, weapon, stat, options);
  if (reason) return { ok: false, reason };
  const credit = shopForgeCredit(run, options.forgesUsed);
  const listed = forgePrice(weapon, stat, options.discount);
  const result = applyForge(weapon, stat, options.discount, { credit });
  if (!result.success) return { ok: false, reason: 'This forge is unavailable.' };
  run.spendGold(result.cost); // applyForge is the one place that takes the credit off
  const saved = Math.max(0, listed - result.cost);
  return {
    ok: true,
    free: result.cost === 0 && credit > 0,
    credited: saved,
    message: creditMessage('Forged', weapon.name, result.cost, saved),
  };
}

/**
 * Why a worn weapon cannot be repaired at this shop right now, or '' when it can.
 * A repair is a forge service: it spends one of the shop's forge uses (`forgesUsed` of
 * `forgeLimit`, the counter forging uses) and the shop's forge discount applies. The shop's
 * first use takes Smith's Mark's credit, a repair as much as a forge.
 * `expectedWear` (the wear the player reviewed) refuses a weapon that changed since.
 */
export function shopRepairBlock(
  run,
  weapon,
  { forgesUsed = 0, forgeLimit = 0, discount = 0, expectedWear } = {},
) {
  if (!validForgeDiscount(discount)) return 'Invalid repair.';
  if (!shopOwnedItems(run).some((row) => row.item === weapon))
    return 'This weapon is no longer available.';
  if (expectedWear != null && wearCount(weapon) !== expectedWear)
    return 'Weapon changed. Review it again.';
  if (!isWorn(weapon)) return 'This weapon is not worn.';
  if (forgesUsed >= forgeLimit) return 'No forges remain at this shop.';
  const price = Math.max(0, repairPrice(weapon, discount) - shopForgeCredit(run, forgesUsed));
  return run.gold < price ? 'Not enough gold.' : '';
}
/**
 * Repair the weapon's most recent wear step: gold is spent and the weapon mended, or
 * nothing changes. The caller counts the forge use (the scene's `shopForgesUsed`) on `ok`.
 */
export function repairShopWeapon(run, weapon, options) {
  const reason = shopRepairBlock(run, weapon, options);
  if (reason) return { ok: false, reason };
  const credit = shopForgeCredit(run, options.forgesUsed);
  const listed = repairPrice(weapon, options.discount);
  const result = repairWeapon(weapon, options.discount, { credit });
  if (!result.success) return { ok: false, reason: 'This repair is unavailable.' };
  run.spendGold(result.cost); // repairWeapon is the one place that takes the credit off
  const saved = Math.max(0, listed - result.cost);
  return {
    ok: true,
    free: result.cost === 0 && credit > 0,
    credited: saved,
    message: creditMessage('Repaired', weapon.name, result.cost, saved),
    stat: result.stat,
  };
}
