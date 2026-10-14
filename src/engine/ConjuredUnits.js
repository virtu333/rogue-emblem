// ConjuredUnits — the one rule for a foe the battle made rather than placed: a Skeleton a
// Necromancer raised (engine/Necromancy.js), a Hollowed a summoning circle called
// (engine/Vigil.js) or a Grasping Limb the Entity sprouted (engine/EntityKit.js, also
// `_summonedBy`: half the XP). Pure, and a leaf (no imports), so EnemyCarry, BattleXp and
// ReinforcementSpawns can all read it without an import cycle.
//
// A conjured unit repeats (a raise or a call comes back every enemy phase until its source
// falls or its cap is spent), so it must stay worth little:
//   - gold 0 (ReinforcementSpawns.enemyRewardMultiplier);
//   - a share of the XP its level would pay: a quarter for a raised Skeleton, half for a called
//     Hollowed (conjuredXpMultiplier, read by enemyXpMultiplier; docs/specs/act-v-descent.md §5.2);
//   - no survival XP for being attacked by one (BattleXp.combatXpAwards);
//   - no deed record (ReinforcementSpawns.isZeroRewardUnit, read by DeedSystem.recordKill);
//   - never a carrier (EnemyCarry.isCarrierEligible);
//   - never a reinforcement template (its classes are in Necromancy.isNeverCopiedClass, and a
//     template is copied from the config's spawns, which a conjured unit never is).

/** A raised Skeleton pays this share of the XP its level would. */
export const RAISED_XP_MULTIPLIER = 0.25;
/** A called Hollowed pays this share of the XP its level would. */
export const SUMMONED_XP_MULTIPLIER = 0.5;

/** A unit a Necromancer raised (its `_raisedBy` names the Necromancer's battleEntityId). */
export function isRaisedUnit(unit) {
  return typeof unit?._raisedBy === 'string' && unit._raisedBy.length > 0;
}

/** A unit a summoning circle called (`_summonedBy`: `circle:<id>`) or an Entity's limb (`entity:limb`). */
export function isSummonedUnit(unit) {
  return typeof unit?._summonedBy === 'string' && unit._summonedBy.length > 0;
}

/** Raised or summoned: the one predicate every reward reader asks. */
export function isConjuredUnit(unit) {
  return isRaisedUnit(unit) || isSummonedUnit(unit);
}

/** The XP share a conjured unit pays (raised first), or null for any other unit. */
export function conjuredXpMultiplier(unit) {
  if (isRaisedUnit(unit)) return RAISED_XP_MULTIPLIER;
  if (isSummonedUnit(unit)) return SUMMONED_XP_MULTIPLIER;
  return null;
}
