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

const { finishPrologueMock, offerPrologueLeaveRetryMock } = vi.hoisted(() => ({
  finishPrologueMock: vi.fn(async () => true),
  offerPrologueLeaveRetryMock: vi.fn(async () => false),
}));

vi.mock('../src/ui/PrologueEnding.js', async () => {
  const actual = await vi.importActual('../src/ui/PrologueEnding.js');
  return {
    ...actual,
    finishPrologue: finishPrologueMock,
    offerPrologueLeaveRetry: offerPrologueLeaveRetryMock,
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
    _battleSession: 1,
    battleState: 'PLAYER_IDLE',
    _reinforcementsPendingThisTurn: true,
    _victoryPressureState: null,
    _completionGoldAward: 0,
    _battleCompletionAwardedGold: 0,
    _postLootTransitionCompleted: false,
    isTransitioningOut: false,
    gameData: {},
    battleParams: { act: 'act1' },
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
    showBriefBanner: vi.fn(() => Promise.resolve()),
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

    scene.runManager.roster = [{ name: 'Rec1' }, { name: 'Edric' }];
    new PostCombatController(scene).onVictory();

    const [allUnits] = scene.runManager.completeBattle.mock.calls[0];
    expect(allUnits.map((u) => u.name)).toEqual(['Rec1', 'Edric']);
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

  it('hands recruits who joined and then fell this battle to completeBattle (fallen allies)', () => {
    const scene = makeScene();
    const unit = (name) => ({
      name,
      className: 'Archer',
      faction: 'player',
      stats: {},
      inventory: [],
    });
    scene.playerUnits = [unit('Edric'), unit('Wren')];
    scene.runManager.roster = [{ name: 'Edric' }];
    scene._battleRecruits = [
      { name: 'Daska', entityId: 'u7', unit: { ...unit('Daska'), stats: { HP: 18 } } },
      { name: 'Wren', entityId: 'u8', unit: { ...unit('Wren'), stats: { HP: 18 } } },
    ];
    new PostCombatController(scene).onVictory();
    const [, , , options] = scene.runManager.completeBattle.mock.calls[0];
    expect(options.fallenRecruits.map((u) => u.name)).toEqual(['Daska']);
  });

  it('a lord who joined this battle (recruit-node Talk) is met once the win is committed', async () => {
    const scene = makeScene();
    const met = [];
    const meta = { recordLordsMet: vi.fn((names) => met.push(...names)) };
    scene.registry.get = vi.fn((key) => (key === 'meta' ? meta : null));
    scene.runManager.roster = [{ name: 'Edric', isLord: true }];
    scene.runManager.completeBattle = vi.fn(() => {
      scene.runManager.roster = [
        { name: 'Edric', isLord: true },
        { name: 'Voss', isLord: true },
        { name: 'Daska', isLord: false },
      ];
      return true;
    });
    new PostCombatController(scene).onVictory();
    expect(met).toContain('Voss');
    expect(met).not.toContain('Daska');

    // A no-op completion (battle already settled) records nothing.
    const again = makeScene();
    const idle = { recordLordsMet: vi.fn() };
    again.registry.get = vi.fn((key) => (key === 'meta' ? idle : null));
    again.runManager.completeBattle = vi.fn(() => false);
    new PostCombatController(again).onVictory();
    expect(idle.recordLordsMet).not.toHaveBeenCalled();
    // The no-op path heads back to the route map after a real-timer retry; wait
    // for it here, or its transition lands in a later test's call counts.
    await vi.waitFor(
      () =>
        expect(transitionToSceneMock).toHaveBeenCalledWith(
          again,
          'NodeMap',
          expect.anything(),
          expect.anything(),
        ),
      { timeout: 5000 },
    );
  });

  it("hands the fallen's battle records to completeBattle, their deeds already committed", async () => {
    const { loadGameData } = await import('./testData.js');
    const scene = makeScene();
    scene.gameData = { deeds: loadGameData().deeds };
    scene.nodeId = 'n4';
    scene.runManager.completedBattles = 3;
    scene.runManager.roster = [{ name: 'Bo', unitUid: 'u-bo', faction: 'player' }];
    // Bo killed a boss, then fell (DeedController.onUnitRemoved left this record).
    scene._fallenBattleRecords = [
      { name: 'Bo', unitUid: 'u-bo', battleDeeds: { v: 1, kills: 1, bossKills: 1, bossNames: ['Warchief'] } }, // prettier-ignore
    ];
    new PostCombatController(scene).onVictory();
    const [, , , options] = scene.runManager.completeBattle.mock.calls[0];
    expect(options.fallenBattleRecords).toEqual([
      expect.objectContaining({ name: 'Bo', unitUid: 'u-bo', deeds: expect.any(Object) }),
    ]);
    const [record] = options.fallenBattleRecords;
    expect(record.battleDeeds).toBeUndefined();
    expect(record.deeds.earned.map((e) => e.epithet)).toEqual(['Bane of the Warchief']);
    expect(record.deeds.lastBattle).toBe('act1:n4:3');
  });

  it('passes no fallen recruits when nobody joined mid-battle', () => {
    const scene = makeScene();
    new PostCombatController(scene).onVictory();
    const [, , , options] = scene.runManager.completeBattle.mock.calls[0];
    expect(options.fallenRecruits).toEqual([]);
  });

  it('deeds commit before the units are serialized and saved; the rite plays after the save', async () => {
    const { loadGameData } = await import('./testData.js');
    const { DeedController } = await import('../src/ui/DeedController.js');
    const scene = makeScene();
    scene.gameData = { deeds: loadGameData().deeds };
    scene.nodeId = 'n4';
    scene.battleParams = { deployCount: 2 };
    scene.runManager.completedBattles = 3;
    scene.playerUnits = [
      {
        name: 'Edric',
        className: 'Lord',
        faction: 'player',
        isLord: true,
        currentHP: 9,
        stats: { HP: 20 },
        inventory: [],
        _battleDeeds: { v: 1, crits: 3 },
      },
    ];
    const order = [];
    scene.runManager.completeBattle = vi.fn((units) => {
      order.push({ saved: units[0].deeds?.epithet?.text, scratch: '_battleDeeds' in units[0] });
      return true;
    });
    scene._persistBattleRunState = vi.fn(() => order.push('persist'));
    const present = vi
      .spyOn(DeedController.prototype, 'presentVictory')
      .mockImplementation(async function () {
        order.push({ rite: this.scene._newDeeds.map((d) => d.deedId) });
        this.scene._newDeeds = null;
        return true;
      });
    new PostCombatController(scene).onVictory();
    await vi.waitFor(() => expect(scene.transitionAfterBattle).toHaveBeenCalled());
    present.mockRestore();
    expect(order).toEqual([
      { saved: 'the Keen Edge', scratch: false },
      'persist',
      { rite: ['keen_edge'] },
    ]);
    expect(scene.playerUnits[0].deeds.lastBattle).toBe('act1:n4:3');
  });

  describe('Merchant Caravan reward wiring', () => {
    it('passes caravanSurvived: true to completeBattle when the caravan survived', () => {
      const scene = makeScene();
      scene._caravanController = {
        hadCaravan: vi.fn(() => true),
        caravanSurvived: vi.fn(() => true),
      };

      new PostCombatController(scene).onVictory();

      const [, , , options] = scene.runManager.completeBattle.mock.calls[0];
      expect(options.caravanSurvived).toBe(true);
      expect(scene.showBriefBanner).not.toHaveBeenCalled();
    });

    it('passes caravanSurvived: false and shows a destroyed toast when the caravan died', () => {
      const scene = makeScene();
      scene.showBriefBanner = vi.fn(() => Promise.resolve());
      scene._caravanController = {
        hadCaravan: vi.fn(() => true),
        caravanSurvived: vi.fn(() => false),
      };

      new PostCombatController(scene).onVictory();

      const [, , , options] = scene.runManager.completeBattle.mock.calls[0];
      expect(options.caravanSurvived).toBe(false);
      expect(scene.showBriefBanner).toHaveBeenCalledWith('Caravan destroyed.', expect.any(String));
    });

    it('passes caravanSurvived: false and shows no toast when this battle never had a caravan', () => {
      const scene = makeScene();
      scene.showBriefBanner = vi.fn(() => Promise.resolve());
      scene._caravanController = {
        hadCaravan: vi.fn(() => false),
        caravanSurvived: vi.fn(() => false),
      };

      new PostCombatController(scene).onVictory();

      const [, , , options] = scene.runManager.completeBattle.mock.calls[0];
      expect(options.caravanSurvived).toBe(false);
      expect(scene.showBriefBanner).not.toHaveBeenCalled();
    });

    it('defaults caravanSurvived to false when the scene has no _caravanController', () => {
      const scene = makeScene();
      expect(scene._caravanController).toBeUndefined();

      new PostCombatController(scene).onVictory();

      const [, , , options] = scene.runManager.completeBattle.mock.calls[0];
      expect(options.caravanSurvived).toBe(false);
    });
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

  it('the prologue never opens Run Complete: its failed exit offers its own Retry / Title', async () => {
    for (const fail of [
      () => finishPrologueMock.mockResolvedValueOnce(false),
      () => finishPrologueMock.mockRejectedValueOnce(new Error('boom')),
    ]) {
      vi.clearAllMocks();
      const scene = makeScene();
      scene.runManager.mode = 'prologue';
      scene.runManager.isActComplete = vi.fn(() => true);
      scene.runManager.isRunComplete = vi.fn(() => true);
      fail();
      const controller = new PostCombatController(scene);
      await controller.forceTransitionAfterBattle();
      expect(finishPrologueMock).toHaveBeenCalledTimes(1);
      expect(offerPrologueLeaveRetryMock).toHaveBeenCalledTimes(1);
      expect(scene.showVictoryTransitionRecovery).not.toHaveBeenCalled();
      expect(transitionToSceneMock).not.toHaveBeenCalledWith(
        scene,
        'RunComplete',
        expect.anything(),
        expect.anything(),
      );
    }
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
