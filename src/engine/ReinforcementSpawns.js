// ReinforcementSpawns.js — what a scheduled reinforcement becomes (pure, no Phaser).
//
// The one implementation behind BattleScene and the headless harness:
//   - the template pool an arrival copies (the map's non-boss spawns, else the act pool)
//     and the hashed pick from it;
//   - the spawn spec (scripted overrides, the ladder's level bonus and promoted waves);
//   - the scheduler call itself (who occupies what, which tiles the ladder avoids);
//   - the reward multiplier an arrival carries (XP and gold), and the zero-reward rule.
// ReinforcementScheduler decides when and where; this module decides who.

import { filterClassPoolByDifficulty, XP_SPECIAL_ENEMY_MULTIPLIER } from '../utils/constants.js';
import { affixesAllowedForClass } from './AffixEngine.js';
import { earlyEnemyAllowed } from './EarlyEnemyRules.js';
import { getFootprint, isEntity } from './EntitySystem.js';
import { RAISED_XP_MULTIPLIER, isRaisedUnit, isNecromancyClass } from './Necromancy.js';
import { reinforcementMoveTypes, scheduleReinforcementsForTurn } from './ReinforcementScheduler.js';

/** Level an arrival takes when the map has no non-boss spawn to copy. */
export const ENEMY_FALLBACK_LEVEL_BY_ACT = Object.freeze({
  act1: 3,
  act2: 6,
  act3: 9,
  act4: 12,
  finalBoss: 14,
});

/** The average level of the map's non-boss spawns, else the act's fallback level. */
export function enemySpawnFallbackLevel(battleConfig, act) {
  const nonBossLevels = (battleConfig?.enemySpawns || [])
    .filter((spawn) => spawn && !spawn.isBoss)
    .map((spawn) => Math.trunc(Number(spawn.level) || 0))
    .filter((level) => level > 0);
  if (nonBossLevels.length > 0) {
    const total = nonBossLevels.reduce((sum, level) => sum + level, 0);
    return Math.max(1, Math.round(total / nonBossLevels.length));
  }
  return ENEMY_FALLBACK_LEVEL_BY_ACT[act] || 3;
}

/** The act's class pool (`pools[act][tier]`) this rung and battle may draw on. */
function allowedActClasses(names, { battleParams, gameData }) {
  const act = battleParams?.act || 'act1';
  return filterClassPoolByDifficulty(names, battleParams?.difficultyId, {
    act,
    difficulty: gameData?.difficulty,
  }).filter(
    (className) =>
      typeof className === 'string' &&
      // An arrival is never a Necromancer or a Skeleton: they come from the Necromancer's
      // own raise, one Necromancer per battle (Necromancy.js).
      !isNecromancyClass(className) &&
      earlyEnemyAllowed(className, battleParams) &&
      (gameData?.classes || []).some((c) => c.name === className),
  );
}

/**
 * The templates a procedural arrival copies: each distinct non-boss spawn of the map
 * (class, level, Sunder, poison), else every class of the act pool at the fallback level.
 */
export function buildReinforcementTemplatePool({ battleConfig, battleParams, gameData }) {
  const classes = gameData?.classes || [];
  const fallbackLevel = enemySpawnFallbackLevel(battleConfig, battleParams?.act);
  const templates = [];
  const seen = new Set();
  for (const spawn of battleConfig?.enemySpawns || []) {
    if (
      !spawn ||
      spawn.isBoss ||
      typeof spawn.className !== 'string' ||
      isNecromancyClass(spawn.className) ||
      !earlyEnemyAllowed(spawn.className, battleParams)
    )
      continue;
    if (!classes.some((c) => c.name === spawn.className)) continue;
    const level = Math.max(1, Math.trunc(Number(spawn.level) || fallbackLevel));
    const key = `${spawn.className}:${level}:${spawn.sunderWeapon ? 's' : 'n'}:${spawn.poisonWeapon ? 'p' : 'n'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    templates.push({
      className: spawn.className,
      level,
      sunderWeapon: Boolean(spawn.sunderWeapon),
      poisonWeapon: Boolean(spawn.poisonWeapon),
      // An arrival hunts: it never copies a garrison's hold (HoldActivation).
      aiMode: spawn.aiMode && spawn.aiMode !== 'hold' ? spawn.aiMode : null,
      affixes: Array.isArray(spawn.affixes) ? [...spawn.affixes] : [],
    });
  }
  if (templates.length > 0) return templates;

  const pool = gameData?.enemies?.pools?.[battleParams?.act || 'act1'];
  const names = [
    ...(Array.isArray(pool?.base) ? pool.base : []),
    ...(Array.isArray(pool?.promoted) ? pool.promoted : []),
  ];
  for (const className of allowedActClasses(names, { battleParams, gameData })) {
    templates.push({
      className,
      level: fallbackLevel,
      sunderWeapon: false,
      poisonWeapon: false,
      aiMode: null,
      affixes: [],
    });
  }
  return templates;
}

/** The promoted classes a promoted ladder wave draws from (the act pool, this rung). */
export function ladderPromotedClasses({ battleParams, gameData }) {
  const pool = gameData?.enemies?.pools?.[battleParams?.act || 'act1'];
  return allowedActClasses(Array.isArray(pool?.promoted) ? pool.promoted : [], {
    battleParams,
    gameData,
  });
}

/** Seeded hash of an arrival (wave, tile, order in the turn's spawns): picks its template. */
export function reinforcementTemplateHash(seed, spawn, spawnOrdinal = 0) {
  let hash = Number(seed) >>> 0;
  const waveIndex = Math.trunc(Number(spawn?.waveIndex) || 0) + 1;
  const col = Math.trunc(Number(spawn?.col) || 0) + 1;
  const row = Math.trunc(Number(spawn?.row) || 0) + 1;
  const ordinal = Math.trunc(Number(spawnOrdinal) || 0) + 1;
  hash ^= Math.imul(waveIndex, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash ^= Math.imul(col, 0xc2b2ae35);
  hash = Math.imul(hash ^ (hash >>> 13), 0x27d4eb2d);
  hash ^= Math.imul(row, 0x165667b1);
  hash ^= Math.imul(ordinal, 0x1b873593);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * The enemy a scheduled arrival becomes (the spawn spec addEnemyFromSpawn reads), or
 * null when there is nothing to copy. A scripted spawn's own class, level, gear, AI and
 * affixes win over the template's. A ladder arrival (engine/RoutLadder.js) adds its
 * wave's `levelBonus` to the copied level; a promoted wave swaps the class for one of
 * the act's promoted classes (hashed, without Sunder or poison) and keeps the copied
 * affixes the new class may carry. Arrivals roll no new affixes.
 */
export function buildReinforcementSpawnSpec({
  scheduledSpawn,
  spawnOrdinal = 0,
  seed = 0,
  templates = [],
  battleConfig,
  battleParams,
  gameData,
}) {
  if (!scheduledSpawn) return null;
  const fallbackLevel = enemySpawnFallbackLevel(battleConfig, battleParams?.act);
  const classOverride =
    typeof scheduledSpawn.className === 'string' &&
    !isNecromancyClass(scheduledSpawn.className) &&
    earlyEnemyAllowed(scheduledSpawn.className, battleParams)
      ? scheduledSpawn.className
      : null;

  let template = null;
  const hash = reinforcementTemplateHash(seed, scheduledSpawn, spawnOrdinal);
  if (!classOverride) {
    if (!Array.isArray(templates) || templates.length === 0) return null;
    template = templates[hash % templates.length];
    if (!template || typeof template.className !== 'string') return null;
  }

  const hasLevelOverride = Number.isFinite(scheduledSpawn.level);
  const baseLevel = Math.max(
    1,
    Math.trunc(
      Number(hasLevelOverride ? scheduledSpawn.level : template ? template.level : fallbackLevel) ||
        fallbackLevel,
    ),
  );
  const levelBonus = Math.max(0, Math.trunc(Number(scheduledSpawn.levelBonus) || 0));
  const spec = {
    className: classOverride || template.className,
    level: baseLevel + levelBonus,
    col: scheduledSpawn.col,
    row: scheduledSpawn.row,
    sunderWeapon:
      typeof scheduledSpawn.sunderWeapon === 'boolean'
        ? scheduledSpawn.sunderWeapon
        : Boolean(template?.sunderWeapon),
    poisonWeapon:
      typeof scheduledSpawn.poisonWeapon === 'boolean'
        ? scheduledSpawn.poisonWeapon
        : Boolean(template?.poisonWeapon),
    aiMode:
      typeof scheduledSpawn.aiMode === 'string' ? scheduledSpawn.aiMode : template?.aiMode || null,
    aiTargetTile:
      scheduledSpawn.aiTargetTile &&
      Number.isFinite(scheduledSpawn.aiTargetTile.col) &&
      Number.isFinite(scheduledSpawn.aiTargetTile.row)
        ? { col: scheduledSpawn.aiTargetTile.col, row: scheduledSpawn.aiTargetTile.row }
        : null,
    affixes: Array.isArray(scheduledSpawn.affixes)
      ? [...scheduledSpawn.affixes]
      : Array.isArray(template?.affixes)
        ? [...template.affixes]
        : [],
  };
  if (scheduledSpawn.promoted === true && !classOverride) {
    const promoted = ladderPromotedClasses({ battleParams, gameData });
    if (promoted.length > 0) {
      // A second draw from the same hash, so class and copied template are independent.
      const classHash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0;
      spec.className = promoted[classHash % promoted.length];
      spec.sunderWeapon = false;
      spec.poisonWeapon = false;
      // The copied affixes were rolled for the template's class: drop any the new class
      // is excluded from (affixes.json class_exclude).
      spec.affixes = affixesAllowedForClass(spec.affixes, spec.className, gameData?.affixes);
    }
  }
  return spec;
}

/** Tiles units stand on (an Entity fills its whole footprint). */
export function occupiedUnitTiles(units) {
  const tiles = [];
  for (const unit of units || []) {
    if (!unit || !Number.isFinite(unit.col) || !Number.isFinite(unit.row)) continue;
    if (isEntity(unit)) tiles.push(...getFootprint(unit));
    else tiles.push({ col: unit.col, row: unit.row });
  }
  return tiles;
}

/**
 * Resolve this turn's reinforcements for a battle (scene and harness alike): every class
 * an arrival may copy must be able to stand on its tile; the ladder also keeps clear of
 * player units and NPCs (the caravan is one).
 */
export function resolveBattleReinforcements({
  turn,
  seed = 0,
  battleConfig,
  battleParams,
  gameData,
  templates = [],
  playerUnits = [],
  enemyUnits = [],
  npcUnits = [],
  occupied = null,
  fallbackDifficultyId = 'normal',
}) {
  if (!battleConfig?.reinforcements) return { spawns: [], dueWaves: [], blockedSpawns: 0 };
  const classes = gameData?.classes || [];
  const classMoveType = (name) => classes.find((c) => c.name === name)?.moveType;
  const hasPromotedWave = (battleConfig.reinforcements.ladder?.waves || []).some(
    (wave) => wave?.promoted === true,
  );
  return scheduleReinforcementsForTurn({
    turn,
    seed,
    reinforcements: battleConfig.reinforcements,
    mapLayout: battleConfig.mapLayout,
    terrain: gameData?.terrain,
    occupied: occupied || occupiedUnitTiles([...playerUnits, ...enemyUnits, ...npcUnits]),
    moveTypes: reinforcementMoveTypes(templates, classes),
    promotedMoveTypes: hasPromotedWave
      ? reinforcementMoveTypes(
          ladderPromotedClasses({ battleParams, gameData }).map((className) => ({ className })),
          classes,
        )
      : null,
    classMoveType,
    difficultyId: battleParams?.difficultyId || fallbackDifficultyId,
    difficultyTurnOffset: Math.trunc(Number(battleParams?.reinforcementTurnOffset) || 0),
    enemyCountBonus: Math.trunc(Number(battleParams?.enemyCountBonus) || 0),
    activeEnemyCount: enemyUnits.length,
    playerTiles: occupiedUnitTiles(playerUnits),
    npcTiles: occupiedUnitTiles(npcUnits),
  });
}

/** A reward multiplier clamped to [0, 1] (1 when missing). */
export function normalizeEnemyRewardMultiplier(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

/**
 * Gold multiplier an enemy carries: 0 for a unit a Necromancer raised, else its wave's, or
 * 1 for a map spawn. (The XP it pays is enemyXpMultiplier.)
 */
export function enemyRewardMultiplier(unit) {
  if (isRaisedUnit(unit)) return 0;
  if (!unit?._isReinforcement) return 1;
  const rewardMultiplier = Number.isFinite(unit._reinforcementRewardMultiplier)
    ? unit._reinforcementRewardMultiplier
    : unit._reinforcementXpMultiplier;
  return normalizeEnemyRewardMultiplier(rewardMultiplier);
}

/**
 * The XP multiplier for fighting an enemy: its reward, × the boss/elite bonus. A raised
 * unit pays a quarter (it pays no gold, so its reward multiplier cannot stand in).
 */
export function enemyXpMultiplier(unit) {
  if (isRaisedUnit(unit)) return RAISED_XP_MULTIPLIER;
  const rewardMultiplier = enemyRewardMultiplier(unit);
  if (!(unit?.isBoss || unit?.isElite)) return rewardMultiplier;
  return rewardMultiplier * XP_SPECIAL_ENEMY_MULTIPLIER;
}

/**
 * An arrival whose wave pays nothing (a late ladder wave, a pursuit wave at 0), or a unit
 * a Necromancer raised. Killing it still counts as a kill, but it feeds no deed record.
 * (A raised unit still pays its quarter XP, and an arrival whose wave pays nothing pays no
 * survival XP.)
 */
export function isZeroRewardUnit(unit) {
  if (isRaisedUnit(unit)) return true;
  return Boolean(unit?._isReinforcement) && enemyRewardMultiplier(unit) <= 0;
}

/** Mark a spawned enemy with its wave (index, turn, reward). */
export function stampReinforcementMeta(enemy, meta) {
  if (!enemy || !meta) return enemy;
  enemy._isReinforcement = true;
  enemy._reinforcementWaveIndex = Math.trunc(Number(meta.waveIndex) || 0);
  enemy._reinforcementSpawnTurn = Math.trunc(Number(meta.scheduledTurn) || 0);
  const rewardMultiplier = normalizeEnemyRewardMultiplier(Number(meta.xpMultiplier));
  enemy._reinforcementRewardMultiplier = rewardMultiplier;
  // Backward compatibility for legacy field name.
  enemy._reinforcementXpMultiplier = rewardMultiplier;
  return enemy;
}
