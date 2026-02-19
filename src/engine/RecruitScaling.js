import { RECRUIT_PROMOTION_BASE_LEVEL, BOSS_RECRUIT_PROMOTED_PENALTY } from '../utils/constants.js';

/**
 * Resolve recruit scaling targets from the current unit list.
 * Edric is the sole scaling anchor to keep recruit sources consistent across systems.
 */
export function resolveRecruitScalingTargets(units) {
  const roster = Array.isArray(units) ? units : [];
  const edric =
    roster.find(
      (unit) => typeof unit?.name === 'string' && unit.name.trim().toLowerCase() === 'edric',
    ) || null;

  const edricLevel = Math.max(1, Math.trunc(Number(edric?.level) || 1));
  const edricPromotedLevel = edric?.tier === 'promoted' ? edricLevel : 0;
  const recruitTargetLevel =
    edric?.tier === 'promoted' ? RECRUIT_PROMOTION_BASE_LEVEL + edricLevel : edricLevel;
  const dynamicPromotionLevel = RECRUIT_PROMOTION_BASE_LEVEL + edricPromotedLevel;
  const promotedLevelTarget = Math.max(0, edricPromotedLevel - BOSS_RECRUIT_PROMOTED_PENALTY);

  return {
    edricPromotedLevel,
    recruitTargetLevel,
    dynamicPromotionLevel,
    promotedLevelTarget,
  };
}

// Backward-compatible alias for existing call sites/tests.
export const resolveRecruitPromotionTargets = resolveRecruitScalingTargets;
