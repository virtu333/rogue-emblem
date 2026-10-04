// DifficultyEngine.js - Wave 8 difficulty validation and lookup helpers.

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
 * Emperor, as Dusk does now) recorded beatHard, so it still opens Nightfall.
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
  'shopCureGating',
  'goldMultiplier',
  'shopPriceMultiplier',
  'lootQualityShift',
  'deployLimitBonus',
  'xpMultiplier',
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
  shopCureGating: null,
  goldMultiplier: 1,
  shopPriceMultiplier: 1,
  lootQualityShift: 0,
  deployLimitBonus: 0,
  xpMultiplier: 1,
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
});

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
  if (mode.fogChanceBonus > (defaults.fogChanceBonus || 0)) {
    lines.push(`+${Math.round(mode.fogChanceBonus * 100)}% fog chance`);
  }
  if (mode.villageAmbushChance > (defaults.villageAmbushChance || 0)) {
    lines.push(`${Math.round(mode.villageAmbushChance * 100)}% shop ambush chance`);
  }
  if (mode.currencyMultiplier > (defaults.currencyMultiplier ?? 1)) {
    lines.push(`+${Math.round((mode.currencyMultiplier - 1) * 100)}% meta currency`);
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
  if (mode.routLadder?.acts && Object.keys(mode.routLadder.acts).length > 0) {
    lines.push('Rout maps: reinforcement waves every 2 turns');
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
  if (mode.siegeWeaponConfig) {
    const cfg = mode.siegeWeaponConfig;
    const firstAct = ['act1', 'act2', 'act3', 'act4'].find((a) => cfg[a] > 0);
    if (firstAct) {
      const actNum = firstAct.replace('act', '');
      lines.push(`Siege magic from Act ${actNum}+ (max ${cfg.maxPerBattle}/battle)`);
    }
  }
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
      if (key === 'statusStaffConfig' || key === 'shopCureGating') {
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

/** The pacing keys (all optional): routLadder, parInflation, templateWavesRaisePar. */
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
  for (const key of ['holdShare', 'objectiveParOffset']) {
    const value = mode[key];
    if (value === undefined || value === null) continue;
    if (!isObject(value)) {
      errors.push(`${path}.${key} must be null or an object keyed by objective`);
      continue;
    }
    const objectives = key === 'holdShare' ? ['seize', 'escape'] : ['rout', 'seize', 'escape'];
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
