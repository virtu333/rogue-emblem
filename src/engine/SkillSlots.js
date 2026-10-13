// SkillSlots — the two kinds of equipped skill slot (owner, 2026-10-11).
//
// `unit.skills` stays ONE list (every battle read and every save keeps its shape), but its
// entries are counted in two pools: up to MAX_SKILLS skills (passives, auras, combat procs)
// and up to MAX_ABILITIES abilities. An ability is a skill the unit USES as its action:
// `trigger: "action"` in skills.json (Shove, Pull, Dance, Steal, Blink, Blink Strike, Smite,
// ...). A class innate ability (a Thief's Steal, a Dancer's Dance) so fills an ability slot,
// never one of the five. Skills lent by a weapon or an accessory count toward neither
// (EffectiveSkills.js).
//
// The kind is read from skills.json, the one source (an id the data does not know counts as
// a skill). Pure: no Phaser, no RNG.
import defaults from '../../data/skills.json' with { type: 'json' };
import { MAX_ABILITIES, MAX_SKILLS } from '../utils/constants.js';

export const SKILL_SLOT = 'skill';
export const ABILITY_SLOT = 'ability';

const abilityIdsByData = new WeakMap();

function abilityIds(skillsData) {
  const data = Array.isArray(skillsData) ? skillsData : defaults;
  let ids = abilityIdsByData.get(data);
  if (!ids) {
    ids = new Set(data.filter((s) => s?.trigger === 'action' && s.id).map((s) => s.id));
    abilityIdsByData.set(data, ids);
  }
  return ids;
}

/** Whether a skill id is an ability (fills an ability slot). */
export function isAbilitySkill(skillId, skillsData = defaults) {
  return abilityIds(skillsData).has(skillId);
}

// The rule before the split (#344), for a paired balance sim only (sim/descent.js `--slots
// single`): every equipped entry, ability or not, counts in one pool of MAX_SKILLS. The game
// never sets it.
let singlePool = false;

/** Sims only: count abilities in the skill pool (the pre-#344 rule) while `on`. */
export function setSingleSlotPoolForSims(on) {
  singlePool = Boolean(on);
}

/** 'ability' or 'skill': which pool a skill id is counted in. */
export function slotKindOf(skillId, skillsData = defaults) {
  if (singlePool) return SKILL_SLOT;
  return isAbilitySkill(skillId, skillsData) ? ABILITY_SLOT : SKILL_SLOT;
}

/** How many slots a kind has. */
export function slotCapOf(kind) {
  return kind === ABILITY_SLOT ? MAX_ABILITIES : MAX_SKILLS;
}

/** The equipped ids of one kind, in list order. */
export function equippedOfKind(unit, kind, skillsData = defaults) {
  const skills = Array.isArray(unit?.skills) ? unit.skills : [];
  return skills.filter((id) => slotKindOf(id, skillsData) === kind);
}

/** `{ skills, abilities }`: how many of each kind the unit has equipped. */
export function slotCountsOf(unit, skillsData = defaults) {
  return {
    skills: equippedOfKind(unit, SKILL_SLOT, skillsData).length,
    abilities: equippedOfKind(unit, ABILITY_SLOT, skillsData).length,
  };
}

/** Whether every slot of `skillId`'s kind is taken. */
export function slotsFullFor(unit, skillId, skillsData = defaults) {
  const kind = slotKindOf(skillId, skillsData);
  return equippedOfKind(unit, kind, skillsData).length >= slotCapOf(kind);
}

/** "skill slots" / "ability slots", with the count: "all 5 skill slots". */
export function slotNoun(kind) {
  return kind === ABILITY_SLOT ? 'ability slots' : 'skill slots';
}

/** "all 5 skill slots" / "all 3 ability slots". */
export function allSlotsPhrase(kind) {
  return `all ${slotCapOf(kind)} ${slotNoun(kind)}`;
}

/**
 * What filled up for skills that just arrived on the bench: "all 3 ability slots" when
 * they are all of one kind, else "its slots".
 */
export function benchArrivalPhrase(ids, skillsData = defaults) {
  const kinds = new Set((ids || []).map((id) => slotKindOf(id, skillsData)));
  return kinds.size === 1 ? allSlotsPhrase([...kinds][0]) : 'its slots';
}

/** One short loadout line: "Skills 4/5 · Abilities 1/3". */
export function slotCountsLine(unit, skillsData = defaults) {
  const { skills, abilities } = slotCountsOf(unit, skillsData);
  return `Skills ${skills}/${MAX_SKILLS} · Abilities ${abilities}/${MAX_ABILITIES}`;
}

/**
 * The equipped list in display groups, skills first: `[{ kind, title, ids, cap }]`, each
 * group present only when it holds something ("Skills", "Abilities").
 */
export function equippedGroups(unit, skillsData = defaults) {
  return [SKILL_SLOT, ABILITY_SLOT]
    .map((kind) => ({
      kind,
      title: kind === ABILITY_SLOT ? 'Abilities' : 'Skills',
      ids: equippedOfKind(unit, kind, skillsData),
      cap: slotCapOf(kind),
    }))
    .filter((group) => group.ids.length);
}

/**
 * Bench whatever overflows a pool (a save from before the split could hold up to five
 * abilities). Locked skills (`locked`, a Set: a lord's own, the class line's innates) are
 * kept first; the rest keep list order, so the overflow is always the same entries. Returns
 * the benched ids (also marked unseen, so the roster's notice says so).
 */
export function benchSlotOverflow(unit, { locked = new Set(), skillsData = defaults } = {}) {
  if (!unit || !Array.isArray(unit.skills) || unit.faction === 'enemy') return [];
  const benched = [];
  for (const kind of [ABILITY_SLOT, SKILL_SLOT]) {
    const ids = equippedOfKind(unit, kind, skillsData);
    const cap = slotCapOf(kind);
    if (ids.length <= cap) continue;
    const keep = new Set(
      [...ids.filter((id) => locked.has(id)), ...ids.filter((id) => !locked.has(id))].slice(0, cap),
    );
    for (const id of ids) if (!keep.has(id)) benched.push(id);
  }
  if (!benched.length) return [];
  const out = new Set(benched);
  unit.skills = unit.skills.filter((id) => !out.has(id));
  const bench = Array.isArray(unit.benchedSkills) ? unit.benchedSkills : [];
  unit.benchedSkills = [...bench, ...benched.filter((id) => !bench.includes(id))];
  const unseen = Array.isArray(unit.benchedUnseen) ? unit.benchedUnseen : [];
  unit.benchedUnseen = [...unseen.filter((id) => !out.has(id)), ...benched];
  return benched;
}
