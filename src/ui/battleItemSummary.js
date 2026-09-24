import { getConsumableDescription } from '../utils/consumableText.js';
import {
  getEffectiveStaffRange,
  getStaffRemainingUses,
  getStaffMaxUses,
} from '../engine/Combat.js';

function formatRange(range) {
  if (!range || typeof range !== 'object') return String(range ?? 1);
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
}

export function battleItemSummary(item, unit) {
  if (!item) return '';
  if (item.type === 'Consumable') return `${getConsumableDescription(item)} · Uses do not refill`;
  if (item.type === 'Staff') {
    const range = unit ? getEffectiveStaffRange(item, unit) : item.range;
    return `${item.special || item.description || 'Staff'} · Range ${formatRange(range)} · Uses ${getStaffRemainingUses(item, unit)}/${getStaffMaxUses(item, unit)} · Refills each battle`;
  }
  const stats = `Might ${item.might ?? 0} · Hit ${item.hit ?? 0} · Crit ${item.crit ?? 0}\nWeight ${item.weight ?? 0} · Range ${item.range ?? 1}`;
  return item.special ? `${stats}\n${item.special}` : stats;
}
