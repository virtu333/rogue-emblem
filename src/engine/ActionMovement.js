import { markHoldDisturbed } from './HoldDisturbance.js';

/**
 * Settle validated movement atomically with respect to presentation. No RNG or UI.
 * A move may carry the tiles it crossed (`path`, from its tile to `to`: a forced slide,
 * ForcedMovement.js); the fact repeats it so the presentation can draw the slide. Only
 * `to` is state.
 */
export function settleMoves(moves) {
  const facts = moves.map(({ unit, to, path }) => ({
    unit,
    from: { col: unit.col, row: unit.row },
    to: { col: to.col, row: to.row },
    ...(Array.isArray(path) && path.length > 1 ? { path } : {}),
  }));
  for (const { unit, from, to } of facts) {
    unit.col = to.col;
    unit.row = to.row;
    if (from.col !== to.col || from.row !== to.row) markHoldDisturbed(unit, 'moved');
  }
  return facts;
}
