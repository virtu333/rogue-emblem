// ReinforcementScheduler.js - Pure deterministic reinforcement scheduling helpers.
// No scene dependencies.

export const REINFORCEMENT_EDGES = Object.freeze(['left', 'right', 'top', 'bottom']);
const EDGE_SET = new Set(REINFORCEMENT_EDGES);

function toTileKey(col, row) {
  return `${col},${row}`;
}

function normalizeInteger(value, fallback = 0) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeEdgeList(edges) {
  if (!Array.isArray(edges)) return [];
  const unique = [];
  const seen = new Set();
  for (const edge of edges) {
    if (!EDGE_SET.has(edge) || seen.has(edge)) continue;
    seen.add(edge);
    unique.push(edge);
  }
  return unique;
}

function isInBounds(col, row, cols, rows) {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

function isPassable(terrain, mapLayout, col, row, moveType = 'Infantry') {
  const terrainIndex = mapLayout?.[row]?.[col];
  const tile = terrain?.[terrainIndex];
  if (!tile) return false;
  const cost = tile.moveCost?.[moveType];
  return cost !== '--' && !Number.isNaN(parseInt(cost, 10));
}

function getInwardNeighbor(edge, col, row) {
  switch (edge) {
    case 'left': return { col: col + 1, row };
    case 'right': return { col: col - 1, row };
    case 'top': return { col, row: row + 1 };
    case 'bottom': return { col, row: row - 1 };
    default: return null;
  }
}

function normalizeOccupiedSet(occupied) {
  const set = new Set();
  if (!occupied) return set;

  const pushKey = (value) => {
    if (typeof value === 'string') {
      set.add(value);
      return;
    }
    if (value && Number.isFinite(value.col) && Number.isFinite(value.row)) {
      set.add(toTileKey(value.col, value.row));
    }
  };

  if (occupied instanceof Set) {
    for (const entry of occupied) pushKey(entry);
    return set;
  }
  if (Array.isArray(occupied)) {
    for (const entry of occupied) pushKey(entry);
  }
  return set;
}

function getEdgeTiles(edge, cols, rows) {
  const tiles = [];
  if (cols <= 0 || rows <= 0) return tiles;

  switch (edge) {
    case 'left':
      for (let row = 0; row < rows; row++) tiles.push({ col: 0, row });
      break;
    case 'right':
      for (let row = 0; row < rows; row++) tiles.push({ col: cols - 1, row });
      break;
    case 'top':
      for (let col = 0; col < cols; col++) tiles.push({ col, row: 0 });
      break;
    case 'bottom':
      for (let col = 0; col < cols; col++) tiles.push({ col, row: rows - 1 });
      break;
    default:
      break;
  }
  return tiles;
}

function resolveWaveEdges(reinforcements, wave) {
  const waveEdges = normalizeEdgeList(wave?.edges);
  if (waveEdges.length > 0) return waveEdges;
  return normalizeEdgeList(reinforcements?.spawnEdges);
}

function getTemplateTurnOffset(reinforcements, difficultyId) {
  if (!reinforcements?.difficultyScaling) return 0;
  return normalizeInteger(reinforcements?.turnOffsetByDifficulty?.[difficultyId], 0);
}

function getXpMultiplier(reinforcements, waveIndex) {
  const xpDecay = Array.isArray(reinforcements?.xpDecay) ? reinforcements.xpDecay : null;
  if (!xpDecay || xpDecay.length === 0) return 1.0;
  const i = Math.min(waveIndex, xpDecay.length - 1);
  return xpDecay[i];
}

function mixSeed(baseSeed, salt) {
  let x = (baseSeed >>> 0) ^ ((salt + 0x9E3779B9) >>> 0);
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B);
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function createSeededRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDueReinforcementWaves({
  turn,
  reinforcements,
  difficultyId = 'normal',
  difficultyTurnOffset = 0,
} = {}) {
  const currentTurn = normalizeInteger(turn, 0);
  if (currentTurn <= 0 || !reinforcements || !Array.isArray(reinforcements.waves)) return [];

  const globalOffset = normalizeInteger(difficultyTurnOffset, 0);
  const templateOffset = getTemplateTurnOffset(reinforcements, difficultyId);
  const totalOffset = globalOffset + templateOffset;

  const due = [];
  for (let waveIndex = 0; waveIndex < reinforcements.waves.length; waveIndex++) {
    const wave = reinforcements.waves[waveIndex];
    const baseTurn = normalizeInteger(wave?.turn, 0);
    if (baseTurn <= 0) continue;
    const scheduledTurn = Math.max(1, baseTurn + totalOffset);
    if (scheduledTurn !== currentTurn) continue;
    due.push({
      waveIndex,
      baseTurn,
      scheduledTurn,
      wave,
      xpMultiplier: getXpMultiplier(reinforcements, waveIndex),
    });
  }
  return due;
}

export function collectEdgeSpawnCandidates({
  edge,
  mapLayout,
  terrain,
  occupied = [],
  moveType = 'Infantry',
} = {}) {
  const rows = Array.isArray(mapLayout) ? mapLayout.length : 0;
  const cols = rows > 0 && Array.isArray(mapLayout[0]) ? mapLayout[0].length : 0;
  const occupiedSet = normalizeOccupiedSet(occupied);
  const tiles = getEdgeTiles(edge, cols, rows);
  const candidates = [];

  for (const tile of tiles) {
    const { col, row } = tile;
    const key = toTileKey(col, row);
    if (occupiedSet.has(key)) continue;
    if (!isPassable(terrain, mapLayout, col, row, moveType)) continue;

    // Edge spawns must be able to step into the map on the next turn.
    const inward = getInwardNeighbor(edge, col, row);
    if (!inward || !isInBounds(inward.col, inward.row, cols, rows)) continue;
    const inwardKey = toTileKey(inward.col, inward.row);
    if (occupiedSet.has(inwardKey)) continue;
    if (!isPassable(terrain, mapLayout, inward.col, inward.row, moveType)) continue;

    candidates.push({ col, row });
  }

  candidates.sort((a, b) => (a.row - b.row) || (a.col - b.col));
  return candidates;
}

function rollWaveCount(wave, rng, countBonus = 0) {
  const range = Array.isArray(wave?.count) ? wave.count : [0, 0];
  const min = normalizeInteger(range[0], 0);
  const max = normalizeInteger(range[1], min);
  if (max < min) return 0;
  const rolled = min + Math.floor(rng() * (max - min + 1));
  return Math.max(0, rolled + normalizeInteger(countBonus, 0));
}

export function scheduleReinforcementsForTurn({
  turn,
  seed = 0,
  reinforcements,
  mapLayout,
  terrain,
  occupied = [],
  moveType = 'Infantry',
  difficultyId = 'normal',
  difficultyTurnOffset = 0,
  enemyCountBonus = 0,
} = {}) {
  const dueWaves = getDueReinforcementWaves({
    turn,
    reinforcements,
    difficultyId,
    difficultyTurnOffset,
  });
  if (dueWaves.length === 0) {
    return { spawns: [], dueWaves: [], blockedSpawns: 0 };
  }

  const turnSeed = mixSeed(normalizeInteger(seed, 0), normalizeInteger(turn, 0));
  const rng = createSeededRng(turnSeed);
  const spawnedKeys = new Set();
  const baseOccupied = normalizeOccupiedSet(occupied);
  const spawns = [];
  const waveResults = [];
  let blockedSpawns = 0;

  for (const due of dueWaves) {
    const edges = resolveWaveEdges(reinforcements, due.wave);
    const scaledCountBonus = reinforcements?.difficultyScaling ? normalizeInteger(enemyCountBonus, 0) : 0;
    const requestedCount = rollWaveCount(due.wave, rng, scaledCountBonus);

    let spawnedCount = 0;
    for (let i = 0; i < requestedCount; i++) {
      // Recompute candidate pools after every spawn so inward-neighbor legality
      // stays accurate as newly spawned edge tiles become occupied.
      const occupiedNow = new Set([...baseOccupied, ...spawnedKeys]);
      const edgePools = new Map();
      for (const edge of edges) {
        edgePools.set(edge, collectEdgeSpawnCandidates({
          edge,
          mapLayout,
          terrain,
          occupied: occupiedNow,
          moveType,
        }));
      }

      const availableEdges = edges.filter((edge) => (edgePools.get(edge)?.length || 0) > 0);
      if (availableEdges.length === 0) {
        blockedSpawns++;
        continue;
      }

      const chosenEdge = availableEdges[Math.floor(rng() * availableEdges.length)];
      const pool = edgePools.get(chosenEdge);
      const choiceIndex = Math.floor(rng() * pool.length);
      const chosenTile = pool[choiceIndex];
      const chosenKey = toTileKey(chosenTile.col, chosenTile.row);

      spawns.push({
        col: chosenTile.col,
        row: chosenTile.row,
        edge: chosenEdge,
        waveIndex: due.waveIndex,
        scheduledTurn: due.scheduledTurn,
        xpMultiplier: due.xpMultiplier,
      });
      spawnedKeys.add(chosenKey);
      spawnedCount++;
    }

    waveResults.push({
      waveIndex: due.waveIndex,
      scheduledTurn: due.scheduledTurn,
      xpMultiplier: due.xpMultiplier,
      edges,
      requestedCount,
      spawnedCount,
      blockedCount: requestedCount - spawnedCount,
    });
  }

  return {
    spawns,
    dueWaves: waveResults,
    blockedSpawns,
  };
}
