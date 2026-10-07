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
// * a carrier (`spawn.carries`, EnemyCarry.js): a whole item held apart from the bag
//   (enemy.carriedItem). The AI never uses it and combat never reads it; only a Thief's
//   Steal takes it, and a carrier that falls first loses it (docs/specs/phase3.md 3G, Q4);
// * Nightfall and up: secondary weapons for multi-proficiency enemies without special gear;
// * a boss spawn that names Revival Stones (`spawn.revivalStones`, RevivalStones.js).
//
// applySpawnLoadout then applies what an authored spawn (data/prologue.json) fixes by
// hand: its weapon, its skills, its authored id and any stats it fixes (P4's Captain
// Varro). Generated spawns carry none of these,
// so for them it does nothing.
import { isStaff } from './Combat.js';
import { canEquip, grantSecondaryWeapons } from './UnitManager.js';
import { ensureItemUid } from '../utils/itemUid.js';
import { isDifficultyAtLeast } from './DifficultyEngine.js';
import { buildCarriedItem, isCarrierEligible } from './EnemyCarry.js';
import { applyRevivalStones } from './RevivalStones.js';
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
 * @param {{ weapons: object[], difficultyId?: string, consumables?: object[],
 *   battleKey?: string }} deps `consumables` is the run's catalog (a Vulnerary at the uses the
 *   run gives it); `battleKey` keeps a carried item's uid apart between battles.
 */
export function applyEnemySpawnGear(
  enemy,
  spawn,
  { weapons, difficultyId = 'normal', consumables = [], battleKey = '' } = {},
) {
  if (!enemy || !spawn) return enemy;
  applyRevivalStones(enemy, spawn);
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
  if (spawn.carries && isCarrierEligible(spawn) && isCarrierEligible(enemy)) {
    const item = buildCarriedItem(spawn, { consumables, weapons, battleKey });
    if (item) enemy.carriedItem = item;
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

/**
 * Apply an authored spawn's loadout to the enemy built from it (mutated). Run it after
 * applyEnemySpawnGear: what the author wrote is final.
 * - `spawn.weapon` (a weapons.json name): the enemy carries exactly that weapon,
 *   equipped. Specials such as Javelin are allowed (the tier picker never chooses them).
 *   A weapon the enemy can't wield (proficiency, rank, a scroll) is refused and the
 *   rolled kit stays. The new weapon takes over the dropped weapon's uid, so an authored
 *   weapon draws no extra Math.random and the battle's stream is unchanged.
 * - `spawn.skills` (an array of skill ids): exactly those skills, replacing class-innate
 *   and rolled ones; `[]` means none. Ids unknown to `skills` (when given) are dropped.
 * - `spawn.authoredId`: copied to `enemy.authoredId` (prologue beats name enemies by it).
 * - `spawn.stats` ({ <stat>: integer }): those stats replace what the class, level and
 *   a boss's bonus gave (any other stat stays). HP refills to the new maximum and MOV
 *   moves the unit's `mov`. Unknown stats and non-integers are ignored.
 * A spawn without these fields leaves the enemy untouched. No RNG of its own.
 * @param {object} enemy
 * @param {object} spawn
 * @param {{ weapons?: object[], skills?: object[]|null }} deps
 * @returns {{ weapon: 'equipped'|'unknown'|'refused'|null, skills: string[]|null }}
 */
export function applySpawnLoadout(enemy, spawn, { weapons = [], skills = null } = {}) {
  const report = { weapon: null, skills: null };
  if (!enemy || !spawn) return report;
  if (typeof spawn.authoredId === 'string' && spawn.authoredId) {
    enemy.authoredId = spawn.authoredId;
  }
  if (typeof spawn.weapon === 'string' && spawn.weapon) {
    const data = (weapons || []).find((w) => w?.name === spawn.weapon);
    if (!data) {
      report.weapon = 'unknown';
    } else if (data.type === 'Consumable' || !canEquip(enemy, data)) {
      report.weapon = 'refused';
    } else {
      const weapon = structuredClone(data);
      const inherited = enemy.weapon?.uid || (enemy.inventory || []).find((w) => w?.uid)?.uid;
      if (typeof inherited === 'string') weapon.uid = inherited;
      ensureItemUid(weapon);
      enemy.weapon = weapon;
      enemy.inventory = [weapon];
      report.weapon = 'equipped';
    }
  }
  if (Array.isArray(spawn.skills)) {
    const known = Array.isArray(skills) ? new Set(skills.map((s) => s?.id)) : null;
    enemy.skills = spawn.skills.filter((id) => typeof id === 'string' && (!known || known.has(id)));
    delete enemy.benchedSkills;
    report.skills = [...enemy.skills];
  }
  if (spawn.stats && typeof spawn.stats === 'object' && enemy.stats) {
    for (const [stat, value] of Object.entries(spawn.stats)) {
      if (!Object.hasOwn(enemy.stats, stat) || !Number.isInteger(value) || value < 0) continue;
      enemy.stats[stat] = stat === 'HP' ? Math.max(1, value) : value;
    }
    if (Object.hasOwn(spawn.stats, 'MOV')) enemy.mov = enemy.stats.MOV;
    enemy.currentHP = enemy.stats.HP;
  }
  return report;
}
