import { revivalCatchUpPlan } from './RevivalCatchUp.js';
import {
  canPromote,
  resolvePromotionTargets,
  promoteUnit,
  getSkillDisplayNames,
  withIndefiniteArticle,
  benchedSkillsNote,
} from './UnitManager.js';
import { getReviveCost } from './RunManager.js';
import { applyPromotionOath, oathBenchedNote } from './DeedSystem.js';
import { CHURCH_PROMOTE_COST_LORD, CHURCH_PROMOTE_COST_RECRUIT } from '../utils/constants.js';
import { kindleBlock } from './EclipseSystem.js';
import { churchVowBlock, commitChurchVow } from './ChurchVow.js';
/** What a church charges to promote this unit: lords pay more than everyone else. */
export function churchPromoteCost(unit) {
  return unit?.isLord ? CHURCH_PROMOTE_COST_LORD : CHURCH_PROMOTE_COST_RECRUIT;
}
export function churchPromotionBlock(run, unit, nodeId, gameData) {
  if (!run.roster.includes(unit) || !canPromote(unit)) return 'Unit is not eligible for promotion.';
  if (!resolvePromotionTargets(unit, gameData.classes, gameData.lords)?.length)
    return 'No available promotion class.';
  // One vow per church: an altar that gave a blessing promotes no one.
  const vowed = churchVowBlock(run, nodeId, 'promote');
  if (vowed) return vowed;
  const limit = run.getDifficultyModifier('churchPromotionLimit', -1);
  if (limit >= 0 && run.getChurchPromotionCount(nodeId) >= limit) return 'Promotion limit reached.';
  if (run.gold < churchPromoteCost(unit)) return 'Not enough gold.';
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
  if (!run.spendGold(churchPromoteCost(unit))) return { ok: false, reason: 'Not enough gold.' };
  const result = promoteUnit(unit, canonical, bonuses, gameData.skills);
  // A deed's Oath is sworn at the altar too.
  const oath = applyPromotionOath(unit, gameData);
  run.setChurchPromotionCount(nodeId, run.getChurchPromotionCount(nodeId) + 1);
  commitChurchVow(run, nodeId, 'promote');
  const dropped = getSkillDisplayNames(result?.droppedSkills || [], gameData.skills);
  const waits = oath?.benched ? ` ${oathBenchedNote(unit, oath)}` : '';
  return {
    ok: true,
    oath,
    message: `${unit.name} promoted to ${canonical.name}.${oath?.learned ? ` ${oath.name}: learned ${oath.skillName}.` : ''}${dropped.length ? ` ${benchedSkillsNote(dropped)}` : ''}${waits}`,
  };
}
export function churchReviveBlock(run, unit) {
  if (!run.fallenUnits.includes(unit)) return 'Unit is no longer awaiting revival.';
  return run.gold < getReviveCost(unit) ? 'Not enough gold.' : '';
}
export function reviveAtChurch(run, unit) {
  const reason = churchReviveBlock(run, unit);
  if (reason) return { ok: false, reason };
  const catchUp = revivalCatchUpPlan(unit, run.roster);
  if (!run.reviveFallenUnit(unit, getReviveCost(unit)))
    return { ok: false, reason: 'Revival unavailable.' };
  run.markDialogueShown('revive_convoy_hint');
  const learned = getSkillDisplayNames(run.lastRevivalResult?.learnedSkills, run.gameData.skills);
  const dropped = getSkillDisplayNames(run.lastRevivalResult?.droppedSkills, run.gameData.skills);
  return {
    ok: true,
    message: `${unit.name} revived at level ${unit.level} with 1 HP.${catchUp.levels ? ` Gained ${catchUp.levels} catch-up levels at growths minus 10 percentage points; future growths are unchanged.` : ''}${run.lastRevivalResult?.starterWeapon ? ` Carries ${withIndefiniteArticle(run.lastRevivalResult.starterWeapon)}.` : ''} Use Heal all, then Roster to re-equip from the convoy.${learned.length ? ` Learned: ${learned.join(', ')}.` : ''}${dropped.length ? ` ${benchedSkillsNote(dropped)}` : ''}`,
  };
}
// Kindle: pay gold to lift the Eclipse's shadow, once per church node.
export function churchKindleBlock(run, nodeId) {
  return kindleBlock({
    state: run.eclipse,
    config: run.getEclipseConfig?.(),
    nodeId,
    actId: run.currentAct,
    gold: run.gold,
  });
}
export function kindleAtChurch(run, nodeId) {
  const reason = churchKindleBlock(run, nodeId);
  if (reason) return { ok: false, reason };
  const result = run.kindleSun(nodeId);
  if (!result.ok) return result;
  return {
    ok: true,
    message: `The sun flares. Shadow −${result.removed} (now ${result.shadow}) for ${result.price} G.`,
  };
}
