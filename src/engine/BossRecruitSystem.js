/**
 * BossRecruitSystem.js — Pure engine module for boss-clear recruit events.
 * No Phaser dependencies. Generates 3 recruit candidates after boss victory.
 */

import {
  BOSS_RECRUIT_LORD_CHANCE,
  BOSS_RECRUIT_COUNT,
  BASE_CLASS_LEVEL_CAP,
} from '../utils/constants.js';
import { resolveRecruitScalingTargets } from './RecruitScaling.js';
import {
  RECRUIT_PROMOTION_CONTEXT,
  isPromotedRecruitSource,
  rollRecruitPromotion,
  getFailBaseLevel,
} from './RecruitPromotion.js';
import {
  createRecruitUnit,
  createLordUnit,
  promoteUnit,
  levelUp,
  getClassInnateSkills,
  isPromotionClassBlocked,
  grantLethalArmoryWeapon,
  checkLevelUpSkills,
} from './UnitManager.js';
import { serializeUnit } from './RunManager.js';

const XP_STAT_NAMES = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const LEGACY_ACT_ORDER = ['act1', 'act2', 'act3', 'finalBoss'];

export function getRecruitPoolEntries(recruits, poolKey, classesData = null) {
  const poolData = recruits?.[poolKey];
  if (!poolData) return [];

  // Legacy structure: { pool: [{ className, name }, ...] }
  if (Array.isArray(poolData.pool) && poolData.pool.length > 0) {
    return poolData.pool
      .filter((entry) => entry && typeof entry.className === 'string')
      .map((entry) => ({ className: entry.className, name: entry.name || entry.className }));
  }

  // Current structure: { classPool: [...] } + top-level recruits.namePool
  if (!Array.isArray(poolData.classPool) || poolData.classPool.length === 0) return [];
  const namePool = recruits?.namePool || {};
  return poolData.classPool.map((className) => {
    const names = Array.isArray(namePool[className]) ? namePool[className] : [];
    let name = names.length > 0 ? names[0] : null;
    if (!name && Array.isArray(classesData)) {
      const classData = classesData.find((entry) => entry?.name === className);
      const baseNames = classData?.promotesFrom
        ? Array.isArray(namePool[classData.promotesFrom])
          ? namePool[classData.promotesFrom]
          : []
        : [];
      if (baseNames.length > 0) name = baseNames[0];
    }
    if (!name) name = className;
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
  const hasAct4Pool =
    Array.isArray(recruits?.act4?.classPool) || Array.isArray(recruits?.act4?.pool);
  if (actId === 'act1') return 'act2';
  if (actId === 'act2') return 'act3';
  if (actId === 'act3') return hasAct4Pool ? 'act4' : 'act3';
  if (actId === 'act4') return hasAct4Pool ? 'act4' : 'act3';
  return 'act3';
}

function toRomanNumeral(value) {
  let n = Math.max(1, Math.trunc(Number(value) || 1));
  const map = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
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
  const safeBase =
    typeof baseName === 'string' && baseName.trim().length > 0 ? baseName.trim() : 'Recruit';
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

function pickUniqueRecruitNameForClass(recruitEntry, recruits, takenNames, classesData = null) {
  let classNames = Array.isArray(recruits?.namePool?.[recruitEntry.className])
    ? recruits.namePool[recruitEntry.className]
    : [];
  if (classNames.length === 0 && Array.isArray(classesData)) {
    const classData = classesData.find((entry) => entry?.name === recruitEntry.className);
    const baseClassNames = classData?.promotesFrom
      ? Array.isArray(recruits?.namePool?.[classData.promotesFrom])
        ? recruits.namePool[classData.promotesFrom]
        : []
      : [];
    classNames = baseClassNames;
  }
  const available = classNames.filter((name) => !takenNames.has(name));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }

  const fallbackBase = recruitEntry.name || recruitEntry.className || 'Recruit';
  return makeUniqueRecruitName(fallbackBase, takenNames);
}

/**
 * Get lords (Kira/Voss) not already in the roster or fallen.
 * @param {Array} roster - serialized roster units
 * @param {Array} lordsData - lords.json array
 * @param {Array} [fallenUnits=[]] - units that died during the run
 * @returns {Array} available lord definitions
 */
export function getAvailableLords(roster, lordsData, fallenUnits = []) {
  const startingLords = new Set(['Edric', 'Sera']);
  const takenNames = new Set([...roster.map((u) => u.name), ...fallenUnits.map((u) => u.name)]);
  return lordsData.filter((l) => !startingLords.has(l.name) && !takenNames.has(l.name));
}

/**
 * Create a lord unit for boss recruit, leveled to targetLevel.
 * Gets lord meta bonuses but NOT starting equipment meta upgrades.
 */
export function createBossLordUnit(
  lordDef,
  classData,
  allWeapons,
  targetLevel,
  metaEffects,
  recruitContext = null,
) {
  const unit = createLordUnit(lordDef, classData, allWeapons);

  // Apply lord meta growth bonuses BEFORE leveling
  if (metaEffects?.lordGrowthBonuses) {
    for (const [stat, bonus] of Object.entries(metaEffects.lordGrowthBonuses)) {
      unit.growths[stat] = (unit.growths[stat] || 0) + bonus;
    }
  }

  const dynamicPromotionLevel = recruitContext?.dynamicPromotionLevel ?? BASE_CLASS_LEVEL_CAP;
  const promotedLevelTarget = recruitContext?.promotedLevelTarget ?? 0;
  const baseLevelOverride = Number.isFinite(recruitContext?.baseLevelOverride)
    ? Math.max(1, Math.min(BASE_CLASS_LEVEL_CAP, Math.trunc(recruitContext.baseLevelOverride)))
    : null;

  // Auto-level to target (createLordUnit starts at level 1), capped to current promotion target.
  const cappedLevel =
    baseLevelOverride ?? Math.min(targetLevel, dynamicPromotionLevel, BASE_CLASS_LEVEL_CAP);
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

  // Optional promotion path for boss/recruit-node lord generation.
  const shouldPromote = Boolean(recruitContext?.promoteLord);
  if (shouldPromote) {
    const promotedClassData = Array.isArray(recruitContext?.classes)
      ? recruitContext.classes.find((c) => c.name === lordDef?.promotedClass)
      : null;
    const promotionBonuses = lordDef?.promotionBonuses || promotedClassData?.promotionBonuses;

    // Missing promotion metadata should gracefully fall back to base-tier.
    if (promotedClassData && promotionBonuses) {
      promoteUnit(
        unit,
        promotedClassData,
        promotionBonuses,
        Array.isArray(recruitContext?.skills) ? recruitContext.skills : [],
      );

      // Match regular recruit promoted leveling.
      const promotedLevels = Math.max(0, promotedLevelTarget - 1);
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

      if (Array.isArray(recruitContext?.classes) && recruitContext.classes.length > 0) {
        checkLevelUpSkills(unit, recruitContext.classes);
      }
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
  unit.consumables.push(
    structuredClone({
      name: 'Vulnerary',
      type: 'Consumable',
      effect: 'heal',
      value: 10,
      uses: 3,
      price: 300,
    }),
  );

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
export function generateBossRecruitCandidates(
  actRef,
  roster,
  gameData,
  metaEffects,
  fallenUnits = [],
) {
  const actId = resolveActId(actRef);

  // Final boss — run ends, no recruit event
  if (actId === 'finalBoss') return null;

  const { lords, classes, weapons, recruits, skills, consumables } = gameData;
  const rosterClassNames = new Set(roster.map((u) => u.className));

  // Recruit scaling anchor is always Edric to keep behavior aligned across systems.
  const { recruitTargetLevel, dynamicPromotionLevel, promotedLevelTarget } =
    resolveRecruitScalingTargets(roster);

  const poolKey = resolveRecruitPoolKey(actId, recruits);
  const recruitPool = getRecruitPoolEntries(recruits, poolKey, classes);
  const promotionContext = {
    type: RECRUIT_PROMOTION_CONTEXT.BOSS,
    classesData: classes,
  };

  // Keep promoted sources until post-resolution de-dupe checks.
  // A promoted source can still resolve to a distinct base class on roll fail.
  let availablePool = recruitPool.filter(
    (r) => !isPromotionClassBlocked(r.className) && classes.some((c) => c.name === r.className),
  );

  // Promoted pool entries must have a valid base-class mapping.
  availablePool = availablePool.filter((r) => {
    const cls = classes.find((c) => c.name === r.className);
    if (!cls) return false;
    if (cls.tier !== 'promoted') return true;
    return isPromotedRecruitSource(cls, classes);
  });

  // Lord slot determination
  const availLords = getAvailableLords(roster, lords, fallenUnits);
  const lordChanceBonus = metaEffects?.lordRecruitChanceBonus || 0;
  const effectiveLordChance = Math.min(1, Math.max(0, BOSS_RECRUIT_LORD_CHANCE + lordChanceBonus));
  const lordSlot = availLords.length > 0 && Math.random() < effectiveLordChance;
  const chosenLord = lordSlot ? availLords[Math.floor(Math.random() * availLords.length)] : null;
  const takenNames = new Set(
    (roster || [])
      .map((unit) => (typeof unit?.name === 'string' ? unit.name.trim() : ''))
      .filter(Boolean),
  );
  if (chosenLord?.name) takenNames.add(chosenLord.name);
  const takenClassNames = new Set();
  const isClassAvailable = (className) =>
    Boolean(className) &&
    !rosterClassNames.has(className) &&
    !takenClassNames.has(className) &&
    !isPromotionClassBlocked(className);

  // Pick candidates
  const candidates = [];
  const shuffled = [...availablePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const regularCount = chosenLord ? BOSS_RECRUIT_COUNT - 1 : BOSS_RECRUIT_COUNT;

  // Regular recruit candidates
  for (let i = 0; i < shuffled.length && candidates.length < regularCount; i++) {
    const sourceEntry = shuffled[i];
    const sourceClassData = classes.find((c) => c.name === sourceEntry.className);
    if (!sourceClassData) continue;

    let resolvedClassName = sourceClassData.name;
    let usePromotedPath = false;
    let baseLevelOverride = null;

    if (sourceClassData.tier === 'promoted') {
      const roll = rollRecruitPromotion(
        promotionContext,
        sourceClassData,
        metaEffects,
        Math.random,
      );
      if (!roll.eligible || !roll.baseClassName) continue;

      const promotedClassName = sourceClassData.name;
      const fallbackClassName = roll.baseClassName;
      const fallbackLevel = getFailBaseLevel(recruitTargetLevel, dynamicPromotionLevel);

      if (roll.promote) {
        if (!isClassAvailable(promotedClassName)) continue;
        resolvedClassName = promotedClassName;
        usePromotedPath = true;
      } else if (isClassAvailable(fallbackClassName)) {
        resolvedClassName = fallbackClassName;
        usePromotedPath = false;
        baseLevelOverride = fallbackLevel;
      } else if (isClassAvailable(promotedClassName)) {
        // Preserve class de-dupe if fallback resolves to an already-used class.
        resolvedClassName = promotedClassName;
        usePromotedPath = true;
      } else {
        continue;
      }
    } else if (!isClassAvailable(sourceClassData.name)) {
      continue;
    }

    const resolvedEntry = { ...sourceEntry, className: resolvedClassName };
    // Initial name from class pool; makeUniqueRecruitName below is the final authority for dedup
    const recruitName = pickUniqueRecruitNameForClass(resolvedEntry, recruits, takenNames, classes);
    const unit = createRecruitFromPool(
      { ...resolvedEntry, name: recruitName },
      usePromotedPath,
      recruitTargetLevel,
      dynamicPromotionLevel,
      promotedLevelTarget,
      classes,
      weapons,
      consumables,
      skills,
      metaEffects,
      baseLevelOverride,
    );
    if (unit) {
      if (!isClassAvailable(unit.className)) continue;
      unit.name = makeUniqueRecruitName(unit.name, takenNames);
      takenNames.add(unit.name);
      takenClassNames.add(unit.className);
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
    const lordClassData = classes.find((c) => c.name === chosenLord.class);
    if (lordClassData) {
      // Gate lord promotion on whether the recruit pool has promoted sources (act-gating).
      // Use the lord's own promoted class data for the promotion roll instead of a random pool entry.
      const poolHasPromotedSource = recruitPool
        .map((entry) => classes.find((c) => c.name === entry.className))
        .some((entry) => isPromotedRecruitSource(entry, classes));
      const lordPromotedClassData =
        typeof chosenLord?.promotedClass === 'string'
          ? classes.find((c) => c.name === chosenLord.promotedClass)
          : null;
      const canPromoteLord = Boolean(
        lordPromotedClassData &&
        (chosenLord?.promotionBonuses || lordPromotedClassData?.promotionBonuses),
      );
      const lordRoll =
        canPromoteLord && poolHasPromotedSource
          ? rollRecruitPromotion(promotionContext, lordPromotedClassData, metaEffects, Math.random)
          : { eligible: false, promote: false };

      const unit = createBossLordUnit(
        chosenLord,
        lordClassData,
        weapons,
        recruitTargetLevel,
        metaEffects,
        {
          promoteLord: canPromoteLord && lordRoll.promote,
          classes,
          skills,
          dynamicPromotionLevel,
          promotedLevelTarget,
          baseLevelOverride: null,
        },
      );
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
function createRecruitFromPool(
  recruitEntry,
  promoted,
  targetLevel,
  dynamicPromotionLevel,
  promotedLevelTarget,
  classes,
  weapons,
  consumables,
  skills,
  metaEffects,
  baseLevelOverride = null,
) {
  const statBonuses = metaEffects?.statBonuses || null;
  const growthBonuses = metaEffects?.growthBonuses || null;
  const maybeAddStartingVulnerary = (unit) => {
    if (!metaEffects?.recruitStartingVulnerary) return;
    const vulnerary = (consumables || []).find((c) => c.name === 'Vulnerary');
    if (vulnerary) unit.consumables.push(structuredClone(vulnerary));
  };
  const addClassInnates = (unit, className) => {
    for (const sid of getClassInnateSkills(className, skills)) {
      if (!unit.skills.includes(sid)) unit.skills.push(sid);
    }
  };

  if (promoted) {
    // Act3 pool has promoted class names — find base, create, promote
    const promotedClassData = classes.find((c) => c.name === recruitEntry.className);
    if (!promotedClassData || !promotedClassData.promotesFrom) return null;
    const baseClassData = classes.find((c) => c.name === promotedClassData.promotesFrom);
    if (!baseClassData) return null;

    // Cap base class leveling at the dynamic promotion target.
    const baseLevel = Math.min(targetLevel, dynamicPromotionLevel, BASE_CLASS_LEVEL_CAP);
    const recruitDef = { className: baseClassData.name, name: recruitEntry.name, level: baseLevel };
    const unit = createRecruitUnit(
      recruitDef,
      baseClassData,
      weapons,
      statBonuses,
      growthBonuses,
      null,
      classes,
    );
    addClassInnates(unit, baseClassData.name);
    promoteUnit(unit, promotedClassData, promotedClassData.promotionBonuses, skills);

    // Post-promotion leveling from dynamic promoted-level target.
    const promotedLevels = Math.max(0, promotedLevelTarget - 1);
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

    checkLevelUpSkills(unit, classes);

    if (metaEffects?.lethalArmoryTier) {
      grantLethalArmoryWeapon(unit, weapons, metaEffects.lethalArmoryTier);
    }
    maybeAddStartingVulnerary(unit);
    return unit;
  } else {
    // Base recruit path capped at BASE_CLASS_LEVEL_CAP unless fail fallback overrides level.
    const classData = classes.find((c) => c.name === recruitEntry.className);
    if (!classData) return null;

    const cappedLevel = Number.isFinite(baseLevelOverride)
      ? Math.max(1, Math.min(BASE_CLASS_LEVEL_CAP, Math.trunc(baseLevelOverride)))
      : Math.min(targetLevel, BASE_CLASS_LEVEL_CAP);
    const recruitDef = { className: classData.name, name: recruitEntry.name, level: cappedLevel };
    const unit = createRecruitUnit(
      recruitDef,
      classData,
      weapons,
      statBonuses,
      growthBonuses,
      null,
      classes,
    );
    addClassInnates(unit, classData.name);
    if (metaEffects?.lethalArmoryTier) {
      grantLethalArmoryWeapon(unit, weapons, metaEffects.lethalArmoryTier);
    }
    maybeAddStartingVulnerary(unit);
    return unit;
  }
}
