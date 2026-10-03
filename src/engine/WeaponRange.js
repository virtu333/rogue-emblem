// WeaponRange — what range skills add to a weapon (Foresight: +1 on Tome, Light and
// Breath). Combat.getEffectiveWeaponRange adds it to the weapon's own range, and that
// one range is used to attack (AttackOptions: targeting, reach previews) and to counter
// (Combat.canCounter), whatever the unit's faction. Pure, and it imports nothing from
// Combat or SkillSystem (both import it).
//
// The bonus is read from the skills data. A caller that forgets the data for a unit with
// a range skill would quietly lose the bonus, and a forecast built without it would
// disagree with the combat that resolves with it; so that is a programming error, never
// a silent 0 (missingRangeSkillsData).

/** Skills whose effect is a weapon range bonus (handled below). */
export const RANGE_SKILL_IDS = Object.freeze(['foresight']);

const RANGE_SKILL_WEAPON_TYPES = new Set(['Tome', 'Light', 'Breath']);
const IS_DEV = Boolean(import.meta?.env?.DEV);
let warnedMissingData = false;

/** True when the unit has a range skill equipped (unit.skills: what battle reads). */
export function hasRangeSkill(unit) {
  return Array.isArray(unit?.skills) && unit.skills.some((id) => RANGE_SKILL_IDS.includes(id));
}

/**
 * The skills data is missing (or lacks the skill) for a unit whose range depends on it.
 * In development and tests this throws: a caller must pass the full skills data. A
 * shipped build warns once and falls back to the weapon's own range rather than stop
 * the battle.
 */
function missingRangeSkillsData(unit, skillId) {
  const message = `[WeaponRange] skillsData with '${skillId}' is required for ${unit?.name || 'a unit'}'s range`;
  if (IS_DEV) throw new Error(message);
  if (!warnedMissingData) {
    warnedMissingData = true;
    console.warn(message);
  }
}

/**
 * Range a unit's skills add to `weapon` (0 for none). `skillsData` is the full skills
 * array; it may be omitted only for a unit without a range skill.
 */
export function getWeaponRangeBonus(unit, weapon, skillsData) {
  if (!weapon || !hasRangeSkill(unit)) return 0;
  let bonus = 0;
  for (const skillId of unit.skills) {
    if (!RANGE_SKILL_IDS.includes(skillId)) continue;
    const skill = Array.isArray(skillsData) ? skillsData.find((s) => s.id === skillId) : null;
    if (!skill) {
      missingRangeSkillsData(unit, skillId);
      continue;
    }
    if (skill.trigger !== 'passive') continue;
    if (skill.id === 'foresight' && skill.effects?.tomeRangeBonus) {
      if (RANGE_SKILL_WEAPON_TYPES.has(weapon.type)) bonus += skill.effects.tomeRangeBonus;
    }
  }
  return bonus;
}
