// What reviving one of the fallen costs (docs: /mnt/project-files/reviews/revival-recovery-proposal.md).
//
// The full price follows the unit's effective level (level, + 12 once promoted: the XP rule's
// equivalence), so promoting never halves it, with a gentle curve past level 12 that keeps late
// prices where they were. The first revival in each act costs no more than hiring a replacement:
// the act's dearest mercenary at the rung's rate (x the promoted multiplier for a promoted unit).
// Pure: no Phaser, no DOM.
import {
  REVIVE_BASE_COST,
  REVIVE_COST_PER_LEVEL,
  REVIVE_CURVE_FROM_LEVEL,
  REVIVE_CURVE_STEP,
  REVIVE_PRICE_ROUNDING,
} from '../utils/constants.js';
import { getXpEffectiveLevel } from './UnitManager.js';
import { getMercenaryPrice } from './ColosseumEngine.js';

const roundPrice = (gold) => Math.round(gold / REVIVE_PRICE_ROUNDING) * REVIVE_PRICE_ROUNDING;

/** The full price to revive a fallen unit: fixed while it waits (its level when it fell). */
export function getReviveCost(unit) {
  const level = getXpEffectiveLevel(unit);
  const past = Math.max(0, level - REVIVE_CURVE_FROM_LEVEL);
  return roundPrice(
    REVIVE_BASE_COST + level * REVIVE_COST_PER_LEVEL + REVIVE_CURVE_STEP * past * past,
  );
}

// The mercenary board prices Acts I-IV; the final act's wares are Act IV's.
function mercenaryActFor(actId) {
  return /^act[1-4]$/.test(actId || '') ? actId : 'act4';
}

/**
 * What hiring a replacement for this unit costs in the run's current act: the dearest roll on
 * the act's mercenary board, the rung's rate, the promoted multiplier when the unit is promoted.
 * Null when the run carries no mercenary pricing.
 */
export function reviveHirePrice(run, unit) {
  const colosseum = run?.gameData?.colosseum;
  if (!colosseum?.mercenaries?.pricing) return null;
  const price = getMercenaryPrice(
    mercenaryActFor(run.currentAct),
    unit?.tier === 'promoted',
    run.difficultyId || null,
    colosseum,
    () => 0.999999,
  );
  return Number.isFinite(price) && price > 0 ? roundPrice(price) : null;
}

/** True while this act's discounted revival is unspent. */
export function reviveDiscountAvailable(run) {
  return Boolean(run?.currentAct) && run.reviveDiscountAct !== run.currentAct;
}

/**
 * The price this run charges to revive `unit` now.
 * @returns {{ price: number, full: number, discounted: boolean }}
 */
export function reviveCostFor(run, unit) {
  const full = getReviveCost(unit);
  if (!reviveDiscountAvailable(run)) return { price: full, full, discounted: false };
  const hire = reviveHirePrice(run, unit);
  if (hire == null || hire >= full) return { price: full, full, discounted: false };
  return { price: hire, full, discounted: true };
}

/** Spend this act's discounted revival (called once a discounted revival has been paid). */
export function spendReviveDiscount(run) {
  run.reviveDiscountAct = run.currentAct || null;
}

/** A saved `reviveDiscountAct`: an act id, or null (saves from before it: none spent). */
export function sanitizeReviveDiscountAct(raw) {
  return typeof raw === 'string' && raw ? raw : null;
}

export const REVIVE_DISCOUNT_LINE =
  'The first revival each act costs no more than hiring a replacement.';
