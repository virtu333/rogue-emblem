// MapGenerator.js — Procedural map generation from zone-based templates
// Pure functions, no Phaser dependency.

import {
  TERRAIN,
  DEPLOY_LIMITS,
  ENEMY_COUNT_OFFSET,
  SUNDER_ELIGIBLE_PROFS,
  POISON_ELIGIBLE_PROFS,
  STATUS_STAFF_ELIGIBLE_CLASSES,
  SIEGE_ELIGIBLE_CLASSES,
  ACT_BIOME_WEIGHTS,
} from '../utils/constants.js';
import { assignAffixesToEnemySpawns } from './AffixEngine.js';
import { createScopedLogger } from '../utils/logger.js';

const DEBUG_MAP_GEN = false;
const mapGenLog = createScopedLogger('MapGen', { debug: DEBUG_MAP_GEN });

/**
 * Generate a full battle configuration from params + game data.
 * @param {Object} params - { act, objective, sizeKey? (optional override), difficultyMod?, enemyCountBonus? }
 * @param {Object} deps - { terrain, classes, weapons, skills, mapSizes, mapTemplates, enemies }
 * @returns {Object} battleConfig
 */
export function generateBattle(params, deps) {
  const {
    act = 'act1',
    objective = 'rout',
    difficultyMod = 1.0,
    enemyCountBonus = 0,
    isRecruitBattle = false,
    deployCount,
    levelRange,
    row,
    isBoss,
    templateId: preAssignedTemplateId,
    firstBattleFightersOnly = false,
    usedRecruitNames = {},
    enemyPoisonChance = 0,
    statusStaffConfig = null,
    siegeWeaponConfig = null,
    isAmbush = false,
    enemyLevelBonus = 0,
    enemyCountBase = 0,
  } = params;
  const { terrain, mapSizes, mapTemplates, enemies, recruits, classes, weapons } = deps;

  // 1. Pick map size
  const sizeEntry = pickMapSize(act, mapSizes);
  const [cols, rows] = sizeEntry.mapSize.split('x').map(Number);

  // 2. Pick template (use pre-assigned templateId if available)
  const preAssignedTemplate = preAssignedTemplateId
    ? findTemplateById(preAssignedTemplateId, mapTemplates)
    : null;
  const preAssignedAllowed =
    preAssignedTemplate &&
    isTemplateAllowedForAct(preAssignedTemplate, act) &&
    isTemplateAllowedForObjective(preAssignedTemplate, objective, mapTemplates);
  // Only roll biome when we need to pick a fresh template (preserves RNG for seeded pre-assigned paths)
  const template =
    preAssignedTemplateId && preAssignedAllowed
      ? preAssignedTemplate
      : pickTemplate(objective, mapTemplates, act, { isBoss, biome: rollBiome(act) });
  if (!template) {
    throw new Error(`No valid map template found for objective "${objective}" in act "${act}"`);
  }

  // 3. Generate terrain
  const mapLayout = generateTerrain(template, cols, rows, terrain);
  const resolvedHybridAnchors = resolveHybridAnchors(template.hybridArena, cols, rows);
  applyHybridArenaOverlay(mapLayout, template.hybridArena, cols, rows, terrain);

  // 4. Place features (Throne for Seize)
  let thronePos = null;
  if (template.features) {
    for (const feat of template.features) {
      const pos = resolveFeaturePosition(feat.position, cols, rows);
      const idx = terrainNameToIndex(feat.type, terrain);
      if (idx !== -1) {
        mapLayout[pos.row][pos.col] = idx;
        if (feat.type === 'Throne') thronePos = pos;
      }
    }
  }

  // 5. Player spawns
  const spawnCount = deployCount || DEPLOY_LIMITS[act]?.max || 4;
  const playerSpawns = placeSpawns(
    mapLayout,
    template,
    cols,
    rows,
    'playerSpawn',
    terrain,
    spawnCount,
  );

  // 6. Enemy composition
  const basePool = enemies.pools[act];
  const pool = firstBattleFightersOnly
    ? { ...basePool, base: ['Fighter'], promoted: [] }
    : basePool;
  const rolledEnemyCount = rollEnemyCount({
    deployCount: spawnCount,
    act,
    row,
    isBoss,
    tiles: sizeEntry.tiles,
    densityCap: enemies.enemyCountByTiles,
    enemyCountBonus,
    enemyCountBase,
    isAmbush,
  });
  const recruitBonus = isRecruitBattle ? 1 : 0;
  const densityCap = getEnemyDensityCapByTiles(sizeEntry.tiles, enemies.enemyCountByTiles);
  const enemyCount = Math.min(rolledEnemyCount + recruitBonus, densityCap);
  // Apply difficulty-driven level bonus (supports positive and negative offsets)
  const baseLevelRange = levelRange || pool.levelRange;
  const adjustedLevelRange =
    enemyLevelBonus !== 0
      ? [
          Math.max(1, baseLevelRange[0] + enemyLevelBonus),
          Math.max(1, baseLevelRange[1] + enemyLevelBonus),
        ]
      : baseLevelRange;
  let enemySpawns = generateEnemies(
    mapLayout,
    template,
    cols,
    rows,
    terrain,
    pool,
    enemyCount,
    objective,
    act,
    enemies.bosses,
    thronePos,
    adjustedLevelRange,
    classes,
    { enemyPoisonChance, statusStaffConfig, siegeWeaponConfig },
  );
  enemySpawns = assignAffixesToEnemySpawns(enemySpawns, {
    affixConfig: deps.affixes,
    difficultyId: params.difficultyId || 'normal',
    act,
  });

  // 7. NPC spawn for recruit battles
  let npcSpawn = null;
  if (isRecruitBattle && recruits && (recruits[act] || recruits.namePool)) {
    // If recruits.namePool exists, we're using the new structure.
    const pool = recruits[act] ? { ...recruits[act], namePool: recruits.namePool } : null;
    if (pool) {
      npcSpawn = generateNPCSpawn(
        mapLayout,
        cols,
        rows,
        terrain,
        playerSpawns,
        enemySpawns,
        pool,
        template,
        classes,
        deps.weapons,
        usedRecruitNames,
      );
    }
  }

  // 7b. Recruit guardian elite for Hard/Lunatic
  if (
    npcSpawn &&
    params.recruitGuardianChance > 0 &&
    Math.random() < params.recruitGuardianChance
  ) {
    const guardianPool = enemies.recruitGuardians?.[act];
    if (guardianPool?.length > 0 && enemySpawns.length < densityCap) {
      const guardianDef = guardianPool[Math.floor(Math.random() * guardianPool.length)];
      const guardianMoveType =
        classes?.find((c) => c.name === guardianDef.className)?.moveType || 'Infantry';
      const occupied = new Set([
        ...playerSpawns.map((s) => `${s.col},${s.row}`),
        ...enemySpawns.map((s) => `${s.col},${s.row}`),
        `${npcSpawn.col},${npcSpawn.row}`,
      ]);
      const guardianPos = findAdjacentPassableTile(
        mapLayout,
        cols,
        rows,
        terrain,
        npcSpawn,
        occupied,
        guardianMoveType,
      );
      if (guardianPos) {
        enemySpawns.push({
          className: guardianDef.className,
          level: guardianDef.level,
          col: guardianPos.col,
          row: guardianPos.row,
          isRecruitGuardian: true,
          name: guardianDef.name,
          guardianClampPos: { col: npcSpawn.col, row: npcSpawn.row },
        });
      }
    }
  }

  // 8. Ensure reachability from player spawn to all enemies + throne + NPC
  const reachTargets = [...enemySpawns];
  if (npcSpawn) reachTargets.push(npcSpawn);
  ensureReachability(mapLayout, cols, rows, terrain, playerSpawns[0], reachTargets, thronePos);

  // Ensure bridges if river template
  if (template.minBridges || template.minBridgesByAct) {
    let bridgeCount = template.minBridges || 2;
    const actOverride = template.minBridgesByAct?.[act];
    if (actOverride != null) {
      bridgeCount = Array.isArray(actOverride)
        ? actOverride[0] + Math.floor(Math.random() * (actOverride[1] - actOverride[0] + 1))
        : actOverride;
    }
    ensureBridges(mapLayout, cols, rows, terrain, bridgeCount);
  }

  ensureCavalryAdvanceGuarantees({
    mapLayout,
    cols,
    rows,
    terrainData: terrain,
    playerSpawns,
    enemySpawns,
    npcSpawn,
    objective,
    thronePos,
  });

  const reinforcementConfig = cloneReinforcementConfig(template, {
    act,
    difficultyId: params.difficultyId || 'normal',
  });
  const hybridConfig = cloneHybridConfig(template, resolvedHybridAnchors);

  return {
    mapLayout,
    cols,
    rows,
    objective,
    biome: template.biome || null,
    playerSpawns,
    enemySpawns,
    npcSpawn,
    thronePos,
    templateId: template.id,
    ...reinforcementConfig,
    ...hybridConfig,
  };
}

// --- Map size selection ---

function pickMapSize(act, mapSizes) {
  // Map act to phase prefix
  const prefixMap = {
    act1: 'Act 1',
    act2: 'Act 2',
    act3: 'Act 3',
    act4: 'Act 4',
    postAct: 'Post-Act',
    finalBoss: 'Final Boss',
  };
  const prefix = prefixMap[act] || 'Act 1';
  const candidates = mapSizes.filter((s) => s.phase.startsWith(prefix));
  if (candidates.length === 0) return mapSizes[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// --- Template selection ---

function isTemplateAllowedForAct(template, act) {
  return !Array.isArray(template.acts) || template.acts.includes(act);
}

export function filterTemplatesByAct(pool, act) {
  if (!Array.isArray(pool)) return [];
  return pool.filter((template) => isTemplateAllowedForAct(template, act));
}

function isTemplateAllowedForBoss(template, isBoss = false) {
  return !template?.bossOnly || isBoss === true;
}

/**
 * Roll a biome from weighted probabilities for a given act.
 * @param {string} act - e.g. 'act1', 'act2'
 * @param {Object} [biomeWeights] - override weights, defaults to ACT_BIOME_WEIGHTS[act]
 * @returns {string} biome name (e.g. 'grassland', 'castle')
 */
export function rollBiome(act, biomeWeights = null) {
  const weights = biomeWeights || ACT_BIOME_WEIGHTS[act];
  if (!weights) return 'grassland';
  const entries = Object.entries(weights);
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight <= 0) return 'grassland';
  let roll = Math.random() * totalWeight;
  for (const [biome, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return biome;
  }
  return entries[entries.length - 1][0];
}

/**
 * Get the effective biome of a template. Templates without a biome field are 'grassland'.
 */
export function getTemplateBiome(template) {
  return template?.biome || 'grassland';
}

/**
 * Filter templates to those matching a target biome.
 * Falls back to the full pool if no templates match (graceful degradation).
 */
function filterByBiome(pool, biome) {
  if (!biome) return pool;
  const biomeMatches = pool.filter((t) => getTemplateBiome(t) === biome);
  return biomeMatches.length > 0 ? biomeMatches : pool;
}

export function pickTemplate(objective, mapTemplates, act = null, options = {}) {
  const { isBoss = false, biome = null } = options;
  const pool = mapTemplates[objective];
  if (!pool || pool.length === 0) {
    return null;
  }
  const filteredPool = act ? filterTemplatesByAct(pool, act) : pool;
  const biomeFilteredPool = filterByBiome(filteredPool, biome);
  const bossFilteredPool = biomeFilteredPool.filter((template) =>
    isTemplateAllowedForBoss(template, isBoss),
  );
  const fallbackBossFilteredPool = pool.filter((template) =>
    isTemplateAllowedForBoss(template, isBoss),
  );
  const sourcePool = bossFilteredPool.length > 0 ? bossFilteredPool : fallbackBossFilteredPool;
  if (sourcePool.length === 0) return null;
  return sourcePool[Math.floor(Math.random() * sourcePool.length)];
}

function isTemplateAllowedForObjective(template, objective, mapTemplates) {
  const pool = mapTemplates?.[objective];
  if (!Array.isArray(pool)) return false;
  return pool.some((candidate) => candidate?.id === template.id);
}

function findTemplateById(templateId, mapTemplates) {
  for (const pool of Object.values(mapTemplates)) {
    if (!Array.isArray(pool)) continue;
    const found = pool.find((t) => t.id === templateId);
    if (found) return found;
  }
  return null;
}

const ACT_GATE_ORDER = ['act1', 'act2', 'act3', 'act4'];

function meetsActThreshold(currentAct, requiredAct) {
  const ci = ACT_GATE_ORDER.indexOf(currentAct);
  const ri = ACT_GATE_ORDER.indexOf(requiredAct);
  return ci !== -1 && ri !== -1 && ci >= ri;
}

function cloneReinforcementConfig(template, { act = null, difficultyId = 'normal' } = {}) {
  if (!template || !template.reinforcements) return {};

  const gating = template.reinforcements.minActByDifficulty;
  if (gating) {
    const minAct = gating[difficultyId];
    if (!minAct || !meetsActThreshold(act, minAct)) {
      return {};
    }
  }

  const clone = {
    reinforcementContractVersion: template.reinforcementContractVersion,
    reinforcements: JSON.parse(JSON.stringify(template.reinforcements)),
  };

  const r = clone.reinforcements;

  // Merge act-specific turn offset (e.g. hard act3 gets extra -1)
  if (r.actTurnOffset !== undefined) {
    if (!r.actTurnOffset || typeof r.actTurnOffset !== 'object' || Array.isArray(r.actTurnOffset)) {
      console.warn('[MapGenerator] actTurnOffset is not an object — skipping merge');
    } else {
      const perAct = r.actTurnOffset[difficultyId];
      if (perAct !== undefined) {
        if (!perAct || typeof perAct !== 'object' || Array.isArray(perAct)) {
          console.warn(
            `[MapGenerator] actTurnOffset["${difficultyId}"] is not an object — skipping merge`,
          );
        } else {
          const extra = perAct[act];
          if (typeof extra === 'number' && r.turnOffsetByDifficulty) {
            r.turnOffsetByDifficulty[difficultyId] =
              (r.turnOffsetByDifficulty[difficultyId] || 0) + extra;
          }
        }
      }
    }
  }

  // Merge extra waves for this difficulty
  if (r.extraWavesByDifficulty !== undefined) {
    if (
      !r.extraWavesByDifficulty ||
      typeof r.extraWavesByDifficulty !== 'object' ||
      Array.isArray(r.extraWavesByDifficulty)
    ) {
      console.warn('[MapGenerator] extraWavesByDifficulty is not an object — skipping merge');
    } else {
      const extras = r.extraWavesByDifficulty[difficultyId];
      if (extras !== undefined && !Array.isArray(extras)) {
        console.warn(
          `[MapGenerator] extraWavesByDifficulty["${difficultyId}"] is not an array — skipping merge`,
        );
      } else if (Array.isArray(extras)) {
        r.waves = r.waves.concat(extras);
      }
    }
  }

  // Strip merge-only fields from returned config
  delete r.actTurnOffset;
  delete r.extraWavesByDifficulty;

  return clone;
}

function cloneHybridConfig(template, resolvedHybridAnchors) {
  if (!template || !template.hybridArena) return {};
  return {
    hybridArena: JSON.parse(JSON.stringify(template.hybridArena)),
    hybridAnchors: JSON.parse(JSON.stringify(resolvedHybridAnchors || {})),
    phaseTerrainOverrides: JSON.parse(JSON.stringify(template.phaseTerrainOverrides || [])),
  };
}

function resolveHybridAnchors(hybridArena, cols, rows) {
  if (!hybridArena || !hybridArena.anchors) return null;
  const resolved = {};
  for (const [anchorName, coord] of Object.entries(hybridArena.anchors)) {
    if (!Array.isArray(coord) || coord.length !== 2 || !coord.every(Number.isInteger)) {
      throw new Error(`hybridArena anchor "${anchorName}" must be [col,row] integers`);
    }
    const [col, row] = coord;
    if (col < 0 || row < 0 || col >= cols || row >= rows) {
      throw new Error(`hybridArena anchor "${anchorName}" is out of bounds`);
    }
    resolved[anchorName] = { col, row };
  }
  return resolved;
}

function applyHybridArenaOverlay(mapLayout, hybridArena, cols, rows, terrainData) {
  if (!hybridArena) return;
  const arenaTiles = hybridArena.arenaTiles;
  const arenaOrigin = hybridArena.arenaOrigin;
  if (
    !Array.isArray(arenaTiles) ||
    arenaTiles.length === 0 ||
    !Array.isArray(arenaOrigin) ||
    arenaOrigin.length !== 2
  ) {
    throw new Error('hybridArena is malformed');
  }

  const [originCol, originRow] = arenaOrigin;
  const overlayRows = arenaTiles.length;
  const overlayCols = arenaTiles[0]?.length || 0;
  if (
    originCol < 0 ||
    originRow < 0 ||
    originCol + overlayCols > cols ||
    originRow + overlayRows > rows
  ) {
    throw new Error('hybridArena overlay exceeds map bounds');
  }

  for (let r = 0; r < overlayRows; r++) {
    const row = arenaTiles[r];
    if (!Array.isArray(row) || row.length !== overlayCols) {
      throw new Error('hybridArena arenaTiles must be rectangular');
    }
    for (let c = 0; c < overlayCols; c++) {
      const terrainName = row[c];
      const terrainIndex = terrainNameToIndex(terrainName, terrainData);
      if (terrainIndex === -1) {
        throw new Error(`hybridArena references unknown terrain: ${terrainName}`);
      }
      mapLayout[originRow + r][originCol + c] = terrainIndex;
    }
  }
}

function applyPhaseOverrideToLayout(mapLayout, override, resolvedAnchors, terrainData) {
  if (!override || !Array.isArray(override.setTiles)) return;
  for (const setTile of override.setTiles) {
    const target = Array.isArray(setTile.coord)
      ? { col: setTile.coord[0], row: setTile.coord[1] }
      : resolvedAnchors?.[setTile.anchor];
    if (!target || !Number.isInteger(target.col) || !Number.isInteger(target.row)) {
      throw new Error('phaseTerrainOverrides target could not be resolved');
    }
    const terrainIndex = terrainNameToIndex(setTile.terrain, terrainData);
    if (terrainIndex === -1) {
      throw new Error(`phaseTerrainOverrides references unknown terrain: ${setTile.terrain}`);
    }
    if (
      target.row < 0 ||
      target.row >= mapLayout.length ||
      target.col < 0 ||
      target.col >= mapLayout[0].length
    ) {
      throw new Error('phaseTerrainOverrides target is out of bounds');
    }
    mapLayout[target.row][target.col] = terrainIndex;
  }
}

// --- Terrain generation ---

// Max forts per map (Throne excluded — placed by features, not random gen)
const MAX_FORTS = 4;
const CAVALRY_CARVE_MAX_CONVERSIONS = 16;

function generateTerrain(template, cols, rows, terrainData) {
  // Initialize with Plain
  const map = [];
  for (let r = 0; r < rows; r++) {
    map[r] = new Array(cols).fill(TERRAIN.Plain);
  }

  const approachBounds = resolveNormalizedRectBounds(
    template?.hybridArena?.approachRect,
    cols,
    rows,
  );
  if (template?.hybridArena && !approachBounds) {
    throw new Error('hybridArena.approachRect is malformed');
  }

  // Sort zones by priority ascending (lower priority filled first, higher overwrites)
  const sorted = [...template.zones].sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for (const zone of sorted) {
    const [x1, y1, x2, y2] = zone.rect;
    let startCol = Math.floor(x1 * cols);
    let endCol = Math.min(Math.ceil(x2 * cols), cols);
    let startRow = Math.floor(y1 * rows);
    let endRow = Math.min(Math.ceil(y2 * rows), rows);

    // Hybrid templates proceduralize only within the declared approach region.
    if (approachBounds) {
      startCol = Math.max(startCol, approachBounds.startCol);
      endCol = Math.min(endCol, approachBounds.endCol);
      startRow = Math.max(startRow, approachBounds.startRow);
      endRow = Math.min(endRow, approachBounds.endRow);
    }
    if (startCol >= endCol || startRow >= endRow) continue;

    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const name = weightedRandom(zone.terrain);
        const idx = terrainNameToIndex(name, terrainData);
        if (idx !== -1) map[r][c] = idx;
      }
    }
  }

  // Cap fort count — convert excess forts to Plain (random removal)
  capTerrainCount(map, TERRAIN.Fort, MAX_FORTS);

  return map;
}

function resolveNormalizedRectBounds(rect, cols, rows) {
  if (
    !Array.isArray(rect) ||
    rect.length !== 4 ||
    rect.some((v) => typeof v !== 'number' || !Number.isFinite(v))
  ) {
    return null;
  }
  const [x1, y1, x2, y2] = rect;
  if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1 || x1 >= x2 || y1 >= y2) {
    return null;
  }
  return {
    startCol: Math.floor(x1 * cols),
    endCol: Math.min(Math.ceil(x2 * cols), cols),
    startRow: Math.floor(y1 * rows),
    endRow: Math.min(Math.ceil(y2 * rows), rows),
  };
}

function capTerrainCount(map, terrainIdx, maxCount) {
  const positions = [];
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[r].length; c++) {
      if (map[r][c] === terrainIdx) positions.push({ r, c });
    }
  }
  // Shuffle and remove excess
  while (positions.length > maxCount) {
    const i = Math.floor(Math.random() * positions.length);
    const { r, c } = positions[i];
    map[r][c] = TERRAIN.Plain;
    positions.splice(i, 1);
  }
}

// --- Feature positioning ---

function resolveFeaturePosition(position, cols, rows) {
  switch (position) {
    case 'center':
      return { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
    case 'right':
      return { col: cols - 3, row: Math.floor(rows / 2) };
    case 'topRight':
      return { col: cols - 3, row: Math.floor(rows * 0.3) };
    case 'bottomRight':
      return { col: cols - 3, row: Math.floor(rows * 0.7) };
    default:
      return { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  }
}

// --- Spawn placement ---

function placeSpawns(mapLayout, template, cols, rows, role, terrainData, count) {
  // Find the zone for this role
  const zone = template.zones.find((z) => z.role === role);
  if (!zone) {
    // Fallback: leftmost columns for player, rightmost for enemy
    const startCol = role === 'playerSpawn' ? 0 : cols - 3;
    const endCol = role === 'playerSpawn' ? 3 : cols;
    return findPassableTiles(mapLayout, startCol, endCol, 0, rows, terrainData, count);
  }

  const [x1, y1, x2, y2] = zone.rect;
  const startCol = Math.floor(x1 * cols);
  const endCol = Math.min(Math.ceil(x2 * cols), cols);
  const startRow = Math.floor(y1 * rows);
  const endRow = Math.min(Math.ceil(y2 * rows), rows);

  return findPassableTiles(mapLayout, startCol, endCol, startRow, endRow, terrainData, count);
}

function findPassableTiles(mapLayout, startCol, endCol, startRow, endRow, terrainData, count) {
  const zoneWidth = Math.max(0, endCol - startCol);
  const zoneHeight = Math.max(0, endRow - startRow);
  const zoneCapacity = zoneWidth * zoneHeight;
  const targetCount = Math.min(Math.max(0, count), zoneCapacity);
  if (targetCount === 0) return [];

  const candidates = [];
  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      if (isPassable(terrainData, mapLayout[r][c], 'Infantry')) {
        candidates.push({ col: c, row: r });
      }
    }
  }

  // Shuffle and take up to count
  shuffleArray(candidates);
  const spawns = [];
  const used = new Set();
  for (const pos of candidates) {
    if (spawns.length >= targetCount) break;
    const key = `${pos.col},${pos.row}`;
    if (!used.has(key)) {
      used.add(key);
      spawns.push(pos);
    }
  }

  // Fallback: deterministically fill remaining tiles in-zone by forcing them to Plain.
  if (spawns.length < targetCount) {
    const remainingTiles = [];
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const key = `${c},${r}`;
        if (!used.has(key)) remainingTiles.push({ col: c, row: r });
      }
    }
    shuffleArray(remainingTiles);
    const needed = targetCount - spawns.length;
    for (let i = 0; i < needed && i < remainingTiles.length; i++) {
      const pos = remainingTiles[i];
      mapLayout[pos.row][pos.col] = TERRAIN.Plain;
      used.add(`${pos.col},${pos.row}`);
      spawns.push(pos);
    }
  }

  return spawns;
}

// --- Terrain-aware spawn scoring ---

/**
 * Score a candidate tile for enemy spawn placement based on terrain affinity.
 * Returns 0 for impassable tiles (never spawn), >= 1 for valid tiles.
 */
function scoreSpawnTile(tile, unit, terrainData, mapLayout, cols, classData) {
  const terrainIdx = mapLayout[tile.row][tile.col];
  const t = terrainData[terrainIdx];
  if (!t) return 0;

  const cd = classData?.find((c) => c.name === unit.className);
  const moveType = cd?.moveType || 'Infantry';

  // Passability check
  const cost = t.moveCost[moveType];
  if (cost === '--' || isNaN(parseInt(cost))) return 0;

  let score = 1; // base score

  const name = t.name;

  // Fort/Throne: all units like defensive tiles
  if (name === 'Fort' || name === 'Throne') {
    score += 3;
  }

  // Forest/Mountain affinity
  if (name === 'Forest' || name === 'Mountain') {
    if (moveType === 'Infantry' || moveType === 'Armored') {
      score += 2;
    } else if (moveType === 'Cavalry') {
      score -= 2;
    }
  }

  // Plain bonus for Cavalry
  if (name === 'Plain' && moveType === 'Cavalry') {
    score += 1;
  }

  // Adjacent wall bonus (defensive positioning near chokepoints)
  const mapRows = mapLayout.length;
  const adj = [
    { col: tile.col - 1, row: tile.row },
    { col: tile.col + 1, row: tile.row },
    { col: tile.col, row: tile.row - 1 },
    { col: tile.col, row: tile.row + 1 },
  ];
  for (const n of adj) {
    if (n.col >= 0 && n.col < cols && n.row >= 0 && n.row < mapRows) {
      if (mapLayout[n.row][n.col] === TERRAIN.Wall) {
        score += 1;
      }
    }
  }

  // Floor at 1 for passable tiles
  return Math.max(1, score);
}

/**
 * Weighted random selection from an array of { item, weight } entries.
 * Consumes one Math.random() call.
 */
function weightedPick(entries) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return entries[entries.length - 1].item;
}

// --- Anchor point resolution ---

/**
 * Resolve anchor position names to tile coordinates.
 * Returns array of { col, row } for each anchor, or empty array if unresolvable.
 */
function resolveAnchorPositions(anchor, mapLayout, cols, rows, terrainData, thronePos) {
  const tiles = [];
  const count = anchor.count || 1;

  switch (anchor.position) {
    case 'throne':
      if (thronePos) tiles.push({ col: thronePos.col, row: thronePos.row });
      break;

    case 'center_gap': {
      // Find passable tiles in the center gap of the map (middle Y band, middle X)
      const midRow = Math.floor(rows / 2);
      const midCol = Math.floor(cols / 2);
      // Search outward from center for passable tiles
      for (let dr = 0; dr <= 2 && tiles.length < count; dr++) {
        for (let dc = 0; dc <= 2 && tiles.length < count; dc++) {
          for (const [sr, sc] of [
            [midRow + dr, midCol + dc],
            [midRow - dr, midCol - dc],
            [midRow + dr, midCol - dc],
            [midRow - dr, midCol + dc],
          ]) {
            if (sr >= 0 && sr < rows && sc >= 0 && sc < cols && tiles.length < count) {
              if (isPassable(terrainData, mapLayout[sr][sc], 'Infantry')) {
                if (!tiles.some((t) => t.col === sc && t.row === sr)) {
                  tiles.push({ col: sc, row: sr });
                }
              }
            }
          }
        }
      }
      break;
    }

    case 'bridge_ends': {
      // Find tiles adjacent to bridges (on the enemy side)
      for (let r = 0; r < rows && tiles.length < count; r++) {
        for (let c = 0; c < cols && tiles.length < count; c++) {
          if (mapLayout[r][c] === TERRAIN.Bridge) {
            // Check right-side neighbor (enemy side)
            const nc = c + 1;
            if (
              nc < cols &&
              isPassable(terrainData, mapLayout[r][nc], 'Infantry') &&
              mapLayout[r][nc] !== TERRAIN.Water
            ) {
              if (!tiles.some((t) => t.col === nc && t.row === r)) {
                tiles.push({ col: nc, row: r });
              }
            }
          }
        }
      }
      break;
    }

    case 'gate_adjacent': {
      // Find passable tiles adjacent to wall formations (gate = gap in walls)
      const midRow = Math.floor(rows / 2);
      // Search near the castle area (right side) for passable tiles adjacent to walls
      for (
        let r = Math.max(0, midRow - 3);
        r <= Math.min(rows - 1, midRow + 3) && tiles.length < count;
        r++
      ) {
        for (let c = Math.floor(cols * 0.5); c < cols && tiles.length < count; c++) {
          if (!isPassable(terrainData, mapLayout[r][c], 'Infantry')) continue;
          // Check if adjacent to a wall
          const adj = [
            { col: c - 1, row: r },
            { col: c + 1, row: r },
            { col: c, row: r - 1 },
            { col: c, row: r + 1 },
          ];
          const nearWall = adj.some(
            (n) =>
              n.col >= 0 &&
              n.col < cols &&
              n.row >= 0 &&
              n.row < rows &&
              mapLayout[n.row][n.col] === TERRAIN.Wall,
          );
          if (nearWall) {
            tiles.push({ col: c, row: r });
          }
        }
      }
      break;
    }

    default:
      break;
  }

  return tiles.slice(0, count);
}

/**
 * Select a class name for an anchor enemy based on anchor.unit spec.
 */
function resolveAnchorUnitClass(anchor, pool, spawns) {
  switch (anchor.unit) {
    case 'highest_level':
      // Will be placed with max level from pool
      return null; // use pool default, level handled separately
    case 'boss_or_strongest':
      return null; // boss already placed by seize logic; skip
    case 'lance_user': {
      // Find a lance-using class from pool
      const lanceClasses = [...pool.base, ...pool.promoted].filter(
        (c) =>
          c === 'Cavalier' ||
          c === 'Knight' ||
          c === 'Soldier' ||
          c === 'Paladin' ||
          c === 'General' ||
          c === 'Pegasus Knight' ||
          c === 'Falcon Knight' ||
          c === 'Wyvern Rider' ||
          c === 'Wyvern Lord',
      );
      return lanceClasses.length > 0
        ? lanceClasses[Math.floor(Math.random() * lanceClasses.length)]
        : pool.base[Math.floor(Math.random() * pool.base.length)];
    }
    case 'knight': {
      const knightClasses = [...pool.base, ...pool.promoted].filter(
        (c) => c === 'Knight' || c === 'General',
      );
      return knightClasses.length > 0
        ? knightClasses[Math.floor(Math.random() * knightClasses.length)]
        : pool.base[Math.floor(Math.random() * pool.base.length)];
    }
    default:
      return pool.base[Math.floor(Math.random() * pool.base.length)];
  }
}

// --- Composition-template affinity: class weight resolution ---

/**
 * Resolve the composite weight for a class based on template enemyWeights.
 * A class can match multiple categories — all matching weights are multiplied.
 * Returns 1.0 if no enemyWeights or no categories match.
 */
function resolveClassWeight(className, enemyWeights, classData) {
  if (!enemyWeights) return 1.0;

  const cd = classData?.find((c) => c.name === className);
  if (!cd) return 1.0;

  const moveType = cd.moveType || 'Infantry';
  const profs = cd.weaponProficiencies || '';
  const profList = profs
    .split(',')
    .map((p) => p.trim().split(' ')[0])
    .filter(Boolean);
  const isMelee = profList.some((p) => p === 'Swords' || p === 'Lances' || p === 'Axes');

  let composite = 1.0;
  const matched = [];

  // "infantry" — moveType Infantry AND melee weapons
  if (enemyWeights.infantry !== undefined && moveType === 'Infantry' && isMelee) {
    composite *= enemyWeights.infantry;
    matched.push('infantry');
  }
  // "cavalry" — moveType Cavalry
  if (enemyWeights.cavalry !== undefined && moveType === 'Cavalry') {
    composite *= enemyWeights.cavalry;
    matched.push('cavalry');
  }
  // "archer" — has Bows proficiency
  if (enemyWeights.archer !== undefined && profList.includes('Bows')) {
    composite *= enemyWeights.archer;
    matched.push('archer');
  }
  // "mage" — has Tomes or Light proficiency
  if (
    enemyWeights.mage !== undefined &&
    (profList.includes('Tomes') || profList.includes('Light'))
  ) {
    composite *= enemyWeights.mage;
    matched.push('mage');
  }
  // "knight" / "armored" — moveType Armored
  if (enemyWeights.knight !== undefined && moveType === 'Armored') {
    composite *= enemyWeights.knight;
    matched.push('knight');
  }
  if (enemyWeights.armored !== undefined && moveType === 'Armored') {
    composite *= enemyWeights.armored;
    matched.push('armored');
  }
  // "lance" — has Lances proficiency
  if (enemyWeights.lance !== undefined && profList.includes('Lances')) {
    composite *= enemyWeights.lance;
    matched.push('lance');
  }

  if (DEBUG_MAP_GEN && matched.length > 0) {
    mapGenLog.debug(`Weight: ${className} -> [${matched.join(', ')}] -> x${composite.toFixed(2)}`);
  }

  return composite;
}

/**
 * Pick a class from the pool using template-weighted selection.
 * Falls back to uniform random if no enemyWeights defined.
 */
function weightedClassPick(classList, enemyWeights, classData) {
  if (!enemyWeights || classList.length === 0) {
    return classList[Math.floor(Math.random() * classList.length)];
  }
  const entries = classList.map((name) => ({
    item: name,
    weight: resolveClassWeight(name, enemyWeights, classData),
  }));
  return weightedPick(entries);
}

// --- Enemy generation ---

function deriveSecondaryRoll(primaryRoll) {
  const seed = Math.trunc(primaryRoll * 0x100000000) >>> 0;
  const mixed = (Math.imul(seed ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0;
  return mixed / 0x100000000;
}

function generateEnemies(
  mapLayout,
  template,
  cols,
  rows,
  terrainData,
  pool,
  count,
  objective,
  act,
  bossData,
  thronePos,
  levelRangeOverride,
  classes,
  extraOptions = {},
) {
  const spawns = [];
  const usedPositions = new Set();

  // For Seize: place boss first
  if (objective === 'seize' && bossData[act]?.length > 0) {
    const bossDef = bossData[act][Math.floor(Math.random() * bossData[act].length)];
    // Place boss on or adjacent to throne
    let bossPos = thronePos;
    if (bossPos) {
      usedPositions.add(`${bossPos.col},${bossPos.row}`);
      spawns.push({
        className: bossDef.className,
        level: bossDef.level,
        col: bossPos.col,
        row: bossPos.row,
        isBoss: true,
        name: bossDef.name,
      });
    }
  }

  // Place anchored enemies (if template has anchors)
  const [minLvlAnchor, maxLvlAnchor] = levelRangeOverride || pool.levelRange;
  if (template.anchors && template.anchors.length > 0) {
    for (const anchor of template.anchors) {
      // Skip throne anchors — boss already placed by seize logic
      if (anchor.unit === 'boss_or_strongest') continue;

      const anchorTiles = resolveAnchorPositions(
        anchor,
        mapLayout,
        cols,
        rows,
        terrainData,
        thronePos,
      );
      const className = resolveAnchorUnitClass(anchor, pool, spawns);
      if (!className || anchorTiles.length === 0) continue;

      for (const tile of anchorTiles) {
        const key = `${tile.col},${tile.row}`;
        if (usedPositions.has(key)) continue;
        if (spawns.length >= count) break;

        usedPositions.add(key);
        const level =
          anchor.unit === 'highest_level'
            ? maxLvlAnchor
            : minLvlAnchor + Math.floor(Math.random() * (maxLvlAnchor - minLvlAnchor + 1));

        spawns.push({
          className,
          level,
          col: tile.col,
          row: tile.row,
          isBoss: false,
        });

        if (DEBUG_MAP_GEN)
          mapGenLog.debug(
            `Anchor placed: ${className} at (${tile.col},${tile.row}) for ${anchor.position}`,
          );
      }
    }
  }

  // Get enemy spawn zone positions
  const enemyZone = template.zones.find((z) => z.role === 'enemySpawn');
  let zoneStartCol, zoneEndCol, zoneStartRow, zoneEndRow;
  if (enemyZone) {
    const [x1, y1, x2, y2] = enemyZone.rect;
    zoneStartCol = Math.floor(x1 * cols);
    zoneEndCol = Math.min(Math.ceil(x2 * cols), cols);
    zoneStartRow = Math.floor(y1 * rows);
    zoneEndRow = Math.min(Math.ceil(y2 * rows), rows);
  } else {
    zoneStartCol = Math.floor(cols * 0.6);
    zoneEndCol = cols;
    zoneStartRow = 0;
    zoneEndRow = rows;
  }

  // Collect candidate tiles in enemy zone (not yet filtered by moveType)
  const candidateTiles = [];
  for (let r = zoneStartRow; r < zoneEndRow; r++) {
    for (let c = zoneStartCol; c < zoneEndCol; c++) {
      const key = `${c},${r}`;
      if (!usedPositions.has(key)) {
        candidateTiles.push({ col: c, row: r });
      }
    }
  }

  // Fill remaining enemy slots using terrain-aware weighted selection
  const remaining = count - spawns.length;
  const [minLvl, maxLvl] = levelRangeOverride || pool.levelRange;
  const allClasses = [...pool.base, ...pool.promoted];
  const usePromoted = pool.promoted.length > 0;

  // Template composition weights for class selection
  const enemyWeights = template.enemyWeights || null;

  if (DEBUG_MAP_GEN) {
    mapGenLog.debug(
      `Placing ${remaining} enemies, ${candidateTiles.length} candidate tiles, template=${template.id}`,
    );
    if (enemyWeights) {
      mapGenLog.debug(`Template enemyWeights: ${JSON.stringify(enemyWeights)}`);
    }
  }

  for (let i = 0; i < remaining && candidateTiles.length > 0; i++) {
    // Pick class using template-weighted selection
    let className;
    if (usePromoted && Math.random() < 0.3) {
      className = weightedClassPick(pool.promoted, enemyWeights, classes);
    } else if (pool.base.length > 0) {
      className = weightedClassPick(pool.base, enemyWeights, classes);
    } else {
      className = weightedClassPick(allClasses, enemyWeights, classes);
    }

    const unit = { className };

    // Score all remaining candidate tiles for this unit
    const scored = [];
    for (const tile of candidateTiles) {
      const s = scoreSpawnTile(tile, unit, terrainData, mapLayout, cols, classes);
      if (s > 0) scored.push({ item: tile, weight: s });
    }

    if (scored.length === 0) break; // no passable tiles left for this unit

    // Weighted pick
    const pos = weightedPick(scored);

    // Remove chosen tile from candidates
    const idx = candidateTiles.findIndex((t) => t.col === pos.col && t.row === pos.row);
    if (idx !== -1) candidateTiles.splice(idx, 1);
    usedPositions.add(`${pos.col},${pos.row}`);

    const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

    // Roll for Sunder weapon
    // Always draw exactly one Math.random() per spawn for RNG stability,
    // regardless of class eligibility for sunder/poison/status staves.
    const cd = classes?.find((c) => c.name === className);
    const primaryProf = cd?.weaponProficiencies?.split(',')[0]?.trim()?.split(' ')[0];
    const canHaveSunder = primaryProf && SUNDER_ELIGIBLE_PROFS.has(primaryProf);
    const sunderChance = Number(pool.sunderChance || 0);
    const baseRoll = Math.random();
    const sunderRoll = canHaveSunder && sunderChance > 0 ? baseRoll : null;
    const sunderWeapon = sunderRoll !== null && sunderRoll < sunderChance;
    const canHavePoison = !sunderWeapon && primaryProf && POISON_ELIGIBLE_PROFS.has(primaryProf);
    const rawPoisonChance =
      Number(pool.poisonChance || 0) + Number(extraOptions.enemyPoisonChance || 0);
    const poisonChance = Math.max(0, Math.min(1, rawPoisonChance));
    let poisonWeapon = false;
    if (canHavePoison && poisonChance > 0) {
      // Derive poison roll from the base roll to avoid additional RNG draws
      const poisonRoll = deriveSecondaryRoll(baseRoll);
      poisonWeapon = poisonRoll < poisonChance;
    }

    // Status staff assignment (enemy-only, difficulty-gated)
    let statusStaff;
    const ssCfg = extraOptions.statusStaffConfig;
    if (ssCfg && STATUS_STAFF_ELIGIBLE_CLASSES.has(className)) {
      const ssChance = Number(ssCfg[act] || 0);
      const ssMaxPerBattle = ssCfg.maxPerBattle || 0;
      const ssCount = spawns.filter((s) => s.statusStaff).length;
      if (ssChance > 0 && ssCount < ssMaxPerBattle) {
        // Derive status staff roll from base roll chain
        const ssRoll = deriveSecondaryRoll(deriveSecondaryRoll(baseRoll));
        if (ssRoll < ssChance) {
          // 50/50 split: use fractional part of derived roll
          statusStaff = deriveSecondaryRoll(ssRoll) < 0.5 ? 'sleep' : 'silence';
        }
      }
    }

    // Siege weapon assignment (Lunatic-only, promoted Tome users)
    let siegeWeapon;
    const swCfg = extraOptions.siegeWeaponConfig;
    if (swCfg && SIEGE_ELIGIBLE_CLASSES.has(className)) {
      const swChance = Number(swCfg[act] || 0);
      const swMaxPerBattle = swCfg.maxPerBattle || 0;
      const swCount = spawns.filter((s) => s.siegeWeapon).length;
      if (swChance > 0 && swCount < swMaxPerBattle) {
        // Derive siege roll from the status staff roll chain
        const siegeRoll = deriveSecondaryRoll(deriveSecondaryRoll(deriveSecondaryRoll(baseRoll)));
        if (siegeRoll < swChance) {
          siegeWeapon = swCfg.weaponName;
        }
      }
    }

    if (DEBUG_MAP_GEN) {
      const tName = terrainData[mapLayout[pos.row][pos.col]]?.name;
      const chosenScore = scored.find((s) => s.item === pos)?.weight;
      mapGenLog.debug(
        `${className} -> (${pos.col},${pos.row}) ${tName} score=${chosenScore} candidates=${scored.length}`,
      );
    }

    spawns.push({
      className,
      level,
      col: pos.col,
      row: pos.row,
      isBoss: false,
      sunderWeapon: sunderWeapon || undefined,
      poisonWeapon: poisonWeapon || undefined,
      statusStaff: statusStaff || undefined,
      siegeWeapon: siegeWeapon || undefined,
    });
  }

  // Assign guard AI mode only on seize maps to avoid passive enemies on rout maps.
  if (objective === 'seize') {
    const bossHalfCol = Math.floor(cols / 2);
    const bossHalfEnemies = spawns.filter((s) => !s.isBoss && s.col >= bossHalfCol);
    const guardRate = 0.15 + Math.random() * 0.1; // 15-25%
    const guardCount = Math.max(0, Math.round(bossHalfEnemies.length * guardRate));
    const shuffledGuards = [...bossHalfEnemies];
    shuffleArray(shuffledGuards);
    for (let i = 0; i < guardCount; i++) {
      shuffledGuards[i].aiMode = 'guard';
      if (DEBUG_MAP_GEN)
        mapGenLog.debug(
          `Guard assigned: ${shuffledGuards[i].className} at (${shuffledGuards[i].col},${shuffledGuards[i].row})`,
        );
    }
  }

  return spawns;
}

function rollEnemyCount({
  deployCount,
  act,
  row,
  isBoss,
  tiles,
  densityCap,
  enemyCountBonus = 0,
  enemyCountBase = 0,
  isAmbush = false,
}) {
  const actOffsets = ENEMY_COUNT_OFFSET[act];
  let offset;
  if (actOffsets) {
    if (isBoss && actOffsets.boss) offset = actOffsets.boss;
    else if (row !== undefined && actOffsets[row]) offset = actOffsets[row];
    else offset = actOffsets.default || [1, 2];
  } else {
    offset = [2, 3]; // fallback for unmapped acts (postAct)
  }
  const [minOff, maxOff] = offset;
  const base = enemyCountBase > 0 ? enemyCountBase : deployCount;
  const count =
    base + minOff + Math.floor(Math.random() * (maxOff - minOff + 1)) + Math.trunc(enemyCountBonus);

  // Village ambush cap: surprise fights should be lighter than regular battles
  // Act 1: deployCount + 1; later acts: deployCount + 2
  if (isAmbush) {
    const ambushCap = deployCount + (act === 'act1' ? 1 : 2);
    const densityMax = getEnemyDensityCapByTiles(tiles, densityCap);
    return Math.min(count, ambushCap, densityMax);
  }

  // Density safety cap from tile table (prevents overcrowding)
  const cap = getEnemyDensityCapByTiles(tiles, densityCap);
  return Math.min(count, cap);
}

function getEnemyDensityCapByTiles(tiles, densityCap) {
  const keys = Object.keys(densityCap)
    .map(Number)
    .sort((a, b) => a - b);
  let cap = Infinity;
  for (const k of keys) {
    if (k <= tiles) cap = densityCap[String(k)][1];
  }
  return cap;
}

// --- Reachability check ---

function ensureReachability(
  mapLayout,
  cols,
  rows,
  terrainData,
  playerSpawn,
  enemySpawns,
  thronePos,
) {
  // BFS from player spawn using Infantry movement
  const reachable = bfs(mapLayout, cols, rows, terrainData, playerSpawn, 'Infantry');

  // Collect all targets that must be reachable
  const targets = enemySpawns.map((e) => ({ col: e.col, row: e.row }));
  if (thronePos) targets.push(thronePos);

  for (const target of targets) {
    if (reachable.has(`${target.col},${target.row}`)) continue;

    // Target unreachable — carve a path from the nearest reachable tile
    carvePath(mapLayout, cols, rows, terrainData, playerSpawn, target, reachable);

    // Re-run BFS after carving (reachability may have expanded)
    const newReachable = bfs(mapLayout, cols, rows, terrainData, playerSpawn, 'Infantry');
    reachable.clear();
    for (const key of newReachable) reachable.add(key);
  }
}

function bfs(mapLayout, cols, rows, terrainData, start, moveType) {
  if (!start) return new Set();
  return bfsFromSources(mapLayout, cols, rows, terrainData, [start], moveType);
}

function bfsFromSources(mapLayout, cols, rows, terrainData, sources, moveType) {
  const visited = new Set();
  const queue = [];

  for (const source of sources || []) {
    if (!source) continue;
    if (source.col < 0 || source.col >= cols || source.row < 0 || source.row >= rows) continue;
    if (!isPassable(terrainData, mapLayout[source.row][source.col], moveType)) continue;
    const key = `${source.col},${source.row}`;
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push({ col: source.col, row: source.row });
  }

  while (queue.length > 0) {
    const { col, row } = queue.shift();
    const neighbors = getCardinalNeighbors(col, row, cols, rows);
    for (const neighbor of neighbors) {
      const key = `${neighbor.col},${neighbor.row}`;
      if (visited.has(key)) continue;
      if (!isPassable(terrainData, mapLayout[neighbor.row][neighbor.col], moveType)) continue;
      visited.add(key);
      queue.push(neighbor);
    }
  }
  return visited;
}

function carvePath(mapLayout, cols, rows, terrainData, start, target, reachable) {
  carvePathForMoveType(
    mapLayout,
    cols,
    rows,
    terrainData,
    start,
    target,
    reachable,
    'Infantry',
    cols + rows,
  );
}

function carvePathForMoveType(
  mapLayout,
  cols,
  rows,
  terrainData,
  start,
  target,
  reachable,
  moveType,
  maxConversions,
) {
  if (!start || !target || maxConversions <= 0) return 0;

  // Simple A*-like greedy carve: step from target toward start,
  // converting impassable tiles to Plain or Bridge (over water)
  let cur = { col: target.col, row: target.row };
  const maxSteps = cols + rows; // safety limit
  let conversions = 0;

  for (let i = 0; i < maxSteps; i++) {
    const key = `${cur.col},${cur.row}`;
    if (reachable.has(key)) break; // Connected!

    // Make current tile passable
    const tIdx = mapLayout[cur.row][cur.col];
    if (!isPassable(terrainData, tIdx, moveType)) {
      if (conversions >= maxConversions) break;
      if (tIdx === TERRAIN.Water) {
        mapLayout[cur.row][cur.col] = TERRAIN.Bridge;
      } else {
        mapLayout[cur.row][cur.col] = TERRAIN.Plain;
      }
      conversions++;
    }

    if (cur.col === start.col && cur.row === start.row) {
      break;
    }

    // Step toward start (prefer axis with larger distance)
    const dc = Math.sign(start.col - cur.col);
    const dr = Math.sign(start.row - cur.row);
    if (Math.abs(start.col - cur.col) >= Math.abs(start.row - cur.row)) {
      cur = { col: cur.col + dc, row: cur.row };
    } else {
      cur = { col: cur.col, row: cur.row + dr };
    }
  }

  return conversions;
}

function ensureCavalryAdvanceGuarantees({
  mapLayout,
  cols,
  rows,
  terrainData,
  playerSpawns,
  enemySpawns,
  npcSpawn,
  objective,
  thronePos,
}) {
  const cavalrySources = getCavalrySources(mapLayout, terrainData, playerSpawns);
  if (cavalrySources.length === 0) return;

  const occupied = buildOccupiedSet(playerSpawns, enemySpawns, npcSpawn);
  const engagementCandidates = collectUnoccupiedAdjacentTiles(enemySpawns, cols, rows, occupied);
  // Engagement and throne pressure each get their own carve budget so one goal
  // cannot starve the other on seize maps.
  ensureCavalryCanReachCandidates(
    mapLayout,
    cols,
    rows,
    terrainData,
    cavalrySources,
    engagementCandidates,
  );

  if (objective !== 'seize' || !thronePos) return;
  // Seize pressure should still apply when throne-adjacent tiles are currently occupied.
  // Occupied neighbors can represent current defenders, and cavalry should be able to
  // advance to contest those positions even if they are not free landing tiles yet.
  const thronePressureCandidates = collectAdjacentTiles([thronePos], cols, rows);
  ensureCavalryCanReachCandidates(
    mapLayout,
    cols,
    rows,
    terrainData,
    cavalrySources,
    thronePressureCandidates,
  );
}

function ensureCavalryCanReachCandidates(mapLayout, cols, rows, terrainData, sources, candidates) {
  if (!Array.isArray(sources) || sources.length === 0) return;
  if (!Array.isArray(candidates) || candidates.length === 0) return;

  let reachable = bfsFromSources(mapLayout, cols, rows, terrainData, sources, 'Cavalry');
  if (hasReachableCandidate(reachable, candidates)) return;

  let remainingConversions = CAVALRY_CARVE_MAX_CONVERSIONS;
  while (remainingConversions > 0) {
    const rankedTarget = pickBestCavalryTarget(mapLayout, terrainData, sources, candidates);
    if (!rankedTarget) break;

    const conversions = carvePathForMoveType(
      mapLayout,
      cols,
      rows,
      terrainData,
      rankedTarget.source,
      rankedTarget.target,
      reachable,
      'Cavalry',
      remainingConversions,
    );
    if (conversions <= 0) break;

    remainingConversions -= conversions;
    reachable = bfsFromSources(mapLayout, cols, rows, terrainData, sources, 'Cavalry');
    if (hasReachableCandidate(reachable, candidates)) break;
  }
}

function getCavalrySources(mapLayout, terrainData, playerSpawns) {
  const passableSources = (playerSpawns || []).filter((spawn) =>
    isPassable(terrainData, mapLayout[spawn.row][spawn.col], 'Cavalry'),
  );
  if (passableSources.length > 0) {
    return passableSources;
  }

  const fallback = [...(playerSpawns || [])].sort(compareTilesByRowCol)[0];
  if (!fallback) return [];

  const tileIndex = mapLayout[fallback.row][fallback.col];
  if (!isPassable(terrainData, tileIndex, 'Cavalry')) {
    mapLayout[fallback.row][fallback.col] =
      tileIndex === TERRAIN.Water ? TERRAIN.Bridge : TERRAIN.Plain;
  }
  return [fallback];
}

function buildOccupiedSet(playerSpawns, enemySpawns, npcSpawn) {
  const occupied = new Set();
  for (const spawn of playerSpawns || []) {
    occupied.add(`${spawn.col},${spawn.row}`);
  }
  for (const spawn of enemySpawns || []) {
    occupied.add(`${spawn.col},${spawn.row}`);
  }
  if (npcSpawn) {
    occupied.add(`${npcSpawn.col},${npcSpawn.row}`);
  }
  return occupied;
}

function collectUnoccupiedAdjacentTiles(origins, cols, rows, occupied) {
  const allAdjacentTiles = collectAdjacentTiles(origins, cols, rows);
  if (!occupied) return allAdjacentTiles;

  return allAdjacentTiles.filter((tile) => !occupied.has(`${tile.col},${tile.row}`));
}

function collectAdjacentTiles(origins, cols, rows) {
  const tiles = [];
  const seen = new Set();

  for (const origin of origins || []) {
    if (!origin) continue;
    const neighbors = getCardinalNeighbors(origin.col, origin.row, cols, rows);
    for (const tile of neighbors) {
      const key = `${tile.col},${tile.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(tile);
    }
  }

  return tiles;
}

function hasReachableCandidate(reachable, candidates) {
  return candidates.some((tile) => reachable.has(`${tile.col},${tile.row}`));
}

function pickBestCavalryTarget(mapLayout, terrainData, sources, candidates) {
  const ranked = [];
  for (const candidate of candidates) {
    const nearestSource = pickNearestSource(candidate, sources);
    if (!nearestSource) continue;
    ranked.push({
      source: nearestSource,
      target: candidate,
      distance: manhattanDistance(nearestSource, candidate),
      passableRank: isPassable(terrainData, mapLayout[candidate.row][candidate.col], 'Cavalry')
        ? 0
        : 1,
    });
  }

  ranked.sort(compareTargetRanks);
  return ranked[0] || null;
}

function pickNearestSource(target, sources) {
  let best = null;
  for (const source of sources || []) {
    if (!source) continue;
    if (!best) {
      best = source;
      continue;
    }
    const distance = manhattanDistance(source, target);
    const bestDistance = manhattanDistance(best, target);
    if (distance < bestDistance) {
      best = source;
      continue;
    }
    if (distance === bestDistance && compareTilesByRowCol(source, best) < 0) {
      best = source;
    }
  }
  return best;
}

function compareTargetRanks(a, b) {
  if (a.passableRank !== b.passableRank) return a.passableRank - b.passableRank;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return compareTilesByRowCol(a.target, b.target);
}

function compareTilesByRowCol(a, b) {
  if (a.row !== b.row) return a.row - b.row;
  return a.col - b.col;
}

function manhattanDistance(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function getCardinalNeighbors(col, row, cols, rows) {
  const neighbors = [];
  const candidates = [
    { col: col - 1, row },
    { col: col + 1, row },
    { col, row: row - 1 },
    { col, row: row + 1 },
  ];
  for (const neighbor of candidates) {
    if (neighbor.col < 0 || neighbor.col >= cols || neighbor.row < 0 || neighbor.row >= rows)
      continue;
    neighbors.push(neighbor);
  }
  return neighbors;
}

// --- Bridge enforcement for river templates ---

function ensureBridges(mapLayout, cols, rows, terrainData, minBridges) {
  const midStartCol = Math.floor(cols * 0.35);
  const midEndCol = Math.ceil(cols * 0.65);

  // A "crossing row" = no Water tiles remain in the river zone (all passable).
  // A "candidate row" = has at least one Water tile that can be converted.
  const crossingRows = [];
  const candidateRows = [];
  for (let r = 0; r < rows; r++) {
    let hasWater = false;
    for (let c = midStartCol; c < midEndCol; c++) {
      if (mapLayout[r][c] === TERRAIN.Water) {
        hasWater = true;
        break;
      }
    }
    if (!hasWater) {
      // Check that row actually has bridge tiles (not just land with no river)
      let hasBridge = false;
      for (let c = midStartCol; c < midEndCol; c++) {
        if (mapLayout[r][c] === TERRAIN.Bridge) {
          hasBridge = true;
          break;
        }
      }
      if (hasBridge) crossingRows.push(r);
    } else {
      candidateRows.push(r);
    }
  }

  // Add full-row bridge crossings until we reach minBridges
  while (crossingRows.length < minBridges && candidateRows.length > 0) {
    const targetRow = Math.floor((rows * (crossingRows.length + 1)) / (minBridges + 1));
    // Find closest candidate row to evenly-spaced target
    candidateRows.sort((a, b) => Math.abs(a - targetRow) - Math.abs(b - targetRow));
    const bestRow = candidateRows.shift();
    // Convert ALL water tiles in this row within river zone to Bridge
    for (let c = midStartCol; c < midEndCol; c++) {
      if (mapLayout[bestRow][c] === TERRAIN.Water) {
        mapLayout[bestRow][c] = TERRAIN.Bridge;
      }
    }
    crossingRows.push(bestRow);
  }
}

// --- NPC spawn for recruit battles ---

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

function getUsedRecruitNameSet(usedRecruitNames = {}) {
  const used = new Set();
  for (const value of Object.values(usedRecruitNames || {})) {
    if (!Array.isArray(value)) continue;
    for (const name of value) {
      if (typeof name === 'string' && name.trim().length > 0) used.add(name);
    }
  }
  return used;
}

function makeUniqueRecruitName(baseName, usedNames) {
  const safeBase =
    typeof baseName === 'string' && baseName.trim().length > 0 ? baseName.trim() : 'Recruit';
  if (!usedNames.has(safeBase)) return safeBase;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${safeBase} ${toRomanNumeral(i)}`;
    if (!usedNames.has(candidate)) return candidate;
  }

  let i = 2;
  while (true) {
    const candidate = `${safeBase} ${i}`;
    if (!usedNames.has(candidate)) return candidate;
    i++;
  }
}

function trackRecruitNameUsage(usedRecruitNames, className, name) {
  if (!usedRecruitNames || typeof usedRecruitNames !== 'object') return;
  const classKey =
    typeof className === 'string' && className.trim().length > 0 ? className.trim() : 'Recruit';

  if (!Array.isArray(usedRecruitNames[classKey])) usedRecruitNames[classKey] = [];
  if (!usedRecruitNames[classKey].includes(name)) usedRecruitNames[classKey].push(name);

  if (!Array.isArray(usedRecruitNames.__all__)) usedRecruitNames.__all__ = [];
  if (!usedRecruitNames.__all__.includes(name)) usedRecruitNames.__all__.push(name);
}

function generateNPCSpawn(
  mapLayout,
  cols,
  rows,
  terrainData,
  playerSpawns,
  enemySpawns,
  recruitPool,
  template,
  classesData,
  weaponsData,
  usedRecruitNames = {},
) {
  const { classPool, namePool, levelRange } = recruitPool;
  // If we have classPool (new structure), pick from it. Else fall back to pool (old structure).
  const className = classPool
    ? classPool[Math.floor(Math.random() * classPool.length)]
    : recruitPool.pool[Math.floor(Math.random() * recruitPool.pool.length)].className;

  // Pick name from pool, avoiding duplicates in current run
  const usedGlobalNames = getUsedRecruitNameSet(usedRecruitNames);
  let name = makeUniqueRecruitName(className, usedGlobalNames); // Fallback
  if (namePool && namePool[className]) {
    const classNames = namePool[className];
    const usedByClass = Array.isArray(usedRecruitNames[className])
      ? usedRecruitNames[className]
      : [];
    const available = classNames.filter((n) => !usedByClass.includes(n) && !usedGlobalNames.has(n));

    if (available.length > 0) {
      name = available[Math.floor(Math.random() * available.length)];
    } else {
      const globallyAvailable = classNames.filter((n) => !usedGlobalNames.has(n));
      if (globallyAvailable.length > 0) {
        name = globallyAvailable[Math.floor(Math.random() * globallyAvailable.length)];
      } else {
        const baseName = classNames[Math.floor(Math.random() * classNames.length)] || className;
        name = makeUniqueRecruitName(baseName, usedGlobalNames);
      }
    }
    // Track as used
    trackRecruitNameUsage(usedRecruitNames, className, name);
  } else if (recruitPool.pool) {
    // Old structure fallback
    const entry = recruitPool.pool.find((p) => p.className === className) || recruitPool.pool[0];
    name = makeUniqueRecruitName(entry.name, usedGlobalNames);
    trackRecruitNameUsage(usedRecruitNames, className, name);
  }

  const [minLvl, maxLvl] = levelRange;
  const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

  // Occupied positions
  const occupied = new Set();
  for (const s of playerSpawns) occupied.add(`${s.col},${s.row}`);
  for (const s of enemySpawns) occupied.add(`${s.col},${s.row}`);

  // D2: River map NPC spawn bias — tighter range for river templates
  const isRiverTemplate =
    template &&
    (template.id === 'river_crossing' ||
      (template.zones && template.zones.some((z) => z.terrain && z.terrain.Water >= 50)));
  const tightStartCol = Math.floor(cols * 0.2);
  const tightEndCol = Math.ceil(cols * 0.4);
  const wideStartCol = Math.floor(cols * 0.2);
  const wideEndCol = Math.ceil(cols * 0.55);

  if (DEBUG_MAP_GEN) {
    mapGenLog.debug(`NPC Spawn template=${template?.id}, isRiver=${isRiverTemplate}`);
    if (isRiverTemplate)
      mapGenLog.debug(
        `NPC Spawn river bias: trying tight zone [${tightStartCol}-${tightEndCol}] first`,
      );
  }

  // Pre-compute enemy turn-1 reach for D3 threat radius check
  const enemyReach = computeEnemyReach(enemySpawns, classesData, weaponsData);

  // Find candidates in a column range with distance and threat checks
  function findCandidates(startCol, endCol) {
    const cands = [];
    for (let r = 0; r < rows; r++) {
      for (let c = startCol; c < endCol; c++) {
        const key = `${c},${r}`;
        if (occupied.has(key)) continue;
        if (!isPassable(terrainData, mapLayout[r][c], 'Infantry')) continue;
        const minPlayerDist = Math.min(
          ...playerSpawns.map((s) => Math.abs(s.col - c) + Math.abs(s.row - r)),
        );
        const minEnemyDist = Math.min(
          ...enemySpawns.map((s) => Math.abs(s.col - c) + Math.abs(s.row - r)),
        );
        if (minPlayerDist >= 2 && minEnemyDist >= 4) {
          cands.push({ col: c, row: r, playerDist: minPlayerDist });
        }
      }
    }
    return cands;
  }

  // D2: Try tight zone first for river maps, then fall back to wide zone
  let candidates;
  if (isRiverTemplate) {
    candidates = findCandidates(tightStartCol, tightEndCol);
    if (DEBUG_MAP_GEN)
      mapGenLog.debug(`NPC Spawn river tight zone: ${candidates.length} candidates`);
    if (candidates.length === 0) {
      candidates = findCandidates(wideStartCol, wideEndCol);
      if (DEBUG_MAP_GEN)
        mapGenLog.debug(`NPC Spawn river fallback to wide zone: ${candidates.length} candidates`);
    }
  } else {
    candidates = findCandidates(wideStartCol, wideEndCol);
  }

  // D3: Threat radius rejection — pick candidate, reject if >2 enemies in turn-1 reach
  let pos = null;
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.playerDist - b.playerDist);
    const pickPool = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)));
    shuffleArray(pickPool);

    const maxRetries = Math.min(10, pickPool.length);
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const candidate = pickPool[attempt];
      const threatsInRange = countThreats(candidate.col, candidate.row, enemyReach);
      if (DEBUG_MAP_GEN) {
        mapGenLog.debug(
          `NPC Spawn attempt ${attempt + 1}: (${candidate.col},${candidate.row}) threats=${threatsInRange} ${threatsInRange > 2 ? 'REJECTED' : 'ACCEPTED'}`,
        );
      }
      if (threatsInRange <= 2) {
        pos = candidate;
        break;
      }
    }
    // If all retries failed, place anyway with warning
    if (!pos) {
      pos = pickPool[0];
      if (DEBUG_MAP_GEN)
        mapGenLog.debug(
          `NPC Spawn all ${maxRetries} retries exceeded threat limit, placing at (${pos.col},${pos.row}) anyway`,
        );
    }
  } else {
    // Fallback: any passable tile in wide zone (relax distance constraints)
    const fallback = [];
    for (let r = 0; r < rows; r++) {
      for (let c = wideStartCol; c < wideEndCol; c++) {
        const key = `${c},${r}`;
        if (occupied.has(key)) continue;
        if (isPassable(terrainData, mapLayout[r][c], 'Infantry')) fallback.push({ col: c, row: r });
      }
    }
    if (fallback.length > 0) {
      pos = fallback[Math.floor(Math.random() * fallback.length)];
    } else {
      // Ultimate fallback: map center forced to Plain
      const centerCol = Math.floor(cols / 2);
      const centerRow = Math.floor(rows / 2);
      mapLayout[centerRow][centerCol] = TERRAIN.Plain;
      pos = { col: centerCol, row: centerRow };
    }
    if (DEBUG_MAP_GEN) mapGenLog.debug(`NPC Spawn fallback placement at (${pos.col},${pos.row})`);
  }

  return {
    className,
    name,
    level,
    col: pos.col,
    row: pos.row,
  };
}

// Estimate max weapon range from a class's primary weapon proficiency
function estimateMaxWeaponRange(className, classesData, weaponsData) {
  if (!classesData || !weaponsData) return 1;
  const cd = classesData.find((c) => c.name === className);
  if (!cd?.weaponProficiencies) return 1;
  const primaryProf = cd.weaponProficiencies.split(',')[0]?.trim()?.split(' ')[0];
  // Map proficiency to weapon type
  const profToType = {
    Swords: 'Sword',
    Lances: 'Lance',
    Axes: 'Axe',
    Bows: 'Bow',
    Tomes: 'Tome',
    Light: 'Light',
    Staves: 'Staff',
  };
  const weaponType = profToType[primaryProf];
  if (!weaponType) return 1;
  // Find max range among that weapon type
  let maxRange = 1;
  for (const w of weaponsData) {
    if (w.type !== weaponType) continue;
    const parts = w.range.split('-').map(Number);
    const hi = parts[parts.length - 1];
    if (hi > maxRange) maxRange = hi;
  }
  // Cap at 2 for practical turn-1 reach estimation (long-range tomes like Bolting are rare)
  return Math.min(maxRange, 2);
}

// Pre-compute enemy turn-1 reach: MOV + max weapon range
function computeEnemyReach(enemySpawns, classesData, weaponsData) {
  return enemySpawns.map((e) => {
    const cd = classesData?.find((c) => c.name === e.className);
    const mov = cd?.baseStats?.MOV || 4;
    const maxRange = estimateMaxWeaponRange(e.className, classesData, weaponsData);
    return { col: e.col, row: e.row, reach: mov + maxRange };
  });
}

// Count how many enemies can reach a position on turn 1
function countThreats(col, row, enemyReach) {
  let count = 0;
  for (const e of enemyReach) {
    const dist = Math.abs(e.col - col) + Math.abs(e.row - row);
    if (dist <= e.reach) count++;
  }
  return count;
}

// --- Helpers ---

function weightedRandom(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [name, w] of entries) {
    roll -= w;
    if (roll <= 0) return name;
  }
  return entries[entries.length - 1][0];
}

function terrainNameToIndex(name, terrainData) {
  return terrainData.findIndex((t) => t.name === name);
}

function isPassable(terrainData, terrainIndex, moveType) {
  const t = terrainData[terrainIndex];
  if (!t) return false;
  const cost = t.moveCost[moveType];
  return cost !== '--' && !isNaN(parseInt(cost));
}

/**
 * Find an adjacent passable tile near an anchor, searching manhattan distance 1 then 2.
 * Uses the provided moveType to validate terrain passability.
 * Returns { col, row } or null if none found.
 */
function findAdjacentPassableTile(
  mapLayout,
  cols,
  rows,
  terrainData,
  anchor,
  occupied,
  moveType = 'Infantry',
) {
  const deltas = [
    // Distance 1
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    // Distance 2
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
    [0, -2],
    [0, 2],
    [-2, 0],
    [2, 0],
  ];
  for (const [dc, dr] of deltas) {
    const c = anchor.col + dc;
    const r = anchor.row + dr;
    if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
    if (occupied.has(`${c},${r}`)) continue;
    if (isPassable(terrainData, mapLayout[r][c], moveType)) {
      return { col: c, row: r };
    }
  }
  return null;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Exported for testing
export {
  scoreSpawnTile,
  resolveClassWeight,
  resolveHybridAnchors,
  applyHybridArenaOverlay,
  applyPhaseOverrideToLayout,
  findAdjacentPassableTile,
  CAVALRY_CARVE_MAX_CONVERSIONS,
};
