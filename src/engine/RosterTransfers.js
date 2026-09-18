import { MAX_SKILLS, INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';
import {
  learnSkill,
  addToInventory,
  addToConsumables,
  removeFromInventory,
  removeFromConsumables,
} from './UnitManager.js';

export function teachScrollBlock(run, unit, scroll, skills) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  if (!run.scrolls?.includes(scroll)) return 'Scroll is no longer available.';
  if (scroll.teachesWeaponArtId || !skills.some((s) => s.id === scroll.skillId))
    return 'Choose a skill scroll.';
  if (unit.skills.includes(scroll.skillId)) return 'Already known.';
  if (unit.skills.length >= MAX_SKILLS) return `Skill slots full (${MAX_SKILLS}/${MAX_SKILLS}).`;
  return '';
}
export function teachRosterScroll(run, unit, scroll, skills) {
  const reason = teachScrollBlock(run, unit, scroll, skills);
  if (reason) return { ok: false, reason };
  const result = learnSkill(unit, scroll.skillId);
  if (!result.learned) return { ok: false, reason: result.reason };
  run.scrolls.splice(run.scrolls.indexOf(scroll), 1);
  return { ok: true };
}
export function giveRosterItemBlock(run, source, target, item) {
  if (!run?.roster?.includes(source) || !run.roster.includes(target))
    return 'Unit is no longer in the roster.';
  if (source === target) return 'Already carried by this unit.';
  const consumable = item.type === 'Consumable';
  if (!(consumable ? source.consumables : source.inventory)?.includes(item))
    return 'Item is no longer available.';
  if (
    (consumable ? target.consumables || [] : target.inventory || []).length >=
    (consumable ? CONSUMABLE_MAX : INVENTORY_MAX)
  )
    return 'Bag full.';
  // Trading permits carrying an unusable weapon, matching the existing trade UI.
  return '';
}
export function giveRosterItem(run, source, target, item) {
  const reason = giveRosterItemBlock(run, source, target, item);
  if (reason) return { ok: false, reason };
  const consumable = item.type === 'Consumable';
  if (!(consumable ? addToConsumables : addToInventory)(target, item))
    return { ok: false, reason: 'Cannot carry this item.' };
  (consumable ? removeFromConsumables : removeFromInventory)(source, item);
  return { ok: true };
}
