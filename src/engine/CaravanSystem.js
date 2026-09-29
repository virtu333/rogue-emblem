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

/**
 * Whether a map template can carry a caravan. `caravan: false` in mapTemplates.json marks
 * a template too cramped for the placement rules (a great hall, a chokepoint); a node that
 * rolled a caravan never draws one (NodeMapGenerator.pickTemplateForNode).
 */
export function templateAllowsCaravan(template) {
  return template?.caravan !== false;
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

/** A caravan spawns at least this many tiles (Manhattan) from every enemy spawn… */
export const CARAVAN_MIN_ENEMY_DISTANCE = 6;
/** …and from every player spawn: a neutral band the army must reach to escort it. */
export const CARAVAN_MIN_PLAYER_DISTANCE = 6;
/**
 * Cramped maps (a great hall, a chokepoint) may bring it this close to the army
 * instead of going without; the enemy distance never gives.
 */
export const CARAVAN_MIN_PLAYER_DISTANCE_FLOOR = 4;
/** It needs at least this many steps to its exit edge (a few turns of escort, not a free shop). */
export const CARAVAN_MIN_EXIT_STEPS = 4;

/** Exit directions, as unit steps. */
export const CARAVAN_EXITS = Object.freeze([
  Object.freeze({ dc: -1, dr: 0 }),
  Object.freeze({ dc: 1, dr: 0 }),
  Object.freeze({ dc: 0, dr: -1 }),
  Object.freeze({ dc: 0, dr: 1 }),
]);

const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

/** Steps from (col,row) to the map edge the direction leads to. */
function stepsToEdge(col, row, exit, cols, rows) {
  if (exit.dc > 0) return cols - 1 - col;
  if (exit.dc < 0) return col;
  if (exit.dr > 0) return rows - 1 - row;
  return row;
}

/** Infantry-passable tiles reachable from any player spawn ("col,row" set). */
function reachableFromPlayers(mapLayout, cols, rows, terrainData, playerSpawns) {
  const seen = new Set();
  const queue = [];
  for (const s of playerSpawns || []) {
    const key = `${s.col},${s.row}`;
    if (seen.has(key)) continue;
    if (!isTilePassable(terrainData, mapLayout, s.col, s.row, cols, rows, 'Infantry')) continue;
    seen.add(key);
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head++) {
    const { col, row } = queue[head];
    for (const { dc, dr } of CARAVAN_EXITS) {
      const c = col + dc;
      const r = row + dr;
      const key = `${c},${r}`;
      if (seen.has(key)) continue;
      if (!isTilePassable(terrainData, mapLayout, c, r, cols, rows, 'Infantry')) continue;
      seen.add(key);
      queue.push({ col: c, row: r });
    }
  }
  return seen;
}

/**
 * The caravan's way out from a tile: the straight run to one map edge that never
 * brings it nearer the enemy formation's centre, nor nearer any enemy spawn than it
 * starts (so it walks away from the enemy, toward the army or a side edge, and never
 * through an enemy spawn), with at least `minExitSteps` steps to go. Clear runs (no
 * impassable tile) beat blocked ones, then the run that ends farthest from the enemy
 * formation. Null when none.
 */
function caravanExitFrom(tile, ctx) {
  const { mapLayout, cols, rows, terrainData, nearestEnemy, minExitSteps, enemyCentroid } = ctx;
  const start = nearestEnemy(tile.col, tile.row);
  let best = null;
  const fromCentroid = (col, row) =>
    enemyCentroid ? Math.abs(col - enemyCentroid.col) + Math.abs(row - enemyCentroid.row) : 0;
  for (const exit of CARAVAN_EXITS) {
    const steps = stepsToEdge(tile.col, tile.row, exit, cols, rows);
    if (steps < minExitSteps) continue;
    // Away from the formation: no step nears its centre (axis-aligned, so checking the
    // first step covers the run)…
    if (fromCentroid(tile.col + exit.dc, tile.row + exit.dr) < fromCentroid(tile.col, tile.row))
      continue;
    // …nor any enemy spawn.
    let away = true;
    let blocked = 0;
    for (let i = 1; i <= steps && away; i++) {
      const col = tile.col + exit.dc * i;
      const row = tile.row + exit.dr * i;
      if (nearestEnemy(col, row) < start) away = false;
      if (!isTilePassable(terrainData, mapLayout, col, row, cols, rows, 'Infantry')) blocked++;
    }
    if (!away) continue;
    const endCol = tile.col + exit.dc * steps;
    const endRow = tile.row + exit.dr * steps;
    const retreat = fromCentroid(endCol, endRow);
    const option = { exit: { dc: exit.dc, dr: exit.dr }, clear: blocked === 0, retreat };
    if (
      !best ||
      (option.clear && !best.clear) ||
      (option.clear === best.clear && option.retreat > best.retreat)
    )
      best = option;
  }
  return best;
}

/**
 * Pick the caravan's spawn tile and its exit. The merchant is caught between the
 * armies, not inside the enemy formation: the tile is in the neutral band, at least
 * `minEnemyDistance` tiles (Manhattan, a lower bound on walking distance) from every
 * enemy spawn and `minPlayerDistance` from every player spawn, open and
 * Infantry-passable, reachable from the player spawns by a real path, and with a way
 * out that leads away from the enemy (caravanExitFrom). Only when no tile keeps that
 * far from the army does the player distance give, one tile at a time down to
 * `minPlayerDistanceFloor`; the enemy distance never gives. Tiles with a clear run to
 * their exit are preferred. When nothing qualifies the map gets no caravan (null):
 * a merchant parked beside the enemy is worse than none.
 * @returns {{col:number,row:number,exit:{dc:number,dr:number}}|null}
 */
export function pickCaravanSpawnTile(
  mapLayout,
  cols,
  rows,
  terrainData,
  playerSpawns,
  enemySpawns,
  rng = Math.random,
  {
    minEnemyDistance = CARAVAN_MIN_ENEMY_DISTANCE,
    minPlayerDistance = CARAVAN_MIN_PLAYER_DISTANCE,
    minPlayerDistanceFloor = CARAVAN_MIN_PLAYER_DISTANCE_FLOOR,
    minExitSteps = CARAVAN_MIN_EXIT_STEPS,
  } = {},
) {
  const players = Array.isArray(playerSpawns) ? playerSpawns : [];
  const enemies = Array.isArray(enemySpawns) ? enemySpawns : [];
  const occupied = new Set([...players, ...enemies].map((s) => `${s.col},${s.row}`));
  const reachable = reachableFromPlayers(mapLayout, cols, rows, terrainData, players);
  const enemyCentroid = enemies.length
    ? {
        col: enemies.reduce((sum, s) => sum + s.col, 0) / enemies.length,
        row: enemies.reduce((sum, s) => sum + s.row, 0) / enemies.length,
      }
    : null;
  // Distance from each tile to its nearest enemy spawn (computed once per map).
  const nearest = new Map();
  const nearestEnemy = (col, row) => {
    const key = col * 1024 + row;
    let d = nearest.get(key);
    if (d === undefined) {
      d = Infinity;
      for (const s of enemies) d = Math.min(d, Math.abs(s.col - col) + Math.abs(s.row - row));
      nearest.set(key, d);
    }
    return d;
  };
  const ctx = {
    mapLayout,
    cols,
    rows,
    terrainData,
    nearestEnemy,
    minExitSteps,
    enemyCentroid,
  };

  // Every tile safe from the enemy, with its distance to the army.
  const safe = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = `${col},${row}`;
      if (occupied.has(key) || !reachable.has(key)) continue;
      const tile = { col, row };
      if (nearestEnemy(col, row) < minEnemyDistance) continue;
      const way = caravanExitFrom(tile, ctx);
      if (!way) continue;
      const playerDistance = players.length
        ? Math.min(...players.map((s) => manhattan(s, tile)))
        : Infinity;
      safe.push({ col, row, exit: way.exit, clear: way.clear, playerDistance });
    }
  }
  const floor = Math.min(minPlayerDistance, minPlayerDistanceFloor);
  for (let band = minPlayerDistance; band >= floor; band--) {
    const candidates = safe.filter((t) => t.playerDistance >= band);
    if (candidates.length === 0) continue;
    const clear = candidates.filter((t) => t.clear);
    const pool = clear.length > 0 ? clear : candidates;
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    return { col: pick.col, row: pick.row, exit: pick.exit };
  }
  return null;
}

/**
 * Create the caravan NPC unit. Not routed through createUnit/createRecruitUnit
 * (no class family, no weapon proficiencies) — a merchant is unarmed, MOV 1,
 * flagged isCaravan so BattleSuspendController and AIController treat it specially.
 * @param {string} act
 * @param {{col:number,row:number,exit?:{dc:number,dr:number}}} spawnTile
 * @returns {object} unit
 */
export function createCaravanUnit(act, spawnTile) {
  const actNum = ACT_NUMBER[act] || 1;
  const hp = CARAVAN_BASE_HP + CARAVAN_HP_PER_ACT * actNum;
  const exit = spawnTile?.exit;
  return {
    // The way out chosen at spawn (pickCaravanSpawnTile); saved with the unit.
    ...(exit ? { caravanExit: { dc: exit.dc, dr: exit.dr } } : {}),
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

/** The caravan's exit direction: its own (set at spawn), else the nearest column edge (older saves). */
export function caravanExitOf(unit, cols) {
  const exit = unit?.caravanExit;
  if (
    exit &&
    Number.isInteger(exit.dc) &&
    Number.isInteger(exit.dr) &&
    Math.abs(exit.dc) + Math.abs(exit.dr) === 1
  )
    return { dc: exit.dc, dr: exit.dr };
  return cols - 1 - unit.col <= unit.col ? { dc: 1, dr: 0 } : { dc: -1, dr: 0 };
}

/**
 * Compute the caravan's next tile: 1 greedy step along its exit direction
 * (caravanExitOf). When the straight-line forward tile is blocked (impassable or
 * occupied), try a one-tile sidestep across the direction — still no real
 * pathfinding, just enough to un-stick the common single-wall-segment case (a
 * straight-only caravan parks forever behind any wall that bisects its line, which
 * reads as broken). A sidestep only qualifies when ITS forward tile is passable —
 * that guard alone prevents oscillation against a full wall, where holding still is
 * the correct behavior.
 * @returns {{col:number,row:number}|null} null if no legal step (caravan holds still)
 */
export function computeCaravanStep(unit, mapLayout, cols, rows, terrainData, occupiedTiles) {
  const moveType = unit.moveType || 'Infantry';
  const { dc, dr } = caravanExitOf(unit, cols);
  const nextCol = unit.col + dc;
  const nextRow = unit.row + dr;
  if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) return null; // at the edge

  const open = (c, r) =>
    isTilePassable(terrainData, mapLayout, c, r, cols, rows, moveType) &&
    !occupiedTiles?.has(`${c},${r}`);

  // Straight-line step toward the exit edge.
  if (open(nextCol, nextRow)) {
    return { col: nextCol, row: nextRow };
  }

  // Forward blocked: one-tile sidestep across the direction. The sidestep tile must
  // be open, and its own forward tile passable (otherwise sidestepping gains
  // nothing — hold still instead). Prefer a sidestep whose forward tile is also
  // unoccupied; tiebreak toward the map's center line so the caravan drifts away
  // from edges it isn't exiting through.
  const across = dc !== 0 ? { dc: 0, dr: 1 } : { dc: 1, dr: 0 };
  const center = dc !== 0 ? (rows - 1) / 2 : (cols - 1) / 2;
  const sidesteps = [-1, 1]
    .map((s) => ({ col: unit.col + across.dc * s, row: unit.row + across.dr * s }))
    .filter((t) => t.col >= 0 && t.col < cols && t.row >= 0 && t.row < rows)
    .filter((t) => open(t.col, t.row))
    .filter((t) =>
      isTilePassable(terrainData, mapLayout, t.col + dc, t.row + dr, cols, rows, moveType),
    )
    .sort((a, b) => {
      // Sidesteps whose forward tile is fully open (not just passable) come first.
      const aFwdOpen = open(a.col + dc, a.row + dr) ? 0 : 1;
      const bFwdOpen = open(b.col + dc, b.row + dr) ? 0 : 1;
      if (aFwdOpen !== bFwdOpen) return aFwdOpen - bFwdOpen;
      const along = (t) => (dc !== 0 ? t.row : t.col);
      return Math.abs(along(a) - center) - Math.abs(along(b) - center);
    });
  if (sidesteps.length > 0) {
    return { col: sidesteps[0].col, row: sidesteps[0].row };
  }

  return null; // fully blocked: hold still
}

/**
 * True once the caravan stands on its exit edge (the map edge its exit direction
 * leads to; either column edge for a caravan without one). `rows` is needed for a
 * top or bottom exit.
 */
export function isCaravanAtEdge(unit, cols, rows = Infinity) {
  if (!unit?.caravanExit) return unit.col <= 0 || unit.col >= cols - 1;
  const { dc, dr } = caravanExitOf(unit, cols);
  if (dc > 0) return unit.col >= cols - 1;
  if (dc < 0) return unit.col <= 0;
  if (dr > 0) return unit.row >= rows - 1;
  return unit.row <= 0;
}
