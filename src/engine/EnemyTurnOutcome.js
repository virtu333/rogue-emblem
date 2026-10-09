// EnemyTurnOutcome — what an enemy's AI decision commits the battle to (pure).
//
// AIController._processOneEnemy acts on exactly these decision fields: `path` (a move
// of two tiles or more), `healTarget`, `statusStaffTarget`, `target` (an attack) and
// `breakTile`. A decision with none of them (hold, asleep, guard_hold, healer_hold,
// artillery_hold, boss_hold_throne, no_viable_target, no_reachable_move without a break,
// an Entity with nobody in range) resolves nothing: the unit only ends its turn.
//
// Why such a turn needs no suspend checkpoint of its own (docs/specs/large-maps/
// 02-encounters-and-pacing.md §2.5):
// - Deciding draws no randomness (AIController has no Math.random and never reads the
//   battle RNG; the enemy weapon-art roll happens only inside combat) and reads only
//   state the last checkpoint holds (units, grid, the anti-turtle flags), so a resume
//   from that checkpoint replays the turn identically, its bookkeeping included
//   (`_aiNoMoveStreak`, `guardPost`, a spent-weapon swap).
// - Under the default rewind policy a checkpoint reseeds the battle RNG, and the stored
//   seed and state are what a resume restores; with no checkpoint (and no draw) in
//   between, the live stream and a resumed one stay aligned.
// - The next acting enemy's checkpoint (or the next turn start's) carries the turn as
//   `hasActed`; with every enemy idle, the phase replays from End Turn's checkpoint,
//   which is already the designed recovery.

/**
 * True when the decision commits nothing for the executor to carry out. Unknown or
 * missing decisions are never idle, so the caller keeps its checkpoint.
 * @param {object|null|undefined} decision an AIController decision
 * @returns {boolean}
 */
export function isIdleEnemyDecision(decision) {
  if (!decision || typeof decision !== 'object') return false;
  if (Array.isArray(decision.path) && decision.path.length >= 2) return false;
  return (
    !decision.target && !decision.healTarget && !decision.statusStaffTarget && !decision.breakTile
  );
}
