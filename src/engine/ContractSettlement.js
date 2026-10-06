// ContractSettlement.js — settle the open contract at a battle's victory commit
// (Contracts.js holds the record, the verdict and the words; docs/specs/event-nodes-phase2.md
// §2A). RunManager.completeBattle calls `settleContract` beside the burdens, after the roster,
// gold and burdens are committed so a reward lands on the units and gold the army now has.
//
// Kept in its own file because settling needs the event effect planner (EventEffects), which
// itself reads the contract record (Contracts.js): the record stays free of the planner.

import { applyPlan, planEffects, restoreRunState, snapshotRunState } from './EventEffects.js';
import { eventCatalogOf, runSeedOf } from './EventSystem.js';
import { withEclipseSeed } from './EclipseSystem.js';
import { contractOf, contractVerdict, settlementLines } from './Contracts.js';

/**
 * Settle the open contract for a won battle: judge it, apply the reward or the penalty, clear
 * the contract. Returns the settlement record (also left to the caller to store), or null
 * when no contract was open. Mutates the run (gold, units, burdens, ...) through the event
 * effect planner; see the header for what it guarantees.
 * @param {object} run
 * @param {{ nodeId: string, turnCount?: number, turnPar?: number|null, losses?: number }} battle
 */
export function settleContract(run, { nodeId, turnCount, turnPar, losses = 0 } = {}) {
  if (!run?.contract) return null;
  const contract = contractOf(run);
  run.contract = null;
  if (!contract) return null;
  const { kept, noPar } = contractVerdict(contract, { turnCount, turnPar, losses });
  const effects = kept ? contract.reward : contract.penalty;
  const settlement = {
    nodeId,
    contractNodeId: contract.nodeId,
    eventId: contract.eventId,
    goal: contract.goal,
    kept,
    noPar,
    losses: Math.max(0, Math.trunc(Number(losses) || 0)),
    results: [],
    failed: null,
    lines: [],
  };
  if (effects.length > 0) {
    withEclipseSeed(`event-contract:${runSeedOf(run)}:${contract.nodeId}`, () => {
      const ctx = {
        run,
        catalog: eventCatalogOf(run),
        nodeId: contract.nodeId,
        node: null,
        event: null,
        choice: { id: 'contract' },
        page: 'start',
        state: null,
        target: null,
        fallenUnit: null,
        phase: 'k',
      };
      const snapshot = snapshotRunState(run);
      try {
        const plan = planEffects(ctx, effects, { lenient: true });
        if (!plan.ok) settlement.failed = plan.reason || 'The terms could not be met.';
        else settlement.results = applyPlan(ctx, plan.steps);
      } catch (error) {
        restoreRunState(run, snapshot);
        settlement.results = [];
        settlement.failed = `The terms could not be met (${error.message}).`;
      }
    });
  }
  settlement.lines = settlementLines(settlement);
  return settlement;
}
