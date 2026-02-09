// SimUnitFactory.js — Unit creation wrappers for simulation scripts
// Loads game data from data/ and wraps UnitManager functions.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createLordUnit, createEnemyUnit, createUnit, promoteUnit, levelUp,
  gainExperience, canPromote, parseWeaponProficiencies
} from '../../src/engine/UnitManager.js';
import { BOSS_STAT_BONUS, XP_STAT_NAMES } from '../../src/utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');

function loadJSON(filename) {
  return JSON.parse(readFileSync(join(dataDir, filename), 'utf-8'));
}

let _data = null;

/** Load and cache all game data. */
export function getData() {
  if (_data) return _data;
  _data = {
    terrain: loadJSON('terrain.json'),
    lords: loadJSON('lords.json'),
    classes: loadJSON('classes.json'),
    weapons: loadJSON('weapons.json'),
    skills: loadJSON('skills.json'),
    enemies: loadJSON('enemies.json'),
    consumables: loadJSON('consumables.json'),
    lootTables: loadJSON('lootTables.json'),
    recruits: loadJSON('recruits.json'),
    mapSizes: loadJSON('mapSizes.json'),
    metaUpgrades: loadJSON('metaUpgrades.json'),
  };
  return _data;
}

/** Create a lord unit by name (e.g. 'Edric', 'Sera'). */
export function createLord(name) {
  const data = getData();
  const lordData = data.lords.find(l => l.name === name);
  if (!lordData) throw new Error(`Lord "${name}" not found`);
  const classData = data.classes.find(c => c.name === lordData.class);
  return createLordUnit(lordData, classData, data.weapons);
}

/**
 * Create an enemy unit by class name and level.
 * Handles promoted enemies: creates from base class at L10, promotes, then levels remaining.
 */
export function createEnemy(className, level, skillsData = null) {
  const data = getData();
  const skills = skillsData || data.skills;
  const classData = data.classes.find(c => c.name === className);
  if (!classData) throw new Error(`Class "${className}" not found`);

  if (classData.tier === 'promoted') {
    // Find base class
    const baseClassName = classData.promotesFrom;
    const baseClassData = data.classes.find(c => c.name === baseClassName);
    if (!baseClassData) throw new Error(`Base class "${baseClassName}" not found`);

    // Create at base L10, then promote
    const unit = createEnemyUnit(baseClassData, 10, data.weapons, 1.0, skills);
    promoteUnit(unit, classData, classData.promotionBonuses, skills);

    // Level up remaining (promoted level starts at 1)
    const promotedLevelsNeeded = level - 1;
    for (let i = 0; i < promotedLevelsNeeded; i++) {
      const gains = levelUp(unit);
      if (gains) {
        unit.level = gains.newLevel;
        for (const stat of XP_STAT_NAMES) {
          unit.stats[stat] += gains.gains[stat];
        }
        unit.currentHP += gains.gains.HP;
      }
    }
    return unit;
  }

  return createEnemyUnit(classData, level, data.weapons, 1.0, skills);
}

/** Create a boss enemy: createEnemy + BOSS_STAT_BONUS to all stats. */
export function createBoss(className, level) {
  const unit = createEnemy(className, level);
  for (const stat of XP_STAT_NAMES) {
    unit.stats[stat] += BOSS_STAT_BONUS;
  }
  unit.currentHP = unit.stats.HP;
  unit.isBoss = true;
  return unit;
}

/** Create a recruit NPC unit. */
export function createRecruit(className, name, level) {
  const data = getData();
  const classData = data.classes.find(c => c.name === className);
  if (!classData) throw new Error(`Class "${className}" not found`);
  const unit = createUnit(classData, level, data.weapons, { name, faction: 'npc' });
  return unit;
}

/** Get a weapon by name. */
export function getWeapon(name) {
  const data = getData();
  const weapon = data.weapons.find(w => w.name === name);
  if (!weapon) throw new Error(`Weapon "${name}" not found`);
  return { ...weapon };
}

/** Get the tier-appropriate weapon for a class at a given level. */
export function getTieredWeapon(className, level) {
  const data = getData();
  const classData = data.classes.find(c => c.name === className);
  if (!classData) return null;
  const profs = parseWeaponProficiencies(classData.weaponProficiencies);
  if (!profs.length) return null;
  const primaryType = profs[0].type;
  const tier = level >= 13 ? 'Silver' : level >= 6 ? 'Steel' : 'Iron';
  return data.weapons.find(w => w.type === primaryType && w.tier === tier && !w.special)
    || data.weapons.find(w => w.type === primaryType && w.tier === 'Iron');
}
