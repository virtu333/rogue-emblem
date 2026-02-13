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
} from '../utils/constants.js';

// --- Weapon proficiency parsing ---

// Map plural proficiency names → weapon.type singular
const PROF_TO_TYPE = {
  Swords: 'Sword', Lances: 'Lance', Axes: 'Axe',
  Bows: 'Bow', Tomes: 'Tome', Light: 'Light', Staves: 'Staff',
};

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
  return profString.split(',').map(s => {
    const trimmed = s.trim();
    const match = trimmed.match(/^(\w+(?:\s\w+)?)\s*\((\w)\)$/);
    if (!match) return null;
    const rawName = match[1].trim();
    const rankChar = match[2];
    const type = PROF_TO_TYPE[rawName] || rawName;
    const rank = RANK_ABBREV[rankChar] || 'Prof';
    return { type, rank };
  }).filter(Boolean);
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
    if (!range) { growths[stat] = 0; continue; }
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
    .filter(s => {
      if (Array.isArray(s.classInnate)) return s.classInnate.includes(className);
      return s.classInnate === className;
    })
    .map(s => s.id);
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

  const cls = classesData.find(c => c.name === unit.className);
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
    const baseClass = classesData.find(c => c.name === cls.promotesFrom);
    if (baseClass?.learnableSkills) {
      for (const entry of baseClass.learnableSkills) {
        tryLearn(entry.skillId);
      }
    }
  }

  // Lord personal skill: base class level 20 OR promoted class level 10
  if (unit._personalSkillL20 && (
    (unit.tier === 'base' && unit.level >= 20) ||
    (unit.tier === 'promoted' && unit.level >= 10)
  )) {
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
    col: 0, row: 0,
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
    classData.tier || 'base'
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
    accessory: null,
    weaponRank: proficiencies[0]?.rank || 'Prof',
    hasMoved: false,
    hasActed: false,
    graphic: null,
    label: null,
    hpBar: null,
  };

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
export function createEnemyUnit(classData, level, allWeapons, difficultyConfig = 1.0, skillsData = null, act = 'act1') {
  const proficiencies = applyPromotedMastery(
    parseWeaponProficiencies(classData.weaponProficiencies),
    classData.tier || 'base'
  );
  const growths = rollGrowthRates(classData.growthRanges);

  // Pick weapon tier by level
  const weaponTier = level >= 13 ? 'Silver' : level >= 6 ? 'Steel' : 'Iron';
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
    col: 0, row: 0,
    mov: classData.baseStats.MOV,
    moveType: classData.moveType,
    stats: { ...classData.baseStats },
    currentHP: classData.baseStats.HP,
    faction: 'enemy',
    weapon: weaponClone,
    inventory: weaponClone ? [weaponClone] : [],
    consumables: [],
    accessory: null,
    weaponRank: proficiencies[0]?.rank || 'Prof',
    hasMoved: false,
    hasActed: false,
    graphic: null,
    label: null,
    hpBar: null,
  };

  // Auto-level to target level
  for (let i = 1; i < level; i++) {
    const gains = levelUp(unit);
    if (gains) applyLevelUpGains(unit, gains);
  }

  // Legacy multiplier path and Wave 8 flat bonus path both supported.
  const isConfigObject = difficultyConfig && typeof difficultyConfig === 'object';
  const difficultyMod = isConfigObject ? Number(difficultyConfig.multiplier ?? 1.0) : Number(difficultyConfig ?? 1.0);
  const enemyStatBonus = isConfigObject ? Math.trunc(Number(difficultyConfig.enemyStatBonus ?? 0)) : 0;

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

  // Assign skills to enemies
  if (skillsData) {
    // Promoted enemies get class innate skills
    if (classData.tier === 'promoted') {
      const innateSkills = getClassInnateSkills(classData.name, skillsData);
      for (const sid of innateSkills) {
        if (!unit.skills.includes(sid)) unit.skills.push(sid);
      }
    }

    // Act-scaled combat skill chance
    const SKILL_CHANCE_BY_ACT = {
      act1: 0.10,
      act2: 0.25,
      act3: 0.50,
      act4: 0.60,
      finalBoss: 0.65,
    };
    const chance = SKILL_CHANCE_BY_ACT[act] || 0.0;

    // Level 5+ enemies roll for 1 random combat skill based on act
    if (level >= 5 && Math.random() < chance) {
      const pool = ['sol', 'luna', 'vantage', 'wrath', 'adept', 'guard'];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (!unit.skills.includes(pick)) unit.skills.push(pick);
    }
  }

  return unit;
}

/**
 * Create a recruit NPC unit for mid-battle recruitment.
 * Uses same pattern as createEnemyUnit but with faction: 'npc'.
 * Weapon tier scales with level: 1-5 Iron, 6-12 Steel, 13+ Silver.
 */
export function createRecruitUnit(recruitDef, classData, allWeapons, statBonuses = null, growthBonuses = null, randomSkillPool = null) {
  const proficiencies = applyPromotedMastery(
    parseWeaponProficiencies(classData.weaponProficiencies),
    classData.tier || 'base'
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
    col: 0, row: 0,
    mov: classData.baseStats.MOV,
    moveType: classData.moveType,
    stats: { ...classData.baseStats },
    currentHP: classData.baseStats.HP,
    faction: 'npc',
    weapon: weaponClone,
    inventory: weaponClone ? [weaponClone] : [],
    consumables: [],
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

  return unit;
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

/** Apply level-up gains to a unit (mutates in-place). */
function applyLevelUpGains(unit, levelUpResult) {
  unit.level = levelUpResult.newLevel;
  for (const stat of XP_STAT_NAMES) {
    unit.stats[stat] += levelUpResult.gains[stat];
  }
  // Keep currentHP in sync — heal the HP gain
  unit.currentHP += levelUpResult.gains.HP;
}

/**
 * Add XP to a unit. May trigger one or more level-ups.
 * Returns { levelUps: [{gains, newLevel}, ...] } — empty array if no level-up.
 * Mutates unit in-place.
 */
export function gainExperience(unit, xpAmount) {
  const cap = unit.tier === 'promoted' ? PROMOTED_CLASS_LEVEL_CAP : BASE_CLASS_LEVEL_CAP;
  const levelUps = [];

  // Don't gain XP at level cap
  if (unit.level >= cap) return { levelUps };

  unit.xp += xpAmount;

  while (unit.xp >= XP_PER_LEVEL) {
    unit.xp -= XP_PER_LEVEL;
    const result = levelUp(unit);
    if (!result) {
      // Hit cap — clamp XP
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
 */
export function calculateCombatXP(attacker, defender, defenderDied) {
  const atkLevel = attacker.level || 1;
  const defLevel = defender.level || 1;
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
  const levelDiff = defLevel - atkLevel; // positive when defender is higher (bonus), negative when attacker is higher (penalty)
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
    canonicalTier
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
 * Resolve a unit's promotion target class.
 * Returns class data for valid targets, or null when unavailable/blocked.
 */
export function resolvePromotionTargetClass(unit, classesData, lordsData = []) {
  if (!canPromote(unit)) return null;
  const lordData = lordsData.find(l => l.name === unit.name);
  const targetClassName = lordData
    ? lordData.promotedClass
    : classesData.find(c => c.name === unit.className)?.promotesTo;
  if (!targetClassName || isPromotionClassBlocked(targetClassName)) return null;
  return classesData.find(c => c.name === targetClassName) || null;
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

  // Update class info
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

// --- Weapon helpers ---

/** Check if a unit can equip a weapon based on proficiency + rank. Scrolls cannot be equipped. */
export function canEquip(unit, weapon) {
  if (weapon.type === 'Scroll') return false;
  const rankOrder = { Prof: 0, Mast: 1 };
  return unit.proficiencies.some(p =>
    p.type === weapon.type && rankOrder[p.rank] >= rankOrder[weapon.rankRequired]
  );
}

/** Get all equippable weapons for a unit. */
export function getAvailableWeapons(unit, allWeapons) {
  return allWeapons.filter(w => canEquip(unit, w));
}

/** Get the default weapon (Iron-tier of first proficiency). */
export function getDefaultWeapon(proficiencies, allWeapons) {
  if (!proficiencies || proficiencies.length === 0) return null;
  const primaryType = proficiencies[0].type;

  // Try Iron tier first
  const iron = allWeapons.find(w => w.type === primaryType && w.tier === 'Iron');
  if (iron) return iron;

  // Fallback: any weapon of this type
  return allWeapons.find(w => w.type === primaryType) || null;
}

/** Get weapon by specific tier for enemy scaling. */
function getWeaponByTier(proficiencies, allWeapons, targetTier) {
  if (!proficiencies || proficiencies.length === 0) return null;
  const primaryType = proficiencies[0].type;

  // Try requested tier
  const weapon = allWeapons.find(w =>
    w.type === primaryType && w.tier === targetTier && !w.special
  );
  if (weapon) return weapon;

  // Fallback: Iron
  return allWeapons.find(w => w.type === primaryType && w.tier === 'Iron') || null;
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
  return unit.proficiencies.some(p => p.type === weapon.type);
}

/** Does the unit have any proficiency-valid Staff in inventory? */
export function hasStaff(unit) {
  return unit.inventory.some(w => w.type === 'Staff' && canEquip(unit, w));
}

/** Get the first proficiency-valid Staff weapon in inventory. */
export function getStaffWeapon(unit) {
  return unit.inventory.find(w => w.type === 'Staff' && canEquip(unit, w)) || null;
}

/** Get all combat-usable weapons in inventory (excludes Staff, Scroll, Consumable, non-proficient). */
export function getCombatWeapons(unit) {
  return unit.inventory.filter(w =>
    w.type !== 'Staff' && w.type !== 'Scroll' && w.type !== 'Consumable' && canEquip(unit, w)
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
  unit.stats[item.stat] += item.value;
  if (item.stat === 'HP') {
    unit.currentHP += item.value;
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
