// The new procedural shapes (docs/specs/map-variety.md: Corner Camp, Three Roads, Three Roads
// Keep, Caught in the Open, Two Camps) played to the end by the headless harness, beside the
// ordinary route battle as control.
//
// Each fight is a real run's fight. A RunSimulationDriver run is played with its own policies
// (invincible, so the army is the one a run builds by then) up to the act's first ordinary route
// battle below row 2, and stops in front of it. That node is then fought as it was ('ordinary')
// and with its template set to each new shape (the objective a shape's pool names), from the
// node's own battle seed, as the route map would build it.
//
// Ways a shape breaks that nothing else would catch:
//   - a hold pack or a guard post stalls the battle (it never ends);
//   - the harness invariants (HP bounds, unique tiles, objective consistency) break on a
//     grouped or mirrored garrison;
//   - the shape is far harder or far slower than the route battle it stands in for.
// The numbers are seeded and exact, so a drift shows in the summary table (console.info) before
// it crosses a threshold. Set TEMPLATE_BATTLE_SEEDS to play more seeds.
import { afterAll, describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from '../sim/RunSimulationDriver.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { checkInvariants, createInvariantContext, updateContext } from './Invariants.js';
import { HEADLESS_STATES } from './HeadlessBattle.js';
import { RunManager } from '../../src/engine/RunManager.js';
import { healUnitFully } from '../../src/engine/UnitHealth.js';

const data = loadGameData();
const TURN_CAP = 40;
const SEED_BASE = 2000;
const SEED_STEP = 41;
const EXTRA_SEEDS = Math.max(0, Number(process.env.TEMPLATE_BATTLE_SEEDS) || 0);

const POLICIES = {
  tactician: (driver) => new TacticianAgent(driver, { rescue: true }),
  scripted: (driver) => new ScriptedAgent(driver),
};

const objectiveOf = (id) =>
  Object.keys(data.mapTemplates).find((k) => data.mapTemplates[k].some((t) => t.id === id));

class StopAtNode extends Error {
  constructor(node) {
    super('stopped in front of a route battle');
    this.node = node;
  }
}

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

/** One fight: the snapshot's army against the node as it was, or with `template` set. */
async function fight({ template, difficultyId, act, seed, policy }) {
  const snapshot = await armyAtAct({ difficultyId, act, seed });
  if (!snapshot) return null;
  installSeed(seed + 7);
  try {
    let probe = null;
    const driver = new RunSimulationDriver(data, {
      runOptions: { runSeed: seed, difficultyId, autoSelectBlessing: false },
      battleAgentFactory: (battleDriver) => {
        const agent = POLICIES[policy](battleDriver);
        const battle = battleDriver.battle;
        probe = {
          driver: battleDriver,
          context: createInvariantContext(),
          errors: [],
          last: null,
          hung: false,
          turns: 0,
          deployed: battle.playerUnits.length,
          par: battle.turnPar,
          templateId: battle.battleConfig?.templateId,
          startFoes: battle.enemyUnits.length,
        };
        probe.check = () => {
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
            probe.last = action;
            return action;
          },
        };
      },
    });
    driver.runManager = RunManager.fromJSON(JSON.parse(snapshot.json), data);
    // The army was built invincible, which leaves it on whatever HP its last fights did (HP
    // carries between battles): every scenario starts it whole, so the shapes are compared, not
    // the luck of the run before.
    for (const unit of driver.runManager.roster) healUnitFully(unit);
    const node = driver.runManager.nodeMap.nodes.find((n) => n.id === snapshot.nodeId);
    if (template === 'ordinary_seize') {
      // The control for a seize shape: the same node as a seize of the act's own templates.
      delete node.templateId;
      delete node.battleParams.templateId;
      node.battleParams.objective = 'seize';
    } else if (template !== 'ordinary') {
      // As the route map would hand it over: the shape's template and objective, no caravan or
      // village promise the shape's pool was not drawn for.
      node.templateId = template;
      node.battleParams.templateId = template;
      node.battleParams.objective = objectiveOf(template);
    }
    const won = (await driver._runBattleNode(node)).result === 'victory';
    const battle = probe.driver.battle;
    probe.check();
    const alive = battle.playerUnits.length + (battle.escapedUnits?.length || 0);
    return {
      seed,
      probe,
      won,
      terminal: battle.battleState === HEADLESS_STATES.BATTLE_END,
      result: battle.result,
      lost: Math.max(0, probe.deployed - alive),
      turns: probe.turns,
      overPar: Number.isFinite(probe.par) ? probe.turns - probe.par : 0,
    };
  } finally {
    restoreMathRandom();
  }
}

const mean = (rows, pick) =>
  rows.reduce((sum, row) => sum + pick(row), 0) / Math.max(1, rows.length);

const report = [];
afterAll(() => {
  if (report.length === 0) return;
  const line = (s) =>
    `${s.scenario.padEnd(34)} ${s.policy.padEnd(9)} fought ${s.fought.padEnd(5)} ` +
    `win ${(s.winRate * 100).toFixed(0).padStart(3)}% (${String(s.wins).padStart(2)})  ` +
    `turns ${s.avgTurns.toFixed(1).padStart(5)}  won vs par ${s.wonOverPar >= 0 ? '+' : ''}${s.wonOverPar.toFixed(1)}  ` +
    `lost ${s.avgLost.toFixed(1)}  hung ${s.hung}`;
  console.info(`Template battles (seeded, exact):\n${report.map(line).join('\n')}`);
});

async function playScenario(scenario) {
  const rows = [];
  for (let i = 0; i < scenario.seeds; i++) {
    const outcome = await fight({ ...scenario, seed: SEED_BASE + i * SEED_STEP });
    if (outcome) rows.push(outcome);
  }
  const wins = rows.filter((r) => r.won).length;
  const summary = {
    scenario: `${scenario.template} · ${scenario.act} · ${scenario.difficultyId}`,
    policy: scenario.policy,
    fought: `${rows.length}/${scenario.seeds}`,
    wins,
    winRate: rows.length ? wins / rows.length : 0,
    avgTurns: mean(rows, (r) => r.turns),
    avgOverPar: mean(rows, (r) => r.overPar),
    // Wins only: a loss ends early and would make a hard shape look fast.
    wonOverPar: mean(
      rows.filter((r) => r.won),
      (r) => r.overPar,
    ),
    avgLost: mean(rows, (r) => r.lost),
    hung: rows.filter((r) => r.probe.hung).length,
  };
  report.push(summary);
  return { rows, summary };
}

// Every new shape plays from Act II. The careful policy may win a shape less often than the
// ordinary map on the same seeds, but never by more than MAX_DROP_BELOW_CONTROL: a harder shape
// is the point, an unwinnable one is a bug. (Three seeds is a smoke check; TEMPLATE_BATTLE_SEEDS
// adds seeds for a tuning pass.)
const MAX_DROP_BELOW_CONTROL = 0.4;
const CELLS = [
  {
    act: 'act2',
    difficultyId: 'normal',
    seeds: 3,
    templates: [
      'corner_camp',
      'three_roads',
      'three_roads_keep',
      'caught_in_the_open',
      'two_camps',
    ],
  },
  { act: 'act2', difficultyId: 'dusk', seeds: 3, templates: ['corner_camp'] },
];

describe('the new map shapes in a run: every battle ends, the invariants hold, winnable', () => {
  const controlRates = new Map();
  for (const cell of CELLS) {
    const seeds = cell.seeds + EXTRA_SEEDS;
    const controls = cell.templates.some((t) => objectiveOf(t) === 'seize')
      ? ['ordinary', 'ordinary_seize']
      : ['ordinary'];
    for (const template of [...controls, ...cell.templates]) {
      for (const policy of Object.keys(POLICIES)) {
        it(
          `${template}, ${cell.act} on ${cell.difficultyId} (${policy})`,
          { timeout: 600000 },
          async () => {
            const { rows, summary } = await playScenario({ ...cell, seeds, template, policy });
            if (template === 'ordinary')
              controlRates.set(`${cell.act}|${cell.difficultyId}|${policy}`, summary.winRate);
            expect(rows.length).toBeGreaterThanOrEqual(Math.ceil(seeds / 2));
            for (const row of rows) {
              const where = `${template} ${cell.act} ${cell.difficultyId} ${policy} seed ${row.seed}`;
              expect(row.probe.errors, where).toEqual([]);
              if (!template.startsWith('ordinary'))
                expect(row.probe.templateId, where).toBe(template);
              expect(row.probe.startFoes, where).toBeGreaterThan(0);
            }
            if (template.startsWith('ordinary')) return;
            if (policy === 'scripted') {
              // The reckless policy always makes contact: no shape may outlast the cap.
              expect(summary.hung, 'battles past the turn cap').toBe(0);
              for (const row of rows) expect(row.terminal, `seed ${row.seed} ended`).toBe(true);
            } else {
              expect(summary.hung, 'battles past the turn cap').toBeLessThanOrEqual(
                Math.ceil(rows.length * 0.2),
              );
              // The harness's agents lose Act II seize maps of every kind (the ordinary seize
              // control wins none on these seeds), so a seize shape only has to end cleanly.
              const control = controlRates.get(`${cell.act}|${cell.difficultyId}|${policy}`);
              if (objectiveOf(template) !== 'seize' && control !== undefined)
                expect(summary.winRate, `ordinary map won ${control}`).toBeGreaterThanOrEqual(
                  control - MAX_DROP_BELOW_CONTROL,
                );
            }
          },
        );
      }
    }
  }
});
