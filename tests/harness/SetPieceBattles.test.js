// Event set pieces (docs/specs/event-set-pieces.md) played to the end by the headless harness.
//
// Each fight is a real run's fight. A RunSimulationDriver run is played with its own policies up
// to the act's first ordinary route battle (invincible, so the army is the one a run builds by
// that point: levels, recruits, gear) and stops in front of it. That node becomes an event node
// holding the shipped `battle` effect from data/events.json (the Toll Bridge's Dark Omen search
// for toll_house, its failed Bluff for toll_crossing), and the driver does what the route map
// does: arrive, choose, build the battle params (RunManager.getBattleParams), generate the set
// piece's map from the battle seed and fight it. The same node fought as the ordinary route
// battle it was is the control ("ordinary").
//
// Two policies play every battle:
//   tactician  sim/lib/TacticianAgent (a careful player: bait-and-punish) plus the one thing it
//              lacks, Smash (it never plans it). The win rates asserted are this policy's.
//   scripted   the harness default ScriptedAgent (charges the nearest foe, Smashes the remains it
//              reaches). A reckless player: its job here is to prove every battle ends.
//
// Ways a set piece breaks that nothing else would catch:
//   - the authored map or its foes make the fight unwinnable by a sensible policy;
//   - a Rout over Zombies never ends because their remains can't be dealt with;
//   - a scripted wave or a hold pack stalls the battle (it never ends);
//   - the harness invariants (HP bounds, unique tiles, objective consistency) break on an
//     authored map's spawns, a mirrored layout or a wave;
//   - the set piece's deploy cap is not what the battle fields.
// The numbers are seeded and exact, so a drift shows in the summary table (console.info) before
// it crosses a threshold; the thresholds sit well below what the data does today.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from '../sim/RunSimulationDriver.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { checkInvariants, createInvariantContext, updateContext } from './Invariants.js';
import { GameDriver } from './GameDriver.js';
import { HEADLESS_STATES, HeadlessBattle } from './HeadlessBattle.js';
import { arriveAs, makeEvent, soloEvent } from '../eventKit.js';
import { battleGenerationSeed, generateSeededBattle } from '../../src/engine/BattleScout.js';
import { eventState } from '../../src/engine/EventCommands.js';
import { RunManager } from '../../src/engine/RunManager.js';
import { findSetPiece } from '../../src/engine/SetPieces.js';
import { DEPLOY_LIMITS } from '../../src/utils/constants.js';
import { deployLimitsForParams, resolveDeployLimits } from '../../src/engine/BattleDeployCount.js';

const data = loadGameData();
const TURN_CAP = 40;
const SEED_BASE = 1000;
const SEED_STEP = 37;

/** What a real player has beyond the Tactician's plans: Smash the remains in reach. */
class SmashingTactician {
  constructor(driver) {
    this.driver = driver;
    this.tactician = new TacticianAgent(driver, { rescue: true });
    this.scripted = new ScriptedAgent(driver);
  }
  chooseAction(legal) {
    // Nobody left to plan against (only remains, or a Thief to chase): the scripted walk.
    if (this.driver.battle.enemyUnits.length === 0) return this.scripted.chooseAction(legal);
    const remains = legal.find((a) => a.type === 'choose_remains');
    if (remains) return remains;
    const smash = legal.find((a) => a.type === 'choose_action' && a.payload.label === 'Smash');
    if (smash && this.tactician.plan?.action !== 'Attack') return smash;
    return this.tactician.chooseAction(legal);
  }
}

const POLICIES = {
  tactician: (driver) => new SmashingTactician(driver),
  scripted: (driver) => new ScriptedAgent(driver),
};

// The harness generates a battle from an explicit list of data tables that has no `setPieces`
// (HeadlessBattle._generateBattleConfig), so a set piece param would throw "Unknown set piece".
// BattleScene generates with `generateSeededBattle(params, gameData, seed)`; for a set piece the
// harness does the same here, for the length of this file.
const harnessGenerate = HeadlessBattle.prototype._generateBattleConfig;
beforeAll(() => {
  HeadlessBattle.prototype._generateBattleConfig = function generateLikeTheScene() {
    if (!this.battleParams.setPiece) return harnessGenerate.call(this);
    const seed = battleGenerationSeed(this.battleParams, { runSeed: this.battleParams.runSeed });
    return generateSeededBattle(this.battleParams, this.gameData, seed);
  };
});
afterAll(() => {
  HeadlessBattle.prototype._generateBattleConfig = harnessGenerate;
  restoreMathRandom();
});

/** The shipped `battle` effect that names a set piece: its level bonus and spoils are the data's. */
function shippedBattleEffect(setPieceId) {
  const found = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      if (value.type === 'battle' && value.setPiece === setPieceId) found.push(value);
      Object.values(value).forEach(walk);
    }
  };
  walk(data.events);
  expect(found, `one shipped event battle names ${setPieceId}`).toHaveLength(1);
  return structuredClone(found[0]);
}

class StopAtNode extends Error {
  constructor(node) {
    super('stopped in front of a route battle');
    this.node = node;
  }
}

// One run per (rung, act, seed), played up to the act's first ordinary battle below row 2 and
// saved there, so every scenario at the same seed forks the same army.
const snapshots = new Map();

async function armyAtAct({ difficultyId, act, seed }) {
  const key = `${difficultyId}|${act}|${seed}`;
  if (snapshots.has(key)) return snapshots.get(key);
  installSeed(seed);
  try {
    const driver = new RunSimulationDriver(data, {
      runOptions: { runSeed: seed, difficultyId, autoSelectBlessing: false },
      battleAgentFactory: (battleDriver) => new TacticianAgent(battleDriver, { rescue: true }),
      invincibility: true,
      maxBattleActions: 600,
    });
    driver.init();
    const ordinary = driver._runBattleNode.bind(driver);
    driver._runBattleNode = async (node) => {
      const here = driver.runManager.currentAct === act;
      // An act whose route holds no plain battle below row 2 (shops, recruits, events) has none.
      if (here && node.type === 'boss') throw new StopAtNode(null);
      if (here && node.type === 'battle' && node.row >= 2) throw new StopAtNode(node);
      return ordinary(node);
    };
    let snapshot = null;
    try {
      await driver.run();
    } catch (error) {
      if (!(error instanceof StopAtNode)) throw error;
      if (error.node) {
        snapshot = { json: JSON.stringify(driver.runManager.toJSON()), nodeId: error.node.id };
      }
    }
    snapshots.set(key, snapshot);
    return snapshot;
  } finally {
    restoreMathRandom();
  }
}

/**
 * The run driver, with the set piece's deploy cap honoured. RunSimulationDriver sizes a
 * deployment from the act's limits alone, so a cap of 5 would field 7 in Act III; the deploy
 * screen applies `deployLimitsForParams` (BattleScene.create), so the driver's deploy bonus is
 * brought down to the max the screen would show.
 */
class CappedRunDriver extends RunSimulationDriver {
  async _runBattleNode(node) {
    const run = this.runManager;
    if (!node.battleParams?.deployCap) return super._runBattleNode(node);
    const base = DEPLOY_LIMITS[run.currentAct] || DEPLOY_LIMITS.act1;
    const { max } = resolveDeployLimits({
      base: deployLimitsForParams(node.battleParams),
      deployBonus: run.getDeployBonus(),
    });
    run.getDeployBonus = () => max - base.max;
    try {
      return await super._runBattleNode(node);
    } finally {
      delete run.getDeployBonus;
    }
  }
}

/**
 * One fight: the snapshot's army against `setPiece` (an event battle) or, for 'ordinary', the
 * route battle the node was. Null when the seed's run had no battle to stop in front of.
 */
async function fight({ setPiece, difficultyId, act, seed, policy }) {
  const snapshot = await armyAtAct({ difficultyId, act, seed });
  if (!snapshot) return null;
  installSeed(seed + 7);
  try {
    let probe = null;
    const driver = new CappedRunDriver(data, {
      runOptions: { runSeed: seed, difficultyId, autoSelectBlessing: false },
      eventPolicy: 'fight',
      battleAgentFactory: (battleDriver) => {
        const agent = POLICIES[policy](battleDriver);
        const battle = battleDriver.battle;
        probe = {
          driver: battleDriver,
          context: createInvariantContext(),
          errors: [],
          last: null,
          hung: false,
          smashes: 0,
          maxRemains: 0,
          maxRisen: 0,
          deployed: battle.playerUnits.length,
          turns: 0,
          startFoes: battle.enemyUnits.length,
        };
        // The harness invariants after every step, and what the zombies did.
        probe.check = () => {
          probe.maxRemains = Math.max(probe.maxRemains, battle._zombieTombstones.length);
          probe.maxRisen = Math.max(
            probe.maxRisen,
            battle.enemyUnits.filter((u) => u._revived).length,
          );
          probe.turns = battle.turnManager?.turnNumber || 0;
          if (probe.last) updateContext(probe.context, probe.last, battleDriver);
          probe.errors.push(...checkInvariants(battleDriver, probe.context));
        };
        return {
          chooseAction(legal) {
            probe.check();
            if (probe.errors.length > 0) return null;
            if (probe.turns > TURN_CAP) {
              probe.hung = true;
              return null;
            }
            const action = agent.chooseAction(legal);
            if (action?.type === 'choose_remains') probe.smashes++;
            probe.last = action;
            return action;
          },
        };
      },
    });
    driver.runManager = RunManager.fromJSON(JSON.parse(snapshot.json), data);
    const run = driver.runManager;
    const node = run.nodeMap.nodes.find((n) => n.id === snapshot.nodeId);
    let won;
    if (setPiece === 'ordinary') {
      won = (await driver._runBattleNode(node)).result === 'victory';
    } else {
      const event = soloEvent([shippedBattleEffect(setPiece)], { id: `fixture_${setPiece}` });
      run.gameData = {
        ...run.gameData,
        events: {
          ...run.gameData.events,
          events: [event, ...run.gameData.events.events.filter((e) => e.fallback)],
        },
      };
      makeEvent(node);
      arriveAs(run, event.id, node);
      const result = await driver._runEventNode(node);
      won = result.result === 'event_done' && eventState(run, node.id).battle === 'won';
    }
    const battle = probe.driver.battle;
    // The state the last step left (the loop stops before asking the agent again).
    probe.check();
    const alive = battle.playerUnits.length + (battle.escapedUnits?.length || 0);
    return {
      seed,
      probe,
      won,
      terminal: battle.battleState === HEADLESS_STATES.BATTLE_END,
      result: battle.result,
      row: node.row,
      deployed: probe.deployed,
      lost: Math.max(0, probe.deployed - alive),
      turns: probe.turns,
      foesLeft: battle.enemyUnits.length,
      remainsLeft: battle._zombieTombstones.length,
    };
  } finally {
    restoreMathRandom();
  }
}

const mean = (rows, pick) =>
  rows.reduce((sum, row) => sum + pick(row), 0) / Math.max(1, rows.length);

/** Play every seed of a scenario; the rows and the summary line the report prints. */
async function playScenario(scenario) {
  const rows = [];
  for (let i = 0; i < scenario.seeds; i++) {
    const outcome = await fight({ ...scenario, seed: SEED_BASE + i * SEED_STEP });
    if (outcome) rows.push(outcome);
  }
  const wins = rows.filter((r) => r.won).length;
  const summary = {
    scenario: `${scenario.setPiece} · ${scenario.act} · ${scenario.difficultyId}`,
    policy: scenario.policy,
    fought: `${rows.length}/${scenario.seeds}`,
    wins,
    winRate: rows.length ? wins / rows.length : 0,
    avgTurns: mean(rows, (r) => r.turns),
    avgLost: mean(rows, (r) => r.lost),
    avgDeployed: mean(rows, (r) => r.deployed),
    hung: rows.filter((r) => r.probe.hung).length,
    smashes: rows.reduce((sum, r) => sum + r.probe.smashes, 0),
    remains: rows.reduce((sum, r) => sum + r.probe.maxRemains, 0),
    risen: rows.reduce((sum, r) => sum + r.probe.maxRisen, 0),
  };
  report.push(summary);
  return { rows, summary };
}

const report = [];
afterAll(() => {
  if (report.length === 0) return;
  const line = (s) =>
    `${s.scenario.padEnd(32)} ${s.policy.padEnd(9)} fought ${s.fought.padEnd(5)} ` +
    `win ${(s.winRate * 100).toFixed(0).padStart(3)}% (${String(s.wins).padStart(2)})  ` +
    `turns ${s.avgTurns.toFixed(1).padStart(5)}  lost ${s.avgLost.toFixed(1)}/${s.avgDeployed.toFixed(1)}  ` +
    `hung ${s.hung}  smash ${s.smashes}  remains ${s.remains}  risen ${s.risen}`;
  console.info(`Set piece battles (seeded, exact):\n${report.map(line).join('\n')}`);
});

// act x rung, with the seeds each affords: a fight is cheap, the run that builds the army is not
// (Act III is two acts of play), so the deeper the cell the fewer seeds. `minWinRate` is the
// careful policy's floor; where none is named the cell only has to end cleanly.
const CELLS = [
  { act: 'act1', difficultyId: 'normal', seeds: 12, minWinRate: 0.5 },
  { act: 'act1', difficultyId: 'dusk', seeds: 8, minWinRate: 0.25 },
  { act: 'act3', difficultyId: 'hard', seeds: 5, minWinRate: 0 },
];
const SET_PIECES = ['toll_house', 'toll_crossing'];
const POLICY_NAMES = ['tactician', 'scripted'];

describe('set pieces in a run: every battle ends, the invariants hold, the maps are winnable', () => {
  for (const cell of CELLS) {
    const { act, difficultyId } = cell;
    for (const policy of POLICY_NAMES) {
      it(
        `control: an ordinary route battle, ${act} on ${difficultyId} (${policy})`,
        {
          timeout: 240000,
        },
        async () => {
          const { rows } = await playScenario({ ...cell, setPiece: 'ordinary', policy });
          expect(rows.length).toBeGreaterThanOrEqual(Math.ceil(cell.seeds / 2));
          // It only has to run: it tells the set pieces' numbers what a route fight does.
          for (const row of rows) expect(row.probe.errors).toEqual([]);
        },
      );
    }
    for (const setPiece of SET_PIECES) {
      const piece = findSetPiece(data.setPieces, setPiece);
      for (const policy of POLICY_NAMES) {
        it(`${setPiece}, ${act} on ${difficultyId} (${policy})`, { timeout: 240000 }, async () => {
          const { rows, summary } = await playScenario({ ...cell, setPiece, policy });
          // The seeds' runs reached the fight (a route with no plain battle there is skipped).
          expect(rows.length).toBeGreaterThanOrEqual(Math.ceil(cell.seeds / 2));
          for (const row of rows) {
            const where = `${setPiece} ${act} ${difficultyId} ${policy} seed ${row.seed}`;
            // The harness invariants held at every step.
            expect(row.probe.errors, where).toEqual([]);
            // The set piece's own deploy cap is what the battle fielded.
            expect(row.deployed, where).toBeLessThanOrEqual(piece.deploy.max);
            expect(row.probe.startFoes, where).toBeGreaterThan(0);
            if (row.won) {
              // A won Rout is a cleared field: no foe, no remains left to rise.
              expect(row.result, where).toBe('victory');
              expect(row.foesLeft, where).toBe(0);
              expect(row.remainsLeft, where).toBe(0);
            }
          }
          if (policy === 'scripted') {
            // The reckless policy always makes contact: a battle that outlasts the turn cap is a
            // set piece (a wave, a hold pack, remains that never clear) that cannot end.
            expect(summary.hung, 'battles past the turn cap').toBe(0);
            for (const row of rows) {
              expect(row.terminal, `seed ${row.seed} ended`).toBe(true);
              expect(['victory', 'defeat']).toContain(row.result);
            }
          } else {
            // The careful policy may wait out a hold pack for good now and then (a stalemate it
            // chose), but not as a rule.
            expect(summary.hung, 'battles past the turn cap').toBeLessThanOrEqual(
              Math.ceil(rows.length * 0.2),
            );
            expect(
              summary.winRate,
              `${setPiece} ${act} ${difficultyId}: won ${summary.wins} of ${rows.length}`,
            ).toBeGreaterThanOrEqual(cell.minWinRate);
          }
        });
      }
    }
  }
});

describe('the Toll-House rout needs its remains dealt with', () => {
  // A Zombie that falls leaves remains that rise again unless Smashed, and a Rout is not won
  // while any are on the map (engine/ZombieRemains.js). Playing the set piece through proves the
  // default policies cope (above); this pins that the set piece is where the rule bites.
  function tollHouse(seed) {
    const params = {
      act: 'act1',
      objective: 'rout',
      setPiece: 'toll_house',
      difficultyId: 'normal',
      deployCount: 4,
      enemyLevelBonus: 1,
      levelRange: [2, 3],
      battleSeed: seed,
      fogEnabled: true,
    };
    installSeed(seed);
    const driver = new GameDriver(data, params);
    driver.battle.init({ battleConfig: generateSeededBattle(params, data, seed) });
    const b = driver.battle;
    // No wave: the field is the opening garrison alone.
    b.battleConfig.reinforcements = null;
    return { driver, b };
  }

  // The board right after each enemy-phase start's rising step (the risen foe may then act).
  function watchRising(b) {
    const risen = [];
    const rise = b._processZombieRevival.bind(b);
    b._processZombieRevival = () => {
      const before = b.enemyUnits.length;
      rise();
      risen.push(...b.enemyUnits.slice(before));
    };
    return risen;
  }

  it('felling every Zombie leaves remains and no victory; the captain leaves none; each is smashed or rises', async () => {
    let smashed = 0;
    for (const seed of [3, 11, 29, 41]) {
      try {
        const { driver, b } = tollHouse(seed);
        const risen = watchRising(b);
        const killer = b.playerUnits[0];
        const zombies = b.enemyUnits.filter((u) => u.className === 'Zombie' && !u.isBoss);
        expect(zombies.length, `seed ${seed}: the garrison has Zombies`).toBeGreaterThan(0);
        expect(
          b.enemyUnits.some((u) => u.isBoss),
          `seed ${seed}: the Toll-Keeper is on the map`,
        ).toBe(true);

        for (const foe of [...b.enemyUnits]) b._removeUnit(foe, { killer });

        // Every Zombie left remains, the captain none, and the Rout is not won.
        expect(b.enemyUnits).toHaveLength(0);
        expect(b._zombieTombstones).toHaveLength(zombies.length);
        expect(b._checkBattleEnd()).toBe(false);
        expect(b.result).toBeNull();

        // The default policy finishes it: it walks to remains and smashes them, and any it is too
        // late for rise and are felled again (a risen Zombie leaves nothing). The victory comes
        // only when no record is left.
        const agent = new ScriptedAgent(driver);
        let smashes = 0;
        for (let step = 0; step < 400 && b.result === null; step++) {
          const action = agent.chooseAction(driver.listLegalActions());
          if (action.type === 'choose_remains') smashes++;
          await driver.step(action);
          if (b.result === null) expect(b.battleState).not.toBe(HEADLESS_STATES.BATTLE_END);
        }
        expect(b.result, `seed ${seed}`).toBe('victory');
        expect(b._zombieTombstones).toEqual([]);
        expect(b.enemyUnits).toHaveLength(0);
        // Every record was resolved one way or the other.
        expect(smashes + risen.length, `seed ${seed}`).toBeGreaterThan(0);
        expect(smashes + risen.length).toBeLessThanOrEqual(zombies.length);
        smashed += smashes;
      } finally {
        restoreMathRandom();
      }
    }
    expect(smashed, 'Smash finished at least one record').toBeGreaterThan(0);
  });

  it('a Zombie that is left alone rises again, so the rout cannot be won by waiting', async () => {
    const { driver, b } = tollHouse(7);
    const risen = watchRising(b);
    try {
      const killer = b.playerUnits[0];
      const zombie = b.enemyUnits.find((u) => u.className === 'Zombie' && !u.isBoss);
      b._removeUnit(zombie, { killer });
      expect(b._zombieTombstones).toHaveLength(1);
      // Three enemy phases and the remains stand up.
      for (let turn = 0; turn < 3 && b.result === null; turn++) {
        await driver.step({ type: 'end_turn', payload: {} });
      }
      expect(b._zombieTombstones).toEqual([]);
      expect(risen).toHaveLength(1);
      expect(risen[0]).toMatchObject({ className: 'Zombie', _revived: true });
    } finally {
      restoreMathRandom();
    }
  });
});
