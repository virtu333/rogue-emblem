// AreaStrike — a chosen-center weapon art (docs/specs/aoe-weapon-arts.md §6): the user
// picks a tile within range and every foe in the blast takes the art's own blow. There is
// no combat: no hit roll, no crit, no counter. Pure, no RNG; the scene and the harness
// drive the same generator (presentation and the art's cost are the owner's).
//
// A leap (`area.leap`, Doomblade's Doom Thrust: docs/specs/legendary-arts-rework.md §5) aims
// the tile its user lands on: a tile the user can stand on, free as far as the caller knows
// (`occupiedAt`: the player's knowledge for the choices), over units and terrain between.
// The user is placed there (leapBlocker reads the real board: a unit the fog hid fails the
// leap), then every foe beside the landing takes the blow.

import { combatStrikeMods, parseRange } from './Combat.js';
import { canAttackWithWeapon } from './AttackOptions.js';
import { areaBounds } from './AreaDamage.js';
import { centerTiles } from './AreaShapes.js';
import { areaDamage } from './PostCombatEffects.js';
import { timedBuffCombatMods } from './TimedWeaponArtBuffs.js';
import { isRooted } from './StatusConditionSystem.js';
import { settleMoves } from './ActionMovement.js';
import {
  getWeaponArtArea,
  getWeaponArtCombatMods,
  getWeaponArtTargeting,
} from './WeaponArtSystem.js';

/**
 * A chosen-center strike's flat mods: the art, the weapon's imbue and the user's timed
 * buffs. There is no combat, so no skill context (passive skills don't apply).
 */
export function areaStrikeMods(unit, art, weapon = unit?.weapon) {
  return combatStrikeMods(
    { atkMods: timedBuffCombatMods(unit), atkWeaponArtMods: getWeaponArtCombatMods(art) },
    weapon,
  );
}

/**
 * Can `unit` aim `art` (carried by `weapon`) now: a chosen-center art, a weapon it may
 * strike with (proficiency, silence, a per-battle weapon's uses: AttackOptions), and a
 * center in reach. Usability itself (HP cost, limits, rank) is canUseWeaponArt's. Targets
 * never count, so the fog cannot shape the menu.
 */
export function canStartAreaStrike(unit, weapon, art, world, { occupiedAt = null } = {}) {
  if (getWeaponArtTargeting(art) !== 'chosen_center') return false;
  if (!canAttackWithWeapon(unit, weapon)) return false;
  if (isLeapArt(art) && isRooted(unit)) return false;
  return areaStrikeCenters(unit, art, world, weapon, { occupiedAt }).length > 0;
}

/** Is `art` a leap: a chosen-center art whose center is where its user lands. */
export function isLeapArt(art) {
  return getWeaponArtTargeting(art) === 'chosen_center' && getWeaponArtArea(art)?.leap === true;
}

/** Can `unit` stand on the tile (on the board, ground its move type crosses). */
function standable(unit, tile, world) {
  return (
    typeof world?.getMoveCost === 'function' &&
    Number.isFinite(world.getMoveCost(tile.col, tile.row, unit?.moveType))
  );
}

/**
 * The distances a chosen-center art may be aimed at from `unit`, or null. A
 * `centerRange: 'weapon'` art reaches as far as `weapon` does: the weapon that carries
 * the art, which need not be the one equipped yet (default: the equipped one).
 */
export function areaStrikeRange(unit, art, weapon = unit?.weapon) {
  const area = getWeaponArtArea(art);
  if (!area || getWeaponArtTargeting(art) !== 'chosen_center') return null;
  if (area.centerRange === 'weapon') {
    if (!weapon) return null;
    const range = parseRange(weapon.range);
    return { min: range.min, max: range.max };
  }
  return area.centerRange || null;
}

/**
 * Every tile `unit` may aim `art` (carried by `weapon`) at, in AreaShapes order, or []. A
 * leap's tiles are those the user can stand on, minus any `occupiedAt(col, row)` reports
 * taken (the choices pass the player's knowledge; execution checks the real board itself).
 */
export function areaStrikeCenters(
  unit,
  art,
  world,
  weapon = unit?.weapon,
  { occupiedAt = null } = {},
) {
  const range = areaStrikeRange(unit, art, weapon);
  if (!range) return [];
  const tiles = centerTiles(unit, range, areaBounds(world));
  if (!isLeapArt(art)) return tiles;
  return tiles.filter((t) => {
    if (!standable(unit, t, world)) return false;
    const occupant = typeof occupiedAt === 'function' ? occupiedAt(t.col, t.row) : null;
    return !occupant || occupant === unit;
  });
}

/** Is `center` a tile `unit` may aim `art` at (geometry and ground, never units). */
export function isAreaStrikeCenter(unit, art, center, world, weapon = unit?.weapon) {
  if (!center) return false;
  if (isLeapArt(art) && isRooted(unit)) return false;
  return areaStrikeCenters(unit, art, world, weapon).some(
    (t) => t.col === center.col && t.row === center.row,
  );
}

/**
 * The unit standing on a leap's landing tile on the board `getUnitAt` reads, other than the
 * leaper, or null. Execution passes the real board: a unit the fog hid there fails the leap.
 */
export function leapBlocker(unit, center, getUnitAt) {
  if (!center || typeof getUnitAt !== 'function') return null;
  const occupant = getUnitAt(center.col, center.row);
  return occupant && occupant !== unit && !(occupant.currentHP <= 0) ? occupant : null;
}

/**
 * A leap, settled on the board `getUnitAt` reads (the real one, at execution): with the
 * landing free, the user is placed there (`moves`, ActionMovement.settleMoves, for the scene
 * to draw); with a unit there, nothing moves and that unit is the `blocker`. The scene and the
 * harness both call it, after the art's cost and before the blows.
 * @returns {{ landed: boolean, blocker: object|null, moves: object[] }}
 */
export function settleLeap(unit, center, getUnitAt) {
  const blocker = leapBlocker(unit, center, getUnitAt);
  if (blocker || !unit || !center) return { landed: false, blocker, moves: [] };
  return { landed: true, blocker: null, moves: settleMoves([{ unit, to: center }]) };
}

/**
 * The strike's effects, as post-combat beats (hp, hint, remove). Every victim leaves a
 * credit on `result.areaCredits`. Nothing happens for a center out of range, or for a leap
 * whose user is not standing on its landing tile (one that failed).
 * @param {object} p
 * @param {object} p.unit        the art's user (alive; its cost already paid)
 * @param {object} p.art
 * @param {{col:number,row:number}} p.center
 * @param {object} p.world       PostCombatEffects' world
 * @param {object|null} [p.strikeMods] the user's flat combat mods (default: areaStrikeMods)
 * @param {object} [result]      receives `areaCredits`
 */
export function* areaStrikeEffects({ unit, art, center, world, strikeMods = null }, result = {}) {
  if (!unit || unit.currentHP <= 0 || !center) return;
  // A leap strikes from where its user landed; any other strike needs its center in reach.
  if (isLeapArt(art)) {
    if (unit.col !== center.col || unit.row !== center.row) return;
  } else if (!isAreaStrikeCenter(unit, art, center, world)) return;
  const area = getWeaponArtArea(art);
  yield* areaDamage(
    {
      area,
      center: { col: center.col, row: center.row },
      blows: 1,
      requiresLiveSource: true,
      strikeMods: strikeMods ?? areaStrikeMods(unit, art),
    },
    unit,
    null,
    world,
    result,
  );
}
