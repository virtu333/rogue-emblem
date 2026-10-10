// ContractStanding.js — where the open contract stands in a battle that is still being fought
// (docs/specs/event-nodes-phase2.md §2E "Contract on the battle HUD").
//
// The battle HUD shows "Contract · Under par" and, once a victory right now would break it,
// "— missed". That judgement is never a rule of its own: it is the verdict the victory commit
// would reach, asked of the battle as it stands, through the very pieces the commit uses.
//
//   which battle settles   `RunManager.openBattleNode(nodeId)`: completeBattle applies a victory
//                          (and so settles a contract, a boss's included) only for a node that
//                          is on the map and not yet complete; a standalone prologue replay has
//                          no run, so no contract; a prologue run holds none. The arena's bouts
//                          are not battles and settle nothing.
//   the verdict            `Contracts.contractVerdict` on the turn and par the commit reads
//                          (the scene's turn number and `turnPar`, reinforcement bumps included)
//                          and the losses it counts.
//   the losses             `UnitIdentity.resolveBattleCasualties`, which completeBattle itself
//                          settles the fallen with: the roster as it entered, then the recruits
//                          who joined mid-battle and fell, against the survivors (deployed,
//                          escaped and benched units alike).
//
// So the standing is a pure function of the run and the live battle: nothing is stored, a
// suspend/resume or a Vision rewind (which restore the battle's units and turn) re-derive it, and a
// par that reinforcements raise un-misses a contract exactly as the settlement would keep it.
//
// Pure of Phaser and the DOM.

import { contractOf, contractVerdict } from './Contracts.js';
import { fallenBattleRecruits } from './BattleRecruits.js';
import { resolveBattleCasualties } from './UnitIdentity.js';

/** Whether a victory at `nodeId` would settle the run's open contract. */
export function contractSettlesBattle(run, nodeId) {
  if (!contractOf(run)) return false;
  return typeof run?.openBattleNode === 'function' && run.openBattleNode(nodeId) !== null;
}

/**
 * How many units a battle has lost so far: the number `completeBattle` hands the contract as
 * `losses` for a victory with these survivors.
 * @param {object} run
 * @param {{ survivors?: object[], battleRecruits?: object[] }} battle survivors: every unit
 *   still in the army (deployed, escaped, benched); battleRecruits: the battle's Talk records
 *   (`scene._battleRecruits`)
 */
export function battleLosses(run, { survivors = [], battleRecruits = [] } = {}) {
  // The roster as completeBattle sees it (its unit pools are sanitized first).
  const isValidUnit = (unit) => run._isValidSerializedUnit(unit);
  const roster = (Array.isArray(run?.roster) ? run.roster : []).filter(isValidUnit);
  const fallenRecruits = fallenBattleRecruits(battleRecruits, survivors, roster);
  return resolveBattleCasualties({ roster, survivors, fallenRecruits, isValidUnit }).newlyFallen
    .length;
}

/**
 * The open contract's standing for a battle in progress, or null when the battle settles no
 * contract (none open, a node that cannot be won, no run).
 *
 * `missed` is true when a victory right now would break the contract: `cause` says why
 * ('par': the turn is past par; 'losses': someone has fallen). `noPar`: the battle shows no
 * par, so an `underPar` contract cannot be judged and is kept (Contracts.contractVerdict).
 *
 * @param {object} run
 * @param {{ nodeId: string, turnCount: number, turnPar: number|null, survivors?: object[],
 *   battleRecruits?: object[] }} battle
 * @returns {{ goal: string, missed: boolean, cause: 'par'|'losses'|null, noPar: boolean,
 *   losses: number }|null}
 */
export function contractStanding(run, battle = {}) {
  if (!contractSettlesBattle(run, battle.nodeId)) return null;
  const contract = contractOf(run);
  const losses = battleLosses(run, battle);
  const { kept, noPar } = contractVerdict(contract, {
    turnCount: battle.turnCount,
    turnPar: battle.turnPar,
    losses,
  });
  return {
    goal: contract.goal,
    missed: !kept,
    cause: kept ? null : contract.goal === 'noLosses' ? 'losses' : 'par',
    noPar,
    losses,
  };
}
