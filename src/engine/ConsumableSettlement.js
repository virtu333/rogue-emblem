import { healUnit, healUnitFully } from './UnitHealth.js';
import { clearAllConditions, isWounded } from './StatusConditionSystem.js';
import { removeFromConsumables } from './UnitManager.js';

const EFFECTS = new Set(['heal', 'healFull', 'cure', 'cureHeal']);
export function validateConsumable(unit, item, target = unit) {
  if (
    !(unit?.currentHP > 0) ||
    unit.hasActed ||
    !(target?.currentHP > 0) ||
    target._removing ||
    !unit.consumables?.includes(item) ||
    !(item.uses > 0) ||
    !EFFECTS.has(item.effect)
  )
    return null;
  if (item.effect === 'heal' || item.effect === 'healFull') {
    if (target !== unit || target.currentHP >= target.stats.HP || isWounded(target)) return null;
  } else if (!(target._conditions || []).length) return null;
  return true;
}
export function settleConsumable(unit, item, target = unit) {
  const hpBefore = target.currentHP;
  const cleared =
    item.effect === 'cure' || item.effect === 'cureHeal' ? [...(target._conditions || [])] : [];
  if (cleared.length) clearAllConditions(target);
  if (item.effect === 'healFull') healUnitFully(target);
  else if (item.effect === 'heal' || item.effect === 'cureHeal') healUnit(target, item.value);
  item.uses--;
  const removed = item.uses <= 0;
  if (removed) removeFromConsumables(unit, item);
  return {
    effect: item.effect,
    target,
    hpBefore,
    hpAfter: target.currentHP,
    healed: target.currentHP - hpBefore,
    cleared,
    usesLeft: item.uses,
    removed,
  };
}
