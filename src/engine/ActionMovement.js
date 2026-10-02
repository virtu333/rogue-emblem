/** Settle validated movement atomically with respect to presentation. No RNG or UI. */
export function settleMoves(moves) {
  const facts = moves.map(({ unit, to }) => ({
    unit,
    from: { col: unit.col, row: unit.row },
    to: { col: to.col, row: to.row },
  }));
  for (const { unit, to } of facts) {
    unit.col = to.col;
    unit.row = to.row;
  }
  return facts;
}
