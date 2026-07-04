// XpShare — pure helpers for the Mentor's Band (EXP Share) accessory.
// No Phaser imports. Shared verbatim by BattleScene.awardXP and the headless
// harness XP paths (tests/harness/HeadlessBattle.js) so the two stay in parity.
//
// Design (docs/design-log.md 2026-07-04, anti-juggernaut): when the holder is
// awarded combat XP, each adjacent ally with a strictly lower effective level
// receives the XP that ally's own combat formula would have produced, scaled by
// the accessory's share ratio. Computing from the ally's level is the point —
// an overleveled holder earns ~1 XP themselves, but the trainee's formula
// yields real XP, converting dead juggernaut XP into roster growth.
//
// Guarantees enforced here:
// - combat XP only (callers hook the combat award path, never heal/dance XP)
// - no chaining: shares are granted directly, never re-entering the share hook
// - no double-grant: each band only shares from its own holder's combats
// - floor 1 XP per share

import { calculateCombatXP, getXpEffectiveLevel } from './UnitManager.js';
import { gridDistance } from './Combat.js';

/** Share ratio from the holder's equipped accessory (0 when no xpShare accessory). */
export function getXpShareRatio(unit) {
  const ratio = Number(unit?.accessory?.combatEffects?.xpShare);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
}

/**
 * Allies eligible to receive shared XP from the holder's combat:
 * living, on the map, adjacent (Manhattan distance 1), and at a strictly lower
 * effective level than the holder (promoted tier counts as +12).
 */
export function getXpShareRecipients(holder, allies) {
  if (!holder || !Array.isArray(allies)) return [];
  const holderLevel = getXpEffectiveLevel(holder);
  return allies.filter(
    (ally) =>
      ally &&
      ally !== holder &&
      ally.currentHP > 0 &&
      Number.isFinite(Number(ally.col)) &&
      Number.isFinite(Number(ally.row)) &&
      gridDistance(holder.col, holder.row, ally.col, ally.row) === 1 &&
      getXpEffectiveLevel(ally) < holderLevel,
  );
}

/**
 * Shared XP for one recipient: the ally's own combat XP formula against the
 * holder's opponent, times the share ratio, times the caller's contextual
 * multiplier (enemy reward/turn-pressure/chip-damage scaling — whatever the
 * caller applied to the holder's own base XP). Floors at 1.
 */
export function calculateSharedXp(ally, opponent, opponentDied, ratio, multiplier = 1) {
  const shareRatio = Number(ratio);
  if (!Number.isFinite(shareRatio) || shareRatio <= 0) return 0;
  const contextMultiplier = Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1;
  const baseXp = calculateCombatXP(ally, opponent, opponentDied);
  return Math.max(1, Math.floor(baseXp * shareRatio * contextMultiplier));
}
