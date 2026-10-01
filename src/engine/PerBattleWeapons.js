// PerBattleWeapons.js — what a resolved combat does to per-battle weapons (Breachbolt).
// Pure, no Phaser. BattleScene and the headless harness call it right after the
// combat's HP is applied.
//
// 1. Each side that struck with a per-battle weapon spends one shot
//    (Combat.settlePerBattleWeaponUses).
// 2. A unit whose equipped weapon just ran dry equips the next weapon that can still
//    strike, so it counters (and, for an enemy, plans its next attack) with that weapon
//    at once rather than standing defenceless with an empty tome. A player unit takes
//    a weapon it can equip (rank checked); an enemy the next carried combat weapon
//    (Combat.nextStrikeWeapon: enemy gear is assigned, not equipped by rank). With
//    nothing to swap to the spent weapon stays equipped (no counter, no attack). The
//    forecast and Danger read the equipped / next weapon, so they follow the swap.
import { hasPerBattleUsesLeft, nextStrikeWeapon, settlePerBattleWeaponUses } from './Combat.js';
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

/**
 * Settle a resolved combat's per-battle weapons (mutates units and weapons).
 * @returns {{ spent: {attacker:boolean, defender:boolean}, swaps: Array<{unit, from, to}> }}
 */
export function settleCombatWeapons(attacker, defender, result) {
  const spent = settlePerBattleWeaponUses(attacker, defender, result);
  const swaps = [];
  for (const unit of [attacker, defender]) {
    const to = replacementForSpentWeapon(unit);
    if (!to) continue;
    const from = unit.weapon;
    if (unit.faction === 'player') equipWeapon(unit, to);
    else unit.weapon = to;
    if (unit.weapon === to) swaps.push({ unit, from, to });
  }
  return { spent, swaps };
}
