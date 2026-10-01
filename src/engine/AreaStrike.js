// AreaStrike — a chosen-center weapon art (docs/specs/aoe-weapon-arts.md §6): the user
// picks a tile within range and every foe in the blast takes the art's own blow. There is
// no combat: no hit roll, no crit, no counter. Pure, no RNG; the scene and the harness
// drive the same generator (presentation and the art's cost are the owner's).

import { combatStrikeMods, parseRange } from './Combat.js';
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
export function areaStrikeMods(unit, art) {
  return combatStrikeMods(
    { atkMods: timedBuffCombatMods(unit), atkWeaponArtMods: getWeaponArtCombatMods(art) },
    unit?.weapon,
  );
}

/** The distances a chosen-center art may be aimed at from `unit`, or null. */
export function areaStrikeRange(unit, art) {
  const area = getWeaponArtArea(art);
  if (!area || getWeaponArtTargeting(art) !== 'chosen_center') return null;
  if (area.centerRange === 'weapon') {
    if (!unit?.weapon) return null;
    const range = parseRange(unit.weapon.range);
    return { min: range.min, max: range.max };
  }
  return area.centerRange || null;
}

/** Every tile `unit` may aim `art` at (in AreaShapes order), or []. */
export function areaStrikeCenters(unit, art, world) {
  const range = areaStrikeRange(unit, art);
  return range ? centerTiles(unit, range, areaBounds(world)) : [];
}

export function isAreaStrikeCenter(unit, art, center, world) {
  if (!center) return false;
  return areaStrikeCenters(unit, art, world).some(
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
