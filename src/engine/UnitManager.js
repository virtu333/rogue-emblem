// UnitManager.js — Pure unit creation, leveling, XP, promotion functions
// No Phaser imports. Matches Combat.js pattern (stateless helpers).

import {
  XP_PER_LEVEL,
  XP_BASE_COMBAT,
  XP_KILL_BONUS,
  XP_LEVEL_DIFF_SCALE,
  XP_LEVEL_DIFF_STEEP,
  XP_MIN,
  XP_STAT_NAMES,
  BASE_CLASS_LEVEL_CAP,
  PROMOTED_CLASS_LEVEL_CAP,
  PROMOTION_MIN_LEVEL,
  MAX_SKILLS,
  ENEMY_PROMOTION_BASE_LEVEL,
} from '../utils/constants.js';

// --- Weapon proficiency parsing ---

// Map plural proficiency names → weapon.type singular
const PROF_TO_TYPE = {
  Swords: 'Sword',
  Lances: 'Lance',
  Axes: 'Axe',
  Bows: 'Bow',
  Tomes: 'Tome',
  Light: 'Light',
  Staves: 'Staff',
  Breath: 'Breath',
};

// Weapon/staff item types that participate in proficiency checks.
export const PROFICIENCY_RELEVANT_ITEM_TYPES = new Set(Object.values(PROF_TO_TYPE));

export function isProficiencyRelevantItemType(type) {
  return PROFICIENCY_RELEVANT_ITEM_TYPES.has(type);
}

// Map rank abbreviation → full name
const RANK_ABBREV = { P: 'Prof', M: 'Mast' };

function applyPromotedMastery(proficiencies, tier) {
  if (tier !== 'promoted') return proficiencies;
  return proficiencies.map((p) => ({ ...p, rank: 'Mast' }));
}

function getCanonicalClassMove(classData, fallbackMove = 4) {
  const classMov = Number(classData?.baseStats?.MOV);
  return Number.isFinite(classMov) && classMov > 0 ? classMov : fallbackMove;
}

/**
 * Parse "Swords (P), Lances (M)" → [{type:'Sword', rank:'Prof'}, {type:'Lance', rank:'Mast'}]
 */
export function parseWeaponProficiencies(profString) {
  if (!profString || profString === 'None') return [];
  return profString
    .split(',')
    .map((s) => {
      const trimmed = s.trim();
      const match = trimmed.match(/^(\w+(?:\s\w+)?)\s*\((\w)\)$/);
      if (!match) return null;
      const rawName = match[1].trim();
      const rankChar = match[2];
      const type = PROF_TO_TYPE[rawName] || rawName;
      const rank = RANK_ABBREV[rankChar] || 'Prof';
      return { type, rank };
    })
    .filter(Boolean);
}

// --- Growth rate helpers ---

/**
 * Roll growth rates from ranges: {HP:"60-75",...} → {HP:67,...}
 * Called once at recruitment, stored permanently on unit.
 */
export function rollGrowthRates(growthRanges) {
  const growths = {};
  for (const stat of XP_STAT_NAMES) {
    const range = growthRanges[stat];
    if (!range) {
      growths[stat] = 0;
      continue;
    }
    const [min, max] = range.split('-').map(Number);
    growths[stat] = min + Math.floor(Math.random() * (max - min + 1));
  }
  return growths;
}

// --- Skill assignment helpers ---

/**
 * Parse a lord's personalSkill string to extract the skill ID.
 * e.g. "Charisma: Allies within 2 tiles..." → "charisma"
 */
function parsePersonalSkillId(personalSkillStr) {
  if (!personalSkillStr) return null;
  const colonIdx = personalSkillStr.indexOf(':');
  const name = colonIdx > 0 ? personalSkillStr.slice(0, colonIdx).trim() : personalSkillStr.trim();
  // Convert to snake_case ID: "Renewal Aura" → "renewal_aura"
  return name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Get class-innate skill IDs for a given class name from skills data.
 */
export function getClassInnateSkills(className, skillsData) {
  if (!skillsData) return [];
  return skillsData
    .filter((s) => {
      if (Array.isArray(s.classInnate)) return s.classInnate.includes(className);
      return s.classInnate === className;
    })
    .map((s) => s.id);
}

// --- Skill learning ---

/** Attempt to teach a unit a skill. Returns { learned, skillId?, reason? }. */
export function learnSkill(unit, skillId) {
  if (unit.skills.includes(skillId)) return { learned: false, reason: 'already_known' };
  if (unit.skills.length >= MAX_SKILLS) return { learned: false, reason: 'at_cap' };
  unit.skills.push(skillId);
  return { learned: true, skillId };
}

/** Check if unit qualifies for any class-based or personal L20 skill at current level. Returns array of learned skill IDs. */
export function checkLevelUpSkills(unit, classesData) {
  const learned = [];

  const cls = classesData.find((c) => c.name === unit.className);
  const tryLearn = (skillId) => {
    const result = learnSkill(unit, skillId);
    if (result.learned) learned.push(skillId);
  };

  // Class-based learnable skills for current class.
  if (cls?.learnableSkills) {
    for (const entry of cls.learnableSkills) {
      if (unit.level >= entry.level) {
        tryLearn(entry.skillId);
      }
    }
  }

  // Promoted units can still learn missed base-class class skills at promoted level 10+.
  if (unit.tier === 'promoted' && unit.level >= 10 && cls?.promotesFrom) {
    const baseClass = classesData.find((c) => c.name === cls.promotesFrom);
    if (baseClass?.learnableSkills) {
      for (const entry of baseClass.learnableSkills) {
        tryLearn(entry.skillId);
      }
    }
  }

  // Lord personal skill: base class level 20 OR promoted class level 10
  if (
    unit._personalSkillL20 &&
    ((unit.tier === 'base' && unit.level >= 20) || (unit.tier === 'promoted' && unit.level >= 10))
  ) {
    const result = learnSkill(unit, unit._personalSkillL20.skillId);
    if (result.learned) learned.push(unit._personalSkillL20.skillId);
  }

  return learned;
}

// --- Unit creation ---

/**
 * Create a lord unit from lords.json + classes.json data.
 * Lords have fixed personalGrowths added on top of class growths.
 */
export function createLordUnit(lordData, classData, allWeapons) {
  const proficiencies = parseWeaponProficiencies(classData?.weaponProficiencies || lordData.weapon);
  const classGrowths = classData?.growthRanges ? rollGrowthRates(classData.growthRanges) : {};

  // Combine class growths + personal growths
  const growths = {};
  for (const stat of XP_STAT_NAMES) {
    growths[stat] = (classGrowths[stat] || 0) + (lordData.personalGrowths[stat] || 0);
  }

  const weapon = getDefaultWeapon(proficiencies, allWeapons);

  // Parse personal skill from lord data
  const personalSkillId = parsePersonalSkillId(lordData.personalSkill);
  const skills = personalSkillId ? [personalSkillId] : [];

  // Store L20 personal skill data for later learning
  const personalSkillL20 = lordData.personalSkillL20 || null;

  // Clone weapon to avoid shared state
  const weaponClone = weapon ? structuredClone(weapon) : null;

  return {
    name: lordData.name,
    className: lordData.class,
    tier: 'base',
    level: 1,
    xp: 0,
    isLord: true,
    personalGrowths: { ...lordData.personalGrowths },
    growths,
    proficiencies,
    skills,
    col: 0,
    row: 0,
    mov: lordData.baseStats.MOV,
    moveType: lordData.moveType,
    stats: { ...lordData.baseStats },
    currentHP: lordData.baseStats.HP,
    faction: 'player',
    weapon: weaponClone,
    inventory: weaponClone ? [weaponClone] : [],
    consumables: [],
    accessory: null,
    weaponRank: proficiencies[0]?.rank || 'Prof',
    affixes: [],
    hasMoved: false,
    hasActed: false,
    graphic: null,
    label: null,
    hpBar: null,
    _personalSkillL20: personalSkillL20,
  };
}

/**
 * Create a generic recruited unit from class data.
 * Growth rates are rolled randomly from class growthRanges.
 */
export function createUnit(classData, level, allWeapons, options = {}) {
  const proficiencies = applyPromotedMastery(
    parseWeaponProficiencies(classData.weaponProficiencies),
    classData.tier || 'base',
  );
  const growths = rollGrowthRates(classData.growthRanges);
  const weapon = getDefaultWeapon(proficiencies, allWeapons);
  const weaponClone = weapon ? structuredClone(weapon) : null;

  const unit = {
    name: options.name || classData.name,
    className: classData.name,
    tier: classData.tier || 'base',
    level: 1,
    xp: 0,
    isLord: false,
    personalGrowths: null,
    growths,
    proficiencies,
    skills: [],
    col: options.col || 0,
    row: options.row || 0,
    mov: classData.baseStats.MOV,
    moveType: classData.moveType,
    stats: { ...classData.baseStats },
    currentHP: classData.baseStats.HP,
    faction: options.faction || 'player',
    weapon: weaponClone,
    inventory: weaponClone ? [weaponClone] : [],
    consumables: [],
    affixes: [],
    accessory: null,
    weaponRank: proficiencies[0]?.rank || 'Prof',
    hasMoved: false,
    hasActed: false,
    graphic: null,
    label: null,
    hpBar: null,
  };

  // Secondary throwable for melee classes
  const SECONDARY_THROWABLE = { Knight: 'Javelin', Fighter: 'Hand Axe' };
  const secondaryName = SECONDARY_THROWABLE[classData.name];
  if (secondaryName) {
    const secondary = allWeapons.find((w) => w.name === secondaryName);
    if (secondary) addToInventory(unit, secondary);
  }

  // Auto-level to target level
  for (let i = 1; i < level; i++) {
    const gains = levelUp(unit);
    if (gains) applyLevelUpGains(unit, gains);
  }

  return unit;
}

/**
 * Create an enemy unit. Pre-leveled with difficulty scaling.
 * Weapon tier scales with level: 1-5 Iron, 6-12 Steel, 13+ Silver.
 * skillsData: if provided, promoted enemies get class innate skills,
 * level 5+ enemies get 1 random combat skill (chance scaled by act).
 * act: 'act1'/'act2'/'act3'/'act4'/'finalBoss' — determines skill assignment probability.
 */
function parseEnemyDifficultyConfig(difficultyConfig = 1.0) {
  const isConfigObject = difficultyConfig && typeof difficultyConfig === 'object';
  const difficultyMod = isConfigObject
    ? Number(difficultyConfig.multiplier ?? 1.0)
    : Number(difficultyConfig ?? 1.0);
  const enemyStatBonus = isConfigObject
    ? Math.trunc(Number(difficultyConfig.enemyStatBonus ?? 0))
    : 0;
  const enemyEquipTierShift = isConfigObject
    ? Math.trunc(Number(difficultyConfig.enemyEquipTierShift ?? 0))
    : 0;
  return { difficultyMod, enemyStatBonus, enemyEquipTierShift };
}

export function applyEnemyDifficultyModifiers(unit, difficultyConfig = 1.0) {
  if (!unit) return unit;
  const { difficultyMod, enemyStatBonus } = parseEnemyDifficultyConfig(difficultyConfig);

  // Apply multiplier first for backward compatibility with harness fixtures.
  if (Number.isFinite(difficultyMod) && difficultyMod !== 1.0) {
    for (const stat of XP_STAT_NAMES) {
      unit.stats[stat] = Math.round(unit.stats[stat] * difficultyMod);
    }
    unit.currentHP = unit.stats.HP;
  }

  // Apply flat difficulty stat bonus (HP gets double value).
  if (enemyStatBonus !== 0) {
    for (const stat of XP_STAT_NAMES) {
      const delta = stat === 'HP' ? enemyStatBonus * 2 : enemyStatBonus;
      unit.stats[stat] = (unit.stats[stat] || 0) + delta;
    }
    unit.currentHP = unit.stats.HP;
  }

  return unit;
}

function assignEnemySkills(unit, classData, level, skillsData, act) {
  if (!skillsData) return;

  // Promoted enemies get class innate skills.
  if (classData.tier === 'promoted') {
    const innateSkills = getClassInnateSkills(classData.name, skillsData);
    for (const sid of innateSkills) {
      if (!unit.skills.includes(sid)) unit.skills.push(sid);
    }
  }

  // Act-scaled combat skill chance.
  const SKILL_CHANCE_BY_ACT = {
    act1: 0.1,
    act2: 0.25,
    act3: 0.5,
    act4: 0.6,
    finalBoss: 0.65,
  };
  const chance = SKILL_CHANCE_BY_ACT[act] || 0.0;

  // Level 5+ enemies roll for 1 random combat skill based on act.
  if (level >= 5 && Math.random() < chance) {
    const pool = ['sol', 'luna', 'vantage', 'wrath', 'adept', 'guard'];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!unit.skills.includes(pick)) unit.skills.push(pick);
  }
}

export function createEnemyUnit(
  classData,
  level,
  allWeapons,
  difficultyConfig = 1.0,
  skillsData = null,
  act = 'act1',
) {
  const enemyLevel = Math.max(1, Math.trunc(Number(level) || 1));
  const proficiencies = applyPromotedMastery(
    parseWeaponProficiencies(classData.weaponProficiencies),
    classData.tier || 'base',
  );
  const growths = classData.growthRanges ? rollGrowthRates(classData.growthRanges) : {};

  // Pick weapon tier by level, with optional difficulty-driven tier shift (act2+ only)
  const { enemyEquipTierShift } = parseEnemyDifficultyConfig(difficultyConfig);
  const tierShift = act !== 'act1' ? enemyEquipTierShift : 0;
  const effectiveLevel = enemyLevel + tierShift * 5;
  const weaponTier = effectiveLevel >= 13 ? 'Silver' : effectiveLevel >= 6 ? 'Steel' : 'Iron';
  const weapon = getWeaponByTier(proficiencies, allWeapons, weaponTier);

  // Clone weapon to avoid shared state
  const weaponClone = weapon ? structuredClone(weapon) : null;

  const unit = {
    name: classData.name,
    className: classData.name,
    tier: classData.tier || 'base',
    level: 1,
    xp: 0,
    isLord: false,
    personalGrowths: null,
    growths,
    proficiencies,
    skills: [],
    col: 0,
    row: 0,
    mov: classData.baseStats.MOV,
    moveType: classData.moveType,
    stats: { ...classData.baseStats },
    currentHP: classData.baseStats.HP,
    faction: 'enemy',
    weapon: weaponClone,
    inventory: weaponClone ? [weaponClone] : [],
    consumables: [],
    affixes: [],
    accessory: null,
    weaponRank: proficiencies[0]?.rank || 'Prof',
    hasMoved: false,
    hasActed: false,
    graphic: null,
    label: null,
    hpBar: null,
  };

  // Auto-level to target level (boss-tier classes have final stats, skip leveling)
  if (classData.tier !== 'boss') {
    for (let i = 1; i < enemyLevel; i++) {
      const gains = levelUp(unit);
      if (gains) applyLevelUpGains(unit, gains);
    }
  }

  applyEnemyDifficultyModifiers(unit, difficultyConfig);
  if (classData.tier !== 'boss') {
    assignEnemySkills(unit, classData, enemyLevel, skillsData, act);
  }

  return unit;
}

/**
 * Create a promoted enemy from base class with capped pre-promotion growth.
 * Difficulty modifiers are applied once to the final promoted statline.
 */
export function createPromotedEnemyUnit(
  promotedClassData,
  level,
  allWeapons,
  difficultyConfig = 1.0,
  skillsData = null,
  act = 'act1',
  classesData = [],
) {
  if (!promotedClassData) return null;
  if (promotedClassData.tier !== 'promoted') {
    return createEnemyUnit(promotedClassData, level, allWeapons, difficultyConfig, skillsData, act);
  }

  const spawnLevel = Math.max(1, Math.trunc(Number(level) || 1));
  const baseClassData = Array.isArray(classesData)
    ? classesData.find((candidate) => candidate?.name === promotedClassData.promotesFrom)
    : null;
  if (!baseClassData) return null;

  const cappedBaseLevel = Math.min(spawnLevel, ENEMY_PROMOTION_BASE_LEVEL);
  const enemy = createEnemyUnit(baseClassData, cappedBaseLevel, allWeapons, 1.0, null, act);
  promoteUnit(enemy, promotedClassData, promotedClassData.promotionBonuses, skillsData);

  const promotedLevels = Math.max(0, spawnLevel - ENEMY_PROMOTION_BASE_LEVEL);
  for (let i = 0; i < promotedLevels; i++) {
    const gains = levelUp(enemy);
    if (gains) applyLevelUpGains(enemy, gains);
  }
  if (Array.isArray(classesData) && classesData.length > 0) {
    checkLevelUpSkills(enemy, classesData);
  }

  applyEnemyDifficultyModifiers(enemy, difficultyConfig);
  assignEnemySkills(enemy, promotedClassData, spawnLevel, skillsData, act);
  return enemy;
}

/**
 * Create a recruit NPC unit for mid-battle recruitment.
 * Uses same pattern as createEnemyUnit but with faction: 'npc'.
 * Weapon tier scales with level: 1-5 Iron, 6-12 Steel, 13+ Silver.
 */
export function createRecruitUnit(
  recruitDef,
  classData,
  allWeapons,
  statBonuses = null,
  growthBonuses = null,
  randomSkillPool = null,
  classesData = null,
) {
  const proficiencies = applyPromotedMastery(
    parseWeaponProficiencies(classData.weaponProficiencies),
    classData.tier || 'base',
  );
  const growths = rollGrowthRates(classData.growthRanges);

  const weaponTier = recruitDef.level >= 13 ? 'Silver' : recruitDef.level >= 6 ? 'Steel' : 'Iron';
  const weapon = getWeaponByTier(proficiencies, allWeapons, weaponTier);

  // Clone weapon to avoid shared state
  const weaponClone = weapon ? structuredClone(weapon) : null;

  const unit = {
    name: recruitDef.name,
    className: classData.name,
    tier: classData.tier || 'base',
    level: 1,
    xp: 0,
    isLord: false,
    personalGrowths: null,
    growths,
    proficiencies,
    skills: [],
    col: 0,
    row: 0,
    mov: classData.baseStats.MOV,
    moveType: classData.moveType,
    stats: { ...classData.baseStats },
    currentHP: classData.baseStats.HP,
    faction: 'npc',
    weapon: weaponClone,
    inventory: weaponClone ? [weaponClone] : [],
    consumables: [],
    affixes: [],
    accessory: null,
    weaponRank: proficiencies[0]?.rank || 'Prof',
    hasMoved: false,
    hasActed: false,
    graphic: null,
    label: null,
    hpBar: null,
  };

  // Apply meta-progression growth bonuses BEFORE leveling
  if (growthBonuses) {
    for (const [stat, bonus] of Object.entries(growthBonuses)) {
      unit.growths[stat] = (unit.growths[stat] || 0) + bonus;
    }
  }

  // Auto-level to target level
  for (let i = 1; i < recruitDef.level; i++) {
    const gains = levelUp(unit);
    if (gains) applyLevelUpGains(unit, gains);
  }

  // Apply meta-progression flat stat bonuses (after leveling)
  if (statBonuses) {
    for (const [stat, bonus] of Object.entries(statBonuses)) {
      unit.stats[stat] = (unit.stats[stat] || 0) + bonus;
    }
    if (statBonuses.HP) unit.currentHP += statBonuses.HP;
  }

  // Random combat skill from meta upgrade
  if (randomSkillPool && randomSkillPool.length > 0) {
    const skill = randomSkillPool[Math.floor(Math.random() * randomSkillPool.length)];
    if (!unit.skills.includes(skill)) unit.skills.push(skill);
  }

  // Give Archer/Sniper recruits a Longbow for tactical range advantage.
  // Keep this scoped to dedicated bow classes (not all classes with Bow proficiency).
  const isArcherTypeRecruit = classData.name === 'Archer' || classData.name === 'Sniper';
  if (isArcherTypeRecruit) {
    const longbow = allWeapons.find((w) => w.name === 'Longbow');
    if (longbow) addToInventory(unit, longbow);
  }

  // Ensure already-leveled recruits receive any class learnables at current thresholds.
  if (Array.isArray(classesData) && classesData.length > 0) {
    checkLevelUpSkills(unit, classesData);
  }

  return unit;
}

const LETHAL_ARMORY_WEAPONS = {
  Sword: {
    steel: 'Steel Sword',
    killer: 'Killing Edge',
    silver: 'Silver Sword',
  },
  Lance: {
    steel: 'Steel Lance',
    killer: 'Killer Lance',
    silver: 'Silver Lance',
  },
  Axe: {
    steel: 'Steel Axe',
    killer: 'Killer Axe',
    silver: 'Silver Axe',
  },
  Bow: {
    steel: 'Steel Bow',
    killer: 'Killer Bow',
    silver: 'Silver Bow',
  },
  Tome: {
    steel: 'Elfire',
    killer: null,
    silver: 'Bolganone',
  },
  Light: {
    steel: 'Shine',
    killer: null,
    silver: 'Aura',
  },
};

function isStaffOnlyProficiencyList(proficiencies) {
  if (!Array.isArray(proficiencies) || proficiencies.length === 0) return true;
  const nonStaffTypes = proficiencies
    .map((p) => p?.type)
    .filter((type) => type && type !== 'Staff');
  return nonStaffTypes.length === 0;
}

function selectLethalArmoryType(proficiencies) {
  const types = Array.from(
    new Set((proficiencies || []).map((p) => p?.type).filter((type) => type && type !== 'Staff')),
  );
  if (types.length === 0) return null;
  return types[Math.floor(Math.random() * types.length)] || null;
}

function pickLethalArmoryWeapon(allWeapons, weaponType, lethalArmoryTier) {
  const byType = LETHAL_ARMORY_WEAPONS[weaponType];
  if (!byType) return null;

  const roll = Math.random();
  const tier = Math.max(1, Math.min(3, Math.trunc(Number(lethalArmoryTier) || 0)));
  const pickByName = (name) => {
    if (!name) return null;
    return allWeapons?.find((weapon) => weapon?.name === name) || null;
  };

  // Tier 1: always Steel.
  if (tier === 1) return pickByName(byType.steel);

  // Tier 2: 75% Steel, 25% Killer, with Killer fallback to Steel.
  if (tier === 2) {
    if (roll < 0.75) return pickByName(byType.steel);
    return pickByName(byType.killer) || pickByName(byType.steel);
  }

  // Tier 3: 50% Steel, 25% Killer (fallback to Silver then Steel), 25% Silver (fallback to Steel).
  if (roll < 0.5) return pickByName(byType.steel);
  if (roll < 0.75) {
    return pickByName(byType.killer) || pickByName(byType.silver) || pickByName(byType.steel);
  }
  return pickByName(byType.silver) || pickByName(byType.steel);
}

/** Grant one additional recruit-only weapon from Lethal Armory. Returns true when granted. */
export function grantLethalArmoryWeapon(unit, allWeapons, lethalArmoryTier = 0) {
  const tier = Math.max(0, Math.trunc(Number(lethalArmoryTier) || 0));
  if (!unit || tier <= 0) return false;
  if (unit.isLord) return false;
  if (!Array.isArray(unit.inventory) || !Array.isArray(unit.proficiencies)) return false;
  if (isStaffOnlyProficiencyList(unit.proficiencies)) return false;

  const weaponType = selectLethalArmoryType(unit.proficiencies);
  if (!weaponType) return false;

  const weapon = pickLethalArmoryWeapon(allWeapons, weaponType, tier);
  if (!weapon) return false;

  if (!addToInventory(unit, weapon)) return false;
  const grantedWeapon = unit.inventory[unit.inventory.length - 1];
  if (canEquip(unit, grantedWeapon)) {
    unit.weapon = grantedWeapon;
  }
  return true;
}

// --- Leveling ---

/**
 * Roll a level-up: each stat has growth% chance to gain +1.
 * Guarantees at least 1 stat gain (uses highest growth as fallback).
 * Returns { gains: {HP:1, STR:0, ...}, newLevel } or null if at cap.
 */
export function levelUp(unit) {
  const cap = unit.tier === 'promoted' ? PROMOTED_CLASS_LEVEL_CAP : BASE_CLASS_LEVEL_CAP;
  if (unit.level >= cap) return null;

  const gains = {};
  let totalGains = 0;

  for (const stat of XP_STAT_NAMES) {
    const growth = unit.growths[stat] || 0;
    const gained = Math.random() * 100 < growth ? 1 : 0;
    gains[stat] = gained;
    totalGains += gained;
  }

  // Guarantee at least 1 stat gain
  if (totalGains === 0) {
    let bestStat = 'HP';
    let bestGrowth = 0;
    for (const stat of XP_STAT_NAMES) {
      if ((unit.growths[stat] || 0) > bestGrowth) {
        bestGrowth = unit.growths[stat];
        bestStat = stat;
      }
    }
    gains[bestStat] = 1;
  }

  return { gains, newLevel: unit.level + 1 };
}

/**
 * Roll an extended level-up for promoted units past the level cap.
 * Grants exactly +1 to a random stat (uniform from XP_STAT_NAMES).
 * Does NOT use growth rates — purely random.
 * Returns { gains, newLevel, extendedLevel, isExtended: true }.
 */
export function extendedLevelUp(unit) {
  const gains = {};
  for (const stat of XP_STAT_NAMES) {
    gains[stat] = 0;
  }
  const pick = XP_STAT_NAMES[Math.floor(Math.random() * XP_STAT_NAMES.length)];
  gains[pick] = 1;

  return {
    gains,
    newLevel: unit.level,
    extendedLevel: (unit.extendedLevels || 0) + 1,
    isExtended: true,
  };
}

/** Apply level-up gains to a unit (mutates in-place). */
export function applyLevelUpGains(unit, levelUpResult) {
  if (levelUpResult.isExtended) {
    unit.extendedLevels = levelUpResult.extendedLevel;
  } else {
    unit.level = levelUpResult.newLevel;
  }
  for (const stat of XP_STAT_NAMES) {
    unit.stats[stat] += levelUpResult.gains[stat];
  }
  // Keep currentHP in sync — heal the HP gain
  unit.currentHP += levelUpResult.gains.HP;
}

/**
 * Format a unit's level for UI display.
 * Returns "20+3" when extendedLevels > 0, otherwise the plain level string.
 */
export function getDisplayLevel(unit) {
  if (unit.extendedLevels > 0) {
    return `${unit.level}+${unit.extendedLevels}`;
  }
  return String(unit.level);
}

/**
 * Add XP to a unit. May trigger one or more level-ups.
 * Returns { levelUps: [{gains, newLevel}, ...] } — empty array if no level-up.
 * Mutates unit in-place.
 */
export function gainExperience(unit, xpAmount, options = {}) {
  const cap = unit.tier === 'promoted' ? PROMOTED_CLASS_LEVEL_CAP : BASE_CLASS_LEVEL_CAP;
  const levelUps = [];
  const extendedEnabled = options.extendedLevelingEnabled === true && unit.tier === 'promoted';

  // Don't gain XP at level cap (unless extended leveling is enabled for promoted units)
  if (unit.level >= cap && !extendedEnabled) return { levelUps };

  unit.xp += xpAmount;

  while (unit.xp >= XP_PER_LEVEL) {
    unit.xp -= XP_PER_LEVEL;
    // Try normal level-up first
    const result = levelUp(unit);
    if (!result) {
      // At cap — use extended level-up if enabled
      if (extendedEnabled) {
        const extResult = extendedLevelUp(unit);
        applyLevelUpGains(unit, extResult);
        levelUps.push(extResult);
        continue;
      }
      // Otherwise clamp XP and stop
      unit.xp = Math.min(unit.xp, XP_PER_LEVEL - 1);
      break;
    }
    applyLevelUpGains(unit, result);
    levelUps.push(result);
  }

  return { levelUps };
}

/**
 * Calculate XP earned from combat.
 * Tiered diminishing returns when attacker is over-leveled:
 * - Advantage 0-3: normal scale (-5 per level)
 * - Advantage 4-6: steep scale (-8 per level for excess beyond 3)
 * - Advantage 7+: flat minimum XP, no kill bonus
 * - Underdog bonus (defender higher than attacker) is capped at +6 levels
 */
function getXpEffectiveLevel(unit) {
  const visibleLevel = Math.max(1, Math.trunc(Number(unit?.level) || 1));
  return unit?.tier === 'promoted' ? visibleLevel + 12 : visibleLevel;
}

export function calculateCombatXP(attacker, defender, defenderDied) {
  const atkLevel = getXpEffectiveLevel(attacker);
  const defLevel = getXpEffectiveLevel(defender);
  const advantage = atkLevel - defLevel; // positive when attacker is higher

  // Tier 3: extreme over-leveling — flat minimum, no kill bonus
  if (advantage >= 7) {
    return XP_MIN;
  }

  // Tier 2: moderate over-leveling — steeper penalty, half kill bonus
  if (advantage > 3) {
    const basePenalty = 3 * XP_LEVEL_DIFF_SCALE; // penalty for first 3 levels of advantage
    const steepPenalty = (advantage - 3) * XP_LEVEL_DIFF_STEEP; // steep penalty for 4-6
    const killBonus = defenderDied ? Math.floor(XP_KILL_BONUS / 2) : 0;
    return Math.max(XP_MIN, XP_BASE_COMBAT - basePenalty - steepPenalty + killBonus);
  }

  // Tier 1: normal (under-leveled, equal, or slight advantage 0-3)
  const rawLevelDiff = defLevel - atkLevel; // positive when defender is higher (bonus), negative when attacker is higher (penalty)
  const levelDiff = rawLevelDiff > 0 ? Math.min(rawLevelDiff, 6) : rawLevelDiff;
  const killBonus = defenderDied ? XP_KILL_BONUS : 0;
  return Math.max(XP_MIN, XP_BASE_COMBAT + levelDiff * XP_LEVEL_DIFF_SCALE + killBonus);
}

// --- Promotion ---

/** Check if unit can promote (base tier, level >= 10). */
export function canPromote(unit) {
  return unit.tier === 'base' && unit.level >= PROMOTION_MIN_LEVEL;
}

/**
 * Normalize class-driven unit state (tier/moveType/proficiencies/mov sync).
 * Keeps stats.MOV authoritative when present to preserve existing bonuses.
 */
export function normalizeUnitClassState(unit, classData) {
  if (!unit || !classData) return unit;

  const canonicalTier = classData.tier || unit.tier || 'base';
  unit.tier = canonicalTier;

  if (classData.moveType) unit.moveType = classData.moveType;

  if (!unit.stats || typeof unit.stats !== 'object') unit.stats = {};
  const fallbackMov = getCanonicalClassMove(classData, Number(unit.mov) || 4);
  const statsMov = Number(unit.stats.MOV);
  if (Number.isFinite(statsMov) && statsMov > 0) {
    unit.mov = statsMov;
  } else {
    unit.stats.MOV = fallbackMov;
    unit.mov = fallbackMov;
  }

  const canonicalProficiencies = applyPromotedMastery(
    parseWeaponProficiencies(classData.weaponProficiencies),
    canonicalTier,
  );
  if (canonicalProficiencies.length > 0) {
    unit.proficiencies = canonicalProficiencies;
    unit.weaponRank = canonicalProficiencies[0]?.rank || 'Prof';
  } else {
    if (!Array.isArray(unit.proficiencies)) unit.proficiencies = [];
    unit.weaponRank = unit.proficiencies[0]?.rank || 'Prof';
  }

  return unit;
}

const BLOCKED_PROMOTION_CLASSES = new Set(['Bard']);

/** Returns true when a promotion target class is temporarily disabled. */
export function isPromotionClassBlocked(className) {
  return BLOCKED_PROMOTION_CLASSES.has(className);
}

/**
 * Resolve all promotion target classes for a unit.
 * Returns array of class data objects, or null when unavailable/blocked.
 * Lords always have a single target. Recruitable base classes may have 2.
 */
export function resolvePromotionTargets(unit, classesData, lordsData = []) {
  if (!canPromote(unit)) return null;
  const lordData = lordsData.find((l) => l.name === unit.name);
  if (lordData) {
    const cls = classesData.find((c) => c.name === lordData.promotedClass);
    return cls ? [cls] : null;
  }
  const baseClass = classesData.find((c) => c.name === unit.className);
  if (!baseClass?.promotesTo) return null;
  const targets = Array.isArray(baseClass.promotesTo)
    ? baseClass.promotesTo
    : [baseClass.promotesTo];
  const resolved = targets
    .filter((name) => !isPromotionClassBlocked(name))
    .map((name) => classesData.find((c) => c.name === name))
    .filter(Boolean);
  return resolved.length > 0 ? resolved : null;
}

/**
 * Resolve a unit's first promotion target class (backward-compat wrapper).
 * Returns class data for the first valid target, or null when unavailable/blocked.
 */
export function resolvePromotionTargetClass(unit, classesData, lordsData = []) {
  return resolvePromotionTargets(unit, classesData, lordsData)?.[0] ?? null;
}

/**
 * Promote a unit. Apply stat bonuses, reset level, update class/proficiencies.
 * Optionally adds class-innate skills from skillsData.
 * Mutates unit in-place.
 */
export function promoteUnit(unit, promotedClassData, promotionBonuses, skillsData) {
  // Apply promotion bonuses to stats
  for (const stat of [...XP_STAT_NAMES, 'MOV']) {
    const bonus = promotionBonuses[stat] || 0;
    unit.stats[stat] += bonus;
  }
  unit.currentHP += promotionBonuses.HP || 0;
  unit.mov = unit.stats.MOV;

  // Apply growth bonuses from promoted class
  if (promotedClassData.growthBonuses && unit.growths) {
    for (const [stat, bonus] of Object.entries(promotedClassData.growthBonuses)) {
      if (stat in unit.growths) {
        unit.growths[stat] += bonus;
      }
    }
  }

  // Update class info; sync generic enemy names (name === className) to promoted class.
  if (unit.name === unit.className) {
    unit.name = promotedClassData.name;
  }
  unit.className = promotedClassData.name;
  unit.tier = 'promoted';
  unit.level = 1;
  unit.xp = 0;

  normalizeUnitClassState(unit, promotedClassData);
  if (unit.weapon && !canEquip(unit, unit.weapon)) {
    unit.weapon = getCombatWeapons(unit)[0] || null;
  }

  // Add class-innate skills
  const innateSkills = getClassInnateSkills(promotedClassData.name, skillsData);
  for (const sid of innateSkills) {
    if (!unit.skills.includes(sid)) {
      unit.skills.push(sid);
    }
  }
}

// --- Reclass ---

// Classes excluded from reclass targets (lord-exclusive + Dancer/Bard line).
const RECLASS_EXCLUDED_CLASSES = new Set([
  'Lord',
  'Great Lord',
  'Tactician',
  'Grandmaster',
  'Ranger',
  'Vanguard',
  'Light Sage',
  'Light Priestess',
  'Chevalier',
  'Holy Knight',
  'Sky Lancer',
  'Seraph Knight',
  'Sentinel',
  'Champion',
  'Dancer',
  'Bard',
]);

// Seal subEffect → allowed moveTypes.
const RECLASS_SEAL_MOVE_TYPES = {
  infantry: new Set(['Infantry', 'Armored']),
  mounted: new Set(['Cavalry', 'Flying']),
};

/** Check if a unit can reclass at all (not lord, not Dancer/Bard). */
export function canReclass(unit) {
  if (!unit) return false;
  if (unit.isLord) return false;
  if (RECLASS_EXCLUDED_CLASSES.has(unit.className)) return false;
  return true;
}

/**
 * Get valid reclass target classes for a unit given a seal subEffect.
 * Returns array of class data objects from classesData.
 * Filters: same tier, matching moveType for seal, excludes current class, excludes lord/Dancer/Bard.
 */
export function getReclassTargets(unit, classesData, sealSubEffect) {
  if (!canReclass(unit) || !classesData || !sealSubEffect) return [];
  const allowedMoves = RECLASS_SEAL_MOVE_TYPES[sealSubEffect];
  if (!allowedMoves) return [];
  return classesData.filter(
    (c) =>
      c.tier === unit.tier &&
      allowedMoves.has(c.moveType) &&
      c.name !== unit.className &&
      !RECLASS_EXCLUDED_CLASSES.has(c.name),
  );
}

/**
 * Reclass a unit into a new class. Mutates unit in-place.
 * Uses base-stat delta: newStat[S] = unit.stats[S] - oldBase[S] + newBase[S], clamped ≥ 1.
 * Re-rolls growths from new class. Level/XP preserved.
 * Conservative skill handling: adds new class innates, does NOT remove old ones.
 */
export function reclassUnit(unit, newClassData, oldClassData, classesData, skillsData) {
  if (!unit || !newClassData || !oldClassData) return;

  const oldMaxHP = unit.stats.HP;

  // --- Stat delta ---
  // For promoted classes that don't have baseStats, we need the promotesFrom base class baseStats.
  // But all classes in classes.json have baseStats (promoted classes have their OWN base stats
  // which include promotion bonuses baked in for enemies). For reclass delta, we use the class's
  // own baseStats directly.
  const oldBase = oldClassData.baseStats || {};
  const newBase = newClassData.baseStats || {};

  for (const stat of [...XP_STAT_NAMES, 'MOV']) {
    const delta = (newBase[stat] || 0) - (oldBase[stat] || 0);
    unit.stats[stat] = Math.max(1, (unit.stats[stat] || 0) + delta);
  }

  // Preserve HP ratio
  const newMaxHP = unit.stats.HP;
  if (oldMaxHP > 0 && newMaxHP > 0) {
    unit.currentHP = Math.max(
      1,
      Math.min(newMaxHP, Math.ceil((unit.currentHP * newMaxHP) / oldMaxHP)),
    );
  } else {
    unit.currentHP = Math.max(1, newMaxHP);
  }

  // --- Growths re-roll ---
  // For promoted targets without growthRanges, look up the promotesFrom base class.
  let growthSource = newClassData;
  if (!newClassData.growthRanges && newClassData.promotesFrom) {
    growthSource = classesData?.find((c) => c.name === newClassData.promotesFrom) || newClassData;
  }
  if (growthSource.growthRanges) {
    const newGrowths = rollGrowthRates(growthSource.growthRanges);
    // For lords: add personalGrowths on top (but lords can't reclass, so this is a safety net)
    if (unit.personalGrowths) {
      for (const stat of XP_STAT_NAMES) {
        newGrowths[stat] = (newGrowths[stat] || 0) + (unit.personalGrowths[stat] || 0);
      }
    }
    unit.growths = newGrowths;
  }

  // --- Class identity ---
  unit.className = newClassData.name;
  normalizeUnitClassState(unit, newClassData);
  unit.mov = unit.stats.MOV;

  // --- Weapon validity ---
  if (unit.weapon && !canEquip(unit, unit.weapon)) {
    unit.weapon = getCombatWeapons(unit)[0] || null;
  }

  // --- Skills (conservative: add new innates, don't remove old) ---
  const newInnateSkills = getClassInnateSkills(newClassData.name, skillsData);
  for (const sid of newInnateSkills) {
    learnSkill(unit, sid); // respects MAX_SKILLS cap + dedup
  }

  // --- Check learnable skills at current level ---
  if (classesData) {
    checkLevelUpSkills(unit, classesData);
  }
}

// --- Weapon helpers ---

/** Check if a unit can equip a weapon based on proficiency + rank. Scrolls cannot be equipped. */
export function canEquip(unit, weapon) {
  if (weapon.type === 'Scroll') return false;
  const rankOrder = { Prof: 0, Mast: 1 };
  return unit.proficiencies.some(
    (p) => p.type === weapon.type && rankOrder[p.rank] >= rankOrder[weapon.rankRequired],
  );
}

/** Get all equippable weapons for a unit. */
export function getAvailableWeapons(unit, allWeapons) {
  return allWeapons.filter((w) => canEquip(unit, w));
}

/** Get the default weapon (Iron-tier of first proficiency). */
export function getDefaultWeapon(proficiencies, allWeapons) {
  if (!proficiencies || proficiencies.length === 0) return null;
  // Prefer first non-Staff proficiency (Staff is healing-only).
  // Fall back to Staff only when it's the sole proficiency (e.g. Cleric).
  const combatProf = proficiencies.find((p) => p.type !== 'Staff');
  const primaryType = combatProf ? combatProf.type : proficiencies[0].type;

  // Try Iron tier first
  const iron = allWeapons.find((w) => w.type === primaryType && w.tier === 'Iron');
  if (iron) return iron;

  // Fallback: any weapon of this type
  return allWeapons.find((w) => w.type === primaryType) || null;
}

/** Get weapon by specific tier for enemy scaling. */
function getWeaponByTier(proficiencies, allWeapons, targetTier) {
  if (!proficiencies || proficiencies.length === 0) return null;
  // Prefer first non-Staff proficiency, same as getDefaultWeapon.
  const combatProf = proficiencies.find((p) => p.type !== 'Staff');
  const primaryType = combatProf ? combatProf.type : proficiencies[0].type;

  // Try requested tier
  const weapon = allWeapons.find(
    (w) => w.type === primaryType && w.tier === targetTier && !w.special,
  );
  if (weapon) return weapon;

  // Fallback: Iron
  return allWeapons.find((w) => w.type === primaryType && w.tier === 'Iron') || null;
}

// --- Inventory helpers ---

/** Equip a weapon from inventory. Mutates unit. Rejects non-proficient weapons. */
export function equipWeapon(unit, weapon) {
  if (!unit.inventory.includes(weapon)) return;
  if (!canEquip(unit, weapon)) return;
  unit.weapon = weapon;
}

/** Add a weapon to inventory. Returns false if full or wrong type. Rejects consumables and scrolls. */
export function addToInventory(unit, weapon, max = 5) {
  if (weapon.type === 'Consumable' || weapon.type === 'Scroll') return false;
  if (unit.inventory.length >= max) return false;
  // Clone weapon to avoid shared state (especially _usesSpent for staves)
  unit.inventory.push(structuredClone(weapon));
  return true;
}

/** Add a consumable to consumables array. Returns false if full or wrong type. */
export function addToConsumables(unit, consumable, max = 3) {
  if (consumable.type !== 'Consumable') return false;
  if (!unit.consumables) unit.consumables = [];
  if (unit.consumables.length >= max) return false;
  // Clone consumable to avoid shared state (especially uses field)
  unit.consumables.push(structuredClone(consumable));
  return true;
}

/** Remove a consumable from consumables array. */
export function removeFromConsumables(unit, consumable) {
  if (!unit.consumables) return;
  const idx = unit.consumables.indexOf(consumable);
  if (idx !== -1) unit.consumables.splice(idx, 1);
}

/** Remove a weapon from inventory. Auto-equips first remaining combat weapon if active weapon removed. */
export function removeFromInventory(unit, weapon) {
  const idx = unit.inventory.indexOf(weapon);
  if (idx === -1) return;
  unit.inventory.splice(idx, 1);
  if (unit.weapon === weapon) {
    unit.weapon = getCombatWeapons(unit)[0] || null;
  }
}

/** True if removing this weapon would leave the unit with no combat weapons. */
export function isLastCombatWeapon(unit, weapon) {
  const combatWeapons = getCombatWeapons(unit);
  return combatWeapons.length === 1 && combatWeapons[0] === weapon;
}

/** True if the unit has proficiency for the given weapon's type. */
export function hasProficiency(unit, weapon) {
  if (!unit.proficiencies || !weapon?.type) return false;
  return unit.proficiencies.some((p) => p.type === weapon.type);
}

/** Does the unit have any proficiency-valid Staff in inventory? */
export function hasStaff(unit) {
  return unit.inventory.some((w) => w.type === 'Staff' && canEquip(unit, w));
}

/** Get the first proficiency-valid Staff weapon in inventory. */
export function getStaffWeapon(unit) {
  return unit.inventory.find((w) => w.type === 'Staff' && canEquip(unit, w)) || null;
}

/** Get all combat-usable weapons in inventory (excludes Staff, Scroll, Consumable, non-proficient). */
export function getCombatWeapons(unit) {
  return unit.inventory.filter(
    (w) =>
      w.type !== 'Staff' && w.type !== 'Scroll' && w.type !== 'Consumable' && canEquip(unit, w),
  );
}

// --- Accessory helpers ---

/** Apply accessory stat bonuses (sign=1 to add, sign=-1 to remove). */
function applyAccessoryStats(unit, accessory, sign) {
  if (!accessory?.effects) return;
  for (const [stat, value] of Object.entries(accessory.effects)) {
    if (stat === 'MOV') {
      unit.mov = (unit.mov || unit.stats.MOV) + value * sign;
      unit.stats.MOV = (unit.stats.MOV || unit.mov) + value * sign;
    } else {
      unit.stats[stat] = (unit.stats[stat] || 0) + value * sign;
    }
  }
  // Sync currentHP with max HP changes
  if (accessory.effects.HP) {
    if (sign > 0) {
      unit.currentHP += accessory.effects.HP;
    } else {
      unit.currentHP = Math.min(unit.currentHP, unit.stats.HP);
    }
  }
}

/** Equip an accessory. Returns the old accessory (or null). */
export function equipAccessory(unit, accessory) {
  const old = unequipAccessory(unit);
  unit.accessory = accessory;
  applyAccessoryStats(unit, accessory, 1);
  return old;
}

// --- Stat booster helpers ---

/** Apply a stat booster consumable to a unit (permanent +value to stat). */
export function applyStatBoost(unit, item) {
  if (!unit || !item) return;
  const stat = String(item.stat || '')
    .trim()
    .toUpperCase();
  const value = Math.trunc(Number(item.value) || 0);
  if (!stat || value === 0) return;
  if (!unit.stats || typeof unit.stats !== 'object') unit.stats = {};

  if (stat === 'MOV') {
    const baseMov = Number.isFinite(Number(unit.stats.MOV))
      ? Number(unit.stats.MOV)
      : Math.max(1, Number(unit.mov) || 1);
    const nextMov = Math.max(1, baseMov + value);
    unit.stats.MOV = nextMov;
    unit.mov = nextMov;
    return;
  }

  unit.stats[stat] = (Number(unit.stats[stat]) || 0) + value;
  if (stat === 'HP') {
    unit.currentHP = (Number(unit.currentHP) || 0) + value;
  }
}

/** Unequip current accessory. Returns the removed accessory (or null). */
export function unequipAccessory(unit) {
  const old = unit.accessory;
  if (old) {
    applyAccessoryStats(unit, old, -1);
    unit.accessory = null;
  }
  return old;
}
