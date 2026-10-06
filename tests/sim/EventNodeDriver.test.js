// The run-simulation driver and the story events (docs/specs/event-nodes.md §11).
//
// Ways this goes wrong:
//   - the sims walk past events (a stalled or skipped node) instead of resolving them through
//     the same commands the route map uses;
//   - the default policy takes a fight it was not asked to, or `fight` never does;
//   - an event battle leaves the node open, or the spoils unapplied, or is not fought through
//     the ordinary battle path;
//   - NODE_PRIORITY forgets the event (it would be the last node ever taken).
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';
import { chooseEventPlan, chooseNode } from './RunPolicies.js';
import { arriveAtEvent, eventState } from '../../src/engine/EventCommands.js';
import { arriveAs, makeEvent } from '../eventKit.js';

function driverFor(seed, options = {}) {
  const driver = new RunSimulationDriver(loadGameData(), {
    runOptions: { runSeed: seed, difficultyId: 'normal', autoSelectBlessing: false },
    invincibility: true,
    maxBattleActions: 0, // every battle is force-won at once: fast, and still through completeBattle
    ...options,
  });
  driver.init();
  return driver;
}

describe('event nodes in the driver', () => {
  it('gives events the priority of a shop, above a church', () => {
    const picked = chooseNode([
      { id: 'c', type: 'church', row: 3 },
      { id: 'e', type: 'event', row: 3 },
      { id: 'b', type: 'boss', row: 3 },
    ]);
    expect(picked.id).toBe('e');
    // Equal to a shop: only the row (deeper first) separates them.
    expect(
      chooseNode([
        { id: 's', type: 'shop', row: 3 },
        { id: 'e', type: 'event', row: 4 },
      ]).id,
    ).toBe('e');
    expect(
      chooseNode([
        { id: 's', type: 'shop', row: 4 },
        { id: 'e', type: 'event', row: 3 },
      ]).id,
    ).toBe('s');
    // Above a church, below a battle.
    expect(
      chooseNode([
        { id: 'b', type: 'battle', row: 3 },
        { id: 'e', type: 'event', row: 3 },
      ]).id,
    ).toBe('b');
  });

  it('resolves an event through the commands: arrive, choose, leave, node complete', async () => {
    const driver = driverFor(3);
    const rm = driver.runManager;
    const node = makeEvent(rm.nodeMap.nodes.find((n) => n.type === 'battle' && n.row >= 2));
    const result = await driver._runEventNode(node);
    expect(result.result).toBe('event_done');
    expect(result.battle).toBe(false); // the default policy takes no fight
    expect(node.completed).toBe(true);
    expect(rm.eventLog).toHaveLength(1);
    expect(eventState(rm, node.id)).toMatchObject({ left: true, choiceId: result.choiceId });
    expect(driver.metrics.eventNodes).toBe(1);
    expect(driver.metrics.eventsByChoice[`${result.eventId}.${result.choiceId}`]).toBe(1);
  });

  it('the default policy never picks a choice that may start a battle; fight prefers one', () => {
    const run = driverFor(4).runManager;
    const node = arriveAs(run, 'abandoned_armory');
    expect(chooseEventPlan(run, node.id).choiceId).toBe('racks');
    expect(chooseEventPlan(run, node.id, { fight: true })).toMatchObject({
      choiceId: 'door',
      mayFight: true,
    });
    const other = arriveAs(driverFor(4).runManager, 'drill_yard');
    expect(other).toBeTruthy();
  });

  it('a fight policy fights the event battle through the battle path and settles the spoils', async () => {
    const driver = driverFor(5, { eventPolicy: 'fight' });
    const rm = driver.runManager;
    const node = arriveAs(
      rm,
      'abandoned_armory',
      makeEvent(rm.nodeMap.nodes.find((n) => n.type === 'battle' && n.row >= 2)),
    );
    const gold = rm.gold;
    const result = await driver._runEventNode(node);
    expect(result).toMatchObject({ result: 'event_done', battle: true, choiceId: 'door' });
    expect(driver.metrics.eventBattles).toBe(1);
    expect(driver.metrics.battles).toBe(1);
    expect(node.completed).toBe(true);
    expect(node.type).toBe('event');
    expect(eventState(rm, node.id).battle).toBe('won');
    expect(rm.gold).toBeGreaterThan(gold + 200); // battle gold and the 200 G of spoils
    expect(rm.pendingEventNodeId).toBeNull();
  });

  it('plays whole runs with events in them, none skipped, none stuck', async () => {
    let events = 0;
    for (const seed of [11, 12, 13]) {
      installSeed(seed);
      try {
        const driver = driverFor(seed);
        const result = await driver.run();
        expect(['victory', 'defeat']).toContain(result.result);
        const eventTrace = result.trace.filter((t) => t.nodeType === 'event');
        for (const entry of eventTrace) expect(entry.result).toBe('event_done');
        expect(result.metrics.invalidEventChoices ?? 0).toBe(0);
        events += eventTrace.length;
      } finally {
        restoreMathRandom();
      }
    }
    expect(events).toBeGreaterThan(0);
  });

  it('an unknown node (no events data) is left, never stalled on', async () => {
    const driver = driverFor(6);
    const rm = driver.runManager;
    const node = makeEvent(rm.nodeMap.nodes.find((n) => n.type === 'battle' && n.row >= 2));
    rm.gameData = { ...rm.gameData, events: null };
    expect(arriveAtEvent(rm, node.id)).toBeNull();
    const result = await driver._runEventNode(node);
    expect(result).toMatchObject({ result: 'event_skipped' });
    expect(node.completed).toBe(true);
  });
});
