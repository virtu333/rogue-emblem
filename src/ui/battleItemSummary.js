import { getConsumableDescription } from '../utils/consumableText.js';
import {
  getEffectiveStaffRange,
  getStaffRemainingUses,
  getStaffMaxUses,
  getStaticCombatStats,
} from '../engine/Combat.js';

function formatRange(range) {
  if (!range || typeof range !== 'object') return String(range ?? 1);
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
}

const signed = (n) => (n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`);
// A heavy weapon on a slow unit can take attack speed below zero.
const number = (n) => (n < 0 ? `\u2212${Math.abs(n)}` : `${n}`);

/**
 * Attack speed with `item` equipped (Combat.getStaticCombatStats: forged weight,
 * STR offset, weapon SPD bonus, stat accessories) and with the weapon the unit holds
 * now. Computed without equipping. `current` is null on the equipped weapon's own row.
 * Null for anything that is not an attacking weapon, or without a unit.
 */
export function weaponAttackSpeed(item, unit) {
  if (!item || !unit?.stats || item.might == null) return null;
  if (['Consumable', 'Staff', 'Scroll'].includes(item.type)) return null;
  const as = getStaticCombatStats(unit, item).as;
  if (item === unit.weapon) return { as, current: null };
  return { as, current: getStaticCombatStats(unit, unit.weapon).as };
}

/** "+2" / "−2" against the equipped weapon; '' on its own row or when unchanged. */
export function attackSpeedDelta(speed) {
  const delta = speed?.current == null ? 0 : speed.as - speed.current;
  return delta ? signed(delta) : '';
}

/** "7" (a typographic minus below zero). */
export function attackSpeedValue(value) {
  return number(value);
}

/** "7", or "5 (−2)" against the equipped weapon. */
export function attackSpeedBrief(speed) {
  if (!speed) return '';
  const delta = attackSpeedDelta(speed);
  return delta ? `${number(speed.as)} (${delta})` : number(speed.as);
}

/**
 * The brief a menu row shows (phone rail submenus): the numbers that decide a
 * pick. A ✦ marks a weapon with a special effect; the full text is
 * battleItemSummary, shown on a long press. '' when there is nothing to add.
 * Given the unit, a weapon adds its attack speed on a second line (with the change
 * from the equipped weapon): the rail is too narrow to hold it on the first.
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
  const stats = `${parts.join(' · ')}${item.special ? '\u00a0✦' : ''}`;
  const speed = weaponAttackSpeed(item, unit);
  return speed ? `${stats}\nAttack speed ${attackSpeedBrief(speed)}` : stats;
}

/** The full detail of an item: every stat and its effect (long press, screen readers). */
export function battleItemSummary(item, unit) {
  if (!item) return '';
  if (item.type === 'Consumable') return `${getConsumableDescription(item)} · Uses do not refill`;
  if (item.type === 'Staff') {
    const range = unit ? getEffectiveStaffRange(item, unit) : item.range;
    return `${item.special || item.description || 'Staff'} · Range ${formatRange(range)} · Uses ${getStaffRemainingUses(item, unit)}/${getStaffMaxUses(item, unit)} · Refills each battle`;
  }
  const speed = weaponAttackSpeed(item, unit);
  const speedLine = !speed
    ? ''
    : speed.current == null
      ? `\nAttack speed ${number(speed.as)}`
      : `\nAttack speed ${number(speed.current)} → ${number(speed.as)}`;
  const stats = `Might ${item.might ?? 0} · Hit ${item.hit ?? 0} · Crit ${item.crit ?? 0}\nWeight ${item.weight ?? 0} · Range ${item.range ?? 1}${speedLine}`;
  return item.special ? `${stats}\n${item.special}` : stats;
}

export const ITEM_ACTION_NOTE =
  'Using an item ends this unit’s action. Consumable uses do not refill.';
