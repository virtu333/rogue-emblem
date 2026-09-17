// Shared, guarded inventory operations for roster management outside battle.
import {
  addToInventory,
  addToConsumables,
  removeFromInventory,
  removeFromConsumables,
  canEquip,
  equipWeapon,
  isLastCombatWeapon,
  equipAccessory,
  unequipAccessory,
} from './UnitManager.js';
import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';

function convoyIndex(list, item) {
  return list.findIndex((candidate) =>
    item.uid ? candidate.uid === item.uid : JSON.stringify(candidate) === JSON.stringify(item),
  );
}

export function rosterItemBlock(run, unit, item, action) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  const consumable = item?.type === 'Consumable';
  const owned = (consumable ? unit.consumables : unit.inventory)?.includes(item);
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
  if (action === 'store') {
    if (!consumable && isLastCombatWeapon(unit, item)) return 'Keep at least one combat weapon.';
    return run.canAddToConvoy(item) ? '' : 'Convoy is full.';
  }
  if (action === 'heal') {
    if (!['heal', 'healFull'].includes(item.effect)) return 'Use this item in advanced management.';
    if (!(item.uses > 0)) return 'No uses remaining.';
    return unit.currentHP < unit.stats.HP ? '' : 'HP is already full.';
  }
  return 'Unavailable action.';
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
  }
  if (action === 'heal') {
    unit.currentHP = Math.min(
      unit.stats.HP,
      unit.currentHP + (item.effect === 'healFull' ? unit.stats.HP : item.value),
    );
    if (--item.uses <= 0) removeFromConsumables(unit, item);
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
