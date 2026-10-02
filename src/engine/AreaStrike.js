// AreaStrike — a chosen-center weapon art (docs/specs/aoe-weapon-arts.md §6): the user
// picks a tile within range and every foe in the blast takes the art's own blow. There is
// no combat: no hit roll, no crit, no counter. Pure, no RNG; the scene and the harness
// drive the same generator (presentation and the art's cost are the owner's).

import { combatStrikeMods, parseRange } from './Combat.js';
import { canAttackWithWeapon } from './AttackOptions.js';
import { areaBounds } from './AreaDamage.js';
import { centerTiles } from './AreaShapes.js';
import { areaDamage } from './PostCombatEffects.js';
import { timedBuffCombatMods } from './TimedWeaponArtBuffs.js';
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
export function canStartAreaStrike(unit, weapon, art, world) {
  if (getWeaponArtTargeting(art) !== 'chosen_center') return false;
  if (!canAttackWithWeapon(unit, weapon)) return false;
  return areaStrikeCenters(unit, art, world, weapon).length > 0;
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

/** Every tile `unit` may aim `art` (carried by `weapon`) at, in AreaShapes order, or []. */
export function areaStrikeCenters(unit, art, world, weapon = unit?.weapon) {
  const range = areaStrikeRange(unit, art, weapon);
  return range ? centerTiles(unit, range, areaBounds(world)) : [];
}

export function isAreaStrikeCenter(unit, art, center, world, weapon = unit?.weapon) {
  if (!center) return false;
  return areaStrikeCenters(unit, art, world, weapon).some(
    (t) => t.col === center.col && t.row === center.row,
  );
}

/**
 * The strike's effects, as post-combat beats (hp, hint, remove). Every victim leaves a
 * credit on `result.areaCredits`. Nothing happens for a center out of range.
 * @param {object} p
 * @param {object} p.unit        the art's user (alive; its cost already paid)
 * @param {object} p.art
 * @param {{col:number,row:number}} p.center
 * @param {object} p.world       PostCombatEffects' world
 * @param {object|null} [p.strikeMods] the user's flat combat mods (default: areaStrikeMods)
 * @param {object} [result]      receives `areaCredits`
 */
export function* areaStrikeEffects({ unit, art, center, world, strikeMods = null }, result = {}) {
  if (!unit || unit.currentHP <= 0 || !isAreaStrikeCenter(unit, art, center, world)) return;
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
