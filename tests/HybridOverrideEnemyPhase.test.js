// A deferred arena wall across the enemy phase's idle skip, resume and Vision rewind
// (#257 × #259: engine/TerrainPhases.js deferral, engine/EnemyTurnOutcome.js idle skip).
//
// The board: a 10 × 10 reduction of an old-locked bastion (a map locked before PR 0b, its
// turn-2 wave spawning on the anchors the turn-3 walls rise on). A guard Fighter lands on
// `wave1_a` at the end of enemy phase 2; enemy phase 3 starts with the walls due, so
// `wave1_b` walls and `wave1_a` waits under the guard (pendingHybridOverrideTiles), who
// idles there (guard_hold). Two holders idle every phase; a far guard idles until the
// anti-turtle clock sends it on turn 4. On turn 4 Edric steps within the anchor guard's
// reach, the guard leaves the anchor to strike him (the retry at that phase's start has
// re-deferred the tile), and enemy phase 5 starts with the retry that walls it. Live, End
// Turn on 2 runs to the turn-6 player checkpoint.
//
// Realistic ways this can fail, one assertion family each:
//   - a checkpoint (suspend or timeline entry) loses the pending tile, so a resume or a
//     rewind after the deferral never walls the anchor;
//   - the override runs somewhere a resume re-enters differently from live (inside the
//     enemy loop, ahead of the idle skip, or in startEnemyPhase, which a resume calls
//     with `resume: true` and never the turn-start pipeline), so the wall rises a phase
//     early on a resumed branch and a later checkpoint disagrees with live;
//   - an idle holder's turn writes a checkpoint or a timeline row (the #259 skip), or an
//     acting enemy's does not;
//   - a resume lands on a different RNG cursor than live (the wave's stat rolls and every
//     strike draw the battle stream), under either rewind policy; a fixed-v1 rewind does
//     too (a legacy-v1 rewind rerolls by design: there the board must still agree, and a
//     reload right after the rewind must reproduce the rewound branch, cursor included).
//
// Real here, as tests/EnemyPhaseLifecycle.test.js: the run and its save slot, the suspend
// controller, the timeline, the Vision rewind transaction (VisionRewindController
// .executeRewind: prepare, persist, apply), TurnManager, BattleScene.onPhaseChange,
// startEnemyPhase with its idle skip, AIController on the harness grid (HeadlessGrid: Grid
// .js's own movement code), executeEnemyCombat, applyReinforcementsForTurn,
// applyDueHybridOverridesForTurn (TerrainPhases), completeBattleAction for the player's
// turn. Faked: drawing and the scene clock (scheduled callbacks run in order from a queue).
//
// Why not the shipped bastion itself: tests/harness/HybridArenaWaves.test.js plays the
// real old-locked bastion in HeadlessBattle, which has no suspend, timeline or rewind. This
// board keeps exactly the pieces that meet here (an anchor-named override with a free half,
// a wave guard on the anchor, idle holders, acting enemies writing checkpoints around them)
// on the real scene lifecycle, small enough to resume from every durable write.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { AIController } from '../src/engine/AIController.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import {
  branchBattleTimeline,
  canRewindToEntry,
  getEntryState,
} from '../src/engine/BattleTimeline.js';
import { loadRun } from '../src/engine/RunManager.js';
import { TERRAIN } from '../src/utils/constants.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

const data = loadGameData();
const RUN_KEY = 'emblem_rogue_slot_1_run';
const SIZE = 10;
const START_TURN = 2; // End Turn on 2: the wave lands at the end of this enemy phase
const WALL_TURN = 3; // the walls are due as enemy phase 3 starts
const STEP_TURN = 4; // Edric steps within the guard's reach
const END_TURN = 6; // live ends at this player turn's checkpoint
const ANCHOR = { col: 7, row: 2 }; // wave1_a: the guard lands here
const FREE_ANCHOR = { col: 8, row: 5 }; // wave1_b: nobody on it, walls on time
const SENTRY_TILE = { col: 9, row: 9 };
const LORD_START = { col: 2, row: 1 };
const LORD_STEP = { col: 5, row: 1 }; // 3 tiles from the guard's post: it engages
const WALL = data.terrain.findIndex((t) => t.name === 'Wall');
const PLAIN = TERRAIN.Plain;

let storage;
let realRandom;
let liveScene = null;
let consoleError;
const writes = [];

beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  realRandom = Math.random;
  writes.length = 0;
  consoleError = vi.spyOn(console, 'error');
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    setItem(key, value);
    if (key === RUN_KEY) writes.push(String(value));
  };
});
afterEach(() => {
  // No branch (live, resumed or rewound) reported an error.
  expect(consoleError).not.toHaveBeenCalled();
  Math.random = realRandom;
  liveScene = null;
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** During a battle Math.random IS the battle RNG (BattleScene.reseedBattleRng). */
function bindBattleRandom(scene) {
  liveScene = scene;
  Math.random = () => liveScene._battleRng();
}

const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

function battleConfig() {
  return {
    objective: 'rout',
    mapLayout: Array.from({ length: SIZE }, () => Array(SIZE).fill(PLAIN)),
    // As the old-locked bastion: the wave's guard spawns on an anchor a wall is due on.
    hybridAnchors: { wave1_a: { ...ANCHOR }, wave1_b: { ...FREE_ANCHOR } },
    phaseTerrainOverrides: [
      {
        turn: WALL_TURN,
        setTiles: [
          { anchor: 'wave1_a', terrain: 'Wall' },
          { anchor: 'wave1_b', terrain: 'Wall' },
        ],
      },
    ],
    reinforcements: {
      scriptedWaves: [
        {
          turn: START_TURN,
          spawns: [
            { ...ANCHOR, className: 'Fighter', level: 3, aiMode: 'guard' },
            { ...SENTRY_TILE, className: 'Fighter', level: 3, aiMode: 'guard' },
          ],
        },
      ],
    },
  };
}

/** The journey scene with the real enemy-phase lifecycle and a queued scene clock. */
function lifecycleScene(run) {
  const scene = journeyBattleScene(run, data);
  bindBattleRandom(scene);
  scene._battleSession = 1;
  scene.scene = { isActive: () => true };
  scene.battleConfig = battleConfig();
  const fixtureGrid = scene.grid;
  scene.grid = Object.assign(
    new HeadlessGrid(SIZE, SIZE, data.terrain, structuredClone(scene.battleConfig.mapLayout)),
    {
      temporaryTerrains: [],
      fogOverlays: [],
      gridToPixel: fixtureGrid.gridToPixel,
      clearAttackHighlights: fixtureGrid.clearAttackHighlights,
      clearHighlights: fixtureGrid.clearHighlights,
      clearPath: fixtureGrid.clearPath,
    },
  );
  scene.battleParams = { act: 'act1', objective: 'rout', difficultyId: 'normal' };
  scene.turnPar = 12;
  scene.isDevToolsEnabled = () => false;
  scene.aiPhaseStatsHistory = [];
  delete scene.checkBattleEnd; // the scene's own rout check
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
  const queue = [];
  scene._scheduleSafeDelayedAsync = (_ms, label, callback) => {
    queue.push({ label, callback });
    return { label };
  };
  scene.drain = async () => {
    while (queue.length) await queue.shift().callback();
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
  // Every enemy decision as the scene records it, by turn.
  scene.decisions = [];
  const record = scene.recordEnemyAiDecision.bind(scene);
  scene.recordEnemyAiDecision = (enemy, decision) => {
    scene.decisions.push({
      turn: scene.turnManager.turnNumber,
      id: enemy.battleEntityId,
      name: enemy.name,
      at: [enemy.col, enemy.row],
      reason: decision.reason,
      // Read here, independently of engine/EnemyTurnOutcome.js: a move or a strike.
      acts: Boolean(decision.target) || (decision.path?.length ?? 0) >= 2,
    });
    return record(enemy, decision);
  };
  scene._visionController = new VisionRewindController(scene, run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  vi.spyOn(scene._visionController, 'showDialog').mockImplementation(() => {});
  return scene;
}

function foe(name, extra = {}) {
  const unit = {
    name,
    className: 'Fighter',
    faction: 'enemy',
    level: 3,
    currentHP: 60,
    stats: { HP: 60, STR: 6, MAG: 0, SKL: 4, SPD: 4, DEF: 3, RES: 0, LCK: 1, MOV: 5 },
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

const holder = (name, col, row) =>
  foe(name, {
    col,
    row,
    aiMode: 'hold',
    holdPack: 0,
    holdPackSize: 2,
    holdPost: { col, row },
  });

/** End Turn on turn 2: Edric has acted; the enemy phase that lands the wave is next. */
function setupLive(policy) {
  installSeed(1234);
  const driver = new RunDriver(storage, { seed: 7 });
  const run = driver.run;
  run.visionChargesRemaining = 3;
  run.beginBattleInProgress('arena-battle', { act: 'act1', objective: 'rout' });
  run.battleInProgress.rewindPolicy = policy;
  const scene = lifecycleScene(run);
  scene._battleRewindPolicy = policy;
  const lord = structuredClone(run.roster[0]);
  Object.assign(lord, { ...LORD_START, faction: 'player', isCommander: true, hasActed: true });
  // Unarmed and sturdy: he never counters and never falls, so nobody leaves the board and
  // a legacy-v1 rewind (which rerolls the dice) still reaches the same positions.
  lord.weapon = null;
  lord.inventory = [];
  lord.stats = { ...lord.stats, HP: 80, DEF: 14 };
  lord.currentHP = 80;
  scene.playerUnits.push(lord);
  scene.addUnitGraphic(lord);
  scene._battleCommanderId = lord.battleEntityId;
  // In array order: an idle holder, the Raider (beside Edric: it strikes every phase and
  // writes a checkpoint), a second idle holder. The wave appends the guard on wave1_a and
  // a far guard after them, so on turn 4 an enemy still acts after the anchor guard's write.
  for (const enemy of [
    holder('Holder', 0, 9),
    foe('Raider', { col: LORD_START.col, row: LORD_START.row + 1 }),
    holder('Keeper', 1, 9),
  ]) {
    scene.enemyUnits.push(enemy);
    scene.addUnitGraphic(enemy);
  }
  scene.turnManager.turnNumber = START_TURN;
  scene.turnManager.currentPhase = 'player';
  scene.initializeAntiTurtleState();
  scene._battleSuspendController = new BattleSuspendController(scene);
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'player_action';
  expect(scene._captureSuspendCheckpoint({ session: 1 })).toBe(true);
  return { driver, run, scene };
}

/** The player's turn: Edric steps within the guard's reach on STEP_TURN, else waits. */
function playerTurn(scene) {
  const lord = scene.playerUnits[0];
  if (scene.turnManager.turnNumber === STEP_TURN) {
    Object.assign(lord, LORD_STEP);
    lord.hasMoved = true;
  }
  expect(completeBattleAction(scene, lord, { session: 1 })).toBe(true);
}

/** From wherever the scene stands to END_TURN's player checkpoint. */
async function playOn(scene) {
  await scene.drain();
  while (scene.turnManager.turnNumber < END_TURN) {
    expect(scene.turnManager.currentPhase).toBe('player');
    expect(scene.battleState).toBe('PLAYER_IDLE');
    playerTurn(scene);
    await scene.drain();
  }
}

async function playLive(scene) {
  scene.turnManager.endPlayerPhase();
  await playOn(scene);
}

async function resumeFrom(driver, raw) {
  storage.values.set(RUN_KEY, raw);
  const restored = loadRun(driver.data, 1);
  const scene = lifecycleScene(restored);
  scene._battleRewindPolicy = restored.battleInProgress.rewindPolicy;
  scene._battleTimeline = restored.battleInProgress.timeline;
  scene._timelineCurrentEntryId = restored.battleInProgress.timelineCurrentEntryId;
  scene._battleCommanderId = restored.battleInProgress.checkpoint.commanderEntityId;
  const resume = new BattleSuspendController(scene);
  scene._battleSuspendController = resume;
  resume.applyUnits(restored.battleInProgress.checkpoint);
  resume.finalizeResume(restored.battleInProgress.checkpoint);
  await playOn(scene);
  return { scene, run: restored };
}

/** Rewind (the picker's own call) to the player checkpoint `phase:turn` of the timeline. */
function rewindTo(scene, turn) {
  const history = scene._battleTimeline;
  const rules = { difficulty: 'normal', allowPlayerActions: true };
  const entry = history.entries.find(
    (e) =>
      e.phase === 'player' &&
      e.turnNumber === turn &&
      canRewindToEntry(history, e.id, rules) &&
      getEntryState(history, e.id).playerUnits.every((u) => !u.hasActed),
  );
  expect(entry, `a turn-${turn} start to rewind to`).toBeTruthy();
  const target = getEntryState(history, entry.id);
  const branch = branchBattleTimeline(history, entry.id);
  const intent = scene._visionController.createRewindIntent(target);
  expect(scene._visionController.executeRewind(target, branch, intent)).toBe(true);
  return target;
}

const tileAt = (layout, { col, row }) => layout[row][col];

/** The board the reviewer asked about: anchor terrain, the pending list, who stands where. */
function board(state) {
  return {
    turn: state.turnNumber,
    phase: state.phase,
    anchor: tileAt(state.mapLayout, ANCHOR),
    freeAnchor: tileAt(state.mapLayout, FREE_ANCHOR),
    pending: state.pendingHybridOverrideTiles,
    appliedTurns: state.appliedHybridOverrideTurns,
    units: [...state.playerUnits, ...state.enemyUnits].map((u) => [
      u.name,
      u.col,
      u.row,
      u.hasActed === true,
    ]),
  };
}

const liveBoard = (scene) =>
  board({
    turnNumber: scene.turnManager.turnNumber,
    phase: scene.turnManager.currentPhase,
    mapLayout: scene.grid.mapLayout,
    pendingHybridOverrideTiles: scene.pendingHybridOverrideTiles,
    appliedHybridOverrideTurns: [...scene.appliedHybridOverrideTurns],
    playerUnits: scene.playerUnits,
    enemyUnits: scene.enemyUnits,
  });

/** A durable write's checkpoint as a resume reads it, run-local ids and counters left out. */
function checkpointOf(raw, { legacy }) {
  const checkpoint = JSON.parse(raw).battleInProgress.checkpoint;
  return JSON.parse(
    JSON.stringify(checkpoint, (key, value) =>
      key === 'uid' ||
      key === 'checkpointIndex' ||
      key === 'savedAt' ||
      key === 'timestamp' ||
      // Legacy battles never set the live decision key between checkpoints (see
      // tests/EnemyPhaseLifecycle.test.js endState); it feeds no unit or stream.
      (legacy && key === 'decisionRngState')
        ? undefined
        : value,
    ),
  );
}

/** Everything a resume or a rewind must reproduce at END_TURN. */
function endState(scene) {
  const units = (list) =>
    list.map((u) => {
      const unit = serializeBattleUnit(u);
      delete unit.graphic;
      return unit;
    });
  return JSON.parse(
    JSON.stringify(
      {
        board: liveBoard(scene),
        battleState: scene.battleState,
        players: units(scene.playerUnits),
        enemies: units(scene.enemyUnits),
        rng: scene._battleRng.getState(),
      },
      // Item uids count up per process (as in tests/EnemyPhaseLifecycle.test.js).
      (key, value) => (key === 'uid' ? undefined : value),
    ),
  );
}

describe.each(['fixed-v1', 'legacy-v1'])(
  'a deferred arena wall across idle enemy turns (%s)',
  (policy) => {
    const legacy = policy === 'legacy-v1';

    async function live() {
      const setup = setupLive(policy);
      const endTurnSave = storage.getItem(RUN_KEY);
      writes.length = 0;
      await playLive(setup.scene);
      return { ...setup, saves: [endTurnSave, ...writes.splice(0)] };
    }

    it('defers the wall under the guard, skips the idle turns, raises it once he leaves', async () => {
      const { scene, saves } = await live();
      const boards = saves.map((raw) => board(checkpointOf(raw, { legacy })));
      const labels = boards.map((b) => `${b.phase}:${b.turn}`);
      // Durable writes: per enemy phase only the turns that did something, and each player
      // turn's start and action. The holders never write one; the guards idle (guard_hold)
      // until Edric's step (the anchor's guard) or the anti-turtle clock (turn 4, the far
      // one: guards answer it, holders never do) sends them.
      expect(labels).toEqual([
        'player:2', // End Turn (setup)
        'enemy:2', // Raider
        'player:3',
        'player:3', // Edric waits
        'enemy:3', // Raider (the guard on wave1_a idles: guard_hold)
        'player:4',
        'player:4', // Edric steps in
        'enemy:4', // Raider
        'enemy:4', // the guard leaves wave1_a to strike
        'enemy:4', // the far guard
        'player:5',
        'player:5',
        'enemy:5', // Raider
        'enemy:5', // guard
        'enemy:5', // far guard
        'player:6',
      ]);
      const at = (label, n = 0) => boards.filter((b) => `${b.phase}:${b.turn}` === label)[n];
      const pendingAnchor = [{ turn: WALL_TURN, ...ANCHOR, terrain: 'Wall' }];
      // Before the walls are due: nothing waits; the guard landed on wave1_a with the wave.
      expect(at('player:3')).toMatchObject({ anchor: PLAIN, freeAnchor: PLAIN, pending: [] });
      expect(at('player:3').units).toContainEqual(['Fighter', ANCHOR.col, ANCHOR.row, false]);
      // Enemy phase 3 walls the free anchor and defers the guard's.
      for (const b of [at('enemy:3'), at('player:4'), at('player:4', 1), at('enemy:4')]) {
        expect(b, `${b.phase}:${b.turn}`).toMatchObject({
          anchor: PLAIN,
          freeAnchor: WALL,
          pending: pendingAnchor,
          appliedTurns: [WALL_TURN],
        });
      }
      // The guard is still on wave1_a when enemy phase 4 starts (the retry re-defers it);
      // the first enemy:4 write is the Raider's, before the guard moves.
      expect(at('enemy:4').units).toContainEqual(['Fighter', ANCHOR.col, ANCHOR.row, false]);
      // He leaves during enemy phase 4: the anchor is empty but still waits, through the
      // turn-5 player checkpoints (the wall rises only at an enemy-phase start).
      const left = at('enemy:4', 1);
      expect(left.units.some(([, col, row]) => col === ANCHOR.col && row === ANCHOR.row)).toBe(
        false,
      );
      for (const b of [left, at('player:5'), at('player:5', 1)])
        expect(b, `${b.phase}:${b.turn}`).toMatchObject({ anchor: PLAIN, pending: pendingAnchor });
      // Enemy phase 5 starts with the retry: wave1_a walls, nothing waits.
      for (const b of [at('enemy:5'), at('player:6')])
        expect(b, `${b.phase}:${b.turn}`).toMatchObject({
          anchor: WALL,
          freeAnchor: WALL,
          pending: [],
        });
      expect(liveBoard(scene)).toMatchObject({ anchor: WALL, pending: [] });

      // The decisions behind the skip. The holders idle every phase; the anchor's guard
      // idles on turn 3 standing on it, then strikes.
      const decided = (turn, test) => scene.decisions.filter((d) => d.turn === turn && test(d));
      for (let turn = START_TURN; turn < END_TURN; turn++)
        for (const name of ['Holder', 'Keeper'])
          expect(
            decided(turn, (d) => d.name === name),
            `${name} T${turn}`,
          ).toMatchObject([{ reason: 'hold', acts: false }]);
      const guard = decided(WALL_TURN, (d) => d.at[0] === ANCHOR.col && d.at[1] === ANCHOR.row);
      expect(guard).toMatchObject([{ name: 'Fighter', reason: 'guard_hold', acts: false }]);
      expect(decided(STEP_TURN, (d) => d.id === guard[0].id)).toMatchObject([{ acts: true }]);
      // One durable write and one timeline row per acting enemy, none for an idle one.
      // (The timeline still holds turns 3 on.)
      for (let turn = START_TURN; turn < END_TURN; turn++) {
        const acting = decided(turn, (d) => d.acts).length;
        expect(acting, `acting enemies T${turn}`).toBeGreaterThan(0);
        expect(decided(turn, (d) => !d.acts).length, `idle enemies T${turn}`).toBeGreaterThan(0);
        expect(
          labels.filter((l) => l === `enemy:${turn}`),
          `writes T${turn}`,
        ).toHaveLength(acting);
        if (turn < WALL_TURN) continue;
        const rows = scene._battleTimeline.entries.filter(
          (e) => e.phase === 'enemy' && e.turnNumber === turn,
        );
        expect(rows, `enemy rows on turn ${turn}`).toHaveLength(acting);
      }
    });

    it('every durable write resumes to the uninterrupted board, checkpoints and RNG cursor', async () => {
      const { driver, scene, saves } = await live();
      const want = endState(scene);
      const liveCheckpoints = saves.map((raw) => checkpointOf(raw, { legacy }));
      for (const [index, raw] of saves.entries()) {
        const label = `resume from save ${index} (${liveCheckpoints[index].phase}:${liveCheckpoints[index].turnNumber})`;
        writes.length = 0;
        const resumed = await resumeFrom(driver, raw);
        // Every checkpoint the resumed branch writes is the one live wrote at that point.
        expect(
          writes.map((w) => checkpointOf(w, { legacy })),
          label,
        ).toEqual(liveCheckpoints.slice(index + 1));
        expect(endState(resumed.scene), label).toEqual(want);
      }
    });

    it.each([
      // From turn 4 back over the deferral (enemy phase 3 replays it).
      { from: STEP_TURN, to: WALL_TURN },
      // From turn 5 (guard gone, wall still waiting) back to the deferred anchor under him.
      { from: STEP_TURN + 1, to: STEP_TURN },
    ])(
      'a Vision rewind from turn $from to turn $to reaches the same board',
      async ({ from, to }) => {
        const { driver, scene: uninterrupted, saves } = await live();
        const want = endState(uninterrupted);
        // Live's writes after turn `to` started: what the rewound branch must write again.
        const liveCheckpoints = saves.map((raw) => checkpointOf(raw, { legacy }));
        const resumedAt = liveCheckpoints.findIndex(
          (cp) => cp.phase === 'player' && cp.turnNumber === to,
        );
        const liveAfter = liveCheckpoints.slice(resumedAt + 1);

        writes.length = 0;
        const setup = setupLive(policy);
        const { scene } = setup;
        // Play to turn `from`'s start, then rewind to turn `to`'s.
        scene.turnManager.endPlayerPhase();
        await scene.drain();
        while (scene.turnManager.turnNumber < from) {
          playerTurn(scene);
          await scene.drain();
        }
        const target = rewindTo(scene, to);
        expect(board(target).pending).toEqual(
          to > WALL_TURN ? [{ turn: WALL_TURN, ...ANCHOR, terrain: 'Wall' }] : [],
        );
        // The restored board is the target's (terrain, pending list, positions).
        expect(liveBoard(scene)).toEqual(board(target));
        const rewindSave = writes.at(-1);
        expect(checkpointOf(rewindSave, { legacy: true }).turnNumber).toBe(to);
        writes.length = 0;
        await playOn(scene);
        const rewound = endState(scene);
        const afterRewind = writes.map((w) => checkpointOf(w, { legacy }));

        if (legacy) {
          // legacy-v1 rerolls the stream at a rewind (hashRewindSeed): the same board at
          // every checkpoint and at the end; the dice may differ.
          expect(afterRewind.map(board)).toEqual(liveAfter.map(board));
          expect(rewound.board).toEqual(want.board);
        } else {
          // Every checkpoint in full, but for the Vision anchors themselves: a rewind installs
          // its target as the anchor (and drops the pending one) where live captured its own.
          const anchorsAside = (checkpoint) => {
            const rest = { ...checkpoint };
            delete rest.visionSnapshot;
            delete rest.pendingVisionSnapshot;
            return rest;
          };
          expect(afterRewind.map(anchorsAside)).toEqual(liveAfter.map(anchorsAside));
          expect(rewound).toEqual(want);
        }
        // A refresh right after the rewind resumes to exactly the rewound branch.
        writes.length = 0;
        const resumed = await resumeFrom(driver, rewindSave);
        // Known, older than #257 and #259, legacy-v1 only: the rewind saves the rerolled
        // seed as the run's `rngSeed` (BattleRewindTransaction) but executeRewind leaves the
        // live runManager's alone, so the next Vision snapshot's own `rngSeed` (the base of a
        // later legacy reroll, nothing else) differs between the live branch and a reload.
        const visionSeedAside = (checkpoint) => {
          if (!legacy) return checkpoint;
          for (const key of ['visionSnapshot', 'pendingVisionSnapshot'])
            if (checkpoint[key]) delete checkpoint[key].rngSeed;
          return checkpoint;
        };
        expect(writes.map((w) => visionSeedAside(checkpointOf(w, { legacy })))).toEqual(
          afterRewind.map(visionSeedAside),
        );
        expect(endState(resumed.scene)).toEqual(rewound);
      },
    );
  },
);
