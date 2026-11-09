// SkillNames.js - a skill's display name, read from skills.json. Pure, no imports.
//
// Skill ids never change; names can (the naming pass, docs/specs/item-names.md). Proc banners
// and timeline facts show the name, and ProcVisualTheme looks the skill back up by it, so code
// takes it from the data, never from a copy. A caller without skill data falls back to
// RENAMED_SKILL_NAMES, which tests/SkillNames.test.js holds to skills.json.

/**
 * Every skill whose name is not its id set in words ("sol" is "Reclaim", not "Sol"): the
 * fallback for callers without skills.json at hand.
 */
export const RENAMED_SKILL_NAMES = Object.freeze({
  sol: 'Reclaim',
  luna: 'Umbra',
  astra: 'Constellation',
  vantage: 'Forestall',
  wrath: 'Seethe',
  crit_plus_15: 'Cold Eye',
  sure_shot: 'True Aim',
  lethality: 'Fell Stroke',
  pavise: 'Shieldwall',
  aegis: 'Spellward',
  colossus: 'Juggernaut',
  adept: 'Flurry',
  miracle: 'Reprieve',
  cancel: 'Stifle',
  desperation: "Death's Door",
  quick_riposte: 'Riposte',
  death_blow: 'Onslaught',
  darting_blow: 'Quickstep',
  aether: 'Corona',
  flare: 'Immolation',
  armored_blow: 'Iron Advance',
  fiendish_blow: 'Hellfire Charge',
  lifetaker: "Reaper's Due",
  speedtaker: 'Quickening',
  warding_blow: 'Warded Advance',
  goddess_dance: 'Dawn Dance',
  rally_cry_skill: 'Rally Cry',
  half_canto: 'Parting Step',
  commanders_gambit: "Commander's Gambit",
  zombie_drain: 'Life Drain',
});

/** The id set in words: "uncanny_blow" -> "Uncanny Blow". */
export function skillIdInWords(skillId) {
  return String(skillId ?? '')
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** The name skills.json gives `skillId` when no data is at hand. */
export function fallbackSkillName(skillId) {
  return Object.hasOwn(RENAMED_SKILL_NAMES, skillId)
    ? RENAMED_SKILL_NAMES[skillId]
    : skillIdInWords(skillId);
}

/** The display name of skill `skillId`, or `fallback` when the data does not list it. */
export function skillDisplayName(skillId, skillsData, fallback = fallbackSkillName(skillId)) {
  return (Array.isArray(skillsData) && skillsData.find((s) => s.id === skillId)?.name) || fallback;
}

/**
 * The special text of a weapon that grants a skill (a random legendary's), naming the skill as
 * skills.json does today: "Grants Reclaim to wielder".
 */
export function grantedSkillSpecial(skillId, skillsData = null) {
  return `Grants ${skillDisplayName(skillId, skillsData)} to wielder`;
}

// The names the random legendaries' skills had before the naming pass (their pool).
const OLD_GRANTED_SKILL_IDS = Object.freeze({
  Sol: 'sol',
  Luna: 'luna',
  Vantage: 'vantage',
  Wrath: 'wrath',
  Adept: 'adept',
});

/**
 * A saved "Grants Sol to wielder" said in today's words ("Grants Reclaim to wielder"); any
 * other text is returned as it is. The item-name migration reads only the text, never the
 * item's granted skill (EffectiveSkills is its one reader).
 */
export function renameGrantedSkillSpecial(special, skillsData = null) {
  const match = typeof special === 'string' ? /^Grants (.+) to wielder$/.exec(special) : null;
  if (!match || !Object.hasOwn(OLD_GRANTED_SKILL_IDS, match[1])) return special;
  return grantedSkillSpecial(OLD_GRANTED_SKILL_IDS[match[1]], skillsData);
}
