import { afterEach, describe, expect, it, vi } from 'vitest';

const { showImportantHintMock, showMinorHintMock, reportAsyncErrorMock } = vi.hoisted(() => ({
  showImportantHintMock: vi.fn(async () => {}),
  showMinorHintMock: vi.fn(),
  reportAsyncErrorMock: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: showImportantHintMock,
  showMinorHint: showMinorHintMock,
}));

vi.mock('../src/utils/errorReporter.js', () => ({
  reportAsyncError: reportAsyncErrorMock,
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('BattleScene async guards', () => {
  it('restores tutorial hint state when blocking hint throws', async () => {
    const scene = new BattleScene();
    scene.scene = { isActive: () => true };
    scene.battleState = 'UNIT_SELECTED';
    scene.refreshEndTurnControl = vi.fn();
    showImportantHintMock.mockRejectedValueOnce(new Error('hint failed'));

    await expect(scene._showTutorialBlockingInstruction('test hint')).rejects.toThrow(
      'hint failed',
    );

    expect(scene.battleState).toBe('UNIT_SELECTED');
    expect(scene._tutorialBlockingPromptActive).toBe(false);
    expect(scene.refreshEndTurnControl).toHaveBeenCalledTimes(1);
  });

  it('restores tutorial hint state when blocking hint completes while scene is inactive', async () => {
    const scene = new BattleScene();
    scene.scene = { isActive: () => false };
    scene.battleState = 'UNIT_SELECTED';
    scene.refreshEndTurnControl = vi.fn();

    await expect(scene._showTutorialBlockingInstruction('test hint')).resolves.toBe(true);

    expect(scene.battleState).toBe('UNIT_SELECTED');
    expect(scene._tutorialBlockingPromptActive).toBe(false);
    expect(scene.refreshEndTurnControl).toHaveBeenCalledTimes(1);
  });

  it('auto-advance path still ends player phase when delayed callback pipeline fails', async () => {
    const scene = new BattleScene();
    const sleeper = {
      name: 'Sleeper',
      col: 1,
      row: 1,
      currentHP: 20,
      hasMoved: false,
      hasActed: false,
      _movementSpent: 0,
      _gambitUsedThisTurn: false,
      stats: { MOV: 5, HP: 20 },
      moveType: 'Infantry',
      graphic: { clearTint: vi.fn(), setTint: vi.fn() },
    };
    applyCondition(sleeper, 'sleep', 3);

    scene.scene = { isActive: () => true };
    scene.battleParams = { tutorialMode: false };
    scene.battleState = 'PLAYER_IDLE';
    scene.playerUnits = [sleeper];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.turnPar = null;
    scene.turnCounterText = null;
    scene._latePressureWarningShown = false;
    scene.grid = {
      fogEnabled: false,
      updateFogOfWar: vi.fn(),
    };
    scene.showPhaseBanner = vi.fn();
    scene.dangerZone = { hide: vi.fn() };
    scene._clearCombatRollSession = vi.fn();
    scene.undimUnit = vi.fn();
    scene.dimUnit = vi.fn();
    scene.captureVisionSnapshot = vi.fn();
    scene.updateVisionHud = vi.fn();
    scene.refreshEndTurnControl = vi.fn();
    scene.getTurnPressureState = vi.fn(() => ({ active: false }));
    scene.getTurnPressureSummary = vi.fn(() => '');
    scene._expireTimedWeaponArtBuffs = vi.fn();
    scene.processTurnStartEffects = vi.fn(async () => {
      throw new Error('turn start explosion');
    });
    scene.processBallistaFire = vi.fn(async () => {});
    scene.turnManager = {
      currentPhase: 'player',
      turnNumber: 2,
      endPlayerPhase: vi.fn(),
    };
    scene.registry = { get: vi.fn(() => null) };

    const delayedCallbacks = [];
    scene.time = {
      delayedCall: vi.fn((ms, cb) => {
        delayedCallbacks.push({ ms, cb });
        return { remove: vi.fn() };
      }),
    };

    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      scene.onPhaseChange('player', 2);
    } finally {
      Math.random = originalRandom;
    }

    const turnStartEntry = delayedCallbacks.find((entry) => entry.ms === 1200);
    expect(turnStartEntry).toBeDefined();
    await turnStartEntry.cb();

    expect(scene.turnManager.endPlayerPhase).toHaveBeenCalledTimes(1);
    expect(reportAsyncErrorMock).toHaveBeenCalledWith(
      'battle_delayed_async_error',
      expect.any(Error),
      expect.objectContaining({
        label: 'player_phase_turn_start_pipeline',
        phase: 'player',
        turn: 2,
      }),
    );
  });

  it('resolves tween-backed awaits when lifecycle awaits are cancelled', async () => {
    const scene = new BattleScene();
    scene.scene = { isActive: () => true };
    scene.cameras = { main: { centerX: 320, centerY: 240 } };
    scene._pinToScreen = vi.fn();
    const banner = {
      setOrigin() {
        return this;
      },
      setAlpha() {
        return this;
      },
      setDepth() {
        return this;
      },
      destroy: vi.fn(),
    };
    scene.add = {
      text: vi.fn(() => banner),
    };
    const tweenHandle = {
      remove: vi.fn(),
      stop: vi.fn(),
    };
    scene.tweens = {
      add: vi.fn(() => tweenHandle),
    };

    const pending = scene.showBriefBanner('Pending banner');
    await Promise.resolve();
    expect(scene._lifecycleAwaitGuards.size).toBe(1);

    scene._cancelLifecycleAwaits('scene_shutdown');
    await pending;

    expect(tweenHandle.remove).toHaveBeenCalledTimes(1);
    expect(scene._lifecycleAwaitGuards.size).toBe(0);
  });
});
