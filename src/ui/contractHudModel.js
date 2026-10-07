// contractHudModel.js — the words of the contract on the battle HUD (docs/specs/event-nodes-phase2.md
// §2E "Contract on the battle HUD"). Pure: strings from the contract's own description
// (Contracts.describeContract through the route map chip's model, so the two places read the
// same terms) and its standing in the battle (engine/ContractStanding.js).
//
//   Contract · Under par                  the contract is open
//   Contract · Under par — missed         a victory now would break it
//
// The full terms ride the line (hover, tap, focus): what is asked, what keeping it pays, what
// breaking it costs, and, once missed, why.

import { contractChipModel } from './eventMenuModel.js';

/** Why a missed contract is missed, by the standing's `cause`. */
const MISSED_NOTES = Object.freeze({
  par: 'Turn par has passed: a victory now breaks the contract.',
  losses: 'An ally has fallen: a victory now breaks the contract.',
});

/**
 * @param {object|null} contract Contracts.describeContract(run)
 * @param {object|null} standing ContractStanding.contractStanding(run, battle)
 * @returns {{ goal: string, status: 'open'|'missed', missed: boolean, text: string, note: string,
 *   terms: string, title: string }|null} null: nothing to show. `text`: the HUD line; `note`: why
 *   it is missed ('' while open); `terms`: the contract's terms as the route map chip words them;
 *   `title`: all of it in one string (hover, accessible name)
 */
export function contractHudModel(contract, standing) {
  if (!contract || !standing) return null;
  const chip = contractChipModel(contract);
  if (!chip) return null;
  const missed = standing.missed === true;
  const text = `${chip.label} · ${chip.short}${missed ? ' — missed' : ''}`;
  const note = missed ? MISSED_NOTES[standing.cause] || '' : '';
  return {
    goal: contract.goal,
    status: missed ? 'missed' : 'open',
    missed,
    text,
    note,
    terms: chip.terms,
    title: [`${text}.`, note, chip.terms].filter(Boolean).join(' '),
  };
}

/** The tap's help sheet (ContextHelp blocks): the line, why it is missed, then the terms. */
export function contractHelpBlocks(model) {
  if (!model) return [];
  return [{ lead: model.text }, model.note, model.terms].filter(Boolean);
}
