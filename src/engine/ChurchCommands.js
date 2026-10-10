import { specialCharacterRefusalText } from './SpecialCharacterDialogue.js';
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
import { endWoundByHealing, injuryPhrase } from './Burdens.js';
import { healUnitFully } from './UnitHealth.js';
import { applyKingmakerBonus, kingmakerOf } from './TwistedBoons.js';
/**
 * What a church charges to promote this unit: lords pay more than everyone else; nothing while
 * the run holds Kingmaker's Oath (docs/specs/blessings-v3.md §6.2). `run` may be left out (no
 * blessing then).
 */
export function churchPromoteCost(unit, run = null) {
  if (kingmakerOf(run)) return 0;
  return unit?.isLord ? CHURCH_PROMOTE_COST_LORD : CHURCH_PROMOTE_COST_RECRUIT;
}
export function churchPromotionBlock(run, unit, nodeId, gameData) {
  if (run.roster.includes(unit)) {
    const refusal = specialCharacterRefusalText(gameData, unit, 'promote');
    if (refusal) return refusal;
  }
  if (!run.roster.includes(unit) || !canPromote(unit)) return 'Unit is not eligible for promotion.';
  if (!resolvePromotionTargets(unit, gameData.classes, gameData.lords)?.length)
    return 'No available promotion class.';
  // One vow per church: an altar that gave a blessing promotes no one.
  const vowed = churchVowBlock(run, nodeId, 'promote');
  if (vowed) return vowed;
  const limit = run.getDifficultyModifier('churchPromotionLimit', -1);
  if (limit >= 0 && run.getChurchPromotionCount(nodeId) >= limit) return 'Promotion limit reached.';
  if (run.gold < churchPromoteCost(unit, run)) return 'Not enough gold.';
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
  const cost = churchPromoteCost(unit, run);
  if (cost > 0 && !run.spendGold(cost)) return { ok: false, reason: 'Not enough gold.' };
  const result = promoteUnit(unit, canonical, bonuses, gameData.skills);
  // Kingmaker's Oath: the altar adds to the stats the class's own promotion favours (its
  // canonical bonuses, a lord's too; never Move).
  const crowned = applyKingmakerBonus(run, unit, canonical.promotionBonuses || bonuses);
  // A deed's Oath is sworn at the altar too.
  const oath = applyPromotionOath(unit, gameData);
  run.setChurchPromotionCount(nodeId, run.getChurchPromotionCount(nodeId) + 1);
  commitChurchVow(run, nodeId, 'promote');
  const dropped = getSkillDisplayNames(result?.droppedSkills || [], gameData.skills);
  const waits = oath?.benched ? ` ${oathBenchedNote(unit, oath)}` : '';
  const kingmaker = crowned.length
    ? ` Kingmaker's Oath: ${crowned.map((c) => `+${c.value} ${c.stat}`).join(', ')}.`
    : '';
  return {
    ok: true,
    oath,
    kingmaker: crowned,
    message: `${unit.name} promoted to ${canonical.name}.${kingmaker}${oath?.learned ? ` ${oath.name}: learned ${oath.skillName}.` : ''}${dropped.length ? ` ${benchedSkillsNote(dropped)}` : ''}${waits}`,
  };
}
/**
 * Heal everyone, free: every unit to full HP. A Lingering Injury burden (engine/Burdens.js, id `wounded`) whose unit
 * the heal reaches mends with it: "Heal all" counts. Shared by the church and the sanctuary's
 * Rest, so an injury ends the same way at either.
 * @returns {{ ok: true, mended: object|null, message: string }}
 */
export function healRosterAtChurch(run) {
  for (const unit of run.roster || []) {
    if (!unit?.stats) continue;
    healUnitFully(unit);
  }
  const mended = endWoundByHealing(run, run.roster);
  return {
    ok: true,
    mended,
    message: mended ? `All units healed. ${injuryPhrase(mended)} mends.` : 'All units healed.',
  };
}
export function churchReviveBlock(run, unit) {
  if (!run.fallenUnits.includes(unit)) return 'Unit is no longer awaiting revival.';
  // Forbidden Tome's pact (docs/specs/blessings-v3.md §4): the dead stay dead.
  if (run.isChurchReviveDisabled?.()) return 'Your pact forbids it: the fallen stay fallen.';
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
