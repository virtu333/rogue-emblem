// VillageSystem.js — Village & bandit secondary objective pure logic.
// Spawn roll, village tile placement, bandit race calibration, and the
// intact/visited/razed state machine. No Phaser deps — BattleScene wiring
// lives in ui/VillageController.js (mirrors the CaravanSystem/CaravanController
// split from the Merchant Caravan micro-objective).
//
// Design intent (docs/design-log.md 2026-07-04): secondary objectives pay in a
// different currency than kills — gold + a convoy item, never XP — so a second
// flank is rewarded without competing with the juggernaut's XP income.

import {
  VILLAGE_SPAWN_CHANCE,
  VILLAGE_ELIGIBLE_ACTS,
  VILLAGE_GOLD_BY_ACT,
  VILLAGE_BANDIT_COUNT,
  VILLAGE_BANDIT_XP_MULTIPLIER,
  VILLAGE_BANDIT_DISTANCE_MARGIN,
} from '../utils/constants.js';

export const VILLAGE_STATUS = Object.freeze({
  INTACT: 'intact',
  VISITED: 'visited',
  RAZED: 'razed',
});

/**
 * Decide whether this BATTLE node should spawn a village. Called at
 * battleParams-build time (NodeMapGenerator) so the result is baked into
 * node.battleParams — deterministic and suspend/revert-safe, exactly like the
 * caravan roll beside it.
 *
 * Gating: rout/seize objectives only (never escape), acts 1-4, never on
 * recruit/boss/ambush/tutorial/colosseum battles, and mutually exclusive with
 * the Merchant Caravan — max one micro-objective per map (design-log decision).
 * @param {object} params - { act, objective, isRecruitBattle?, isBoss?, isAmbush?, hasCaravan? }
 * @param {function} [rng=Math.random]
 * @returns {boolean}
 */
export function rollVillageSpawn(params, rng = Math.random) {
  if (!params) return false;
  const { act, objective, isRecruitBattle, isBoss, isAmbush, tutorialMode, isColosseum } = params;
  if (isRecruitBattle || isBoss || isAmbush || tutorialMode || isColosseum) return false;
  if (params.hasCaravan) return false; // max one micro-objective per map
  if (objective !== 'rout' && objective !== 'seize') return false;
  if (!VILLAGE_ELIGIBLE_ACTS.includes(act)) return false;
  return rng() < VILLAGE_SPAWN_CHANCE;
}

/** Simple local passability check (no Phaser deps), mirrors CaravanSystem. */
function isTilePassable(terrainData, mapLayout, col, row, cols, rows, moveType = 'Infantry') {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return false;
  const idx = mapLayout[row]?.[col];
  const terrain = terrainData[idx];
  if (!terrain) return false;
  const cost = terrain.moveCost?.[moveType];
  return cost !== '--' && !isNaN(parseInt(cost, 10));
}

// Terrain the village may overwrite: open ground only. Never stomp features
// (Throne, Fort, Ballista, Bridge) or hazards a visiting unit must stand on.
const VILLAGE_PLACEABLE_TERRAIN = new Set(['Plain', 'Forest', 'Sand', 'Floor', 'Ice', 'Swamp']);

/**
 * Pick the village tile in the map's neutral band: middle third of columns,
 * biased away from the main player↔enemy axis (the top or bottom quarter of
 * rows farther from the average spawn row), on open Infantry-passable ground.
 * Falls back to progressively wider bands, and returns null when no tile
 * qualifies (the map then simply gets no village).
 * @returns {{col:number,row:number}|null}
 */
export function pickVillageTile(
  mapLayout,
  cols,
  rows,
  terrainData,
  playerSpawns,
  enemySpawns,
  rng = Math.random,
) {
  const occupied = new Set();
  for (const s of playerSpawns || []) occupied.add(`${s.col},${s.row}`);
  for (const s of enemySpawns || []) occupied.add(`${s.col},${s.row}`);

  const isCandidate = (c, r) => {
    if (occupied.has(`${c},${r}`)) return false;
    if (!isTilePassable(terrainData, mapLayout, c, r, cols, rows, 'Infantry')) return false;
    const name = terrainData[mapLayout[r]?.[c]]?.name;
    return VILLAGE_PLACEABLE_TERRAIN.has(name);
  };

  const colMin = Math.floor(cols / 3);
  const colMax = Math.max(colMin, Math.ceil((2 * cols) / 3) - 1);

  // Bias away from the main axis: put the village in the row quarter farther
  // from where the armies start (average spawn row).
  const allSpawns = [...(playerSpawns || []), ...(enemySpawns || [])];
  const avgSpawnRow =
    allSpawns.length > 0
      ? allSpawns.reduce((sum, s) => sum + s.row, 0) / allSpawns.length
      : (rows - 1) / 2;
  const quarter = Math.max(1, Math.ceil(rows / 4));
  const topBand = { rowMin: 0, rowMax: quarter - 1 };
  const bottomBand = { rowMin: rows - quarter, rowMax: rows - 1 };
  const preferBottom = avgSpawnRow < (rows - 1) / 2;
  const bands = preferBottom ? [bottomBand, topBand] : [topBand, bottomBand];

  const collect = (rowMin, rowMax, cMin, cMax) => {
    const tiles = [];
    for (let r = Math.max(0, rowMin); r <= Math.min(rows - 1, rowMax); r++) {
      for (let c = Math.max(0, cMin); c <= Math.min(cols - 1, cMax); c++) {
        if (isCandidate(c, r)) tiles.push({ col: c, row: r });
      }
    }
    return tiles;
  };

  // Preferred band, then the opposite band, then the whole middle-third column
  // strip, then anywhere on the map.
  const tiers = [
    collect(bands[0].rowMin, bands[0].rowMax, colMin, colMax),
    collect(bands[1].rowMin, bands[1].rowMax, colMin, colMax),
    collect(0, rows - 1, colMin, colMax),
    collect(0, rows - 1, 0, cols - 1),
  ];
  for (const tier of tiers) {
    if (tier.length > 0) return tier[Math.floor(rng() * tier.length)];
  }
  return null;
}

/**
 * BFS path-distance map (tile steps over Infantry-passable terrain) from a
 * source tile. Returns a Map of "col,row" -> distance.
 */
function bfsDistances(mapLayout, cols, rows, terrainData, source) {
  const dist = new Map();
  if (!source || !isTilePassable(terrainData, mapLayout, source.col, source.row, cols, rows)) {
    return dist;
  }
  const queue = [{ col: source.col, row: source.row }];
  dist.set(`${source.col},${source.row}`, 0);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(`${cur.col},${cur.row}`);
    for (const [dc, dr] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const c = cur.col + dc;
      const r = cur.row + dr;
      const key = `${c},${r}`;
      if (dist.has(key)) continue;
      if (!isTilePassable(terrainData, mapLayout, c, r, cols, rows)) continue;
      dist.set(key, d + 1);
      queue.push({ col: c, row: r });
    }
  }
  return dist;
}

/**
 * Race calibration: choose bandit spawn tiles on the enemy-side map edge such
 * that banditDistance ≈ playerSpawnDistance + margin (path distances via BFS,
 * not eyeballed straight lines). A dedicated player unit wins the race; the
 * deathball does not. When the map cannot satisfy the inequality, the player
 * gets the benefit: the farthest available edge tile is used.
 *
 * Must be called AFTER ensureReachability so the village is connected —
 * candidates are filtered to tiles with a finite path to the village, which
 * also guarantees the (rout-relevant) bandits are reachable by the player.
 *
 * @param {object} args - { mapLayout, cols, rows, terrainData, villageTile,
 *   playerSpawns, enemySpawns, count?, margin? }
 * @returns {{spawns: Array<{col:number,row:number}>, playerDistance: number|null}}
 */
export function calibrateBanditSpawn({
  mapLayout,
  cols,
  rows,
  terrainData,
  villageTile,
  playerSpawns,
  enemySpawns,
  count = VILLAGE_BANDIT_COUNT,
  margin = VILLAGE_BANDIT_DISTANCE_MARGIN,
}) {
  const none = { spawns: [], playerDistance: null };
  if (!villageTile) return none;
  const dist = bfsDistances(mapLayout, cols, rows, terrainData, villageTile);
  if (dist.size === 0) return none;

  let playerDistance = Infinity;
  for (const s of playerSpawns || []) {
    const d = dist.get(`${s.col},${s.row}`);
    if (Number.isFinite(d)) playerDistance = Math.min(playerDistance, d);
  }
  // Village unreachable from every player spawn: give the player the benefit
  // (no bandit squad at all — the roll effectively fizzles).
  if (!Number.isFinite(playerDistance)) return none;

  const occupied = new Set();
  for (const s of playerSpawns || []) occupied.add(`${s.col},${s.row}`);
  for (const s of enemySpawns || []) occupied.add(`${s.col},${s.row}`);
  if (occupied.has(`${villageTile.col},${villageTile.row}`)) return none;

  // Edge tiles on the enemy side of the map (mirrors the caravan's enemy-half
  // bias). Fall back to all edges when the enemy half offers nothing.
  const avgEnemyCol =
    enemySpawns?.length > 0
      ? enemySpawns.reduce((sum, s) => sum + s.col, 0) / enemySpawns.length
      : cols - 1;
  const preferRightHalf = avgEnemyCol >= cols / 2;

  const allEdge = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r !== 0 && r !== rows - 1 && c !== 0 && c !== cols - 1) continue;
      const key = `${c},${r}`;
      if (occupied.has(key)) continue;
      const d = dist.get(key);
      if (!Number.isFinite(d)) continue; // must be able to walk to the village
      allEdge.push({
        col: c,
        row: r,
        dist: d,
        halfMatch: preferRightHalf ? c >= cols / 2 : c < cols / 2,
      });
    }
  }
  if (allEdge.length === 0) return none;
  const halfMatches = allEdge.filter((t) => t.halfMatch);
  const pool = halfMatches.length > 0 ? halfMatches : allEdge;

  const target = playerDistance + margin;
  const pickFrom = (tiles) => {
    const eligible = tiles.filter((t) => t.dist >= target);
    if (eligible.length > 0) {
      // Closest to the target distance — "≈ playerDistance + margin".
      return eligible.reduce((best, t) => (t.dist - target < best.dist - target ? t : best));
    }
    // Map can't satisfy the inequality: farthest available (player's benefit).
    return tiles.reduce((best, t) => (t.dist > best.dist ? t : best));
  };

  const spawns = [];
  const remaining = [...pool];
  const first = pickFrom(remaining);
  spawns.push({ col: first.col, row: first.row });
  remaining.splice(remaining.indexOf(first), 1);

  while (spawns.length < count && remaining.length > 0) {
    const anchor = spawns[spawns.length - 1];
    // Squadmates cluster near the first pick, still respecting the distance
    // gate when possible.
    const gated = remaining.filter((t) => t.dist >= target);
    const from = gated.length > 0 ? gated : remaining;
    const next = from.reduce((best, t) => {
      const dBest = Math.abs(best.col - anchor.col) + Math.abs(best.row - anchor.row);
      const dT = Math.abs(t.col - anchor.col) + Math.abs(t.row - anchor.row);
      return dT < dBest ? t : best;
    });
    spawns.push({ col: next.col, row: next.row });
    remaining.splice(remaining.indexOf(next), 1);
  }

  return { spawns, playerDistance };
}

/**
 * Pick an act-appropriate bandit class: an axe-wielding base class from the
 * act's enemy pool (Fighter/Brigand-alike). Falls back to the first base
 * class in the pool, then 'Fighter'.
 * @param {object} pool - enemies.pools[act] (already difficulty-filtered)
 * @param {Array} classes - classes.json data
 * @returns {string|null}
 */
export function pickBanditClass(pool, classes) {
  const base = Array.isArray(pool?.base) ? pool.base : [];
  const usesAxes = (className) => {
    const classData = (classes || []).find((c) => c.name === className);
    return typeof classData?.weaponProficiencies === 'string'
      ? classData.weaponProficiencies.includes('Axe')
      : false;
  };
  const axeClass = base.find(usesAxes);
  if (axeClass) return axeClass;
  if (base.length > 0) return base[0];
  return (classes || []).some((c) => c.name === 'Fighter') ? 'Fighter' : null;
}

/**
 * Build the turn-1 scripted reinforcement wave carrying the bandit squad.
 * Rides the existing ReinforcementScheduler scriptedWaves path, which
 * propagates aiMode/aiTargetTile onto each spawn. xpMultiplier 0.85 matches
 * the scripted-wave precedent — bandits initially walk away from the player.
 */
export function buildBanditScriptedWave({ spawnTiles, className, level, villageTile }) {
  if (!Array.isArray(spawnTiles) || spawnTiles.length === 0 || !className || !villageTile) {
    return null;
  }
  return {
    turn: 1,
    xpMultiplier: VILLAGE_BANDIT_XP_MULTIPLIER,
    spawns: spawnTiles.map((tile) => ({
      col: tile.col,
      row: tile.row,
      className,
      level: Math.max(1, Math.trunc(Number(level) || 1)),
      aiMode: 'seek_tile',
      aiTargetTile: { col: villageTile.col, row: villageTile.row },
    })),
  };
}

// --- Battle-time state machine (shared by VillageController + harness) ---

/** Fresh village state for a battle. */
export function createVillageState(tile) {
  if (!tile || !Number.isFinite(tile.col) || !Number.isFinite(tile.row)) return null;
  return { col: tile.col, row: tile.row, status: VILLAGE_STATUS.INTACT };
}

/** True when the unit stands on the still-intact village tile. */
export function isUnitOnIntactVillage(state, unit) {
  return Boolean(
    state &&
    state.status === VILLAGE_STATUS.INTACT &&
    unit &&
    unit.col === state.col &&
    unit.row === state.row,
  );
}

/** intact -> visited. Returns true when the transition happened. */
export function visitVillage(state) {
  if (!state || state.status !== VILLAGE_STATUS.INTACT) return false;
  state.status = VILLAGE_STATUS.VISITED;
  return true;
}

/** intact -> razed. Returns true when the transition happened. */
export function razeVillage(state) {
  if (!state || state.status !== VILLAGE_STATUS.INTACT) return false;
  state.status = VILLAGE_STATUS.RAZED;
  return true;
}

/**
 * After the village resolves (visited or razed), surviving seek_tile bandits
 * revert to the default chase AI and join the battle.
 * @returns {number} number of units reverted
 */
export function clearSeekTileBandits(enemyUnits) {
  let cleared = 0;
  for (const unit of enemyUnits || []) {
    if (unit?.aiMode === 'seek_tile') {
      unit.aiMode = 'chase';
      delete unit.aiTargetTile;
      cleared++;
    }
  }
  return cleared;
}

/** Act-scaled visit gold (reference scale: turnBonus.json baseBonusGold). */
export function getVillageGoldReward(act) {
  return VILLAGE_GOLD_BY_ACT[act] ?? VILLAGE_GOLD_BY_ACT.act1;
}

/**
 * Roll the visit's item reward: one draw from the act's healing + statBooster
 * loot pools (consumables only — delivered to the convoy, which avoids
 * inventory-full edge cases). Falls back to a Vulnerary. Returns a clone.
 */
export function rollVillageRewardItem(act, lootTables, consumablesCatalog, rng = Math.random) {
  const table = lootTables?.[act] || null;
  const pool = [
    ...(Array.isArray(table?.healing) ? table.healing : []),
    ...(Array.isArray(table?.statBooster) ? table.statBooster : []),
  ].filter((name) => typeof name === 'string');
  const catalog = Array.isArray(consumablesCatalog) ? consumablesCatalog : [];
  const name = pool.length > 0 ? pool[Math.floor(rng() * pool.length)] : 'Vulnerary';
  const item =
    catalog.find((c) => c?.name === name) || catalog.find((c) => c?.name === 'Vulnerary');
  return item ? structuredClone(item) : null;
}
