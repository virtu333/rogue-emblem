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

/**
 * The one-line brief a menu row shows (phone rail submenus): the numbers that
 * decide a pick. A ✦ marks a weapon with a special effect; the full text is
 * battleItemSummary, shown on a long press. '' when there is nothing to add.
 */
export function battleItemBrief(item, unit) {
  if (!item) return '';
  if (item.type === 'Consumable') return getConsumableDescription(item);
  if (item.type === 'Staff') {
    const range = unit ? getEffectiveStaffRange(item, unit) : item.range;
    return `Rng ${formatRange(range)} · ${getStaffRemainingUses(item, unit)}/${getStaffMaxUses(item, unit)} uses`;
  }
  const parts = [`Mt ${item.might ?? 0}`, `Hit ${item.hit ?? 0}`];
  if (Number(item.crit) > 0) parts.push(`Crt ${item.crit}`);
  parts.push(`Rng ${item.range ?? 1}`);
  return `${parts.join(' · ')}${item.special ? ' ✦' : ''}`;
}

/** The full detail of an item: every stat and its effect (long press, screen readers). */
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
