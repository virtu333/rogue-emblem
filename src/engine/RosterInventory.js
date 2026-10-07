// Shared, guarded inventory operations for roster management outside battle.
import {
  addToInventory,
  addToConsumables,
  removeFromInventory,
  removeFromConsumables,
  canEquip,
  equipWeapon,
  applyStatBoost,
  isLastCombatWeapon,
  equipAccessory,
  unequipAccessory,
} from './UnitManager.js';
import { clearAllConditions, getConditions } from './StatusConditionSystem.js';
import { TRADE_WARNINGS } from './ItemTrade.js';
import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';
import { healUnit, healUnitFully } from './UnitHealth.js';
import { goldPouchValue, isGoldPouch } from './GoldPouch.js';

function convoyIndex(list, item) {
  return list.findIndex((candidate) =>
    item.uid ? candidate.uid === item.uid : JSON.stringify(candidate) === JSON.stringify(item),
  );
}

/**
 * Where a consumable is used from between battles: the unit's own bag, or the shared
 * convoy (heals, boosters and seals work straight from storage, no withdraw needed).
 */
export function consumableSource(run, unit, item) {
  if (!item) return null;
  if (unit?.consumables?.includes(item)) return 'unit';
  if (run?.convoy?.consumables?.includes(item)) return 'convoy';
  return null;
}

/** Spend one use of a consumable; an emptied one leaves the bag or the convoy it came from. */
export function spendConsumableUse(run, unit, item) {
  const source = consumableSource(run, unit, item);
  item.uses = (item.uses ?? 1) - 1;
  if (item.uses > 0) return;
  if (source === 'unit') removeFromConsumables(unit, item);
  else if (source === 'convoy')
    run.convoy.consumables.splice(run.convoy.consumables.indexOf(item), 1);
}

export function rosterItemBlock(run, unit, item, action) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  const consumable = item?.type === 'Consumable';
  const owned =
    (consumable ? unit.consumables : unit.inventory)?.includes(item) ||
    (consumable &&
      ['heal', 'use'].includes(action) &&
      consumableSource(run, unit, item) === 'convoy');
  if (action === 'withdraw') {
    const items = run.getConvoyItems();
    if (convoyIndex(consumable ? items.consumables : items.weapons, item) < 0)
      return 'Item is no longer in the convoy.';
    if (
      (consumable ? unit.consumables || [] : unit.inventory).length >=
      (consumable ? CONSUMABLE_MAX : INVENTORY_MAX)
    )
      return consumable ? 'Consumables full.' : 'Equipment full.';
    return '';
  }
  if (!owned) return 'Item is no longer carried by this unit.';
  if (action === 'equip') return canEquip(unit, item) ? '' : 'This unit cannot equip this weapon.';
  // Storing a unit's last combat weapon is allowed: rosterItemWarnings says so.
  if (action === 'store') return run.canAddToConvoy(item) ? '' : 'Convoy is full.';
  if (action === 'heal' || action === 'use') {
    if (!consumable) return 'This item cannot be used.';
    if (!(item.uses > 0)) return 'No uses remaining.';
    if (item.effect === 'statBoost' && action === 'use') {
      return ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV'].includes(item.stat) &&
        Number.isFinite(item.value) &&
        item.value > 0 &&
        Number.isFinite(unit.stats?.[item.stat])
        ? ''
        : 'Invalid stat booster.';
    }
    // A Gold Pouch pays the army, not the unit holding it (it also works from the convoy).
    if (isGoldPouch(item) && action === 'use')
      return goldPouchValue(item) > 0 ? '' : 'Invalid Gold Pouch.';
    const hurt = unit.currentHP < unit.stats.HP;
    const afflicted = getConditions(unit).length > 0;
    if (['heal', 'healFull'].includes(item.effect)) return hurt ? '' : 'HP is already full.';
    if (item.effect === 'cure') return afflicted ? '' : 'No status conditions to cure.';
    if (item.effect === 'cureHeal')
      return hurt || afflicted ? '' : 'HP is full and there are no status conditions to cure.';
    return 'Use the dedicated action for this item.';
  }
  return 'Unavailable action.';
}

/**
 * What an allowed roster action costs the unit, as ItemTrade-style warnings
 * ([{ code: 'leaves_unarmed', unit }], worded by tradeWarningText): today only
 * Store of the unit's last combat weapon. [] when there is nothing to say, or
 * when the action is blocked (the block reason says it instead). Never mutates.
 */
export function rosterItemWarnings(run, unit, item, action) {
  if (action !== 'store' || item?.type === 'Consumable') return [];
  if (rosterItemBlock(run, unit, item, action)) return [];
  return isLastCombatWeapon(unit, item) ? [{ code: TRADE_WARNINGS.leavesUnarmed, unit }] : [];
}

export function rosterItemAction(run, unit, item, action) {
  const reason = rosterItemBlock(run, unit, item, action);
  if (reason) return reason;
  const consumable = item.type === 'Consumable';
  if (action === 'equip') equipWeapon(unit, item);
  if (action === 'store') {
    if (!run.addToConvoy(item)) return 'Convoy is full.';
    (consumable ? removeFromConsumables : removeFromInventory)(unit, item);
  }
  if (action === 'withdraw') {
    const items = run.getConvoyItems();
    const list = consumable ? items.consumables : items.weapons;
    const index = convoyIndex(list, item);
    // Add first so a capacity/type rejection cannot lose an item.
    if (!(consumable ? addToConsumables : addToInventory)(unit, item))
      return 'Cannot carry this item.';
    run.takeFromConvoy(consumable ? 'consumable' : 'weapon', index);
    // A revived unit may have no equipped weapon. Preserve deliberate choices.
    if (!unit.weapon && !consumable && item.type !== 'Staff' && canEquip(unit, item)) {
      equipWeapon(unit, unit.inventory[unit.inventory.length - 1]);
    }
  }
  if (action === 'heal' || action === 'use') {
    if (item.effect === 'statBoost') applyStatBoost(unit, item);
    if (isGoldPouch(item)) run.awardGold(goldPouchValue(item));
    // UnitHealth settles HP accessory debt on a heal to full; a partial heal keeps it.
    if (item.effect === 'healFull') healUnitFully(unit);
    else if (['heal', 'cureHeal'].includes(item.effect)) healUnit(unit, item.value);
    if (['cure', 'cureHeal'].includes(item.effect)) clearAllConditions(unit);
    spendConsumableUse(run, unit, item);
  }
  return '';
}

export function rosterAccessoryAction(run, unit, item = null) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  const pool = run.accessories || (run.accessories = []);
  if (item && !pool.includes(item)) return 'Accessory is no longer available.';
  if (item) pool.splice(pool.indexOf(item), 1);
  const old = item ? equipAccessory(unit, item) : unequipAccessory(unit);
  if (old) pool.push(old);
  return '';
}
