// ContractSettlement.js — settle the open contract at a battle's victory commit, and deliver
// what it earned (Contracts.js holds the records, the verdict and the words; docs/specs/
// event-nodes-phase2.md §2A and "Contract settlement recovery"). RunManager.completeBattle calls
// `settleContract` beside the burdens, after the roster, gold and burdens are committed so a
// reward lands on the units and gold the army now has.
//
// JUDGE ONCE, DELIVER UNTIL DELIVERED OR GIVEN UP. `settleContract` judges the contract exactly
// once and, in the same step, clears `run.contract` and writes the durable owed record
// `run.contractOwed` (Contracts.js header). `deliverContractSettlement` then pays it: the common
// case is paid at the victory, and anything that cannot be paid right now stays owed:
//   blocked  an item has nowhere to go (the planner's "No room for Steel Lance"): nothing is
//            applied at all, so the player can make room and Claim;
//   failed   applying threw (or the planner refused the terms): the run is put back as it was
//            before the attempt, including this very record.
// Every attempt plans in the same seeded swap (`seedKey`), so a retry pays exactly what the first
// attempt would have (same item, same rolls), never a partial list, never twice. Nothing is
// judged again: the record carries the verdict, not the battle.
//
// Kept in its own file because settling needs the event effect planner (EventEffects), which
// itself reads the contract record (Contracts.js): the record stays free of the planner.

import { applyPlan, planEffects, restoreRunState, snapshotRunState } from './EventEffects.js';
import { eventCatalogOf, runSeedOf } from './EventSystem.js';
import { withEclipseSeed } from './EclipseSystem.js';
import { contractOf, contractOwedOf, contractVerdict, settlementLines } from './Contracts.js';
import { describeResult } from './EventResultWords.js';

/** What a settlement says to the victory band and the settlement page (the presentation record). */
function presentation(owed, { results = [], blocked = null, failed = null, forfeited = false }) {
  const settlement = {
    nodeId: owed.battleNodeId,
    contractNodeId: owed.contractNodeId,
    eventId: owed.eventId,
    goal: owed.goal,
    kept: owed.kept,
    noPar: owed.noPar,
    losses: owed.losses,
    results,
    owed: Boolean(blocked || failed),
    blocked,
    failed,
    lines: [],
  };
  if (forfeited) settlement.forfeited = true;
  settlement.lines = settlementLines(settlement);
  return settlement;
}

/**
 * Settle the open contract for a won battle: judge it ONCE, write the owed record, clear the
 * contract and try to deliver. Returns the settlement presentation record (also left on
 * `run.lastContractSettlement`), or null when there was nothing to settle. With no open
 * contract, a settlement an earlier victory could not deliver gets another try now (this is how
 * a penalty that failed is retried), and its record is returned.
 * Mutates the run (gold, units, burdens, ...) through the event effect planner.
 * @param {object} run
 * @param {{ nodeId: string, turnCount?: number, turnPar?: number|null, losses?: number }} battle
 */
export function settleContract(run, { nodeId, turnCount, turnPar, losses = 0 } = {}) {
  if (!run) return null;
  // A settlement still owed from an earlier victory is delivered first. (No command can sign a
  // contract over one, so an open contract beside an owed record is only a hand-edited run;
  // it is judged by a later victory, once the record is paid, never over it.)
  if (contractOwedOf(run)) {
    const retried = deliverContractSettlement(run);
    if (!run.contract || contractOwedOf(run)) return retried?.settlement ?? null;
  }
  if (!run.contract) return null;
  const contract = contractOf(run);
  run.contract = null;
  if (!contract) return null;
  const { kept, noPar } = contractVerdict(contract, { turnCount, turnPar, losses });
  // The verdict and the terms, written in one step with the contract cleared: from here the
  // record is all that is left to pay, whatever happens to the delivery.
  run.contractOwed = {
    battleNodeId: nodeId,
    contractNodeId: contract.nodeId,
    eventId: contract.eventId,
    act: run.currentAct || contract.act || null,
    goal: contract.goal,
    kept,
    noPar,
    losses: Math.max(0, Math.trunc(Number(losses) || 0)),
    effects: kept ? contract.reward : contract.penalty,
    seedKey: `event-contract:${runSeedOf(run)}:${contract.nodeId}`,
    blocked: null,
    failed: null,
  };
  return deliverContractSettlement(run)?.settlement ?? null;
}

/**
 * Pay the owed settlement. Plans the terms (the planner's own rules: a weapon needs weapon
 * space, an item consumable space, the convoy counts) and applies them only when every item has
 * room. Returns null when nothing is owed, else
 *   { ok: true, settlement }                 paid (the record is cleared; `settlement.results`
 *                                            says what arrived)
 *   { ok: false, blocked: boolean, reason, settlement }   still owed: `blocked` for no room (nothing
 *                                            was applied), else the apply failed (the run was put
 *                                            back). `settlement.lines` says it in the band's words.
 * Leaves the result on `run.lastContractSettlement`. The caller saves the run.
 * @param {object} run
 */
export function deliverContractSettlement(run) {
  const owed = contractOwedOf(run);
  if (!owed) return null;
  run.contractOwed = owed;
  const seedKey = owed.seedKey || `event-contract:${runSeedOf(run)}:${owed.contractNodeId}`;
  const attempt = withEclipseSeed(seedKey, () => {
    const ctx = {
      run,
      catalog: eventCatalogOf(run),
      nodeId: owed.contractNodeId,
      node: null,
      event: null,
      choice: { id: 'contract' },
      page: 'start',
      state: null,
      target: null,
      fallenUnit: null,
      phase: 'k',
    };
    let plan;
    try {
      // Lenient so that what can never be delivered (no blessing left, an item this build does
      // not know) is a note, not a claim that holds the party for good; an item with no ROOM is
      // the one skip that waits: it is told apart below and nothing is applied.
      plan = planEffects(ctx, owed.effects, { lenient: true });
    } catch (error) {
      return { failed: `The terms could not be met (${error.message}).` };
    }
    if (!plan.ok) return { failed: plan.reason || 'The terms could not be met.' };
    const short = plan.steps.find((step) => step.type === 'note' && step.note?.noRoom === true);
    if (short) return { blocked: describeResult(short.note)?.text || 'No room for the item' };
    // Taken while the record is still owed, so putting the run back puts the claim back too.
    const snapshot = snapshotRunState(run);
    try {
      return { results: applyPlan(ctx, plan.steps) };
    } catch (error) {
      restoreRunState(run, snapshot);
      return { failed: `The terms could not be met (${error.message}).` };
    }
  });
  if (attempt.results) {
    run.contractOwed = null;
    const settlement = presentation(owed, { results: attempt.results });
    run.lastContractSettlement = settlement;
    return { ok: true, settlement };
  }
  run.contractOwed = { ...owed, blocked: attempt.blocked || null, failed: attempt.failed || null };
  const settlement = presentation(owed, { blocked: attempt.blocked, failed: attempt.failed });
  run.lastContractSettlement = settlement;
  return {
    ok: false,
    blocked: Boolean(attempt.blocked),
    reason: attempt.blocked || attempt.failed || '',
    settlement,
  };
}

/**
 * The player gives an owed REWARD up: terminal and saved with the run, applies nothing and
 * releases the party. Refused for anything but an owed reward (a penalty is never forfeited,
 * it is retried). The caller asks for the player's explicit confirmation first, like
 * EventCommands.forfeitEventSpoils.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function forfeitContractReward(run) {
  const owed = contractOwedOf(run);
  if (!owed) return { ok: false, reason: 'No contract reward is owed.' };
  if (!owed.kept) return { ok: false, reason: 'A penalty cannot be given up.' };
  run.contractOwed = null;
  run.lastContractSettlement = presentation(owed, { forfeited: true });
  return { ok: true };
}
