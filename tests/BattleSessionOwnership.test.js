import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { RunManager, isRunSaveCurrent } from '../src/engine/RunManager.js';
import { BattleHistorySession } from '../src/ui/BattleHistorySession.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { getRunKey, getRunClockFloorKey } from '../src/engine/SlotManager.js';
const require = createRequire(import.meta.url);
const PhaserSceneManager = require('phaser/src/scene/SceneManager.js');
const PhaserSystems = require('phaser/src/scene/Systems.js');
const EventEmitter = require('eventemitter3');
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
import { DialogueOverlay } from '../src/ui/DialogueOverlay.js';
import { LootFlowController } from '../src/ui/LootFlowController.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { HealController } from '../src/ui/HealController.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { isCurrentBattleSession } from '../src/ui/BattleSession.js';
import { LootScreenController } from '../src/ui/LootScreenController.js';
import { BossRecruitOverlay } from '../src/ui/BossRecruitOverlay.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import {
  captureResolvedAction,
  presentQueuedLevelUps,
  completeResolvedAction,
} from '../src/ui/BattlePresentationCheckpoint.js';

function sceneWithPendingTween() {
  const scene = new BattleScene();
  scene.init({ gameData: { skills: [] } });
  scene.scene = { isActive: () => true };
  scene.sys = { isActive: () => true };
  const callbacks = [];
  scene.tweens = {
    add: vi.fn((config) => {
      callbacks.push(config);
      return { remove: vi.fn() };
    }),
  };
  return { scene, callbacks };
}
function restart(scene) {
  scene._sceneShutdownCleanedUp = true;
  scene._cancelLifecycleAwaits('scene_shutdown');
  scene.init({ gameData: { skills: [] } });
  scene.battleState = 'PLAYER_IDLE';
  scene._selectedWeaponArt = 'new selection';
  scene._combatSpeedSnapshot = 3;
}
function attachDialogue(scene) {
  const display = () => {
    let item;
    item = new Proxy({ destroy: vi.fn() }, { get: (target, key) => target[key] || (() => item) });
    return item;
  };
  scene.cameras = { main: { centerX: 320, centerY: 240, width: 640, height: 480 } };
  scene.add = { rectangle: display, text: display };
  scene.registry = { get: () => null };
  scene.events = { once() {}, off() {} };
  scene.textures = { exists: () => false };
  scene.input = { keyboard: { addKey: () => ({ once() {}, off() {} }) } };
  scene.time = { delayedCall: () => ({ remove() {} }) };
  scene.dialogueOverlay = new DialogueOverlay(scene);
  return scene.dialogueOverlay;
}
async function drain() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('originating battle session ownership', () => {
  it('shutdown and synchronous init never resume a tween action or its finally', async () => {
    const { scene, callbacks } = sceneWithPendingTween();
    let resumed = false;
    let finalized = false;
    void (async () => {
      try {
        await scene._awaitSceneTween({ duration: 100 });
        resumed = true;
        scene.battleState = 'OLD_ACTION';
      } finally {
        finalized = true;
        scene._selectedWeaponArt = null;
      }
    })();
    const first = scene._battleSession;
    restart(scene);
    callbacks[0].onComplete(); // A queued callback from the stopped tween is also harmless.
    await drain();
    expect(scene._battleSession).toBe(first + 1);
    expect({ resumed, finalized, state: scene.battleState, art: scene._selectedWeaponArt }).toEqual(
      { resumed: false, finalized: false, state: 'PLAYER_IDLE', art: 'new selection' },
    );
  });
  it('a completed tween followed by synchronous restart still parks the queued continuation', async () => {
    const { scene, callbacks } = sceneWithPendingTween();
    let resumed = false;
    void scene._awaitSceneTween({ duration: 100 }).then(() => {
      resumed = true;
    });
    callbacks[0].onComplete();
    restart(scene);
    await drain();
    expect(resumed).toBe(false);
  });
  it('synchronous tween stop during cancellation cannot release a rewind continuation', async () => {
    const { scene } = sceneWithPendingTween();
    let resumed = false;
    let originalStop = false;
    scene.tweens.add.mockImplementation((config) => ({ remove: () => config.onStop() }));
    void scene
      ._awaitSceneTween({
        duration: 100,
        onStop: () => {
          originalStop = true;
        },
      })
      .then(() => {
        resumed = true;
      });
    scene._cancelLifecycleAwaits('vision_rewind');
    await drain();
    expect({ resumed, originalStop }).toEqual({ resumed: false, originalStop: false });
  });
  it('active timeout completes separately and cleans resources without invalidating the session', async () => {
    vi.useFakeTimers();
    const { scene } = sceneWithPendingTween();
    const pending = scene._awaitSceneTween({ duration: 100 }, { timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(30);
    expect(await pending).toEqual({ status: 'timed_out' });
    expect(scene._lifecycleAwaitGuards.size).toBe(0);
    const completed = scene._awaitSceneTween({ duration: 100 });
    scene.tweens.add.mock.calls.at(-1)[0].onComplete();
    expect(await completed).toEqual({ status: 'completed' });
  });
  it('old scheduled callbacks and delayed recovery cannot change a restarted battle', async () => {
    const { scene } = sceneWithPendingTween();
    const callbacks = [];
    scene.time = {
      delayedCall: (_ms, callback) => {
        callbacks.push(callback);
        return { remove() {} };
      },
    };
    let reject;
    const work = new Promise((_resolve, r) => {
      reject = r;
    });
    const recovery = vi.fn(() => {
      scene.battleState = 'RECOVERY';
    });
    scene._scheduleSafeDelayedAsync(1, 'old', () => work, { onError: recovery });
    const running = callbacks[0]();
    scene._scheduleSafeDelayedAsync(1, 'not_started', () => {
      scene.battleState = 'OLD_CALLBACK';
    });
    restart(scene);
    await callbacks[1]();
    reject(new Error('old failure'));
    await running;
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(recovery).not.toHaveBeenCalled();
  });
  it('originating tokens reject checkpoint, completion and error recovery before any mutation', () => {
    const { scene } = sceneWithPendingTween();
    const session = scene._battleSession;
    const oldController = new BattleSuspendController(scene);
    restart(scene);
    const unit = { name: 'Old unit', hasActed: false };
    expect(scene._persistBattleRunState(null, { session })).toEqual({
      ok: false,
      reason: 'stale_session',
    });
    expect(scene._captureSuspendCheckpoint({ session })).toBe(false);
    expect(oldController.captureCheckpoint()).toBe(false);
    expect(captureResolvedAction(scene, { kind: 'finish' }, { session })).toBe(false);
    expect(completeResolvedAction(scene, { kind: 'finish' }, { session })).toBe(false);
    expect(completeBattleAction(scene, unit, { session })).toBe(false);
    expect(scene._recoverUnitActionError(unit, 'old', new Error('old'), { session })).toBe(false);
    expect(unit.hasActed).toBe(false);
    expect(scene._pendingActionCompletion).toBeNull();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });
  it('destroying a real story overlay before synchronous init never unlocks the new story', async () => {
    const { scene } = sceneWithPendingTween();
    const overlay = attachDialogue(scene);
    scene.refreshEndTurnControl = vi.fn();
    const pending = scene._showStorySequence([{ line: 'Old story' }]);
    expect(overlay.visible).toBe(true);
    overlay.destroy();
    restart(scene);
    scene._storyDialogueActive = true;
    await pending;
    expect(scene._storyDialogueActive).toBe(true);
    expect(scene.refreshEndTurnControl).not.toHaveBeenCalled();
  });
  it('a removed lord farewell settled by real overlay destruction cannot touch the new battlefield', async () => {
    const { scene } = sceneWithPendingTween();
    const overlay = attachDialogue(scene);
    const lord = {
      name: 'Old lord',
      faction: 'player',
      isLord: true,
      currentHP: 0,
      col: 1,
      row: 1,
    };
    scene.gameData = {
      skills: [],
      affixes: [],
      dialogue: { lordFarewell: { 'Old lord': ['Farewell.'] } },
    };
    scene.playerUnits = [lord];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.grid = { fogEnabled: false };
    scene.removeUnitGraphic = () => {};
    scene._getPortraitKey = () => null;
    scene._combatFx = { deathFade: async () => {} };
    const pending = scene.removeUnit(lord);
    await drain();
    expect(overlay.visible).toBe(true);
    overlay.destroy();
    restart(scene);
    const replacement = { name: 'New commander', currentHP: 20 };
    scene.playerUnits = [replacement];
    scene.grid = { clearTemporaryTerrainsBySource: vi.fn() };
    scene.updateObjectiveText = vi.fn();
    scene._deathAffixChainDepth = 7;
    await pending;
    expect(scene.playerUnits).toEqual([replacement]);
    expect(scene._deathAffixChainDepth).toBe(7);
    expect(scene.grid.clearTemporaryTerrainsBySource).not.toHaveBeenCalled();
    expect(scene.updateObjectiveText).not.toHaveBeenCalled();
  });
  it('an old heal rejection cannot finish an action or recover on the restarted scene', async () => {
    const { scene } = sceneWithPendingTween();
    const controller = new HealController(scene);
    scene.grid = { clearAttackHighlights() {} };
    scene.registry = { get: () => null };
    scene.commitVisionSnapshotIfPending = () => {};
    scene.resetFortHealStreak = () => {};
    scene.hideActionMenu = () => {};
    scene.updateHPBar = () => {};
    scene._presentScaledXP = () => {};
    scene._getCombatFx = () => ({});
    scene.awardScaledXP = () => 20;
    scene.finishUnitAction = vi.fn();
    scene._recoverUnitActionError = vi.fn();
    scene.animateHeal = () =>
      new Promise((_r, j) => {
        reject = j;
      });
    let reject;
    const healer = {
      name: 'Old healer',
      stats: { MAG: 5, HP: 20 },
      currentHP: 20,
      col: 1,
      row: 1,
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      weapon: {
        type: 'Staff',
        name: 'Heal',
        healBase: 5,
        rankRequired: 'Prof',
        range: '1',
        uses: 3,
      },
      inventory: [],
      faction: 'player',
    };
    const target = { name: 'Old target', stats: { HP: 20 }, currentHP: 10, col: 1, row: 2 };
    healer.inventory = [healer.weapon];
    scene.playerUnits = [healer, target];
    scene.npcUnits = [];
    const pending = controller.executeHeal(healer, target);
    expect(reject).toBeTypeOf('function');
    restart(scene);
    reject(new Error('closed heal UI'));
    await pending;
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene._recoverUnitActionError).not.toHaveBeenCalled();
  });
  it('restart between immediately completed XP awards cannot grant old Mentor shares into the new battle', async () => {
    const { scene } = sceneWithPendingTween();
    const holder = {
      name: 'Holder',
      level: 10,
      tier: 'base',
      currentHP: 20,
      col: 0,
      row: 0,
      xp: 0,
      accessory: { combatEffects: { xpShare: 0.5 } },
    };
    const trainee = {
      name: 'Trainee',
      level: 1,
      tier: 'base',
      currentHP: 20,
      col: 1,
      row: 0,
      xp: 0,
    };
    scene.playerUnits = [holder, trainee];
    scene.getEnemyXpMultiplier = () => 1;
    scene.getTurnPressureState = () => ({ xpMultiplier: 1 });
    scene.awardScaledXP = async (unit, xp) => {
      unit.xp += xp;
    };
    const pending = scene.awardXP(holder, { level: 10, tier: 'base' }, true);
    restart(scene);
    scene._pendingLevelUpPopups = [{ unitName: 'New commander' }];
    await pending;
    expect(holder.xp).toBe(40);
    expect(trainee.xp).toBe(0);
    expect(scene._pendingLevelUpPopups).toEqual([{ unitName: 'New commander' }]);
  });
  it('completion consumes the action but reports a failed checkpoint instead of success', () => {
    const { scene } = sceneWithPendingTween();
    const unit = { name: 'Actor', battleEntityId: 'unit-1', hasActed: false };
    scene.playerUnits = [unit];
    scene.grid = { fogEnabled: false };
    scene.runManager = { battleInProgress: {} };
    scene._historyBeats = [{ actorId: unit.battleEntityId }];
    scene.dimUnit = () => {};
    scene._captureSuspendCheckpoint = () => false;
    scene.turnManager = { unitActed() {} };
    expect(completeBattleAction(scene, unit, { session: scene._battleSession })).toBe(false);
    expect(unit.hasActed).toBe(true);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
  });
  it('an old ability effect promise cannot complete or recover in the new battle', async () => {
    const { scene } = sceneWithPendingTween();
    const controller = new AbilityController(scene);
    scene.commitVisionSnapshotIfPending = () => {};
    scene.hideActionMenu = () => {};
    scene.finishUnitAction = vi.fn();
    scene._recoverUnitActionError = vi.fn();
    let reject;
    controller._applyRally = () =>
      new Promise((_r, j) => {
        reject = j;
      });
    const pending = controller.executeSelfCentered(
      { name: 'Old actor' },
      { id: 'rally', actionAbility: { kind: 'ally_buff' } },
    );
    restart(scene);
    reject(new Error('old effect closed'));
    await pending;
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene._recoverUnitActionError).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });
  it('an old defeat timer cannot restart the replacement battle', () => {
    const { scene } = sceneWithPendingTween();
    attachDialogue(scene);
    scene._pinToScreen = () => {};
    scene.clearInspectionVisuals = () => {};
    scene.hideActionMenu = () => {};
    const callbacks = [];
    scene.time = {
      delayedCall: (_ms, callback) => {
        callbacks.push(callback);
      },
    };
    const controller = new PostCombatController(scene);
    controller.onDefeat();
    expect(callbacks).toHaveLength(1);
    restart(scene);
    scene.scene.restart = vi.fn();
    callbacks[0]();
    expect(scene.scene.restart).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene._battleSession).toBe(2);
  });
  it('queued old loot cleanup cannot clear replacement flags or destroy its screen', async () => {
    const { scene } = sceneWithPendingTween();
    const controller = new LootFlowController(scene);
    const cleanup = vi.spyOn(controller, 'cleanupLootScreen');
    controller.scheduleLootCleanup([]);
    const timeout = scene._lootCleanupTimeout;
    restart(scene);
    scene._lootCleanupScheduled = true;
    scene._lootCleanupTimeout = 'new timer';
    await drain();
    clearTimeout(timeout);
    expect(scene._lootCleanupScheduled).toBe(true);
    expect(scene._lootCleanupTimeout).toBe('new timer');
    expect(cleanup).not.toHaveBeenCalled();
  });
  it('the current creating scene can persist before Phaser reaches RUNNING, while old owners remain rejected', () => {
    const { scene } = sceneWithPendingTween();
    const oldSession = scene._battleSession;
    restart(scene);
    scene.sys = { isActive: () => false, settings: { active: true } };
    scene.runManager = null;
    expect(scene._persistBattleRunState(null, { session: scene._battleSession })).toEqual({
      ok: false,
      reason: 'missing_run',
    });
    expect(scene._persistBattleRunState(null, { session: oldSession })).toEqual({
      ok: false,
      reason: 'stale_session',
    });
    scene.sys.settings.active = false;
    expect(scene._persistBattleRunState(null, { session: scene._battleSession })).toEqual({
      ok: false,
      reason: 'missing_run',
    });
  });
  it('a sweep paused at a death cannot remove remaining old actors after replacement', async () => {
    const { scene } = sceneWithPendingTween();
    const oldUnits = [
      { name: 'First', currentHP: 0 },
      { name: 'Second', currentHP: 0 },
    ];
    scene.playerUnits = oldUnits;
    scene.enemyUnits = [];
    scene.npcUnits = [];
    let finishDeath;
    scene.removeUnit = vi.fn(
      () =>
        new Promise((resolve) => {
          finishDeath = resolve;
        }),
    );
    const sweep = scene._sweepFallenUnits();
    expect(scene.removeUnit).toHaveBeenCalledOnce();
    restart(scene);
    const replacement = { name: 'New commander', currentHP: 10 };
    scene.playerUnits = [replacement];
    finishDeath();
    await sweep;
    expect(scene.removeUnit).toHaveBeenCalledOnce();
    expect(scene.playerUnits).toEqual([replacement]);
  });
  it('a late combat rejection does not run cleanup or clear the new selections', async () => {
    const { scene } = sceneWithPendingTween();
    let reject;
    scene._runCombatResolution = () =>
      new Promise((_r, j) => {
        reject = j;
      });
    scene.grid = { clearAttackHighlights() {} };
    scene._commitCombatIntent = () => {};
    scene.resetFortHealStreak = () => {};
    scene._prepareCombatContext = () => ({});
    scene._clearCombatRollSession = vi.fn();
    scene._clearSelectedWeaponArt = vi.fn();
    const work = scene.executeCombat({ name: 'Old', currentHP: 10 }, { currentHP: 10 });
    restart(scene);
    reject(new Error('late render failure'));
    await work;
    expect(scene._clearCombatRollSession).not.toHaveBeenCalled();
    expect(scene._clearSelectedWeaponArt).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });
});

function realPauseHost() {
  const { scene } = sceneWithPendingTween();
  scene.sys = new PhaserSystems(scene);
  scene.sys.settings.status = 5; // Phaser RUNNING
  scene.sys.settings.active = true;
  scene.sys.events = new EventEmitter();
  const manager = Object.create(PhaserSceneManager.prototype);
  manager.keys = { Battle: scene };
  scene.game = { scene: manager };
  scene.events = new EventEmitter();
  scene.scene = {
    key: 'Battle',
    isActive: () => scene.sys.isActive(),
    isVisible: () => true,
    setVisible() {},
  };
  return { scene, manager };
}
describe('paused current battle ownership', () => {
  it('safe delayed work entered paused executes immediately without a resume timer', async () => {
    const { scene, manager } = realPauseHost();
    manager.pause('Battle');
    let settled = false;
    scene.time = { delayedCall: vi.fn() };
    await scene._scheduleSafeDelayedAsync(200, 'paused settlement', () => {
      settled = true;
    });
    expect(settled).toBe(true);
    expect(scene.time.delayedCall).not.toHaveBeenCalled();
    expect(scene.sys.isActive()).toBe(false);
  });

  it('real Phaser pause preserves session ownership while obsolete owners remain rejected', () => {
    const { scene, manager } = realPauseHost();
    const old = scene._battleSession - 1;
    manager.pause('Battle');
    expect(scene.sys.settings.active).toBe(false);
    expect(scene.sys.isActive()).toBe(false);
    expect(scene._persistBattleRunState(null, { session: scene._battleSession })).toEqual({
      ok: false,
      reason: 'missing_run',
    });
    expect(scene._persistBattleRunState(null, { session: old })).toEqual({
      ok: false,
      reason: 'stale_session',
    });
  });
  it('delays, tweens and an enemy tail entered while paused settle instead of parking', async () => {
    const { scene, manager } = realPauseHost();
    manager.pause('Battle');
    expect(await scene._awaitSceneDelay(150)).toEqual({ status: 'skipped_paused' });
    const cancel = vi.fn();
    expect(await scene._awaitSceneTween({ duration: 100 }, { onCancel: cancel })).toEqual({
      status: 'skipped_paused',
    });
    expect(cancel).toHaveBeenCalledWith('paused');
    scene._reinforcementsPendingThisTurn = true;
    await scene._scheduleSafeDelayedAsync(10, 'enemy_tail', async () => {
      await scene._awaitSceneDelay(100);
      scene._reinforcementsPendingThisTurn = false;
    });
    expect(scene._reinforcementsPendingThisTurn).toBe(false);
    expect(scene._lifecycleAwaitGuards?.size || 0).toBe(0);
  });
  it.each(['delay', 'tween'])(
    'a %s entered active can time out paused and releases its finally',
    async (kind) => {
      vi.useFakeTimers();
      const { scene, manager } = realPauseHost();
      scene.time = { delayedCall: () => ({ remove() {} }) };
      let finalized = false;
      const waiting = (
        kind === 'delay'
          ? scene._awaitSceneDelay(100, { timeoutMs: 30 })
          : scene._awaitSceneTween({ duration: 100 }, { timeoutMs: 30 })
      ).finally(() => {
        finalized = true;
      });
      manager.pause('Battle');
      await vi.advanceTimersByTimeAsync(30);
      expect(await waiting).toEqual({ status: 'timed_out' });
      expect(finalized).toBe(true);
    },
  );
  it('rewind persists while the real history session still owns the Phaser pause', async () => {
    const { scene, manager } = realPauseHost();
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    });
    const rm = new RunManager({});
    rm.visionChargesRemaining = 2;
    rm.visionCount = 0;
    rm.beginBattleInProgress('a', {});
    scene.runManager = rm;
    scene.registry = { get: (key) => (key === 'activeSlot' ? 1 : null) };
    scene.grid = { mapLayout: [[0]] };
    scene.playerUnits = [];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene._battleRewindPolicy = 'fixed-v1';
    scene._battleRng = createBattleRng(42);
    const state = captureBattleState(scene, { rngSeed: 42 });
    const controller = new VisionRewindController(scene, rm);
    controller._prepareTarget = () => state;
    controller._applySnapshot = () => true;
    const history = new BattleHistorySession(scene);
    controller._historySession = history;
    expect(scene.sys.isActive()).toBe(false);
    const original = scene._persistBattleRunState.bind(scene);
    scene._persistBattleRunState = vi.fn((...args) => {
      expect(history.destroyed).not.toBe(true);
      expect(scene.sys.isActive()).toBe(false);
      return original(...args);
    });
    expect(controller.executeRewind(state)).toBe(true);
    const saved = JSON.parse(store.get(getRunKey(1)));
    expect(saved.visionChargesRemaining).toBe(1);
    expect(saved.battleInProgress.checkpoint.rngState).toEqual(state.rngState);
    expect(history.destroyed).toBe(true);
    await history.ready;
  });
});

describe('checkpoint retry uses the live save owner', () => {
  it('re-stamps against a raised remote floor and updates the live manager stamp without a capture', () => {
    const { scene } = sceneWithPendingTween();
    const store = new Map();
    let quota = true;
    vi.stubGlobal('localStorage', {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        if (quota && k === getRunKey(1)) throw new DOMException('full', 'QuotaExceededError');
        store.set(k, v);
      },
      removeItem: (k) => store.delete(k),
    });
    const rm = new RunManager({});
    rm.beginBattleInProgress('a', {});
    scene.runManager = rm;
    scene.registry = { get: (k) => (k === 'activeSlot' ? 1 : null) };
    scene.turnManager = { currentPhase: 'player', turnNumber: 1 };
    scene.playerUnits = [];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.grid = { mapLayout: [[0]] };
    scene.reseedBattleRng = vi.fn();
    const ctrl = new BattleSuspendController(scene);
    expect(ctrl.captureCheckpoint()).toBe(false);
    const before = structuredClone(rm.battleInProgress.checkpoint);
    const reseeds = scene.reseedBattleRng.mock.calls.length;
    const floor = Date.now() + 100000;
    store.set(getRunClockFloorKey(1), String(floor));
    quota = false;
    expect(ctrl.retryCheckpoint()).toMatchObject({ ok: true });
    const saved = JSON.parse(store.get(getRunKey(1)));
    expect(saved.savedAt).toBeGreaterThan(floor);
    expect(isRunSaveCurrent(rm, 1)).toBe(true);
    expect(rm.battleInProgress.checkpoint).toEqual(before);
    expect(scene.reseedBattleRng).toHaveBeenCalledTimes(reseeds);
  });
  it('init resets parked loot cleanup flags for the replacement battle', () => {
    const { scene } = sceneWithPendingTween();
    scene._lootCleanupScheduled = true;
    scene._lootResolving = true;
    scene._lootCleanedUp = true;
    restart(scene);
    expect([scene._lootCleanupScheduled, scene._lootResolving, scene._lootCleanedUp]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

it('missing origin tokens never grant mutation permission, including an uninitialized scene', () => {
  expect(isCurrentBattleSession({})).toBe(false);
  expect(isCurrentBattleSession({ _battleSession: 1 })).toBe(false);
  const { scene } = sceneWithPendingTween();
  const unit = { name: 'Actor', hasActed: false };
  expect(scene.finishUnitAction(unit)).toBe(false);
  expect(completeBattleAction(scene, unit)).toBe(false);
  expect(captureResolvedAction(scene, { kind: 'finish' })).toBe(false);
  expect(scene._captureSuspendCheckpoint()).toBe(false);
  expect(scene._persistBattleRunState()).toEqual({ ok: false, reason: 'stale_session' });
  expect(unit.hasActed).toBe(false);
});

// A live RunManager and a real local save make omissions observable: rejecting a
// token must protect both the replacement battle and its durable checkpoint.
function liveCheckpointHost() {
  const { scene } = sceneWithPendingTween();
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  });
  scene.runManager = new RunManager({});
  scene.runManager.beginBattleInProgress('replacement', {});
  scene.registry = { get: (key) => (key === 'activeSlot' ? 1 : null) };
  scene.grid = { mapLayout: [[0]], clearAttackHighlights() {} };
  scene.turnManager = { currentPhase: 'player', turnNumber: 2 };
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.reseedBattleRng = () => {};
  scene._pendingActionCompletion = { kind: 'finish', unitName: 'Previously settled action' };
  scene._pendingLevelUpPopups = [{ unitName: 'Absent actor', levelUp: {} }];
  scene.battleState = 'COMBAT_RESOLVING';
  scene.finishUnitAction = (unit, { session } = {}) => {
    unit.hasActed = true;
    scene._captureSuspendCheckpoint({ session });
  };
  expect(scene._persistBattleRunState(null, { session: scene._battleSession }).ok).toBe(true);
  return { scene, store };
}
function protectedState(scene, store, unit) {
  return {
    storage: [...store.entries()],
    run: scene.runManager.toJSON(),
    action: structuredClone(scene._pendingActionCompletion),
    popups: structuredClone(scene._pendingLevelUpPopups),
    state: scene.battleState,
    acted: unit.hasActed,
  };
}

describe('required operation origins protect a live replacement save', () => {
  const helpers = {
    captureResolvedAction: (scene, unit, session) =>
      captureResolvedAction(scene, { kind: 'finish', unitName: unit.name }, { session }),
    presentQueuedLevelUps: (scene, unit, session) =>
      presentQueuedLevelUps(scene, { kind: 'finish', unitName: unit.name }, { session }),
    completeResolvedAction: (scene, unit, session) =>
      completeResolvedAction(scene, { kind: 'finish', unitName: unit.name }, { session }),
    _isSceneActiveForAsync: (scene, _unit, session) => {
      expect(scene._isSceneActiveForAsync(session)).toBe(false);
    },
    _captureSuspendCheckpoint: (scene, _unit, session) =>
      scene._captureSuspendCheckpoint({ session }),
    _recoverUnitActionError: (scene, unit, session) =>
      scene._recoverUnitActionError(unit, 'old operation', new Error('old failure'), { session }),
  };
  for (const [name, invoke] of Object.entries(helpers)) {
    it.each(['missing', 'stale'])('%s origin cannot enter ' + name, async (origin) => {
      const { scene, store } = liveCheckpointHost();
      const unit = {
        name: 'New actor',
        hasActed: false,
        faction: 'player',
        currentHP: 20,
        stats: { HP: 20 },
        inventory: [],
        skills: [],
        col: 0,
        row: 0,
      };
      scene.playerUnits = [unit];
      const before = protectedState(scene, store, unit);
      const session = origin === 'missing' ? undefined : scene._battleSession - 1;
      await invoke(scene, unit, session);
      expect(protectedState(scene, store, unit)).toEqual(before);
    });
  }
  it('the current explicit origin can capture into the same real storage fixture', () => {
    const { scene, store } = liveCheckpointHost();
    scene.battleState = 'PLAYER_IDLE';
    scene._pendingActionCompletion = null;
    scene._pendingLevelUpPopups = [];
    expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
    expect(JSON.parse(store.get(getRunKey(1))).battleInProgress.checkpoint.checkpointIndex).toBe(1);
  });
});

describe('previous-session continuations leave replacement state intact', () => {
  it('a previous post-combat controller cannot initialize a replacement loot screen', () => {
    const { scene } = liveCheckpointHost();
    const controller = new PostCombatController(scene);
    restart(scene);
    scene._elitePicksRemaining = 7;
    scene._lootCleanedUp = true;
    scene._lootResolving = true;
    const render = vi.spyOn(controller, '_showMasteryNotice').mockImplementation(() => {});
    const cards = vi
      .spyOn(LootScreenController.prototype, 'renderCards')
      .mockImplementation(() => {});
    try {
      controller.showLootScreen();
      expect([scene._elitePicksRemaining, scene._lootCleanedUp, scene._lootResolving]).toEqual([
        7,
        true,
        true,
      ]);
      expect(scene._lootController).toBeUndefined();
      expect(render).not.toHaveBeenCalled();
    } finally {
      render.mockRestore();
      cards.mockRestore();
    }
  });
  it('a stale boss-recruit pick cannot clear the new offer or add a recruit', () => {
    const { scene, store } = liveCheckpointHost();
    const controller = new PostCombatController(scene);
    let pick;
    const overlay = vi.spyOn(BossRecruitOverlay.prototype, 'show').mockImplementation((cb) => {
      pick = cb;
    });
    try {
      controller.showBossRecruitScreen();
      restart(scene);
      scene.runManager = new RunManager({});
      const offer = { version: 1, candidates: [{ unit: { name: 'New offer' } }] };
      scene.runManager.pendingBossRecruit = offer;
      scene.lootGroup = ['new overlay'];
      scene._bossRecruitOverlay = 'new recruit screen';
      const before = [...store.entries()];
      pick({ name: 'Old choice' });
      expect(scene.runManager.roster).toEqual([]);
      expect(scene.runManager.pendingBossRecruit).toBe(offer);
      expect(scene.lootGroup).toEqual(['new overlay']);
      expect(scene._bossRecruitOverlay).toBe('new recruit screen');
      expect([...store.entries()]).toEqual(before);
    } finally {
      overlay.mockRestore();
    }
  });
  it('a settled old death fade cannot splice a unit reintroduced by resume', async () => {
    const { scene } = liveCheckpointHost();
    const unit = { name: 'Restored actor', faction: 'player', currentHP: 0, col: 0, row: 0 };
    scene.playerUnits = [unit];
    scene.removeUnitGraphic = vi.fn();
    let finishFade;
    scene._combatFx = {
      deathFade: () =>
        new Promise((resolve) => {
          finishFade = resolve;
        }),
    };
    const pending = scene.removeUnit(unit);
    restart(scene);
    scene.playerUnits = [unit];
    scene._playerDeathsThisBattle = 0;
    scene.updateObjectiveText = vi.fn();
    finishFade();
    await pending;
    expect(scene.playerUnits).toEqual([unit]);
    expect(scene._playerDeathsThisBattle).toBe(0);
    expect(scene.removeUnitGraphic).not.toHaveBeenCalled();
    expect(scene.updateObjectiveText).not.toHaveBeenCalled();
  });
  it('an old ballista shot cannot apply damage after a synchronous restart', async () => {
    const { scene } = liveCheckpointHost();
    const target = {
      name: 'Restored target',
      currentHP: 20,
      stats: { HP: 20, RES: 0 },
      col: 1,
      row: 0,
    };
    scene.playerUnits = [target];
    scene.ballistas = [{ col: 0, row: 0, owner: 'enemy' }];
    scene._reduceMotion = () => true;
    let finishShot;
    scene._combatFx = {
      ballistaShot: () =>
        new Promise((resolve) => {
          finishShot = resolve;
        }),
    };
    scene.updateHPBar = vi.fn();
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const pending = scene.processBallistaFire([target], 'enemy');
      restart(scene);
      scene.playerUnits = [target];
      finishShot();
      await pending;
      expect(target.currentHP).toBe(20);
      expect(scene.updateHPBar).not.toHaveBeenCalled();
    } finally {
      rng.mockRestore();
    }
  });
  it('XP preparation invalidated before its first award cannot grant XP', async () => {
    const { scene } = sceneWithPendingTween();
    const unit = { name: 'Old actor', level: 10, tier: 'base', currentHP: 20, xp: 0 };
    scene.playerUnits = [unit];
    scene.getEnemyXpMultiplier = () => 1;
    scene.getTurnPressureState = () => {
      restart(scene);
      return { xpMultiplier: 1 };
    };
    scene.awardScaledXP = async (actor, xp) => {
      actor.xp += xp;
    };
    await scene.awardXP(unit, { level: 10, tier: 'base' }, true);
    expect(unit.xp).toBe(0);
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });
});

it.each(['player', 'enemy'])(
  'a completed old %s cleanup cannot decide defeat for the replacement field',
  async (owner) => {
    const { scene } = sceneWithPendingTween();
    const player = { name: 'Old commander', faction: 'player', currentHP: 10, isCommander: true };
    const enemy = { name: 'Old enemy', faction: 'enemy', currentHP: 10 };
    scene.grid = { clearAttackHighlights() {} };
    scene.playerUnits = [player];
    scene.enemyUnits = [enemy];
    scene.escapedUnits = [];
    scene._commitCombatIntent = () => {};
    scene.resetFortHealStreak = () => {};
    scene._prepareCombatContext = () => ({});
    scene._runCombatResolution = async () => ({
      result: { attackerHP: 10, defenderHP: 10, events: [] },
    });
    scene.awardXP = async () => {};
    scene._maybeShowTutorialPermadeathHint = async () => {};
    let release;
    let entered = false;
    scene._sweepFallenUnits = () =>
      new Promise((resolve) => {
        entered = true;
        release = resolve;
      });
    scene.checkBattleEnd = vi.fn();
    scene._clearCombatRollSession = vi.fn();
    scene._clearSelectedWeaponArt = vi.fn();
    const work =
      owner === 'player'
        ? scene.executeCombat(player, enemy)
        : scene.executeEnemyCombat(enemy, player);
    for (let i = 0; i < 12 && !entered; i++) await Promise.resolve();
    expect(entered).toBe(true);
    restart(scene);
    const replacement = { name: 'New commander', isCommander: true, currentHP: 0 };
    scene.playerUnits = [replacement];
    scene.escapedUnits = [];
    release();
    await work;
    expect(scene.checkBattleEnd).not.toHaveBeenCalled();
    expect(scene.playerUnits).toEqual([replacement]);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene._clearCombatRollSession).not.toHaveBeenCalled();
    expect(scene._clearSelectedWeaponArt).not.toHaveBeenCalled();
  },
);
