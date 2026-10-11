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
//
// An authored post (`aiMode: 'post'`, a set piece's slot: docs/specs/act-v-descent.md §9.2)
// holds the same way for good: it strikes from its tile whatever it carries and never walks
// (AIController's movement range 0, the Danger overlay's reach from the tile). It needs no
// stance: the mode itself is the order, read the same by BattleScene and the harness.
// Its post is the tile it spawned on (`postTile`, stamped by `applyPostSpawn` in BattleScene and
// the harness alike). Moved off it (a Shove, a Smite, a push art, a forced slide), it walks back
// (AIController's post return, which reuses the `seek_tile` walk with the post as the goal) and
// holds again once it stands there; off its post it holds nothing, so Danger draws its walk.
// A Vigil Voice is such a post: it speaks only on its sigil (engine/Vigil.js).

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

/** The AI mode of a unit authored to hold its tile (a set piece slot's `aiMode: 'post'`). */
export const POST_AI_MODE = 'post';

const isTile = (t) => Boolean(t) && Number.isInteger(t.col) && Number.isInteger(t.row);

/** An authored post moved off its tile: it walks back rather than holding (the header). */
export function isOffAuthoredPost(unit) {
  if (unit?.aiMode !== POST_AI_MODE || isEntity(unit) || !isTile(unit.postTile)) return false;
  return unit.postTile.col !== unit.col || unit.postTile.row !== unit.row;
}

/**
 * True when the unit is an authored post standing on it: it strikes from its tile and never
 * walks. (A post with no stamped tile, from before `postTile`, holds wherever it stands.)
 */
export function holdsAuthoredPost(unit) {
  return unit?.aiMode === POST_AI_MODE && !isEntity(unit) && !isOffAuthoredPost(unit);
}

/**
 * Stamp an authored post's tile on the unit as it spawns (BattleScene.addEnemyFromSpawn and the
 * harness's `_addEnemyFromSpawn`, after `aiMode`): where it walks back to when moved. Saved
 * with the unit, so a suspend or a rewind keeps it. Any other unit is left alone.
 */
export function applyPostSpawn(enemy, spawn) {
  if (enemy?.aiMode !== POST_AI_MODE || !isTile(spawn)) return;
  enemy.postTile = { col: spawn.col, row: spawn.row };
}

/**
 * True when the unit never walks: siege artillery with shots left, a staff caster with a use
 * left, or an authored post on its tile. An authored post moved off its tile walks back,
 * whatever it carries.
 */
export function holdsPost(unit) {
  if (isOffAuthoredPost(unit)) return false;
  return castsFromPost(unit) || holdsAuthoredPost(unit);
}

/** A caster that holds its post this phase: siege artillery or a staff caster (the stance). */
function castsFromPost(unit) {
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
    if (!castsFromPost(enemy)) {
      delete enemy.artilleryStance;
      continue;
    }
    // A stance saved by the old rule (`planted: false`, a caster that walked) is not kept
    // on resume: every post-holder is planted now, so it is taken again.
    if (checked && enemy.artilleryStance?.turn === turn && enemy.artilleryStance.planted === true)
      continue;
    enemy.artilleryStance = { turn: checked ? turn : null, planted: true };
  }
}

/** True when the unit holds its post this phase (stance taken, and still a caster that holds). */
export function isArtilleryPlanted(unit) {
  return unit?.artilleryStance?.planted === true && castsFromPost(unit);
}
