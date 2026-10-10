// Shared builders for the story-event tests (docs/specs/event-nodes.md). Real runs, real
// data, seeded units: nothing here calls the engine under test except the arrival that
// every test needs.
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import {
  eventCatalogOf,
  findEvent,
  initialCounters,
  pickFallenAlly,
} from '../src/engine/EventSystem.js';
import { arriveAtEvent } from '../src/engine/EventCommands.js';
import { loadGameData } from './testData.js';

export const baseData = loadGameData();

/** A fresh standard run (a shallow copy of the game data, so a test may swap `events`). */
export function newRun({ seed = 101, difficulty = 'normal', gold = null, data = baseData } = {}) {
  const run = new RunManager({ ...data });
  run.startRun({ runSeed: seed, difficultyId: difficulty, applyBlessingsAtStart: false });
  if (gold !== null) run.gold = gold;
  return run;
}

/** Add a recruit of a class (seeded, so Math.random is never touched) to the roster. */
export function addUnit(run, className, { level = 1, name = null } = {}) {
  const classData = run.gameData.classes.find((c) => c.name === className);
  const unit = createUnit(classData, level, run.gameData.weapons, {
    name: name || className,
    rng: createSeededRng(className.length * 7919 + level),
  });
  unit.level = level;
  run.assignUnitUid(unit);
  run.roster.push(unit);
  return unit;
}

/** Move a roster unit to the fallen, the way a lost battle does. */
export function fallAlly(run, unit) {
  const index = run.roster.indexOf(unit);
  if (index < 0) throw new Error('not in the roster');
  run.roster.splice(index, 1);
  unit.currentHP = 0;
  unit.fellAt = { act: run.currentAct, battle: 1 };
  run.fallenUnits.push(unit);
  return unit;
}

/** The run's event node, or a battle node of row 3 turned into one (no battle params). */
export function eventNode(run) {
  const existing = run.nodeMap.nodes.find((n) => n.type === 'event' && !n.completed);
  if (existing) return existing;
  return makeEvent(
    run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.row >= 2),
  );
}

/** Turn any uncompleted node into an event node (no battle params). */
export function makeEvent(node) {
  node.type = 'event';
  node.battleParams = null;
  delete node.fogEnabled;
  delete node.templateId;
  return node;
}

/** Arrive at an event node and make it hold `eventId` (the pick is tested elsewhere). */
export function arriveAs(run, eventId, node = eventNode(run)) {
  if (node.type !== 'event') makeEvent(node);
  arriveAtEvent(run, node.id);
  const state = {
    eventId,
    arrivedAct: run.currentAct,
    results: [],
    victoryResults: [],
    battle: null,
    afterVictory: [],
  };
  if (eventId === 'the_echo') {
    const fallen = pickFallenAlly(run, node.id);
    if (fallen) state.fallen = fallen;
  }
  // An event with counters starts with them, as arriveAtEvent does.
  const counters = initialCounters(findEvent(eventCatalogOf(run), eventId), run.difficultyId);
  if (Object.keys(counters).length) state.counters = counters;
  run.eventStateByNodeId[node.id] = state;
  return node;
}

/** A run whose catalog is replaced by one made of the given events (a plain fixture). */
export function runWithEvents(events, options = {}) {
  const run = newRun(options);
  run.gameData = {
    ...run.gameData,
    events: {
      ...structuredClone(baseData.events),
      events: [...events, ...structuredClone(baseData.events.events.filter((e) => e.fallback))],
    },
  };
  return run;
}

/** A one-choice event around the given effects (for testing one effect on its own). */
export function soloEvent(effects, { id = 'solo', choice = {}, outcome = {}, requires } = {}) {
  return {
    id,
    title: 'Solo',
    weight: 1,
    ...(requires ? { requires } : {}),
    intro: 'A test.',
    choices: [
      {
        id: 'go',
        label: 'Go',
        ...choice,
        outcomes: [{ id: 'only', weight: 100, text: 'Done.', effects, ...outcome }],
      },
    ],
  };
}

/** Turn event outcomes into a plain list of kinds for assertions. */
export const kinds = (results) => results.map((r) => r.kind);

/** HP of every roster unit by name. */
export const hpByName = (run) => Object.fromEntries(run.roster.map((u) => [u.name, u.currentHP]));
