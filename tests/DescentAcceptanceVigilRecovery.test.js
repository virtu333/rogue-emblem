// Acceptance, scenario 2 (recovery around the Vigil's chant and summons): a resume, a Vision
// rewind and Continue from Map, each across an enemy phase in which the Voices speak and the
// circles call, on the production BattleScene checkpoint, rewind and resume methods (the journey
// harness's rendering-only scene, as tests/RewindSteal.test.js) over the shipped Vigil's real
// board and a real Descent run. The phase step itself is the scene's own `processVigil` (the call
// the enemy-phase pipeline makes); the turn boundaries are the calls the player turn-start
// pipeline makes. Ways this breaks:
//   - a rewind to before the summons keeps a called Hollowed, or the words spoken after it
//   - the replayed phase (after a rewind, or from a checkpoint taken before it) calls other
//     units or says other words than the first time
//   - a resume after the phase loses or duplicates a Hollowed, its battle identity, the count,
//     or hands a later call an id a restored unit already holds
//   - Vision is not spent by the rewind, or spent twice; gold, the stream or the Rite drift
//   - Continue from Map leaves the battle's words in the run's Rite or keeps a spent charge
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import './harness/JourneyTestSetup.js';

const pickers = vi.hoisted(() => []);
vi.mock('../src/ui/VisionRewindPicker.js', () => ({
  VisionRewindPicker: class {
    constructor(scene, options) {
      this.options = options;
      pickers.push(this);
    }
    destroy() {}
  },
}));

import { JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { observeHistoryAction } from '../src/ui/BattleHistoryRecorder.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { RunManager, loadRun, saveRun } from '../src/engine/RunManager.js';
import { createVigilState } from '../src/engine/Vigil.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import {
  descentData,
  descentRun,
  nodeOf,
  winNode,
  playNode,
  strongArmy,
} from './harness/DescentAcceptanceKit.js';

const dialogue = JSON.parse(
  readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8'),
);

let storage;
beforeEach(() => {
  pickers.length = 0;
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(17);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const called = (units) => units.filter((u) => typeof u._summonedBy === 'string');
/** A unit as a checkpoint holds it, its identity apart (compared separately). */
const shape = (unit) => {
  const { battleEntityId: _id, isCommander, ...rest } = serializeBattleUnit(unit);
  // A resume stamps the flag on every unit (BattleSuspendController); only `true` means anything.
  return { ...rest, isCommander: isCommander === true };
};
const ids = (scene) =>
  [...scene.playerUnits, ...scene.enemyUnits].map((u) => u.battleEntityId).sort((a, b) => a - b);

/** A board for the scene on the locked config (fog off on the Vigil), with the journey hooks. */
function boardGrid(scene, config, data) {
  const terrain = new HeadlessGrid(config.cols, config.rows, data.terrain, config.mapLayout, false);
  Object.assign(scene.grid, {
    cols: config.cols,
    rows: config.rows,
    mapLayout: config.mapLayout,
    fogEnabled: false,
    visibleSet: new Set(),
    everSeenSet: new Set(),
    isVisible: () => true,
    getTerrainAt: (c, r) => terrain.getTerrainAt(c, r),
    getMoveCost: (c, r, moveType) => terrain.getTerrainAt(c, r)?.moveCost?.[moveType] ?? 99,
    tickTemporaryTerrains: () => {},
    clearTemporaryTerrainsBySource: () => {},
  });
}

/** What a scene says this phase: every floating line, by speaker. */
function recordSpeech(scene) {
  scene._battleBeats = { speakOver: vi.fn(), onKill: vi.fn(), onAllyFall: vi.fn() };
  scene.dialogueOverlay = { show: vi.fn(async () => {}) };
  scene.showBriefBanner = vi.fn(async () => {});
  scene._combatFx = { raise: vi.fn(async () => {}), deathFade: vi.fn(async () => {}) };
  scene.getUnitAt = (c, r) =>
    [...scene.playerUnits, ...scene.enemyUnits, ...scene.npcUnits].find(
      (u) => u.currentHP > 0 && !u._removing && u.col === c && u.row === r,
    ) || null;
}
const said = (scene) =>
  scene._battleBeats.speakOver.mock.calls.map(([unit, line]) => ({
    who: unit.authoredId || unit._summonedBy || unit.name,
    line,
  }));

/**
 * The Vigil battle in progress on a Descent run saved in slot 1: the map BattleScene generates and
 * locks at entry (the harness's own board for the units), on the journey scene.
 */
function vigilInProgress() {
  const rm = descentRun('hard', { runSeed: 17, words: 6 });
  winNode(rm, 'stair');
  winNode(rm, 'column', { turnCount: 30, turnPar: 12 });
  const node = nodeOf(rm, 'vigil');
  const army = strongArmy(rm, 1);
  const { b, params, battleConfig } = playNode(rm, node, army);
  rm.visionChargesRemaining = 3;
  rm.currentNodeId = node.id;
  rm.beginBattleInProgress(node.id, { battleParams: params, isElite: true });
  if (!saveRun(rm, null, 1).ok) throw new Error('fixture save failed');
  const data = rm.gameData;
  const scene = journeyBattleScene(rm, { ...data, dialogue });
  Object.assign(scene, {
    nodeId: node.id,
    battleParams: params,
    battleConfig,
    _vigilState: createVigilState(),
    _zombieTombstones: [],
    escapedUnits: [],
    nonDeployedUnits: [],
  });
  boardGrid(scene, battleConfig, data);
  recordSpeech(scene);
  // The harness's freshly built units, as the scene's beginBattle builds them on this map.
  scene.playerUnits = b.playerUnits.map((u) => structuredClone(serializeBattleUnit(u)));
  scene.enemyUnits = b.enemyUnits.map((u) => structuredClone(serializeBattleUnit(u)));
  for (const u of [...scene.playerUnits, ...scene.enemyUnits]) {
    delete u.battleEntityId;
    scene.addUnitGraphic(u);
  }
  scene.playerUnits[0].isCommander = true;
  scene._battleCommanderId = scene.playerUnits[0].battleEntityId;
  scene._visionController = new VisionRewindController(scene, rm);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  // Turn 1 begins (BattleScene's player turn-start pipeline: Vision anchor, then checkpoint).
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
  return { rm, node, scene, data };
}

/** One player action with a visible effect, completed as the scene completes it. */
function wait(scene, unit) {
  unit.hasMoved = true;
  observeHistoryAction(scene, 'waited', unit);
  completeBattleAction(scene, unit, { session: scene._battleSession });
  scene.battleState = 'PLAYER_IDLE';
}

/** The enemy phase's Vigil step (the scene's own), then the next player turn's boundary. */
async function enemyPhaseThenTurnStart(scene) {
  const turn = scene.turnManager.turnNumber;
  scene.turnManager.currentPhase = 'enemy';
  scene.battleState = 'ENEMY_PHASE';
  scene._battleBeats.speakOver.mockClear();
  await scene.processVigil();
  const spoken = said(scene);
  scene.turnManager.currentPhase = 'player';
  scene.turnManager.turnNumber = turn + 1;
  for (const u of scene.playerUnits) Object.assign(u, { hasActed: false, hasMoved: false });
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
  scene.battleState = 'PLAYER_IDLE';
  return spoken;
}

/** A fresh scene resumed from the run saved in slot 1 (as Resume Battle does). */
function resumeFromSlot(data) {
  const saved = JSON.parse(storage.getItem('emblem_rogue_slot_1_run'));
  const checkpoint = saved.battleInProgress.checkpoint;
  const run = RunManager.fromJSON(saved, descentData());
  const scene = journeyBattleScene(run, { ...data, dialogue });
  Object.assign(scene, {
    nodeId: saved.battleInProgress.nodeId,
    battleParams: saved.battleInProgress.battleParams,
    battleConfig: run.getLockedBattleConfig(saved.battleInProgress.nodeId),
    _vigilState: createVigilState(),
    _zombieTombstones: [],
    escapedUnits: [],
    nonDeployedUnits: [],
    _battleSession: 1,
    scene: { isActive: () => true },
    _addConditionIcon: () => {},
  });
  boardGrid(scene, scene.battleConfig, data);
  recordSpeech(scene);
  const suspend = new BattleSuspendController(scene);
  suspend.applyUnits(checkpoint);
  scene.turnManager = new TurnManager({ onPhaseChange: () => {}, checkBattleEnd: () => false });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits);
  suspend.finalizeResume(checkpoint);
  return { scene, run, checkpoint };
}

const rewindTo = (scene, pick) => {
  pickers.length = 0;
  expect(scene._visionController.requestRewind({ force: true })).toBe(true);
  const { rows } = pickers.at(-1).options.listing;
  const row = pick(rows);
  expect(row, rows.map((r) => r.title).join(' | ')).toBeTruthy();
  pickers.at(-1).options.onConfirm(row.id);
  scene.battleState = 'PLAYER_IDLE';
  return row;
};

describe('the Vigil across a rewind, a resume and Continue from Map', () => {
  it('a rewind across the summons takes back the Hollowed and the words; the replay is the same', async () => {
    const { rm, scene } = vigilInProgress();
    const [first] = scene.playerUnits;
    wait(scene, first);
    const before = {
      units: [...scene.enemyUnits].map(shape),
      vigil: structuredClone(scene._vigilState),
      gold: rm.gold,
      rite: structuredClone(rm.rite),
    };
    const spoken = await enemyPhaseThenTurnStart(scene);
    const hollowed = called(scene.enemyUnits);
    expect(hollowed.length).toBeGreaterThan(0);
    expect(scene._vigilState.words).toBeGreaterThan(0);
    expect(spoken.length).toBeGreaterThan(0);
    const firstCall = { units: hollowed.map(shape), vigil: structuredClone(scene._vigilState) };
    // The run's Rite never takes words in battle.
    expect(rm.rite).toEqual(before.rite);

    // Rewind to turn 1 (the only point before the enemy phase: "Before <unit>'s wait").
    const charges = rm.visionChargesRemaining;
    const row = rewindTo(scene, (rows) => rows.find((r) => r.turnNumber === 1));
    expect(row.title).toBe(`Before ${first.name}’s wait`);
    expect(rm.visionChargesRemaining).toBe(charges - 1);
    expect(called(scene.enemyUnits)).toEqual([]);
    expect(scene.enemyUnits.map(shape)).toEqual(before.units);
    expect(scene._vigilState).toEqual(before.vigil);
    expect(scene.turnManager.turnNumber).toBe(1);
    expect(rm.gold).toBe(before.gold);
    expect(rm.rite).toEqual(before.rite);
    // The rewind's own checkpoint is that state too: no Hollowed saved, no words.
    const saved = loadRun(descentData(), 1);
    expect(called(saved.battleInProgress.checkpoint.enemyUnits)).toEqual([]);
    expect(saved.battleInProgress.checkpoint.vigilState).toEqual(before.vigil);
    expect(saved.visionChargesRemaining).toBe(charges - 1);

    // The replayed phase calls the same Hollowed and says the same words.
    const replay = await enemyPhaseThenTurnStart(scene);
    expect(called(scene.enemyUnits).map(shape)).toEqual(firstCall.units);
    expect(scene._vigilState).toEqual(firstCall.vigil);
    expect(replay).toEqual(spoken);
    // No identity is held twice.
    expect(new Set(ids(scene)).size).toBe(ids(scene).length);
  });

  it('a resume after the summons restores the words and every Hollowed once, and never replays the phase', async () => {
    const { scene, data } = vigilInProgress();
    wait(scene, scene.playerUnits[0]);
    await enemyPhaseThenTurnStart(scene);
    const live = {
      enemies: scene.enemyUnits.map((u) => [u.battleEntityId, shape(u)]),
      players: scene.playerUnits.map((u) => [u.battleEntityId, shape(u)]),
      vigil: structuredClone(scene._vigilState),
      rng: scene._battleRng.getState(),
      next: scene._nextBattleEntityId,
    };
    const { scene: resumed, run } = resumeFromSlot(data);
    expect(resumed.enemyUnits.map((u) => [u.battleEntityId, shape(u)])).toEqual(live.enemies);
    expect(resumed.playerUnits.map((u) => [u.battleEntityId, shape(u)])).toEqual(live.players);
    expect(resumed._vigilState).toEqual(live.vigil);
    expect(resumed._battleRng.getState()).toEqual(live.rng);
    expect(resumed._nextBattleEntityId).toBe(live.next);
    expect(run.rite).toEqual(scene.runManager.rite);
    // The phase step runs again on the resumed turn's pipeline only as a no-op (turn guard).
    resumed.turnManager.turnNumber = live.vigil.lastProcessedTurn;
    resumed.turnManager.currentPhase = 'enemy';
    await resumed.processVigil();
    expect(resumed._vigilState).toEqual(live.vigil);
    expect(called(resumed.enemyUnits)).toHaveLength(called(scene.enemyUnits).length);
    expect(resumed._battleBeats.speakOver).not.toHaveBeenCalled();
    // The next phase's calls take fresh identities.
    resumed.turnManager.turnNumber = live.vigil.lastProcessedTurn + 1;
    await resumed.processVigil();
    expect(new Set(ids(resumed)).size).toBe(ids(resumed).length);
  });

  it('a resume from before the phase replays the same words and the same Hollowed', async () => {
    const { scene, data } = vigilInProgress();
    wait(scene, scene.playerUnits[0]); // the checkpoint after this action is the one resumed
    const resumedBefore = resumeFromSlot(data).scene;
    const spoken = await enemyPhaseThenTurnStart(scene);
    const firstCall = called(scene.enemyUnits).map(shape);

    resumedBefore.turnManager.currentPhase = 'enemy';
    resumedBefore.turnManager.turnNumber = 1;
    await resumedBefore.processVigil();
    expect(said(resumedBefore)).toEqual(spoken);
    expect(called(resumedBefore.enemyUnits).map(shape)).toEqual(firstCall);
    expect(resumedBefore._vigilState).toEqual(scene._vigilState);
  });

  it('Continue from Map after the summons: the run as it entered, no words in the Rite, the charge back', async () => {
    const { rm, scene, node } = vigilInProgress();
    const entry = JSON.parse(JSON.stringify(rm.toJSON()));
    wait(scene, scene.playerUnits[0]);
    await enemyPhaseThenTurnStart(scene);
    rewindTo(scene, (rows) => rows.find((r) => r.turnNumber === 1));
    expect(rm.visionChargesRemaining).toBe(entry.visionChargesRemaining - 1);
    expect(rm.revertBattleInProgressToEntry()).toBe(true);
    expect(rm.battleInProgress ?? null).toBeNull();
    expect(rm.visionChargesRemaining).toBe(entry.visionChargesRemaining);
    expect(rm.rite).toEqual(entry.rite);
    expect(rm.gold).toBe(entry.gold);
    expect(nodeOf(rm, 'vigil').completed).toBe(false);
    // The locked map stays: the Vigil fought again is the same battle (no Hollowed in it).
    const locked = rm.getLockedBattleConfig(node.id);
    expect(locked.templateId).toBe('setpiece:the_vigil');
    expect(locked.enemySpawns.some((s) => s.summonedBy || s._summonedBy)).toBe(false);
  });
});

// Scenario 6's finding, pinned here on the same production scene: on an upright phone a Voice
// standing high on the turned board floated its line and name under the notice band announcing
// it ("The Voices speak.", then "The circle calls."). The bands now come first, the lines after.
describe('the court’s lines wait for the notice bands', () => {
  it('no line floats while a band of the phase is still on screen', async () => {
    const { scene } = vigilInProgress();
    const events = [];
    scene.showBriefBanner = vi.fn(async (message) => {
      events.push(`band:${message}`);
      await Promise.resolve();
      events.push('band:end');
    });
    scene._battleBeats.speakOver = vi.fn((unit) =>
      events.push(`line:${unit.authoredId || unit._summonedBy}`),
    );
    scene.time = { delayedCall: (_ms, fn) => fn() };
    scene.turnManager.currentPhase = 'enemy';
    await scene.processVigil();
    const bands = events.filter((e) => e.startsWith('band:') && e !== 'band:end');
    const lines = events.filter((e) => e.startsWith('line:'));
    expect(bands).toEqual(['band:The Voices speak.', 'band:The circle calls.']);
    expect(lines.length).toBeGreaterThan(1);
    const lastBandEnd = events.lastIndexOf('band:end');
    expect(events.findIndex((e) => e.startsWith('line:'))).toBeGreaterThan(lastBandEnd);
  });
});
