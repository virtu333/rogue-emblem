/**
 * BossRecruitSystem.js — Pure engine module for boss-clear recruit events.
 * No Phaser dependencies. Generates 3 recruit candidates after boss victory.
 */

import { BOSS_RECRUIT_LORD_CHANCE, BOSS_RECRUIT_COUNT, BASE_CLASS_LEVEL_CAP } from '../utils/constants.js';
import { createRecruitUnit, createLordUnit, promoteUnit, levelUp, getClassInnateSkills, isPromotionClassBlocked, grantLethalArmoryWeapon } from './UnitManager.js';
import { serializeUnit } from './RunManager.js';

const XP_STAT_NAMES = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const LEGACY_ACT_ORDER = ['act1', 'act2', 'act3', 'finalBoss'];

function getRecruitPoolEntries(recruits, poolKey) {
  const poolData = recruits?.[poolKey];
  if (!poolData) return [];

  // Legacy structure: { pool: [{ className, name }, ...] }
  if (Array.isArray(poolData.pool) && poolData.pool.length > 0) {
    return poolData.pool
      .filter(entry => entry && typeof entry.className === 'string')
      .map(entry => ({ className: entry.className, name: entry.name || entry.className }));
  }

  // Current structure: { classPool: [...] } + top-level recruits.namePool
  if (!Array.isArray(poolData.classPool) || poolData.classPool.length === 0) return [];
  const namePool = recruits?.namePool || {};
  return poolData.classPool.map(className => {
    const names = Array.isArray(namePool[className]) ? namePool[className] : [];
    const name = names.length > 0
      ? names[0]
      : className;
    return { className, name };
  });
}

function resolveActId(actRef) {
  if (typeof actRef === 'string' && actRef.trim().length > 0) return actRef;
  if (Number.isFinite(actRef)) {
    const index = Math.max(0, Math.trunc(actRef));
    if (index < LEGACY_ACT_ORDER.length) return LEGACY_ACT_ORDER[index];
    return 'finalBoss';
  }
  return 'act1';
}

function resolveRecruitPoolKey(actId, recruits) {
  const hasAct4Pool = Array.isArray(recruits?.act4?.classPool) || Array.isArray(recruits?.act4?.pool);
  if (actId === 'act1') return 'act2';
  if (actId === 'act2') return 'act3';
  if (actId === 'act3') return hasAct4Pool ? 'act4' : 'act3';
  if (actId === 'act4') return hasAct4Pool ? 'act4' : 'act3';
  return 'act3';
}

function toRomanNumeral(value) {
  let n = Math.max(1, Math.trunc(Number(value) || 1));
  const map = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [amount, glyph] of map) {
    while (n >= amount) {
      out += glyph;
      n -= amount;
    }
  }
  return out;
}

function makeUniqueRecruitName(baseName, takenNames) {
  const safeBase = (typeof baseName === 'string' && baseName.trim().length > 0)
    ? baseName.trim()
    : 'Recruit';
  if (!takenNames.has(safeBase)) return safeBase;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${safeBase} ${toRomanNumeral(i)}`;
    if (!takenNames.has(candidate)) return candidate;
  }

  let i = 2;
  while (true) {
    const candidate = `${safeBase} ${i}`;
    if (!takenNames.has(candidate)) return candidate;
    i++;
  }
}

function pickUniqueRecruitNameForClass(recruitEntry, recruits, takenNames) {
  const classNames = Array.isArray(recruits?.namePool?.[recruitEntry.className])
    ? recruits.namePool[recruitEntry.className]
    : [];
  const available = classNames.filter(name => !takenNames.has(name));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }

  const fallbackBase = recruitEntry.name || recruitEntry.className || 'Recruit';
  return makeUniqueRecruitName(fallbackBase, takenNames);
}

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

  // Auto-level to target (createLordUnit starts at level 1), capped at base class cap
  const cappedLevel = Math.min(targetLevel, BASE_CLASS_LEVEL_CAP);
  for (let i = 1; i < cappedLevel; i++) {
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
 * @param {number|string} actRef - legacy actIndex or canonical actId
 * @param {Array} roster - current serialized roster
 * @param {Object} gameData - { lords, classes, weapons, recruits, skills }
 * @param {Object|null} metaEffects - meta-progression effects
 * @returns {Array|null} 3 candidate objects or null for final boss
 */
export function generateBossRecruitCandidates(actRef, roster, gameData, metaEffects) {
  const actId = resolveActId(actRef);

  // Final boss — run ends, no recruit event
  if (actId === 'finalBoss') return null;

  const { lords, classes, weapons, recruits, skills, consumables } = gameData;
  const rosterClassNames = new Set(roster.map(u => u.className));

  // Determine target level from highest lord effective level in roster
  // Promoted lords have an effective level = level + BASE_CLASS_LEVEL_CAP
  const lordLevels = roster.filter(u => u.isLord).map(u =>
    u.tier === 'promoted' ? u.level + BASE_CLASS_LEVEL_CAP : u.level
  );
  const targetLevel = Math.max(1, ...lordLevels);

  // Determine if promoted and which recruit pool to use
  const usePromoted = actId !== 'act1';
  const poolKey = resolveRecruitPoolKey(actId, recruits);
  const recruitPool = getRecruitPoolEntries(recruits, poolKey);

  // Filter pool to classes not already in roster and not temporarily blocked
  let availablePool = recruitPool.filter(r =>
    !rosterClassNames.has(r.className) && !isPromotionClassBlocked(r.className)
  );

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
  const takenNames = new Set(
    (roster || [])
      .map((unit) => (typeof unit?.name === 'string' ? unit.name.trim() : ''))
      .filter(Boolean)
  );
  if (chosenLord?.name) takenNames.add(chosenLord.name);

  // Pick candidates
  const candidates = [];
  const shuffled = [...availablePool].sort(() => Math.random() - 0.5);
  const regularCount = chosenLord ? BOSS_RECRUIT_COUNT - 1 : BOSS_RECRUIT_COUNT;

  // Regular recruit candidates
  for (let i = 0; i < shuffled.length && candidates.length < regularCount; i++) {
    const r = shuffled[i];
    const recruitName = pickUniqueRecruitNameForClass(r, recruits, takenNames);
    const unit = createRecruitFromPool(
      { ...r, name: recruitName },
      usePromoted,
      targetLevel,
      classes,
      weapons,
      consumables,
      skills,
      metaEffects
    );
    if (unit) {
      unit.name = makeUniqueRecruitName(unit.name, takenNames);
      takenNames.add(unit.name);
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
      unit.name = chosenLord.name || unit.name;
      takenNames.add(unit.name);
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
function createRecruitFromPool(recruitEntry, promoted, targetLevel, classes, weapons, consumables, skills, metaEffects) {
  const statBonuses = metaEffects?.statBonuses || null;
  const growthBonuses = metaEffects?.growthBonuses || null;
  const maybeAddStartingVulnerary = (unit) => {
    if (!metaEffects?.recruitStartingVulnerary) return;
    const vulnerary = (consumables || []).find(c => c.name === 'Vulnerary');
    if (vulnerary) unit.consumables.push(structuredClone(vulnerary));
  };
  const addClassInnates = (unit, className) => {
    for (const sid of getClassInnateSkills(className, skills)) {
      if (!unit.skills.includes(sid)) unit.skills.push(sid);
    }
  };

  if (promoted) {
    // Act3 pool has promoted class names — find base, create, promote
    const promotedClassData = classes.find(c => c.name === recruitEntry.className);
    if (!promotedClassData || !promotedClassData.promotesFrom) return null;
    const baseClassData = classes.find(c => c.name === promotedClassData.promotesFrom);
    if (!baseClassData) return null;

    // Cap base class leveling at BASE_CLASS_LEVEL_CAP
    const baseLevel = Math.min(targetLevel, BASE_CLASS_LEVEL_CAP);
    const recruitDef = { className: baseClassData.name, name: recruitEntry.name, level: baseLevel };
    const unit = createRecruitUnit(recruitDef, baseClassData, weapons, statBonuses, growthBonuses);
    addClassInnates(unit, baseClassData.name);
    promoteUnit(unit, promotedClassData, promotedClassData.promotionBonuses, skills);

    // Post-promotion leveling if targetLevel exceeds base cap
    const promotedLevels = Math.max(0, targetLevel - BASE_CLASS_LEVEL_CAP - 1);
    for (let i = 0; i < promotedLevels; i++) {
      const result = levelUp(unit);
      if (result) {
        unit.level = result.newLevel;
        for (const stat of XP_STAT_NAMES) {
          unit.stats[stat] += result.gains[stat];
        }
        unit.currentHP += result.gains.HP;
      }
    }

    if (metaEffects?.lethalArmoryTier) {
      grantLethalArmoryWeapon(unit, weapons, metaEffects.lethalArmoryTier);
    }
    maybeAddStartingVulnerary(unit);
    return unit;
  } else {
    // Act2 pool has base class names — cap at BASE_CLASS_LEVEL_CAP
    const classData = classes.find(c => c.name === recruitEntry.className);
    if (!classData) return null;

    const cappedLevel = Math.min(targetLevel, BASE_CLASS_LEVEL_CAP);
    const recruitDef = { className: classData.name, name: recruitEntry.name, level: cappedLevel };
    const unit = createRecruitUnit(recruitDef, classData, weapons, statBonuses, growthBonuses);
    addClassInnates(unit, classData.name);
    if (metaEffects?.lethalArmoryTier) {
      grantLethalArmoryWeapon(unit, weapons, metaEffects.lethalArmoryTier);
    }
    maybeAddStartingVulnerary(unit);
    return unit;
  }
}
