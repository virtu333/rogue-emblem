import { getStaticCombatStats, getStaffMaxUses } from '../engine/Combat.js';
export function equipmentComparison(unit, item, before = unit?.weapon) {
  if (!unit || !item) return '';
  if (item.type === 'Staff')
    return `${getStaffMaxUses(item, unit)} uses per map for ${unit.name} · Uses refresh each battle`;
  if (item.might == null) return '';
  const old = getStaticCombatStats(unit, before),
    next = getStaticCombatStats(unit, item);
  return `If equipped: Attack ${old.atk} → ${next.atk} · Attack speed ${old.as} → ${next.as}`;
}
