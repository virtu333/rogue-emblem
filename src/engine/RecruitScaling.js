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

  return {
    anchorPromotedLevel,
    // Deprecated alias for pre-commander call sites/tests.
    edricPromotedLevel: anchorPromotedLevel,
    recruitTargetLevel,
    dynamicPromotionLevel,
    promotedLevelTarget,
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
