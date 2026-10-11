// PacingMetrics.js — what an encounter measures in a harness battle
// (docs/specs/large-maps/02-encounters-and-pacing.md §7). sim/pacing.js attaches one to every
// battle it plays; nothing in the game reads it.
//
// Per battle:
//   contactTurn     the first enemy-phase check (turn T) at which the battle is in contact: a
//                   group woke by `danger` or `hurt` (a hold pack, or the sim's rout-hold
//                   prototype woken by threat or a blow), a hostile exchange has happened (any
//                   combat or area strike between the player's side and an enemy) by then, or
//                   a player unit stands on the Danger tiles of an awake enemy the player sees.
//                   The clock-only wakes (`turn`, boss enrage) never set it. Null if never.
//   firstAttack     for each enemy on the map at the start, the turn it first decided to strike
//                   (an attack decision, AIController's `target`), or null: the engagement curve.
//   engagedShare    the share of starting enemies with a first attack by the battle's end.
//   wakes           groups woken, with their reason (`threat`, `hurt`, `status`, `moved`,
//                   `fallen`, `turn`, `enrage`; `proto` for the rout-hold prototype).
//   noReachableMove / recoveryFallback  AI decisions of those kinds (stuck enemies).
//   aiMs            per enemy phase, the time the AI spent deciding (the encounter check and
//                   every enemy's decision; the harness's own resolution of moves and combat
//                   excluded), for the p95 budget.

import { enemyThreatTiles, isThreatSourceVisible } from '../../src/engine/ThreatForecast.js';
import { groupIdOf } from '../../src/engine/EncounterGroups.js';

const CONTACT_WAKES = new Set(['threat', 'hurt', 'status', 'moved', 'fallen', 'proto']);
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());

/** Attach the metrics to a HeadlessBattle (wraps its methods; the battle plays the same). */
export function attachPacingMetrics(battle) {
  const record = {
    contactTurn: null,
    hostileExchangeTurn: null,
    firstAttack: new Map(),
    startEnemies: [...battle.enemyUnits],
    wakes: [],
    noReachableMove: 0,
    recoveryFallback: 0,
    aiMs: [],
  };
  for (const e of record.startEnemies) record.firstAttack.set(e, null);
  const turnOf = () => battle.turnManager?.turnNumber || 1;
  const noteExchange = (a, b) => {
    const sides = new Set([a?.faction, b?.faction]);
    if (!sides.has('enemy') || sides.size < 2) return;
    record.hostileExchangeTurn ??= turnOf();
  };

  const playerCombat = battle._executeCombat.bind(battle);
  battle._executeCombat = (attacker, defender) => {
    noteExchange(attacker, defender);
    return playerCombat(attacker, defender);
  };
  const enemyCombat = battle._executeEnemyCombat.bind(battle);
  battle._executeEnemyCombat = (attacker, defender) => {
    noteExchange(attacker, defender);
    return enemyCombat(attacker, defender);
  };
  if (typeof battle.executeAreaStrike === 'function') {
    const area = battle.executeAreaStrike.bind(battle);
    battle.executeAreaStrike = (unit, artId, center) => {
      record.hostileExchangeTurn ??= turnOf();
      return area(unit, artId, center);
    };
  }

  const decisions = battle._recordEnemyAiDecision.bind(battle);
  battle._recordEnemyAiDecision = (enemy, decision) => {
    if (decision?.target && record.firstAttack.has(enemy) && record.firstAttack.get(enemy) === null)
      record.firstAttack.set(enemy, turnOf());
    if (decision?.reason === 'no_reachable_move') record.noReachableMove++;
    if (decision?.reason === 'chase_recovery_fallback') record.recoveryFallback++;
    return decisions(enemy, decision);
  };

  // AI time: the encounter check (from the phase's call to its first decision) plus every
  // decision of the phase.
  const ai = battle.aiController;
  let phaseMs = 0;
  let checkStart = null;
  const endCheck = () => {
    if (checkStart === null) return;
    phaseMs += now() - checkStart;
    checkStart = null;
  };
  const timed = (fn) => {
    const bound = fn.bind(ai);
    return (...args) => {
      endCheck();
      const t = now();
      try {
        return bound(...args);
      } finally {
        phaseMs += now() - t;
      }
    };
  };
  ai._decideAction = timed(ai._decideAction);
  if (typeof ai._decideEntityAction === 'function')
    ai._decideEntityAction = timed(ai._decideEntityAction);
  const process = ai.processEnemyPhase.bind(ai);
  ai.processEnemyPhase = async (enemyUnits, playerUnits, npcUnits, callbacks) => {
    checkStart = now();
    const wrapped = {
      ...callbacks,
      onDecision: (...args) => {
        endCheck(); // a sleeping unit decides without _decideAction
        return callbacks.onDecision?.(...args);
      },
    };
    try {
      return await process(enemyUnits, playerUnits, npcUnits, wrapped);
    } finally {
      endCheck();
    }
  };

  const phase = battle._processEnemyPhase.bind(battle);
  battle._processEnemyPhase = async () => {
    const turn = turnOf();
    const holding = new Map(
      battle.enemyUnits.map((u) => [u, u.aiMode === 'hold' || u._hold === true]),
    );
    const dangerContact = record.contactTurn === null && standsInAwakeDanger(battle);
    phaseMs = 0;
    try {
      return await phase();
    } finally {
      record.aiMs.push(phaseMs);
      // The groups this phase's check woke (one entry per group).
      const seen = new Set();
      for (const [unit, held] of holding) {
        if (!held || unit.aiMode === 'hold' || unit._hold === true) continue;
        const reason = unit.holdWoke || 'proto';
        const id = groupIdOf(unit) ?? `proto:${unit.name}:${unit.col},${unit.row}`;
        if (seen.has(id)) continue;
        seen.add(id);
        record.wakes.push({ turn, reason });
      }
      if (record.contactTurn === null) {
        const woke = record.wakes.some((w) => w.turn === turn && CONTACT_WAKES.has(w.reason));
        const exchanged = record.hostileExchangeTurn !== null && record.hostileExchangeTurn <= turn;
        if (woke || exchanged || dangerContact) record.contactTurn = turn;
      }
    }
  };
  return record;
}

/** A player unit on the Danger tiles of an awake enemy the player sees (contact rule 3). */
function standsInAwakeDanger(battle) {
  const ctx = battle._playerThreatContext?.();
  if (!ctx) return false;
  const positions = ctx.positions();
  const targets = battle.playerUnits.filter((u) => u.currentHP > 0);
  for (const enemy of battle.enemyUnits) {
    if (enemy.currentHP <= 0 || enemy.aiMode === 'hold' || enemy._hold === true) continue;
    if (!isThreatSourceVisible(ctx.grid, enemy)) continue;
    const { damage } = enemyThreatTiles(ctx, enemy, positions);
    if (targets.some((t) => damage.has(`${t.col},${t.row}`))) return true;
  }
  return false;
}

/** The plain-data summary of a record (for the sim's battle record and `--out`). */
export function summarizePacingMetrics(record) {
  const attacks = [...record.firstAttack.values()];
  const engaged = attacks.filter((t) => t !== null);
  const reasons = {};
  for (const w of record.wakes) reasons[w.reason] = (reasons[w.reason] || 0) + 1;
  return {
    contactTurn: record.contactTurn,
    firstAttackTurns: engaged,
    startEnemies: attacks.length,
    engagedShare: attacks.length ? engaged.length / attacks.length : 0,
    groupsWoken: record.wakes.length,
    wakeReasons: reasons,
    noReachableMove: record.noReachableMove,
    recoveryFallback: record.recoveryFallback,
    aiMs: record.aiMs.map((ms) => Math.round(ms * 100) / 100),
  };
}
