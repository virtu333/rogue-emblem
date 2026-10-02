// PerBattleWeapons.js — what a resolved combat does to per-battle weapons (Breachbolt).
// Pure, no Phaser. BattleScene and the headless harness call it in two steps:
//
// 1. spendCombatShots, right after the combat's HP is applied: each side that struck
//    with a per-battle weapon spends one shot (Combat.settlePerBattleWeaponUses). A
//    chosen-center area art has no combat: spendAreaStrikeShot spends its one shot.
// 2. swapSpentWeapons, once the combat's deaths are settled (after removeUnit, so kill
//    credit, deeds, zombie remains and lord quips see the weapon that struck): a living
//    unit whose equipped weapon ran dry equips the next weapon that can still strike,
//    so it counters (and, for an enemy, plans its next attack) with it at once rather
//    than standing defenceless with an empty tome. A player unit takes a weapon it can
//    equip (rank checked); an enemy the next carried combat weapon
//    (Combat.nextStrikeWeapon: enemy gear is assigned, not equipped by rank). With
//    nothing to swap to, the spent weapon stays equipped (no counter, no attack). The
//    forecast and Danger read the equipped / next weapon, so they follow the swap.
import {
  hasPerBattleUsesLeft,
  isStaff,
  nextStrikeWeapon,
  settlePerBattleWeaponUses,
  spendPerBattleUse,
} from './Combat.js';
import { equipWeapon, getCombatWeapons } from './UnitManager.js';

/** The weapon a unit with a spent equipped weapon switches to, or null. */
export function replacementForSpentWeapon(unit) {
  const current = unit?.weapon;
  if (!current || hasPerBattleUsesLeft(current, unit)) return null;
  if (unit.faction === 'player') {
    return (
      getCombatWeapons(unit).find((w) => w !== current && hasPerBattleUsesLeft(w, unit)) || null
    );
  }
  const next = nextStrikeWeapon(unit);
  return next && next !== current ? next : null;
}

/** Step 1: spend the shots a resolved combat used (mutates weapons). */
export function spendCombatShots(attacker, defender, result) {
  return settlePerBattleWeaponUses(attacker, defender, result);
}

/**
 * Step 1 for a chosen-center area art (Stormcall): the cast struck with `weapon`, so it
 * spends one shot however many units the blast hits, or none. No combat result, no hit
 * roll: the cast itself is the strike. Returns whether a shot was spent.
 */
export function spendAreaStrikeShot(weapon) {
  if (!weapon?.perBattleUses || isStaff(weapon)) return false;
  spendPerBattleUse(weapon);
  return true;
}

/**
 * Step 2: living units whose equipped weapon ran dry switch weapons (mutates units).
 * @returns {Array<{unit, from, to}>} the switches made
 */
export function swapSpentWeapons(units) {
  const swaps = [];
  for (const unit of units || []) {
    if (!unit || !(unit.currentHP > 0)) continue;
    const to = replacementForSpentWeapon(unit);
    if (!to) continue;
    const from = unit.weapon;
    if (unit.faction === 'player') equipWeapon(unit, to);
    else unit.weapon = to;
    if (unit.weapon === to) swaps.push({ unit, from, to });
  }
  return swaps;
}

/** Both steps at once, for a combat with no deaths to settle in between (tests, sims). */
export function settleCombatWeapons(attacker, defender, result) {
  const spent = spendCombatShots(attacker, defender, result);
  return { spent, swaps: swapSpentWeapons([attacker, defender]) };
}
