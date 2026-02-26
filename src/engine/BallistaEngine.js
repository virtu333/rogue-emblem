// BallistaEngine.js — pure functions for ballista map objects (no Phaser deps)

import { TERRAIN } from '../utils/constants.js';

const BALLISTA_MIGHT = 10;
const BALLISTA_HIT = 85;
const BALLISTA_RANGE = 3;

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
