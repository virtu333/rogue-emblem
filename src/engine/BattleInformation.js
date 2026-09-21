import { getFootprint, isEntity } from './EntitySystem.js';
import { getConditions, parseStaffRange } from './StatusConditionSystem.js';
import { STATUS_CONDITIONS } from '../utils/constants.js';

// All inspection entry points use the same information boundary as map graphics.
export function canInspectUnit(grid, unit) {
  if (!unit) return false;
  if (unit.faction === 'player' || !grid?.fogEnabled) return true;
  return (isEntity(unit) ? getFootprint(unit) : [unit]).some((t) => grid.isVisible(t.col, t.row));
}
const STATUS_TEXT = {
  sleep: ['Asleep', 'Cannot act. Wakes when damaged.'],
  silence: ['Silenced', 'Cannot use magic, weapon arts or staves.'],
  root: ['Rooted', 'Cannot move; can still act.'],
  acid: ['Acid', 'Takes damage at turn start.'],
};
export function statusDescriptions(unit) {
  return getConditions(unit).map((c) => {
    const [name, effect] = STATUS_TEXT[c.id] || [c.id, ''];
    const early = (c.recoveryChance ?? STATUS_CONDITIONS[c.id]?.recoveryChance ?? 0) > 0;
    const duration = Math.max(0, Number(c.turnsRemaining) || 0);
    return `${name} · ${early ? 'up to ' : ''}${duration} turn${duration === 1 ? '' : 's'}. ${effect}${early ? ' May recover at turn start.' : ''}`;
  });
}
export function statusStaffInfo(unit) {
  const staff = unit?.statusStaff;
  if (!staff || !(staff.uses > 0)) return null;
  const uses = Math.max(0, staff.uses - (staff._usesSpent || 0));
  return {
    staff,
    uses,
    ...parseStaffRange(staff.range),
    text: `${staff.name} · Range ${staff.range} · ${uses}/${staff.uses} uses`,
  };
}
export function statusStaffThreat(unit) {
  const info = statusStaffInfo(unit);
  if (!info?.uses) return null;
  // Recovery runs before the next enemy phase. Keep possible recoveries in the
  // preview; deterministic silence/sleep that survives that phase blocks it.
  const blocked = getConditions(unit).some(
    (c) =>
      ['sleep', 'silence'].includes(c.id) &&
      c.turnsRemaining > 1 &&
      (c.recoveryChance ?? STATUS_CONDITIONS[c.id]?.recoveryChance ?? 0) === 0,
  );
  return blocked ? null : info;
}
