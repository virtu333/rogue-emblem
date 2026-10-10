// SiegeArtillery.js — enemy siege casters and status-staff casters hold their post
// (docs/specs/dusk-pressure.md §2c). Pure, no Phaser, no RNG.
//
// An enemy whose next strike weapon is a siege tome (Breachbolt: "Siege magic", 3-10)
// with shots left is artillery; an enemy carrying a Sleep or Silence Staff with a use
// left is a staff caster. Neither ever walks: artillery fires from where it stands at
// the best target in siege range (none: it waits), a staff caster casts, or strikes with
// its weapon, from where it stands (nothing in reach: it waits). The Danger overlay
// (ThreatForecast) draws exactly that: the reach from the post, never a walked-to tile.
// Once the siege shots or the staff's uses are gone the unit is an ordinary caster again.
// The stance is taken as the enemy phase begins (BattleScene.onPhaseChange and
// HeadlessBattle._processEnemyPhase) and saved with the unit
// (`artilleryStance: { turn, planted }`), keyed by turn, so a phase resumed from a
// mid-phase checkpoint keeps it. It no longer depends on where the player stands.
//
// Holders (HoldActivation) and village bandits (`seek_tile`) keep their own orders.
// The Entity has its own AI.

import { hasPerBattleUsesLeft, isStaff, nextStrikeWeapon } from './Combat.js';
import { isEntity } from './EntitySystem.js';

/** Units whose own orders come before the artillery stance. */
const OWN_ORDERS = new Set(['hold', 'seek_tile']);

/** A siege tome (weapons.json `special: "Siege magic"`): long-range magic. */
export function isSiegeWeapon(weapon) {
  return (
    Boolean(weapon) && !isStaff(weapon) && String(weapon.special || '').includes('Siege magic')
  );
}

/**
 * The siege weapon an enemy fires next, or null: it is artillery only while its next
 * strike weapon (Combat.nextStrikeWeapon, what the AI equips and Danger draws) is a
 * siege tome with shots left.
 */
export function artilleryWeapon(unit) {
  if (!unit || unit.faction !== 'enemy' || isEntity(unit) || OWN_ORDERS.has(unit.aiMode))
    return null;
  const weapon = nextStrikeWeapon(unit);
  return isSiegeWeapon(weapon) && hasPerBattleUsesLeft(weapon, unit) ? weapon : null;
}

/** An enemy status staff (Sleep / Silence) with a use left, or null. */
export function readyStatusStaff(unit) {
  if (!unit || unit.faction !== 'enemy' || isEntity(unit) || OWN_ORDERS.has(unit.aiMode))
    return null;
  const staff = unit.statusStaff;
  return staff && staff.uses > 0 && (staff._usesSpent || 0) < staff.uses ? staff : null;
}

/** True when the unit never walks: siege artillery with shots left, or a staff caster with a use left. */
export function holdsPost(unit) {
  return Boolean(artilleryWeapon(unit) || readyStatusStaff(unit));
}

const isLive = (u) => Boolean(u) && u.currentHP > 0 && !u._removing;

/**
 * Take every post-holding caster's stance for this enemy phase (mutates the units). Call
 * at the top of the phase with its turn number: a unit that already holds a stance for
 * that turn keeps it (a resumed phase). Without a turn number the stance is taken afresh.
 * A unit that holds no post (no siege tome or staff left) drops any old stance.
 */
export function settleArtilleryStances({ enemyUnits = [], turn = null } = {}) {
  const checked = Number.isInteger(turn);
  for (const enemy of enemyUnits || []) {
    if (!isLive(enemy)) continue;
    if (!holdsPost(enemy)) {
      delete enemy.artilleryStance;
      continue;
    }
    if (checked && enemy.artilleryStance?.turn === turn) continue;
    enemy.artilleryStance = { turn: checked ? turn : null, planted: true };
  }
}

/** True when the unit holds its post this phase (stance taken, and still a caster that holds). */
export function isArtilleryPlanted(unit) {
  return unit?.artilleryStance?.planted === true && holdsPost(unit);
}
