// The battle stream (Math.random during a battle, engine/BattleRng.js) opens on its own seed at
// every FRESH battle of a run: one per run and node (engine/BattleScout.js
// deriveBattleStreamSeed), written to the run by BattleScene.installBattleRng before
// beginBattleInProgress records it as `rngSeedAtEntry`. A resume keeps the suspended battle's
// seed and cursor; Continue from Map (the sanctioned revert, "entry-time Vision/RNG refund":
// RunManager.revertBattleInProgressToEntry / battleEntryRevertPatch) and a re-entry of the same
// node replay the first entry's stream. The real beginBattle on a rendering adapter (the
// BattleSceneEarnedResume pattern), a real RunManager.
//
// Each test names the realistic failure it catches.
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/Grid.js', () => ({
  Grid: class {
    constructor() {
      this.fogEnabled = false;
      this.gridToPixel = (col, row) => ({ x: col * 16, y: row * 16 });
      this.updateFogOfWar = vi.fn();
      this.clearHighlights = vi.fn();
    }
  },
  computeEffectivePath: vi.fn(),
}));

vi.mock('../src/engine/TurnManager.js', () => ({
  TurnManager: vi.fn(function () {
    this.init = vi.fn();
    this.startBattle = vi.fn();
  }),
}));

vi.mock('../src/engine/AIController.js', () => ({
  AIController: vi.fn(function () {}),
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { RunManager } from '../src/engine/RunManager.js';
import { deriveBattleStreamSeed, deriveNodeBattleSeed } from '../src/engine/BattleScout.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { hashRewindSeed } from '../src/ui/VisionRewindController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const NATIVE_RANDOM = Math.random;

afterEach(() => {
  Math.random = NATIVE_RANDOM;
});

function makeDisplayObject() {
  const fns = new Map();
  const target = { visible: true, text: '' };
  const proxy = new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      if (key === 'then') return undefined;
      if (!fns.has(key))
        fns.set(
          key,
          vi.fn((...args) => {
            if (key === 'setText') obj.text = args[0];
            if (key === 'setVisible') obj.visible = args[0];
            return proxy;
          }),
        );
      return fns.get(key);
    },
  });
  return proxy;
}

const BATTLE_CONFIG = {
  cols: 6,
  rows: 4,
  mapLayout: Array.from({ length: 4 }, () => Array(6).fill(0)),
  playerSpawns: [
    { col: 1, row: 2 },
    { col: 0, row: 0 },
    { col: 0, row: 3 },
  ],
  enemySpawns: [],
  objective: 'rout',
};

function makeScene({ runManager, nodeId, act = 'act1', deployed, resumeCheckpoint = null }) {
  const scene = new BattleScene();
  runManager.getLockedBattleConfig = vi.fn(() => structuredClone(BATTLE_CONFIG));
  scene.gameData = gameData;
  scene.runManager = runManager;
  scene.battleParams = { act, fogEnabled: false };
  scene.nodeId = nodeId;
  scene.roster = deployed;
  scene._resumeCheckpoint = resumeCheckpoint;
  scene.registry = {
    get: (key) => {
      if (key === 'startupFlags') return { isMobile: false };
      if (key === 'hints') return { shouldShow: () => false };
      return null;
    },
  };
  scene.events = { once: vi.fn() };
  scene.input = {
    mouse: { disableContextMenu: vi.fn() },
    on: vi.fn(),
    keyboard: { on: vi.fn(), addKey: vi.fn(() => ({ on: vi.fn() })) },
  };
  scene.cameras = { main: { width: 640, height: 480 } };
  scene.game = { events: { on: vi.fn(), off: vi.fn() } };
  scene.time = { delayedCall: vi.fn() };
  scene.tweens = { add: vi.fn() };
  scene.add = {
    rectangle: vi.fn(() => makeDisplayObject()),
    text: vi.fn(() => makeDisplayObject()),
  };
  // installBattleRng and initializeVisionState stay real: they are what is under test.
  for (const name of [
    'initializeAntiTurtleState',
    'addUnitGraphic',
    'addEnemyFromSpawn',
    'dimUnit',
    'updateObjectiveText',
    'updateTopLeftHudLayout',
    'updateEnemyVisibility',
    'updateVisionHud',
    'cancelTouchInspectHold',
    '_hideMenuTooltip',
    '_restoreBattleRng',
    '_onDangerClick',
    '_onRosterClick',
    'forceEndTurn',
    'requestCancel',
    'requestVisionRewind',
    'refreshEndTurnControl',
    'openUnitDetailOverlay',
    'showLootRoster',
    'hideLootRoster',
    '_cycleForecastWeapon',
    '_persistBattleRunState',
  ])
    scene[name] = vi.fn();
  scene._reduceMotion = vi.fn(() => true);
  return scene;
}

function newRun(runSeed = 4242) {
  const rm = new RunManager(gameData, null);
  rm.startRun({ runSeed, autoSelectBlessing: false });
  return rm;
}

/**
 * Enter a battle afresh through the real beginBattle and read what the player's battle will
 * draw: the run's seed, the flag's entry seed, and the stream's next draws. The battle's
 * Math.random is put back before returning.
 */
function enterBattle(rm, nodeId, { act = 'act1', draws = 6 } = {}) {
  const deployed = rm.roster.map((u) => structuredClone(u));
  const scene = makeScene({ runManager: rm, nodeId, act, deployed });
  BattleScene.prototype.beginBattle.call(scene, deployed);
  try {
    return {
      scene,
      rngSeed: rm.rngSeed,
      entrySeed: rm.battleInProgress?.rngSeedAtEntry,
      visionBaseSeed: scene.visionBaseSeed,
      draws: Array.from({ length: draws }, () => Math.random()),
    };
  } finally {
    scene._battleRandomRestore?.();
  }
}

/** A battle won: the flag goes, nothing on the run's seed is refunded (RunManager.completeBattle). */
function settle(rm) {
  rm.clearBattleInProgress();
}

describe('the battle stream: its own per run and node', () => {
  it('two consecutive fresh battles of one run open on different seeds and different draws', () => {
    // Failure (the bug): every battle of a run re-seeds from `rngSeed`, which startRun set to
    // the run seed and nothing advances, so battle after battle replays one sequence of hit,
    // crit, skill, AI and growth rolls.
    const rm = newRun(4242);
    const first = enterBattle(rm, 'act1_0_1');
    settle(rm);
    const second = enterBattle(rm, 'act1_1_2');
    expect(second.rngSeed).not.toBe(first.rngSeed);
    expect(second.draws).not.toEqual(first.draws);
    // Neither battle opens on the run seed's own stream.
    expect([first.rngSeed, second.rngSeed]).not.toContain(4242);
  });

  it('a third battle after two differs from both, and no two nodes of an act share a stream', () => {
    // Failure: a seed that varies with something coarser than the node (the act, the row) or
    // alternates between two values.
    const rm = newRun(31);
    const seen = new Map();
    for (const nodeId of ['act1_0_0', 'act1_0_1', 'act1_1_0', 'act1_2_3', 'act1_8_0']) {
      const battle = enterBattle(rm, nodeId, { draws: 3 });
      settle(rm);
      seen.set(nodeId, battle);
    }
    const seeds = [...seen.values()].map((b) => b.rngSeed);
    expect(new Set(seeds).size).toBe(seeds.length);
    const firstDraws = [...seen.values()].map((b) => b.draws[0]);
    expect(new Set(firstDraws).size).toBe(firstDraws.length);
  });

  it('the same node of two runs with the same seed opens on the same stream (determinism)', () => {
    // Failure: a fresh seed drawn from Math.random or the clock, so a seed cannot replay a run.
    const a = newRun(9001);
    const b = newRun(9001);
    enterBattle(a, 'act1_0_0');
    settle(a);
    enterBattle(b, 'act1_0_0');
    settle(b);
    const fromA = enterBattle(a, 'act1_1_1');
    const fromB = enterBattle(b, 'act1_1_1');
    expect(fromB.rngSeed).toBe(fromA.rngSeed);
    expect(fromB.draws).toEqual(fromA.draws);
    // ...and a different run seed gives that node a different stream.
    const other = newRun(9002);
    expect(enterBattle(other, 'act1_1_1').rngSeed).not.toBe(fromA.rngSeed);
  });

  it('the seed is written before the entry flag records it, and is the seed rewinds key on', () => {
    // Failure: the flag records the run's previous seed (install after beginBattleInProgress),
    // so Continue from Map refunds a seed that is not this battle's; or the Vision base seed
    // (hashRewindSeed's input, the reinforcement fallback) disagrees with the stream.
    const rm = newRun(77);
    enterBattle(rm, 'act1_0_0');
    settle(rm);
    const battle = enterBattle(rm, 'act1_1_0');
    expect(battle.entrySeed).toBe(battle.rngSeed);
    expect(battle.visionBaseSeed).toBe(battle.rngSeed);
    expect(battle.rngSeed).toBe(
      deriveBattleStreamSeed(77, { act: 'act1', nodeId: 'act1_1_0' }) >>> 0,
    );
  });

  it('equal node ids in two acts get different streams', () => {
    // Failure: a key of the node id alone, should two acts' maps ever share an id.
    expect(deriveBattleStreamSeed(5, { act: 'act1', nodeId: 'n_0_0' })).not.toBe(
      deriveBattleStreamSeed(5, { act: 'act2', nodeId: 'n_0_0' }),
    );
  });

  it("the stream never repeats the node's fallback map-generation seed", () => {
    // Failure: seeding the stream with deriveNodeBattleSeed(runSeed, nodeId), the seed a node
    // without its own battleSeed generates its map from, so the battle opens on the draws that
    // laid out its map.
    expect(deriveBattleStreamSeed(5, { act: 'act1', nodeId: 'act1_0_0' })).not.toBe(
      deriveNodeBattleSeed(5, 'act1_0_0'),
    );
  });

  it('a mid-battle reseed (a legacy rewind) never leaks into the next battle', () => {
    // Failure: the next battle opens on whatever `rngSeed` the last one left (a legacy-v1
    // rewind writes hashRewindSeed to the run, and a victory refunds nothing).
    const rm = newRun(4242);
    const clean = newRun(4242);
    enterBattle(rm, 'act1_0_0');
    rm.rngSeed = hashRewindSeed(rm.rngSeed, 1);
    settle(rm);
    enterBattle(clean, 'act1_0_0');
    settle(clean);
    expect(enterBattle(rm, 'act1_1_0').draws).toEqual(enterBattle(clean, 'act1_1_0').draws);
  });
});

describe('the battle stream across a revert and a resume', () => {
  it('Continue from Map refunds the entry seed, and re-entering the node replays its first stream', () => {
    // Failure: the revert's RNG refund no longer holds (the re-entry draws a new stream, so
    // Continue from Map becomes a free reroll of the battle).
    const rm = newRun(4242);
    enterBattle(rm, 'act1_0_0');
    settle(rm);
    const first = enterBattle(rm, 'act1_1_1');
    // Mid-battle: a legacy rewind reseeds the run.
    rm.rngSeed = hashRewindSeed(first.rngSeed, 3);
    expect(rm.revertBattleInProgressToEntry()).toBe(true);
    expect(rm.battleInProgress).toBeNull();
    expect(rm.rngSeed).toBe(first.entrySeed);
    const again = enterBattle(rm, 'act1_1_1');
    expect(again.entrySeed).toBe(first.entrySeed);
    expect(again.draws).toEqual(first.draws);
  });

  it('after Continue from Map, a different node still gets its own stream', () => {
    // Failure: the refunded seed becomes the next battle's, wherever the party walks.
    const rm = newRun(4242);
    const first = enterBattle(rm, 'act1_1_1');
    expect(rm.revertBattleInProgressToEntry()).toBe(true);
    const elsewhere = enterBattle(rm, 'act1_1_2');
    expect(elsewhere.rngSeed).not.toBe(first.rngSeed);
    expect(elsewhere.draws).not.toEqual(first.draws);
  });

  it('a resume continues the suspended stream from its cursor, across a save', () => {
    // Failure: the resume path re-derives a fresh stream (or writes the fresh seed over the
    // saved one), so a refresh rerolls what follows the checkpoint.
    const rm = newRun(4242);
    enterBattle(rm, 'act1_0_0');
    settle(rm);
    const deployed = rm.roster.map((u) => structuredClone(u));
    const live = makeScene({ runManager: rm, nodeId: 'act1_1_1', deployed });
    BattleScene.prototype.beginBattle.call(live, deployed);
    let checkpoint;
    let liveAfter;
    try {
      for (let i = 0; i < 5; i++) Math.random();
      // A legacy-v1 battle's checkpoint reseeds the run: the resume must keep that seed.
      checkpoint = JSON.parse(
        JSON.stringify({
          playerUnits: live.playerUnits,
          enemyUnits: [],
          npcUnits: [],
          escapedUnits: [],
          nonDeployedUnits: [],
          nextEntityId: 100,
          turnNumber: 1,
          phase: 'player',
          rngSeed: rm.rngSeed,
          rngState: live._battleRng.getState(),
          visionBaseSeed: live.visionBaseSeed,
        }),
      );
      liveAfter = Array.from({ length: 4 }, () => Math.random());
    } finally {
      live._battleRandomRestore?.();
    }
    rm.setBattleCheckpoint(checkpoint);
    const saved = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), gameData);
    saved.rngSeed = hashRewindSeed(checkpoint.rngSeed, 9); // a legacy reseed the save holds

    const resumed = makeScene({
      runManager: saved,
      nodeId: 'act1_1_1',
      deployed: null,
      resumeCheckpoint: saved.battleInProgress.checkpoint,
    });
    BattleScene.prototype.beginBattle.call(resumed, null);
    try {
      // The resume opens on the run's saved seed, never a fresh one.
      expect(saved.rngSeed).toBe(hashRewindSeed(checkpoint.rngSeed, 9));
      resumed.turnManager ||= {};
      resumed.grid ||= { fogEnabled: false };
      resumed.turnPar = null;
      resumed.getTurnPressureSummary = vi.fn(() => '');
      new BattleSuspendController(resumed).finalizeResume(saved.battleInProgress.checkpoint);
      expect(saved.rngSeed).toBe(checkpoint.rngSeed);
      expect(Array.from({ length: 4 }, () => Math.random())).toEqual(liveAfter);
    } finally {
      resumed._battleRandomRestore?.();
    }
  });
});

describe('the prologue run: one stream per chapter', () => {
  it("each chapter opens on its own node's stream, the same for every player", () => {
    // Failure: every chapter of every player's prologue opens on the fixed prologue seed's one
    // stream (rngSeed = prologue.seed for the whole run).
    const prologue = gameData.prologue;
    const chapterNodes = prologue.route.nodes.filter((n) => n.chapter).map((n) => n.id);
    expect(chapterNodes.length).toBeGreaterThanOrEqual(4);
    const seedsFor = () => {
      const rm = new RunManager(gameData, null);
      rm.startPrologue(gameData);
      return chapterNodes.map((nodeId) => {
        const node = rm.nodeMap.nodes.find((n) => n.id === nodeId);
        const scene = new BattleScene();
        scene.runManager = rm;
        scene.nodeId = nodeId;
        scene.battleParams = structuredClone(node.battleParams);
        scene._resumeCheckpoint = null;
        scene.add = { text: vi.fn() };
        scene.initializeVisionState();
        scene.installBattleRng();
        try {
          return { seed: rm.rngSeed, first: Math.random() };
        } finally {
          scene._battleRandomRestore?.();
        }
      });
    };
    const one = seedsFor();
    expect(new Set(one.map((c) => c.seed)).size).toBe(chapterNodes.length);
    expect(new Set(one.map((c) => c.first)).size).toBe(chapterNodes.length);
    expect(one.map((c) => c.seed)).not.toContain(prologue.seed >>> 0);
    expect(seedsFor()).toEqual(one);
  });
});
