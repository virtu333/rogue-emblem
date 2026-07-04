// CaravanSystem.js — Merchant Caravan pure logic (spawn roll, unit creation, movement).
// No Phaser deps. BattleScene wiring lives in ui/CaravanController.js.

import {
  CARAVAN_SPAWN_CHANCE,
  CARAVAN_ELIGIBLE_ACTS,
  CARAVAN_BASE_HP,
  CARAVAN_HP_PER_ACT,
} from '../utils/constants.js';

const ACT_NUMBER = { act1: 1, act2: 2, act3: 3, act4: 4 };

/**
 * Decide whether this BATTLE/ELITE node should spawn a caravan, and if so at
 * what tile. Called at battleParams-build time (per-node, act2+ only) so the
 * result is baked into node.battleParams — deterministic and suspend/revert-safe,
 * exactly like the existing per-node battleSeed roll.
 * @param {object} params - { act, objective, isRecruitBattle?, isBoss?, isAmbush? }
 * @param {number} [chanceBonus=0] - caravanChanceBonus meta effect
 * @param {function} [rng=Math.random]
 * @returns {boolean}
 */
export function rollCaravanSpawn(params, chanceBonus = 0, rng = Math.random) {
  if (!params) return false;
  const { act, objective, isRecruitBattle, isBoss, isAmbush, tutorialMode, isColosseum } = params;
  // Defensive checks: isAmbush/tutorialMode/isColosseum are never actually set
  // on BATTLE params at roll time today — colosseum conversion retypes the node
  // and nulls battleParams AFTER this roll (discarding the result), and ambush
  // conversion rebuilds battleParams for SHOP nodes only. The load-bearing
  // exclusions are isRecruitBattle/isBoss/escape/act gating below; the rest is
  // defense-in-depth for any future caller that does set those flags.
  if (isRecruitBattle || isBoss || isAmbush || tutorialMode || isColosseum) return false;
  if (objective === 'escape') return false;
  if (!CARAVAN_ELIGIBLE_ACTS.includes(act)) return false;
  const chance = Math.max(0, Math.min(1, CARAVAN_SPAWN_CHANCE + (chanceBonus || 0)));
  return rng() < chance;
}

/** Simple local passability check (no Phaser deps). */
function isTilePassable(terrainData, mapLayout, col, row, cols, rows, moveType = 'Infantry') {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return false;
  const idx = mapLayout[row]?.[col];
  const terrain = terrainData[idx];
  if (!terrain) return false;
  const cost = terrain.moveCost?.[moveType];
  return cost !== '--' && !isNaN(parseInt(cost, 10));
}

/**
 * Pick an open, passable spawn tile for the caravan biased toward the enemy
 * half of the map (mirrors the existing npcSpawn placement pattern: avoid
 * occupied tiles, require Infantry passability).
 *
 * Spawn depth requirement: the caravan must need several turns of crawling
 * (MOV 1) before it can exit — an edge-adjacent spawn would hand out a free
 * reward shop with zero escort gameplay. Prefer candidates at least
 * min(4, floor((cols-1)/2)) columns from the nearest edge; if no tile
 * qualifies (cramped/blocked maps), fall back to the deepest available tier.
 * Within the tier, tiles whose straight row to the exit edge is wall-free are
 * preferred (full tier as fallback) so the caravan rarely needs to sidestep.
 * @returns {{col:number,row:number}|null}
 */
export function pickCaravanSpawnTile(
  mapLayout,
  cols,
  rows,
  terrainData,
  playerSpawns,
  enemySpawns,
) {
  const occupied = new Set();
  for (const s of playerSpawns || []) occupied.add(`${s.col},${s.row}`);
  for (const s of enemySpawns || []) occupied.add(`${s.col},${s.row}`);

  // Bias toward the enemy side: average enemy col tells us which half to prefer.
  const avgEnemyCol =
    enemySpawns?.length > 0
      ? enemySpawns.reduce((sum, s) => sum + s.col, 0) / enemySpawns.length
      : cols - 1;
  const preferRightHalf = avgEnemyCol >= cols / 2;

  const candidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      if (occupied.has(key)) continue;
      if (!isTilePassable(terrainData, mapLayout, c, r, cols, rows, 'Infantry')) continue;
      // Distance to the nearest edge column (the caravan's exit target).
      const edgeDist = Math.min(c, cols - 1 - c);
      const halfMatch = preferRightHalf ? c >= cols / 2 : c < cols / 2;
      candidates.push({ col: c, row: r, edgeDist, halfMatch });
    }
  }
  if (candidates.length === 0) return null;

  // Prefer tiles on the enemy half.
  const halfMatches = candidates.filter((t) => t.halfMatch);
  const pool = halfMatches.length > 0 ? halfMatches : candidates;

  // Enforce spawn depth: tiles at least minDepth columns from the nearest
  // edge qualify; otherwise fall back to the deepest tier the pool offers.
  const minDepth = Math.min(4, Math.floor((cols - 1) / 2));
  const deepEnough = pool.filter((t) => t.edgeDist >= minDepth);
  let tier;
  if (deepEnough.length > 0) {
    tier = deepEnough;
  } else {
    const maxDepth = Math.max(...pool.map((t) => t.edgeDist));
    tier = pool.filter((t) => t.edgeDist === maxDepth);
  }

  // Within the tier, prefer tiles whose straight row to the target edge has
  // no impassable tile — the caravan's movement is (nearly) straight-line, so
  // a wall bisecting the row forces sidesteps or a permanent stall. Fall back
  // to the whole tier when no row is clear (cramped maps): no behavior change
  // there, the movement-time sidestep handles it.
  const rowIsClear = (t) => {
    const dir = cols - 1 - t.col <= t.col ? 1 : -1;
    for (let c = t.col + dir; c >= 0 && c < cols; c += dir) {
      if (!isTilePassable(terrainData, mapLayout, c, t.row, cols, rows, 'Infantry')) return false;
    }
    return true;
  };
  const clearTier = tier.filter(rowIsClear);
  const finalTier = clearTier.length > 0 ? clearTier : tier;
  const pick = finalTier[Math.floor(Math.random() * finalTier.length)];
  return { col: pick.col, row: pick.row };
}

/**
 * Create the caravan NPC unit. Not routed through createUnit/createRecruitUnit
 * (no class family, no weapon proficiencies) — a merchant is unarmed, MOV 1,
 * flagged isCaravan so BattleSuspendController and AIController treat it specially.
 * @param {string} act
 * @param {{col:number,row:number}} spawnTile
 * @returns {object} unit
 */
export function createCaravanUnit(act, spawnTile) {
  const actNum = ACT_NUMBER[act] || 1;
  const hp = CARAVAN_BASE_HP + CARAVAN_HP_PER_ACT * actNum;
  return {
    name: 'Merchant',
    className: 'Merchant',
    isCaravan: true,
    isLord: false,
    faction: 'npc',
    level: 1,
    xp: 0,
    mov: 1,
    moveType: 'Infantry',
    stats: { HP: hp, STR: 0, MAG: 0, SKL: 1, SPD: 4, LCK: 5, DEF: 0, RES: 0, MOV: 1 },
    currentHP: hp,
    weapon: null,
    inventory: [],
    consumables: [],
    affixes: [],
    accessory: null,
    proficiencies: [],
    skills: [],
    weaponRank: null,
    col: spawnTile.col,
    row: spawnTile.row,
    hasMoved: false,
    hasActed: true, // never takes a combat action
    graphic: null,
    label: null,
    hpBar: null,
  };
}

/**
 * Compute the caravan's next tile: 1 greedy step toward the nearest column
 * edge. When the straight-line forward tile is blocked (impassable or
 * occupied), try a one-tile vertical sidestep — still no real pathfinding,
 * just enough to un-stick the common single-wall-segment case (a straight-only
 * caravan parks forever behind any wall that bisects its row, which reads as
 * broken). A sidestep row only qualifies when ITS forward tile is passable —
 * that guard alone prevents up-down oscillation against a full wall column,
 * where holding still is the correct behavior.
 * @returns {{col:number,row:number}|null} null if no legal step (caravan holds still)
 */
export function computeCaravanStep(unit, mapLayout, cols, rows, terrainData, occupiedTiles) {
  const moveType = unit.moveType || 'Infantry';
  const distToLeft = unit.col;
  const distToRight = cols - 1 - unit.col;
  const direction = distToRight <= distToLeft ? 1 : -1;
  const nextCol = unit.col + direction;
  if (nextCol < 0 || nextCol >= cols) return null; // already at the edge

  const open = (c, r) =>
    isTilePassable(terrainData, mapLayout, c, r, cols, rows, moveType) &&
    !occupiedTiles?.has(`${c},${r}`);

  // Straight-line step toward the edge.
  if (open(nextCol, unit.row)) {
    return { col: nextCol, row: unit.row };
  }

  // Forward blocked: one-tile vertical sidestep. The sidestep tile must be
  // open, and the destination row's forward tile must be passable (otherwise
  // sidestepping gains nothing — hold still instead). Prefer the row whose
  // forward tile is also unoccupied; tiebreak toward the map's center row so
  // the caravan drifts away from edges it isn't exiting through.
  const centerRow = (rows - 1) / 2;
  const sidestepRows = [unit.row - 1, unit.row + 1]
    .filter((r) => r >= 0 && r < rows)
    .filter((r) => open(unit.col, r))
    .filter((r) => isTilePassable(terrainData, mapLayout, nextCol, r, cols, rows, moveType))
    .sort((a, b) => {
      // Rows whose forward tile is fully open (not just passable) come first.
      const aFwdOpen = open(nextCol, a) ? 0 : 1;
      const bFwdOpen = open(nextCol, b) ? 0 : 1;
      if (aFwdOpen !== bFwdOpen) return aFwdOpen - bFwdOpen;
      return Math.abs(a - centerRow) - Math.abs(b - centerRow);
    });
  if (sidestepRows.length > 0) {
    return { col: unit.col, row: sidestepRows[0] };
  }

  return null; // fully blocked: hold still
}

/** True once the caravan's column reaches either map edge. */
export function isCaravanAtEdge(unit, cols) {
  return unit.col <= 0 || unit.col >= cols - 1;
}
