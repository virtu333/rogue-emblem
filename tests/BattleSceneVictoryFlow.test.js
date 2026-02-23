import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: vi.fn(async () => true),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { transitionToScene, TRANSITION_REASONS } from '../src/utils/SceneRouter.js';

describe('BattleScene onVictory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions to NodeMap and skips loot/recruit when completeBattle is a no-op', async () => {
    const scene = new BattleScene();
    scene.battleState = 'PLAYER_IDLE';
    scene.battleParams = { tutorialMode: false };
    scene.scene = { isActive: () => true };
    scene.cameras = { main: { centerX: 320, centerY: 240 } };
    scene.add = {
      text: vi.fn(() => ({
        setOrigin() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy: vi.fn(),
      })),
    };
    const pending = [];
    scene.time = {
      delayedCall: vi.fn((_ms, cb) => {
        pending.push(cb());
      }),
    };
    const audio = { playMusic: vi.fn() };
    scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
    scene.clearBattleScopedDeltas = vi.fn();
    scene.playerUnits = [{ name: 'Edric', stats: { HP: 20 } }];
    scene.nonDeployedUnits = [];
    scene.getTurnPressureState = vi.fn(() => ({ goldMultiplier: 1 }));
    scene.goldEarned = 50;
    scene.nodeId = 'node_1';
    scene.gameData = {};
    scene.isBoss = true;
    scene.showBossRecruitScreen = vi.fn();
    scene.showLootScreen = vi.fn();
    scene.runManager = {
      completeBattle: vi.fn(() => false),
    };

    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);

    expect(scene.runManager.completeBattle).toHaveBeenCalledTimes(1);
    expect(scene.showBossRecruitScreen).not.toHaveBeenCalled();
    expect(scene.showLootScreen).not.toHaveBeenCalled();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'NodeMap',
      { gameData: scene.gameData, runManager: scene.runManager },
      { reason: TRANSITION_REASONS.BATTLE_COMPLETE },
    );
  });
});

/* ─── Transition recovery tests ─── */

/** Helper: minimal scene mock for transition-path tests. */
function makeTransitionScene(overrides = {}) {
  const scene = new BattleScene();
  scene.isTransitioningOut = false;
  scene.gameData = {};
  scene.runManager = {
    isActComplete: vi.fn(() => false),
    isRunComplete: vi.fn(() => false),
    settleEndRunRewards: vi.fn(),
    currentAct: 1,
    ...overrides.runManager,
  };
  scene.registry = { get: () => null };
  scene.showLootStatus = vi.fn();
  scene.reportLootError = vi.fn();
  scene._postLootTransitionCompleted = false;
  scene._postLootTransitionTimer = null;
  scene._clearPostLootTransitionFallback = vi.fn();
  return scene;
}

describe('transitionAfterBattle recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false on re-entrant call (isTransitioningOut=true)', async () => {
    const scene = makeTransitionScene();
    scene.isTransitioningOut = true;
    const result = await scene.transitionAfterBattle();
    expect(result).toBe(false);
    expect(transitionToScene).not.toHaveBeenCalled();
  });

  it('calls forceTransitionAfterBattle when transition returns false', async () => {
    transitionToScene.mockResolvedValueOnce(false);
    const scene = makeTransitionScene();
    scene.forceTransitionAfterBattle = vi.fn();
    const result = await scene.transitionAfterBattle();
    expect(result).toBe(false);
    expect(scene.isTransitioningOut).toBe(false);
    expect(scene.forceTransitionAfterBattle).toHaveBeenCalledTimes(1);
  });
});

describe('forceTransitionAfterBattle recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error UI when transition to NodeMap returns false', async () => {
    transitionToScene.mockResolvedValueOnce(false);
    const scene = makeTransitionScene();
    await scene.forceTransitionAfterBattle();
    expect(scene.showLootStatus).toHaveBeenCalledWith(
      'Transition failed. Refresh and continue run.',
      '#ff8888',
    );
  });

  it('shows victory recovery UI when transition to RunComplete returns false', async () => {
    transitionToScene.mockResolvedValueOnce(false);
    const scene = makeTransitionScene({
      runManager: { isRunComplete: vi.fn(() => true), settleEndRunRewards: vi.fn() },
    });
    scene.showVictoryTransitionRecovery = vi.fn();
    await scene.forceTransitionAfterBattle();
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'RunComplete',
      expect.objectContaining({ result: 'victory' }),
      expect.any(Object),
    );
    expect(scene.showVictoryTransitionRecovery).toHaveBeenCalledTimes(1);
    expect(scene.showLootStatus).not.toHaveBeenCalled();
  });

  it('shows error UI when transition throws', async () => {
    transitionToScene.mockRejectedValueOnce(new Error('boom'));
    const scene = makeTransitionScene();
    await scene.forceTransitionAfterBattle();
    expect(scene.showLootStatus).toHaveBeenCalledWith(
      'Transition failed. Refresh and continue run.',
      '#ff8888',
    );
  });
});

describe('completeBattle no-op double-failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error UI when retry transition also returns false', async () => {
    // Both calls return false (initial + retry)
    transitionToScene.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    const scene = new BattleScene();
    scene.battleState = 'PLAYER_IDLE';
    scene.battleParams = { tutorialMode: false };
    scene.scene = { isActive: () => true };
    scene.cameras = { main: { centerX: 320, centerY: 240 } };
    scene.add = {
      text: vi.fn(() => ({
        setOrigin() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy: vi.fn(),
      })),
    };
    const pending = [];
    scene.time = {
      delayedCall: vi.fn((_ms, cb) => {
        pending.push(cb());
      }),
    };
    const audio = { playMusic: vi.fn() };
    scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
    scene.clearBattleScopedDeltas = vi.fn();
    scene.playerUnits = [{ name: 'Edric', stats: { HP: 20 } }];
    scene.nonDeployedUnits = [];
    scene.getTurnPressureState = vi.fn(() => ({ goldMultiplier: 1 }));
    scene.goldEarned = 50;
    scene.nodeId = 'node_1';
    scene.gameData = {};
    scene.isBoss = false;
    scene.showLootStatus = vi.fn();
    scene.runManager = {
      completeBattle: vi.fn(() => false),
    };

    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);

    // First call fails, retry also fails
    expect(transitionToScene).toHaveBeenCalledTimes(2);
    expect(scene.showLootStatus).toHaveBeenCalledWith(
      'Transition failed. Refresh and continue run.',
      '#ff8888',
    );
  });

  it('shows error UI when no-op transition throws', async () => {
    transitionToScene.mockRejectedValueOnce(new Error('scene destroyed'));

    const scene = new BattleScene();
    scene.battleState = 'PLAYER_IDLE';
    scene.battleParams = { tutorialMode: false };
    scene.scene = { isActive: () => true };
    scene.cameras = { main: { centerX: 320, centerY: 240 } };
    scene.add = {
      text: vi.fn(() => ({
        setOrigin() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy: vi.fn(),
      })),
    };
    const pending = [];
    scene.time = {
      delayedCall: vi.fn((_ms, cb) => {
        pending.push(cb());
      }),
    };
    const audio = { playMusic: vi.fn() };
    scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
    scene.clearBattleScopedDeltas = vi.fn();
    scene.playerUnits = [{ name: 'Edric', stats: { HP: 20 } }];
    scene.nonDeployedUnits = [];
    scene.getTurnPressureState = vi.fn(() => ({ goldMultiplier: 1 }));
    scene.goldEarned = 50;
    scene.nodeId = 'node_1';
    scene.gameData = {};
    scene.isBoss = false;
    scene.showLootStatus = vi.fn();
    scene.runManager = {
      completeBattle: vi.fn(() => false),
    };

    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);

    expect(transitionToScene).toHaveBeenCalledTimes(1);
    expect(scene.showLootStatus).toHaveBeenCalledWith(
      'Transition failed. Refresh and continue run.',
      '#ff8888',
    );
  });
});

/* ─── Integration tests for real showVictoryTransitionRecovery ─── */

/** Helper: scene mock with add.rectangle + add.text stubs for recovery UI. */
function makeRecoveryScene(overrides = {}) {
  const scene = new BattleScene();
  scene.cameras = { main: { centerX: 320, centerY: 240, width: 640, height: 480 } };
  scene.add = {
    rectangle: vi.fn(() => ({
      setDepth() {
        return this;
      },
      setInteractive() {
        return this;
      },
      setStrokeStyle() {
        return this;
      },
      destroy: vi.fn(),
    })),
    text: vi.fn(() => ({
      setOrigin() {
        return this;
      },
      setDepth() {
        return this;
      },
      setInteractive() {
        return this;
      },
      disableInteractive() {
        return this;
      },
      setColor() {
        return this;
      },
      setText(t) {
        this.text = t;
        return this;
      },
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    })),
  };
  scene._pinToScreen = vi.fn();
  scene.victoryRecoveryPrompt = null;
  scene._victoryBanner = null;
  scene.registry = { get: () => null };
  Object.assign(scene, overrides);
  return scene;
}

describe('showVictoryTransitionRecovery (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates UI group with 6 elements on real BattleScene', () => {
    const scene = makeRecoveryScene();
    scene.showVictoryTransitionRecovery();
    expect(scene.victoryRecoveryPrompt).not.toBeNull();
    expect(scene.victoryRecoveryPrompt.length).toBe(6);
    expect(scene.add.rectangle).toHaveBeenCalledTimes(2); // blocker + panel
    expect(scene.add.text).toHaveBeenCalledTimes(4); // title + msg + retry + title btn
  });

  it('dedup guard prevents duplicate UI on second call', () => {
    const scene = makeRecoveryScene();
    scene.showVictoryTransitionRecovery();
    const firstGroup = scene.victoryRecoveryPrompt;
    scene.showVictoryTransitionRecovery();
    expect(scene.victoryRecoveryPrompt).toBe(firstGroup);
    // Should not have created additional elements
    expect(scene.add.rectangle).toHaveBeenCalledTimes(2);
    expect(scene.add.text).toHaveBeenCalledTimes(4);
  });

  it('destroys victory banner before showing recovery UI', () => {
    const banner = { destroy: vi.fn() };
    const scene = makeRecoveryScene({ _victoryBanner: banner });
    scene.showVictoryTransitionRecovery();
    expect(banner.destroy).toHaveBeenCalledTimes(1);
    expect(scene._victoryBanner).toBeNull();
    expect(scene.victoryRecoveryPrompt.length).toBe(6);
  });

  it('Retry button calls transitionToRunCompleteWithRetry on click', async () => {
    const scene = makeRecoveryScene();
    scene.transitionToRunCompleteWithRetry = vi.fn().mockResolvedValue(true);
    scene.showVictoryTransitionRecovery();
    const retryBtn = scene.victoryRecoveryPrompt[4];
    const pointerdownCall = retryBtn.on.mock.calls.find((c) => c[0] === 'pointerdown');
    expect(pointerdownCall).toBeDefined();
    await pointerdownCall[1](); // invoke the handler
    expect(scene.transitionToRunCompleteWithRetry).toHaveBeenCalledWith('victory');
  });

  it('Title button calls transitionToScene with Title target on click', async () => {
    const scene = makeRecoveryScene();
    scene.showVictoryTransitionRecovery();
    const titleBtn = scene.victoryRecoveryPrompt[5];
    const pointerdownCall = titleBtn.on.mock.calls.find((c) => c[0] === 'pointerdown');
    expect(pointerdownCall).toBeDefined();
    pointerdownCall[1](); // invoke the handler (sync, fires .then internally)
    await new Promise((r) => setTimeout(r, 0)); // flush microtask for .then
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'Title',
      expect.objectContaining({ gameData: scene.gameData }),
      expect.objectContaining({ reason: TRANSITION_REASONS.RETURN_TITLE }),
    );
  });
});

describe('_startPostLootTransition fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not clear fallback timer when transitionAfterBattle returns false', async () => {
    transitionToScene.mockResolvedValueOnce(false);
    const scene = makeTransitionScene();
    scene.forceTransitionAfterBattle = vi.fn();
    scene.isStoryInputLocked = vi.fn(() => false);

    scene._startPostLootTransition();

    // Let the promise chain settle
    await vi.advanceTimersByTimeAsync(0);

    // Fallback timer should NOT have been cleared
    expect(scene._postLootTransitionCompleted).toBe(false);
    // The real _clearPostLootTransitionFallback was replaced by our mock,
    // so check the timer field is still set (not cleared)
    expect(scene._postLootTransitionTimer).not.toBeNull();
  });
});
