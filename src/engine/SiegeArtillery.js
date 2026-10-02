// SiegeArtillery.js — enemy siege casters hold and fire (docs/specs/dusk-pressure.md §2c).
// Pure, no Phaser, no RNG.
//
// An enemy whose next strike weapon is a siege tome (Breachbolt: "Siege magic", 3-10)
// with shots left is artillery. At the top of each enemy phase it takes a stance from
// the board the player left:
//   * planted, when one of the player's units stands inside its siege range: it does
//     not move this phase and fires from where it stands at the best target in range
//     (none left by then: it waits);
//   * otherwise it moves and fires like any caster (out of range, or out of shots).
// The stance is fixed for the phase, so an ally killing its target first never sends it
// walking, and the Danger overlay (ThreatForecast) can draw exactly the reach it will
// use: the ring from its post while a player unit is in it, its full reach otherwise.
// Only the player's own units count: they are never hidden, and none of them moves
// between the player's last action and the stance (an NPC, the caravan, steps first;
// a unit the ground kills as the phase turns is the one way the ring can empty).
// The stance is saved with the unit (`artilleryStance: { turn, planted }`), so a phase
// resumed from a mid-phase checkpoint keeps it instead of reading a board that enemies
// have already changed.
//
// Holders (HoldActivation: a siege caster never holds) and village bandits (`seek_tile`)
// keep their own orders. The Entity has its own AI.

import {
  gridDistance,
  hasPerBattleUsesLeft,
  isInRange,
  isStaff,
  nextStrikeWeapon,
} from './Combat.js';
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

/** True when an artillery unit, where it stands, has one of `tiles` in siege range. */
export function plantsAgainst(unit, tiles) {
  const weapon = artilleryWeapon(unit);
  if (!weapon) return false;
  for (const t of tiles || []) {
    if (t && isInRange(weapon, gridDistance(unit.col, unit.row, t.col, t.row))) return true;
  }
  return false;
}

/**
 * The same test over a positions map ("col,row" -> { faction }, PlayerKnowledge): the
 * player's units in it are the targets. What the Danger overlay and every preview use.
 */
export function plantsAmongPositions(unit, positions) {
  if (!artilleryWeapon(unit) || !positions) return false;
  const tiles = [];
  for (const [key, entry] of positions) {
    if (entry?.faction !== 'player') continue;
    const [col, row] = key.split(',').map(Number);
    tiles.push({ col, row });
  }
  return plantsAgainst(unit, tiles);
}

const isLive = (u) => Boolean(u) && u.currentHP > 0 && !u._removing;

/**
 * Take every artillery unit's stance for this enemy phase (mutates the units). Call at
 * the top of the phase with its turn number: a unit that already holds a stance for that
 * turn keeps it (a resumed phase). Without a turn number the stance is taken afresh.
 * A unit that is not artillery (no siege tome, or its shots spent) drops any old stance.
 */
export function settleArtilleryStances({ enemyUnits = [], playerUnits = [], turn = null } = {}) {
  const checked = Number.isInteger(turn);
  const targets = (playerUnits || []).filter(isLive);
  for (const enemy of enemyUnits || []) {
    if (!isLive(enemy)) continue;
    if (!artilleryWeapon(enemy)) {
      delete enemy.artilleryStance;
      continue;
    }
    if (checked && enemy.artilleryStance?.turn === turn) continue;
    enemy.artilleryStance = {
      turn: checked ? turn : null,
      planted: plantsAgainst(enemy, targets),
    };
  }
}

/** True when the unit holds its post and fires this phase. */
export function isArtilleryPlanted(unit) {
  return unit?.artilleryStance?.planted === true && Boolean(artilleryWeapon(unit));
}
