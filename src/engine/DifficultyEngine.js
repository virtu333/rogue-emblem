// DifficultyEngine.js - Wave 8 difficulty validation and lookup helpers.

export const DIFFICULTY_CONTRACT_VERSION = 1;

export const DIFFICULTY_IDS = ['normal', 'hard', 'lunatic'];

export const DIFFICULTY_REQUIRED_KEYS = [
  'enemyStatBonus',
  'enemyCountBonus',
  'enemyEquipTierShift',
  'enemySkillChance',
  'enemyPoisonChance',
  'enemyStatusStaffChance',
  'goldMultiplier',
  'shopPriceMultiplier',
  'lootQualityShift',
  'deployLimitBonus',
  'xpMultiplier',
  'fogChanceBonus',
  'reinforcementTurnOffset',
  'currencyMultiplier',
  'actsIncluded',
  'extendedLevelingEnabled',
];

export const DIFFICULTY_DEFAULTS = Object.freeze({
  label: 'Normal',
  color: '#44cc44',
  enemyStatBonus: 0,
  enemyCountBonus: 0,
  enemyEquipTierShift: 0,
  enemySkillChance: 0,
  enemyPoisonChance: 0,
  enemyStatusStaffChance: 0,
  goldMultiplier: 1,
  shopPriceMultiplier: 1,
  lootQualityShift: 0,
  deployLimitBonus: 0,
  xpMultiplier: 1,
  fogChanceBonus: 0,
  reinforcementTurnOffset: 0,
  currencyMultiplier: 1,
  actsIncluded: ['act1', 'act2', 'act3', 'finalBoss'],
  extendedLevelingEnabled: false,
});

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
  if (mode.enemyCountBonus > (defaults.enemyCountBonus || 0)) {
    lines.push(`+${mode.enemyCountBonus} extra enemies per map`);
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
  if (mode.currencyMultiplier > (defaults.currencyMultiplier ?? 1)) {
    lines.push(`+${Math.round((mode.currencyMultiplier - 1) * 100)}% meta currency`);
  }
  if (mode.extendedLevelingEnabled && !defaults.extendedLevelingEnabled) {
    lines.push('Extended enemy leveling');
  }
  if (mode.enemyPoisonChance > (defaults.enemyPoisonChance || 0)) {
    lines.push(`+${Math.round(mode.enemyPoisonChance * 100)}% enemy poison chance`);
  }
  if (mode.enemyEquipTierShift > (defaults.enemyEquipTierShift || 0)) {
    lines.push(`Enemy weapon tier +${mode.enemyEquipTierShift}`);
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

    for (const key of DIFFICULTY_REQUIRED_KEYS) {
      if (!(key in mode)) errors.push(`modes.${difficultyId} missing required key: ${key}`);
    }

    for (const key of DIFFICULTY_REQUIRED_KEYS) {
      const value = mode[key];
      if (key === 'actsIncluded') {
        if (!Array.isArray(value) || value.length === 0 || value.some(v => typeof v !== 'string' || v.length === 0)) {
          errors.push(`modes.${difficultyId}.actsIncluded must be a non-empty string array`);
        }
        continue;
      }
      if (key === 'extendedLevelingEnabled') {
        if (typeof value !== 'boolean') errors.push(`modes.${difficultyId}.extendedLevelingEnabled must be boolean`);
        continue;
      }
      if (!isFiniteNumber(value)) {
        errors.push(`modes.${difficultyId}.${key} must be a finite number`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function resolveDifficultyMode(config, difficultyId = 'normal') {
  const selectedId = DIFFICULTY_IDS.includes(difficultyId) ? difficultyId : 'normal';
  const mode = config?.modes?.[selectedId] || config?.modes?.normal;
  const resolved = {
    ...DIFFICULTY_DEFAULTS,
    ...(isObject(mode) ? mode : {}),
  };
  resolved.actsIncluded = Array.isArray(resolved.actsIncluded) && resolved.actsIncluded.length > 0
    ? [...resolved.actsIncluded]
    : [...DIFFICULTY_DEFAULTS.actsIncluded];
  resolved.extendedLevelingEnabled = Boolean(resolved.extendedLevelingEnabled);
  return { id: selectedId, modifiers: resolved };
}
