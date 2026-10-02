// EnemySpawnGear.js — the gear a generated enemy spawn carries (pure, no Phaser).
//
// MapGenerator decides *what* a spawn carries (sunderWeapon / poisonWeapon /
// siegeWeapon / statusStaff flags, isEntity); this turns those flags into the unit's
// inventory, the same way for BattleScene and the headless harness:
// * the Entity: both of its weapons;
// * a Sunder or Poison spawn: that weapon in place of its own;
// * a siege spawn: the siege tome equipped, its own weapons kept behind it, so a
//   siege caster that has spent its shots still fights (AIController re-equips);
// * a status-staff spawn: the staff beside its weapon (enemy.statusStaff);
// * Nightfall and up: secondary weapons for multi-proficiency enemies without special gear.
import { isStaff } from './Combat.js';
import { grantSecondaryWeapons } from './UnitManager.js';
import { isDifficultyAtLeast } from './DifficultyEngine.js';
import {
  SUNDER_WEAPON_BY_TYPE,
  POISON_WEAPON_BY_TYPE,
  ENTITY_WEAPON_NAMES,
} from '../utils/constants.js';

function cloneNamed(weapons, name) {
  const data = name ? (weapons || []).find((w) => w.name === name) : null;
  return data ? structuredClone(data) : null;
}

/**
 * Equip `enemy` (mutated) for `spawn`.
 * @param {object} enemy
 * @param {object} spawn
 * @param {{ weapons: object[], difficultyId?: string }} deps
 */
export function applyEnemySpawnGear(enemy, spawn, { weapons, difficultyId = 'normal' } = {}) {
  if (!enemy || !spawn) return enemy;
  if (spawn.isEntity) {
    const entityWeapons = (weapons || [])
      .filter((w) => ENTITY_WEAPON_NAMES.includes(w.name))
      .map((w) => structuredClone(w));
    if (entityWeapons.length === 0) {
      console.warn('Entity spawn missing expected weapons:', ENTITY_WEAPON_NAMES);
    } else {
      enemy.inventory = entityWeapons;
      enemy.weapon = entityWeapons[0];
    }
  }
  const primaryType = enemy.proficiencies?.[0]?.type;
  if (spawn.sunderWeapon) {
    const sunder = cloneNamed(weapons, primaryType ? SUNDER_WEAPON_BY_TYPE[primaryType] : null);
    if (sunder) {
      enemy.weapon = sunder;
      enemy.inventory = [sunder];
    }
  } else if (spawn.poisonWeapon) {
    const poison = cloneNamed(weapons, primaryType ? POISON_WEAPON_BY_TYPE[primaryType] : null);
    if (poison) {
      enemy.weapon = poison;
      enemy.inventory = [poison];
    }
  }
  if (spawn.siegeWeapon) {
    const siege = cloneNamed(weapons, spawn.siegeWeapon);
    if (siege) {
      const fallback = (enemy.inventory || []).filter((w) => w && w !== siege && !isStaff(w));
      enemy.weapon = siege;
      enemy.inventory = [siege, ...fallback];
    }
  }
  if (spawn.statusStaff) {
    const staff = cloneNamed(
      weapons,
      spawn.statusStaff === 'sleep' ? 'Sleep Staff' : 'Silence Staff',
    );
    if (staff) enemy.statusStaff = staff;
  }
  if (
    !spawn.sunderWeapon &&
    !spawn.poisonWeapon &&
    !spawn.siegeWeapon &&
    !spawn.isEntity &&
    isDifficultyAtLeast(difficultyId, 'hard')
  ) {
    grantSecondaryWeapons(enemy, weapons, enemy.weapon?.tier || 'Iron');
  }
  return enemy;
}
