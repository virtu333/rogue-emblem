// MapTemplateEngine.js - Map template contract helpers (including reinforcements).

export const REINFORCEMENT_CONTRACT_VERSION = 1;

const TEMPLATE_OBJECTIVES = ['rout', 'seize'];
const VALID_EDGES = new Set(['left', 'right', 'top', 'bottom']);
const DIFFICULTY_IDS = ['normal', 'hard', 'lunatic'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function hasOnlyKnownKeys(obj, knownKeys) {
  return Object.keys(obj).every((key) => knownKeys.has(key));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateEdges(path, edges, errors) {
  if (!Array.isArray(edges) || edges.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return [];
  }
  const normalized = [...new Set(edges)];
  for (const edge of normalized) {
    if (!VALID_EDGES.has(edge)) {
      errors.push(`${path} contains invalid edge: ${edge}`);
    }
  }
  return normalized;
}

function validateReinforcementWave(path, wave, spawnEdges, errors) {
  if (!isObject(wave)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const knownWaveKeys = new Set(['turn', 'count', 'edges']);
  if (!hasOnlyKnownKeys(wave, knownWaveKeys)) {
    errors.push(`${path} contains unknown keys`);
  }

  if (!isInteger(wave.turn) || wave.turn <= 0) {
    errors.push(`${path}.turn must be a positive integer`);
  }

  const count = wave.count;
  if (!Array.isArray(count) || count.length !== 2 || !count.every(isInteger)) {
    errors.push(`${path}.count must be [min,max] integers`);
  } else {
    const [minCount, maxCount] = count;
    if (minCount <= 0 || maxCount <= 0 || minCount > maxCount) {
      errors.push(`${path}.count must have 0 < min <= max`);
    }
  }

  if (wave.edges === undefined) return;
  const waveEdges = validateEdges(`${path}.edges`, wave.edges, errors);
  for (const edge of waveEdges) {
    if (!spawnEdges.includes(edge)) {
      errors.push(`${path}.edges must be a subset of reinforcements.spawnEdges`);
    }
  }
}

function validateTurnOffsets(path, offsets, errors) {
  if (!isObject(offsets)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const required = new Set(DIFFICULTY_IDS);
  if (!hasOnlyKnownKeys(offsets, required)) {
    errors.push(`${path} contains unknown difficulty keys`);
  }
  for (const difficultyId of DIFFICULTY_IDS) {
    if (!isInteger(offsets[difficultyId])) {
      errors.push(`${path}.${difficultyId} must be an integer`);
    }
  }
}

function validateXpDecay(path, xpDecay, errors) {
  if (!Array.isArray(xpDecay) || xpDecay.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  for (let i = 0; i < xpDecay.length; i++) {
    const value = xpDecay[i];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${path}[${i}] must be a finite number in [0,1]`);
      continue;
    }
    if (i > 0 && value > xpDecay[i - 1]) {
      errors.push(`${path} must be non-increasing`);
    }
  }
}

function validateReinforcements(path, template, strict, errors, warnings) {
  const hasVersion = Object.prototype.hasOwnProperty.call(template, 'reinforcementContractVersion');
  const hasConfig = Object.prototype.hasOwnProperty.call(template, 'reinforcements');
  if (hasVersion !== hasConfig) {
    errors.push(`${path} must define both reinforcementContractVersion and reinforcements`);
    return;
  }
  if (!hasVersion) return;

  const version = template.reinforcementContractVersion;
  if (!isInteger(version)) {
    errors.push(`${path}.reinforcementContractVersion must be an integer`);
  } else if (version !== REINFORCEMENT_CONTRACT_VERSION) {
    const msg = `${path}.reinforcementContractVersion mismatch: expected ${REINFORCEMENT_CONTRACT_VERSION}, got ${version}`;
    if (strict) errors.push(msg);
    else warnings.push(msg);
  }

  const reinforcements = template.reinforcements;
  if (!isObject(reinforcements)) {
    errors.push(`${path}.reinforcements must be an object`);
    return;
  }

  const requiredKeys = new Set([
    'spawnEdges',
    'waves',
    'difficultyScaling',
    'turnOffsetByDifficulty',
    'xpDecay',
  ]);
  for (const key of requiredKeys) {
    if (!(key in reinforcements)) {
      errors.push(`${path}.reinforcements missing required key: ${key}`);
    }
  }
  if (!hasOnlyKnownKeys(reinforcements, requiredKeys)) {
    errors.push(`${path}.reinforcements contains unknown keys`);
  }

  const spawnEdges = validateEdges(`${path}.reinforcements.spawnEdges`, reinforcements.spawnEdges, errors);

  if (!Array.isArray(reinforcements.waves) || reinforcements.waves.length === 0) {
    errors.push(`${path}.reinforcements.waves must be a non-empty array`);
  } else {
    reinforcements.waves.forEach((wave, index) => {
      validateReinforcementWave(`${path}.reinforcements.waves[${index}]`, wave, spawnEdges, errors);
    });
  }

  if (typeof reinforcements.difficultyScaling !== 'boolean') {
    errors.push(`${path}.reinforcements.difficultyScaling must be boolean`);
  }

  validateTurnOffsets(`${path}.reinforcements.turnOffsetByDifficulty`, reinforcements.turnOffsetByDifficulty, errors);
  validateXpDecay(`${path}.reinforcements.xpDecay`, reinforcements.xpDecay, errors);
}

function validateZone(path, zone, errors) {
  if (!isObject(zone)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const knownZoneKeys = new Set(['rect', 'terrain', 'role', 'priority']);
  if (!hasOnlyKnownKeys(zone, knownZoneKeys)) {
    errors.push(`${path} contains unknown keys`);
  }

  if (!Array.isArray(zone.rect) || zone.rect.length !== 4 || !zone.rect.every(isFiniteNumber)) {
    errors.push(`${path}.rect must be [x1,y1,x2,y2] finite numbers`);
  } else {
    const [x1, y1, x2, y2] = zone.rect;
    if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1 || x1 >= x2 || y1 >= y2) {
      errors.push(`${path}.rect must satisfy 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1`);
    }
  }

  if (!isObject(zone.terrain) || Object.keys(zone.terrain).length === 0) {
    errors.push(`${path}.terrain must be a non-empty weight object`);
  } else {
    let totalWeight = 0;
    for (const [terrainName, weight] of Object.entries(zone.terrain)) {
      if (typeof terrainName !== 'string' || terrainName.trim() === '') {
        errors.push(`${path}.terrain contains an empty terrain key`);
      }
      if (!isFiniteNumber(weight) || weight <= 0) {
        errors.push(`${path}.terrain["${terrainName}"] must be a positive number`);
      } else {
        totalWeight += weight;
      }
    }
    if (!(totalWeight > 0)) {
      errors.push(`${path}.terrain total weight must be > 0`);
    }
  }

  if (zone.role !== undefined && (typeof zone.role !== 'string' || zone.role.trim() === '')) {
    errors.push(`${path}.role must be a non-empty string when provided`);
  }

  if (zone.priority !== undefined && !isFiniteNumber(zone.priority)) {
    errors.push(`${path}.priority must be a finite number when provided`);
  }
}

export function validateMapTemplatesConfig(config, options = {}) {
  const strict = options.strict !== false;
  const errors = [];
  const warnings = [];

  if (!isObject(config)) {
    return { valid: false, errors: ['map templates config must be an object'], warnings };
  }

  const seenIds = new Set();

  for (const objective of TEMPLATE_OBJECTIVES) {
    const templates = config[objective];
    if (!Array.isArray(templates)) {
      errors.push(`${objective} must be an array`);
      continue;
    }
    if (templates.length === 0) {
      errors.push(`${objective} must include at least one template`);
    }

    templates.forEach((template, index) => {
      const path = `${objective}[${index}]`;
      if (!isObject(template)) {
        errors.push(`${path} must be an object`);
        return;
      }

      if (typeof template.id !== 'string' || template.id.trim() === '') {
        errors.push(`${path}.id must be a non-empty string`);
      } else if (seenIds.has(template.id)) {
        errors.push(`${path}.id duplicate: ${template.id}`);
      } else {
        seenIds.add(template.id);
      }

      if (!Array.isArray(template.zones) || template.zones.length === 0) {
        errors.push(`${path}.zones must be a non-empty array`);
      } else {
        template.zones.forEach((zone, zoneIndex) => {
          validateZone(`${path}.zones[${zoneIndex}]`, zone, errors);
        });
      }

      if (template.acts !== undefined) {
        if (!Array.isArray(template.acts) || template.acts.length === 0 || template.acts.some((act) => typeof act !== 'string' || act.length === 0)) {
          errors.push(`${path}.acts must be a non-empty string array when provided`);
        }
      }

      if (template.biome !== undefined && (typeof template.biome !== 'string' || template.biome.trim() === '')) {
        errors.push(`${path}.biome must be a non-empty string when provided`);
      }

      validateReinforcements(path, template, strict, errors, warnings);
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}
