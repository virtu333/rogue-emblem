// CaptainLevel.js - the elite captain's level rule, shared by SetPieces (a set piece's captain
// slot) and SeatedBoss (an elite node's captain). A leaf module: imports nothing, so the two
// no longer import each other. SetPieces re-exports captainLevelFor for its older importers.

// Elite captains (and set-piece captains) sit above the act's range by this many levels: none
// in Act I, two in Act II, one from Act III on (Act IV, postAct, the finale), where the captain
// is a promoted class and a promoted level already outweighs a base one.
const CAPTAIN_LEVEL_OFFSET = { act1: 0, act2: 2 };
const CAPTAIN_DEFAULT_OFFSET = 1;

/**
 * A captain's level (MapGenerator's elite captain rule): the top of the battle's range plus the
 * act's captain offset. Never below 1. It is a spawn level like every other foe's, on one scale
 * whatever the class's tier: createPromotedEnemyUnit reads it as the whole level (the base class
 * to ENEMY_PROMOTION_BASE_LEVEL, the rest past promotion), as it reads a promoted filler's and an
 * act boss's, so a promoted captain takes nothing off (it once took the recruits' promotion base
 * off, which left an Act III captain about ten levels under its own escort).
 */
export function captainLevelFor(act, top) {
  const offset = CAPTAIN_LEVEL_OFFSET[act] ?? CAPTAIN_DEFAULT_OFFSET;
  const base = Math.max(1, Math.trunc(Number(top) || 1));
  return base + offset;
}
