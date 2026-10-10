// ReinforcementScheduler.js - Pure deterministic reinforcement scheduling helpers.
// No scene dependencies.

export const REINFORCEMENT_EDGES = Object.freeze(['left', 'right', 'top', 'bottom']);
const EDGE_SET = new Set(REINFORCEMENT_EDGES);

// Terrain a procedural arrival never lands on: it hurts on arrival or belongs to
// another rule (FormationPlacement keeps the same list for spare tiles). Authored
// (scripted) placements are trusted.
export const REINFORCEMENT_EXCLUDED_TERRAIN = Object.freeze(
  new Set(['Lava Crack', 'Acidic Swamp', 'Acidic Bog', 'Throne', 'Ballista', 'Village']),
);

// The rout reinforcement ladder (docs/specs/dusk-pressure.md, engine/RoutLadder.js).
export const LADDER_WAVE_TYPE = 'ladder';

// The Hunted burden's extra wave (engine/Burdens.js, docs/specs/event-nodes-phase2.md §2B):
// written into the battle config as `reinforcements.hunted` when the battle is generated.
export const HUNTED_WAVE_TYPE = 'hunted';
const HUNTED_WAVE_INDEX = 3000;

// Wave types that are the battle's clock rather than an added objective: their
// arrivals never raise par. Repeating pursuit waves (escape maps), the rout ladder and the
// Hunted burden's wave (a price, not a puzzle: it must not buy the player a turn).
export const PAR_NEUTRAL_WAVE_TYPES = Object.freeze(
  new Set(['repeating', LADDER_WAVE_TYPE, HUNTED_WAVE_TYPE]),
);

/**
 * Whether the wave a spawned arrival belongs to raises the battle's par by one.
 * Procedural template waves are par-neutral when their battle config says so
 * (`reinforcements.wavesRaisePar: false`, Black Sun); the scheduler marks them.
 */
export function waveRaisesPar(spawn) {
  return (
    spawn?.waveIndex != null &&
    spawn.parNeutral !== true &&
    !PAR_NEUTRAL_WAVE_TYPES.has(spawn.waveType)
  );
}

/**
 * How much par rises for these arrivals: one per distinct wave that raises par
 * (BattleScene and the headless harness both apply it to turnPar).
 */
export function parRaiseForArrivals(spawns) {
  const waves = new Set();
  for (const spawn of spawns || []) {
    if (waveRaisesPar(spawn)) waves.add(`${spawn.waveType || 'procedural'}:${spawn.waveIndex}`);
  }
  return waves.size;
}

/**
 * The move types a procedural arrival can have: the classes of the reinforcement
 * template pool (an arrival copies one of them after its tile is chosen, so the tile
 * must suit all of them). Infantry when the pool names no known class.
 */
export function reinforcementMoveTypes(templates, classes) {
  const types = new Set();
  for (const template of templates || []) {
    const moveType = (classes || []).find((c) => c.name === template?.className)?.moveType;
    if (moveType) types.add(moveType);
  }
  return types.size ? [...types].sort() : ['Infantry'];
}

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

function isPassableForAll(terrain, mapLayout, col, row, moveTypes) {
  return moveTypes.every((moveType) => isPassable(terrain, mapLayout, col, row, moveType));
}

function isExcludedTerrain(terrain, mapLayout, col, row) {
  return REINFORCEMENT_EXCLUDED_TERRAIN.has(terrain?.[mapLayout?.[row]?.[col]]?.name);
}

function normalizeMoveTypes(moveTypes, moveType) {
  const list = Array.isArray(moveTypes) ? moveTypes.filter((m) => typeof m === 'string') : [];
  return list.length ? list : [moveType || 'Infantry'];
}

function getInwardNeighbor(edge, col, row) {
  switch (edge) {
    case 'left':
      return { col: col + 1, row };
    case 'right':
      return { col: col - 1, row };
    case 'top':
      return { col, row: row + 1 };
    case 'bottom':
      return { col, row: row - 1 };
    default:
      return null;
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

export function getReinforcementTurnJitter(reinforcements) {
  const range = reinforcements?.turnJitter;
  if (!Array.isArray(range) || range.length !== 2) return [0, 0];
  let minDelta = normalizeInteger(range[0], 0);
  let maxDelta = normalizeInteger(range[1], 0);
  if (maxDelta < minDelta) {
    [minDelta, maxDelta] = [maxDelta, minDelta];
  }
  return [minDelta, maxDelta];
}

function getXpMultiplier(reinforcements, waveIndex) {
  const xpDecay = Array.isArray(reinforcements?.xpDecay) ? reinforcements.xpDecay : null;
  if (!xpDecay || xpDecay.length === 0) return 1.0;
  const i = Math.min(waveIndex, xpDecay.length - 1);
  return xpDecay[i];
}

function getScriptedWaveXpMultiplier(reinforcements, scriptedWave, scriptedWaveIndex) {
  if (Number.isFinite(scriptedWave?.xpMultiplier)) return scriptedWave.xpMultiplier;
  return getXpMultiplier(reinforcements, scriptedWaveIndex);
}

function mixSeed(baseSeed, salt) {
  let x = (baseSeed >>> 0) ^ ((salt + 0x9e3779b9) >>> 0);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function createSeededRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollWaveTurnJitter({ seed = 0, waveIndex = 0, turnJitter = [0, 0] } = {}) {
  const [minDelta, maxDelta] =
    Array.isArray(turnJitter) && turnJitter.length === 2 ? turnJitter : [0, 0];
  const min = normalizeInteger(minDelta, 0);
  const max = normalizeInteger(maxDelta, min);
  if (max <= min) return min;

  const waveSeed = mixSeed(normalizeInteger(seed, 0), normalizeInteger(waveIndex, 0));
  const rng = createSeededRng(waveSeed);
  return min + Math.floor(rng() * (max - min + 1));
}

export function resolveScheduledTurn({
  baseTurn,
  totalOffset = 0,
  seed = 0,
  waveIndex = 0,
  turnJitter = [0, 0],
} = {}) {
  const normalizedBaseTurn = normalizeInteger(baseTurn, 0);
  if (normalizedBaseTurn <= 0) return 0;
  const jitter = rollWaveTurnJitter({ seed, waveIndex, turnJitter });
  return Math.max(1, normalizedBaseTurn + normalizeInteger(totalOffset, 0) + jitter);
}

export function getDueReinforcementWaves({
  turn,
  seed = 0,
  reinforcements,
  difficultyId = 'normal',
  difficultyTurnOffset = 0,
} = {}) {
  const currentTurn = normalizeInteger(turn, 0);
  if (currentTurn <= 0 || !reinforcements || !Array.isArray(reinforcements.waves)) return [];

  const globalOffset = normalizeInteger(difficultyTurnOffset, 0);
  const templateOffset = getTemplateTurnOffset(reinforcements, difficultyId);
  const totalOffset = globalOffset + templateOffset;
  const turnJitter = getReinforcementTurnJitter(reinforcements);

  const due = [];
  for (let waveIndex = 0; waveIndex < reinforcements.waves.length; waveIndex++) {
    const wave = reinforcements.waves[waveIndex];
    const baseTurn = normalizeInteger(wave?.turn, 0);
    if (baseTurn <= 0) continue;
    const scheduledTurn = resolveScheduledTurn({
      baseTurn,
      totalOffset,
      seed,
      waveIndex,
      turnJitter,
    });
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

// Repeating waves (pursuit pressure on escape maps): spawn on a fixed cadence
// with no end turn, so the map can never be farmed clean. No jitter — the
// cadence itself is the contract. Capped by maxActiveEnemies so a stalled
// battle cannot grow without bound.
const REPEATING_WAVE_DEFAULT_MAX_ACTIVE = 20;
const REPEATING_WAVE_INDEX_BASE = 1000;

function getRepeatingWaveXpMultiplier(reinforcements, repeatingWave) {
  if (Number.isFinite(repeatingWave?.xpMultiplier)) return repeatingWave.xpMultiplier;
  const xpDecay = Array.isArray(reinforcements?.xpDecay) ? reinforcements.xpDecay : null;
  if (!xpDecay || xpDecay.length === 0) return 1.0;
  return xpDecay[xpDecay.length - 1];
}

export function getDueRepeatingReinforcementWaves({
  turn,
  reinforcements,
  difficultyId = 'normal',
  difficultyTurnOffset = 0,
  activeEnemyCount = 0,
} = {}) {
  const currentTurn = normalizeInteger(turn, 0);
  if (currentTurn <= 0 || !reinforcements || !Array.isArray(reinforcements.repeatingWaves))
    return [];

  const globalOffset = normalizeInteger(difficultyTurnOffset, 0);
  const templateOffset = getTemplateTurnOffset(reinforcements, difficultyId);
  const totalOffset = globalOffset + templateOffset;
  const enemyCount = Math.max(0, normalizeInteger(activeEnemyCount, 0));

  const due = [];
  for (let defIndex = 0; defIndex < reinforcements.repeatingWaves.length; defIndex++) {
    const wave = reinforcements.repeatingWaves[defIndex];
    const startTurn = normalizeInteger(wave?.startTurn, 0);
    const every = normalizeInteger(wave?.every, 0);
    if (startTurn <= 0 || every <= 0) continue;

    const effectiveStart = Math.max(1, startTurn + totalOffset);
    if (currentTurn < effectiveStart || (currentTurn - effectiveStart) % every !== 0) continue;

    const maxActive = Number.isFinite(wave?.maxActiveEnemies)
      ? Math.max(1, Math.trunc(wave.maxActiveEnemies))
      : REPEATING_WAVE_DEFAULT_MAX_ACTIVE;
    if (enemyCount >= maxActive) continue;

    const occurrence = (currentTurn - effectiveStart) / every;
    due.push({
      waveType: 'repeating',
      waveIndex: REPEATING_WAVE_INDEX_BASE + defIndex * 100 + occurrence,
      baseTurn: startTurn,
      scheduledTurn: currentTurn,
      wave,
      xpMultiplier: getRepeatingWaveXpMultiplier(reinforcements, wave),
      // Hard cap: the rolled count (incl. difficulty bonus) may not push the
      // active enemy total past maxActiveEnemies.
      maxSpawnable: maxActive - enemyCount,
    });
  }
  return due;
}

function getDueScriptedReinforcementWaves({
  turn,
  reinforcements,
  difficultyId = 'normal',
  difficultyTurnOffset = 0,
} = {}) {
  const currentTurn = normalizeInteger(turn, 0);
  if (currentTurn <= 0 || !reinforcements || !Array.isArray(reinforcements.scriptedWaves))
    return [];

  const globalOffset = normalizeInteger(difficultyTurnOffset, 0);
  const templateOffset = getTemplateTurnOffset(reinforcements, difficultyId);
  const totalOffset = globalOffset + templateOffset;

  const due = [];
  for (
    let scriptedWaveIndex = 0;
    scriptedWaveIndex < reinforcements.scriptedWaves.length;
    scriptedWaveIndex++
  ) {
    const scriptedWave = reinforcements.scriptedWaves[scriptedWaveIndex];
    const baseTurn = normalizeInteger(scriptedWave?.turn, 0);
    if (baseTurn <= 0) continue;
    const scheduledTurn = Math.max(1, baseTurn + totalOffset);
    if (scheduledTurn !== currentTurn) continue;
    due.push({
      waveType: 'scripted',
      waveIndex: scriptedWaveIndex,
      baseTurn,
      scheduledTurn,
      wave: scriptedWave,
      xpMultiplier: getScriptedWaveXpMultiplier(reinforcements, scriptedWave, scriptedWaveIndex),
    });
  }
  return due;
}

/**
 * Edge tiles a procedural arrival may take: free, not on excluded terrain, and
 * standable for every move type in `moveTypes` (default: `moveType`), with an inward
 * neighbour they can all step onto next turn.
 */
export function collectEdgeSpawnCandidates({
  edge,
  mapLayout,
  terrain,
  occupied = [],
  moveType = 'Infantry',
  moveTypes = null,
} = {}) {
  const rows = Array.isArray(mapLayout) ? mapLayout.length : 0;
  const cols = rows > 0 && Array.isArray(mapLayout[0]) ? mapLayout[0].length : 0;
  const occupiedSet = normalizeOccupiedSet(occupied);
  const types = normalizeMoveTypes(moveTypes, moveType);
  const tiles = getEdgeTiles(edge, cols, rows);
  const candidates = [];

  for (const tile of tiles) {
    const { col, row } = tile;
    const key = toTileKey(col, row);
    if (occupiedSet.has(key)) continue;
    if (isExcludedTerrain(terrain, mapLayout, col, row)) continue;
    if (!isPassableForAll(terrain, mapLayout, col, row, types)) continue;

    // Edge spawns must be able to step into the map on the next turn.
    const inward = getInwardNeighbor(edge, col, row);
    if (!inward || !isInBounds(inward.col, inward.row, cols, rows)) continue;
    const inwardKey = toTileKey(inward.col, inward.row);
    if (occupiedSet.has(inwardKey)) continue;
    if (!isPassableForAll(terrain, mapLayout, inward.col, inward.row, types)) continue;

    candidates.push({ col, row });
  }

  candidates.sort((a, b) => a.row - b.row || a.col - b.col);
  return candidates;
}

// The rout ladder (engine/RoutLadder.js writes it into the battle config at generation):
// absolute turns (no difficulty offset, no jitter, no count bonus), one edge per wave. Only a
// blessing's delay (Hollow Hourglass, `turnDelay`) moves them: every wave a turn later.
const LADDER_DEFAULT_MIN_PLAYER_DISTANCE = 3;
const LADDER_DEFAULT_NPC_DISTANCE = 1;

function getDueLadderWaves({ turn, reinforcements, turnDelay = 0 } = {}) {
  const currentTurn = normalizeInteger(turn, 0);
  const waves = reinforcements?.ladder?.waves;
  if (currentTurn <= 0 || !Array.isArray(waves)) return [];
  const delay = Math.max(0, normalizeInteger(turnDelay, 0));
  const due = [];
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
    const wave = waves[waveIndex];
    const baseTurn = normalizeInteger(wave?.turn, 0);
    const scheduledTurn = baseTurn + delay;
    if (baseTurn <= 0 || scheduledTurn !== currentTurn) continue;
    due.push({
      waveType: LADDER_WAVE_TYPE,
      waveIndex,
      baseTurn,
      scheduledTurn,
      wave,
      xpMultiplier: Number.isFinite(wave?.xpMultiplier) ? wave.xpMultiplier : 0,
    });
  }
  return due;
}

// The Hunted wave: one absolute turn (no difficulty offset, no jitter, no count bonus: the
// burden resolved its numbers when it was taken), edges named by the wave itself. A blessing's
// delay (Hollow Hourglass, `turnDelay`) moves it a turn later like every other wave.
function getDueHuntedWaves({ turn, reinforcements, turnDelay = 0 } = {}) {
  const currentTurn = normalizeInteger(turn, 0);
  const wave = reinforcements?.hunted;
  if (currentTurn <= 0 || !wave || typeof wave !== 'object') return [];
  const baseTurn = normalizeInteger(wave.turn, 0);
  const scheduledTurn = baseTurn + Math.max(0, normalizeInteger(turnDelay, 0));
  if (baseTurn <= 0 || scheduledTurn !== currentTurn) return [];
  return [
    {
      waveType: HUNTED_WAVE_TYPE,
      waveIndex: HUNTED_WAVE_INDEX,
      baseTurn,
      scheduledTurn,
      wave,
      xpMultiplier: Number.isFinite(wave.xpMultiplier) ? wave.xpMultiplier : 0.5,
    },
  ];
}

/** Tiles within `distance` (Manhattan) of any of `tiles`, as "col,row" keys. */
function tilesWithin(tiles, distance) {
  const keys = new Set();
  const d = Math.max(0, normalizeInteger(distance, 0));
  for (const tile of tiles || []) {
    if (!Number.isFinite(tile?.col) || !Number.isFinite(tile?.row)) continue;
    for (let dc = -d; dc <= d; dc++) {
      const span = d - Math.abs(dc);
      for (let dr = -span; dr <= span; dr++) keys.add(toTileKey(tile.col + dc, tile.row + dr));
    }
  }
  return keys;
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
  moveTypes = null,
  classMoveType = null,
  difficultyId = 'normal',
  difficultyTurnOffset = 0,
  turnDelay = 0,
  enemyCountBonus = 0,
  activeEnemyCount = 0,
  playerTiles = [],
  npcTiles = [],
  promotedMoveTypes = null,
} = {}) {
  // A blessing's delay (Hollow Hourglass) moves every kind of wave: the offset the template,
  // scripted and repeating waves already read, and the ladder's and Hunted's absolute turns.
  const delay = Math.max(0, normalizeInteger(turnDelay, 0));
  difficultyTurnOffset = normalizeInteger(difficultyTurnOffset, 0) + delay;
  const dueWaves = getDueReinforcementWaves({
    turn,
    seed,
    reinforcements,
    difficultyId,
    difficultyTurnOffset,
  });
  const dueScriptedWaves = getDueScriptedReinforcementWaves({
    turn,
    reinforcements,
    difficultyId,
    difficultyTurnOffset,
  });
  const dueRepeatingWaves = getDueRepeatingReinforcementWaves({
    turn,
    reinforcements,
    difficultyId,
    difficultyTurnOffset,
    activeEnemyCount,
  });
  const dueLadderWaves = getDueLadderWaves({ turn, reinforcements, turnDelay: delay });
  const dueHuntedWaves = getDueHuntedWaves({ turn, reinforcements, turnDelay: delay });
  if (
    dueWaves.length === 0 &&
    dueScriptedWaves.length === 0 &&
    dueRepeatingWaves.length === 0 &&
    dueLadderWaves.length === 0 &&
    dueHuntedWaves.length === 0
  ) {
    return { spawns: [], dueWaves: [], blockedSpawns: 0 };
  }

  const turnSeed = mixSeed(normalizeInteger(seed, 0), normalizeInteger(turn, 0));
  const rng = createSeededRng(turnSeed);
  const spawnedKeys = new Set();
  const baseOccupied = normalizeOccupiedSet(occupied);
  const spawns = [];
  const waveResults = [];
  let blockedSpawns = 0;

  // Scripted waves resolve first on a shared due turn, so authored placements
  // reserve tiles before procedural edge sampling runs.
  for (const due of dueScriptedWaves) {
    const requestedCount = Array.isArray(due.wave?.spawns) ? due.wave.spawns.length : 0;
    let spawnedCount = 0;

    for (const rawSpawn of due.wave?.spawns || []) {
      const col = normalizeInteger(rawSpawn?.col, -1);
      const row = normalizeInteger(rawSpawn?.row, -1);
      const occupiedNow = new Set([...baseOccupied, ...spawnedKeys]);
      const key = toTileKey(col, row);
      // An authored placement must suit the class it names (classMoveType), else Infantry.
      const placedMoveType =
        (typeof rawSpawn?.className === 'string' && classMoveType?.(rawSpawn.className)) ||
        moveType;
      const legal =
        isInBounds(col, row, mapLayout?.[0]?.length || 0, mapLayout?.length || 0) &&
        !occupiedNow.has(key) &&
        isPassable(terrain, mapLayout, col, row, placedMoveType);
      if (!legal) {
        blockedSpawns++;
        continue;
      }

      const scriptedSpawn = {
        col,
        row,
        waveType: 'scripted',
        waveIndex: due.waveIndex,
        scheduledTurn: due.scheduledTurn,
        xpMultiplier: due.xpMultiplier,
      };
      if (typeof rawSpawn.className === 'string') scriptedSpawn.className = rawSpawn.className;
      if (Number.isFinite(rawSpawn.level))
        scriptedSpawn.level = normalizeInteger(rawSpawn.level, 1);
      if (typeof rawSpawn.sunderWeapon === 'boolean')
        scriptedSpawn.sunderWeapon = rawSpawn.sunderWeapon;
      if (typeof rawSpawn.poisonWeapon === 'boolean')
        scriptedSpawn.poisonWeapon = rawSpawn.poisonWeapon;
      if (typeof rawSpawn.aiMode === 'string') scriptedSpawn.aiMode = rawSpawn.aiMode;
      if (
        rawSpawn.aiTargetTile &&
        Number.isFinite(rawSpawn.aiTargetTile.col) &&
        Number.isFinite(rawSpawn.aiTargetTile.row)
      ) {
        scriptedSpawn.aiTargetTile = {
          col: Math.trunc(rawSpawn.aiTargetTile.col),
          row: Math.trunc(rawSpawn.aiTargetTile.row),
        };
      }
      if (Array.isArray(rawSpawn.affixes)) scriptedSpawn.affixes = [...rawSpawn.affixes];
      spawns.push(scriptedSpawn);
      spawnedKeys.add(key);
      spawnedCount++;
    }

    waveResults.push({
      waveType: 'scripted',
      waveIndex: due.waveIndex,
      scheduledTurn: due.scheduledTurn,
      xpMultiplier: due.xpMultiplier,
      edges: [],
      requestedCount,
      spawnedCount,
      blockedCount: requestedCount - spawnedCount,
    });
  }

  for (const due of [...dueWaves, ...dueRepeatingWaves]) {
    const waveType = due.waveType || 'procedural';
    const edges = resolveWaveEdges(reinforcements, due.wave);
    const scaledCountBonus = reinforcements?.difficultyScaling
      ? normalizeInteger(enemyCountBonus, 0)
      : 0;
    // Roll before clamping so the RNG draw count stays seed-stable.
    const rolledCount = rollWaveCount(due.wave, rng, scaledCountBonus);
    // maxSpawnable was computed against the active count when the call began;
    // subtract enemies already spawned this call (scripted/fixed/repeating)
    // so multiple due waves can't jointly push past maxActiveEnemies.
    const requestedCount = Number.isFinite(due.maxSpawnable)
      ? Math.max(0, Math.min(rolledCount, due.maxSpawnable - spawns.length))
      : rolledCount;

    let spawnedCount = 0;
    for (let i = 0; i < requestedCount; i++) {
      // Recompute candidate pools after every spawn so inward-neighbor legality
      // stays accurate as newly spawned edge tiles become occupied.
      const occupiedNow = new Set([...baseOccupied, ...spawnedKeys]);
      const edgePools = new Map();
      for (const edge of edges) {
        edgePools.set(
          edge,
          collectEdgeSpawnCandidates({
            edge,
            mapLayout,
            terrain,
            occupied: occupiedNow,
            moveType,
            moveTypes,
          }),
        );
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

      const spawn = {
        col: chosenTile.col,
        row: chosenTile.row,
        edge: chosenEdge,
        waveType,
        waveIndex: due.waveIndex,
        scheduledTurn: due.scheduledTurn,
        xpMultiplier: due.xpMultiplier,
      };
      // Black Sun: the template's procedural waves keep coming but no longer raise par.
      if (waveType === 'procedural' && reinforcements?.wavesRaisePar === false)
        spawn.parNeutral = true;
      spawns.push(spawn);
      spawnedKeys.add(chosenKey);
      spawnedCount++;
    }

    waveResults.push({
      waveType,
      waveIndex: due.waveIndex,
      scheduledTurn: due.scheduledTurn,
      xpMultiplier: due.xpMultiplier,
      edges,
      requestedCount,
      spawnedCount,
      blockedCount: requestedCount - spawnedCount,
    });
  }

  // The rout ladder: each wave comes from one edge (wave 1 the front, later waves the
  // flanks), its arrivals drawn along that edge, never within `minPlayerDistance` of a
  // player unit or `npcDistance` of an NPC (the caravan included). A flank the exclusions
  // leave empty as its wave begins sends the whole wave to the front instead; arrivals
  // the wave's edge cannot take are blocked.
  if (dueLadderWaves.length > 0) {
    const ladder = reinforcements.ladder;
    const front = EDGE_SET.has(ladder.front) ? ladder.front : null;
    const reserved = new Set([
      ...tilesWithin(
        playerTiles,
        Number.isFinite(ladder.minPlayerDistance)
          ? ladder.minPlayerDistance
          : LADDER_DEFAULT_MIN_PLAYER_DISTANCE,
      ),
      ...tilesWithin(
        npcTiles,
        Number.isFinite(ladder.npcDistance) ? ladder.npcDistance : LADDER_DEFAULT_NPC_DISTANCE,
      ),
    ]);
    // A promoted wave's arrival copies a class from the act's promoted pool, so its tile
    // must suit those move types as well.
    const promotedTypes = [
      ...new Set([...normalizeMoveTypes(moveTypes, moveType), ...(promotedMoveTypes || [])]),
    ].sort();
    const candidatesOn = (edge, promoted) =>
      collectEdgeSpawnCandidates({
        edge,
        mapLayout,
        terrain,
        occupied: new Set([...baseOccupied, ...spawnedKeys]),
        moveType,
        moveTypes: promoted ? promotedTypes : moveTypes,
      }).filter((tile) => !reserved.has(toTileKey(tile.col, tile.row)));

    for (const due of dueLadderWaves) {
      const edge = EDGE_SET.has(due.wave?.edge) ? due.wave.edge : front;
      const requestedCount = rollWaveCount(due.wave, rng, 0);
      const levelBonus = Math.max(0, normalizeInteger(due.wave?.levelBonus, 0));
      const promoted = due.wave?.promoted === true;
      // The whole wave comes from one edge: its own, or the front when the exclusions
      // leave its own empty as the wave begins.
      let usedEdge = edge;
      if (usedEdge && front && usedEdge !== front && candidatesOn(usedEdge, promoted).length === 0)
        usedEdge = front;
      let spawnedCount = 0;
      for (let i = 0; i < requestedCount; i++) {
        const pool = usedEdge ? candidatesOn(usedEdge, promoted) : [];
        if (pool.length === 0) {
          blockedSpawns++;
          continue;
        }
        const tile = pool[Math.floor(rng() * pool.length)];
        const spawn = {
          col: tile.col,
          row: tile.row,
          edge: usedEdge,
          waveType: LADDER_WAVE_TYPE,
          waveIndex: due.waveIndex,
          scheduledTurn: due.scheduledTurn,
          xpMultiplier: due.xpMultiplier,
        };
        if (levelBonus > 0) spawn.levelBonus = levelBonus;
        if (promoted) spawn.promoted = true;
        spawns.push(spawn);
        spawnedKeys.add(toTileKey(tile.col, tile.row));
        spawnedCount++;
      }
      waveResults.push({
        waveType: LADDER_WAVE_TYPE,
        waveIndex: due.waveIndex,
        scheduledTurn: due.scheduledTurn,
        xpMultiplier: due.xpMultiplier,
        edges: edge ? [edge] : [],
        requestedCount,
        spawnedCount,
        blockedCount: requestedCount - spawnedCount,
      });
    }
  }

  // The Hunted wave comes last, so a turn that already had waves draws exactly as before: its
  // arrivals take whatever the other waves left free on its own edges.
  for (const due of dueHuntedWaves) {
    const edges = normalizeEdgeList(due.wave?.edges);
    const requestedCount = rollWaveCount(due.wave, rng, 0);
    let spawnedCount = 0;
    for (let i = 0; i < requestedCount; i++) {
      const occupiedNow = new Set([...baseOccupied, ...spawnedKeys]);
      const pools = new Map(
        edges.map((edge) => [
          edge,
          collectEdgeSpawnCandidates({
            edge,
            mapLayout,
            terrain,
            occupied: occupiedNow,
            moveType,
            moveTypes,
          }),
        ]),
      );
      const open = edges.filter((edge) => (pools.get(edge)?.length || 0) > 0);
      if (open.length === 0) {
        blockedSpawns++;
        continue;
      }
      const edge = open[Math.floor(rng() * open.length)];
      const pool = pools.get(edge);
      const tile = pool[Math.floor(rng() * pool.length)];
      spawns.push({
        col: tile.col,
        row: tile.row,
        edge,
        waveType: HUNTED_WAVE_TYPE,
        waveIndex: due.waveIndex,
        scheduledTurn: due.scheduledTurn,
        xpMultiplier: due.xpMultiplier,
        parNeutral: true,
      });
      spawnedKeys.add(toTileKey(tile.col, tile.row));
      spawnedCount++;
    }
    waveResults.push({
      waveType: HUNTED_WAVE_TYPE,
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
