// DifficultyEngine.js - Wave 8 difficulty validation and lookup helpers.

import { REVIVAL_STONE_KINDS, hasRevivalStones } from './RevivalStones.js';
import { actLabel } from '../utils/actNames.js';

export const DIFFICULTY_CONTRACT_VERSION = 1;

/**
 * The ladder, easiest first. Player-facing names come from difficulty.json labels:
 * First Light (normal), Dusk (dusk), Nightfall (hard), Black Sun (lunatic). The ids
 * are save data and never change.
 */
export const DIFFICULTY_IDS = ['normal', 'dusk', 'hard', 'lunatic'];

/** Act order for "from this act on" gates (postAct sits between Act IV and the finale). */
export const ENEMY_ACT_GATE_ORDER = Object.freeze([
  'act1',
  'act2',
  'act3',
  'act4',
  'postAct',
  'finalBoss',
]);

/** Position on the ladder (0 = First Light), or -1 for an unknown id. */
export function difficultyRank(difficultyId) {
  return DIFFICULTY_IDS.indexOf(String(difficultyId || '').toLowerCase());
}

/** True when `difficultyId` is `floor` or harder (unknown ids are never). */
export function isDifficultyAtLeast(difficultyId, floor) {
  const rank = difficultyRank(difficultyId);
  return rank >= 0 && rank >= difficultyRank(floor);
}

/**
 * What opens each rung: any one of its milestones. `anySlot` also counts a
 * milestone earned on another save slot. Winning on the old Hard (which ended at the
 * Emperor, as Dusk did before it went on to the Lieutenant) recorded beatHard, so it still
 * opens Nightfall.
 */
export const DIFFICULTY_UNLOCKS = Object.freeze({
  dusk: Object.freeze({
    milestones: Object.freeze(['beatGame']),
    anySlot: false,
    reason: 'Win on First Light to unlock',
  }),
  hard: Object.freeze({
    milestones: Object.freeze(['beatDusk', 'beatHard']),
    anySlot: true,
    reason: 'Win on Dusk to unlock',
  }),
  lunatic: Object.freeze({
    milestones: Object.freeze(['beatHard', 'beatLunatic']),
    anySlot: true,
    reason: 'Win on Nightfall to unlock',
  }),
});

/**
 * Why a difficulty is locked, or null when it is open.
 * @param {string} difficultyId
 * @param {{ slot: (id: string) => boolean, anySlot?: (id: string) => boolean }} has
 *   milestone checks for this slot and for any slot
 */
export function difficultyLockReason(difficultyId, has) {
  const rule = DIFFICULTY_UNLOCKS[difficultyId];
  if (!rule) return null;
  const earned = (id) => Boolean(has?.slot?.(id) || (rule.anySlot && has?.anySlot?.(id)));
  return rule.milestones.some(earned) ? null : rule.reason;
}

/** Milestone a victory on this difficulty records, if any. */
export function difficultyVictoryMilestone(difficultyId) {
  return { dusk: 'beatDusk', hard: 'beatHard', lunatic: 'beatLunatic' }[difficultyId] || null;
}

/** True for a known difficulty id. */
export function isDifficultyId(difficultyId) {
  return DIFFICULTY_IDS.includes(difficultyId);
}

export const DIFFICULTY_REQUIRED_KEYS = [
  'enemyStatBonus',
  'enemyCountBonus',
  'enemyLevelBonus',
  'enemyCountBase',
  'enemyEquipTierShift',
  'enemySkillChance',
  'enemyPoisonChance',
  'enemyStatusStaffChance',
  'statusStaffConfig',
  'carryConfig',
  'shopCureGating',
  'goldMultiplier',
  'shopPriceMultiplier',
  'lootQualityShift',
  'deployLimitBonus',
  'xpMultiplier',
  'specialXpMultiplier',
  'xpUnderdogCap',
  'fogChanceBonus',
  'villageAmbushChance',
  'reinforcementTurnOffset',
  'currencyMultiplier',
  'actsIncluded',
  'extendedLevelingEnabled',
  'churchPromotionLimit',
  'growthBonusMultiplier',
];

export const DIFFICULTY_DEFAULTS = Object.freeze({
  label: 'First Light',
  color: '#95c487',
  enemyStatBonus: 0,
  classStatBonuses: Object.freeze({}),
  // Enemy class -> the first act it may appear in on this rung (Dusk: Dragons from Act IV).
  enemyClassEarliestAct: Object.freeze({}),
  enemyCountBonus: 0,
  enemyLevelBonus: 0,
  // Act bosses' levels are fixed per boss (enemies.json); this raises them per rung.
  bossLevelBonus: 0,
  enemyCountBase: 0,
  recruitEnemyCountBonus: 0,
  recruitAffixCount: 0,
  recruitAffixExcludedActs: Object.freeze(['act1']),
  act1EnemyCountDeployCap: 3,
  enemyEquipTierShift: 0,
  enemySkillChance: 0,
  enemyPoisonChance: 0,
  enemyStatusStaffChance: 0,
  statusStaffConfig: null,
  // Enemies that carry an item a Thief can steal (docs/specs/phase3.md 3G, EnemyCarry.js):
  // { perBattle, act1..act4, finalBoss, maxPerBattle }. null: none (a run saved before it).
  carryConfig: null,
  shopCureGating: null,
  goldMultiplier: 1,
  shopPriceMultiplier: 1,
  lootQualityShift: 0,
  deployLimitBonus: 0,
  xpMultiplier: 1,
  // Boss and elite kills pay this much more XP; a stronger foe adds at most `xpUnderdogCap` levels.
  specialXpMultiplier: 1.3,
  xpUnderdogCap: 6,
  fogChanceBonus: 0,
  villageAmbushChance: 0,
  reinforcementTurnOffset: 0,
  currencyMultiplier: 1,
  actsIncluded: ['act1', 'act2', 'act3', 'finalBoss'],
  extendedLevelingEnabled: false,
  churchPromotionLimit: -1,
  growthBonusMultiplier: 1,
  // 'action': Vision can return to before any completed player action;
  // 'turn': only to player-turn starts.
  rewindGranularity: 'action',
  siegeWeaponConfig: null,
  // Battle pacing (docs/specs/dusk-pressure.md). The rout reinforcement ladder (null: no
  // ladder), the par inflation a new map locks in (null: turnBonus.parInflation), and
  // whether a template's procedural waves raise par when they arrive.
  routLadder: null,
  parInflation: null,
  templateWavesRaisePar: true,
  // Hold-position garrisons ({ seize, escape } shares, null: none) and a par offset per
  // objective that a new map locks in, for every act or by act
  // ({ seize: -2, rout: { act4: -2 } }, null: none).
  holdShare: null,
  objectiveParOffset: null,
  // Revival Stones a boss carries ({ actBoss, emperor, lieutenant, eliteCaptain }, RevivalStones.js;
  // null: none). Every rung in difficulty.json names all four; a run saved before them has none.
  revivalStones: null,
  // Act id -> first node row that may hold a village ({ act1: 3 }: none in an act's first
  // three rows; null / a missing act: any row). Applied when a node map is generated.
  villageMinRow: null,
  // Battle modifiers by act ({ act1: { enemyStatBonus: 1, enemyCountBase: 5 } }, null: none):
  // a battle in that act reads these in place of the rung's own (`ACT_OVERRIDE_KEYS`).
  actOverrides: null,
});

/**
 * The battle modifiers a rung may set per act (`actOverrides`), and the kind of value each
 * takes: 'count' a non-negative whole number, 'chance' a number from 0 to 1. Black Sun eases
 * its Act I with them; every other act reads the rung's own values.
 */
export const ACT_OVERRIDE_KEYS = Object.freeze({
  enemyStatBonus: 'count',
  enemyCountBonus: 'count',
  enemyLevelBonus: 'count',
  bossLevelBonus: 'count',
  enemyCountBase: 'count',
  enemySkillChance: 'chance',
  enemyPoisonChance: 'chance',
});

/**
 * A rung's `actOverrides` value for `key` in `act`, or undefined when the rung sets none
 * (the battle then reads the rung's own value). `modifiers` is a run's snapshot or a mode.
 */
export function actOverrideFor(modifiers, key, act) {
  if (!Object.hasOwn(ACT_OVERRIDE_KEYS, key)) return undefined;
  const value = modifiers?.actOverrides?.[act]?.[key];
  return Number.isFinite(value) ? value : undefined;
}

/** "Act I: enemy stats +1, +1 extra enemy per map" lines for a rung's act overrides. */
function actOverrideSummary(mode) {
  const lines = [];
  for (const act of ENEMY_ACT_GATE_ORDER) {
    const over = mode?.actOverrides?.[act];
    if (!isObject(over)) continue;
    const parts = [];
    const add = (key, text) => {
      const value = actOverrideFor(mode, key, act);
      if (value !== undefined && value !== mode[key]) parts.push(text(value));
    };
    add('enemyStatBonus', (n) => `enemy stats +${n}`);
    add('enemyLevelBonus', (n) => `enemy levels +${n}`);
    add('bossLevelBonus', (n) => `boss levels +${n}`);
    add('enemyCountBonus', (n) => `+${n} extra ${n === 1 ? 'enemy' : 'enemies'} per map`);
    add('enemyCountBase', (n) => `enemies scale as if you field at least ${n} units`);
    add('enemySkillChance', (n) => `+${Math.round(n * 100)}% enemy skill chance`);
    add('enemyPoisonChance', (n) => `+${Math.round(n * 100)}% enemy poison chance`);
    if (parts.length > 0) lines.push(`${actLabel(act) || act} eases in: ${parts.join(', ')}`);
  }
  return lines;
}

const recruitAffixExclusions = (config, id) =>
  config?.modes?.[id]?.recruitAffixExcludedActs ??
  (id === 'normal' ? DIFFICULTY_DEFAULTS.recruitAffixExcludedActs : []);

/** Encounter policy, independent of Eclipse's rolled/guaranteed affix overrides. */
export function recruitAffixesAllowed(params, difficultyData) {
  if (!params?.isRecruitBattle) return true;
  const id = params.difficultyId || 'normal';
  const excluded = recruitAffixExclusions(difficultyData, id);
  return !excluded.includes(params.act || 'act1');
}

/** The shortest and longest turn gap between a rung's ladder waves, or null without a ladder. */
function routLadderGaps(routLadder) {
  const gaps = [];
  for (const rows of Object.values(routLadder?.acts || {})) {
    const turns = (Array.isArray(rows) ? rows : []).map((r) => r?.turn).filter(Number.isFinite);
    for (let i = 1; i < turns.length; i++) gaps.push(turns[i] - turns[i - 1]);
  }
  return gaps.length > 0 ? [Math.min(...gaps), Math.max(...gaps)] : null;
}

/**
 * Compare a difficulty mode against DIFFICULTY_DEFAULTS and return human-readable
 * modifier summary lines. Normal mode (matching defaults) returns an empty array.
 */
export function generateModifierSummary(mode, defaults = DIFFICULTY_DEFAULTS) {
  if (!mode || typeof mode !== 'object') return [];
  const lines = [];
  if (mode.enemyStatBonus > (defaults.enemyStatBonus || 0)) {
    lines.push(`Enemy stats +${mode.enemyStatBonus}`);
  }
  for (const [className, bonus] of Object.entries(mode.classStatBonuses || {})) {
    if (Number.isFinite(bonus) && bonus > 0) lines.push(`Enemy ${className} stats +${bonus}`);
  }
  if (mode.enemyCountBonus > (defaults.enemyCountBonus || 0)) {
    lines.push(`+${mode.enemyCountBonus} extra enemies per map`);
  }
  if (mode.enemyLevelBonus > (defaults.enemyLevelBonus || 0)) {
    lines.push(`Enemy levels +${mode.enemyLevelBonus}`);
  }
  if (mode.bossLevelBonus > (defaults.bossLevelBonus || 0)) {
    lines.push(`Boss levels +${mode.bossLevelBonus}`);
  }
  if (mode.enemyCountBase > (defaults.enemyCountBase || 0)) {
    lines.push(`Enemies scale as if you field at least ${mode.enemyCountBase} units`);
  }
  if (mode.enemySkillChance > (defaults.enemySkillChance || 0)) {
    lines.push(`+${Math.round(mode.enemySkillChance * 100)}% enemy skill chance`);
  }
  if (mode.goldMultiplier !== (defaults.goldMultiplier ?? 1) && mode.goldMultiplier < 1) {
    lines.push(`${Math.round(mode.goldMultiplier * 100)}% gold earned`);
  }
  if (mode.shopPriceMultiplier > (defaults.shopPriceMultiplier ?? 1)) {
    lines.push(`Shop prices +${Math.round((mode.shopPriceMultiplier - 1) * 100)}%`);
  }
  if (mode.xpMultiplier !== (defaults.xpMultiplier ?? 1) && mode.xpMultiplier < 1) {
    lines.push(`${Math.round(mode.xpMultiplier * 100)}% XP earned`);
  }
  if (mode.specialXpMultiplier < (defaults.specialXpMultiplier ?? 1.3)) {
    lines.push(
      mode.specialXpMultiplier > 1
        ? `Boss and elite XP bonus +${Math.round((mode.specialXpMultiplier - 1) * 100)}%`
        : 'No boss or elite XP bonus',
    );
  }
  if (mode.xpUnderdogCap < (defaults.xpUnderdogCap ?? 6)) {
    lines.push(`Stronger foes add at most +${mode.xpUnderdogCap} levels to XP`);
  }
  if (mode.fogChanceBonus > (defaults.fogChanceBonus || 0)) {
    lines.push(`+${Math.round(mode.fogChanceBonus * 100)}% fog chance`);
  }
  if (mode.villageAmbushChance > (defaults.villageAmbushChance || 0)) {
    lines.push(`${Math.round(mode.villageAmbushChance * 100)}% shop ambush chance`);
  }
  // Above the default it pays back ("+25% meta currency"); below it is a term of the
  // run, worded like gold and XP ("80% meta currency").
  if (mode.currencyMultiplier > (defaults.currencyMultiplier ?? 1)) {
    lines.push(`+${Math.round((mode.currencyMultiplier - 1) * 100)}% meta currency`);
  } else if (mode.currencyMultiplier < (defaults.currencyMultiplier ?? 1)) {
    lines.push(`${Math.round(mode.currencyMultiplier * 100)}% meta currency`);
  }
  if (mode.extendedLevelingEnabled && !defaults.extendedLevelingEnabled) {
    lines.push('Extended leveling past Lv 20');
  }
  if (mode.enemyPoisonChance > (defaults.enemyPoisonChance || 0)) {
    lines.push(`+${Math.round(mode.enemyPoisonChance * 100)}% enemy poison chance`);
  }
  if (mode.enemyEquipTierShift > (defaults.enemyEquipTierShift || 0)) {
    lines.push(`Enemy weapon tier +${mode.enemyEquipTierShift}`);
  }
  if (mode.statusStaffConfig) {
    const cfg = mode.statusStaffConfig;
    const firstAct = ['act1', 'act2', 'act3', 'act4'].find((a) => cfg[a] > 0);
    if (firstAct) {
      const actNum = firstAct.replace('act', '');
      const kinds = Array.isArray(cfg.kinds) ? cfg.kinds : null;
      const name =
        kinds?.length === 1 ? `${kinds[0][0].toUpperCase()}${kinds[0].slice(1)}` : 'Status';
      lines.push(`${name} staves from Act ${actNum}+ (max ${cfg.maxPerBattle}/battle)`);
    }
  }
  if (Number.isFinite(mode.churchPromotionLimit) && mode.churchPromotionLimit >= 0) {
    lines.push(`Church promotions limited to ${mode.churchPromotionLimit} per visit`);
  }
  if (Number.isFinite(mode.growthBonusMultiplier) && mode.growthBonusMultiplier < 1) {
    lines.push(`Growth bonuses ×${mode.growthBonusMultiplier}`);
  }
  const ladderGaps = routLadderGaps(mode.routLadder);
  if (ladderGaps) {
    const [lo, hi] = ladderGaps;
    lines.push(`Rout maps: reinforcement waves every ${lo === hi ? lo : `${lo}–${hi}`} turns`);
  }
  if (mode.holdShare && Object.values(mode.holdShare).some((n) => n > 0)) {
    lines.push('Part of each seize and escape garrison holds its ground until disturbed');
  }
  const seizeOffset = mode.objectiveParOffset?.seize;
  if (Number.isInteger(seizeOffset) && seizeOffset < 0) {
    const n = -seizeOffset;
    lines.push(
      `Seize maps: par ${n} turn${n === 1 ? '' : 's'} tighter, never below a walk to the throne`,
    );
  }
  if (mode.templateWavesRaisePar === false) {
    lines.push(
      'Map reinforcement waves no longer extend par; village bandits and keep garrisons still do',
    );
  }
  if (mode.carryConfig) {
    const cfg = mode.carryConfig;
    const firstAct = ['act1', 'act2', 'act3', 'act4'].find((a) => cfg[a] > 0);
    if (firstAct && cfg.maxPerBattle > 0) {
      const actNum = firstAct.replace('act', '');
      lines.push(
        `Foes carry items a Thief can steal from Act ${actNum}+ (max ${cfg.maxPerBattle}/battle)`,
      );
    }
  }
  if (hasRevivalStones(mode.revivalStones)) {
    const stones = mode.revivalStones;
    const label = {
      actBoss: 'act bosses',
      emperor: 'the Emperor',
      lieutenant: 'the Lieutenant',
      eliteCaptain: 'elite captains',
    };
    const parts = REVIVAL_STONE_KINDS.filter((kind) => stones[kind] > 0).map(
      (kind) => `${label[kind]} ${stones[kind]}`,
    );
    lines.push(`Revival Stones (a boss refills when felled): ${parts.join(', ')}`);
  }
  if (mode.siegeWeaponConfig) {
    const cfg = mode.siegeWeaponConfig;
    const firstAct = ['act1', 'act2', 'act3', 'act4'].find((a) => cfg[a] > 0);
    if (firstAct) {
      const actNum = firstAct.replace('act', '');
      lines.push(`Siege magic from Act ${actNum}+ (max ${cfg.maxPerBattle}/battle)`);
    }
  }
  lines.push(...actOverrideSummary(mode));
  return lines;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateDifficultyConfig(config) {
  const errors = [];
  if (!isObject(config)) {
    return { valid: false, errors: ['difficulty config must be an object'] };
  }
  if (config.version !== DIFFICULTY_CONTRACT_VERSION) {
    errors.push(`version must be ${DIFFICULTY_CONTRACT_VERSION}`);
  }
  if (!isObject(config.modes)) {
    errors.push('modes must be an object');
    return { valid: errors.length === 0, errors };
  }

  for (const difficultyId of DIFFICULTY_IDS) {
    const mode = config.modes[difficultyId];
    if (!isObject(mode)) {
      errors.push(`modes.${difficultyId} must be an object`);
      continue;
    }

    if (
      mode.classStatBonuses !== undefined &&
      (!isObject(mode.classStatBonuses) ||
        Object.values(mode.classStatBonuses).some((bonus) => !Number.isInteger(bonus) || bonus < 0))
    ) {
      errors.push(
        `modes.${difficultyId}.classStatBonuses must map classes to non-negative integers`,
      );
    }

    if (
      mode.enemyClassEarliestAct !== undefined &&
      (!isObject(mode.enemyClassEarliestAct) ||
        Object.values(mode.enemyClassEarliestAct).some(
          (act) => !ENEMY_ACT_GATE_ORDER.includes(act),
        ))
    ) {
      errors.push(`modes.${difficultyId}.enemyClassEarliestAct must map classes to act ids`);
    }

    if (mode.actOverrides !== undefined && mode.actOverrides !== null) {
      const where = `modes.${difficultyId}.actOverrides`;
      if (!isObject(mode.actOverrides)) errors.push(`${where} must be an object of act ids`);
      else {
        for (const [act, over] of Object.entries(mode.actOverrides)) {
          if (!ENEMY_ACT_GATE_ORDER.includes(act)) errors.push(`${where}.${act} is not an act id`);
          if (!isObject(over)) {
            errors.push(`${where}.${act} must be an object`);
            continue;
          }
          for (const [key, value] of Object.entries(over)) {
            const kind = ACT_OVERRIDE_KEYS[key];
            if (!kind)
              errors.push(`${where}.${act}.${key} is not a battle modifier an act can set`);
            else if (kind === 'count' && !(Number.isInteger(value) && value >= 0))
              errors.push(`${where}.${act}.${key} must be a non-negative integer`);
            else if (kind === 'chance' && !(isFiniteNumber(value) && value >= 0 && value <= 1))
              errors.push(`${where}.${act}.${key} must be a number from 0 to 1`);
          }
        }
      }
    }

    if (
      mode.bossLevelBonus !== undefined &&
      (!Number.isInteger(mode.bossLevelBonus) || mode.bossLevelBonus < 0)
    ) {
      errors.push(`modes.${difficultyId}.bossLevelBonus must be a non-negative integer`);
    }

    if (
      mode.recruitAffixExcludedActs !== undefined &&
      (!Array.isArray(mode.recruitAffixExcludedActs) ||
        mode.recruitAffixExcludedActs.some((act) => !ENEMY_ACT_GATE_ORDER.includes(act)))
    ) {
      errors.push(`modes.${difficultyId}.recruitAffixExcludedActs must be an array of act ids`);
    }

    if (
      mode.specialXpMultiplier !== undefined &&
      !(Number.isFinite(mode.specialXpMultiplier) && mode.specialXpMultiplier >= 1)
    ) {
      errors.push(`modes.${difficultyId}.specialXpMultiplier must be a number >= 1`);
    }
    if (
      mode.xpUnderdogCap !== undefined &&
      (!Number.isInteger(mode.xpUnderdogCap) || mode.xpUnderdogCap < 0)
    ) {
      errors.push(`modes.${difficultyId}.xpUnderdogCap must be a non-negative integer`);
    }

    for (const key of DIFFICULTY_REQUIRED_KEYS) {
      if (!(key in mode)) errors.push(`modes.${difficultyId} missing required key: ${key}`);
    }
    if (
      mode.rewindGranularity !== undefined &&
      !['action', 'turn'].includes(mode.rewindGranularity)
    )
      errors.push(`modes.${difficultyId}.rewindGranularity must be 'action' or 'turn'`);

    for (const key of DIFFICULTY_REQUIRED_KEYS) {
      const value = mode[key];
      if (key === 'actsIncluded') {
        if (
          !Array.isArray(value) ||
          value.length === 0 ||
          value.some((v) => typeof v !== 'string' || v.length === 0)
        ) {
          errors.push(`modes.${difficultyId}.actsIncluded must be a non-empty string array`);
        }
        continue;
      }
      if (key === 'extendedLevelingEnabled') {
        if (typeof value !== 'boolean')
          errors.push(`modes.${difficultyId}.extendedLevelingEnabled must be boolean`);
        continue;
      }
      if (key === 'statusStaffConfig' || key === 'carryConfig' || key === 'shopCureGating') {
        if (value !== null && !isObject(value)) {
          errors.push(`modes.${difficultyId}.${key} must be null or an object`);
        }
        continue;
      }
      if (!isFiniteNumber(value)) {
        errors.push(`modes.${difficultyId}.${key} must be a finite number`);
      }
    }
    errors.push(...validateBattlePacing(mode, `modes.${difficultyId}`));
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Per-battle staff / siege configs (`perBattle: true`, CasterGear.js): per-act chances
 * between 0 and 1, a non-negative integer maxPerBattle, staff kinds from sleep/silence,
 * a siege weaponName. Configs without `perBattle` are the old per-spawn shape.
 */
function validateCasterGear(mode, path) {
  const errors = [];
  for (const key of ['statusStaffConfig', 'siegeWeaponConfig']) {
    const cfg = mode[key];
    if (!isObject(cfg) || cfg.perBattle !== true) continue;
    for (const act of ['act1', 'act2', 'act3', 'act4', 'postAct', 'finalBoss']) {
      if (cfg[act] === undefined) continue;
      if (!isFiniteNumber(cfg[act]) || cfg[act] < 0 || cfg[act] > 1)
        errors.push(`${path}.${key}.${act} must be a chance between 0 and 1`);
    }
    if (!(Number.isInteger(cfg.maxPerBattle) && cfg.maxPerBattle >= 0))
      errors.push(`${path}.${key}.maxPerBattle must be a non-negative integer`);
    if (key === 'statusStaffConfig') {
      const kinds = cfg.kinds;
      if (
        kinds !== undefined &&
        (!Array.isArray(kinds) ||
          kinds.length === 0 ||
          kinds.some((k) => !['sleep', 'silence'].includes(k)))
      )
        errors.push(`${path}.${key}.kinds must be a non-empty list of sleep/silence`);
    } else if (typeof cfg.weaponName !== 'string' || cfg.weaponName.length === 0) {
      errors.push(`${path}.${key}.weaponName must name the siege tome`);
    }
  }
  return errors;
}

/**
 * Carried items (EnemyCarry.js): every rung has a per-battle config, with a chance between 0
 * and 1 for each of the four acts and the final boss, and a non-negative integer
 * maxPerBattle. A rung that does not carry anything says so with chances of 0, never with
 * a missing config.
 */
function validateCarryConfig(mode, path) {
  const cfg = mode.carryConfig;
  if (!isObject(cfg)) return [`${path}.carryConfig must be an object`];
  const errors = [];
  if (cfg.perBattle !== true) errors.push(`${path}.carryConfig.perBattle must be true`);
  for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
    if (!isFiniteNumber(cfg[act]) || cfg[act] < 0 || cfg[act] > 1)
      errors.push(`${path}.carryConfig.${act} must be a chance between 0 and 1`);
  }
  if (!(Number.isInteger(cfg.maxPerBattle) && cfg.maxPerBattle >= 0))
    errors.push(`${path}.carryConfig.maxPerBattle must be a non-negative integer`);
  return errors;
}

/**
 * Revival Stones (docs/specs/phase3.md 3D): every rung names all four kinds, each a
 * non-negative integer. A rung with none writes zeros; the key is not optional, so a new
 * rung cannot forget that its bosses carry nothing.
 */
function validateRevivalStones(mode, path) {
  const table = mode.revivalStones;
  if (!isObject(table)) return [`${path}.revivalStones must be an object of stone counts`];
  const errors = [];
  for (const kind of REVIVAL_STONE_KINDS) {
    if (!(Number.isInteger(table[kind]) && table[kind] >= 0))
      errors.push(`${path}.revivalStones.${kind} must be a non-negative integer`);
  }
  for (const key of Object.keys(table))
    if (!REVIVAL_STONE_KINDS.includes(key))
      errors.push(`${path}.revivalStones.${key} is not a stone kind`);
  return errors;
}

/** The pacing keys (all optional): routLadder, parInflation, templateWavesRaisePar, villageMinRow. */
function validateBattlePacing(mode, path) {
  const errors = [];
  if (
    mode.parInflation !== undefined &&
    mode.parInflation !== null &&
    !(Number.isInteger(mode.parInflation) && mode.parInflation >= 0)
  )
    errors.push(`${path}.parInflation must be null or a non-negative integer`);
  if (mode.templateWavesRaisePar !== undefined && typeof mode.templateWavesRaisePar !== 'boolean')
    errors.push(`${path}.templateWavesRaisePar must be boolean`);
  errors.push(...validateCasterGear(mode, path));
  errors.push(...validateCarryConfig(mode, path));
  for (const key of ['holdShare', 'objectiveParOffset']) {
    const value = mode[key];
    if (value === undefined || value === null) continue;
    if (!isObject(value)) {
      errors.push(`${path}.${key} must be null or an object keyed by objective`);
      continue;
    }
    // A par offset may name an objectives model's kind (defeat) as well as a legacy string.
    const objectives =
      key === 'holdShare' ? ['seize', 'escape'] : ['rout', 'seize', 'escape', 'defeat'];
    for (const [objective, n] of Object.entries(value)) {
      const at = `${path}.${key}.${objective}`;
      if (!objectives.includes(objective))
        errors.push(`${at} is not a ${objectives.join('/')} objective`);
      if (key === 'holdShare') {
        if (!(isFiniteNumber(n) && n >= 0 && n <= 1))
          errors.push(`${at} must be a share between 0 and 1`);
      } else if (isObject(n)) {
        // A par offset by act: { act4: -2 }.
        for (const [act, v] of Object.entries(n)) {
          if (!ENEMY_ACT_GATE_ORDER.includes(act)) errors.push(`${at}.${act} is not an act id`);
          if (!Number.isInteger(v)) errors.push(`${at}.${act} must be an integer`);
        }
      } else if (!Number.isInteger(n)) {
        errors.push(`${at} must be an integer or an object of integers by act`);
      }
    }
  }
  errors.push(...validateRevivalStones(mode, path));
  const minRows = mode.villageMinRow;
  if (minRows !== undefined && minRows !== null) {
    if (!isObject(minRows)) {
      errors.push(`${path}.villageMinRow must be null or an object keyed by act id`);
    } else {
      for (const [act, row] of Object.entries(minRows)) {
        if (!ENEMY_ACT_GATE_ORDER.includes(act))
          errors.push(`${path}.villageMinRow.${act} is not an act id`);
        if (!(Number.isInteger(row) && row >= 0))
          errors.push(`${path}.villageMinRow.${act} must be a non-negative integer`);
      }
    }
  }
  const ladder = mode.routLadder;
  if (ladder === undefined || ladder === null) return errors;
  if (!isObject(ladder) || !isObject(ladder.acts)) {
    errors.push(`${path}.routLadder must be null or an object with acts`);
    return errors;
  }
  if (!Array.isArray(ladder.xp) || ladder.xp.some((x) => !isFiniteNumber(x) || x < 0 || x > 1))
    errors.push(`${path}.routLadder.xp must be an array of rewards between 0 and 1`);
  for (const key of ['minPlayerDistance', 'minFlankTiles']) {
    if (ladder[key] !== undefined && !(Number.isInteger(ladder[key]) && ladder[key] >= 0))
      errors.push(`${path}.routLadder.${key} must be a non-negative integer`);
  }
  for (const [act, rows] of Object.entries(ladder.acts)) {
    const at = `${path}.routLadder.acts.${act}`;
    if (!ENEMY_ACT_GATE_ORDER.includes(act)) errors.push(`${at} is not an act id`);
    if (!Array.isArray(rows) || rows.length === 0) {
      errors.push(`${at} must be a non-empty array of waves`);
      continue;
    }
    let lastTurn = 0;
    rows.forEach((row, i) => {
      const [min, max] = Array.isArray(row?.count) ? row.count : [];
      if (!Number.isInteger(row?.turn) || row.turn <= lastTurn)
        errors.push(`${at}[${i}].turn must be an integer after the previous wave's`);
      else lastTurn = row.turn;
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min)
        errors.push(`${at}[${i}].count must be [min, max] with 1 <= min <= max`);
      if (row.levels !== undefined && !(Number.isInteger(row.levels) && row.levels >= 0))
        errors.push(`${at}[${i}].levels must be a non-negative integer`);
      if (row.promoted !== undefined && typeof row.promoted !== 'boolean')
        errors.push(`${at}[${i}].promoted must be boolean`);
    });
  }
  return errors;
}

export function resolveDifficultyMode(config, difficultyId = 'normal') {
  const selectedId = DIFFICULTY_IDS.includes(difficultyId) ? difficultyId : 'normal';
  const mode = config?.modes?.[selectedId] || config?.modes?.normal;
  const resolved = {
    ...DIFFICULTY_DEFAULTS,
    ...(isObject(mode) ? mode : {}),
    recruitAffixExcludedActs: [...recruitAffixExclusions(config, selectedId)],
  };
  resolved.actsIncluded =
    Array.isArray(resolved.actsIncluded) && resolved.actsIncluded.length > 0
      ? [...resolved.actsIncluded]
      : [...DIFFICULTY_DEFAULTS.actsIncluded];
  resolved.extendedLevelingEnabled = Boolean(resolved.extendedLevelingEnabled);
  return { id: selectedId, modifiers: resolved };
}
