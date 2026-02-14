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

function validateTurnJitter(path, turnJitter, errors) {
  if (!Array.isArray(turnJitter) || turnJitter.length !== 2) {
    errors.push(`${path} must be [minDelta,maxDelta] integers`);
    return;
  }
  const [minDelta, maxDelta] = turnJitter;
  if (!isInteger(minDelta) || !isInteger(maxDelta)) {
    errors.push(`${path} must be [minDelta,maxDelta] integers`);
    return;
  }
  if (minDelta > maxDelta) {
    errors.push(`${path} must satisfy minDelta <= maxDelta`);
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

function validateScriptedWaveSpawn(path, spawn, errors) {
  if (!isObject(spawn)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const knownKeys = new Set(['col', 'row', 'className', 'level', 'sunderWeapon', 'aiMode', 'affixes']);
  if (!hasOnlyKnownKeys(spawn, knownKeys)) {
    errors.push(`${path} contains unknown keys`);
  }

  if (!isInteger(spawn.col) || spawn.col < 0) {
    errors.push(`${path}.col must be a non-negative integer`);
  }
  if (!isInteger(spawn.row) || spawn.row < 0) {
    errors.push(`${path}.row must be a non-negative integer`);
  }

  if (spawn.className !== undefined && (typeof spawn.className !== 'string' || spawn.className.trim() === '')) {
    errors.push(`${path}.className must be a non-empty string when provided`);
  }
  if (spawn.level !== undefined && (!isInteger(spawn.level) || spawn.level <= 0)) {
    errors.push(`${path}.level must be a positive integer when provided`);
  }
  if (spawn.sunderWeapon !== undefined && typeof spawn.sunderWeapon !== 'boolean') {
    errors.push(`${path}.sunderWeapon must be boolean when provided`);
  }
  if (spawn.aiMode !== undefined && (typeof spawn.aiMode !== 'string' || spawn.aiMode.trim() === '')) {
    errors.push(`${path}.aiMode must be a non-empty string when provided`);
  }
  if (spawn.affixes !== undefined) {
    if (!Array.isArray(spawn.affixes) || spawn.affixes.some((value) => typeof value !== 'string' || value.trim() === '')) {
      errors.push(`${path}.affixes must be a string array when provided`);
    }
  }
}

function validateScriptedWave(path, wave, errors) {
  if (!isObject(wave)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const knownKeys = new Set(['turn', 'spawns', 'xpMultiplier']);
  if (!hasOnlyKnownKeys(wave, knownKeys)) {
    errors.push(`${path} contains unknown keys`);
  }

  if (!isInteger(wave.turn) || wave.turn <= 0) {
    errors.push(`${path}.turn must be a positive integer`);
  }

  if (!Array.isArray(wave.spawns) || wave.spawns.length === 0) {
    errors.push(`${path}.spawns must be a non-empty array`);
  } else {
    wave.spawns.forEach((spawn, index) => {
      validateScriptedWaveSpawn(`${path}.spawns[${index}]`, spawn, errors);
    });
  }

  if (wave.xpMultiplier !== undefined) {
    if (typeof wave.xpMultiplier !== 'number' || !Number.isFinite(wave.xpMultiplier) || wave.xpMultiplier < 0 || wave.xpMultiplier > 1) {
      errors.push(`${path}.xpMultiplier must be a finite number in [0,1] when provided`);
    }
  }
}

function validateScriptedWaves(path, scriptedWaves, errors) {
  if (scriptedWaves === undefined) return;
  if (!Array.isArray(scriptedWaves) || scriptedWaves.length === 0) {
    errors.push(`${path} must be a non-empty array when provided`);
    return;
  }
  scriptedWaves.forEach((wave, index) => {
    validateScriptedWave(`${path}[${index}]`, wave, errors);
  });
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
  const knownKeys = new Set([...requiredKeys, 'turnJitter', 'scriptedWaves']);
  for (const key of requiredKeys) {
    if (!(key in reinforcements)) {
      errors.push(`${path}.reinforcements missing required key: ${key}`);
    }
  }
  if (!hasOnlyKnownKeys(reinforcements, knownKeys)) {
    errors.push(`${path}.reinforcements contains unknown keys`);
  }

  const spawnEdges = validateEdges(`${path}.reinforcements.spawnEdges`, reinforcements.spawnEdges, errors);

  const hasScriptedWaves = Array.isArray(reinforcements.scriptedWaves) && reinforcements.scriptedWaves.length > 0;
  if (!Array.isArray(reinforcements.waves)) {
    errors.push(`${path}.reinforcements.waves must be an array`);
  } else if (reinforcements.waves.length === 0 && !hasScriptedWaves) {
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
  if (reinforcements.turnJitter !== undefined) {
    validateTurnJitter(`${path}.reinforcements.turnJitter`, reinforcements.turnJitter, errors);
  }
  validateXpDecay(`${path}.reinforcements.xpDecay`, reinforcements.xpDecay, errors);
  validateScriptedWaves(`${path}.reinforcements.scriptedWaves`, reinforcements.scriptedWaves, errors);
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

function validateCoordPair(path, coord, errors) {
  if (!Array.isArray(coord) || coord.length !== 2 || !coord.every(isInteger) || coord[0] < 0 || coord[1] < 0) {
    errors.push(`${path} must be [col,row] non-negative integers`);
    return false;
  }
  return true;
}

function validateNormalizedRect(path, rect, errors) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(isFiniteNumber)) {
    errors.push(`${path} must be [x1,y1,x2,y2] finite numbers`);
    return false;
  }
  const [x1, y1, x2, y2] = rect;
  if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1 || x1 >= x2 || y1 >= y2) {
    errors.push(`${path} must satisfy 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1`);
    return false;
  }
  return true;
}

function validateHybridArena(path, hybridArena, errors) {
  if (!isObject(hybridArena)) {
    errors.push(`${path} must be an object`);
    return new Map();
  }

  const requiredKeys = new Set(['approachRect', 'arenaOrigin', 'arenaTiles', 'anchors']);
  if (!hasOnlyKnownKeys(hybridArena, requiredKeys)) {
    errors.push(`${path} contains unknown keys`);
  }
  for (const key of requiredKeys) {
    if (!(key in hybridArena)) {
      errors.push(`${path} missing required key: ${key}`);
    }
  }

  validateNormalizedRect(`${path}.approachRect`, hybridArena.approachRect, errors);
  validateCoordPair(`${path}.arenaOrigin`, hybridArena.arenaOrigin, errors);

  let arenaWidth = -1;
  if (!Array.isArray(hybridArena.arenaTiles) || hybridArena.arenaTiles.length === 0) {
    errors.push(`${path}.arenaTiles must be a non-empty 2D array`);
  } else {
    hybridArena.arenaTiles.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length === 0) {
        errors.push(`${path}.arenaTiles[${rowIndex}] must be a non-empty array`);
        return;
      }
      if (arenaWidth === -1) arenaWidth = row.length;
      else if (row.length !== arenaWidth) errors.push(`${path}.arenaTiles must be rectangular`);
      row.forEach((terrainName, colIndex) => {
        if (typeof terrainName !== 'string' || terrainName.trim() === '') {
          errors.push(`${path}.arenaTiles[${rowIndex}][${colIndex}] must be a non-empty terrain name`);
        }
      });
    });
  }

  const anchorsPath = `${path}.anchors`;
  if (!isObject(hybridArena.anchors) || Object.keys(hybridArena.anchors).length === 0) {
    errors.push(`${anchorsPath} must be a non-empty object`);
    return new Map();
  }
  const anchorCoords = new Map();
  for (const [anchorName, coord] of Object.entries(hybridArena.anchors)) {
    if (typeof anchorName !== 'string' || anchorName.trim() === '') {
      errors.push(`${anchorsPath} contains an empty anchor name`);
      continue;
    }
    if (!validateCoordPair(`${anchorsPath}.${anchorName}`, coord, errors)) {
      continue;
    }
    anchorCoords.set(anchorName, `${coord[0]},${coord[1]}`);
  }
  return anchorCoords;
}

function validatePhaseTerrainOverrideSetTile(path, setTile, anchorCoords, errors) {
  if (!isObject(setTile)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const knownKeys = new Set(['coord', 'anchor', 'terrain']);
  if (!hasOnlyKnownKeys(setTile, knownKeys)) {
    errors.push(`${path} contains unknown keys`);
  }

  if (typeof setTile.terrain !== 'string' || setTile.terrain.trim() === '') {
    errors.push(`${path}.terrain must be a non-empty string`);
  }
  const anchors = anchorCoords instanceof Map ? anchorCoords : new Map();

  const hasCoord = Object.prototype.hasOwnProperty.call(setTile, 'coord');
  const hasAnchor = Object.prototype.hasOwnProperty.call(setTile, 'anchor');
  if (hasCoord === hasAnchor) {
    errors.push(`${path} must define exactly one of coord or anchor`);
    return null;
  }

  if (hasCoord) {
    if (!validateCoordPair(`${path}.coord`, setTile.coord, errors)) return null;
    return `${setTile.coord[0]},${setTile.coord[1]}`;
  }

  if (typeof setTile.anchor !== 'string' || setTile.anchor.trim() === '') {
    errors.push(`${path}.anchor must be a non-empty string`);
    return null;
  }
  if (!anchors.has(setTile.anchor)) {
    errors.push(`${path}.anchor references unknown hybridArena anchor: ${setTile.anchor}`);
    return null;
  }
  return anchors.get(setTile.anchor);
}

function validatePhaseTerrainOverrides(path, overrides, anchorCoords, errors) {
  if (overrides === undefined) return;
  if (!Array.isArray(overrides) || overrides.length === 0) {
    errors.push(`${path} must be a non-empty array when provided`);
    return;
  }
  overrides.forEach((override, index) => {
    const overridePath = `${path}[${index}]`;
    if (!isObject(override)) {
      errors.push(`${overridePath} must be an object`);
      return;
    }
    const knownKeys = new Set(['turn', 'setTiles']);
    if (!hasOnlyKnownKeys(override, knownKeys)) {
      errors.push(`${overridePath} contains unknown keys`);
    }
    if (!isInteger(override.turn) || override.turn <= 0) {
      errors.push(`${overridePath}.turn must be a positive integer`);
    }

    if (!Array.isArray(override.setTiles) || override.setTiles.length === 0) {
      errors.push(`${overridePath}.setTiles must be a non-empty array`);
      return;
    }

    const seenTargets = new Set();
    override.setTiles.forEach((setTile, setTileIndex) => {
      const target = validatePhaseTerrainOverrideSetTile(
        `${overridePath}.setTiles[${setTileIndex}]`,
        setTile,
        anchorCoords,
        errors,
      );
      if (target === null) return;
      if (seenTargets.has(target)) {
        errors.push(`${overridePath}.setTiles contains duplicate target tile`);
      }
      seenTargets.add(target);
    });
  });
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

      const hasHybridArena = Object.prototype.hasOwnProperty.call(template, 'hybridArena');
      if (hasHybridArena && template.bossOnly !== true) {
        errors.push(`${path}.bossOnly must be true when hybridArena is provided`);
      }

      let anchorCoords = new Map();
      if (hasHybridArena) {
        anchorCoords = validateHybridArena(`${path}.hybridArena`, template.hybridArena, errors);
      } else if (template.phaseTerrainOverrides !== undefined) {
        errors.push(`${path}.phaseTerrainOverrides requires hybridArena`);
      }
      if (template.phaseTerrainOverrides !== undefined) {
        validatePhaseTerrainOverrides(`${path}.phaseTerrainOverrides`, template.phaseTerrainOverrides, anchorCoords, errors);
      }

      validateReinforcements(path, template, strict, errors, warnings);
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}
