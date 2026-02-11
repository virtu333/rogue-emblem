// MapGenerator.js — Procedural map generation from zone-based templates
// Pure functions, no Phaser dependency.

import { TERRAIN, DEPLOY_LIMITS, ENEMY_COUNT_OFFSET, SUNDER_ELIGIBLE_PROFS } from '../utils/constants.js';

const DEBUG_MAP_GEN = false;

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
  } = params;
  const { terrain, mapSizes, mapTemplates, enemies, recruits, classes, weapons } = deps;

  // 1. Pick map size
  const sizeEntry = pickMapSize(act, mapSizes);
  const [cols, rows] = sizeEntry.mapSize.split('x').map(Number);

  // 2. Pick template (use pre-assigned templateId if available)
  const template = preAssignedTemplateId
    ? findTemplateById(preAssignedTemplateId, mapTemplates) || pickTemplate(objective, mapTemplates)
    : pickTemplate(objective, mapTemplates);

  // 3. Generate terrain
  const mapLayout = generateTerrain(template, cols, rows, terrain);

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
  const playerSpawns = placeSpawns(mapLayout, template, cols, rows, 'playerSpawn', terrain, spawnCount);

  // 6. Enemy composition
  const basePool = enemies.pools[act];
  const pool = firstBattleFightersOnly
    ? { ...basePool, base: ['Fighter'], promoted: [] }
    : basePool;
  const rolledEnemyCount = rollEnemyCount({
    deployCount: spawnCount, act, row, isBoss,
    tiles: sizeEntry.tiles, densityCap: enemies.enemyCountByTiles, enemyCountBonus,
  });
  const recruitBonus = isRecruitBattle ? 1 : 0;
  const densityCap = getEnemyDensityCapByTiles(sizeEntry.tiles, enemies.enemyCountByTiles);
  const enemyCount = Math.min(rolledEnemyCount + recruitBonus, densityCap);
  const enemySpawns = generateEnemies(
    mapLayout, template, cols, rows, terrain,
    pool, enemyCount, objective, act, enemies.bosses, thronePos, levelRange, classes
  );

  // 7. NPC spawn for recruit battles
  let npcSpawn = null;
  if (isRecruitBattle && recruits && recruits[act]) {
    npcSpawn = generateNPCSpawn(mapLayout, cols, rows, terrain, playerSpawns, enemySpawns, recruits[act], template, classes, deps.weapons);
  }

  // 8. Ensure reachability from player spawn to all enemies + throne + NPC
  const reachTargets = [...enemySpawns];
  if (npcSpawn) reachTargets.push(npcSpawn);
  ensureReachability(mapLayout, cols, rows, terrain, playerSpawns[0], reachTargets, thronePos);

  // Ensure bridges if river template
  if (template.minBridges) {
    ensureBridges(mapLayout, cols, rows, terrain, template.minBridges);
  }

  return {
    mapLayout,
    cols,
    rows,
    objective,
    playerSpawns,
    enemySpawns,
    npcSpawn,
    thronePos,
    templateId: template.id,
  };
}

// --- Map size selection ---

function pickMapSize(act, mapSizes) {
  // Map act to phase prefix
  const prefixMap = {
    act1: 'Act 1',
    act2: 'Act 2',
    act3: 'Act 3',
    postAct: 'Post-Act',
    finalBoss: 'Final Boss',
  };
  const prefix = prefixMap[act] || 'Act 1';
  const candidates = mapSizes.filter(s => s.phase.startsWith(prefix));
  if (candidates.length === 0) return mapSizes[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// --- Template selection ---

function pickTemplate(objective, mapTemplates) {
  const pool = mapTemplates[objective];
  if (!pool || pool.length === 0) {
    // Fallback to rout if objective templates missing
    return mapTemplates.rout[0];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function findTemplateById(templateId, mapTemplates) {
  for (const pool of Object.values(mapTemplates)) {
    if (!Array.isArray(pool)) continue;
    const found = pool.find(t => t.id === templateId);
    if (found) return found;
  }
  return null;
}

// --- Terrain generation ---

// Max forts per map (Throne excluded — placed by features, not random gen)
const MAX_FORTS = 4;

function generateTerrain(template, cols, rows, terrainData) {
  // Initialize with Plain
  const map = [];
  for (let r = 0; r < rows; r++) {
    map[r] = new Array(cols).fill(TERRAIN.Plain);
  }

  // Sort zones by priority ascending (lower priority filled first, higher overwrites)
  const sorted = [...template.zones].sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for (const zone of sorted) {
    const [x1, y1, x2, y2] = zone.rect;
    const startCol = Math.floor(x1 * cols);
    const endCol = Math.min(Math.ceil(x2 * cols), cols);
    const startRow = Math.floor(y1 * rows);
    const endRow = Math.min(Math.ceil(y2 * rows), rows);

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
  const zone = template.zones.find(z => z.role === role);
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

  const cd = classData?.find(c => c.name === unit.className);
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
          for (const [sr, sc] of [[midRow + dr, midCol + dc], [midRow - dr, midCol - dc], [midRow + dr, midCol - dc], [midRow - dr, midCol + dc]]) {
            if (sr >= 0 && sr < rows && sc >= 0 && sc < cols && tiles.length < count) {
              if (isPassable(terrainData, mapLayout[sr][sc], 'Infantry')) {
                if (!tiles.some(t => t.col === sc && t.row === sr)) {
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
            if (nc < cols && isPassable(terrainData, mapLayout[r][nc], 'Infantry') && mapLayout[r][nc] !== TERRAIN.Water) {
              if (!tiles.some(t => t.col === nc && t.row === r)) {
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
      for (let r = Math.max(0, midRow - 3); r <= Math.min(rows - 1, midRow + 3) && tiles.length < count; r++) {
        for (let c = Math.floor(cols * 0.5); c < cols && tiles.length < count; c++) {
          if (!isPassable(terrainData, mapLayout[r][c], 'Infantry')) continue;
          // Check if adjacent to a wall
          const adj = [
            { col: c - 1, row: r }, { col: c + 1, row: r },
            { col: c, row: r - 1 }, { col: c, row: r + 1 },
          ];
          const nearWall = adj.some(n =>
            n.col >= 0 && n.col < cols && n.row >= 0 && n.row < rows &&
            mapLayout[n.row][n.col] === TERRAIN.Wall
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
      const lanceClasses = [...pool.base, ...pool.promoted].filter(c =>
        c === 'Cavalier' || c === 'Knight' || c === 'Soldier' ||
        c === 'Paladin' || c === 'General' || c === 'Pegasus Knight' || c === 'Falcon Knight'
      );
      return lanceClasses.length > 0
        ? lanceClasses[Math.floor(Math.random() * lanceClasses.length)]
        : pool.base[Math.floor(Math.random() * pool.base.length)];
    }
    case 'knight': {
      const knightClasses = [...pool.base, ...pool.promoted].filter(c =>
        c === 'Knight' || c === 'General'
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

  const cd = classData?.find(c => c.name === className);
  if (!cd) return 1.0;

  const moveType = cd.moveType || 'Infantry';
  const profs = cd.weaponProficiencies || '';
  const profList = profs.split(',').map(p => p.trim().split(' ')[0]).filter(Boolean);
  const isMelee = profList.some(p => p === 'Swords' || p === 'Lances' || p === 'Axes');

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
  if (enemyWeights.mage !== undefined && (profList.includes('Tomes') || profList.includes('Light'))) {
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
    console.log(`[MapGen] Weight: ${className} -> [${matched.join(', ')}] -> x${composite.toFixed(2)}`);
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
  const entries = classList.map(name => ({
    item: name,
    weight: resolveClassWeight(name, enemyWeights, classData),
  }));
  return weightedPick(entries);
}

// --- Enemy generation ---

function generateEnemies(mapLayout, template, cols, rows, terrainData, pool, count, objective, act, bossData, thronePos, levelRangeOverride, classes) {
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

      const anchorTiles = resolveAnchorPositions(anchor, mapLayout, cols, rows, terrainData, thronePos);
      const className = resolveAnchorUnitClass(anchor, pool, spawns);
      if (!className || anchorTiles.length === 0) continue;

      for (const tile of anchorTiles) {
        const key = `${tile.col},${tile.row}`;
        if (usedPositions.has(key)) continue;
        if (spawns.length >= count) break;

        usedPositions.add(key);
        const level = anchor.unit === 'highest_level'
          ? maxLvlAnchor
          : minLvlAnchor + Math.floor(Math.random() * (maxLvlAnchor - minLvlAnchor + 1));

        spawns.push({
          className,
          level,
          col: tile.col,
          row: tile.row,
          isBoss: false,
        });

        if (DEBUG_MAP_GEN) console.log(`[MapGen] Anchor placed: ${className} at (${tile.col},${tile.row}) for ${anchor.position}`);
      }
    }
  }

  // Get enemy spawn zone positions
  const enemyZone = template.zones.find(z => z.role === 'enemySpawn');
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
    console.log(`[MapGen] Placing ${remaining} enemies, ${candidateTiles.length} candidate tiles, template=${template.id}`);
    if (enemyWeights) {
      console.log(`[MapGen] Template enemyWeights: ${JSON.stringify(enemyWeights)}`);
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
    const idx = candidateTiles.findIndex(t => t.col === pos.col && t.row === pos.row);
    if (idx !== -1) candidateTiles.splice(idx, 1);
    usedPositions.add(`${pos.col},${pos.row}`);

    const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

    // Roll for Sunder weapon
    const cd = classes?.find(c => c.name === className);
    const primaryProf = cd?.weaponProficiencies?.split(',')[0]?.trim()?.split(' ')[0];
    const canHaveSunder = primaryProf && SUNDER_ELIGIBLE_PROFS.has(primaryProf);
    const sunderWeapon = canHaveSunder && pool.sunderChance && Math.random() < pool.sunderChance;

    if (DEBUG_MAP_GEN) {
      const tName = terrainData[mapLayout[pos.row][pos.col]]?.name;
      const chosenScore = scored.find(s => s.item === pos)?.weight;
      console.log(`[MapGen]  ${className} -> (${pos.col},${pos.row}) ${tName} score=${chosenScore} candidates=${scored.length}`);
    }

    spawns.push({
      className,
      level,
      col: pos.col,
      row: pos.row,
      isBoss: false,
      sunderWeapon: sunderWeapon || undefined,
    });
  }

  // Assign guard AI mode only on seize maps to avoid passive enemies on rout maps.
  if (objective === 'seize') {
    const bossHalfCol = Math.floor(cols / 2);
    const bossHalfEnemies = spawns.filter(s => !s.isBoss && s.col >= bossHalfCol);
    const guardRate = 0.15 + Math.random() * 0.10; // 15-25%
    const guardCount = Math.max(0, Math.round(bossHalfEnemies.length * guardRate));
    const shuffledGuards = [...bossHalfEnemies];
    shuffleArray(shuffledGuards);
    for (let i = 0; i < guardCount; i++) {
      shuffledGuards[i].aiMode = 'guard';
      if (DEBUG_MAP_GEN) console.log(`[MapGen] Guard assigned: ${shuffledGuards[i].className} at (${shuffledGuards[i].col},${shuffledGuards[i].row})`);
    }
  }

  return spawns;
}

function rollEnemyCount({ deployCount, act, row, isBoss, tiles, densityCap, enemyCountBonus = 0 }) {
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
  const count = deployCount + minOff + Math.floor(Math.random() * (maxOff - minOff + 1)) + Math.trunc(enemyCountBonus);

  // Density safety cap from tile table (prevents overcrowding)
  const cap = getEnemyDensityCapByTiles(tiles, densityCap);
  return Math.min(count, cap);
}

function getEnemyDensityCapByTiles(tiles, densityCap) {
  const keys = Object.keys(densityCap).map(Number).sort((a, b) => a - b);
  let cap = Infinity;
  for (const k of keys) {
    if (k <= tiles) cap = densityCap[String(k)][1];
  }
  return cap;
}

// --- Reachability check ---

function ensureReachability(mapLayout, cols, rows, terrainData, playerSpawn, enemySpawns, thronePos) {
  // BFS from player spawn using Infantry movement
  const reachable = bfs(mapLayout, cols, rows, terrainData, playerSpawn, 'Infantry');

  // Collect all targets that must be reachable
  const targets = enemySpawns.map(e => ({ col: e.col, row: e.row }));
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
  const visited = new Set();
  const queue = [start];
  visited.add(`${start.col},${start.row}`);

  while (queue.length > 0) {
    const { col, row } = queue.shift();
    const neighbors = [
      { col: col - 1, row }, { col: col + 1, row },
      { col, row: row - 1 }, { col, row: row + 1 },
    ];
    for (const n of neighbors) {
      if (n.col < 0 || n.col >= cols || n.row < 0 || n.row >= rows) continue;
      const key = `${n.col},${n.row}`;
      if (visited.has(key)) continue;
      if (!isPassable(terrainData, mapLayout[n.row][n.col], moveType)) continue;
      visited.add(key);
      queue.push(n);
    }
  }
  return visited;
}

function carvePath(mapLayout, cols, rows, terrainData, start, target, reachable) {
  // Simple A*-like greedy carve: step from target toward start,
  // converting impassable tiles to Plain or Bridge (over water)
  let cur = { col: target.col, row: target.row };
  const maxSteps = cols + rows; // safety limit

  for (let i = 0; i < maxSteps; i++) {
    const key = `${cur.col},${cur.row}`;
    if (reachable.has(key)) break; // Connected!

    // Make current tile passable
    const tIdx = mapLayout[cur.row][cur.col];
    if (!isPassable(terrainData, tIdx, 'Infantry')) {
      if (tIdx === TERRAIN.Water) {
        mapLayout[cur.row][cur.col] = TERRAIN.Bridge;
      } else {
        mapLayout[cur.row][cur.col] = TERRAIN.Plain;
      }
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
}

// --- Bridge enforcement for river templates ---

function ensureBridges(mapLayout, cols, rows, terrainData, minBridges) {
  // Find all water tiles in the river zone (middle columns)
  const midStartCol = Math.floor(cols * 0.35);
  const midEndCol = Math.ceil(cols * 0.65);

  // Count existing bridges in the river zone
  let bridgeCount = 0;
  const waterTiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = midStartCol; c < midEndCol; c++) {
      if (mapLayout[r][c] === TERRAIN.Bridge) bridgeCount++;
      if (mapLayout[r][c] === TERRAIN.Water) waterTiles.push({ col: c, row: r });
    }
  }

  // Add bridges if needed, spacing them vertically
  while (bridgeCount < minBridges && waterTiles.length > 0) {
    // Pick a water tile roughly evenly spaced
    const targetRow = Math.floor(rows * (bridgeCount + 1) / (minBridges + 1));
    // Find closest water tile to target row
    waterTiles.sort((a, b) => Math.abs(a.row - targetRow) - Math.abs(b.row - targetRow));
    const tile = waterTiles.shift();
    if (tile) {
      mapLayout[tile.row][tile.col] = TERRAIN.Bridge;
      bridgeCount++;
    }
  }
}

// --- NPC spawn for recruit battles ---

function generateNPCSpawn(mapLayout, cols, rows, terrainData, playerSpawns, enemySpawns, recruitPool, template, classesData, weaponsData) {
  const { pool: recruitCandidates, levelRange } = recruitPool;
  const recruit = recruitCandidates[Math.floor(Math.random() * recruitCandidates.length)];
  const [minLvl, maxLvl] = levelRange;
  const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

  // Occupied positions
  const occupied = new Set();
  for (const s of playerSpawns) occupied.add(`${s.col},${s.row}`);
  for (const s of enemySpawns) occupied.add(`${s.col},${s.row}`);

  // D2: River map NPC spawn bias — tighter range for river templates
  const isRiverTemplate = template && (template.id === 'river_crossing' ||
    (template.zones && template.zones.some(z => z.terrain && z.terrain.Water >= 50)));
  const tightStartCol = Math.floor(cols * 0.20);
  const tightEndCol = Math.ceil(cols * 0.40);
  const wideStartCol = Math.floor(cols * 0.20);
  const wideEndCol = Math.ceil(cols * 0.55);

  if (DEBUG_MAP_GEN) {
    console.log(`[NPC Spawn] Template: ${template?.id}, isRiver: ${isRiverTemplate}`);
    if (isRiverTemplate) console.log(`[NPC Spawn] River bias: trying tight zone [${tightStartCol}-${tightEndCol}] first`);
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
        const minPlayerDist = Math.min(...playerSpawns.map(s => Math.abs(s.col - c) + Math.abs(s.row - r)));
        const minEnemyDist = Math.min(...enemySpawns.map(s => Math.abs(s.col - c) + Math.abs(s.row - r)));
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
    if (DEBUG_MAP_GEN) console.log(`[NPC Spawn] River tight zone: ${candidates.length} candidates`);
    if (candidates.length === 0) {
      candidates = findCandidates(wideStartCol, wideEndCol);
      if (DEBUG_MAP_GEN) console.log(`[NPC Spawn] River fallback to wide zone: ${candidates.length} candidates`);
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
        console.log(`[NPC Spawn] Attempt ${attempt + 1}: (${candidate.col},${candidate.row}) threats=${threatsInRange} ${threatsInRange > 2 ? 'REJECTED' : 'ACCEPTED'}`);
      }
      if (threatsInRange <= 2) {
        pos = candidate;
        break;
      }
    }
    // If all retries failed, place anyway with warning
    if (!pos) {
      pos = pickPool[0];
      if (DEBUG_MAP_GEN) console.warn(`[NPC Spawn] All ${maxRetries} retries exceeded threat limit, placing at (${pos.col},${pos.row}) anyway`);
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
    if (DEBUG_MAP_GEN) console.log(`[NPC Spawn] Fallback placement at (${pos.col},${pos.row})`);
  }

  return {
    className: recruit.className,
    name: recruit.name,
    level,
    col: pos.col,
    row: pos.row,
  };
}

// Estimate max weapon range from a class's primary weapon proficiency
function estimateMaxWeaponRange(className, classesData, weaponsData) {
  if (!classesData || !weaponsData) return 1;
  const cd = classesData.find(c => c.name === className);
  if (!cd?.weaponProficiencies) return 1;
  const primaryProf = cd.weaponProficiencies.split(',')[0]?.trim()?.split(' ')[0];
  // Map proficiency to weapon type
  const profToType = { Swords: 'Sword', Lances: 'Lance', Axes: 'Axe', Bows: 'Bow', Tomes: 'Tome', Light: 'Light', Staves: 'Staff' };
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
  return enemySpawns.map(e => {
    const cd = classesData?.find(c => c.name === e.className);
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
  return terrainData.findIndex(t => t.name === name);
}

function isPassable(terrainData, terrainIndex, moveType) {
  const t = terrainData[terrainIndex];
  if (!t) return false;
  const cost = t.moveCost[moveType];
  return cost !== '--' && !isNaN(parseInt(cost));
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Exported for testing
export { scoreSpawnTile, resolveClassWeight };
