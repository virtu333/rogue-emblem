// The Iron Guardian's hall (data/setPieces.json `guardian_hall` / `guardian_hall_dark`) played to
// the end by the headless harness, with an army at about the act's levels (the map review's army,
// utils/devReviewArmy.js) and two policies: the careful TacticianAgent (which reads the Danger
// view, Hammerfall's marks included) and the reckless ScriptedAgent (which walks onto them).
// Ways this breaks that the unit tests would not catch:
//   - the hall cannot end for a player who attacks: a Guardian nothing can reach, a wave that stalls the rout, a defeat
//     objective that never completes when the Guardian falls;
//   - the harness invariants (HP bounds, unique tiles, objective consistency) break on a 2x2 body
//     standing on four tiles, its slams, or a mirrored layout;
//   - Hammerfall never lands in a real fight (marks set where no one ever stands);
//   - the hall is unwinnable for a careful player at the act's strength;
//   - a victory with the Guardian still standing.
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { GameDriver } from './GameDriver.js';
import { checkInvariants } from './Invariants.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { RunManager } from '../../src/engine/RunManager.js';
import { addReviewArmy } from '../../src/utils/devReviewArmy.js';

const data = loadGameData();

afterEach(() => restoreMathRandom());

/** The act's army: the starting lords levelled to the act, plus recruits to six. */
function armyFor(act, seed) {
  const run = new RunManager(data);
  run.startRun({ runSeed: seed, difficultyId: 'normal', autoSelectBlessing: false });
  addReviewArmy(run, { act, seed, army: 6 });
  return run.roster;
}

function hall(seed, { act = 'act2', setPiece = 'guardian_hall', difficultyId = 'normal' } = {}) {
  const roster = armyFor(act, seed);
  installSeed(seed);
  const driver = new GameDriver(
    data,
    { act, objective: 'rout', setPiece, battleSeed: seed, difficultyId, deployCount: 6 },
    roster,
  );
  driver.init();
  return driver;
}

const POLICIES = {
  tactician: (driver) => new TacticianAgent(driver, { rescue: true }),
  scripted: (driver) => new ScriptedAgent(driver),
};

async function play(driver, agent, cap = 3000) {
  const b = driver.battle;
  const errors = [];
  for (let i = 0; i < cap && b.result === null; i++) {
    const legal = driver.listLegalActions();
    if (!legal.length) break;
    await driver.step(agent.chooseAction(legal));
    if (b.turnManager.turnNumber > 40) break;
    if (i % 25 === 0) errors.push(...checkInvariants(driver));
  }
  errors.push(...checkInvariants(driver));
  return { b, errors };
}

const guardianOf = (units) => units.find((u) => u.className === 'Iron Guardian');

describe('the Guardian’s hall in the harness', () => {
  for (const [act, setPiece] of [
    ['act2', 'guardian_hall'],
    ['act3', 'guardian_hall_dark'],
    ['act4', 'guardian_hall'],
  ]) {
    for (const policy of Object.keys(POLICIES)) {
      it(
        `${setPiece} in ${act} (${policy}): every battle ends, the invariants hold, the hammer falls`,
        { timeout: 240000 },
        async () => {
          let slams = 0;
          let wins = 0;
          const outcomes = [];
          const seeds = [11, 12, 13, 14, 15, 16];
          for (const seed of seeds) {
            const driver = hall(seed, { act, setPiece });
            const g = guardianOf(driver.battle.enemyUnits);
            expect(g, `seed ${seed}`).toBeTruthy();
            expect(driver.battle.battleConfig.hammerfall).toEqual({ v: 1 });
            const { b, errors } = await play(driver, POLICIES[policy](driver));
            restoreMathRandom();
            expect(errors, `seed ${seed}`).toEqual([]);
            // The reckless walk always ends the battle. The careful one may stall: an army whose
            // survivors cannot scratch the plates and will not walk into its counter waits it out
            // (the Guardian never moves), which costs turns, never the run.
            if (policy === 'scripted' || guardianOf(b.enemyUnits) === undefined)
              expect(['victory', 'defeat'], `seed ${seed} ended by turn 40`).toContain(b.result);
            if (b.result === 'victory') {
              wins++;
              expect(guardianOf(b.enemyUnits), `seed ${seed}: won with it standing`).toBeFalsy();
            }
            slams += b._hammerfallState?.slams || 0;
            outcomes.push(`${seed}:${b.result}@${b.turnManager.turnNumber}`);
          }
          console.info(`${setPiece} ${act} ${policy}: ${outcomes.join(' ')} · slams ${slams}`);
          expect(slams, 'Hammerfall landed in some fight').toBeGreaterThan(0);
          // A careful player at the act's strength wins most halls.
          if (policy === 'tactician') expect(wins).toBeGreaterThanOrEqual(seeds.length / 2);
        },
      );
    }
  }
});
