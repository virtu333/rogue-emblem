// TurnAnchor.js - "has this unit moved this turn?" (pure leaf module, no imports). The player
// units' anchors are stamped as each player phase begins (scene and harness, beside the per-turn
// flag reset), and read by Hold the Line (BlessingCombatMods) and the Epic weapons' rules
// (EpicWeapons `holdingGround`).

/**
 * Remember where each living unit stood as `turn`'s player phase began. Hold the Line reads it
 * through the player phase and the enemy phase that follows. Called wherever the player
 * units' per-turn flags are reset.
 */
export function stampTurnAnchors(units, turn) {
  for (const unit of units || []) {
    if (!unit || (unit.currentHP ?? 1) <= 0) continue;
    unit._turnAnchor = { turn, col: unit.col, row: unit.row };
  }
}

/**
 * Hold the Line's predicate: the unit has not moved this turn. True while it stands on the tile
 * `stampTurnAnchors` recorded for `turn`, has not been marked as moved and has spent no
 * movement; this holds through the enemy phase after it (a push or a Blink off the tile
 * ends it). A unit with no anchor for this turn (a mid-turn arrival, an older checkpoint)
 * is not holding. A move a hidden foe blocked before the first step still marks the unit as
 * moved ("it tried to move"), so it stops holding; that is intended.
 */
export function isHoldingGround(unit, turn) {
  const anchor = unit?._turnAnchor;
  if (!anchor || !Number.isFinite(turn) || anchor.turn !== turn) return false;
  if (unit.col !== anchor.col || unit.row !== anchor.row) return false;
  if (unit.hasMoved === true) return false;
  if ((Number(unit._movementSpent) || 0) > 0) return false;
  return true;
}
