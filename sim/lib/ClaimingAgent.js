// ClaimingAgent.js — TacticianAgent plus the two battle habits the blessing sims need
// (tests/sim/ClaimingRunDriver.js, docs/sim-reports/blessings-v3-balance.md):
//
// * Steal. A Thief (any unit with a usable `steal_item` ability) plans a Steal like any other
//   action: from every tile it can reach, the carriers beside that tile it could rob there (the
//   engine's finder, engine/ActionAbilitySystem.findStealTargets, with the battle's own context:
//   the seen foes, the convoy's room and the run's speed waiver). A steal is worth about a
//   likely kill (the item is lost when the carrier falls first), less the landing tile's danger.
//   It needs the harness's opt-in Steal (HeadlessBattle `options.steal`); without it the menu
//   never offers Steal and the agent plays exactly as TacticianAgent.
// * Caution. After a Vision rewind the driver sets `caution` for the turn replayed: every unit
//   then plans against the worst case (every blow lands), as TacticianAgent plans the commander,
//   so the replayed turn is played more carefully instead of repeating the move that lost. The
//   battle's dice are put back by the rewind (fixed-v1: the same stream), so only the choices
//   differ.
//
// Deterministic: no randomness of its own.

import { TacticianAgent } from './TacticianAgent.js';
import { findStealTargets } from '../../src/engine/ActionAbilitySystem.js';
import { gridDistance } from '../../src/engine/Combat.js';

const STEAL_SCORE = 28;

export class ClaimingAgent extends TacticianAgent {
  constructor(driver, options = {}) {
    super(driver, options);
    this.caution = options.caution === true;
  }

  /** Cautious: every unit plans against the worst case, as the commander always does. */
  _lethal(unit, danger, hp) {
    if (this.caution) return danger.worst >= hp;
    return super._lethal(unit, danger, hp);
  }

  _planFor(u, threats, advance) {
    const best = super._planFor(u, threats, advance);
    const steal = this._bestStealPlan(u, threats);
    if (steal && (!best || steal.score > best.score)) return steal;
    return best;
  }

  /** The best Steal this unit can make this turn, or null (no Steal, no carrier in reach). */
  _bestStealPlan(u, threats) {
    const b = this.b;
    if (!b.stealEnabled || typeof b._stealSkill !== 'function') return null;
    const skill = b._stealSkill(u);
    if (!skill) return null;
    const carriers = b.enemyUnits.filter((e) => e.carriedItem && e.currentHP > 0);
    if (carriers.length === 0) return null;
    const ctx = b._stealContext(u);
    const lethalWeight = u.isCommander ? 60 : 18;
    let best = null;
    for (const tile of this._reach(u)) {
      if (!carriers.some((c) => gridDistance(tile.col, tile.row, c.col, c.row) === 1)) continue;
      const placed = { ...u, col: tile.col, row: tile.row };
      const targets = findStealTargets(placed, skill.actionAbility, ctx);
      if (targets.length === 0) continue;
      const danger = this._danger(u, tile, threats);
      const score =
        STEAL_SCORE -
        0.6 * danger.total -
        (this._lethal(u, danger, u.currentHP) ? lethalWeight : 0);
      if (!best || score > best.score)
        best = { unit: u, tile, action: 'Steal', target: targets[0].unit, score };
    }
    return best;
  }
}
