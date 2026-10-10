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
import { isSignatureWeapon } from './SignatureWeapons.js';
import { isPrologueRun } from './ScriptedBattle.js';

function convoyIndex(list, item) {
  return list.findIndex((candidate) =>
    item.uid ? candidate.uid === item.uid : JSON.stringify(candidate) === JSON.stringify(item),
  );
}

/**
 * Where a discarded item is, by object identity alone: the live item in the unit's own bag, or
 * the live item in the shared convoy. { place: 'bag' } | { place: 'convoy', index } | null.
 * Discard destroys, so it needs an unambiguous instance and location: there is no fallback to
 * a matching uid or equal JSON (a duplicate uid, a uid-less twin or a stale snapshot would
 * destroy the wrong instance), and a request that names one place never reads the other, so a
 * stale bag request cannot reach a convoy copy. `where` ('bag' | 'convoy') names the place; left
 * out, either is read, still by identity. The convoy list is the run's own (getConvoyItems()
 * hands out clones, which are refused), so `index` is what takeFromConvoy removes.
 */
function locateDiscardable(run, unit, item, where = null) {
  if (!item || typeof item !== 'object') return null;
  const consumable = item.type === 'Consumable';
  if (where !== 'convoy') {
    const bag = consumable ? unit?.consumables : unit?.inventory;
    if (run.roster.includes(unit) && Array.isArray(bag) && bag.includes(item))
      return { place: 'bag' };
  }
  if (where === 'bag') return null;
  run.getConvoyItems();
  const list = consumable ? run.convoy.consumables : run.convoy.weapons;
  const index = list.indexOf(item);
  return index >= 0 ? { place: 'convoy', index } : null;
}

/**
 * Why an item cannot be thrown away, '' when it can: a unit's bag weapon, staff or consumable,
 * or a convoy weapon or consumable (`unit` is only the viewer for the convoy). Never in a
 * battle or the prologue (its kits are authored), never a lord's personal weapon (nothing
 * hands it back), and an accessory has no capacity to free. Only the live item is accepted
 * (see locateDiscardable): a clone or stale reference is "no longer here".
 */
function discardBlock(run, unit, item, where) {
  if (!Array.isArray(run?.roster)) return 'Unavailable action.';
  if (isPrologueRun(run)) return 'Nothing is discarded in the prologue.';
  if (run.battleInProgress) return 'Items cannot be discarded during a battle.';
  if (item?.type === 'Accessory') return 'Accessories are not discarded.';
  if (isSignatureWeapon(item)) return "A lord's personal weapon cannot be discarded.";
  if (locateDiscardable(run, unit, item, where)) return '';
  return !unit || run.roster.includes(unit)
    ? 'Item is no longer here.'
    : 'Unit is no longer in the roster.';
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

export function rosterItemBlock(run, unit, item, action, where = null) {
  if (action === 'discard') return discardBlock(run, unit, item, where);
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
 * ([{ code: 'leaves_unarmed', unit }], worded by tradeWarningText): Store or Discard of
 * the unit's last combat weapon (a convoy item belongs to no unit). [] when there is
 * nothing to say, or when the action is blocked (the block reason says it instead).
 * Never mutates.
 */
export function rosterItemWarnings(run, unit, item, action, where = null) {
  if (!['store', 'discard'].includes(action) || item?.type === 'Consumable') return [];
  if (rosterItemBlock(run, unit, item, action, where)) return [];
  if (action === 'discard' && locateDiscardable(run, unit, item, where).place !== 'bag') return [];
  return isLastCombatWeapon(unit, item) ? [{ code: TRADE_WARNINGS.leavesUnarmed, unit }] : [];
}

export function rosterItemAction(run, unit, item, action, where = null) {
  const reason = rosterItemBlock(run, unit, item, action, where);
  if (reason) return reason;
  const consumable = item.type === 'Consumable';
  if (action === 'discard') {
    // Gone for good: not the convoy, no gold. An equipped weapon leaves through the same
    // removeFromInventory Store uses, so the unit re-equips (or is left unarmed) alike.
    const found = locateDiscardable(run, unit, item, where);
    if (found.place === 'convoy') {
      const gone = run.takeFromConvoy(consumable ? 'consumable' : 'weapon', found.index);
      return gone ? '' : 'Item is no longer here.';
    }
    (consumable ? removeFromConsumables : removeFromInventory)(unit, item);
  }
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
