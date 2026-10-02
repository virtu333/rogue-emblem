// RoutLadder.js — the rout reinforcement ladder (docs/specs/dusk-pressure.md, §2a).
// Pure, no Phaser.
//
// On Dusk and Nightfall a rout map gets a finite schedule of waves that starts early and
// comes every two turns, each wave larger and higher-level. Clearing the field still
// wins (the waves still pending never come), so a fast clear sees few waves and a turtle
// sees them all. The rung's table lives in difficulty.json (`routLadder`); MapGenerator
// writes the act's waves into the battle config (`reinforcements.ladder`) when the map is
// generated, so a locked map, a resume or a Vision rewind replays the same ladder.
// ReinforcementScheduler places the arrivals; ReinforcementSpawns builds them.

import { collectEdgeSpawnCandidates } from './ReinforcementScheduler.js';

export const LADDER_MIN_PLAYER_DISTANCE = 3;
export const LADDER_MIN_FLANK_TILES = 4;

const int = (value, fallback = 0) => (Number.isFinite(value) ? Math.trunc(value) : fallback);

/** The rung's waves for an act, or null (no ladder on this rung or act). */
export function routLadderRowsForAct(routLadder, act) {
  const rows = routLadder?.acts?.[act];
  return Array.isArray(rows) && rows.length > 0 ? rows : null;
}

function centroid(points) {
  const list = (points || []).filter((p) => Number.isFinite(p?.col) && Number.isFinite(p?.row));
  if (list.length === 0) return null;
  return {
    col: list.reduce((sum, p) => sum + p.col, 0) / list.length,
    row: list.reduce((sum, p) => sum + p.row, 0) / list.length,
  };
}

function spawnHash(points) {
  let h = 2166136261 >>> 0;
  for (const p of points || []) {
    h = Math.imul(h ^ (int(p?.col) + 1), 16777619) >>> 0;
    h = Math.imul(h ^ (int(p?.row) + 1), 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * The front (the map edge behind the enemy army, on the axis from the player centroid
 * to the enemy centroid) and the two flanks across that axis. The flank order is hashed
 * from the spawns, so it differs between maps but never between replays of one map.
 */
export function routLadderEdges({ playerSpawns, enemySpawns, cols }) {
  const p = centroid(playerSpawns);
  const e = centroid((enemySpawns || []).filter((s) => !s?.isBoss));
  let front;
  let flanks;
  if (!p || !e) {
    const leftSide = !p || p.col <= ((cols || 1) - 1) / 2;
    front = leftSide ? 'right' : 'left';
    flanks = ['top', 'bottom'];
  } else {
    const dx = e.col - p.col;
    const dy = e.row - p.row;
    if (Math.abs(dx) >= Math.abs(dy)) {
      front = dx >= 0 ? 'right' : 'left';
      flanks = ['top', 'bottom'];
    } else {
      front = dy >= 0 ? 'bottom' : 'top';
      flanks = ['left', 'right'];
    }
  }
  if (spawnHash([...(playerSpawns || []), ...(enemySpawns || [])]) & 1) flanks.reverse();
  return { front, flanks };
}

/**
 * The battle config's ladder for a rout map, or null. `routLadder` is the rung's table
 * (difficulty.json); `moveTypes` are the move types of the classes arrivals may copy.
 * Wave 1 comes from the front, later waves alternate between the flanks; a flank with
 * fewer than `minFlankTiles` usable edge tiles (a chokepoint) falls back to the other
 * flank, then to the front. Each wave keeps its turn, count range, level bonus, promoted
 * flag and reward (`xp[i]`, 0 past the list).
 */
export function buildRoutLadder({
  routLadder,
  act,
  playerSpawns,
  enemySpawns,
  mapLayout,
  terrain,
  moveTypes = ['Infantry'],
}) {
  const rows = routLadderRowsForAct(routLadder, act);
  if (!rows) return null;
  const cols = mapLayout?.[0]?.length || 0;
  const { front, flanks } = routLadderEdges({ playerSpawns, enemySpawns, cols });
  const minFlankTiles = Number.isFinite(routLadder.minFlankTiles)
    ? routLadder.minFlankTiles
    : LADDER_MIN_FLANK_TILES;
  const usable = flanks.map(
    (edge) =>
      collectEdgeSpawnCandidates({ edge, mapLayout, terrain, occupied: [], moveTypes }).length >=
      minFlankTiles,
  );
  const edgeForWave = (i) => {
    if (i === 0) return front;
    const f = (i - 1) % 2;
    if (usable[f]) return flanks[f];
    if (usable[1 - f]) return flanks[1 - f];
    return front;
  };
  const xp = Array.isArray(routLadder.xp) ? routLadder.xp : [];
  const waves = rows.map((row, i) => {
    const min = Math.max(0, int(row?.count?.[0]));
    const max = Math.max(min, int(row?.count?.[1], min));
    const wave = {
      turn: Math.max(1, int(row?.turn, 1)),
      count: [min, max],
      edge: edgeForWave(i),
      xpMultiplier: Number.isFinite(xp[i]) ? Math.max(0, Math.min(1, xp[i])) : 0,
    };
    const levels = Math.max(0, int(row?.levels));
    if (levels > 0) wave.levelBonus = levels;
    if (row?.promoted === true) wave.promoted = true;
    return wave;
  });
  return {
    front,
    flanks: [...flanks],
    minPlayerDistance: Number.isFinite(routLadder.minPlayerDistance)
      ? routLadder.minPlayerDistance
      : LADDER_MIN_PLAYER_DISTANCE,
    waves,
  };
}

/**
 * Where the ladder stands: waves resolved (arrived or blocked) and the next one due.
 * `resolvedThroughTurn` is the last turn whose arrivals have been resolved: the turn
 * before the current one, or the current one once its enemy phase brought them.
 * Null for a battle without a ladder.
 */
export function routLadderStatus(reinforcements, { resolvedThroughTurn = 0 } = {}) {
  const waves = reinforcements?.ladder?.waves;
  if (!Array.isArray(waves) || waves.length === 0) return null;
  const through = int(resolvedThroughTurn);
  const resolved = waves.filter((w) => int(w?.turn) <= through).length;
  const next = waves
    .filter((w) => int(w?.turn) > through)
    .sort((a, b) => int(a.turn) - int(b.turn))[0];
  const front = reinforcements.ladder.front || null;
  const edge = next?.edge || front;
  return {
    resolved,
    total: waves.length,
    next: next
      ? {
          turn: int(next.turn),
          max: Math.max(0, int(next.count?.[1], int(next.count?.[0]))),
          edge,
          // A flank wave goes to the front when, as it arrives, no tile on its flank is
          // free of the player-distance and NPC exclusions (unit positions then decide).
          fallback: front && edge && edge !== front ? front : null,
        }
      : null,
  };
}

/**
 * The objective line that announces the ladder, e.g.
 * "Reinforcements 1/4 · T6: up to 2, top or right edge". `edgeLabel` turns a grid edge
 * into the edge the player sees (a portrait board is turned a quarter). "Up to": blocked
 * tiles can shrink a wave. A flank wave names the front as well, because units standing
 * near the flank at arrival time send the whole wave there.
 */
export function routLadderObjectiveLine(status, edgeLabel = (edge) => edge) {
  if (!status) return null;
  const head = `Reinforcements ${status.resolved}/${status.total}`;
  if (!status.next) return `${head} · no more waves`;
  const { edge, fallback } = status.next;
  const edges = [edge, fallback].filter(Boolean).map((e) => edgeLabel(e));
  const where = edges.length ? `, ${edges.join(' or ')} edge` : '';
  return `${head} · T${status.next.turn}: up to ${status.next.max}${where}`;
}
