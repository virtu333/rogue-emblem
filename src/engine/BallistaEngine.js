// BallistaEngine.js — pure functions for ballista map objects (no Phaser deps)

import { TERRAIN } from '../utils/constants.js';

const BALLISTA_MIGHT = 10;
const BALLISTA_HIT = 85;
const BALLISTA_RANGE = 5;

/**
 * Create initial state for a ballista at the given position.
 * Owner starts as 'enemy' — player can capture by standing on tile.
 */
export function createBallistaState(col, row) {
  return { col, row, owner: 'enemy', captured: false };
}

/** Return the ballista range constant. */
export function getBallistaRange() {
  return BALLISTA_RANGE;
}

/**
 * Return all threatened tiles for this ballista using Manhattan range 1..BALLISTA_RANGE.
 * Output is clamped to map bounds and excludes the ballista's own tile.
 */
export function getBallistaDangerTiles(ballista, cols, rows) {
  if (
    !ballista ||
    !Number.isFinite(ballista.col) ||
    !Number.isFinite(ballista.row) ||
    !Number.isFinite(cols) ||
    !Number.isFinite(rows) ||
    cols <= 0 ||
    rows <= 0
  ) {
    return [];
  }

  const originCol = Math.trunc(ballista.col);
  const originRow = Math.trunc(ballista.row);
  const tiles = [];

  for (let dc = -BALLISTA_RANGE; dc <= BALLISTA_RANGE; dc++) {
    const remaining = BALLISTA_RANGE - Math.abs(dc);
    for (let dr = -remaining; dr <= remaining; dr++) {
      const dist = Math.abs(dc) + Math.abs(dr);
      if (dist < 1 || dist > BALLISTA_RANGE) continue;
      const col = originCol + dc;
      const row = originRow + dr;
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      tiles.push({ col, row });
    }
  }

  return tiles;
}

/** Check whether a terrain index is a Ballista tile. */
export function isBallistaTile(terrainIndex) {
  return terrainIndex === TERRAIN.Ballista;
}

/**
 * Select the best target for a ballista from the given target list.
 * Picks nearest in-range unit, tiebreak lowest HP.
 */
export function selectBallistaTarget(ballista, targets) {
  let best = null;
  let bestDist = Infinity;
  let bestHP = Infinity;

  for (const unit of targets) {
    if (unit.currentHP <= 0) continue;
    const dist = Math.abs(unit.col - ballista.col) + Math.abs(unit.row - ballista.row);
    if (dist < 1 || dist > BALLISTA_RANGE) continue;
    if (dist < bestDist || (dist === bestDist && unit.currentHP < bestHP)) {
      best = unit;
      bestDist = dist;
      bestHP = unit.currentHP;
    }
  }
  return best;
}

/**
 * Resolve a ballista strike against a target.
 * Ballista targets RES: damage = max(1, MIGHT - target.stats.RES)
 * No crit, no counter-attack.
 */
export function resolveBallistaStrike(ballista, target, rng) {
  const damage = Math.max(1, BALLISTA_MIGHT - (target.stats?.RES || 0));
  const hitRoll = (rng ? rng() : Math.random()) * 100;
  const didHit = hitRoll < BALLISTA_HIT;
  return { damage: didHit ? damage : 0, hit: BALLISTA_HIT, didHit };
}
