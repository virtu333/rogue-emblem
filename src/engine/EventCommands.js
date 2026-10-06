// EventCommands.js — the command API of the story Events on the route map
// (docs/specs/event-nodes.md §4). The route-map scene (src/ui/EventMenu.js through an
// EventController) and the sims call ONLY these; they hold no event logic of their own.
// Pure: no Phaser, no DOM. Follows RuinsCommands / ChurchVow: state lives on the run
// (RunManager.eventStateByNodeId, eventLog, storyFlags, burdens, pendingEventNodeId, saved
// with it) and every command is idempotent or refuses.
//
// ── The flow ─────────────────────────────────────────────────────────────
//   1. Click an event node:  arriveAtEvent(run, nodeId)  → state (picks + records the event
//      the first time; later calls return the same state). The node becomes the current
//      node, so it is the only available node until it is left. SAVE the run.
//   2. Show eventView(run, nodeId): title, intro, choices (label, hint, cost, block reason,
//      target candidates). A choice with `block !== ''` is greyed with that reason.
//   3. Choose:  chooseEventOption(run, nodeId, choiceId, { targetUid })  → the outcome text
//      and result records. SAVE the run immediately. A refresh after this reopens the OUTCOME
//      page (eventView().phase === 'outcome'), never the choices; nothing re-rolls.
//   4a. No battle:  leaveEvent(run, nodeId) (Continue)  → the node is complete; SAVE and
//       checkActComplete().
//   4b. A battle (result.battle === true / pendingEventBattle() !== null): show the outcome
//       text with only a Fight button; Fight launches the normal handleBattle(node) path.
//       Victory runs RunManager.completeBattle (the node completes, gold uses the event
//       multiplier, run.pendingEventNodeId is set). Back on the route map call
//       completeEventBattle(run, nodeId) once: it applies the after-victory effects
//       (once, even across a reload), returns the victory text and results to show, and
//       clears the marker. Then leaveEvent (Continue; the node is already complete).
//       A revert / Continue from Map reopens the outcome page with only Fight.
//
// ── Commands (signatures and returns) ────────────────────────────────────
//   eventState(run, nodeId)                    → State | null (a deep copy of the saved record)
//   arriveAtEvent(run, nodeId, catalog?)       → State | null (null: not an event node, a
//                                                prologue run, or no events data)
//   eventView(run, nodeId)                     → View | null (the display model, below)
//   eventChoiceBlock(run, nodeId, choiceId, targetUid?)  → '' | reason line
//   eventTargets(run, nodeId, choiceId)        → [{ uid, name, unit, ok, reason }] for the picker
//   chooseEventOption(run, nodeId, choiceId, { targetUid }?)
//                                              → { ok:true, text, results, outcomeId, battle, state }
//                                                | { ok:false, reason }
//   pendingEventBattle(run, nodeId)            → { nodeId, eventId, choiceId, outcomeId, text,
//                                                results } | null  (a fight is owed, not yet won)
//   completeEventBattle(run, nodeId)           → { ok:true, text, results }
//                                                | { ok:false, reason, already? }
//   leaveEvent(run, nodeId)                    → { ok:true, nodeId } | { ok:false, reason }
//   getPendingEventSettlement(run)             → nodeId | null  (a won event battle whose
//                                                spoils are not yet applied)
//
// State (run.eventStateByNodeId[nodeId]): { eventId, arrivedAct, fallen?: { unitUid, name },
//   choiceId?, outcomeId?, targetUid?, targetName?, text?, results: [], battle: null |
//   'pending' | 'won', afterVictory: [effects], victoryText?, victoryResults: [], left? }.
// View: { nodeId, eventId, title, intro, act, phase: 'choosing' | 'outcome' | 'victory',
//   choices: [{ id, label, hint, cost, block, target: null | { prompt, candidates } }],
//   outcome: null | { choiceId, choiceLabel, outcomeId, text, results, targetName },
//   battle: null | 'pending' | 'won', canFight, victory: null | { text, results }, canLeave }.
// Result records ({ kind, ... }) are listed in EventEffects.js.
//
// ── Rules ────────────────────────────────────────────────────────────────
//  * Determinism: the pick, the outcome and every sub-pick are seeded from the run seed
//    (EventSystem.js header); Math.random is never read, and the whole of a command runs
//    inside a seeded swap, so even stray draws deeper in the engine (item uids, the
//    battle's map roll) neither consume nor shift the run's own stream.
//  * Plan, then apply: every effect is validated before any is applied; a failed plan
//    returns { ok:false } with the run untouched, and an exception while applying rolls
//    the run back.
//  * A choice is refused (never silently) when: the event is not at this node, a choice was
//    already made, a requirement, the target, the gold cost or room for an item is missing.
//  * The event node keeps `type: 'event'` with an event battle (node.eventBattle = true), so
//    the route map, the Eclipse (the current node never falls) and encounter locking see
//    one node throughout.

import { applyPlan, cloneLedger, createLedger, planEffects } from './EventEffects.js';
import {
  armyHasRoomForItem,
  choiceCost,
  choiceMayGrantItem,
  eventCatalogOf,
  evaluateRequires,
  fallenOfState,
  fillText,
  findChoice,
  findEvent,
  findRosterUnit,
  isEventNode,
  pickEvent,
  pickFallenAlly,
  runSeedOf,
  selectOutcome,
  targetCandidates,
  targetFilterBlock,
} from './EventSystem.js';
import { withEclipseSeed } from './EclipseSystem.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { unitUidOf } from './UnitIdentity.js';

const NO_ROOM = 'Nowhere to carry anything more. Make room in the convoy.';

const clone = (value) => (value === undefined ? value : structuredClone(value));

function findNode(run, nodeId) {
  if (typeof nodeId !== 'string' || !nodeId) return null;
  return run?.nodeMap?.nodes?.find((node) => node?.id === nodeId) || null;
}

function stateOf(run, nodeId) {
  const state = run?.eventStateByNodeId?.[nodeId];
  return state && typeof state === 'object' ? state : null;
}

/** Everything a command needs about one node's event, or an error line. */
function open(run, nodeId, catalogArg = null) {
  if (isPrologueRun(run)) return { error: 'There are no events in the prologue.' };
  const node = findNode(run, nodeId);
  if (!isEventNode(node)) return { error: 'There is no event here.' };
  const catalog = eventCatalogOf(run, catalogArg);
  if (!catalog) return { error: 'No events are known.' };
  const state = stateOf(run, nodeId);
  if (!state) return { error: 'Arrive at the event first.', node, catalog };
  const event = findEvent(catalog, state.eventId);
  if (!event) return { error: 'This event is no longer known.', node, catalog, state };
  return { node, catalog, state, event };
}

function seeded(run, nodeId, label, fn) {
  return withEclipseSeed(`event-rng:${runSeedOf(run)}:${nodeId}:${label}`, fn);
}

// ── State and arrival ───────────────────────────────────────────────────

/** A copy of the event state recorded at a node, or null. */
export function eventState(run, nodeId) {
  const state = stateOf(run, nodeId);
  return state ? clone(state) : null;
}

/**
 * Arrive at an event node: pick the event from those eligible NOW (seeded; see
 * EventSystem.pickEvent), record it, make the node current. Idempotent: a node with a
 * recorded event returns it unchanged. The caller saves the run.
 * @returns {object|null} the event state
 */
export function arriveAtEvent(run, nodeId, catalogArg = null) {
  if (isPrologueRun(run)) return null;
  const node = findNode(run, nodeId);
  if (!isEventNode(node)) return null;
  const catalog = eventCatalogOf(run, catalogArg);
  if (!catalog) return null;
  if (!run.eventStateByNodeId || typeof run.eventStateByNodeId !== 'object')
    run.eventStateByNodeId = {};
  if (!stateOf(run, nodeId)) {
    const event = pickEvent(run, node, catalog);
    if (!event) return null;
    const state = {
      eventId: event.id,
      arrivedAct: run.currentAct,
      results: [],
      victoryResults: [],
      battle: null,
      afterVictory: [],
    };
    if (event.requires?.fallen === true) {
      const fallen = pickFallenAlly(run, nodeId);
      if (fallen) state.fallen = fallen;
    }
    run.eventStateByNodeId[nodeId] = state;
  }
  if (!node.completed) run.currentNodeId = nodeId;
  return clone(stateOf(run, nodeId));
}

// ── Reasons ─────────────────────────────────────────────────────────────

/**
 * Why a choice cannot be made now ('' when it can). With no `targetUid` a choice that
 * needs a target is '' when at least one unit qualifies (the picker opens); with one, that
 * unit must qualify. Order: already chosen, requires, anyone to target, gold, room.
 */
export function eventChoiceBlock(run, nodeId, choiceId, targetUid = null) {
  const ctx = open(run, nodeId);
  if (ctx.error) return ctx.error;
  const { state, event, catalog, node } = ctx;
  if (state.choiceId) return 'You have already chosen.';
  const choice = findChoice(event, choiceId);
  if (!choice) return 'That is not a choice here.';
  const requireLine = evaluateRequires(run, choice.requires, { catalog, node });
  if (requireLine) return requireLine;
  const fallen = fallenOfState(run, state);
  if (choice.target) {
    const filter = choice.target.filter || {};
    const candidates = targetCandidates(run, filter, { fallen });
    if (!candidates.some((c) => c.ok)) return choice.target.reason || 'No one here can.';
    if (targetUid) {
      const unit = findRosterUnit(run, targetUid);
      if (!unit) return 'Choose someone in the army.';
      const line = targetFilterBlock(run, unit, filter, { fallen });
      if (line) return line;
    }
  }
  const cost = choiceCost(run, choice, catalog);
  if (cost > 0 && !(Number(run.gold) >= cost)) return 'Not enough gold.';
  if (choiceMayGrantItem(choice) && !armyHasRoomForItem(run)) return NO_ROOM;
  return '';
}

/** The target picker rows of a choice: [{ uid, name, unit, ok, reason }] (empty without a target). */
export function eventTargets(run, nodeId, choiceId) {
  const ctx = open(run, nodeId);
  if (ctx.error) return [];
  const choice = findChoice(ctx.event, choiceId);
  if (!choice?.target) return [];
  return targetCandidates(run, choice.target.filter || {}, {
    fallen: fallenOfState(run, ctx.state),
  });
}

// ── The display model ───────────────────────────────────────────────────

/** Everything the event menu draws, from the saved state (see the header). */
export function eventView(run, nodeId) {
  const ctx = open(run, nodeId);
  if (ctx.error || !ctx.event) return null;
  const { state, event, node, catalog } = ctx;
  const chosen = findChoice(event, state.choiceId);
  const pending = state.battle === 'pending' && !node.completed;
  const settled = state.battle === 'won';
  const phase = !state.choiceId ? 'choosing' : settled ? 'victory' : 'outcome';
  return {
    nodeId,
    eventId: event.id,
    title: event.title,
    intro: fillText(event.intro, state),
    act: state.arrivedAct || run.currentAct,
    phase,
    choices: (event.choices || []).map((choice) => ({
      id: choice.id,
      label: choice.label,
      hint: choice.hint || '',
      cost: choiceCost(run, choice, catalog),
      block: eventChoiceBlock(run, nodeId, choice.id),
      target: choice.target
        ? {
            prompt: choice.target.prompt || 'Who?',
            candidates: targetCandidates(run, choice.target.filter || {}, {
              fallen: fallenOfState(run, state),
            }).map(({ uid, name, ok, reason }) => ({ uid, name, ok, reason })),
          }
        : null,
    })),
    outcome: state.choiceId
      ? {
          choiceId: state.choiceId,
          choiceLabel: chosen?.label || '',
          outcomeId: state.outcomeId,
          text: state.text || '',
          results: clone(state.results || []),
          targetName: state.targetName || null,
        }
      : null,
    battle: state.battle || null,
    canFight: pending,
    victory: settled
      ? { text: state.victoryText || '', results: clone(state.victoryResults || []) }
      : null,
    canLeave: Boolean(state.choiceId) && state.battle !== 'pending' && !state.left,
  };
}

// ── Choosing ────────────────────────────────────────────────────────────

const RUN_FIELDS = [
  'roster',
  'fallenUnits',
  'laidToRest',
  'convoy',
  'gold',
  'eclipse',
  'visionChargesRemaining',
  'activeBlessings',
  'blessingHistory',
  'blessingRuntimeModifiers',
  'storyFlags',
  'burdens',
  'accessories',
  'nodeMap',
  'currentNodeId',
];

function snapshotRun(run) {
  return structuredClone(Object.fromEntries(RUN_FIELDS.map((key) => [key, run[key]])));
}

function restoreRun(run, snapshot) {
  for (const key of RUN_FIELDS) run[key] = snapshot[key];
}

/**
 * Commit a choice and apply its outcome. Selects the outcome from the seeded stream (a
 * check reads the target's stats now), PLANS every effect, and only then applies them.
 * @param {object} run - RunManager
 * @param {string} nodeId
 * @param {string} choiceId
 * @param {{ targetUid?: string|null }} [options] - the chosen unit's uid (or name)
 * @returns {{ ok: true, text: string, results: object[], outcomeId: string, battle: boolean,
 *   state: object } | { ok: false, reason: string }}
 */
export function chooseEventOption(run, nodeId, choiceId, { targetUid = null } = {}) {
  const ctx = open(run, nodeId);
  if (ctx.error) return { ok: false, reason: ctx.error };
  const block = eventChoiceBlock(run, nodeId, choiceId, targetUid);
  if (block) return { ok: false, reason: block };
  const { node, state, event, catalog } = ctx;
  const choice = findChoice(event, choiceId);
  if (choice.target && !targetUid) return { ok: false, reason: 'Choose who.' };
  return seeded(run, nodeId, `choose:${choiceId}`, () =>
    commit(run, { node, nodeId, state, event, choice, catalog, targetUid }),
  );
}

function commit(run, { node, nodeId, state, event, choice, catalog, targetUid }) {
  const target = choice.target ? findRosterUnit(run, targetUid) : null;
  const base = {
    run,
    catalog,
    nodeId,
    node,
    event,
    choice,
    state,
    target,
    fallenUnit: fallenOfState(run, state),
  };
  const { outcome } = selectOutcome(run, nodeId, choice, { target });

  // PLAN: the gold cost, the choice's own effects, then the outcome's (or its fallback).
  const ledger = createLedger(run);
  const cost = choiceCost(run, choice, catalog);
  ledger.gold -= cost;
  const planChoice = planEffects({ ...base, phase: 'c' }, choice.effects, { ledger });
  if (!planChoice.ok) return { ok: false, reason: planChoice.reason };
  const afterChoice = cloneLedger(ledger);
  let planOutcome = planEffects({ ...base, phase: 'o' }, outcome.effects, { ledger });
  let text = outcome.text;
  if (!planOutcome.ok && planOutcome.empty && Array.isArray(outcome.fallback)) {
    planOutcome = planEffects({ ...base, phase: 'o' }, outcome.fallback, {
      ledger: cloneLedger(afterChoice),
    });
    text = outcome.fallbackText || outcome.text;
  }
  if (!planOutcome.ok) return { ok: false, reason: planOutcome.reason };
  const battleStep = planOutcome.steps.find((step) => step.type === 'battle') || null;
  if (battleStep) {
    // The spoils are planned again after the fight; check now that they make sense.
    const spoils = planEffects({ ...base, phase: 'a' }, battleStep.afterVictory, { lenient: true });
    if (!spoils.ok) return { ok: false, reason: spoils.reason };
  }

  // APPLY (rolled back whole if anything throws).
  const snapshot = snapshotRun(run);
  let results;
  try {
    results = [];
    if (cost > 0) {
      run.addGold(-cost);
      results.push({ kind: 'gold', value: -cost, requested: -cost, cost: true });
    }
    results.push(...applyPlan({ ...base, phase: 'c' }, planChoice.steps));
    results.push(...applyPlan({ ...base, phase: 'o' }, planOutcome.steps));
  } catch (error) {
    restoreRun(run, snapshot);
    return { ok: false, reason: `That did not work out (${error.message}). Nothing changed.` };
  }

  // Record.
  run.currentNodeId = nodeId;
  const filled = fillText(text, state);
  Object.assign(state, {
    choiceId: choice.id,
    outcomeId: outcome.id,
    text: filled,
    results,
    battle: battleStep ? 'pending' : null,
    afterVictory: battleStep ? clone(battleStep.afterVictory) : [],
    victoryText: battleStep ? fillText(battleStep.victoryText, state) : '',
    victoryResults: [],
  });
  if (target) {
    state.targetUid = unitUidOf(target) || target.name;
    state.targetName = target.name;
  }
  if (!Array.isArray(run.eventLog)) run.eventLog = [];
  run.eventLog.push({
    eventId: event.id,
    choiceId: choice.id,
    outcomeId: outcome.id,
    act: run.currentAct,
  });
  return {
    ok: true,
    text: filled,
    results: clone(results),
    outcomeId: outcome.id,
    battle: Boolean(battleStep),
    state: clone(state),
  };
}

// ── Battles from an event ───────────────────────────────────────────────

/**
 * The fight an outcome started that is not won yet (null otherwise): the event menu shows
 * the outcome text with only Fight. Survives a refresh and a revert.
 */
export function pendingEventBattle(run, nodeId) {
  const ctx = open(run, nodeId);
  if (ctx.error || !ctx.event) return null;
  const { state, node } = ctx;
  if (state.battle !== 'pending' || node.completed || !node.eventBattle) return null;
  return {
    nodeId,
    eventId: state.eventId,
    choiceId: state.choiceId,
    outcomeId: state.outcomeId,
    text: state.text || '',
    results: clone(state.results || []),
  };
}

/** The node id of a won event battle whose spoils are not yet applied (or null). */
export function getPendingEventSettlement(run) {
  const nodeId = typeof run?.pendingEventNodeId === 'string' ? run.pendingEventNodeId : null;
  if (!nodeId) return null;
  const state = stateOf(run, nodeId);
  return state?.battle === 'pending' && findNode(run, nodeId)?.completed ? nodeId : null;
}

/**
 * Apply the after-victory effects of a won event battle, exactly once (guarded by
 * `battle: 'won'`, so a second call, or one after a reload, changes nothing). Lenient: an
 * item with no room is skipped with a note rather than lost to a failed plan.
 * @returns {{ ok: true, text: string, results: object[] } | { ok: false, reason: string, already?: boolean }}
 */
export function completeEventBattle(run, nodeId) {
  const ctx = open(run, nodeId);
  if (ctx.error) return { ok: false, reason: ctx.error };
  const { state, node, event, catalog } = ctx;
  if (state.battle === 'won')
    return { ok: false, reason: 'The spoils are already settled.', already: true };
  if (state.battle !== 'pending') return { ok: false, reason: 'No battle was started here.' };
  if (!node.completed) return { ok: false, reason: 'The fight is not won yet.' };
  return seeded(run, nodeId, 'victory', () => {
    const choice = findChoice(event, state.choiceId);
    const base = {
      run,
      catalog,
      nodeId,
      node,
      event,
      choice,
      state,
      target: state.targetUid ? findRosterUnit(run, state.targetUid) : null,
      fallenUnit: fallenOfState(run, state),
      phase: 'a',
    };
    const plan = planEffects(base, state.afterVictory, { lenient: true });
    if (!plan.ok) return { ok: false, reason: plan.reason };
    const snapshot = snapshotRun(run);
    let results;
    try {
      results = applyPlan(base, plan.steps);
    } catch (error) {
      restoreRun(run, snapshot);
      return { ok: false, reason: `The spoils could not be taken (${error.message}).` };
    }
    state.battle = 'won';
    state.victoryResults = results;
    if (run.pendingEventNodeId === nodeId) run.pendingEventNodeId = null;
    return { ok: true, text: state.victoryText || '', results: clone(results) };
  });
}

// ── Leaving ─────────────────────────────────────────────────────────────

/**
 * Continue: leave the event once its choice is resolved (and any fight won and settled).
 * Marks the node complete (the scene then saves and checks the act). Idempotent.
 * @returns {{ ok: true, nodeId: string } | { ok: false, reason: string }}
 */
export function leaveEvent(run, nodeId) {
  const ctx = open(run, nodeId);
  if (ctx.error) return { ok: false, reason: ctx.error };
  const { state, node } = ctx;
  if (!state.choiceId) return { ok: false, reason: 'Make a choice first.' };
  if (state.battle === 'pending')
    return {
      ok: false,
      reason: node.completed ? 'Settle the battle first.' : 'The fight is not over.',
    };
  if (!node.completed) run.markNodeComplete(nodeId);
  state.left = true;
  if (run.pendingEventNodeId === nodeId) run.pendingEventNodeId = null;
  return { ok: true, nodeId };
}
