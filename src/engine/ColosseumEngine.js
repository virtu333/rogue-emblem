// ColosseumEngine.js — Pure module for Colosseum arena + mercenary board logic
// No Phaser deps. All functions are deterministic given an rng function.

import {
  ACT_SEQUENCE,
  RECRUIT_SKILL_POOL,
  BASE_CLASS_LEVEL_CAP,
  RECRUIT_PROMOTION_BASE_LEVEL,
  PROMOTED_CLASS_LEVEL_CAP,
  XP_PER_LEVEL,
  MAX_SKILLS,
  filterClassPoolByDifficulty,
} from '../utils/constants.js';
import {
  createEnemyUnit,
  createRecruitUnit,
  promoteUnit,
  levelUp,
  applyLevelUpGains,
  checkLevelUpSkills,
  gainExperience,
  calculateCombatXP,
  learnSkill,
  getClassInnateSkills,
  getCombatWeapons,
} from './UnitManager.js';
import { applyRecruitJoinBonus } from './RecruitScaling.js';
import { applyRecruitLevelBonus } from './RecruitJoinLevel.js';
import { isNecromancyClass } from './Necromancy.js';

/** Apply class abilities to new mercenaries and older persisted boards. */
export function grantMercenaryClassSkills(unit, classesData, skillsData) {
  const classData = classesData?.find((candidate) => candidate.name === unit?.className);
  if (!classData) return;
  for (const className of [classData.name, classData.promotesFrom].filter(Boolean)) {
    for (const skillId of getClassInnateSkills(className, skillsData)) learnSkill(unit, skillId);
  }
}

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
 * @param {Object} [difficultyData] - difficulty.json (per-rung class act gates)
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
  difficultyData = null,
) {
  const pool = enemyPools?.pools?.[actId];
  if (!pool) throw new Error(`No enemy pool for act: ${actId}`);

  // Act 1-2: base classes only. Act 3+: base + promoted
  const actIdx = ACT_SEQUENCE.indexOf(actId);
  const usePromoted = actIdx >= 2; // act3 = index 2
  let classPool = [...(pool.base || [])];
  if (usePromoted && pool.promoted) classPool.push(...pool.promoted);
  classPool = filterClassPoolByDifficulty(classPool, difficultyMode, {
    act: actId,
    difficulty: difficultyData,
  }).filter((name) => !isNecromancyClass(name)); // a bout has no Skeletons to raise
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

    // Split on the same effective-level convention as merc generation and
    // RecruitScaling (promotion at RECRUIT_PROMOTION_BASE_LEVEL). The old
    // BASE_CLASS_LEVEL_CAP split meant `level - 20` was ≤ 0 for any realistic
    // entrant, so promoted challengers were always promoted-level 1.
    const cappedBaseLevel = Math.min(level, RECRUIT_PROMOTION_BASE_LEVEL, BASE_CLASS_LEVEL_CAP);
    unit = createEnemyUnit(baseClassData, cappedBaseLevel, weaponsData, 1.0, null, actId);
    const bonuses = classData.promotionBonuses || {};
    promoteUnit(unit, classData, bonuses, null);

    const targetPromotedLevel = Math.min(
      PROMOTED_CLASS_LEVEL_CAP,
      Math.max(1, level - RECRUIT_PROMOTION_BASE_LEVEL),
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
    while (unit.skills.length < Math.min(diffConfig.challengerMinSkills, MAX_SKILLS)) {
      const pick = combatSkills[Math.floor(rng() * combatSkills.length)];
      learnSkill(unit, pick);
    }
  }

  // Platinum max skills on lunatic
  if (
    diffConfig?.platinumMaxSkills &&
    tier.xpMultiplier >= 1.5 // platinum tier
  ) {
    const combatSkills = ['sol', 'luna', 'vantage', 'wrath', 'adept', 'guard'];
    while (unit.skills.length < Math.min(diffConfig.platinumMaxSkills, MAX_SKILLS)) {
      const pick = combatSkills[Math.floor(rng() * combatSkills.length)];
      learnSkill(unit, pick);
    }
  }

  return { unit, weapon: unit.weapon, level: unit.level };
}

/**
 * Calculate arena reward for a fight outcome.
 * @param {Object} tier - tier config
 * @param {'win'|'lose'|'draw'|'yield'} outcome
 * @param {number} baseXP - XP from calculateCombatXP
 * @param {number} levelsGainedThisVisit - levels gained so far at this colosseum
 * @param {Object} colosseumData
 * @returns {{ goldDelta: number, xpGained: number }}
 */
export function calculateArenaReward(tier, outcome, baseXP, levelsGainedThisVisit, colosseumData) {
  const drAfterLevels = colosseumData?.arena?.diminishingReturnsAfterLevels ?? 2;
  const drFactor = colosseumData?.arena?.diminishingReturnsFactor ?? 0.5;

  // A loss and a yield both forfeit the entry fee and earn nothing.
  if (outcome === 'lose' || outcome === 'yield') {
    return { goldDelta: -tier.entryFee, xpGained: 0 };
  }
  // A draw (the bout reached its round cap) still trains the fighter; visit limits
  // and diminishing returns apply.
  const drawMultiplier = outcome === 'draw' ? (colosseumData?.arena?.drawXpMultiplier ?? 0.25) : 1;
  let xp = Math.round(baseXP * tier.xpMultiplier * drawMultiplier);
  if (levelsGainedThisVisit >= drAfterLevels) {
    xp = Math.round(xp * drFactor);
  }
  xp = Math.max(1, xp);

  return { goldDelta: outcome === 'draw' ? 0 : tier.goldReward, xpGained: xp };
}

/**
 * The weapon a fighter uses in the arena: the equipped weapon when it is a combat
 * weapon the unit can wield, otherwise the first one carried (a healer with a staff
 * equipped fights with its tome), otherwise null. The fight equips it (FE: you fight
 * with what you hold); the forecast only plans it.
 * @param {Object} unit
 * @returns {Object|null}
 */
export function getArenaWeapon(unit) {
  if (!unit || !Array.isArray(unit.inventory) || !Array.isArray(unit.proficiencies)) return null;
  const usable = getCombatWeapons(unit);
  return usable.includes(unit.weapon) ? unit.weapon : usable[0] || null;
}

/** The crowd's reason once a visit's bouts are spent (shown in place of any unit's). */
export const ARENA_VISIT_SPENT_REASON = 'The crowd goes home: no more bouts here.';

/**
 * Bouts fought at one colosseum visit: the sum of every fighter's count. The per-unit
 * counts (`colosseumState.fightsPerUnit`) are the one saved record; the visit total is
 * read from them, so the two can never disagree and a save from before the visit cap
 * already carries its true total.
 * @param {Object<string, number>|null|undefined} fightsPerUnit - unit name -> bouts
 * @returns {number}
 */
export function arenaVisitBouts(fightsPerUnit) {
  let total = 0;
  for (const count of Object.values(fightsPerUnit || {})) {
    if (Number.isFinite(count) && count > 0) total += Math.trunc(count);
  }
  return total;
}

/**
 * Bouts left at this visit (Infinity when no cap is configured).
 * @param {number} visitBouts - bouts fought so far (arenaVisitBouts)
 * @param {number} maxVisitBouts - getMaxFightsPerVisit
 * @returns {number}
 */
export function arenaVisitBoutsLeft(visitBouts, maxVisitBouts) {
  if (!Number.isFinite(maxVisitBouts)) return Infinity;
  return Math.max(0, maxVisitBouts - Math.max(0, visitBouts || 0));
}

/**
 * Why a unit can't enter the arena now, or '' when it can. The visit's bouts must
 * not be spent (the crowd's reason comes first: it is true of every fighter), and a
 * fighter needs more than 1 HP, a fight left this visit, and a combat weapon it can
 * wield: without one the exchange is empty (an unarmed or staff-only unit can't
 * strike, and the challenger never gets to), which used to count as a draw and pay
 * draw XP.
 * @param {Object} unit
 * @param {number} fightsThisVisit - fights this unit has done at this colosseum visit
 * @param {number} maxFights - bouts allowed per unit
 * @param {number} [visitBouts] - bouts fought at this visit by everyone
 * @param {number} [maxVisitBouts] - bouts allowed at this visit (default: no cap)
 * @returns {string}
 */
export function arenaEntryBlock(
  unit,
  fightsThisVisit,
  maxFights,
  visitBouts = 0,
  maxVisitBouts = Infinity,
) {
  const name = unit?.name || 'This unit';
  if (arenaVisitBoutsLeft(visitBouts, maxVisitBouts) <= 0) return ARENA_VISIT_SPENT_REASON;
  if ((unit?.currentHP || 0) <= 1) return `${name} needs more than 1 HP to fight.`;
  if (fightsThisVisit >= maxFights) return `${name} has no arena fights left this visit.`;
  if (!getArenaWeapon(unit)) return `${name} has no weapon to fight with.`;
  return '';
}

/**
 * Check if a unit can fight in the arena (see arenaEntryBlock).
 * @param {Object} unit
 * @param {number} fightsThisVisit - fights this unit has done at this colosseum visit
 * @param {number} maxFights
 * @param {number} [visitBouts]
 * @param {number} [maxVisitBouts]
 * @returns {boolean}
 */
export function canFight(
  unit,
  fightsThisVisit,
  maxFights,
  visitBouts = 0,
  maxVisitBouts = Infinity,
) {
  return arenaEntryBlock(unit, fightsThisVisit, maxFights, visitBouts, maxVisitBouts) === '';
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
 * Get max bouts per colosseum visit (all fighters together) for the current difficulty:
 * the rung's `difficulty.<id>.maxFightsPerVisit`, else `arena.maxFightsPerVisit`.
 * @param {string|null} difficultyMode
 * @param {Object} colosseumData
 * @returns {number}
 */
export function getMaxFightsPerVisit(difficultyMode, colosseumData) {
  const diffOverride = colosseumData?.difficulty?.[difficultyMode]?.maxFightsPerVisit;
  if (typeof diffOverride === 'number') return diffOverride;
  return colosseumData?.arena?.maxFightsPerVisit ?? 5;
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
 * @param {Array|null} [traitsData]
 * @param {Array<string>} [existingNames]
 * @param {Object|null} [metaEffects] effective meta effects (RunManager.getEffectiveMetaEffects):
 *   mercenaries get the recruit stat/growth upgrades and Skilled Recruits like every recruit
 * @param {{ runSeed?: number, marksData?: Array }|null} [markContext] the Mark roll
 *   (UnitManager.createRecruitUnit): run seed and data/marks.json; none = no Marks
 * @param {{ recruitLevelBonus?: number }} [options] `recruitLevelBonus`: Nomad's Pact, levels each
 *   mercenary is raised after it is built (engine/RecruitJoinLevel.js, a stream keyed by run seed
 *   and name, never `rng`: the board's classes, names and prices are the same with and without
 *   it). The weapon tier below keeps reading the level before the bonus.
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
  traitsData = null,
  existingNames = [],
  metaEffects = null,
  markContext = null,
  { recruitLevelBonus = 0 } = {},
) {
  const mercConfig = colosseumData?.mercenaries;
  // What every recruit source gets (RecruitNodeSystem.buildRecruitNodeUnit): seasoned
  // growths, the recruit stat/growth meta upgrades, and the Skilled Recruits skill.
  const statBonuses = metaEffects?.statBonuses || null;
  const growthBonuses = metaEffects?.growthBonuses || null;
  if (!mercConfig) {
    throw new Error('[ColosseumEngine] Missing mercenary config');
  }
  // The Mark roll keys on run seed and name, never the board's rng (a seeded board stays
  // reproducible). The name is final before createRecruitUnit below.
  const markOptions = {
    runSeed: markContext?.runSeed,
    marksData: markContext?.marksData || null,
    metaEffects,
  };

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

  if (combinedPool.length === 0) {
    throw new Error(`[ColosseumEngine] Empty mercenary class pool for act: ${actId}`);
  }

  // Name pool for generating recruit names
  const namePool = recruitPools?.namePool || {};

  // Boostable stats (exclude HP and MOV)
  const BOOSTABLE_STATS = ['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];

  const candidates = [];
  const usedNames = new Set(existingNames);
  let skippedCount = 0;
  for (let i = 0; i < count; i++) {
    let pickedClass = '?';
    try {
      const className = combinedPool[Math.floor(rng() * combinedPool.length)];
      pickedClass = className;
      const classData = classesData.find((c) => c.name === className);
      if (!classData) {
        skippedCount++;
        console.warn(`[ColosseumEngine] Skipping merc candidate: class "${className}" not found`);
        continue;
      }

      // Pick a name from the name pool or use class name as fallback
      const names = namePool[className] || [className];
      const freshNames = names.filter((name) => !usedNames.has(name));
      const pool = freshNames.length ? freshNames : names;
      const baseName = pool[Math.floor(rng() * pool.length)];
      let name = baseName,
        suffix = 2;
      while (usedNames.has(name)) name = `${baseName} ${suffix++}`;
      usedNames.add(name);

      // Level: lord level + random(-1, +1), min 1
      const levelOffset = Math.floor(rng() * 3) - 1; // -1, 0, or 1
      const level = Math.max(1, lordLevel + levelOffset);

      let unit;
      if (classData.tier === 'promoted') {
        // Promoted path: create as base class, promote, then post-promotion leveling.
        // Uses RECRUIT_PROMOTION_BASE_LEVEL as promotion threshold (simpler than
        // BossRecruitSystem's dynamic scaling — mercs are a paid service, not narrative reward).
        const baseClassName = classData.promotesFrom;
        const baseClassData = classesData.find((c) => c.name === baseClassName);
        if (!baseClassData) {
          skippedCount++;
          console.warn(
            `[ColosseumEngine] Skipping promoted merc "${className}": base class "${classData.promotesFrom}" not found`,
          );
          continue;
        }

        const baseLevel = Math.min(level, RECRUIT_PROMOTION_BASE_LEVEL, BASE_CLASS_LEVEL_CAP);
        unit = createRecruitUnit(
          { name, className: baseClassData.name, level: baseLevel },
          baseClassData,
          weaponsData,
          statBonuses,
          growthBonuses,
          null,
          classesData,
          {
            traitsData,
            skillsData,
            rng,
            traitClassData: classData,
            seasoned: true,
            ...markOptions,
          },
        );
        promoteUnit(unit, classData, classData.promotionBonuses || {}, skillsData);

        // Post-promotion levels: subtract 1 because promotion gives level 1 in promoted tier
        const promotedLevels = Math.max(0, level - RECRUIT_PROMOTION_BASE_LEVEL - 1);
        for (let p = 0; p < promotedLevels; p++) {
          const gains = levelUp(unit);
          if (gains) applyLevelUpGains(unit, gains);
        }
        checkLevelUpSkills(unit, classesData);
      } else {
        unit = createRecruitUnit(
          { name, className, level },
          classData,
          weaponsData,
          statBonuses,
          growthBonuses,
          null,
          classesData,
          { traitsData, skillsData, rng, seasoned: true, ...markOptions },
        );
      }
      unit.faction = 'player'; // Mercenaries join the player's team

      // Mercenaries need their class abilities on the board and immediately
      // after hire, not only after save migration repairs them on reload.
      // Match the loader's current/base-class order and use the shared skill cap.
      grantMercenaryClassSkills(unit, classesData, skillsData);

      // Nomad's Pact: the levels it adds, on the recruit's own stream.
      applyRecruitLevelBonus(unit, recruitLevelBonus, {
        classes: classesData,
        runSeed: markContext?.runSeed,
      });

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
      // The act's recruit join bonus (base-class mercenaries only).
      applyRecruitJoinBonus(unit, actId);

      // Skilled Recruits: every recruit joins with a random combat skill (drawn on the
      // board's rng, not Math.random, so a seeded board stays reproducible).
      if (metaEffects?.recruitRandomSkill) {
        const pick = RECRUIT_SKILL_POOL[Math.floor(rng() * RECRUIT_SKILL_POOL.length)];
        learnSkill(unit, pick);
      }

      // 50% chance: assign random combat skill
      if (rng() < (mercConfig.skillChance ?? 0.5)) {
        const skillPool = RECRUIT_SKILL_POOL;
        const pick = skillPool[Math.floor(rng() * skillPool.length)];
        learnSkill(unit, pick);
      }

      // Weapon tier bonus: equip weapon one tier above current act shops.
      // Capped by act to prevent Silver weapons appearing in Act 1.
      const tierSequence = ['Iron', 'Steel', 'Silver'];
      const ACT_WEAPON_TIER_CAP = { act1: 0, act2: 1, act3: 2, act4: 2 };
      const actCap = ACT_WEAPON_TIER_CAP[actId] ?? 2;
      const baseTierIdx = level >= 13 ? 2 : level >= 6 ? 1 : 0;
      const boostedIdx = Math.min(
        baseTierIdx + (mercConfig.weaponTierBonus || 1),
        actCap,
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
        unit.className,
      );
      candidates.push({ unit, hireCost });
    } catch (err) {
      skippedCount++;
      console.warn(
        `[ColosseumEngine] Skipping merc candidate (class: ${pickedClass}):`,
        err?.message || err,
      );
      continue;
    }
  }

  if (count > 0 && skippedCount > 0 && candidates.length === 0) {
    throw new Error(
      `[ColosseumEngine] Mercenary candidate generation failed (act: ${actId}, requested: ${count}, skipped: ${skippedCount})`,
    );
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
export function getMercenaryPrice(
  actId,
  isPromoted,
  difficultyMode,
  colosseumData,
  rng,
  className = null,
) {
  const mercConfig = colosseumData?.mercenaries;
  if (!mercConfig) return 500;

  const priceRange = mercConfig.pricing?.[actId] || mercConfig.pricing?.act1 || [300, 500];
  const [minPrice, maxPrice] = priceRange;
  let price = minPrice + Math.floor(rng() * (maxPrice - minPrice + 1));

  if (isPromoted) {
    price = Math.round(price * (mercConfig.promotedMultiplier || 1.5));
  }

  price = Math.round(price * (mercConfig.classPriceMultipliers?.[className] ?? 1));
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
