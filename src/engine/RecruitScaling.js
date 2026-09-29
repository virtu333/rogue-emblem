import { RECRUIT_PROMOTION_BASE_LEVEL, BOSS_RECRUIT_PROMOTED_PENALTY } from '../utils/constants.js';
import { findCommander } from './Commander.js';

/**
 * Resolve recruit scaling targets from the current unit list.
 * The commander (isCommander flag, falling back to Edric by name) is the sole
 * scaling anchor to keep recruit sources consistent across systems. Rosters
 * with neither keep the level-1 default — findCommander never promotes
 * another lord to anchor.
 */
export function resolveRecruitScalingTargets(units) {
  const roster = Array.isArray(units) ? units : [];
  const anchor = findCommander(roster);

  const anchorLevel = Math.max(1, Math.trunc(Number(anchor?.level) || 1));
  const anchorPromotedLevel = anchor?.tier === 'promoted' ? anchorLevel : 0;
  const recruitTargetLevel =
    anchor?.tier === 'promoted' ? RECRUIT_PROMOTION_BASE_LEVEL + anchorLevel : anchorLevel;
  const dynamicPromotionLevel = RECRUIT_PROMOTION_BASE_LEVEL + anchorPromotedLevel;
  const promotedLevelTarget = Math.max(0, anchorPromotedLevel - BOSS_RECRUIT_PROMOTED_PENALTY);
  // A recruit whose promotion roll fails joins in its base class, capped here (then
  // one level lower: RecruitPromotion.getFailBaseLevel). The cap is the commander's
  // effective level (promoted = 10 + level), never below the promotion level: an
  // unpromoted Lv 16 commander used to cap a failed recruit at base Lv 9.
  const failBaseLevelCap = Math.max(dynamicPromotionLevel, recruitTargetLevel);

  return {
    anchorPromotedLevel,
    // Deprecated alias for pre-commander call sites/tests.
    edricPromotedLevel: anchorPromotedLevel,
    recruitTargetLevel,
    dynamicPromotionLevel,
    promotedLevelTarget,
    failBaseLevelCap,
  };
}

/**
 * Compute team average effective level for node-recruit scaling.
 * Promoted units count as RECRUIT_PROMOTION_BASE_LEVEL + their promoted level.
 */
export function resolveTeamAverageLevel(units) {
  const roster = Array.isArray(units) ? units : [];
  if (roster.length === 0) return 1;
  let sum = 0;
  for (const u of roster) {
    const lvl = Math.max(1, Math.trunc(Number(u?.level) || 1));
    const effective = u?.tier === 'promoted' ? RECRUIT_PROMOTION_BASE_LEVEL + lvl : lvl;
    sum += effective;
  }
  return Math.max(1, Math.floor(sum / roster.length));
}

// Backward-compatible alias for existing call sites/tests.
export const resolveRecruitPromotionTargets = resolveRecruitScalingTargets;

// The join bonus: flat stats a non-lord recruit gets once, when it is created, so it
// can stand beside the lords (playtest 2026-09-29). Act 1 closes the lords' base-stat
// head start (lords average 54.7 base points, the Act 1 recruit classes 46.5) with
// one point where that gap sits; later acts give the Act 3 readiness package. Only
// base-class recruits get it: a recruit that joins promoted has its promotion bonuses.
// `attack` is STR or MAG by the recruit's weapons; `guard` is the lower of DEF/RES.
export const RECRUIT_JOIN_BONUS = Object.freeze({
  act1: Object.freeze({ HP: 2, attack: 2, SKL: 1, SPD: 1, DEF: 1, RES: 1 }),
  act2: Object.freeze({ HP: 2, attack: 2, SPD: 1, guard: 1 }),
  act3: Object.freeze({ HP: 2, attack: 2, SPD: 1, guard: 1 }),
  act4: Object.freeze({ HP: 2, attack: 2, SPD: 1, guard: 1 }),
});
// Recruited lords keep only the Act 3 package they had before: in the early acts
// the bonus exists to close the gap to the lords, so a lord never gets it there.
const LORD_JOIN_BONUS_ACTS = new Set(['act3']);

/**
 * Creation-time bonus only; ordinary saved stats preserve it through promotion and
 * resume. Every recruit source calls it once with the act whose pool it came from:
 * recruit nodes, boss recruits, Colosseum mercenaries and the Vanguard Cadre.
 */
export function applyRecruitJoinBonus(unit, act) {
  const bonus = RECRUIT_JOIN_BONUS[act];
  if (!bonus || unit?.tier !== 'base' || !unit.stats) return;
  if (unit.isLord && !LORD_JOIN_BONUS_ACTS.has(act)) return;
  const type =
    unit.proficiencies?.find((p) => p.type !== 'Staff')?.type || unit.proficiencies?.[0]?.type;
  const attack = ['Tome', 'Light', 'Staff'].includes(type) ? 'MAG' : 'STR';
  const guard = unit.stats.DEF <= unit.stats.RES ? 'DEF' : 'RES';
  for (const [key, value] of Object.entries(bonus)) {
    const stat = key === 'attack' ? attack : key === 'guard' ? guard : key;
    unit.stats[stat] = (unit.stats[stat] || 0) + value;
  }
  if (bonus.HP) unit.currentHP = (Number(unit.currentHP) || 0) + bonus.HP;
}
