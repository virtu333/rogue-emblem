// AccessoryReactions.js — three accessories that answer what happens in a battle. Pure.
//
// * Briar Cloak (combatEffects `meleeReflect: N`): a foe whose blow lands on the wearer from
//   an adjacent tile takes N damage back, never its last HP (Thorns' rule: Combat.applyReflect).
//   Combat.rollStrike adds it to the strike's `reflectDamage`; the forecast adds it to the
//   striker side's `thornsReflect`, so the HP projection already counts it.
// * Grudge Locket (combatEffects `grudgeAtk: N`): +N Atk for each ally the run has lost: the
//   fallen awaiting a church and the laid to rest (LaidToRest.everFallenUnits), plus the
//   allies fallen in the battle being fought. No cap. A revived ally no longer counts. Only a
//   player unit's locket counts allies (an enemy wearer's side has no run).
// * Anchor Stone (combatEffects `anchored: true`): its wearer is never moved by another unit
//   (Shove, Pull, Swap, Smite, an art's push or swap, the Entity's Undertow): the
//   displacement rule reads `isAnchoredByAccessory` through AffixSystem.isDisplacementImmune,
//   and the ally commands read `holdsGroundAgainstAllies`. It still moves itself.
// * Longarm Bracer (combatEffects `meleeCounterRange: N`): its wearer's 1-range weapons
//   counter from up to N tiles (Combat.canCounter, so the forecast, the resolution and the
//   AI, which reads the forecast, agree). Only counters: an attack still needs the weapon's
//   own range. A counter from beyond 1 is no melee blow (Thorns and the Briar Cloak skip it).

import { everFallenUnits } from './LaidToRest.js';

export const BRIAR_ACTIVATION = Object.freeze({ id: 'briar_cloak', name: 'Briar Cloak' });
export const GRUDGE_ACTIVATION = Object.freeze({ id: 'grudge_locket', name: 'Grudge Locket' });

const ce = (unit) => unit?.accessory?.combatEffects || null;
const positiveInt = (value) => Math.max(0, Math.trunc(Number(value) || 0));

/** The damage a Briar Cloak sends back to a melee striker (0 when there is none). */
export function briarReflectOf(unit, isMelee) {
  if (!isMelee) return 0;
  return positiveInt(ce(unit)?.meleeReflect);
}

/**
 * The farthest a Longarm Bracer lets `weapon` counter from in `unit`'s hands: N for a weapon
 * that reaches 1 tile only (never a staff), 0 when the bracer adds nothing. `range` is the
 * weapon's parsed `{ min, max }`.
 */
export function meleeCounterRangeOf(unit, weapon, range) {
  if (!weapon || weapon.type === 'Staff') return 0;
  if (range?.min !== 1 || range?.max !== 1) return 0;
  const reach = positiveInt(ce(unit)?.meleeCounterRange);
  return reach > 1 ? reach : 0;
}

/** Does this unit's accessory keep it from being moved by others? */
export function isAnchoredByAccessory(unit) {
  return ce(unit)?.anchored === true;
}

/**
 * How many allies a player side has lost: the run's fallen and laid to rest, plus the allies
 * fallen in this battle (`fallenThisBattle`, a count the battle keeps).
 */
export function playerAlliesLost(run, fallenThisBattle = 0) {
  return everFallenUnits(run).length + positiveInt(fallenThisBattle);
}

/** A Grudge Locket's Atk for its wearer, given the allies lost (0 without one). */
export function grudgeAtkBonus(unit, alliesLost) {
  if (unit?.faction !== 'player') return 0;
  const per = positiveInt(ce(unit)?.grudgeAtk);
  return per * positiveInt(alliesLost);
}
