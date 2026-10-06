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
// event effect planner: planned first, then applied; an item with no room becomes a note
// ({ kind: 'note' }) instead of failing, like the spoils of an event battle. A penalty may
// carry `burden` effects (Debt, Hunted): the burden effect is the same one an event uses. If
// settling throws, the run's fields are put back as they were before it and the contract is
// still cleared: a contract never sticks.
//
// The result is `run.lastContractSettlement` (not saved, like lastBurdenSettlement), for the
// victory band:
//   { nodeId, contractNodeId, eventId, goal, kept, noPar, losses, results: [records],
//     failed: string|null, lines: ['Contract kept: +600 G'] }
// `describeContract(run)` is the display model of the open contract (the route map's chip).
//
// Settlement runs in a seeded swap (`event-contract:${runSeed}:${nodeId}`), so an item's pick
// and uid are the same on a replay.
//
// Pure of Phaser and the DOM.

import { eventCatalogOf, resolveAmount } from './EventSystem.js';
import { burdenDefFor } from './Burdens.js';

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
    case 'item':
      if (effect.name) return effect.name;
      return Number(effect.pool?.tierOffset) >= 1 ? 'A finer weapon' : 'A weapon';
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

/** A result record as the band says it ("+600 G", "Silver Sword", "Debt (300 G owed)"). */
function resultPhrase(record) {
  switch (record?.kind) {
    case 'gold':
      return record.value === 0
        ? ''
        : record.value < 0
          ? `−${-record.value} G`
          : `+${record.value} G`;
    case 'item':
      return record.name || '';
    case 'burden':
      return record.detail ? `${record.label} (${record.detail})` : record.label || '';
    case 'shadow':
      return record.value === 0
        ? ''
        : `Shadow ${record.value > 0 ? '+' : '−'}${Math.abs(record.value)}`;
    case 'vision':
      return record.value === 0
        ? ''
        : `Vision ${record.value > 0 ? '+' : '−'}${Math.abs(record.value)}`;
    case 'hp':
      return record.total > 0
        ? `${record.mode === 'heal' ? 'Healed' : 'Wounded'} ${record.total}`
        : '';
    case 'blessing':
      return record.name || 'A blessing';
    case 'stat':
      return `${record.unit} ${record.value > 0 ? '+' : '−'}${Math.abs(record.value)} ${record.stat}`;
    default:
      return '';
  }
}

/** The victory band's words for a settlement: ["Contract kept: +600 G"] (empty for none). */
export function settlementLines(settlement) {
  if (!settlement) return [];
  const parts = (settlement.results || []).map(resultPhrase).filter(Boolean);
  const head = settlement.kept ? 'Contract kept' : 'Contract broken';
  return [parts.length ? `${head}: ${parts.join(', ')}` : head];
}
