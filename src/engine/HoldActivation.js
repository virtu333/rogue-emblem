// HoldActivation.js — hold-position enemies on seize and escape maps
// (docs/specs/dusk-pressure.md §2b). Pure, no Phaser, no RNG.
//
// On Dusk and harder, part of a seize or escape map's garrison holds its ground
// (`aiMode: 'hold'`) instead of walking into the player's kill zone. Holders stand in
// packs of two or more, each holder within 3 tiles of another, so none can be pulled
// away alone. A pack wakes, and hunts for the rest of the battle, when one of its members
//   1. can be seen by the player and has a player or NPC unit inside the tiles the Danger
//      overlay draws for it (ThreatForecast.enemyThreatTiles over PlayerKnowledge), so the
//      red zone is the wake zone. A holder hidden in fog never wakes this way;
//   2. was hurt, hexed (any status) or moved off its post;
//   3. sees the boss enrage (turn pressure).
// Anti-turtle aggression never wakes a holder: otherwise a turtle would only have to wait.
// MapGenerator writes the holders into the battle config, so a locked map, a resume or a
// Vision rewind keeps them. AIController checks the wake rules at the top of every enemy
// phase, for BattleScene and the headless harness alike.

import { gridDistance } from './Combat.js';
import { enemyThreatTiles, isThreatSourceVisible } from './ThreatForecast.js';
import { getConditions } from './StatusConditionSystem.js';

export const HOLD_AI_MODE = 'hold';
export const HOLD_PACK_RADIUS = 3;

const tileKey = (col, row) => `${col},${row}`;
const dist = (a, b) => gridDistance(a.col, a.row, b.col, b.row);

function centroid(points) {
  const list = (points || []).filter((p) => Number.isFinite(p?.col) && Number.isFinite(p?.row));
  if (!list.length) return null;
  return {
    col: list.reduce((s, p) => s + p.col, 0) / list.length,
    row: list.reduce((s, p) => s + p.row, 0) / list.length,
  };
}

/** The rung's share of holders for an objective (difficulty.json `holdShare`), or 0. */
export function holdShareFor(holdShare, objective) {
  const share = Number(holdShare?.[objective]);
  return Number.isFinite(share) && share > 0 ? Math.min(1, share) : 0;
}

/**
 * The spawns that may hold, nearest the objective first: on seize every non-boss enemy
 * without another AI role (guards included: holds replace them), measured to the
 * throne; on escape those of them in the exit half of the map (the half, across the
 * player-to-exit axis, that holds the exits), measured to the exits' centre.
 * `pool` is the count the share applies to.
 */
function holdCandidates({ spawns, objective, thronePos, escapeTiles, playerSpawns }) {
  const eligible = (spawns || []).filter(
    (s) => s && !s.isBoss && !s.isEntity && (!s.aiMode || s.aiMode === 'guard'),
  );
  const nonBoss = (spawns || []).filter((s) => s && !s.isBoss && !s.isEntity);
  let anchor = null;
  let pool = nonBoss;
  let inHalf = () => true;
  if (objective === 'seize' && thronePos) {
    anchor = thronePos;
  } else if (objective === 'escape' && escapeTiles?.length) {
    anchor = centroid(escapeTiles);
    const from = centroid(playerSpawns) || anchor;
    const horizontal = Math.abs(anchor.col - from.col) >= Math.abs(anchor.row - from.row);
    const mid = horizontal ? (anchor.col + from.col) / 2 : (anchor.row + from.row) / 2;
    const exitAbove = horizontal ? anchor.col >= mid : anchor.row >= mid;
    inHalf = (s) => {
      const v = horizontal ? s.col : s.row;
      return exitAbove ? v >= mid : v <= mid;
    };
    pool = nonBoss.filter(inHalf);
  } else {
    return { candidates: [], pool: [] };
  }
  const candidates = eligible
    .filter(inHalf)
    .sort((a, b) => dist(a, anchor) - dist(b, anchor) || a.col - b.col || a.row - b.row);
  return { candidates, pool };
}

/**
 * Mark a map's holders on its spawns (mutates them): `aiMode: 'hold'` and a `holdPack`
 * id per pack. Guards on a map with holders lose their guard role; a map where no pack
 * forms keeps its guards. Takes
 * round(share × pool) holders nearest the objective, in packs: a candidate joins when it
 * is within 3 tiles of a chosen holder, or comes with its nearest unchosen partner within
 * 3 (which may take one past the target count); a candidate with no partner is skipped.
 * @returns {number} holders assigned
 */
export function assignHolders({
  spawns,
  objective,
  share,
  thronePos = null,
  escapeTiles = null,
  playerSpawns = null,
}) {
  if (!(share > 0)) return 0;
  const { candidates, pool } = holdCandidates({
    spawns,
    objective,
    thronePos,
    escapeTiles,
    playerSpawns,
  });
  const target = Math.round(share * pool.length);
  if (target < 2) return 0;
  const chosen = [];
  for (const c of candidates) {
    if (chosen.length >= target) break;
    if (chosen.includes(c)) continue;
    if (chosen.some((s) => dist(s, c) <= HOLD_PACK_RADIUS)) {
      chosen.push(c);
      continue;
    }
    const partner = candidates.find(
      (o) => o !== c && !chosen.includes(o) && dist(o, c) <= HOLD_PACK_RADIUS,
    );
    if (partner) chosen.push(c, partner);
  }
  // Packs: holders linked through chains of holders within 3 tiles.
  const pack = new Map();
  let next = 0;
  for (const s of chosen) {
    if (pack.has(s)) continue;
    const stack = [s];
    pack.set(s, next);
    while (stack.length) {
      const cur = stack.pop();
      for (const o of chosen) {
        if (!pack.has(o) && dist(o, cur) <= HOLD_PACK_RADIUS) {
          pack.set(o, next);
          stack.push(o);
        }
      }
    }
    next++;
  }
  // Holds replace guards, but only on a map that has holders: a map with no pack keeps
  // the guards it rolled (otherwise it would be softer than First Light's).
  if (chosen.length > 0) {
    for (const s of spawns || []) if (s?.aiMode === 'guard') delete s.aiMode;
  }
  for (const s of chosen) {
    s.aiMode = HOLD_AI_MODE;
    s.holdPack = pack.get(s);
  }
  return chosen.length;
}

/** Copy a spawn's hold onto the enemy built from it (its post is where it stands). */
export function applyHoldSpawn(enemy, spawn) {
  if (!enemy || spawn?.aiMode !== HOLD_AI_MODE) return enemy;
  enemy.aiMode = HOLD_AI_MODE;
  enemy.holdPack = Number.isInteger(spawn.holdPack) ? spawn.holdPack : 0;
  enemy.holdPost = { col: enemy.col, row: enemy.row };
  return enemy;
}

export function isHolding(unit) {
  return unit?.aiMode === HOLD_AI_MODE && unit.currentHP > 0;
}

/** Rule 2: struck (below full HP), hexed (any status) or moved off its post. */
function disturbed(unit) {
  if (unit.currentHP < (unit.stats?.HP ?? unit.currentHP)) return 'hurt';
  if (getConditions(unit).length > 0) return 'status';
  const post = unit.holdPost;
  if (post && (post.col !== unit.col || post.row !== unit.row)) return 'moved';
  return null;
}

/**
 * Rule 1: seen by the player with a player or NPC unit inside its Danger tiles. Only
 * what the player knows shapes the tiles (`threatContext.positions()`, PlayerKnowledge).
 */
function threatened(unit, threatContext, positions, targets) {
  if (!threatContext || !isThreatSourceVisible(threatContext.grid, unit)) return false;
  const { damage, status } = enemyThreatTiles(threatContext, unit, positions);
  return targets.some((t) => {
    const k = tileKey(t.col, t.row);
    return damage.has(k) || status.has(k);
  });
}

/**
 * Wake the packs whose members meet a wake rule (mutates them: aiMode cleared, `holdWoke`
 * records why). Call at the top of an enemy phase.
 * @param {{ enemyUnits: object[], playerUnits: object[], npcUnits?: object[],
 *   threatContext?: object|null, bossEnraged?: boolean }} battle
 * @returns {{ unit: object, reason: string }[]} the holders woken, in pack order
 */
export function wakeHolders({
  enemyUnits = [],
  playerUnits = [],
  npcUnits = [],
  threatContext = null,
  bossEnraged = false,
}) {
  const holders = (enemyUnits || []).filter(isHolding);
  if (!holders.length) return [];
  const targets = [...(playerUnits || []), ...(npcUnits || [])].filter(
    (u) => u && u.currentHP > 0 && !u._removing,
  );
  let positions = null;
  const packReason = new Map();
  for (const unit of holders) {
    if (packReason.has(unit.holdPack)) continue;
    let reason = bossEnraged ? 'enrage' : disturbed(unit);
    if (!reason) {
      positions ||= threatContext?.positions?.() || null;
      if (threatened(unit, threatContext, positions, targets)) reason = 'threat';
    }
    if (reason) packReason.set(unit.holdPack, reason);
  }
  const woken = [];
  for (const unit of holders) {
    const reason = packReason.get(unit.holdPack);
    if (!reason) continue;
    delete unit.aiMode;
    unit.holdWoke = reason;
    woken.push({ unit, reason });
  }
  return woken;
}
