// RescueAgent.js — a ScriptedAgent that goes to get the recruit.
//
// The stock ScriptedAgent only Talks when a lord happens to stand next to the NPC,
// so it measures "a player who ignores the recruit". This agent models a player who
// tries: while an NPC is on the field, lords act first and walk the shortest real
// path (terrain costs, unit blocking ignored for the long route) to a tile beside the
// recruit, and Talk the moment they can. Everyone else fights exactly like
// ScriptedAgent. Deterministic; it adds no randomness of its own.

import { ScriptedAgent } from '../../tests/agents/ScriptedAgent.js';
import { gridDistance } from '../../src/engine/Combat.js';

const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** Movement-cost distance field from every tile adjacent to `target` (Dijkstra). */
export function distanceFieldToAdjacent(grid, target, moveType) {
  const key = (c, r) => `${c},${r}`;
  const dist = new Map();
  const queue = [];
  for (const [dc, dr] of DIRS) {
    const c = target.col + dc;
    const r = target.row + dr;
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
    if (!Number.isFinite(grid.getMoveCost(c, r, moveType))) continue;
    dist.set(key(c, r), 0);
    queue.push({ c, r, d: 0 });
  }
  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const cur = queue.shift();
    if (cur.d > (dist.get(key(cur.c, cur.r)) ?? Infinity)) continue;
    // Reverse edge: stepping from (nc,nr) into (cur) costs the cost of cur's tile.
    const enterCost = grid.getMoveCost(cur.c, cur.r, moveType);
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
      if (nc === target.col && nr === target.row) continue;
      if (!Number.isFinite(grid.getMoveCost(nc, nr, moveType))) continue;
      const nd = cur.d + enterCost;
      if (nd < (dist.get(key(nc, nr)) ?? Infinity)) {
        dist.set(key(nc, nr), nd);
        queue.push({ c: nc, r: nr, d: nd });
      }
    }
  }
  return dist;
}

export class RescueAgent extends ScriptedAgent {
  constructor(driver) {
    super(driver);
    this._fieldCache = new Map();
  }

  _npc() {
    return this.driver.battle.npcUnits?.[0] || null;
  }

  _field(npc, moveType) {
    const k = `${npc.col},${npc.row},${moveType}`;
    if (!this._fieldCache.has(k))
      this._fieldCache.set(k, distanceFieldToAdjacent(this.driver.battle.grid, npc, moveType));
    return this._fieldCache.get(k);
  }

  chooseAction(legalActions) {
    const b = this.driver.battle;
    const npc = this._npc();
    if (!npc) return super.chooseAction(legalActions);

    // Talk beats everything once a lord stands beside the recruit.
    const talk = legalActions.find((a) => a.type === 'choose_action' && a.payload.label === 'Talk');
    if (talk) return talk;

    // Select an unacted lord first (the one closest to the recruit).
    const selects = legalActions.filter((a) => a.type === 'select_unit');
    if (selects.length) {
      const lords = selects
        .map((a) => ({ a, u: b.playerUnits.find((u) => u.name === a.payload.unitName) }))
        .filter((x) => x.u?.isLord);
      if (lords.length) {
        lords.sort(
          (x, y) =>
            gridDistance(x.u.col, x.u.row, npc.col, npc.row) -
            gridDistance(y.u.col, y.u.row, npc.col, npc.row),
        );
        return lords[0].a;
      }
      return super.chooseAction(legalActions);
    }

    // A selected lord walks toward the recruit.
    const moves = legalActions.filter((a) => a.type === 'move_to');
    const unit = b.selectedUnit;
    if (moves.length && unit?.isLord) {
      const field = this._field(npc, unit.moveType);
      const d = (m) => field.get(`${m.payload.col},${m.payload.row}`) ?? Infinity;
      const sorted = [...moves].sort((x, y) => d(x) - d(y));
      if (Number.isFinite(d(sorted[0]))) return sorted[0];
    }
    return super.chooseAction(legalActions);
  }
}
