// Enemy-phase resume across real effects (docs/specs/large-maps/02-encounters-and-pacing.md
// §2.5; engine/EnemyTurnOutcome.js): skipping the idle enemies' checkpoints must not change
// where a refresh lands, all the way from End Turn to the next player turn's checkpoint.
//
// Realistic ways this can fail, one assertion family each:
//   - an idle enemy's skipped checkpoint leaves a resume replaying a turn the live phase
//     already resolved, or skipping one it did not (hasActed lost or doubled);
//   - real combat draws the battle stream in a different place on a resume than live, so
//     the RNG cursor, HP or the defender's EXP diverge;
//   - the phase-end effects (lava on idle enemies, a lava-woken sleeper, a scripted
//     reinforcement whose stats are rolled on the battle stream) apply twice, never, or
//     on a different stream position after a resume;
//   - the turn hand-off (real TurnManager, the player turn-start pipeline) writes a
//     different turn_start checkpoint than the uninterrupted phase did;
//   - any of the above under either rewind policy (fixed-v1 reseeds at each checkpoint,
//     legacy-v1 carries the stream).
//
// Real here: the run and its save slot, the suspend controller (checkpoint, restore,
// finalizeResume), the timeline, TurnManager, BattleScene.onPhaseChange (both branches),
// startEnemyPhase, AIController's decisions on the harness grid (HeadlessGrid: Grid.js's
// own movement, path and range code), animateEnemyMove's path and position update,
// executeEnemyCombat with Combat.js and the battle XP, processTerrainDamage,
// applyReinforcementsForTurn (the scheduler, the spawn builder, the enemy factory), the
// turn-pressure clock, checkBattleEnd, processTurnStartEffects, the Vision snapshot and the
// turn_start checkpoint. Math.random is the battle stream, as in a battle.
// Faked: drawing only (tweens, strike and skill animations, terrain-damage floats,
// banners, the reinforcement band, the phase banner, the turn counter, danger and HUD
// refreshes, condition icons) and the scene clock: scheduled callbacks run in order from a
// queue (as resumeFrom does in tests/EnemyPhasePacing.test.js), so the 1.2 s / 1.4 s
// turn-start delays take no time. Fog is off (fogged pacing is EnemyPhasePacing.test.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { AIController } from '../src/engine/AIController.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { loadRun } from '../src/engine/RunManager.js';
import { TERRAIN, LAVA_CRACK_DAMAGE } from '../src/utils/constants.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

const data = loadGameData();
const RUN_KEY = 'emblem_rogue_slot_1_run';
const SIZE = 10;
const ENEMY_TURN = 3;
const LAVA = [
  { col: 8, row: 8 },
  { col: 8, row: 9 },
];
const WAVE_TILE = { col: 5, row: 9 };

let storage;
let realRandom;
let liveScene = null;

beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  realRandom = Math.random;
});
afterEach(() => {
  Math.random = realRandom;
  liveScene = null;
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** During a battle Math.random IS the battle RNG (BattleScene.reseedBattleRng). */
function bindBattleRandom() {
  Math.random = () => liveScene._battleRng();
}

const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

function mapLayout() {
  const layout = Array.from({ length: SIZE }, () => Array(SIZE).fill(TERRAIN.Plain));
  for (const { col, row } of LAVA) layout[row][col] = TERRAIN.LavaCrack;
  return layout;
}

/**
 * The journey scene with the real enemy-phase lifecycle. Returns the scene and its queue of
 * scheduled callbacks (the scene clock): `drain()` runs them in order.
 */
function lifecycleScene(run) {
  const scene = journeyBattleScene(run, data);
  liveScene = scene;
  scene._battleSession = 1;
  scene.scene = { isActive: () => true };
  const layout = mapLayout();
  // The harness grid (Grid.js's own movement, path and range code), fog off, with the
  // fixture grid's drawing no-ops.
  const fixtureGrid = scene.grid;
  scene.grid = Object.assign(new HeadlessGrid(SIZE, SIZE, data.terrain, layout, false), {
    temporaryTerrains: [],
    fogOverlays: [],
    gridToPixel: fixtureGrid.gridToPixel,
    clearAttackHighlights: fixtureGrid.clearAttackHighlights,
    clearHighlights: fixtureGrid.clearHighlights,
    clearPath: fixtureGrid.clearPath,
  });
  scene.battleConfig = {
    objective: 'rout',
    mapLayout: layout,
    reinforcements: {
      scriptedWaves: [
        {
          turn: ENEMY_TURN,
          spawns: [{ ...WAVE_TILE, className: 'Fighter', level: 3 }],
        },
      ],
    },
  };
  scene.battleParams = { act: 'act1', objective: 'rout', difficultyId: 'normal' };
  scene.turnPar = 8;
  scene.isDevToolsEnabled = () => false;
  scene.aiPhaseStatsHistory = []; // as create() sets it
  // The fixture's stand-in; the scene's own rout check runs here.
  delete scene.checkBattleEnd;
  // Drawing only.
  scene.showBriefBanner = async () => {};
  scene.showPhaseBanner = () => {};
  scene.renderTurnCounter = () => {};
  scene.undimUnit = () => {};
  scene.dangerZone = { hide() {}, show() {} };
  scene._awaitSceneTween = async () => {};
  scene.animateStrike = async () => {};
  scene.animateSkillActivation = async () => {};
  scene.animateHeal = async () => {};
  scene.showTerrainDamage = async () => {};
  scene.showMarkProc = () => {};
  scene._addConditionIcon = () => {};
  scene._removeConditionIcon = () => {};
  scene._reinforcements = { present() {} };
  scene.refreshVisibleDangerZone = () => {};
  scene.time = { delayedCall: () => null };
  // The scene clock: every scheduled callback waits in a queue.
  const queue = [];
  scene._scheduleSafeDelayedAsync = (_ms, label, callback) => {
    queue.push({ label, callback });
    return { label };
  };
  scene.drain = async () => {
    const labels = [];
    while (queue.length) {
      const { label, callback } = queue.shift();
      labels.push(label);
      await callback();
    }
    return labels;
  };
  const tm = new TurnManager({
    onPhaseChange: (phase, turn) => scene.onPhaseChange(phase, turn),
    onVictory: () => {},
    onDefeat: () => {},
    checkBattleEnd: () => scene.checkBattleEnd(),
  });
  tm.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits, 'rout');
  scene.turnManager = tm;
  scene.aiController = new AIController(scene.grid, data, { objective: 'rout' });
  return scene;
}

function foe(name, extra = {}) {
  const unit = {
    name,
    className: 'Fighter',
    faction: 'enemy',
    level: 3,
    currentHP: 24,
    stats: { HP: 24, STR: 6, MAG: 0, SKL: 4, SPD: 4, DEF: 3, RES: 0, LCK: 1, MOV: 5 },
    weapon: weapon('Iron Axe'),
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    moveType: 'Infantry',
    consumables: [],
    skills: [],
    hasActed: false,
    ...extra,
  };
  unit.inventory = [unit.weapon];
  return unit;
}

/** End Turn on turn 3: Edric has acted; the enemy phase is next. */
function setupLive(policy) {
  installSeed(1234);
  const driver = new RunDriver(storage, { seed: 7 });
  const run = driver.run;
  run.beginBattleInProgress('lifecycle-battle', { act: 'act1', objective: 'rout' });
  run.battleInProgress.rewindPolicy = policy;
  const scene = lifecycleScene(run);
  scene._battleRewindPolicy = policy;
  const lord = structuredClone(run.roster[0]);
  Object.assign(lord, {
    col: 1,
    row: 1,
    faction: 'player',
    isCommander: true,
    currentHP: 60,
    hasActed: true,
  });
  lord.stats = { ...lord.stats, HP: 60 };
  scene.playerUnits.push(lord);
  scene.addUnitGraphic(lord);
  // In array order: an idle guard, the attacker, then two more enemies whose turns
  // resolve nothing (a holder and a sleeper, both standing on lava).
  const enemies = [
    foe('Sentry', { col: 9, row: 0, aiMode: 'guard', guardPost: { col: 9, row: 0 } }),
    // Three tiles from Edric: it walks in, then strikes.
    foe('Raider', { col: 4, row: 1 }),
    foe('Holder', {
      ...LAVA[0],
      aiMode: 'hold',
      holdPack: 0,
      holdPackSize: 1,
      holdPost: { ...LAVA[0] },
    }),
    foe('Sleeper', { ...LAVA[1], _conditions: [{ id: 'sleep', turnsRemaining: 3 }] }),
  ];
  for (const enemy of enemies) {
    scene.enemyUnits.push(enemy);
    scene.addUnitGraphic(enemy);
  }
  scene.turnManager.turnNumber = ENEMY_TURN;
  scene.turnManager.currentPhase = 'player';
  // As create() does: the turn-pressure clock the enemy phase advances.
  scene.initializeAntiTurtleState();
  scene._battleSuspendController = new BattleSuspendController(scene);
  scene._timelineBoundary = 'player_action';
  expect(scene._captureSuspendCheckpoint({ session: 1 })).toBe(true);
  bindBattleRandom();
  return { driver, run, scene };
}

const durableRuns = [];
function recordWrites() {
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    setItem(key, value);
    if (key === RUN_KEY) durableRuns.push(String(value));
  };
}

/**
 * Everything a resume must reproduce, with each unit's own uids left out. Under legacy-v1
 * the Vision snapshot's `decisionRngState` is left out too: a live legacy battle never sets
 * `_battleDecisionRngState` (only fixed-v1 checkpoints and rewinds do), so the next
 * snapshot records the live cursor, while finalizeResume sets it from the checkpoint it
 * resumed. That predates this PR, holds for any resume from End Turn, and feeds only the
 * combat roll session's cache key (the Gambler's Coin delta for one forecast/combat), never
 * a unit or the battle stream.
 */
function endState(scene, run) {
  const legacy = scene._battleRewindPolicy !== 'fixed-v1';
  const units = (list) =>
    list.map((u) => {
      const unit = serializeBattleUnit(u);
      delete unit.graphic;
      return unit;
    });
  const checkpoint = run.battleInProgress.checkpoint;
  const strip = (key, value) =>
    key === 'uid' ||
    key === 'checkpointIndex' ||
    key === 'savedAt' ||
    key === 'timestamp' ||
    (legacy && key === 'decisionRngState')
      ? undefined
      : value;
  return JSON.parse(
    JSON.stringify(
      {
        turn: scene.turnManager.turnNumber,
        phase: scene.turnManager.currentPhase,
        battleState: scene.battleState,
        turnPar: scene.turnPar,
        players: units(scene.playerUnits),
        enemies: units(scene.enemyUnits),
        rng: scene._battleRng.getState(),
        // The next player turn's checkpoint, as saved.
        checkpoint: {
          phase: checkpoint.phase,
          turnNumber: checkpoint.turnNumber,
          rngSeed: checkpoint.rngSeed,
          rngState: checkpoint.rngState,
          playerUnits: checkpoint.playerUnits,
          enemyUnits: checkpoint.enemyUnits,
          antiTurtleState: checkpoint.antiTurtleState,
          visionSnapshot: checkpoint.visionSnapshot,
        },
      },
      strip,
    ),
  );
}

/** From End Turn to the next player turn's checkpoint, uninterrupted. */
async function playLive(scene) {
  scene.turnManager.endPlayerPhase();
  return scene.drain();
}

async function resumeFrom(driver, raw) {
  storage.values.set(RUN_KEY, raw);
  const restored = loadRun(driver.data, 1);
  const scene = lifecycleScene(restored);
  scene._battleRewindPolicy = restored.battleInProgress.rewindPolicy;
  scene._battleTimeline = restored.battleInProgress.timeline;
  scene._timelineCurrentEntryId = restored.battleInProgress.timelineCurrentEntryId;
  const checkpoint = restored.battleInProgress.checkpoint;
  const resume = new BattleSuspendController(scene);
  scene._battleSuspendController = resume;
  resume.applyUnits(checkpoint);
  resume.finalizeResume(checkpoint);
  await scene.drain();
  return { scene, run: restored, checkpoint };
}

describe.each(['fixed-v1', 'legacy-v1'])(
  'enemy phase resume across real effects (%s)',
  (policy) => {
    beforeEach(() => {
      durableRuns.length = 0;
    });

    it('every durable write resumes to the uninterrupted next-turn checkpoint', async () => {
      const { driver, run, scene } = setupLive(policy);
      const endTurn = storage.getItem(RUN_KEY);
      const cursorAtEndTurn = scene._battleRng.getState();
      const lordHp = scene.playerUnits[0].currentHP;
      recordWrites();
      // Count the battle stream's draws in each part of the phase.
      const draws = { reinforcements: 0, total: 0 };
      const bound = Math.random;
      Math.random = () => {
        draws.total++;
        return bound();
      };
      const applyWave = scene.applyReinforcementsForTurn.bind(scene);
      scene.applyReinforcementsForTurn = (turn) => {
        const before = draws.total;
        const result = applyWave(turn);
        draws.reinforcements += draws.total - before;
        return result;
      };
      const errors = vi.spyOn(console, 'error');
      await playLive(scene);
      Math.random = bound;
      const live = endState(scene, run);

      // The uninterrupted phase did what this test is about.
      expect(live.turn).toBe(ENEMY_TURN + 1);
      expect(live.phase).toBe('player');
      expect(live.battleState).toBe('PLAYER_IDLE');
      expect(live.checkpoint).toMatchObject({ phase: 'player', turnNumber: ENEMY_TURN + 1 });
      const byName = Object.fromEntries(scene.enemyUnits.map((u) => [u.name, u]));
      // The Raider walked in (the harness grid's own pathing) and struck from beside Edric.
      expect(byName.Raider._lastAiDecision.path.length).toBeGreaterThan(1);
      expect(byName.Raider._lastAiDecision.target?.name).toBe(scene.playerUnits[0].name);
      expect(
        Math.abs(byName.Raider.col - 1) + Math.abs(byName.Raider.row - 1),
        'Raider beside Edric',
      ).toBe(1);
      for (const name of ['Holder', 'Sleeper', 'Sentry'])
        expect(byName[name]._lastAiDecision.reason, name).toMatch(/hold|asleep/);
      expect(errors).not.toHaveBeenCalled();
      // Real combat and the wave's stat rolls drew the battle stream.
      expect(draws.reinforcements).toBeGreaterThan(0);
      expect(draws.total).toBeGreaterThan(draws.reinforcements);
      expect(scene._battleRng.getState()).not.toEqual(cursorAtEndTurn);
      const lord = scene.playerUnits[0];
      expect(lord.currentHP !== lordHp || lord.xp > run.roster[0].xp).toBe(true);
      // Lava burned both idle enemies standing on it and woke the sleeper.
      expect(byName.Holder.currentHP).toBe(24 - LAVA_CRACK_DAMAGE);
      expect(byName.Sleeper.currentHP).toBe(24 - LAVA_CRACK_DAMAGE);
      expect(byName.Sleeper._conditions || []).toEqual([]);
      // The scripted wave arrived (its stats rolled on the battle stream).
      const arrivals = scene.enemyUnits.filter((u) => u._isReinforcement);
      expect(arrivals.map((u) => [u.className, u.col, u.row])).toEqual([
        ['Fighter', WAVE_TILE.col, WAVE_TILE.row],
      ]);
      // Durable writes: the Raider's action, then the next turn start. Nothing for the idle
      // Sentry, Holder or Sleeper.
      const phases = durableRuns.map((raw) => {
        const cp = JSON.parse(raw).battleInProgress.checkpoint;
        return `${cp.phase}:${cp.turnNumber}`;
      });
      expect(phases).toEqual([`enemy:${ENEMY_TURN}`, `player:${ENEMY_TURN + 1}`]);
      const afterRaider = JSON.parse(durableRuns[0]).battleInProgress.checkpoint.enemyUnits;
      // It holds the idle Sentry before the Raider as acted, the idle two after it as not.
      expect(afterRaider.map((u) => [u.name, u.hasActed])).toEqual([
        ['Sentry', true],
        ['Raider', true],
        ['Holder', false],
        ['Sleeper', false],
      ]);

      // A crash at End Turn, or after the Raider's write, resumes to the same next turn.
      for (const [index, raw] of [endTurn, durableRuns[0]].entries()) {
        const resumed = await resumeFrom(driver, raw);
        expect(resumed.checkpoint.phase, `save ${index}`).toBe(index === 0 ? 'player' : 'enemy');
        expect(endState(resumed.scene, resumed.run), `resume from save ${index}`).toEqual(live);
      }
    });
  },
);
