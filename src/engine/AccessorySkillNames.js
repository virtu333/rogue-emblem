// AccessorySkillNames.js — what an accessory with a bound skill is called and says
// (docs/specs/phase3.md 3H). Pure.
//
// The light half of AccessorySkills.js, with no import beyond EffectiveSkills, so
// utils/itemNames.js and the UI can read it without pulling in UnitManager. An accessory
// with a bound skill keeps its identity name ("Power Ring"); its display name adds the skill,
// "Power Ring · Vantage" (docs/specs/item-names.md). The bound skill is read only through
// `boundSkillOf` (EffectiveSkills).
import { boundSkillOf } from './EffectiveSkills.js';

/** The separator of the display grammar: "<accessory> · <skill>". */
export const ACCESSORY_SKILL_SEPARATOR = ' · ';

/** The skill id an accessory lends, or null (a weapon's grant is never read here). */
export function accessorySkillOf(item) {
  return item?.type === 'Accessory' ? boundSkillOf(item) : null;
}

/** Does this accessory carry a bound skill? */
export function hasAccessorySkill(item) {
  return accessorySkillOf(item) !== null;
}

/** The skill's catalog name, or the id set in words ("uncanny_blow" -> "Uncanny Blow"). */
export function boundSkillName(id, skills = null) {
  if (typeof id !== 'string' || !id) return '';
  const entry = Array.isArray(skills) ? skills.find((skill) => skill?.id === id) : null;
  if (entry?.name) return entry.name;
  return id
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The accessory's display name: "Power Ring · Vantage" when it carries a bound skill, its own
 * name otherwise. Never an identity: icons and lookups keep reading `item.name`.
 */
export function accessoryDisplayName(item, skills = null) {
  const name = typeof item?.name === 'string' ? item.name : '';
  const id = accessorySkillOf(item);
  return id ? `${name}${ACCESSORY_SKILL_SEPARATOR}${boundSkillName(id, skills)}` : name;
}

/** What the accessory's bound skill does, for its card: "Lends Vantage: <description>", or ''. */
export function accessorySkillText(item, skills = null) {
  const id = accessorySkillOf(item);
  if (!id) return '';
  const entry = Array.isArray(skills) ? skills.find((skill) => skill?.id === id) : null;
  const head = `Lends ${boundSkillName(id, skills)}`;
  return entry?.description ? `${head}: ${entry.description}` : head;
}

/**
 * The unit already has the skill its accessory lends in its equipped list, so the accessory
 * adds nothing (a lent copy of a known skill counts once). A benched skill is not equipped, so
 * the accessory still lends it.
 */
export function accessorySkillAlreadyKnown(unit, accessory = unit?.accessory) {
  const id = accessorySkillOf(accessory);
  if (!id) return false;
  return (Array.isArray(unit?.skills) ? unit.skills : []).some(
    (entry) => (typeof entry === 'string' ? entry : entry?.id) === id,
  );
}

/**
 * The line a unit's accessory adds to its skills display, or null: the skill it lends, apart
 * from the equipped list (it never counts toward MAX_SKILLS and cannot be benched or taught).
 * `known` is true when the unit already has that skill equipped, so the accessory adds nothing.
 * @returns {{ id: string, name: string, text: string, known: boolean, label: string }|null}
 */
export function lentSkillLine(unit, skills = null) {
  const id = accessorySkillOf(unit?.accessory);
  if (!id) return null;
  const entry = Array.isArray(skills) ? skills.find((skill) => skill?.id === id) : null;
  const known = accessorySkillAlreadyKnown(unit);
  return {
    id,
    name: boundSkillName(id, skills),
    text: entry?.description || '',
    known,
    label: known ? 'Already known' : 'Lent by accessory',
  };
}
