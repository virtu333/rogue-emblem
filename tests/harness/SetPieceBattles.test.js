// Exploratory version (will be rewritten).
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from '../sim/RunSimulationDriver.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { checkInvariants, createInvariantContext, updateContext } from './Invariants.js';
import { HeadlessBattle } from './HeadlessBattle.js';
import { arriveAs, makeEvent, soloEvent } from '../eventKit.js';
import { battleGenerationSeed, generateSeededBattle } from '../../src/engine/BattleScout.js';
import { eventState } from '../../src/engine/EventCommands.js';
import { RunManager } from '../../src/engine/RunManager.js';

const data = loadGameData();
const TURN_CAP = 40;
const FF_AGENT = process.env.FF_AGENT || 'tactician';

afterEach(() => restoreMathRandom());

const original = HeadlessBattle.prototype._generateBattleConfig;
HeadlessBattle.prototype._generateBattleConfig = function () {
  if (!this.battleParams.setPiece) return original.call(this);
  const seed = battleGenerationSeed(this.battleParams, { runSeed: this.battleParams.runSeed });
  return generateSeededBattle(this.battleParams, this.gameData, seed);
};

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
  if (found.length !== 1) throw new Error(`Expected one event battle for ${setPieceId}`);
  return structuredClone(found[0]);
}

class StopAtNode extends Error {
  constructor(node) {
    super('stop');
    this.node = node;
  }
}

class SmashingTactician {
  constructor(driver) {
    this.driver = driver;
    this.tactician = new TacticianAgent(driver, { rescue: true });
    this.scripted = new ScriptedAgent(driver);
  }
  chooseAction(legal) {
    const b = this.driver.battle;
    if (b.enemyUnits.length === 0) return this.scripted.chooseAction(legal);
    const remains = legal.find((a) => a.type === 'choose_remains');
    if (remains) return remains;
    const smash = legal.find((a) => a.type === 'choose_action' && a.payload.label === 'Smash');
    if (smash && this.tactician.plan?.action !== 'Attack') return smash;
    return this.tactician.chooseAction(legal);
  }
}

const snapshots = new Map();

async function fastForward({ difficultyId, act, seed }) {
  const key = `${difficultyId}|${act}|${seed}|${process.env.MINROW}`;
  if (snapshots.has(key)) return snapshots.get(key);
  installSeed(seed);
  try {
    const driver = new RunSimulationDriver(data, {
      runOptions: { runSeed: seed, difficultyId, autoSelectBlessing: false },
      battleAgentFactory: (d) =>
        FF_AGENT === 'tactician' ? new TacticianAgent(d, { rescue: true }) : new ScriptedAgent(d),
      invincibility: true,
      maxBattleActions: 600,
    });
    driver.init();
    const ordinary = driver._runBattleNode.bind(driver);
    driver._runBattleNode = async (node) => {
      if (node.type === 'boss' && driver.runManager.currentAct === act) throw new StopAtNode(null);
      if (
        node.type === 'battle' &&
        driver.runManager.currentAct === act &&
        node.row >= Number(process.env.MINROW || 2) &&
        node.battleParams
      )
        throw new StopAtNode(node);
      return ordinary(node);
    };
    let snap = null;
    try {
      await driver.run();
    } catch (error) {
      if (!(error instanceof StopAtNode)) throw error;
      if (error.node)
        snap = { json: JSON.stringify(driver.runManager.toJSON()), nodeId: error.node.id };
    }
    snapshots.set(key, snap);
    return snap;
  } finally {
    restoreMathRandom();
  }
}

async function fight({ setPiece, difficultyId, act, seed, policy }) {
  const snap = await fastForward({ difficultyId, act, seed });
  if (!snap) return null;
  installSeed(seed + 7);
  try {
    let probe = null;
    const driver = new RunSimulationDriver(data, {
      runOptions: { runSeed: seed, difficultyId, autoSelectBlessing: false },
      eventPolicy: 'fight',
      battleAgentFactory: (battleDriver) => {
        const agent =
          policy === 'tactician'
            ? new SmashingTactician(battleDriver)
            : new ScriptedAgent(battleDriver);
        probe = {
          driver: battleDriver,
          context: createInvariantContext(),
          errors: [],
          last: null,
          hung: false,
          smashes: 0,
          maxTombstones: 0,
          risen: 0,
          deployed: battleDriver.battle.playerUnits.length,
          turns: 0,
          enemies: battleDriver.battle.enemyUnits.length,
          waves: battleDriver.battle.battleConfig?.reinforcements?.scriptedWaves?.length ?? 0,
          template: battleDriver.battle.battleConfig?.templateId,
        };
        const watch = () => {
          const b = battleDriver.battle;
          probe.maxTombstones = Math.max(probe.maxTombstones, b._zombieTombstones.length);
          probe.risen = Math.max(probe.risen, b.enemyUnits.filter((u) => u._revived).length);
          probe.turns = b.turnManager?.turnNumber || 0;
          if (probe.last) updateContext(probe.context, probe.last, battleDriver);
          probe.errors.push(...checkInvariants(battleDriver, probe.context));
        };
        return {
          chooseAction(legal) {
            watch();
            if (probe.turns > TURN_CAP || probe.errors.length > 0) {
              probe.hung = probe.turns > TURN_CAP;
              return null;
            }
            const action = agent.chooseAction(legal);
            if (action?.type === 'choose_remains') probe.smashes++;
            probe.last = action;
            (probe.log ||= []).push(
              `${probe.turns}:${action?.type}:${JSON.stringify(action?.payload)}`,
            );
            return action;
          },
        };
      },
    });
    driver.runManager = RunManager.fromJSON(JSON.parse(snap.json), data);
    const rm = driver.runManager;
    const node = rm.nodeMap.nodes.find((n) => n.id === snap.nodeId);
    let won;
    let result;
    if (setPiece === 'ordinary') {
      result = await driver._runBattleNode(node);
      won = result.result === 'victory';
    } else {
      const effect = shippedBattleEffect(setPiece);
      const event = soloEvent([effect], { id: `fixture_${setPiece}` });
      rm.gameData = {
        ...rm.gameData,
        events: {
          ...rm.gameData.events,
          events: [event, ...rm.gameData.events.events.filter((e) => e.fallback)],
        },
      };
      makeEvent(node);
      arriveAs(rm, event.id, node);
      result = await driver._runEventNode(node);
      won = result.result === 'event_done' && eventState(rm, node.id).battle === 'won';
    }
    const battle = probe?.driver.battle;
    if (process.env.DUMP && String(seed) === process.env.DUMP) {
      const b = battle;
      console.info(
        'DUMP',
        JSON.stringify({
          cfg: b.battleConfig.templateId,
          mirrored: b.battleConfig.mirrored,
          variant: b.battleConfig.setPieceVariant,
          spawns: b.battleConfig.enemySpawns.map(
            (e) => `${e.className}${e.isBoss ? '*' : ''}L${e.level}@${e.col},${e.row}`,
          ),
          waves: JSON.stringify(b.battleConfig.reinforcements),
          enemiesNow: b.enemyUnits.map(
            (u) =>
              `${u.className}${u.isBoss ? '*' : ''}L${u.level}hp${u.currentHP}@${u.col},${u.row} ${u.aiMode || u.aiProfile || ''} ${u._holdPack ?? ''}`,
          ),
          players: b.playerUnits.map((u) => `${u.name}@${u.col},${u.row} hp${u.currentHP}`),
          cols: b.battleConfig.cols,
          rows: b.battleConfig.rows,
          result: b.result,
          turn: b.turnManager.turnNumber,
          log: (probe.log || []).slice(-30),
        }),
      );
    }
    const alive = battle ? battle.playerUnits.length + (battle.escapedUnits?.length || 0) : 0;
    return {
      seed,
      probe,
      won,
      res: result.result,
      row: node.row,
      deployed: probe?.deployed ?? 0,
      lost: Math.max(0, (probe?.deployed ?? 0) - alive),
      turns: probe?.turns ?? 0,
      roster: rm.roster.length,
      level: Math.round(
        rm.roster.reduce((s, u) => s + (u.level || 0), 0) / Math.max(1, rm.roster.length),
      ),
    };
  } finally {
    restoreMathRandom();
  }
}

const SEEDS = Number(process.env.SEEDS || 6);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SCENARIOS = [];
for (const policy of ['scripted', 'tactician'])
  for (const [act, difficultyId] of [
    ['act1', 'normal'],
    ['act1', 'dusk'],
    ['act3', 'hard'],
  ])
    for (const setPiece of ['ordinary', 'toll_house', 'toll_crossing'])
      SCENARIOS.push({ setPiece, act, difficultyId, policy });

describe('proto', () => {
  for (const scenario of SCENARIOS) {
    const { setPiece, act, difficultyId, policy } = scenario;
    const name = `${setPiece} · ${act} · ${difficultyId} · ${policy}`;
    if (ONLY && !ONLY.some((o) => name.includes(o))) continue;
    it(name, { timeout: 600000 }, async () => {
      const t = Date.now();
      const rows = [];
      for (let i = 0; i < SEEDS; i++) {
        const seed = 1000 + i * 37;
        const o = await fight({ ...scenario, seed });
        rows.push(o);
      }
      const done = rows.filter(Boolean);
      const wins = done.filter((o) => o.won).length;
      const avg = (f) => (done.reduce((s, o) => s + f(o), 0) / Math.max(1, done.length)).toFixed(1);
      console.info(
        `${name}: n=${done.length}/${rows.length} wins=${wins} turns=${avg((o) => o.turns)} lost=${avg((o) => o.lost)} dep=${avg((o) => o.deployed)} lvl=${avg((o) => o.level)} hung=${done.filter((o) => o.probe?.hung).length} err=${done.filter((o) => o.probe?.errors.length).length} smash=${avg((o) => o.probe?.smashes)} tomb=${avg((o) => o.probe?.maxTombstones)} risen=${avg((o) => o.probe?.risen)} ${Date.now() - t}ms\n` +
          done
            .map(
              (o) =>
                `  ${o.seed} ${o.won ? 'W' : 'L'}${o.probe?.hung ? 'H' : ''} t${o.turns} lost${o.lost}/${o.deployed} row${o.row} ${o.probe?.errors[0] || ''}`,
            )
            .join('\n'),
      );
      expect(true).toBe(true);
    });
  }
});
