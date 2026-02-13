// ScenarioRunner — Seed + fixture + agent → run loop + replay capture.

import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { GameDriver } from '../harness/GameDriver.js';
import { checkInvariants, createInvariantContext, updateContext } from '../harness/Invariants.js';
import { loadGameData } from '../testData.js';

export class ScenarioRunner {
  constructor(seed, fixture, agentFactory) {
    this.seed = seed;
    this.fixture = fixture;
    this.agentFactory = agentFactory;
  }

  async run(maxActions = 5000) {
    installSeed(this.seed);

    try {
      const gameData = loadGameData();

      // Build roster from fixture (if provided)
      let roster = null;
      if (this.fixture.roster) {
        roster = this.fixture.buildRoster(gameData);
      }

      const battleParams = { ...this.fixture.battleParams };
      if (!Number.isFinite(battleParams.runSeed)) {
        const seedValue = Number(this.seed);
        battleParams.runSeed = Number.isFinite(seedValue) ? (seedValue >>> 0) : 0;
      }
      if (battleParams.nodeId == null || battleParams.nodeId === '') {
        battleParams.nodeId = String(this.fixture.id || `${battleParams.act || 'battle'}:${battleParams.objective || 'rout'}`);
      }
      const driver = new GameDriver(gameData, battleParams, roster);

      try {
        driver.init();
      } catch (err) {
        return {
          schemaVersion: 1,
          harnessVersion: '0.1.0',
          seed: this.seed,
          scenarioId: this.fixture.id,
          initialHash: null,
          periodicSnapshots: {},
          actions: [],
          result: 'error',
          failure: { actionIndex: -1, invariant: 'init', message: err.message, stack: err.stack },
        };
      }

      const agent = this.agentFactory(driver);
      const context = createInvariantContext();
      const replay = {
        schemaVersion: 1,
        harnessVersion: '0.1.0',
        seed: this.seed,
        scenarioId: this.fixture.id,
        initialHash: driver.stateHash(),
        periodicSnapshots: {},
        actions: [],
        result: null,
        failure: null,
      };

      for (let i = 0; i < maxActions; i++) {
        if (driver.isTerminal()) {
          replay.result = driver.getTerminalResult();
          break;
        }

        const legalActions = driver.listLegalActions();
        if (legalActions.length === 0) {
          replay.result = driver.isTerminal() ? driver.getTerminalResult() : 'stuck';
          break;
        }

        let action;
        try {
          action = agent.chooseAction(legalActions);
        } catch (err) {
          replay.result = 'error';
          replay.failure = {
            actionIndex: i,
            invariant: 'agent_error',
            message: err.message,
            stack: err.stack,
          };
          break;
        }
        if (!action) {
          replay.result = 'stuck';
          break;
        }

        try {
          await driver.step(action);
        } catch (err) {
          replay.actions.push({ i, ...action });
          replay.result = 'error';
          replay.failure = {
            actionIndex: i,
            invariant: 'step_error',
            message: err.message,
            stack: err.stack,
          };
          break;
        }

        replay.actions.push({ i, ...action });
        updateContext(context, action, driver);

        // Check invariants
        const errors = checkInvariants(driver, context);
        if (errors.length > 0) {
          replay.result = 'invariant_violation';
          replay.failure = {
            actionIndex: i,
            invariant: errors[0].split(':')[0],
            message: errors.join('; '),
            stack: null,
          };
          break;
        }

        // Periodic snapshots
        if (i > 0 && i % 10 === 0) {
          replay.periodicSnapshots[i] = driver.stateHash();
        }
      }

      if (!replay.result) {
        replay.result = 'timeout';
      }

      return replay;
    } finally {
      restoreMathRandom();
    }
  }
}
