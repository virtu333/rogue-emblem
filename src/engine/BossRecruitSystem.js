/**
 * BossRecruitSystem.js — Pure engine module for boss-clear recruit events.
 * No Phaser dependencies. Generates 3 recruit candidates after boss victory.
 */

import { BOSS_RECRUIT_LORD_CHANCE, BOSS_RECRUIT_COUNT } from '../utils/constants.js';
import { createRecruitUnit, createLordUnit, promoteUnit, levelUp } from './UnitManager.js';
import { serializeUnit } from './RunManager.js';

const XP_STAT_NAMES = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];

/**
 * Get lords (Kira/Voss) not already in the roster.
 * @param {Array} roster - serialized roster units
 * @param {Array} lordsData - lords.json array
 * @returns {Array} available lord definitions
 */
export function getAvailableLords(roster, lordsData) {
  const startingLords = new Set(['Edric', 'Sera']);
  const rosterNames = new Set(roster.map(u => u.name));
  return lordsData.filter(l => !startingLords.has(l.name) && !rosterNames.has(l.name));
}

/**
 * Create a lord unit for boss recruit, leveled to targetLevel.
 * Gets lord meta bonuses but NOT starting equipment meta upgrades.
 */
export function createBossLordUnit(lordDef, classData, allWeapons, targetLevel, metaEffects) {
  const unit = createLordUnit(lordDef, classData, allWeapons);

  // Apply lord meta growth bonuses BEFORE leveling
  if (metaEffects?.lordGrowthBonuses) {
    for (const [stat, bonus] of Object.entries(metaEffects.lordGrowthBonuses)) {
      unit.growths[stat] = (unit.growths[stat] || 0) + bonus;
    }
  }

  // Auto-level to target (createLordUnit starts at level 1)
  for (let i = 1; i < targetLevel; i++) {
    const result = levelUp(unit);
    if (result) {
      unit.level = result.newLevel;
      for (const stat of XP_STAT_NAMES) {
        unit.stats[stat] += result.gains[stat];
      }
      unit.currentHP += result.gains.HP;
    }
  }

  // Apply lord meta flat stat bonuses AFTER leveling
  if (metaEffects?.lordStatBonuses) {
    for (const [stat, bonus] of Object.entries(metaEffects.lordStatBonuses)) {
      unit.stats[stat] = (unit.stats[stat] || 0) + bonus;
      if (stat === 'HP') unit.currentHP += bonus;
    }
  }

  // Give a Vulnerary
  unit.consumables.push(structuredClone({
    name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3, price: 300,
  }));

  return unit;
}

/**
 * Generate 3 boss recruit candidates.
 * @param {number} actIndex - 0=act1, 1=act2, 2=act3, 3=finalBoss
 * @param {Array} roster - current serialized roster
 * @param {Object} gameData - { lords, classes, weapons, recruits, skills }
 * @param {Object|null} metaEffects - meta-progression effects
 * @returns {Array|null} 3 candidate objects or null for final boss
 */
export function generateBossRecruitCandidates(actIndex, roster, gameData, metaEffects) {
  // Final boss — run ends, no recruit event
  if (actIndex >= 3) return null;

  const { lords, classes, weapons, recruits, skills } = gameData;
  const rosterClassNames = new Set(roster.map(u => u.className));

  // Determine target level from highest lord level in roster
  const lordLevels = roster.filter(u => u.isLord).map(u => u.level);
  const targetLevel = Math.max(1, ...lordLevels);

  // Determine if promoted and which recruit pool to use
  const usePromoted = actIndex >= 1;
  const poolKey = actIndex === 0 ? 'act2' : 'act3';
  const recruitPool = recruits[poolKey]?.pool || [];

  // Filter pool to classes not already in roster
  let availablePool = recruitPool.filter(r => !rosterClassNames.has(r.className));

  // For promoted recruits, verify class exists and has promotesFrom
  if (usePromoted) {
    availablePool = availablePool.filter(r => {
      const cls = classes.find(c => c.name === r.className);
      return cls && cls.promotesFrom;
    });
  } else {
    availablePool = availablePool.filter(r => classes.find(c => c.name === r.className));
  }

  // Lord slot determination
  const availLords = getAvailableLords(roster, lords);
  const lordSlot = availLords.length > 0 && Math.random() < BOSS_RECRUIT_LORD_CHANCE;
  const chosenLord = lordSlot ? availLords[Math.floor(Math.random() * availLords.length)] : null;

  // Pick candidates
  const candidates = [];
  const shuffled = [...availablePool].sort(() => Math.random() - 0.5);
  const regularCount = chosenLord ? BOSS_RECRUIT_COUNT - 1 : BOSS_RECRUIT_COUNT;

  // Regular recruit candidates
  for (let i = 0; i < shuffled.length && candidates.length < regularCount; i++) {
    const r = shuffled[i];
    const unit = createRecruitFromPool(r, usePromoted, targetLevel, classes, weapons, skills, metaEffects);
    if (unit) {
      unit.faction = 'player';
      candidates.push({
        unit: serializeUnit(unit),
        isLord: false,
        className: unit.className,
        displayName: unit.name,
      });
    }
  }

  // Lord candidate (insert at random position)
  if (chosenLord) {
    const lordClassData = classes.find(c => c.name === chosenLord.class);
    if (lordClassData) {
      const unit = createBossLordUnit(chosenLord, lordClassData, weapons, targetLevel, metaEffects);
      const lordCandidate = {
        unit: serializeUnit(unit),
        isLord: true,
        className: unit.className,
        displayName: unit.name,
      };
      // Insert at random position among candidates
      const insertIdx = Math.floor(Math.random() * (candidates.length + 1));
      candidates.splice(insertIdx, 0, lordCandidate);
    }
  }

  return candidates.length > 0 ? candidates : null;
}

/**
 * Create a recruit unit from pool entry, handling promoted/unpromoted.
 */
function createRecruitFromPool(recruitEntry, promoted, targetLevel, classes, weapons, skills, metaEffects) {
  const statBonuses = metaEffects?.statBonuses || null;
  const growthBonuses = metaEffects?.growthBonuses || null;

  if (promoted) {
    // Act3 pool has promoted class names — find base, create, promote
    const promotedClassData = classes.find(c => c.name === recruitEntry.className);
    if (!promotedClassData || !promotedClassData.promotesFrom) return null;
    const baseClassData = classes.find(c => c.name === promotedClassData.promotesFrom);
    if (!baseClassData) return null;

    const recruitDef = { className: baseClassData.name, name: recruitEntry.name, level: targetLevel };
    const unit = createRecruitUnit(recruitDef, baseClassData, weapons, statBonuses, growthBonuses);
    promoteUnit(unit, promotedClassData, promotedClassData.promotionBonuses, skills);
    return unit;
  } else {
    // Act2 pool has base class names
    const classData = classes.find(c => c.name === recruitEntry.className);
    if (!classData) return null;

    const recruitDef = { className: classData.name, name: recruitEntry.name, level: targetLevel };
    return createRecruitUnit(recruitDef, classData, weapons, statBonuses, growthBonuses);
  }
}
