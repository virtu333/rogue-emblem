// Contracts.js — a goal for the next battle, with a reward and a penalty
// (docs/specs/event-nodes-phase2.md §2A "`contract` effect"; the Mercenary Contract event).
//
// A contract is a plain record on `run.contract` (null when none is open; saved with the run):
//   { goal: 'underPar' | 'noLosses', reward: [effects], penalty: [effects],
//     eventId, nodeId, act }
// ONE at a time: a choice that can open a contract is blocked while one is open
// (EventCommands.eventChoiceBlock; the planner refuses a second as well).
//
// Settlement (ContractSettlement.js, `settleContract`) happens at exactly one place, the battle's victory commit
// (RunManager.completeBattle, beside Burdens.burdenEffectsOnVictory, after the roster, gold
// and burdens are committed so a reward lands on the units and gold the army now has), for the
// NEXT battle victory of any kind (a boss included). Nothing is settled mid-battle: a Vision
// rewind, a suspend/resume and "Continue from Map" restore the run's entry state and never
// run a victory commit, so they never touch the contract. A defeat ends the run as always.
//
//   underPar   `turnCount <= turnPar`. A battle with no par (the prologue's chapters; a
//              harness that passes none) cannot be judged: the contract is KEPT. Two
//              reasons: a goal the player could not see the number for is not one they can
//              fail, and a penalty such as Debt must never land for something unmeasurable.
//              (The cost is an unearned reward, only ever on a battle that shows no par.)
//   noLosses   no player unit fell in THAT battle: nobody on the roster as it entered, and no
//              recruit who joined mid-battle (Talk), is missing from the survivors.
//
// The reward (kept) or the penalty (broken) is a list of event effects, applied through the
// event effect planner: planned first, then applied. A penalty may carry `burden` effects
// (Debt, Hunted): the burden effect is the same one an event uses. If applying throws, the
// run's fields are put back as they were before it and the settlement stays owed (below).
//
// The result is `run.lastContractSettlement` (not saved, like lastBurdenSettlement), for the
// victory band:
//   { nodeId, contractNodeId, eventId, goal, kept, noPar, losses, results: [records],
//     owed: boolean, blocked: string|null, failed: string|null, forfeited?: true,
//     lines: ['Contract kept: Gained 600 G'] }
// (`lines` says every result in the Event page's own words and what is still owed; see
// `settlementLines`.)
// `describeContract(run)` is the display model of the open contract (the route map's chip).
//
// Settlement runs in a seeded swap (`event-contract:${runSeed}:${nodeId}`), so an item's pick
// and uid are the same on a replay.
//
// ── An earned settlement is OWED until it is delivered (recovery) ─────────────────────────
// A contract is judged ONCE, at the victory commit, and that verdict is final. In one step
// `settleContract` clears `run.contract` and writes a durable, saved record `run.contractOwed`:
//   { battleNodeId, contractNodeId, eventId, act, goal, kept, noPar, losses,
//     effects: [the reward (kept) or the penalty (broken)], seedKey, blocked, failed }
// then asks `deliverContractSettlement` to pay it at once, so the common case is paid at the
// victory. The delivery plans the effects and refuses (`blocked`: "No room for Steel Lance")
// when an item has nowhere to go, applies nothing then, and when applying throws it puts the
// run back (`failed`); either way the record stays owed, is never re-judged against a later
// battle, and pays the very same thing on every retry (the seed key never changes). Only an
// owed REWARD holds the party at its battle node (`contractRewardOwedAt`; RunManager.
// getAvailableNodes) and may be given up, behind the player's explicit confirmation
// (`forfeitContractReward`); an owed PENALTY never holds anyone and is retried on the next
// attempt (a Claim, the next battle victory). While anything is owed no new contract may be
// signed (`contractBound`). The record is not an open contract: `describeContract`, the HUD
// and ContractStanding never read it; the route map's chip reads `describeOwedContract`.
//
// Pure of Phaser and the DOM.

import { eventCatalogOf, resolveAmount } from './EventSystem.js';
import { burdenDefFor } from './Burdens.js';
import { describeResult } from './EventResultWords.js';

export const CONTRACT_GOALS = Object.freeze(['underPar', 'noLosses']);

/**
 * The effect types a reward or penalty may hold: everything that needs no chosen unit and no
 * event page (no learnSkill/fallenSkill/layToRest/consume/battle, no nested contract/routeEdit,
 * no counter, no join).
 */
export const CONTRACT_EFFECT_TYPES = Object.freeze([
  'gold',
  'item',
  'hp',
  'shadow',
  'vision',
  'blessing',
  'burden',
  'flag',
  'stat',
]);

const GOAL_LINES = Object.freeze({
  underPar: { short: 'Under par', line: 'Win the next battle by turn par or sooner.' },
  noLosses: { short: 'No losses', line: 'Win the next battle without losing anyone.' },
});

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function cleanEffects(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((effect) => isPlain(effect) && CONTRACT_EFFECT_TYPES.includes(effect.type))
    .map((effect) => structuredClone(effect));
}

/** A contract from a save or an effect: a valid, plain record, or null. */
export function normalizeContract(raw) {
  if (!isPlain(raw) || !CONTRACT_GOALS.includes(raw.goal)) return null;
  return {
    goal: raw.goal,
    reward: cleanEffects(raw.reward),
    penalty: cleanEffects(raw.penalty),
    eventId: typeof raw.eventId === 'string' ? raw.eventId : '',
    nodeId: typeof raw.nodeId === 'string' && raw.nodeId ? raw.nodeId : 'contract',
    act: typeof raw.act === 'string' ? raw.act : null,
  };
}

/** The open contract of a run (a normalized copy), or null. */
export function contractOf(run) {
  return normalizeContract(run?.contract);
}

// ── The owed record ─────────────────────────────────────────────────────

const str = (value) => (typeof value === 'string' ? value : '');

/** An owed record from a save or the settlement: a valid, plain record, or null. */
export function normalizeContractOwed(raw) {
  if (!isPlain(raw) || !CONTRACT_GOALS.includes(raw.goal) || typeof raw.kept !== 'boolean')
    return null;
  const battleNodeId = str(raw.battleNodeId);
  const contractNodeId = str(raw.contractNodeId) || 'contract';
  if (!battleNodeId) return null;
  return {
    battleNodeId,
    contractNodeId,
    eventId: str(raw.eventId),
    act: typeof raw.act === 'string' ? raw.act : null,
    goal: raw.goal,
    kept: raw.kept,
    noPar: raw.noPar === true,
    losses: Math.max(0, Math.trunc(Number(raw.losses) || 0)),
    effects: cleanEffects(raw.effects),
    seedKey: str(raw.seedKey),
    blocked: str(raw.blocked) || null,
    failed: str(raw.failed) || null,
  };
}

/** The owed settlement of a run (a normalized copy), or null. */
export function contractOwedOf(run) {
  return normalizeContractOwed(run?.contractOwed);
}

/** Whether a kept contract's reward is earned but not yet delivered. */
export function contractRewardOwed(run) {
  return contractOwedOf(run)?.kept === true;
}

/** Whether a broken contract's penalty is earned but not yet applied. */
export function contractPenaltyOwed(run) {
  return contractOwedOf(run)?.kept === false;
}

/**
 * Whether `node` is where an owed reward holds the party: the battle node whose victory
 * earned it, in the act it was earned in, once complete. Like EventSystem.eventSpoilsOwedAt,
 * read from the saved record alone. A penalty never holds anyone.
 */
export function contractRewardOwedAt(run, node) {
  const owed = contractOwedOf(run);
  if (!owed?.kept || !node || node.completed !== true || node.id !== owed.battleNodeId)
    return false;
  return owed.act === null || owed.act === run?.currentAct;
}

/** One contract at a time: bound by an open contract or by a settlement not yet delivered. */
export function contractBound(run) {
  return Boolean(contractOf(run) || contractOwedOf(run));
}

/**
 * Whether the goal was met. `losses` is the number of player units that fell in the battle;
 * `turnCount` and `turnPar` the battle's turn and par. A missing par (or turn count) keeps an
 * `underPar` contract (see the header).
 * @returns {{ kept: boolean, noPar: boolean }}
 */
export function contractVerdict(contract, { turnCount, turnPar, losses = 0 } = {}) {
  if (contract?.goal === 'noLosses') return { kept: !(Number(losses) > 0), noPar: false };
  const par = Number(turnPar);
  const turns = Number(turnCount);
  if (turnPar === null || turnPar === undefined || !Number.isFinite(par) || !Number.isFinite(turns))
    return { kept: true, noPar: true };
  return { kept: turns <= par, noPar: false };
}

// ── Words ───────────────────────────────────────────────────────────────

/** One short phrase for a planned effect ("+600 G", "Debt 300 G"); '' for nothing worth saying. */
function effectPhrase(effect, run) {
  const catalog = eventCatalogOf(run);
  switch (effect?.type) {
    case 'gold': {
      const value = resolveAmount(effect.value, run?.currentAct);
      return value < 0 ? `−${-value} G` : `+${value} G`;
    }
    case 'item': {
      if (effect.name) return effect.name;
      const finer = Number(effect.pool?.tierOffset) >= 1;
      if (effect.pool?.kind === 'accessory') return finer ? 'A finer accessory' : 'An accessory';
      return finer ? 'A finer weapon' : 'A weapon';
    }
    case 'hp': {
      const amount = effect.percent !== undefined ? `${effect.percent}%` : `${effect.value ?? ''}`;
      return `${effect.mode === 'heal' ? 'Heal' : 'Wound'} ${amount}`.trim();
    }
    case 'shadow':
      return `Shadow ${Number(effect.value) > 0 ? '+' : '−'}${Math.abs(Number(effect.value) || 0)}`;
    case 'vision':
      return `Vision ${Number(effect.value) > 0 ? '+' : '−'}${Math.abs(Number(effect.value) || 0)}`;
    case 'blessing':
      return 'A blessing';
    case 'burden': {
      const label = burdenDefFor(catalog, effect.id, run?.difficultyId)?.label || effect.id;
      const owed =
        effect.params?.owed !== undefined ? resolveAmount(effect.params.owed, run?.currentAct) : 0;
      return owed > 0 ? `${label} ${owed} G` : label;
    }
    case 'stat': {
      const stats = Array.isArray(effect.stat) ? effect.stat.join('/') : effect.stat;
      return `${Number(effect.value) > 0 ? '+' : '−'}${Math.abs(Number(effect.value) || 0)} ${stats}`;
    }
    default:
      return '';
  }
}

const phrases = (effects, run) => effects.map((e) => effectPhrase(e, run)).filter(Boolean);

/**
 * The open contract for the route map's chip and the pause menu, or null:
 * { goal, label: 'Contract', short, line, reward: [phrase], penalty: [phrase], eventId, nodeId }.
 */
export function describeContract(run) {
  const contract = contractOf(run);
  if (!contract) return null;
  const words = GOAL_LINES[contract.goal];
  return {
    goal: contract.goal,
    label: 'Contract',
    short: words.short,
    line: words.line,
    reward: phrases(contract.reward, run),
    penalty: phrases(contract.penalty, run),
    eventId: contract.eventId,
    nodeId: contract.nodeId,
  };
}

/**
 * The owed settlement for the route map's chip, the pause list and the settlement page, or null:
 * { label: 'Contract', short: 'Reward waiting' | 'Penalty waiting', kept, goal, goalShort, owed: [phrase],
 *   reason, blocked: bool, failed: bool, eventId, battleNodeId, contractNodeId }.
 * `reason` is why it waits ('' when it simply has not been tried): the planner's "No room for
 * Steel Lance", or "The terms could not be met (…)" when applying failed.
 */
export function describeOwedContract(run) {
  const owed = contractOwedOf(run);
  if (!owed) return null;
  return {
    label: 'Contract',
    short: owed.kept ? 'Reward waiting' : 'Penalty waiting',
    kept: owed.kept,
    goal: owed.goal,
    goalShort: GOAL_LINES[owed.goal].short,
    owed: phrases(owed.effects, run),
    reason: owed.blocked || owed.failed || '',
    blocked: Boolean(owed.blocked),
    failed: Boolean(owed.failed),
    eventId: owed.eventId,
    battleNodeId: owed.battleNodeId,
    contractNodeId: owed.contractNodeId,
  };
}

/**
 * The victory band's words for a settlement: ["Contract kept: Gained 600 G · Silver Sword to
 * Edric"] (just the head when nothing was paid). Each result record is said by
 * `EventResultWords.describeResult`, the one phrasing the Event page uses too. What did not
 * arrive is said as well, so a band never reads "Contract kept" over a reward the army did not
 * get: a settlement still `owed` says its reward waits and why ("Contract kept: the reward
 * waits — No room for Steel Lance", or "could not be paid yet" when applying failed), and a
 * reward the player gave up says so.
 */
export function settlementLines(settlement) {
  if (!settlement) return [];
  const head = settlement.kept ? 'Contract kept' : 'Contract broken';
  if (settlement.forfeited) return [`${head}: you gave up the reward`];
  const parts = (settlement.results || [])
    .map((record) => describeResult(record)?.text)
    .filter(Boolean);
  if (settlement.owed) {
    // Earned and not delivered: the band says it waits, and why (never "kept" over nothing).
    const thing = settlement.kept ? 'reward' : 'penalty';
    if (settlement.blocked) parts.push(`the ${thing} waits — ${settlement.blocked}`);
    else
      parts.push(
        settlement.kept
          ? 'the reward could not be paid yet'
          : 'the penalty could not be applied yet',
      );
  }
  return [parts.length ? `${head}: ${parts.join(' · ')}` : head];
}
