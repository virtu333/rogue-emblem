import { markHoldDisturbed } from './HoldDisturbance.js';

/** Settle validated movement atomically with respect to presentation. No RNG or UI. */
export function settleMoves(moves) {
  const facts = moves.map(({ unit, to }) => ({
    unit,
    from: { col: unit.col, row: unit.row },
    to: { col: to.col, row: to.row },
  }));
  for (const { unit, from, to } of facts) {
    unit.col = to.col;
    unit.row = to.row;
    if (from.col !== to.col || from.row !== to.row) markHoldDisturbed(unit, 'moved');
  }
  return facts;
}
