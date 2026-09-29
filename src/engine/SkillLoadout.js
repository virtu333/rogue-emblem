// SkillLoadout — which known skills a unit takes into battle (playtest 2026-09-28).
//
// A unit's `skills` are its equipped skills (at most MAX_SKILLS; everything in battle
// reads only these) and `benchedSkills` the ones it knows but has set aside.
// learnSkill (UnitManager) benches a skill that arrives with every slot full, so a
// class skill, an Oath or a scroll is never lost; between battles the roster moves
// skills between the two lists here. Pure: no Phaser, no RNG.
//
// Locked skills cannot be benched once equipped: a lord's own skills and the skills
// its class line grants innately (the same ones the act-transition restore
// protects). One that arrives with every slot full waits on the bench like any other.
//
// `benchedUnseen` lists skills benched since the player last looked at the unit's
// Skills tab: the roster's notice, its unit flag and the route map's Roster pip.

import { MAX_SKILLS } from '../utils/constants.js';
import { benchedSkillsOf, getClassInnateSkills, learnSkill } from './UnitManager.js';
import { unitBaseClassName } from './ClassLineage.js';

/** Parse "Charisma: Allies..." to its skill id ("charisma"), as RunManager does. */
function personalSkillId(text) {
  if (typeof text !== 'string' || !text) return null;
  const colon = text.indexOf(':');
  const name = (colon > 0 ? text.slice(0, colon) : text).trim();
  return name ? name.toLowerCase().replace(/\s+/g, '_') : null;
}

/** Skills that can't be benched: a lord's own, and the class line's innates. */
export function lockedSkillIds(unit, gameData = {}) {
  const locked = new Set();
  const lord = unit?.isLord ? (gameData.lords || []).find((l) => l?.name === unit.name) : null;
  const personal = personalSkillId(lord?.personalSkill);
  if (personal) locked.add(personal);
  if (lord?.personalSkillL20?.skillId) locked.add(lord.personalSkillL20.skillId);
  if (unit?._personalSkillL20?.skillId) locked.add(unit._personalSkillL20.skillId);
  const skillsData = gameData.skills || [];
  for (const id of getClassInnateSkills(unit?.className, skillsData)) locked.add(id);
  const base = unit?.tier === 'promoted' ? unitBaseClassName(unit, gameData.classes) : null;
  if (base) for (const id of getClassInnateSkills(base, skillsData)) locked.add(id);
  return locked;
}

/** Why `skillId` cannot be benched now, or ''. */
export function benchSkillBlock(unit, skillId, gameData = {}) {
  if (!unit?.skills?.includes(skillId)) return 'That skill is not equipped.';
  if (lockedSkillIds(unit, gameData).has(skillId))
    return unit?.isLord
      ? 'Lord and class skills can’t be benched.'
      : 'Class skills can’t be benched.';
  return '';
}

/**
 * Why `skillId` cannot be equipped now (swapping out `replaceId` when every slot is
 * full), or ''.
 */
export function equipSkillBlock(unit, skillId, replaceId = null, gameData = {}) {
  if (!benchedSkillsOf(unit).includes(skillId)) return 'That skill is not on the bench.';
  const full = (unit.skills?.length || 0) >= MAX_SKILLS;
  if (!full) return replaceId == null ? '' : benchSkillBlock(unit, replaceId, gameData);
  if (replaceId == null) return `All ${MAX_SKILLS} slots are full: choose a skill to bench.`;
  return benchSkillBlock(unit, replaceId, gameData);
}

/** Move an equipped skill to the bench. Returns '' or the reason it was refused. */
export function benchSkill(unit, skillId, gameData = {}) {
  const reason = benchSkillBlock(unit, skillId, gameData);
  if (reason) return reason;
  unit.skills = unit.skills.filter((id) => id !== skillId);
  unit.benchedSkills = [...benchedSkillsOf(unit), skillId];
  return '';
}

/**
 * Equip a benched skill; with every slot full, `replaceId` goes to the bench and the
 * new skill takes its place in the list. Returns '' or the reason it was refused.
 */
export function equipSkill(unit, skillId, replaceId = null, gameData = {}) {
  const reason = equipSkillBlock(unit, skillId, replaceId, gameData);
  if (reason) return reason;
  const bench = benchedSkillsOf(unit).filter((id) => id !== skillId);
  if (replaceId != null) {
    unit.skills = unit.skills.map((id) => (id === replaceId ? skillId : id));
    bench.push(replaceId);
  } else unit.skills = [...unit.skills, skillId];
  unit.benchedSkills = bench;
  unit.benchedUnseen = (unit.benchedUnseen || []).filter((id) => id !== skillId);
  return '';
}

/** Skills benched since the player last looked at this unit's skills. */
export function unseenBenchedSkills(unit) {
  const bench = benchedSkillsOf(unit);
  return (Array.isArray(unit?.benchedUnseen) ? unit.benchedUnseen : []).filter((id) =>
    bench.includes(id),
  );
}

/** The player looked at the unit's skills: nothing on its bench is new any more. */
export function markBenchSeen(unit) {
  if (!unit || !unseenBenchedSkills(unit).length) return false;
  delete unit.benchedUnseen;
  return true;
}

/** How many units in a roster have a new skill on the bench. */
export function rosterBenchedUnseen(roster) {
  return (Array.isArray(roster) ? roster : []).filter((u) => unseenBenchedSkills(u).length).length;
}

/**
 * Saves from before the bench: an Oath waiting for a free slot (deeds.waitingOath) is
 * sworn now, equipped if a slot is free and benched otherwise. Returns whether the
 * unit changed.
 */
export function migrateWaitingOath(unit) {
  const deeds = unit?.deeds;
  const waiting = deeds?.waitingOath;
  if (!waiting || typeof waiting.skillId !== 'string') return false;
  learnSkill(unit, waiting.skillId);
  const { waitingOath: _dropped, ...rest } = deeds;
  unit.deeds = { ...rest, oath: { ...waiting } };
  return true;
}
