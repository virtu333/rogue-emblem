// AttackOptions — pure attack planning for the target-first Attack flow.
//
// Attack → every enemy attackable from the current tile with ANY usable weapon
// is highlighted (the range union) → the player picks a target → the forecast
// opens on a default weapon the player can switch. These helpers answer, without
// Phaser and without touching RNG or unit state:
//   - which carried weapons can attack at all (proficiency, silence, uses),
//   - each weapon's effective range (skills, weapon-art overrides),
//   - which weapons reach a given distance, and
//   - the FE-style default: the equipped weapon when it can hit that target,
//     otherwise the first weapon in inventory order that can.

import { parseRange, getPerBattleRemainingUses, isStaff } from './Combat.js';
import { getWeaponRangeBonus } from './SkillSystem.js';
import { isSilenced } from './StatusConditionSystem.js';
import { getWeaponArtCombatMods } from './WeaponArtSystem.js';
import { getCombatWeapons, inventoryDisplayOrder } from './UnitManager.js';

/** Weapon types a Silenced unit cannot attack with. */
export const SILENCE_BLOCKED_TYPES = new Set(['Tome', 'Light', 'Staff', 'Breath']);

export function isSilenceBlockedWeapon(weapon) {
  return Boolean(weapon && SILENCE_BLOCKED_TYPES.has(weapon.type));
}

/**
 * True if the unit may initiate combat with this carried weapon right now:
 * a proficient combat weapon (not a staff/scroll/consumable), not magic while
 * silenced, and not a per-battle weapon with no uses left.
 */
export function canAttackWithWeapon(unit, weapon) {
  if (!unit || !weapon || isStaff(weapon)) return false;
  if (!getCombatWeapons(unit).includes(weapon)) return false;
  if (isSilenced(unit) && isSilenceBlockedWeapon(weapon)) return false;
  if (weapon.perBattleUses && getPerBattleRemainingUses(weapon, unit) <= 0) return false;
  return true;
}

/**
 * Weapons the unit can attack with, equipped first then inventory order.
 * `equipped` overrides which weapon counts as equipped (the attack flow passes
 * the weapon that was equipped before any forecast preview).
 */
export function getAttackWeapons(unit, { equipped = unit?.weapon } = {}) {
  const ordered = inventoryDisplayOrder({ ...unit, weapon: equipped }, unit?.inventory);
  return ordered.filter((weapon) => canAttackWithWeapon(unit, weapon));
}

/** Effective {min,max} attack range, matching combat resolution. */
export function getAttackRange(unit, weapon, { skillsData = null, weaponArt = null } = {}) {
  const { min: baseMin, max: baseMax } = parseRange(weapon?.range);
  const skillBonus = getWeaponRangeBonus(unit, weapon, skillsData);
  let min = Math.max(1, baseMin);
  let max = Math.max(min, baseMax + skillBonus);
  if (weaponArt) {
    const mods = getWeaponArtCombatMods(weaponArt);
    if (mods.rangeOverride) {
      min = Math.max(1, Number(mods.rangeOverride.min) || min);
      max = Math.max(min, Number(mods.rangeOverride.max) || min);
    } else if (mods.rangeBonus) {
      max = Math.max(min, max + mods.rangeBonus);
    }
  }
  return { min, max };
}

export function weaponReachesDistance(unit, weapon, distance, options = {}) {
  const { min, max } = getAttackRange(unit, weapon, options);
  return distance >= min && distance <= max;
}

/** Weapons (from `weapons`, order kept) that can attack at `distance`. */
export function weaponsForDistance(unit, weapons, distance, options = {}) {
  return (weapons || []).filter((weapon) => weaponReachesDistance(unit, weapon, distance, options));
}

/**
 * FE default: the equipped weapon when it can attack at this distance, else the
 * first weapon in inventory order that can. `null` when nothing reaches.
 */
export function pickDefaultAttackWeapon(unit, distance, options = {}) {
  const equipped = options.equipped === undefined ? unit?.weapon : options.equipped;
  const candidates = weaponsForDistance(
    unit,
    getAttackWeapons(unit, { equipped }),
    distance,
    options,
  );
  return candidates[0] || null;
}

/**
 * The range union: each enemy attackable with at least one usable weapon, with
 * the weapons that reach it (equipped first). `distanceTo(enemy)` supplies the
 * combat distance (entity footprints aware) and `isTargetable(enemy)` the fog /
 * liveness gate; both come from the caller so this stays grid-free.
 */
export function planAttackTargets(
  unit,
  enemies,
  { distanceTo, isTargetable = () => true, skillsData = null, equipped = unit?.weapon } = {},
) {
  const weapons = getAttackWeapons(unit, { equipped });
  if (!weapons.length || typeof distanceTo !== 'function') return [];
  const plan = [];
  for (const target of enemies || []) {
    if (!target || !isTargetable(target)) continue;
    const distance = distanceTo(target);
    const reach = weaponsForDistance(unit, weapons, distance, { skillsData });
    if (reach.length) plan.push({ target, distance, weapons: reach });
  }
  return plan;
}

/**
 * Stable cycling order for target selection: nearest first, then reading order
 * (row, col). Cursor/keyboard cycling steps through this list and wraps.
 */
export function orderAttackTargets(unit, targets, distanceTo) {
  const dist = (t) => (typeof distanceTo === 'function' ? distanceTo(t) : 0);
  return [...(targets || [])].sort((a, b) => dist(a) - dist(b) || a.row - b.row || a.col - b.col);
}

/** Next target in `ordered` after `current` (wrapping); first when absent. */
export function stepTarget(ordered, current, direction = 1) {
  if (!ordered?.length) return null;
  const index = ordered.indexOf(current);
  if (index < 0) return direction < 0 ? ordered[ordered.length - 1] : ordered[0];
  const step = direction < 0 ? -1 : 1;
  return ordered[(index + step + ordered.length) % ordered.length];
}
