// SeizeParFloor.js — the lowest seize par a map may have on a rung with a seize par
// offset (docs/specs/dusk-pressure.md §2b). Pure, no Phaser, no RNG.
//
// The offset tightens seize par, so on a small map, or one with a long road to the
// throne, par − 3 (an S) could fall below the turns a lord needs just to walk there. The
// floor keeps an S reachable for a lord who walks straight to the throne:
//
//   floor = turns for the slowest lord to reach the throne, ignoring enemies
//           + 3 (an S is par − 3 or better)
//           + 1 (one turn to beat the boss on the throne before the seize)
//
// The slowest lords are Infantry with MOV 4 (Edric, Kira, Voss, Sera, Cael); the player
// can place a lord on any deploy tile, so the walk starts from the nearest one.
// MapGenerator locks the floor into the battle config (`parFloor`) with the offset, and
// TurnBonusCalculator.calculatePar applies it, never above the map's First Light par.

export const SEIZE_FLOOR_LORD_MOV = 4;
export const SEIZE_FLOOR_MOVE_TYPE = 'Infantry';
/** 3 turns for the S threshold + 1 for the boss on the throne. */
export const SEIZE_FLOOR_MARGIN = 4;

function stepCost(terrainData, idx, moveType) {
  const raw = terrainData?.[idx]?.moveCost?.[moveType];
  if (raw === '--' || raw === undefined) return Infinity;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * Turns a unit with `mov` needs to stand on `target`, starting from the nearest source
 * on turn 1 with full movement, ignoring every unit (a tile costing more than the
 * movement left waits for the next turn). Null when it can never get there.
 */
export function turnsToReach({
  mapLayout,
  cols,
  rows,
  terrainData,
  sources,
  target,
  mov = SEIZE_FLOOR_LORD_MOV,
  moveType = SEIZE_FLOOR_MOVE_TYPE,
}) {
  if (!target || !Array.isArray(mapLayout) || !(mov > 0)) return null;
  const n = cols * rows;
  // Best (turn, movement left) per tile: fewer turns first, then more movement left.
  const turnOf = new Array(n).fill(Infinity);
  const leftOf = new Array(n).fill(-1);
  const better = (i, t, left) => t < turnOf[i] || (t === turnOf[i] && left > leftOf[i]);
  const queue = [];
  for (const s of sources || []) {
    if (!(s?.col >= 0 && s.row >= 0 && s.col < cols && s.row < rows)) continue;
    const i = s.row * cols + s.col;
    if (better(i, 1, mov)) {
      turnOf[i] = 1;
      leftOf[i] = mov;
      queue.push(i);
    }
  }
  // Label-correcting search: a tile is re-expanded whenever it improves.
  while (queue.length) {
    queue.sort((a, b) => turnOf[b] - turnOf[a] || leftOf[a] - leftOf[b]);
    const i = queue.pop();
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      const cost = stepCost(terrainData, mapLayout[nr][nc], moveType);
      if (!(cost <= mov)) continue;
      const t = cost <= leftOf[i] ? turnOf[i] : turnOf[i] + 1;
      const left = cost <= leftOf[i] ? leftOf[i] - cost : mov - cost;
      if (better(j, t, left)) {
        turnOf[j] = t;
        leftOf[j] = left;
        queue.push(j);
      }
    }
  }
  const turns = turnOf[target.row * cols + target.col];
  return Number.isFinite(turns) ? turns : null;
}

/** The seize par floor for a map, or null without a throne or a road to it. */
export function seizeParFloor({ mapLayout, cols, rows, terrainData, playerSpawns, thronePos }) {
  const turns = turnsToReach({
    mapLayout,
    cols,
    rows,
    terrainData,
    sources: playerSpawns,
    target: thronePos,
  });
  return turns === null ? null : turns + SEIZE_FLOOR_MARGIN;
}
