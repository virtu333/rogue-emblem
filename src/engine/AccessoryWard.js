// AccessoryWard.js — the Warden's Buckler's ward (combatEffects `firstHitWard`). Pure.
//
// Once a battle, the first blow that lands on the wearer and would deal more than 1 damage
// deals 1 instead (a crit or a Lethality too). Combat.rollStrike asks `wardStrike` after the
// on-defend skills and affixes have had their say and before drain and the Revival Stones
// read the blow, so a warded blow is a 1-damage blow to everything after it. A blow that
// already deals 0 or 1 leaves the ward ready.
//
// The ward is spent on the unit (`_wardSpent`), like Miracle and the Phoenix Brooch: the
// battle checkpoint keeps it (BattleUnitState), a Vision rewind restores it, a fresh battle
// and the run save clear it (BattleScene.resetUnitForBattle, UnitSerialization), and an
// arena bout starts with it ready. Only strikes in a combat exchange meet it: area and line
// arts' extra victims, splash, terrain and status damage do not.
//
// The key is generic so any accessory (or a foe's, should foes wear them) can carry it.

export const WARD_NAME = "Warden's Buckler";
export const WARD_ACTIVATION = Object.freeze({ id: 'warden_buckler', name: WARD_NAME });

/** Does this unit's accessory carry a ward at all (spent or not)? */
export function hasWardAccessory(unit) {
  return unit?.accessory?.combatEffects?.firstHitWard === true;
}

/** Is the ward ready to take the next blow? */
export function wardReady(unit) {
  return hasWardAccessory(unit) && unit._wardSpent !== true;
}

/**
 * Ward one landed blow of `damage` on `unit`. Returns the damage it deals and whether the
 * ward took it; spends the ward when it did.
 * @returns {{ damage: number, warded: boolean }}
 */
export function wardStrike(unit, damage) {
  if (!wardReady(unit) || !(damage > 1)) return { damage, warded: false };
  unit._wardSpent = true;
  return { damage: 1, warded: true };
}

/** Make the ward ready again (a fresh battle, an arena bout). */
export function readyWard(unit) {
  if (unit && Object.prototype.hasOwnProperty.call(unit, '_wardSpent')) delete unit._wardSpent;
}
