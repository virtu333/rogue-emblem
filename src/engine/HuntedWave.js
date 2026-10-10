// HuntedWave.js — the extra reinforcement wave of the Hunted burden (engine/Burdens.js,
// docs/specs/event-nodes-phase2.md §2B). Pure: no Phaser, no randomness (nothing here draws;
// the arrivals themselves are rolled by ReinforcementScheduler from the battle's seed).
//
// MapGenerator calls `withHuntedWave` while it generates a battle whose params carry
// `huntedWave` ({ turn, count: [min, max], xpMultiplier }, written by RunManager.getBattleParams
// for a non-boss battle of a hunted run). The wave lands in the battle config as
// `reinforcements.hunted`, so the locked config keeps it: a refresh, a resume and a revert all
// replay the same battle. The scheduler turns it into arrivals on its turn at the map's
// reinforcement edge: the template's own `spawnEdges`, else the rout ladder's front, else the
// edge on the enemy side of the map.

import { REINFORCEMENT_EDGES } from './ReinforcementScheduler.js';
import { normalizeHuntedWave } from './Burdens.js';

const centroid = (tiles) => {
  const list = (tiles || []).filter((t) => Number.isFinite(t?.col) && Number.isFinite(t?.row));
  if (list.length === 0) return null;
  return {
    col: list.reduce((sum, t) => sum + t.col, 0) / list.length,
    row: list.reduce((sum, t) => sum + t.row, 0) / list.length,
  };
};

const edgeMidpoint = (edge, cols, rows) => {
  const midCol = (cols - 1) / 2;
  const midRow = (rows - 1) / 2;
  switch (edge) {
    case 'left':
      return { col: 0, row: midRow };
    case 'right':
      return { col: cols - 1, row: midRow };
    case 'top':
      return { col: midCol, row: 0 };
    default:
      return { col: midCol, row: rows - 1 };
  }
};

const distance = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

/**
 * The edge a map's reinforcements come from, for a map that has none of its own: the edge on
 * the enemy's side (nearest the enemy spawns' centre, farthest from the player's). Ties go in
 * the order left, right, top, bottom, so the pick never moves.
 */
export function enemySideEdge({ cols, rows, playerSpawns, enemySpawns }) {
  const mine = centroid(playerSpawns);
  const theirs = centroid(enemySpawns);
  if (!mine || !theirs) return 'right';
  let best = null;
  let bestScore = -Infinity;
  for (const edge of REINFORCEMENT_EDGES) {
    const mid = edgeMidpoint(edge, cols, rows);
    const score = distance(mine, mid) - distance(theirs, mid);
    if (score > bestScore) {
      best = edge;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The reinforcement block with the Hunted wave added (a new object; the input is untouched).
 * @param {object|undefined} reinforcements - the config's block (absent on a map with none)
 * @param {object} wave - the burden's wave ({ turn, count, xpMultiplier })
 * @param {{ cols: number, rows: number, playerSpawns: object[], enemySpawns: object[] }} map
 */
export function withHuntedWave(reinforcements, wave, map) {
  const base = reinforcements && typeof reinforcements === 'object' ? reinforcements : {};
  const resolved = normalizeHuntedWave(wave);
  const own = Array.isArray(base.spawnEdges)
    ? base.spawnEdges.filter((edge) => REINFORCEMENT_EDGES.includes(edge))
    : [];
  const front = REINFORCEMENT_EDGES.includes(base.ladder?.front) ? [base.ladder.front] : [];
  const edges = own.length ? own : front.length ? front : [enemySideEdge(map)];
  return {
    ...base,
    hunted: {
      turn: resolved.turn,
      count: [...resolved.count],
      xpMultiplier: resolved.xpMultiplier,
      edges: [...new Set(edges)],
    },
  };
}

/** True when a battle config carries the Hunted wave (so its victory counts one down). */
export function isHuntedBattle(battleConfig) {
  return Boolean(battleConfig?.reinforcements?.hunted);
}
