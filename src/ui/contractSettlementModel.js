// contractSettlementModel.js — the words of the contract settlement page, as plain data
// (docs/specs/event-nodes-phase2.md "Contract settlement recovery"). Pure: no Phaser, no DOM.
// The engine (Contracts / ContractSettlement) decides what is owed and why it waits; this says it.
//
// Three phases:
//   owed       a contract's reward (or penalty) is earned and not delivered: what is owed, why it
//              waits ("No room for Steel Lance"), and the ways on (Claim, Roster, Back to map and,
//              for a reward only, a confirmed Give up)
//   paid       a Claim delivered it: what arrived, in the Event page's own words; Continue
//   forfeited  the reward was given up: said plainly; Continue

import { describeOwedContract } from '../engine/Contracts.js';
import { eventResultLines } from './eventMenuModel.js';

/** The words a Claim that did not deliver says beside the page ("Still waiting: …"). */
export const claimStillWaitingLine = (reason) =>
  reason ? `Still waiting: ${reason}` : 'Still waiting.';

/** The header button's word: the page leaves the party held while owed, so it is Back to map. */
export const contractSettlementCloseLabel = (view) =>
  !view || view.phase === 'owed' ? 'Back to map' : 'Continue';

/**
 * What the page shows.
 * @param {object} run - RunManager
 * @param {{ kind: 'paid'|'forfeited', settlement: object }|null} outcome - the page's own last
 *   step (a Claim that delivered, a confirmed Give up), kept by the controller for the page
 * @param {{ gameData?: object }} [options]
 * @returns {object|null} null when there is nothing to show
 */
export function contractSettlementView(run, outcome = null, { gameData = null } = {}) {
  const owed = describeOwedContract(run);
  if (owed) {
    const what = owed.kept ? 'reward' : 'penalty';
    const waiting = owed.blocked || !owed.failed;
    return {
      phase: 'owed',
      kept: owed.kept,
      title: owed.kept ? 'Contract kept' : 'Contract broken',
      kicker: 'CONTRACT',
      goal: owed.goalShort,
      what,
      owed: owed.owed,
      headline: waiting
        ? `The ${what} is waiting.`
        : owed.kept
          ? 'The reward could not be paid yet.'
          : 'The penalty could not be applied yet.',
      why: owed.reason,
      hint: owed.blocked
        ? 'Make room in a bag or the convoy, then Claim. Nothing is lost until you give it up.'
        : owed.kept
          ? 'Nothing was lost: it stays owed until you try again or give it up.'
          : 'Nothing was taken: it stays owed and is tried again.',
      claimLabel: owed.kept ? 'Claim' : 'Try again',
      canGiveUp: owed.kept,
      eventId: owed.eventId,
    };
  }
  const settlement = outcome?.settlement;
  if (!outcome || !settlement) return null;
  const kept = settlement.kept !== false;
  const title = kept ? 'Contract kept' : 'Contract broken';
  if (outcome.kind === 'forfeited')
    return {
      phase: 'forfeited',
      kept,
      title,
      kicker: 'CONTRACT',
      goal: '',
      headline: 'You gave up the reward.',
      lines: [],
      eventId: settlement.eventId,
    };
  const lines = eventResultLines(settlement.results, { gameData });
  return {
    phase: 'paid',
    kept,
    title,
    kicker: 'CONTRACT',
    goal: '',
    headline: kept ? 'The reward arrived.' : 'The penalty was applied.',
    lines,
    eventId: settlement.eventId,
  };
}
