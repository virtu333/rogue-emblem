import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transitionToSceneMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
}));

vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: transitionToSceneMock,
    restartScene: vi.fn(),
  };
});

import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';
import { LootScreenController } from '../src/ui/LootScreenController.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';

function makeTextObject() {
  return {
    active: true,
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    destroy: vi.fn(),
  };
}

function makeScene() {
  const audio = {
    playMusic: vi.fn(),
    stopMusic: vi.fn(),
  };
  return {
    battleState: 'PLAYER_IDLE',
    _reinforcementsPendingThisTurn: true,
    _victoryPressureState: null,
    _completionGoldAward: 0,
    _battleCompletionAwardedGold: 0,
    _postLootTransitionCompleted: false,
    isTransitioningOut: false,
    gameData: {},
    battleParams: { tutorialMode: false, act: 'act1' },
    nodeId: 'node-1',
    goldEarned: 50,
    isBoss: true,
    isElite: false,
    playerUnits: [],
    nonDeployedUnits: [],
    turnPar: 10,
    turnBonusConfig: {
      brackets: [
        { threshold: 0, rating: 'S', bonusMultiplier: 1.0 },
        { threshold: 3, rating: 'A', bonusMultiplier: 0.6 },
        { threshold: Infinity, rating: 'C', bonusMultiplier: 0.0 },
      ],
      baseBonusGold: { act1: 100 },
    },
    turnManager: { turnNumber: 4 },
    cameras: { main: { centerX: 320, centerY: 240, height: 480 } },
    add: {
      text: vi.fn(() => makeTextObject()),
    },
    registry: {
      get: vi.fn((key) => {
        if (key === 'audio') return audio;
        if (key === 'meta') return null;
        return null;
      }),
    },
    scene: {
      isActive: vi.fn(() => true),
    },
    time: {
      delayedCall: vi.fn((_ms, cb) => {
        cb();
      }),
    },
    runManager: {
      gold: 100,
      metaEffects: {},
      completeBattle: vi.fn(() => true),
      isRunComplete: vi.fn(() => true),
      isActComplete: vi.fn(() => false),
      shouldTriggerThirdLord: vi.fn(() => false),
      currentAct: 'act1',
      status: 'active',
      settleEndRunRewards: vi.fn(),
      awardGold: vi.fn(),
      failRun: vi.fn(),
      roster: [],
      resolveThirdLord: vi.fn(),
    },
    getTurnPressureState: vi.fn(() => ({ goldMultiplier: 1, active: false })),
    clearBattleScopedDeltas: vi.fn(),
    _pinToScreen: vi.fn(),
    _resolveBossDialogueName: vi.fn(() => 'boss_a'),
    _showStoryDialogueOnce: vi.fn(async () => {}),
    _transitionTutorialToTitle: vi.fn(),
    _clearPostLootTransitionFallback: vi.fn(),
    _awardTurnBonusGold: vi.fn(() => 33),
    transitionAfterBattle: vi.fn(async () => true),
    showBossRecruitScreen: vi.fn(),
    showLootScreen: vi.fn(),
    _showThirdLordArrival: vi.fn(),
    showVictoryTransitionRecovery: vi.fn(),
    showLootStatus: vi.fn(),
    reportLootError: vi.fn(),
    forceTransitionAfterBattle: vi.fn(),
  };
}

describe('PostCombatController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transitionToSceneMock.mockResolvedValue(true);
  });

  it('onVictory (run complete) awards turn bonus and delegates transition via scene methods', () => {
    const scene = makeScene();
    const controller = new PostCombatController(scene);

    controller.onVictory();

    expect(scene.battleState).toBe('BATTLE_END');
    expect(scene.runManager.completeBattle).toHaveBeenCalledTimes(1);
    expect(scene._awardTurnBonusGold).toHaveBeenCalledTimes(1);
    expect(scene.transitionAfterBattle).toHaveBeenCalledTimes(1);
  });

  it('onVictory merges escaped units into the surviving roster (escape objective)', () => {
    const scene = makeScene();
    scene.playerUnits = [
      { name: 'Edric', className: 'Lord', faction: 'player', stats: {}, inventory: [] },
    ];
    scene.escapedUnits = [
      { name: 'Rec1', className: 'Fighter', faction: 'player', stats: {}, inventory: [] },
    ];

    new PostCombatController(scene).onVictory();

    const [allUnits] = scene.runManager.completeBattle.mock.calls[0];
    expect(allUnits.map((u) => u.name)).toEqual(expect.arrayContaining(['Edric', 'Rec1']));
  });

  it('onVictory persists the run right after completeBattle (anti-refresh win lock)', () => {
    const scene = makeScene();
    scene._persistBattleRunState = vi.fn();

    const controller = new PostCombatController(scene);
    controller.onVictory();

    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
    // The save must capture the completed battle, so completion runs first
    const completeOrder = scene.runManager.completeBattle.mock.invocationCallOrder[0];
    const persistOrder = scene._persistBattleRunState.mock.invocationCallOrder[0];
    expect(persistOrder).toBeGreaterThan(completeOrder);
  });

  it('onDefeat persists the failed run so a banner refresh cannot rewind it', () => {
    const scene = makeScene();
    scene.clearInspectionVisuals = vi.fn();
    scene.hideActionMenu = vi.fn();
    scene._persistBattleRunState = vi.fn();
    scene.transitionToRunCompleteWithRetry = vi.fn(async () => true);

    const controller = new PostCombatController(scene);
    controller.onDefeat();

    expect(scene.runManager.failRun).toHaveBeenCalledTimes(1);
    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
    // The persist must capture the failed status — failRun runs first
    const failOrder = scene.runManager.failRun.mock.invocationCallOrder[0];
    const persistOrder = scene._persistBattleRunState.mock.invocationCallOrder[0];
    expect(persistOrder).toBeGreaterThan(failOrder);
  });

  it('transitionAfterBattle reports error and triggers force fallback when transition throws', async () => {
    const scene = makeScene();
    scene.runManager.isActComplete = vi.fn(() => false);
    transitionToSceneMock.mockRejectedValueOnce(new Error('boom'));

    const controller = new PostCombatController(scene);
    const ok = await controller.transitionAfterBattle();

    expect(ok).toBe(false);
    expect(scene.isTransitioningOut).toBe(false);
    expect(scene.reportLootError).toHaveBeenCalledWith(
      'transitionAfterBattle',
      expect.any(Error),
      expect.objectContaining({ nodeId: scene.nodeId }),
    );
    expect(scene.forceTransitionAfterBattle).toHaveBeenCalledTimes(1);
  });

  it('showLootScreen initializes loot state and forwards lootGroup from LootScreenController', () => {
    const scene = makeScene();
    scene.isElite = true;

    const renderSpy = vi
      .spyOn(LootScreenController.prototype, 'renderCards')
      .mockImplementation(function () {
        this.lootGroup = ['loot-card'];
      });

    const controller = new PostCombatController(scene);
    controller.showLootScreen();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(scene._elitePicksRemaining).toBeGreaterThan(1);
    expect(scene._lootCleanedUp).toBe(false);
    expect(scene._lootResolving).toBe(false);
    expect(scene.lootGroup).toEqual(['loot-card']);
    renderSpy.mockRestore();
  });

  it('transitionToRunCompleteWithRetry resolves false when every attempt hangs (watchdog)', async () => {
    // Regression: a hung transitionToScene used to stall the defeat flow
    // forever — the recovery UI never appeared because the await never settled.
    vi.useFakeTimers();
    try {
      const scene = makeScene();
      transitionToSceneMock.mockImplementation(() => new Promise(() => {}));
      const controller = new PostCombatController(scene);

      const pending = controller.transitionToRunCompleteWithRetry('defeat');
      // 4 attempts × 6s watchdog each (retry waits run synchronously in the mock).
      await vi.advanceTimersByTimeAsync(4 * 6000 + 1000);

      await expect(pending).resolves.toBe(false);
      expect(transitionToSceneMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('transitionToRunCompleteWithRetry uses RunComplete + VICTORY reason when result=victory', async () => {
    const scene = makeScene();
    const controller = new PostCombatController(scene);

    const ok = await controller.transitionToRunCompleteWithRetry('victory');

    expect(ok).toBe(true);
    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'RunComplete',
      expect.objectContaining({ result: 'victory' }),
      { reason: TRANSITION_REASONS.VICTORY },
    );
  });
});
