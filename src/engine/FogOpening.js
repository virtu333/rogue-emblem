// FogOpening.js — Lantern of the Road (`fog_opening_reveal`, an earned blessing:
// docs/specs/blessings-v3.md §6.1): a fog map opens revealed within `radius` tiles (Manhattan, the
// shape of a unit's own vision) of each of the army's units.
//
// The reveal is a contact (Grid.revealContact): it shows those tiles for the first player phase
// only (contacts are cleared as the enemy phase starts) and rides the fog in the suspend
// checkpoint and the Vision rewind (ui/fogState.js), so a resume restores it as it stood and never
// applies it again. Applied once, at a fresh battle's start, by BattleScene and the headless
// harness alike (one helper, so the two cannot disagree). A map without fog has nothing to reveal.
// Pure: no Phaser, no randomness.

/** The tiles within `radius` of any living unit in `units`, inside a `cols` x `rows` board. */
export function openingRevealTiles(units, radius, { cols = 0, rows = 0 } = {}) {
  const r = Math.max(0, Math.trunc(Number(radius)) || 0);
  const seen = new Set();
  const tiles = [];
  if (r <= 0) return tiles;
  for (const unit of units || []) {
    if (!unit || !(Number(unit.currentHP) > 0)) continue;
    if (!Number.isFinite(unit.col) || !Number.isFinite(unit.row)) continue;
    for (let dc = -r; dc <= r; dc++) {
      const span = r - Math.abs(dc);
      for (let dr = -span; dr <= span; dr++) {
        const col = unit.col + dc;
        const row = unit.row + dr;
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        const key = `${col},${row}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({ col, row });
      }
    }
  }
  return tiles;
}

/**
 * Reveal the opening tiles on `grid` (a fog map only). Returns true when it revealed anything:
 * the caller then updates the fog. Call it at a fresh battle's start, never on a resume.
 */
export function applyFogOpening(grid, units, radius) {
  const r = Math.max(0, Math.trunc(Number(radius)) || 0);
  if (r <= 0 || !grid?.fogEnabled || typeof grid.revealContact !== 'function') return false;
  const tiles = openingRevealTiles(units, r, grid);
  if (tiles.length === 0) return false;
  grid.revealContact(tiles);
  return true;
}
