import {
  canPromote,
  resolvePromotionTargets,
  promoteUnit,
  getSkillDisplayNames,
} from './UnitManager.js';
import { getReviveCost } from './RunManager.js';
import { CHURCH_PROMOTE_COST } from '../utils/constants.js';
export function churchPromotionBlock(run, unit, nodeId, gameData) {
  if (!run.roster.includes(unit) || !canPromote(unit)) return 'Unit is not eligible for promotion.';
  if (!resolvePromotionTargets(unit, gameData.classes, gameData.lords)?.length)
    return 'No available promotion class.';
  const limit = run.getDifficultyModifier('churchPromotionLimit', -1);
  if (limit >= 0 && run.getChurchPromotionCount(nodeId) >= limit) return 'Promotion limit reached.';
  if (run.gold < CHURCH_PROMOTE_COST) return 'Not enough gold.';
  return '';
}
export function promoteAtChurch(run, unit, nodeId, target, gameData) {
  const reason = churchPromotionBlock(run, unit, nodeId, gameData);
  if (reason) return { ok: false, reason };
  const canonical = resolvePromotionTargets(unit, gameData.classes, gameData.lords).find(
    (c) => c.name === target?.name,
  );
  const bonuses =
    gameData.lords.find((l) => l.name === unit.name)?.promotionBonuses ||
    canonical?.promotionBonuses;
  if (!canonical || !bonuses) return { ok: false, reason: 'Promotion unavailable.' };
  if (!run.spendGold(CHURCH_PROMOTE_COST)) return { ok: false, reason: 'Not enough gold.' };
  const result = promoteUnit(unit, canonical, bonuses, gameData.skills);
  run.setChurchPromotionCount(nodeId, run.getChurchPromotionCount(nodeId) + 1);
  const dropped = getSkillDisplayNames(result?.droppedSkills, gameData.skills);
  return {
    ok: true,
    message: `${unit.name} promoted to ${canonical.name}.${dropped.length ? ` Skill limit: could not learn ${dropped.join(', ')}.` : ''}`,
  };
}
export function churchReviveBlock(run, unit) {
  if (!run.fallenUnits.includes(unit)) return 'Unit is no longer awaiting revival.';
  if (run.roster.length >= run.getRosterCap()) return 'Roster full.';
  return run.gold < getReviveCost(unit) ? 'Not enough gold.' : '';
}
export function reviveAtChurch(run, unit) {
  const reason = churchReviveBlock(run, unit);
  if (reason) return { ok: false, reason };
  if (!run.reviveFallenUnit(unit.name, getReviveCost(unit)))
    return { ok: false, reason: 'Revival unavailable.' };
  run.markDialogueShown('revive_convoy_hint');
  return {
    ok: true,
    message: `${unit.name} revived with 1 HP. Use Heal all, then Roster to re-equip from the convoy.`,
  };
}
