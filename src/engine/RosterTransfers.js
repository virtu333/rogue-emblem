import { MAX_SKILLS } from '../utils/constants.js';
import { learnSkill } from './UnitManager.js';
import { planTrade, applyTrade, unitHolder, TRADE_REASONS } from './ItemTrade.js';

export function teachScrollBlock(run, unit, scroll, skills) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  if (!run.scrolls?.includes(scroll)) return 'Scroll is no longer available.';
  if (scroll.teachesWeaponArtId || !skills.some((s) => s.id === scroll.skillId))
    return 'Choose a skill scroll.';
  if (unit.skills.includes(scroll.skillId)) return 'Already known.';
  if (unit.skills.length >= MAX_SKILLS) return `Skill slots full (${MAX_SKILLS}/${MAX_SKILLS}).`;
  return '';
}
export function teachRosterScroll(run, unit, scroll, skills) {
  const reason = teachScrollBlock(run, unit, scroll, skills);
  if (reason) return { ok: false, reason };
  const result = learnSkill(unit, scroll.skillId);
  if (!result.learned)
    return {
      ok: false,
      reason: result.reason === 'already_known' ? 'Already known.' : 'Skill slots full.',
    };
  run.scrolls.splice(run.scrolls.indexOf(scroll), 1);
  return { ok: true };
}
/** Unit-to-unit give between battles (the Give… picker); a thin wrapper over ItemTrade. */
function giveSlots(source, target, item) {
  const bag = item?.type === 'Consumable' ? 'consumables' : 'inventory';
  return [
    { holder: unitHolder(source), bag, item },
    { holder: unitHolder(target), bag, item: null },
  ];
}
function giveReason(reason) {
  // The picker lists the giver too; keep its row's wording.
  return reason === TRADE_REASONS.sameHolder ? 'Already carried by this unit.' : reason;
}
export function giveRosterItemBlock(run, source, target, item) {
  // Trading permits carrying an unusable weapon (a cannot_equip warning, never a block).
  const plan = planTrade({ context: 'roster', run }, ...giveSlots(source, target, item));
  return plan.ok ? '' : giveReason(plan.reason);
}
export function giveRosterItem(run, source, target, item) {
  const result = applyTrade({ context: 'roster', run }, ...giveSlots(source, target, item));
  return result.ok ? result : { ok: false, reason: giveReason(result.reason) };
}
