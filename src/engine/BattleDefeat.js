// The commander rule is shared by the immediate combat boundary and the full
// battle-end decision. Escaped commanders are safe; other lords may fall.
export function hasBattleDefeat(playerUnits, escapedUnits) {
  const escaped = escapedUnits || [];
  const commanderAlive =
    playerUnits.some((unit) => unit.isCommander && unit.currentHP > 0) ||
    escaped.some((unit) => unit.isCommander);
  const fieldEmpty = playerUnits.length === 0 && escaped.length === 0;
  return !commanderAlive || fieldEmpty;
}
