// BlessingEngine.js - Wave 6 blessing validation and deterministic option selection.
// Pure functions, no scene dependency.

export const BLESSINGS_CONTRACT_VERSION = 1;
const VALID_TIERS = new Set([1, 2, 3, 4]);
const REQUIRED_TOP_LEVEL_KEYS = ['version', 'blessings'];
const REQUIRED_BLESSING_KEYS = ['id', 'name', 'tier', 'description', 'boons', 'costs'];
const REQUIRED_EFFECT_KEYS = ['type', 'params'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createSeededRng(seed) {
  let t = (seed >>> 0);
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Validate blessings config shape.
 * @param {object} config
 * @param {{strict?: boolean}} options
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateBlessingsConfig(config, options = {}) {
  const strict = options.strict !== false;
  const errors = [];
  const warnings = [];

  if (!isObject(config)) {
    return { valid: false, errors: ['config must be an object'], warnings };
  }

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in config)) errors.push(`missing top-level key: ${key}`);
  }
  if (errors.length > 0) return { valid: false, errors, warnings };

  if (!Array.isArray(config.blessings)) {
    errors.push('blessings must be an array');
    return { valid: false, errors, warnings };
  }
  if (config.blessings.length === 0) errors.push('blessings must contain at least one entry');

  if (typeof config.version !== 'number') {
    errors.push('version must be a number');
  } else if (config.version !== BLESSINGS_CONTRACT_VERSION) {
    const message = `version mismatch: expected ${BLESSINGS_CONTRACT_VERSION}, got ${config.version}`;
    if (strict) errors.push(message);
    else warnings.push(message);
  }

  const ids = new Set();
  let hasTier1 = false;

  config.blessings.forEach((blessing, idx) => {
    const path = `blessings[${idx}]`;
    if (!isObject(blessing)) {
      errors.push(`${path} must be an object`);
      return;
    }

    for (const key of REQUIRED_BLESSING_KEYS) {
      if (!(key in blessing)) errors.push(`${path} missing required key: ${key}`);
    }
    if (typeof blessing.id !== 'string' || blessing.id.trim() === '') {
      errors.push(`${path}.id must be a non-empty string`);
    } else if (ids.has(blessing.id)) {
      errors.push(`${path}.id duplicate: ${blessing.id}`);
    } else {
      ids.add(blessing.id);
    }
    if (typeof blessing.name !== 'string' || blessing.name.trim() === '') {
      errors.push(`${path}.name must be a non-empty string`);
    }
    if (!VALID_TIERS.has(blessing.tier)) {
      errors.push(`${path}.tier must be one of 1,2,3,4`);
    }
    if (blessing.tier === 1) hasTier1 = true;
    if (typeof blessing.description !== 'string' || blessing.description.trim() === '') {
      errors.push(`${path}.description must be a non-empty string`);
    }
    if (!Array.isArray(blessing.boons) || blessing.boons.length === 0) {
      errors.push(`${path}.boons must be a non-empty array`);
    }
    if (!Array.isArray(blessing.costs)) {
      errors.push(`${path}.costs must be an array`);
    }

    for (const effectKey of ['boons', 'costs']) {
      const effects = blessing[effectKey];
      if (!Array.isArray(effects)) continue;
      effects.forEach((effect, effectIdx) => {
        const effectPath = `${path}.${effectKey}[${effectIdx}]`;
        if (!isObject(effect)) {
          errors.push(`${effectPath} must be an object`);
          return;
        }
        for (const key of REQUIRED_EFFECT_KEYS) {
          if (!(key in effect)) errors.push(`${effectPath} missing required key: ${key}`);
        }
        if (typeof effect.type !== 'string' || effect.type.trim() === '') {
          errors.push(`${effectPath}.type must be a non-empty string`);
        }
        if (!isObject(effect.params)) {
          errors.push(`${effectPath}.params must be an object`);
        }
      });
    }
  });

  if (!hasTier1) {
    errors.push('at least one tier-1 blessing is required');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate and throw on invalid config.
 * @param {object} config
 * @param {{strict?: boolean}} options
 * @returns {object} normalized deep clone
 */
export function assertValidBlessingsConfig(config, options = {}) {
  const result = validateBlessingsConfig(config, options);
  if (!result.valid) {
    throw new Error(`Invalid blessings config: ${result.errors.join('; ')}`);
  }
  return cloneDeep(config);
}

/**
 * Return blessing lookup map by id.
 * @param {object} config
 * @returns {Map<string, object>}
 */
export function buildBlessingIndex(config) {
  const valid = assertValidBlessingsConfig(config);
  const index = new Map();
  for (const blessing of valid.blessings) {
    index.set(blessing.id, blessing);
  }
  return index;
}

function pickWeighted(items, rand) {
  const total = items.reduce((sum, it) => sum + (Number.isFinite(it.weight) ? it.weight : 1), 0);
  if (total <= 0) return items[Math.floor(rand() * items.length)];
  let roll = rand() * total;
  for (const item of items) {
    roll -= Number.isFinite(item.weight) ? item.weight : 1;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Select blessing options deterministically with injected RNG.
 * @param {object} config
 * @param {() => number} rand - returns [0,1)
 * @param {{count?: number, forceTier1?: boolean, allowTier4?: boolean}} options
 * @returns {object[]} selected blessing definitions
 */
export function selectBlessingOptions(config, rand, options = {}) {
  return selectBlessingOptionsWithTelemetry(config, rand, options).selected;
}

/**
 * Select blessing options and include structured selection telemetry.
 * @param {object} config
 * @param {() => number} rand - returns [0,1)
 * @param {{count?: number, forceTier1?: boolean, allowTier4?: boolean}} options
 * @returns {{selected: object[], telemetry: object}}
 */
export function selectBlessingOptionsWithTelemetry(config, rand, options = {}) {
  const valid = assertValidBlessingsConfig(config);
  if (typeof rand !== 'function') {
    throw new Error('selectBlessingOptions requires an RNG function argument');
  }

  const count = Math.max(1, Math.min(4, options.count ?? 3));
  const forceTier1 = options.forceTier1 !== false;
  const allowTier4 = options.allowTier4 !== false;

  const pool = valid.blessings.slice();
  const selected = [];
  const rejectionReasons = [];
  const selectedIds = new Set();

  function violatesExclusion(candidate) {
    const excludes = Array.isArray(candidate.excludes) ? candidate.excludes : [];
    for (const chosenId of selectedIds) {
      const chosen = pool.find(b => b.id === chosenId);
      const chosenExcludes = Array.isArray(chosen?.excludes) ? chosen.excludes : [];
      if (excludes.includes(chosenId) || chosenExcludes.includes(candidate.id)) {
        return `excludes:${chosenId}`;
      }
    }
    return null;
  }

  if (forceTier1) {
    const tier1 = pool.filter(b => b.tier === 1 && !violatesExclusion(b));
    if (tier1.length === 0) {
      throw new Error('cannot force tier1 option: no tier1 blessings available');
    }
    const first = pickWeighted(tier1, rand);
    selected.push(first);
    selectedIds.add(first.id);
  }

  while (selected.length < count) {
    let candidates = pool.filter(b => !selectedIds.has(b.id));
    if (!allowTier4) candidates = candidates.filter(b => b.tier !== 4);
    const filtered = [];
    for (const candidate of candidates) {
      const exclusionReason = violatesExclusion(candidate);
      if (exclusionReason) {
        rejectionReasons.push({ blessingId: candidate.id, reason: exclusionReason });
      } else {
        filtered.push(candidate);
      }
    }
    candidates = filtered;
    if (candidates.length === 0) break;
    const next = pickWeighted(candidates, rand);
    selected.push(next);
    selectedIds.add(next.id);
  }

  return {
    selected: selected.map(cloneDeep),
    telemetry: {
      candidatePoolIds: pool.map(b => b.id),
      chosenIds: selected.map(b => b.id),
      rejectionReasons,
      options: { count, forceTier1, allowTier4 },
    },
  };
}
