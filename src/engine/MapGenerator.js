// MapGenerator.js — Procedural map generation from zone-based templates
// Pure functions, no Phaser dependency.

import { TERRAIN, DEPLOY_LIMITS, ENEMY_COUNT_OFFSET, SUNDER_ELIGIBLE_PROFS } from '../utils/constants.js';

/**
 * Generate a full battle configuration from params + game data.
 * @param {Object} params - { act, objective, sizeKey? (optional override), difficultyMod? }
 * @param {Object} deps - { terrain, classes, weapons, skills, mapSizes, mapTemplates, enemies }
 * @returns {Object} battleConfig
 */
export function generateBattle(params, deps) {
  const { act = 'act1', objective = 'rout', difficultyMod = 1.0, isRecruitBattle = false, deployCount, levelRange, row, isBoss } = params;
  const { terrain, mapSizes, mapTemplates, enemies, recruits, classes } = deps;

  // 1. Pick map size
  const sizeEntry = pickMapSize(act, mapSizes);
  const [cols, rows] = sizeEntry.mapSize.split('x').map(Number);

  // 2. Pick template
  const template = pickTemplate(objective, mapTemplates);

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
  const pool = enemies.pools[act];
  const enemyCount = rollEnemyCount({
    deployCount: spawnCount, act, row, isBoss,
    tiles: sizeEntry.tiles, densityCap: enemies.enemyCountByTiles,
  });
  const enemySpawns = generateEnemies(
    mapLayout, template, cols, rows, terrain,
    pool, enemyCount, objective, act, enemies.bosses, thronePos, levelRange, classes
  );

  // 7. NPC spawn for recruit battles
  let npcSpawn = null;
  if (isRecruitBattle && recruits && recruits[act]) {
    npcSpawn = generateNPCSpawn(mapLayout, cols, rows, terrain, playerSpawns, enemySpawns, recruits[act]);
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
    if (spawns.length >= count) break;
    const key = `${pos.col},${pos.row}`;
    if (!used.has(key)) {
      used.add(key);
      spawns.push(pos);
    }
  }

  // Fallback: if not enough spawns found, force some tiles to Plain
  while (spawns.length < count) {
    const r = startRow + Math.floor(Math.random() * (endRow - startRow));
    const c = startCol + Math.floor(Math.random() * (endCol - startCol));
    const key = `${c},${r}`;
    if (!used.has(key)) {
      mapLayout[r][c] = TERRAIN.Plain;
      used.add(key);
      spawns.push({ col: c, row: r });
    }
  }

  return spawns;
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

  // Collect passable tiles in enemy zone
  const positions = [];
  for (let r = zoneStartRow; r < zoneEndRow; r++) {
    for (let c = zoneStartCol; c < zoneEndCol; c++) {
      const key = `${c},${r}`;
      if (!usedPositions.has(key) && isPassable(terrainData, mapLayout[r][c], 'Infantry')) {
        positions.push({ col: c, row: r });
      }
    }
  }
  shuffleArray(positions);

  // Fill remaining enemy slots
  const remaining = count - spawns.length;
  const [minLvl, maxLvl] = levelRangeOverride || pool.levelRange;
  const allClasses = [...pool.base, ...pool.promoted];
  // ~70% base, 30% promoted if promoted classes available
  const usePromoted = pool.promoted.length > 0;

  for (let i = 0; i < remaining && positions.length > 0; i++) {
    const pos = positions.pop();
    usedPositions.add(`${pos.col},${pos.row}`);

    let className;
    if (usePromoted && Math.random() < 0.3) {
      className = pool.promoted[Math.floor(Math.random() * pool.promoted.length)];
    } else if (pool.base.length > 0) {
      className = pool.base[Math.floor(Math.random() * pool.base.length)];
    } else {
      className = allClasses[Math.floor(Math.random() * allClasses.length)];
    }

    const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

    // Roll for Sunder weapon (enemy-only anti-juggernaut mechanic)
    // Only roll for classes whose primary proficiency has a sunder variant
    const cd = classes?.find(c => c.name === className);
    const primaryProf = cd?.weaponProficiencies?.split(',')[0]?.trim()?.split(' ')[0];
    const canHaveSunder = primaryProf && SUNDER_ELIGIBLE_PROFS.has(primaryProf);
    const sunderWeapon = canHaveSunder && pool.sunderChance && Math.random() < pool.sunderChance;

    spawns.push({
      className,
      level,
      col: pos.col,
      row: pos.row,
      isBoss: false,
      sunderWeapon: sunderWeapon || undefined,
    });
  }

  return spawns;
}

function rollEnemyCount({ deployCount, act, row, isBoss, tiles, densityCap }) {
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
  const count = deployCount + minOff + Math.floor(Math.random() * (maxOff - minOff + 1));

  // Density safety cap from tile table (prevents overcrowding)
  const keys = Object.keys(densityCap).map(Number).sort((a, b) => a - b);
  let cap = Infinity;
  for (const k of keys) { if (k <= tiles) cap = densityCap[String(k)][1]; }
  return Math.min(count, cap);
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

function generateNPCSpawn(mapLayout, cols, rows, terrainData, playerSpawns, enemySpawns, recruitPool) {
  const { pool, levelRange } = recruitPool;
  const recruit = pool[Math.floor(Math.random() * pool.length)];
  const [minLvl, maxLvl] = levelRange;
  const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

  // Occupied positions
  const occupied = new Set();
  for (const s of playerSpawns) occupied.add(`${s.col},${s.row}`);
  for (const s of enemySpawns) occupied.add(`${s.col},${s.row}`);

  // Middle third of map
  const midStartCol = Math.floor(cols * 0.33);
  const midEndCol = Math.ceil(cols * 0.67);

  // Find passable tiles in middle third, Manhattan distance >= 3 from all spawns
  const allSpawns = [...playerSpawns, ...enemySpawns];
  const candidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = midStartCol; c < midEndCol; c++) {
      const key = `${c},${r}`;
      if (occupied.has(key)) continue;
      if (!isPassable(terrainData, mapLayout[r][c], 'Infantry')) continue;
      const minDist = Math.min(...allSpawns.map(s => Math.abs(s.col - c) + Math.abs(s.row - r)));
      if (minDist >= 3) candidates.push({ col: c, row: r });
    }
  }

  let pos;
  if (candidates.length > 0) {
    pos = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    // Fallback: any passable tile in middle third
    const fallback = [];
    for (let r = 0; r < rows; r++) {
      for (let c = midStartCol; c < midEndCol; c++) {
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
  }

  return {
    className: recruit.className,
    name: recruit.name,
    level,
    col: pos.col,
    row: pos.row,
  };
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
