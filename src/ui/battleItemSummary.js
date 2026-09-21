import { getConsumableDescription } from '../utils/consumableText.js';
import { getStaffRemainingUses, getStaffMaxUses } from '../engine/Combat.js';
export function battleItemSummary(item, unit) {
  if (!item) return '';
  if (item.type === 'Consumable') return getConsumableDescription(item);
  if (item.type === 'Staff')
    return `${item.description || item.effect || 'Staff'} · Range ${item.range ?? 1} · Uses ${getStaffRemainingUses(item, unit)}/${getStaffMaxUses(item, unit)}`;
  return `Might ${item.might ?? 0} · Hit ${item.hit ?? 0} · Crit ${item.crit ?? 0}\nWeight ${item.weight ?? 0} · Range ${item.range ?? 1}`;
}
