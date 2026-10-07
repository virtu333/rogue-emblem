// EffectiveSkills.js — the one read of "which skills does this unit have in battle?"
// (docs/specs/phase3.md 3A). Pure, no Phaser.
//
// A unit's skills in battle come from three places, in this order:
//   1. `unit.skills`: the equipped list (never `unit.benchedSkills`: a benched skill is
//      known but set aside, so it does nothing in battle),
//   2. the weapon in use's `_grantedSkill` (a legendary weapon's bound skill),
//   3. the equipped accessory's `_boundSkill` (a Bond Ring's rolled skill, Phase 3H).
// The result is de-duplicated and keeps that order, so a bound skill the unit already has is
// counted once: an aura is one aura, a proc rolls once.
//
// A bound skill is lent, not learned. It is not in `unit.skills`, does not count toward
// MAX_SKILLS, leaves with the weapon or ring, and `knowsSkill` (UnitManager) does not see it:
// `knowsSkill` stays the test for learning, teaching and the roster. Every BATTLE read of a
// unit's skills goes through this module; reads of `unit.skills` that edit or display the
// loadout (SkillLoadout, learnSkill, the roster, serialization) stay on the list.
// `tests/EffectiveSkillsBoundary.test.js` holds that line.
//
// `weapon` defaults to the unit's equipped weapon. A read that plans with another weapon (the
// attack forecast, a range check on an inventory weapon, `getSkillCombatMods`'s
// `context.weapon`) passes it, and `null` means "no weapon", so no weapon grant.

function skillId(entry) {
  if (typeof entry === 'string') return entry;
  return typeof entry?.id === 'string' ? entry.id : null;
}

/**
 * The skill ids a unit has in battle: its equipped skills, then the weapon's granted
 * skill, then the accessory's bound skill. De-duplicated, order kept, never benched.
 * @param {object|null} unit
 * @param {{ weapon?: object|null }} [opts] weapon in use; omitted = the equipped weapon
 * @returns {string[]}
 */
export function effectiveSkills(unit, { weapon } = {}) {
  if (!unit) return [];
  const ids = [];
  const add = (entry) => {
    const id = skillId(entry);
    if (id && !ids.includes(id)) ids.push(id);
  };
  if (Array.isArray(unit.skills)) for (const entry of unit.skills) add(entry);
  const inUse = weapon !== undefined ? weapon : unit.weapon;
  add(inUse?._grantedSkill);
  add(unit.accessory?._boundSkill);
  return ids;
}

/**
 * Does the unit have this skill in battle (see effectiveSkills)?
 * @param {object|null} unit
 * @param {string} id
 * @param {{ weapon?: object|null }} [opts]
 * @returns {boolean}
 */
export function hasEffectiveSkill(unit, id, opts = {}) {
  return effectiveSkills(unit, opts).includes(id);
}
