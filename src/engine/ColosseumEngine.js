// ColosseumEngine.js — Pure module for Colosseum arena + mercenary board logic
// No Phaser deps. All functions are deterministic given an rng function.

import {
  ACT_SEQUENCE,
  RECRUIT_SKILL_POOL,
  BASE_CLASS_LEVEL_CAP,
  PROMOTED_CLASS_LEVEL_CAP,
  XP_PER_LEVEL,
} from '../utils/constants.js';
import {
  createEnemyUnit,
  createRecruitUnit,
  promoteUnit,
  gainExperience,
  calculateCombatXP,
} from './UnitManager.js';

/**
 * Return tier entries where the given actId meets the tier's minAct requirement.
 * @param {string} actId - e.g. 'act1', 'act2'
 * @param {Object} colosseumData - parsed colosseum.json
 * @returns {Array<[string, Object]>} array of [tierName, tierConfig]
 */
export function getAvailableTiers(actId, colosseumData) {
  const tiers = colosseumData?.arena?.tiers;
  if (!tiers) return [];
  const actIdx = ACT_SEQUENCE.indexOf(actId);
  if (actIdx < 0) return [];

  return Object.entries(tiers).filter(([, tier]) => {
    const minIdx = ACT_SEQUENCE.indexOf(tier.minAct);
    return minIdx >= 0 && actIdx >= minIdx;
  });
}

/**
 * Generate a challenger for an arena fight.
 * @param {number} entrantLevel - level of the player's entrant
 * @param {Object} tier - tier config object (from colosseum.json)
 * @param {string} actId
 * @param {Object} enemyPools - enemies.json pools
 * @param {Array} classesData - classes.json array
 * @param {Array} weaponsData - weapons.json array
 * @param {string|null} difficultyMode - 'normal'|'hard'|'lunatic'
 * @param {Object} colosseumData - colosseum.json
 * @param {Function} rng - () => [0,1) random number
 * @returns {{ unit: Object, weapon: Object, level: number }}
 */
export function generateChallenger(
  entrantLevel,
  tier,
  actId,
  enemyPools,
  classesData,
  weaponsData,
  difficultyMode,
  colosseumData,
  rng,
) {
  const pool = enemyPools?.pools?.[actId];
  if (!pool) throw new Error(`No enemy pool for act: ${actId}`);

  // Act 1-2: base classes only. Act 3+: base + promoted
  const actIdx = ACT_SEQUENCE.indexOf(actId);
  const usePromoted = actIdx >= 2; // act3 = index 2
  const classPool = [...(pool.base || [])];
  if (usePromoted && pool.promoted) classPool.push(...pool.promoted);
  if (classPool.length === 0) throw new Error(`Empty class pool for act: ${actId}`);

  const className = classPool[Math.floor(rng() * classPool.length)];
  const classData = classesData.find((c) => c.name === className);
  if (!classData) throw new Error(`Class not found: ${className}`);

  // Calculate level
  const [minOff, maxOff] = tier.levelOffset;
  const offset = minOff + Math.floor(rng() * (maxOff - minOff + 1));
  let level = Math.max(1, entrantLevel + offset);

  // Difficulty bonus
  const diffConfig = colosseumData?.difficulty?.[difficultyMode];
  if (diffConfig?.challengerLevelBonus) {
    level += diffConfig.challengerLevelBonus;
  }

  // If class is promoted but was picked from base pool, need to handle via promote path
  const isPromotedClass = classData.tier === 'promoted';
  let unit;

  if (isPromotedClass) {
    // Find base class, create at level, then promote
    const baseClassName = classData.promotesFrom;
    const baseClassData = classesData.find((c) => c.name === baseClassName);
    if (!baseClassData) throw new Error(`Base class not found for ${className}: ${baseClassName}`);

    const cappedBaseLevel = Math.min(level, BASE_CLASS_LEVEL_CAP);
    unit = createEnemyUnit(baseClassData, cappedBaseLevel, weaponsData, 1.0, null, actId);
    const bonuses = classData.promotionBonuses || {};
    promoteUnit(unit, classData, bonuses, null);

    const targetPromotedLevel = Math.min(
      PROMOTED_CLASS_LEVEL_CAP,
      Math.max(1, level - BASE_CLASS_LEVEL_CAP),
    );
    const promotedXp = (targetPromotedLevel - 1) * XP_PER_LEVEL;
    if (promotedXp > 0) {
      gainExperience(unit, promotedXp);
    }
  } else {
    unit = createEnemyUnit(classData, level, weaponsData, 1.0, null, actId);
  }

  // Assign skills per difficulty
  if (diffConfig?.challengerMinSkills) {
    const combatSkills = ['sol', 'luna', 'vantage', 'wrath', 'adept', 'guard'];
    while (unit.skills.length < diffConfig.challengerMinSkills) {
      const pick = combatSkills[Math.floor(rng() * combatSkills.length)];
      if (!unit.skills.includes(pick)) unit.skills.push(pick);
    }
  }

  // Platinum max skills on lunatic
  if (
    diffConfig?.platinumMaxSkills &&
    tier.xpMultiplier >= 1.5 // platinum tier
  ) {
    const combatSkills = ['sol', 'luna', 'vantage', 'wrath', 'adept', 'guard'];
    while (unit.skills.length < diffConfig.platinumMaxSkills) {
      const pick = combatSkills[Math.floor(rng() * combatSkills.length)];
      if (!unit.skills.includes(pick)) unit.skills.push(pick);
    }
  }

  return { unit, weapon: unit.weapon, level: unit.level };
}

/**
 * Calculate arena reward for a fight outcome.
 * @param {Object} tier - tier config
 * @param {'win'|'lose'|'draw'} outcome
 * @param {number} baseXP - XP from calculateCombatXP
 * @param {number} levelsGainedThisVisit - levels gained so far at this colosseum
 * @param {Object} colosseumData
 * @returns {{ goldDelta: number, xpGained: number }}
 */
export function calculateArenaReward(tier, outcome, baseXP, levelsGainedThisVisit, colosseumData) {
  const drAfterLevels = colosseumData?.arena?.diminishingReturnsAfterLevels ?? 2;
  const drFactor = colosseumData?.arena?.diminishingReturnsFactor ?? 0.5;

  if (outcome === 'lose') {
    return { goldDelta: -tier.entryFee, xpGained: 0 };
  }
  if (outcome === 'draw') {
    return { goldDelta: 0, xpGained: 0 };
  }

  // Win
  let xp = Math.round(baseXP * tier.xpMultiplier);
  if (levelsGainedThisVisit >= drAfterLevels) {
    xp = Math.round(xp * drFactor);
  }
  xp = Math.max(1, xp);

  return { goldDelta: tier.goldReward, xpGained: xp };
}

/**
 * Check if a unit can fight in the arena.
 * @param {Object} unit
 * @param {number} fightsThisVisit - fights this unit has done at this colosseum visit
 * @param {number} maxFights
 * @returns {boolean}
 */
export function canFight(unit, fightsThisVisit, maxFights) {
  return (unit.currentHP || 0) > 1 && fightsThisVisit < maxFights;
}

/**
 * Get max fights per unit for the current difficulty.
 * @param {string|null} difficultyMode
 * @param {Object} colosseumData
 * @returns {number}
 */
export function getMaxFights(difficultyMode, colosseumData) {
  const diffOverride = colosseumData?.difficulty?.[difficultyMode]?.maxFightsPerUnit;
  if (typeof diffOverride === 'number') return diffOverride;
  return colosseumData?.arena?.maxFightsPerUnit ?? 3;
}

/**
 * Determine combat distance for an arena fight.
 * @param {Object} atkWeapon
 * @param {Object} defWeapon
 * @returns {number}
 */
export function getArenaDistance(atkWeapon, defWeapon) {
  const atkMinRange = parseMinRange(atkWeapon);
  const defMinRange = parseMinRange(defWeapon);

  // Use the max of both min-ranges so both can attack if possible
  // If attacker is ranged-only (bow), fight at range 2
  // If both melee, fight at 1
  return Math.max(atkMinRange, defMinRange);
}

/**
 * Parse the minimum range from a weapon's range string.
 * @param {Object} weapon
 * @returns {number}
 */
function parseMinRange(weapon) {
  if (!weapon?.range) return 1;
  const range = String(weapon.range);
  if (range.includes('-')) {
    const parts = range.split('-').map(Number);
    return parts[0] || 1;
  }
  return Number(range) || 1;
}

/**
 * Generate mercenary candidates for the Mercenary Board.
 * @param {string} actId
 * @param {number} lordLevel
 * @param {Object} recruitPools - recruits.json
 * @param {Array} classesData
 * @param {Array} weaponsData
 * @param {Array} skillsData
 * @param {string|null} difficultyMode
 * @param {Object} colosseumData
 * @param {Function} rng
 * @returns {Array<{ unit: Object, hireCost: number }>}
 */
export function generateMercenaryCandidates(
  actId,
  lordLevel,
  recruitPools,
  classesData,
  weaponsData,
  skillsData,
  difficultyMode,
  colosseumData,
  rng,
) {
  const mercConfig = colosseumData?.mercenaries;
  if (!mercConfig) return [];

  const [minCount, maxCount] = mercConfig.candidateCount;
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));

  // Build combined pool: current act + next act (if crossActPoolAccess)
  // recruits.json uses `classPool` (array of class name strings)
  const actIdx = ACT_SEQUENCE.indexOf(actId);
  const currentPool = recruitPools?.[actId]?.classPool || [];
  let combinedPool = [...currentPool];

  if (mercConfig.crossActPoolAccess && actIdx >= 0 && actIdx < ACT_SEQUENCE.length - 1) {
    const nextAct = ACT_SEQUENCE[actIdx + 1];
    const nextPool = recruitPools?.[nextAct]?.classPool || [];
    combinedPool = combinedPool.concat(nextPool);
  }

  if (combinedPool.length === 0) return [];

  // Name pool for generating recruit names
  const namePool = recruitPools?.namePool || {};

  // Boostable stats (exclude HP and MOV)
  const BOOSTABLE_STATS = ['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];

  const candidates = [];
  for (let i = 0; i < count; i++) {
    const className = combinedPool[Math.floor(rng() * combinedPool.length)];
    const classData = classesData.find((c) => c.name === className);
    if (!classData) continue;

    // Pick a name from the name pool or use class name as fallback
    const names = namePool[className] || [className];
    const name = names[Math.floor(rng() * names.length)];

    // Level: lord level + random(-1, +1), min 1
    const levelOffset = Math.floor(rng() * 3) - 1; // -1, 0, or 1
    const level = Math.max(1, lordLevel + levelOffset);

    const unit = createRecruitUnit(
      { name, className, level },
      classData,
      weaponsData,
      null,
      null,
      null,
      classesData,
    );
    unit.faction = 'player'; // Mercenaries join the player's team

    // Apply stat bonuses: +value to N random stats
    const bonusCount = mercConfig.statBonus?.count || 2;
    const bonusValue = mercConfig.statBonus?.value || 1;
    const shuffled = [...BOOSTABLE_STATS];
    for (let si = shuffled.length - 1; si > 0; si--) {
      const sj = Math.floor(rng() * (si + 1));
      [shuffled[si], shuffled[sj]] = [shuffled[sj], shuffled[si]];
    }
    for (let j = 0; j < bonusCount && j < shuffled.length; j++) {
      unit.stats[shuffled[j]] = (unit.stats[shuffled[j]] || 0) + bonusValue;
    }
    // If HP was boosted, update currentHP
    if (unit.stats.HP > unit.currentHP) unit.currentHP = unit.stats.HP;

    // 50% chance: assign random combat skill
    if (rng() < (mercConfig.skillChance ?? 0.5)) {
      const skillPool = RECRUIT_SKILL_POOL;
      const pick = skillPool[Math.floor(rng() * skillPool.length)];
      if (!unit.skills.includes(pick)) unit.skills.push(pick);
    }

    // Weapon tier bonus: equip weapon one tier above current act shops
    const tierSequence = ['Iron', 'Steel', 'Silver'];
    const baseTierIdx = level >= 13 ? 2 : level >= 6 ? 1 : 0;
    const boostedIdx = Math.min(
      baseTierIdx + (mercConfig.weaponTierBonus || 1),
      tierSequence.length - 1,
    );
    const targetTier = tierSequence[boostedIdx];
    if (unit.proficiencies?.length > 0) {
      const primaryType = unit.proficiencies[0].type;
      const betterWeapon = weaponsData.find(
        (w) => w.type === primaryType && w.tier === targetTier && !w.special,
      );
      if (betterWeapon) {
        const cloned = structuredClone(betterWeapon);
        unit.weapon = cloned;
        unit.inventory = [cloned];
      }
    }

    const hireCost = getMercenaryPrice(
      actId,
      unit.tier === 'promoted',
      difficultyMode,
      colosseumData,
      rng,
    );
    candidates.push({ unit, hireCost });
  }

  return candidates;
}

/**
 * Calculate mercenary hire cost.
 * @param {string} actId
 * @param {boolean} isPromoted
 * @param {string|null} difficultyMode
 * @param {Object} colosseumData
 * @param {Function} rng
 * @returns {number}
 */
export function getMercenaryPrice(actId, isPromoted, difficultyMode, colosseumData, rng) {
  const mercConfig = colosseumData?.mercenaries;
  if (!mercConfig) return 500;

  const priceRange = mercConfig.pricing?.[actId] || mercConfig.pricing?.act1 || [300, 500];
  const [minPrice, maxPrice] = priceRange;
  let price = minPrice + Math.floor(rng() * (maxPrice - minPrice + 1));

  if (isPromoted) {
    price = Math.round(price * (mercConfig.promotedMultiplier || 1.5));
  }

  const diffConfig = colosseumData?.difficulty?.[difficultyMode];
  if (diffConfig?.mercenaryPriceMultiplier) {
    price = Math.round(price * diffConfig.mercenaryPriceMultiplier);
  }

  return price;
}

/**
 * Calculate base XP for an arena combat using the standard formula.
 * Wrapper around calculateCombatXP for arena context.
 */
export function calculateArenaXP(entrant, challenger, challengerDied) {
  return calculateCombatXP(entrant, challenger, challengerDied);
}
