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

  // Prefer tiles on the enemy half, close to an edge (col-edge, since the
  // caravan flees toward the nearest column edge).
  const halfMatches = candidates.filter((t) => t.halfMatch);
  const pool = halfMatches.length > 0 ? halfMatches : candidates;
  pool.sort((a, b) => a.edgeDist - b.edgeDist);
  const nearest = pool.filter((t) => t.edgeDist === pool[0].edgeDist);
  const pick = nearest[Math.floor(Math.random() * nearest.length)];
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
 * edge, skipping the step if the adjacent tile is impassable or occupied.
 * No pathfinding — a straight-line step is all the spec calls for.
 * @returns {{col:number,row:number}|null} null if no legal step (caravan holds still)
 */
export function computeCaravanStep(unit, mapLayout, cols, rows, terrainData, occupiedTiles) {
  const distToLeft = unit.col;
  const distToRight = cols - 1 - unit.col;
  const direction = distToRight <= distToLeft ? 1 : -1;
  const nextCol = unit.col + direction;
  const nextRow = unit.row;
  if (nextCol < 0 || nextCol >= cols) return null; // already at the edge
  if (
    !isTilePassable(
      terrainData,
      mapLayout,
      nextCol,
      nextRow,
      cols,
      rows,
      unit.moveType || 'Infantry',
    )
  ) {
    return null;
  }
  const key = `${nextCol},${nextRow}`;
  if (occupiedTiles?.has(key)) return null;
  return { col: nextCol, row: nextRow };
}

/** True once the caravan's column reaches either map edge. */
export function isCaravanAtEdge(unit, cols) {
  return unit.col <= 0 || unit.col >= cols - 1;
}
