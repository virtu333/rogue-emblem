import {
  XP_STAT_NAMES,
  BASE_CLASS_LEVEL_CAP,
  PROMOTED_CLASS_LEVEL_CAP,
} from '../utils/constants.js';
import {
  getXpEffectiveLevel,
  levelUp,
  applyLevelUpGains,
  checkLevelUpSkills,
} from './UnitManager.js';

export const REVIVAL_GROWTH_PENALTY = 10;

// Use the existing XP tier equivalence (promoted +12); never grant a free promotion.
export function revivalCatchUpPlan(unit, roster = []) {
  const living = roster.filter((u) => u !== unit && u.currentHP > 0);
  const current = Math.max(1, Math.trunc(Number(unit.level) || 1));
  const average = living.length
    ? Math.floor(living.reduce((sum, u) => sum + getXpEffectiveLevel(u), 0) / living.length)
    : getXpEffectiveLevel(unit);
  const tierOffset = getXpEffectiveLevel(unit) - current;
  const cap = unit.tier === 'promoted' ? PROMOTED_CLASS_LEVEL_CAP : BASE_CLASS_LEVEL_CAP;
  const targetLevel = Math.max(current, Math.min(cap, average - tierOffset));
  return { fromLevel: current, targetLevel, levels: targetLevel - current };
}

export function applyRevivalCatchUp(unit, roster, classes = [], rng = Math.random) {
  const plan = revivalCatchUpPlan(unit, roster);
  const reduced = Object.fromEntries(
    XP_STAT_NAMES.map((stat) => [
      stat,
      Math.max(0, (Number(unit.growths?.[stat]) || 0) - REVIVAL_GROWTH_PENALTY),
    ]),
  );
  // Roll with a temporary growth view: normal future growths are never mutated.
  for (let i = 0; i < plan.levels; i++) {
    const result = levelUp({ ...unit, growths: reduced }, rng);
    if (!result) break;
    applyLevelUpGains(unit, result);
  }
  const droppedSkills = [];
  const learnedSkills = plan.levels ? checkLevelUpSkills(unit, classes, droppedSkills) : [];
  return { ...plan, learnedSkills, droppedSkills };
}
