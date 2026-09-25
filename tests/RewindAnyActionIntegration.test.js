// Controller + timeline + transaction wiring for "rewind to before any
// action", on the production BattleScene checkpoint/restore methods (journey
// harness). The picker itself is replaced by a recorder of its options; its
// DOM behaviour is covered in VisionRewindPicker.test.js and e2e.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import './harness/JourneyTestSetup.js';

const pickers = vi.hoisted(() => []);
vi.mock('../src/ui/VisionRewindPicker.js', () => ({
  VisionRewindPicker: class {
    constructor(scene, options) {
      this.options = options;
      this.selectedId = options.listing.rows[0]?.id ?? null;
      this.destroyed = false;
      pickers.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { VisionRewindController, hashRewindSeed } from '../src/ui/VisionRewindController.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { observeHistoryAction } from '../src/ui/BattleHistoryRecorder.js';
import { persistFatalDecision } from '../src/ui/BattleFatalDecision.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { getEntryState } from '../src/engine/BattleTimeline.js';
import { loadRun } from '../src/engine/RunManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

let storage;
beforeEach(() => {
  pickers.length = 0;
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(42);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture({ units = 3, policy = null, difficulty = null } = {}) {
  const driver = new RunDriver(storage, { seed: 42 });
  const run = driver.run;
  run.visionChargesRemaining = 3;
  if (difficulty) run.applyDifficultySelection(difficulty);
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  if (policy) run.battleInProgress.rewindPolicy = policy;
  const scene = journeyBattleScene(run, driver.data);
  const roster = run.roster.slice(0, 2);
  while (roster.length < units)
    roster.push({ ...structuredClone(run.roster[1]), name: `Ally ${roster.length}` });
  scene.playerUnits = structuredClone(roster);
  scene.playerUnits.forEach((unit, index) => {
    delete unit.battleEntityId;
    Object.assign(unit, { col: 1, row: index, faction: 'player', isCommander: index === 0 });
    scene.addUnitGraphic(unit);
  });
  scene._battleCommanderId = scene.playerUnits[0].battleEntityId;
  scene.grid.fogEnabled = false;
  scene._visionController = new VisionRewindController(scene, run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint()).toBe(true);
  return { driver, scene, run };
}
/** Complete one player action with a real observable effect. */
function act(scene, unit, { hp = -2, move = 1 } = {}) {
  unit.row += move;
  unit.currentHP = Math.max(1, unit.currentHP + hp);
  unit.hasMoved = true;
  scene._battleRng(); // an action consumes the battle stream (e.g. a hit roll)
  observeHistoryAction(scene, 'waited', unit);
  completeBattleAction(scene, unit);
}
const board = (scene) =>
  scene.playerUnits.map((u) => [u.battleEntityId, u.col, u.row, u.currentHP, u.hasActed === true]);

describe('rewind to before any action', () => {
  it('Rewind opens the picker on "before" points and one confirm restores exactly', () => {
    const { scene, run, driver } = fixture();
    const [a, b, c] = scene.playerUnits;
    const boards = [board(scene)];
    const rng = [scene._battleRng.getState()];
    for (const unit of [a, b, c]) {
      act(scene, unit);
      boards.push(board(scene));
      rng.push(scene._battleRng.getState());
    }
    scene.battleState = 'PLAYER_IDLE';
    expect(scene._visionController.requestRewind({ force: true })).toBe(true);
    const picker = pickers.at(-1);
    const { rows } = picker.options.listing;
    expect(rows.map((r) => r.title)).toEqual([
      `Before ${c.name}’s wait`,
      `Before ${b.name}’s wait`,
      `Before ${a.name}’s wait`,
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['action', 'action', 'turn_start']);
    expect(scene.battleState).toBe('PAUSED');
    // Confirm "before B's move" (the state right after A acted).
    picker.options.onConfirm(rows[1].id);
    expect(run.visionChargesRemaining).toBe(2);
    expect(board(scene)).toEqual(boards[1]);
    expect(scene._battleRng.getState()).toEqual(rng[1]);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.visionDialog).toBeNull();
    expect(scene._timelineCurrentEntryId).toBe(rows[1].id);
    // Durable: the saved checkpoint is that exact state with the debit.
    const saved = loadRun(driver.data, 1);
    expect(saved.visionChargesRemaining).toBe(2);
    expect(
      saved.battleInProgress.checkpoint.playerUnits.map((u) => [
        u.battleEntityId,
        u.col,
        u.row,
        u.currentHP,
        u.hasActed,
      ]),
    ).toEqual(boards[1]);
    expect(saved.battleInProgress.checkpoint.rngState).toEqual(rng[1]);
    // Resume after the rewind lands on the same board and stream.
    const resumed = journeyBattleScene(saved, driver.data);
    const resume = new BattleSuspendController(resumed);
    resume.applyUnits(saved.battleInProgress.checkpoint);
    resume.finalizeResume(saved.battleInProgress.checkpoint);
    expect(board(resumed)).toEqual(boards[1]);
    expect(resumed._battleRng.getState()).toEqual(rng[1]);
  });

  it('confirm is refused without charges, for the live point, and for points the difficulty forbids', () => {
    const { scene, run } = fixture({ difficulty: 'lunatic' });
    const [a, b] = scene.playerUnits;
    act(scene, a);
    act(scene, b);
    scene.battleState = 'PLAYER_IDLE';
    scene._visionController.openRewind();
    const { rows, granularity } = pickers.at(-1).options.listing;
    expect(granularity).toBe('turn');
    expect(rows.map((r) => r.available)).toEqual([false, true]);
    const before = board(scene);
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(run.visionChargesRemaining).toBe(3);
    expect(board(scene)).toEqual(before);
    run.visionChargesRemaining = 0;
    pickers.at(-1).options.onConfirm(rows[1].id);
    expect(board(scene)).toEqual(before);
    pickers.at(-1).options.onConfirm(scene._timelineCurrentEntryId);
    expect(board(scene)).toEqual(before);
  });

  it('a traded-then-set-aside unit becomes a point before the next activation', () => {
    const { scene } = fixture();
    const [a, b, c] = scene.playerUnits;
    act(scene, a);
    const afterA = board(scene);
    // B moves and trades (no action spent), is set aside; the trade checkpoint
    // is a recovery row, not a destination.
    b.row += 1;
    b.hasMoved = true;
    b._movementCommitted = true;
    b.consumables = [...(b.consumables || []), { name: 'Vulnerary', uses: 3 }];
    observeHistoryAction(scene, 'traded with', b, c, 'Vulnerary');
    scene._historyActor = b.battleEntityId;
    scene.battleState = 'TRADING';
    scene._captureSuspendCheckpoint();
    const tradeRow = scene._battleTimeline.entries.at(-1);
    expect(tradeRow).toMatchObject({ kind: 'recovery', destination: false });
    scene.battleState = 'PLAYER_IDLE';
    scene.selectedUnit = null;
    scene.preMoveLoc = null;
    const parked = board(scene);
    expect(scene._visionController.settleParkedActivation()).toBe(true);
    const settled = scene._battleTimeline.entries.at(-1);
    expect(settled).toMatchObject({ id: tradeRow.id, kind: 'player_action', destination: true });
    // Nothing further to settle until something changes.
    expect(scene._visionController.settleParkedActivation()).toBe(false);
    act(scene, c);
    scene._visionController.openRewind();
    const { rows } = pickers.at(-1).options.listing;
    expect(rows.map((r) => r.title)).toEqual([
      `Before ${c.name}’s wait`,
      `Before ${b.name}’s trade with ${c.name}`,
      `Before ${a.name}’s wait`,
    ]);
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(board(scene)).toEqual(parked);
    expect(scene.playerUnits[1]._movementCommitted).toBe(true);
    pickers.length = 0;
    scene._visionController.openRewind();
    pickers.at(-1).options.onConfirm(pickers.at(-1).options.listing.rows[0].id);
    expect(board(scene)).toEqual(afterA);
  });

  it('a free equipment change before the next activation is its own point', () => {
    const { scene } = fixture();
    const [a, b, c] = scene.playerUnits;
    act(scene, a);
    // Nothing changed since the last point: nothing to record.
    expect(scene._visionController.settleParkedActivation()).toBe(false);
    b.inventory = [...b.inventory, structuredClone(b.inventory[0])];
    b.inventory.at(-1).name = 'Spare Blade';
    b.weapon = b.inventory.at(-1);
    const equipped = board(scene);
    const equippedWeapon = b.weapon.name;
    expect(scene._visionController.settleParkedActivation()).toBe(true);
    act(scene, c);
    scene._visionController.openRewind();
    const { rows } = pickers.at(-1).options.listing;
    expect(rows.map((r) => r.title)).toEqual([
      `Before ${c.name}’s wait`,
      `Before ${b.name}’s equipment change`,
      `Before ${a.name}’s wait`,
    ]);
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(board(scene)).toEqual(equipped);
    expect(scene.playerUnits[1].weapon.name).toBe(equippedWeapon);
    expect(scene.playerUnits[1].weapon).toBe(scene.playerUnits[1].inventory.at(-1));
  });

  it('the fallen-commander decision opens the picker and Back returns to it', () => {
    const { scene, run } = fixture();
    const [a, b] = scene.playerUnits;
    const initial = board(scene);
    act(scene, b);
    scene.playerUnits.shift();
    scene._battleCommanderName = a.name;
    scene.turnManager.currentPhase = 'enemy';
    const dialogs = [];
    vi.spyOn(scene._visionController, 'showDialog').mockImplementation((options) => {
      dialogs.push(options);
      scene.visionDialog = { group: [], ...options };
    });
    expect(scene._visionController.showLordDeathPrompt()).toBe(true);
    expect(dialogs.at(-1).confirmLabel).toBe('Rewind');
    dialogs.at(-1).onConfirm();
    const picker = pickers.at(-1);
    expect(picker.options.fatal).toBe(true);
    expect(picker.options.listing.rows.map((r) => r.title)).toEqual([`Before ${b.name}’s wait`]);
    picker.options.onClose();
    expect(dialogs).toHaveLength(2);
    dialogs.at(-1).onConfirm();
    pickers.at(-1).options.onConfirm(pickers.at(-1).options.listing.rows[0].id);
    expect(run.visionChargesRemaining).toBe(2);
    expect(scene._fatalDecision).toBeNull();
    expect(scene.turnManager.currentPhase).toBe('player');
    // "Before Sera's wait" is the turn start: the commander stands again.
    expect(board(scene)).toEqual(initial);
    expect(scene.playerUnits[0]).toMatchObject({ name: a.name, isCommander: true });
  });

  it('legacy battles rewind to action points with their reroll-on-rewind rule', () => {
    const { scene, run, driver } = fixture({ policy: 'legacy-v1' });
    scene._battleRewindPolicy = 'legacy-v1';
    scene._battleTimeline = null;
    run.battleInProgress.timeline = null;
    scene._timelineBoundary = 'turn_start';
    scene._captureSuspendCheckpoint();
    const [a, b] = scene.playerUnits;
    act(scene, a);
    const afterA = board(scene);
    act(scene, b);
    scene._visionController.openRewind();
    const { rows } = pickers.at(-1).options.listing;
    expect(rows[0]).toMatchObject({ kind: 'action', available: true });
    const target = getEntryState(scene._battleTimeline, rows[0].id);
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(board(scene)).toEqual(afterA);
    expect(run.visionChargesRemaining).toBe(2);
    const saved = loadRun(driver.data, 1).battleInProgress.checkpoint;
    expect(saved.rewindPolicy).toBe('legacy-v1');
    expect(saved.rngState).toBeNull();
    expect(saved.rngSeed).toBe(hashRewindSeed(target.rngSeed, 1));
    expect(pickers.at(-1).options.policy).toBe('legacy-v1');
  });
});
