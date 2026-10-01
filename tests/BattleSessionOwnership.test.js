import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
import { DialogueOverlay } from '../src/ui/DialogueOverlay.js';
import { LootFlowController } from '../src/ui/LootFlowController.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { HealController } from '../src/ui/HealController.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import {
  captureResolvedAction,
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
afterEach(() => vi.useRealTimers());

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
    scene._getCombatFx = () => ({});
    scene.finishUnitAction = vi.fn();
    scene._recoverUnitActionError = vi.fn();
    scene.animateHeal = () =>
      new Promise((_r, j) => {
        reject = j;
      });
    let reject;
    const healer = {
      name: 'Old healer',
      stats: { MAG: 5 },
      weapon: { type: 'Staff', name: 'Heal', healBase: 5 },
      inventory: [],
      faction: 'player',
    };
    const target = { name: 'Old target', stats: { HP: 20 }, currentHP: 10 };
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
    expect(completeBattleAction(scene, unit)).toBe(false);
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
    expect(scene._persistBattleRunState()).toEqual({ ok: false, reason: 'missing_run' });
    expect(scene._persistBattleRunState(null, { session: oldSession })).toEqual({
      ok: false,
      reason: 'stale_session',
    });
    scene.sys.settings.active = false;
    expect(scene._persistBattleRunState()).toEqual({ ok: false, reason: 'stale_session' });
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
