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
