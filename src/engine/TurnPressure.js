// TurnPressure.js — the battle's anti-turtle clock (pure, no Phaser).
//
// Two things push a stalled battle forward:
// * No progress: after ANTI_TURTLE_NO_PROGRESS_TURNS enemy phases in a row with no
//   kill, no lord step toward the throne / an exit and no unit escaping, the AI turns
//   aggressive (guards leave their posts, the seize boss leaves its throne).
// * Boss enrage: with a living boss, from turn min(bossEnrageTurn, par +
//   bossEnrageOverPar) (TurnBonusCalculator.isBossEnrageActive).
// BattleScene and the headless harness both advance the same state once per enemy
// phase; the state is plain data (checkpoints, Vision snapshots and the suspend file
// store it as-is, BattleStateSnapshot validates it).
import { gridDistance } from './Combat.js';
import { isBossEnrageActive } from './TurnBonusCalculator.js';
import { ANTI_TURTLE_NO_PROGRESS_TURNS } from '../utils/constants.js';

/** Closest living lord's distance to the seize throne (Infinity off seize maps). */
export function bestLordThroneDistance(playerUnits, battleConfig) {
  if (battleConfig?.objective !== 'seize' || !battleConfig?.thronePos) return Infinity;
  const lords = (playerUnits || []).filter((u) => u?.isLord && u.currentHP > 0);
  if (!lords.length) return Infinity;
  const throne = battleConfig.thronePos;
  return Math.min(...lords.map((u) => gridDistance(u.col, u.row, throne.col, throne.row)));
}

/** Closest living lord's distance to any escape tile (Infinity off escape maps). */
export function bestLordEscapeDistance(playerUnits, battleConfig) {
  if (battleConfig?.objective !== 'escape' || !battleConfig?.escapeTiles?.length) return Infinity;
  const lords = (playerUnits || []).filter((u) => u?.isLord && u.currentHP > 0);
  if (!lords.length) return Infinity;
  let best = Infinity;
  for (const lord of lords) {
    for (const tile of battleConfig.escapeTiles) {
      best = Math.min(best, gridDistance(lord.col, lord.row, tile.col, tile.row));
    }
  }
  return best;
}

/**
 * What progress is measured against, read from the field.
 * @param {{ playerUnits?: object[], enemyUnits?: object[], escapedUnits?: object[], battleConfig?: object }} field
 */
export function measureTurnPressure({
  playerUnits = [],
  enemyUnits = [],
  escapedUnits = [],
  battleConfig = null,
} = {}) {
  return {
    enemyCount: (enemyUnits || []).length,
    lordThroneDistance: bestLordThroneDistance(playerUnits, battleConfig),
    lordEscapeDistance: bestLordEscapeDistance(playerUnits, battleConfig),
    escapedCount: (escapedUnits || []).length,
    hasLivingBoss: (enemyUnits || []).some((u) => u?.isBoss && u.currentHP > 0),
  };
}

/** A fresh pressure state for a battle whose field reads `measure`. */
export function createTurnPressureState(measure) {
  return {
    noProgressTurns: 0,
    aggressiveMode: false,
    turnEnrageActive: false,
    bestEnemyCount: measure.enemyCount,
    bestLordThroneDistance: measure.lordThroneDistance,
    bestLordEscapeDistance: measure.lordEscapeDistance,
    bestEscapedCount: measure.escapedCount,
  };
}

/**
 * Advance the clock at the start of an enemy phase.
 * @param {object} state  previous state (not mutated)
 * @param {object} measure  measureTurnPressure(...) now
 * @param {{ turn:number, par:number|null, turnBonusConfig:object }} clock
 * @returns {{ state: object, aggressiveMode: boolean, turnEnrageActive: boolean, becameEnraged: boolean }}
 */
export function advanceTurnPressure(state, measure, { turn, par, turnBonusConfig } = {}) {
  const prev = state || {};
  // `?? Infinity` also covers Infinity → null after a JSON round trip (suspend
  // checkpoint / vision snapshot persistence).
  const bestThrone = prev.bestLordThroneDistance ?? Infinity;
  const bestEscape = prev.bestLordEscapeDistance ?? Infinity;
  const enemyProgress = measure.enemyCount < prev.bestEnemyCount;
  const seizeProgress = measure.lordThroneDistance < bestThrone;
  const escapeProgress =
    measure.lordEscapeDistance < bestEscape || measure.escapedCount > (prev.bestEscapedCount ?? 0);
  const progressed = enemyProgress || seizeProgress || escapeProgress;

  const next = { ...prev };
  if (progressed) {
    next.noProgressTurns = 0;
    next.bestEnemyCount = Math.min(prev.bestEnemyCount, measure.enemyCount);
    next.bestLordThroneDistance = Math.min(bestThrone, measure.lordThroneDistance);
    next.bestLordEscapeDistance = Math.min(bestEscape, measure.lordEscapeDistance);
    next.bestEscapedCount = Math.max(prev.bestEscapedCount ?? 0, measure.escapedCount);
  } else {
    next.noProgressTurns = (prev.noProgressTurns || 0) + 1;
  }

  const turnEnrageActive = Boolean(
    measure.hasLivingBoss && isBossEnrageActive(turn, par, turnBonusConfig),
  );
  const aggressiveMode = next.noProgressTurns >= ANTI_TURTLE_NO_PROGRESS_TURNS || turnEnrageActive;
  const becameEnraged = turnEnrageActive && !prev.turnEnrageActive;
  next.aggressiveMode = aggressiveMode;
  next.turnEnrageActive = turnEnrageActive;
  return { state: next, aggressiveMode, turnEnrageActive, becameEnraged };
}
