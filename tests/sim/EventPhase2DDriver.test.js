// The shipped Phase 2D events in the run-simulation driver (docs/specs/event-nodes-phase2.md
// "2D as built"): the sims and the fullrun slices play events end to end through the same
// commands the route map uses, so a new effect must not strand them.
//
// Ways this goes wrong:
//   - an event with a green recruit (Old Faces) runs in the harness with a different unit than the
//     scene would build (a lord, another name), or with no unit at all;
//   - the default policy stalls on a multi-page event, a target it cannot pick, or a contract;
//   - a whole simulated run meets the new events and skips or strands one.
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';
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

const eventSpot = (rm) =>
  makeEvent(rm.nodeMap.nodes.find((n) => n.type === 'battle' && n.row >= 2));

describe('Old Faces in the harness', () => {
  it("a fight policy rides to his side: the green deserter on the field is the node's preview, never a lord", async () => {
    for (const seed of [5, 6, 7, 8, 9, 10]) {
      // The lord roll is made certain (chance 1), so only the rule "an event's recruit never
      // rolls a lord" can keep a lord off the field: no flag on the battle says so.
      const driver = driverFor(seed, {
        eventPolicy: 'fight',
        metaEffects: { lordRecruitChanceBonus: 1 },
      });
      const rm = driver.runManager;
      const node = arriveAs(rm, 'old_faces', eventSpot(rm));
      let spawned = null;
      const original = driver._completeBattle.bind(driver);
      driver._completeBattle = (battleDriver, merged, n) => {
        spawned = battleDriver.battle.npcUnits.map((u) => ({
          name: u.name,
          className: u.className,
          isLord: Boolean(u.isLord),
          faction: u.faction,
        }));
        return original(battleDriver, merged, n);
      };
      const result = await driver._runEventNode(node);
      expect(result).toMatchObject({ result: 'event_done', battle: true, choiceId: 'ride' });
      expect(spawned).toEqual([
        {
          name: node.recruitPreview.name,
          className: node.recruitPreview.className,
          isLord: false,
          faction: 'npc',
        },
      ]);
      expect(driver.metrics).toMatchObject({ eventBattles: 1, battles: 1 });
      expect(node.completed).toBe(true);
      // Control: the same preview at a recruit NODE does roll a lord under this chance.
      const asRecruitNode = { ...node, type: 'recruit' };
      expect(rm.getRecruitNodeUnit(asRecruitNode, { preview: node.recruitPreview }).isLord).toBe(
        true,
      );
    }
  });
});

describe('the default policy', () => {
  it.each([
    'sunken_mine',
    'plague_village',
    'merc_contract',
    'cartographer',
    'chained_shelf',
    'hollow_herald',
    'wandering_smith',
    'turncoat',
    'old_faces',
    'deserters_revenge',
    'collectors',
    'bad_map',
  ])(
    'walks %s to the end without a stall, an invalid choice or a skipped node',
    async (eventId) => {
      const driver = driverFor(12);
      const rm = driver.runManager;
      const node = arriveAs(rm, eventId, eventSpot(rm));
      const result = await driver._runEventNode(node);
      expect(result.result).toBe('event_done');
      expect(node.completed).toBe(true);
      expect(driver.metrics.invalidEventChoices ?? 0).toBe(0);
      expect(driver.metrics.eventSteps).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(['sunken_mine', 'collectors', 'deserters_revenge', 'hollow_herald'])(
    'a fight policy fights %s through the battle path and settles its spoils',
    async (eventId) => {
      const driver = driverFor(13, { eventPolicy: 'fight' });
      const rm = driver.runManager;
      const node = arriveAs(rm, eventId, eventSpot(rm));
      const result = await driver._runEventNode(node);
      expect(result).toMatchObject({ result: 'event_done' });
      expect(node.completed).toBe(true);
      expect(driver.metrics.invalidEventChoices ?? 0).toBe(0);
    },
  );
});

describe('whole simulated runs', () => {
  it('meet the new events in their acts and play them through (none skipped, none stuck)', async () => {
    const met = new Set();
    for (const seed of [21, 22, 23, 24]) {
      installSeed(seed);
      try {
        const driver = driverFor(seed);
        const result = await driver.run();
        for (const entry of result.trace.filter((t) => t.nodeType === 'event')) {
          expect(entry.result).toBe('event_done');
          met.add(entry.eventId);
        }
        expect(result.metrics.invalidEventChoices ?? 0).toBe(0);
      } finally {
        restoreMathRandom();
      }
    }
    expect(met.size).toBeGreaterThan(2);
  });
});
