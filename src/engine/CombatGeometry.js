// CombatGeometry.js - two tiny pure combat helpers that EntitySystem and AffixSystem need
// without importing Combat.js (which imports them back). A leaf module: imports nothing.
// Combat.js re-exports both, so older importers keep working.

/** Manhattan distance between two grid positions */
export function gridDistance(col1, row1, col2, row2) {
  return Math.abs(col1 - col2) + Math.abs(row1 - row2);
}

/** The damage Thorns reflects for a hit of `damage`: rounded down, so small hits reflect 0. */
export function thornsReflectDamage(damage, pct) {
  return Math.max(0, Math.floor((Number(damage) || 0) * (Number(pct) || 0)));
}
