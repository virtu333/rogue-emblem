import {
  BASE_CLASS_LEVEL_CAP,
  BOSS_RECRUIT_PROMOTION_CHANCE_BASE,
  NODE_RECRUIT_PROMOTION_CHANCE_BASE,
  RECRUIT_PROMOTION_CHANCE_CAP,
} from '../utils/constants.js';

export const RECRUIT_PROMOTION_CONTEXT = {
  BOSS: 'boss',
  RECRUIT_NODE: 'recruitNode',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveContextKey(context) {
  if (typeof context === 'string') return context;
  if (context && typeof context === 'object') {
    if (typeof context.type === 'string') return context.type;
    if (typeof context.source === 'string') return context.source;
    if (typeof context.context === 'string') return context.context;
  }
  return RECRUIT_PROMOTION_CONTEXT.RECRUIT_NODE;
}

function resolveClassesData(context) {
  if (context && typeof context === 'object' && Array.isArray(context.classesData)) {
    return context.classesData;
  }
  return null;
}

function getBaseChanceByContext(context) {
  const key = resolveContextKey(context);
  if (key === RECRUIT_PROMOTION_CONTEXT.BOSS) return BOSS_RECRUIT_PROMOTION_CHANCE_BASE;
  if (key === RECRUIT_PROMOTION_CONTEXT.RECRUIT_NODE) return NODE_RECRUIT_PROMOTION_CHANCE_BASE;
  return NODE_RECRUIT_PROMOTION_CHANCE_BASE;
}

function normalizeRoll(roll) {
  if (!Number.isFinite(roll)) return 1;
  return clamp(roll, 0, 1);
}

function getRngRoll(rng) {
  if (typeof rng === 'function') return normalizeRoll(Number(rng()));
  return normalizeRoll(Math.random());
}

export function isPromotedRecruitSource(classData, classesData) {
  if (!classData || classData.tier !== 'promoted') return false;
  const baseClassName = classData.promotesFrom;
  if (typeof baseClassName !== 'string' || baseClassName.trim().length === 0) return false;
  if (!Array.isArray(classesData) || classesData.length === 0) return true;
  return classesData.some((candidate) => candidate?.name === baseClassName);
}

export function getRecruitPromotionChance(context, metaEffects) {
  const baseChance = getBaseChanceByContext(context);
  const metaBonus = Number(metaEffects?.recruitPromotionChanceBonus) || 0;
  return clamp(baseChance + metaBonus, 0, RECRUIT_PROMOTION_CHANCE_CAP);
}

export function rollRecruitPromotion(context, classData, metaEffects, rng) {
  const classesData = resolveClassesData(context);
  const eligible = isPromotedRecruitSource(classData, classesData);
  if (!eligible) {
    return {
      eligible: false,
      promote: false,
      effectiveChance: 0,
      roll: null,
      baseClassName: null,
    };
  }

  const effectiveChance = getRecruitPromotionChance(context, metaEffects);
  const roll = getRngRoll(rng);
  return {
    eligible: true,
    promote: roll < effectiveChance,
    effectiveChance,
    roll,
    baseClassName: classData.promotesFrom,
  };
}

export function getFailBaseLevel(targetLevel, dynamicPromotionLevel) {
  const cappedTarget = clamp(Number(targetLevel) || 1, 1, BASE_CLASS_LEVEL_CAP);
  const cappedPromotion = clamp(Number(dynamicPromotionLevel) || 1, 1, BASE_CLASS_LEVEL_CAP);
  const sourceLevel = Math.min(cappedTarget, cappedPromotion, BASE_CLASS_LEVEL_CAP);
  return clamp(sourceLevel - 1, 1, BASE_CLASS_LEVEL_CAP);
}
