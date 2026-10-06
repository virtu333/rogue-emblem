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
//   chooseEventOption(run, nodeId, choiceId, { targetUid, page }?)   (`page`: view.page, optional guard)
//                                              → { ok:true, text, results, outcomeId, battle,
//                                                  next: pageId | null, state }
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
//   'pending' | 'won', afterVictory: [effects], victoryText?, victoryResults: [], left?,
//   page?, path?, counters? }. The top-level choiceId... describe the choice made on the
//   CURRENT page. Pages (docs/specs/event-nodes-phase2.md §2A): `page` is the current page's id
//   (absent = the first page, `start`), `path` the steps behind it ([{ page, choiceId,
//   outcomeId, text, results, targetUid?, targetName? }], absent = none), `counters` the
//   event's counters now ({ torches: 2 }, absent = the event has none). A record written
//   before pages existed has none of the three and reads as a one-page event.
//
// View: { nodeId, eventId, title, intro, act, dark, phase: 'choosing' | 'outcome' | 'victory',
//   page: '<pageId>', trail: [{ page, choiceId, choiceLabel, outcomeId, text, results,
//   targetName }], counters: [{ key, label, value, max }],
//   choices: [{ id, label, hint, cost, block, target: null | { prompt, candidates },
//     tells: [{ speaker: { uid, name }, line }] }],
//   outcome: null | { choiceId, choiceLabel, outcomeId, text, results, targetName },
//   battle: null | 'pending' | 'won', canFight, victory: null | { text, results }, canLeave }.
//   `intro` is the CURRENT page's text (the event's intro on the first page); `choices` are the
//   current page's. `trail` lists the earlier steps in order (their outcome text and results
//   stay on screen above the page: a refresh shows the same trail). `counters` is empty for an
//   event with none; `max` is the starting value (for pips). `tells` are shown only while
//   choosing (the line is already spoken by `speaker`; there is never a number).
//
// Pages and `leaveEvent`: choosing on a page whose resolved outcome has `next` moves the event
//   to that page at once (the step goes to `trail`, the page's choices open, `phase` is
//   'choosing' again; chooseEventOption returns `next: '<pageId>'`). A page whose resolved
//   outcome has no `next` ends the event: the outcome page shows, then Continue =
//   leaveEvent. So "leave" is a choice whose outcomes carry no `next`; leaveEvent itself is
//   refused until the current page has a resolved choice. An outcome that starts a battle may
//   not carry `next` (the validator refuses it; the engine ignores it).
//
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
//    already made on this page, a requirement, the target, the gold cost or room for an item is
//    missing, or it can open a contract while one is open.
//  * Each step of a multi-page event commits and saves like a Phase 1 choice and has its own
//    seeds (EventSystem.choiceSeedKey): a refresh reopens the current page and never re-rolls
//    a step already taken, on any page.
//  * The event node keeps `type: 'event'` with an event battle (node.eventBattle = true), so
//    the route map, the Eclipse (the current node never falls) and encounter locking see
//    one node throughout.

import {
  applyPlan,
  cloneLedger,
  createLedger,
  planEffects,
  restoreRunState,
  snapshotRunState,
} from './EventEffects.js';
import {
  armyHasRoomForItem,
  choiceCost,
  choiceMayGrantItem,
  choiceMayOpenContract,
  counterLabel,
  eventCatalogOf,
  evaluateRequires,
  eventFace,
  fallenOfState,
  fillText,
  findChoice,
  findEvent,
  findRosterUnit,
  initialCounters,
  isDarkEvent,
  isEventNode,
  pageIdOf,
  pageOf,
  pathOf,
  pickEvent,
  pickFallenAlly,
  runSeedOf,
  selectOutcome,
  START_PAGE,
  targetCandidates,
  targetFilterBlock,
} from './EventSystem.js';
import { contractOf } from './Contracts.js';
import { choiceTells, tellTilt } from './EventTells.js';
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
  // A Dark Omen plays the event's dark face (EventSystem.eventFace): its intro, choices, pages.
  const event = eventFace(findEvent(catalog, state.eventId), state);
  if (!event) return { error: 'This event is no longer known.', node, catalog, state };
  const pageId = pageIdOf(state);
  const page = pageOf(event, pageId);
  if (!page) return { error: 'This part of the event is no longer known.', node, catalog, state };
  return { node, catalog, state, event, pageId, page };
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
    // A Dark Omen node (the Eclipse took it and left its story) draws among the dark faces.
    const darkNode = node.darkOmen === true;
    const event = pickEvent(run, node, catalog, { dark: darkNode });
    if (!event) return null;
    const state = {
      eventId: event.id,
      arrivedAct: run.currentAct,
      results: [],
      victoryResults: [],
      battle: null,
      afterVictory: [],
    };
    // Only when the event has the face to wear (the fallback may not): else it is played plain.
    if (darkNode && isDarkEvent(event)) state.dark = true;
    if (event.requires?.fallen === true) {
      const fallen = pickFallenAlly(run, nodeId);
      if (fallen) state.fallen = fallen;
    }
    const counters = initialCounters(event, run.difficultyId);
    if (Object.keys(counters).length) state.counters = counters;
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
  const { state, event, catalog, node, pageId } = ctx;
  if (state.choiceId) return 'You have already chosen.';
  const choice = findChoice(event, choiceId, pageId);
  if (!choice) return 'That is not a choice here.';
  const requireLine = evaluateRequires(run, choice.requires, { catalog, node, state });
  if (requireLine) return requireLine;
  if (choiceMayOpenContract(choice) && contractOf(run))
    return 'You are already bound by a contract.';
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
  const choice = findChoice(ctx.event, choiceId, ctx.pageId);
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
  const { state, event, node, catalog, pageId, page } = ctx;
  const chosen = findChoice(event, state.choiceId, pageId);
  const pending = state.battle === 'pending' && !node.completed;
  const settled = state.battle === 'won';
  const phase = !state.choiceId ? 'choosing' : settled ? 'victory' : 'outcome';
  const starts = initialCounters(event, run.difficultyId);
  return {
    nodeId,
    eventId: event.id,
    title: event.title,
    intro: fillText(page.text, state),
    act: state.arrivedAct || run.currentAct,
    // A Dark Omen: the event's dark face is in play (EventSystem.eventFace).
    dark: state.dark === true,
    phase,
    page: pageId,
    trail: pathOf(state).map((step) => ({
      page: step.page,
      choiceId: step.choiceId,
      choiceLabel: findChoice(event, step.choiceId, step.page)?.label || '',
      outcomeId: step.outcomeId,
      text: step.text || '',
      results: clone(step.results || []),
      targetName: step.targetName || null,
    })),
    counters: Object.keys(starts)
      .concat(Object.keys(state.counters || {}).filter((key) => !(key in starts)))
      .map((key) => ({
        key,
        label: counterLabel(event, key),
        value: Math.max(0, Math.trunc(Number(state.counters?.[key]) || 0)),
        max: starts[key] ?? Math.max(0, Math.trunc(Number(state.counters?.[key]) || 0)),
      })),
    choices: page.choices.map((choice) => ({
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
      tells:
        phase === 'choosing'
          ? choiceTells(run, nodeId, pageId, choice).map(({ speaker, line }) => ({ speaker, line }))
          : [],
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

/**
 * Commit a choice and apply its outcome. Selects the outcome from the seeded stream (a
 * check reads the target's stats now), PLANS every effect, and only then applies them.
 * @param {object} run - RunManager
 * @param {string} nodeId
 * @param {string} choiceId
 * @param {{ targetUid?: string|null, page?: string|null }} [options] - the chosen unit's uid (or
 *   name); `page`: the page the choice was shown on (view.page), refused when the event has moved on
 * @returns {{ ok: true, text: string, results: object[], outcomeId: string, battle: boolean,
 *   next: string|null, state: object } | { ok: false, reason: string }}
 *   `next` is the page the event moved to (null when the event stays on its outcome page)
 */
export function chooseEventOption(run, nodeId, choiceId, { targetUid = null, page = null } = {}) {
  const ctx = open(run, nodeId);
  if (ctx.error) return { ok: false, reason: ctx.error };
  // The page the player was looking at (view.page): a double tap on a choice that exists on the
  // next page too must not be taken twice.
  if (page !== null && page !== ctx.pageId) return { ok: false, reason: 'That page has moved on.' };
  const block = eventChoiceBlock(run, nodeId, choiceId, targetUid);
  if (block) return { ok: false, reason: block };
  const { node, state, event, catalog, pageId } = ctx;
  const choice = findChoice(event, choiceId, pageId);
  if (choice.target && !targetUid) return { ok: false, reason: 'Choose who.' };
  // The first page keeps its Phase 1 seeded-swap label; later pages name themselves.
  const label = pageId === START_PAGE ? `choose:${choiceId}` : `choose:${pageId}:${choiceId}`;
  return seeded(run, nodeId, label, () =>
    commit(run, { node, nodeId, state, event, choice, catalog, targetUid, pageId }),
  );
}

function commit(run, { node, nodeId, state, event, choice, catalog, targetUid, pageId }) {
  const target = choice.target ? findRosterUnit(run, targetUid) : null;
  const base = {
    run,
    catalog,
    nodeId,
    node,
    event,
    choice,
    state,
    page: pageId,
    target,
    fallenUnit: fallenOfState(run, state),
  };
  // A roster tell that tilts a check nudges it (once); the same tells the view showed.
  const tilt = choice.check ? tellTilt(choiceTells(run, nodeId, pageId, choice)) : 0;
  const { outcome } = selectOutcome(run, nodeId, choice, { target, pageId, tilt });

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
  const snapshot = snapshotRunState(run);
  const countersBefore = clone(state.counters);
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
    restoreRunState(run, snapshot);
    if (countersBefore === undefined) delete state.counters;
    else state.counters = countersBefore;
    return { ok: false, reason: `That did not work out (${error.message}). Nothing changed.` };
  }

  // Record.
  run.currentNodeId = nodeId;
  const filled = fillText(text, state);
  const step = { page: pageId, choiceId: choice.id, outcomeId: outcome.id, text: filled, results };
  if (target) {
    step.targetUid = unitUidOf(target) || target.name;
    step.targetName = target.name;
  }
  // A step whose outcome has `next` opens that page; a battle (or no `next`) ends the page.
  const next =
    !battleStep && typeof outcome.next === 'string' && pageOf(event, outcome.next)
      ? outcome.next
      : null;
  if (next) {
    for (const key of ['choiceId', 'outcomeId', 'targetUid', 'targetName', 'text'])
      delete state[key];
    Object.assign(state, {
      page: next,
      path: [...pathOf(state), step],
      results: [],
      battle: null,
      afterVictory: [],
      victoryText: '',
      victoryResults: [],
    });
  } else {
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
      state.targetUid = step.targetUid;
      state.targetName = step.targetName;
    }
  }
  if (!Array.isArray(run.eventLog)) run.eventLog = [];
  run.eventLog.push({
    eventId: event.id,
    choiceId: choice.id,
    outcomeId: outcome.id,
    act: run.currentAct,
    ...(pageId === START_PAGE ? {} : { page: pageId }),
  });
  return {
    ok: true,
    text: filled,
    results: clone(results),
    outcomeId: outcome.id,
    battle: Boolean(battleStep),
    next,
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
    const choice = findChoice(event, state.choiceId, pageIdOf(state));
    const base = {
      run,
      catalog,
      nodeId,
      node,
      event,
      choice,
      state,
      page: pageIdOf(state),
      target: state.targetUid ? findRosterUnit(run, state.targetUid) : null,
      fallenUnit: fallenOfState(run, state),
      phase: 'a',
    };
    const plan = planEffects(base, state.afterVictory, { lenient: true });
    if (!plan.ok) return { ok: false, reason: plan.reason };
    const snapshot = snapshotRunState(run);
    let results;
    try {
      results = applyPlan(base, plan.steps);
    } catch (error) {
      restoreRunState(run, snapshot);
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
