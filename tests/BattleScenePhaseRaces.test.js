// Regression tests for the two phase-interleaving races (Wave 2):
// 1. The player turn-start pipeline (scheduled +1200ms after the banner) must
//    not fire after a fast End Turn flipped to the enemy phase — heals and
//    ballista shots were landing mid-enemy-phase.
// 2. The enemy-phase tail (terrain damage → reinforcements → battle-end check
//    → endEnemyPhase) must not advance the game when a lord-death Vision
//    prompt is pending or a rewind has superseded the phase, and
//    checkBattleEnd must be idempotent once the battle has ended.

import { afterEach, describe, expect, it, vi } from 'vitest';

const { reportAsyncErrorMock } = vi.hoisted(() => ({
  reportAsyncErrorMock: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

vi.mock('../src/utils/errorReporter.js', () => ({
  reportAsyncError: reportAsyncErrorMock,
}));

vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    async show() {}
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { showImportantHint, showContextualHint } from '../src/ui/HintDisplay.js';
import { TERRAIN } from '../src/utils/constants.js';

afterEach(() => {
  vi.clearAllMocks();
});

function makePlayerPhaseScene() {
  const scene = new BattleScene();
  scene.scene = { isActive: () => true };
  scene.battleParams = { tutorialMode: false };
  scene.battleState = 'PLAYER_IDLE';
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.turnPar = null;
  scene.turnCounterText = null;
  scene._latePressureWarningShown = false;
  scene.grid = { fogEnabled: false, updateFogOfWar: vi.fn() };
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
  scene.processTurnStartEffects = vi.fn(async () => {});
  scene.processBallistaFire = vi.fn(async () => {});
  scene.registry = { get: vi.fn(() => null) };

  const delayedCallbacks = [];
  scene.time = {
    delayedCall: vi.fn((ms, cb) => {
      delayedCallbacks.push({ ms, cb });
      return { remove: vi.fn() };
    }),
  };
  return { scene, delayedCallbacks };
}

describe('player turn-start pipeline vs fast End Turn', () => {
  it('skips turn-start effects when the phase flipped to enemy before the pipeline fired', async () => {
    const { scene, delayedCallbacks } = makePlayerPhaseScene();
    scene.turnManager = { currentPhase: 'player', turnNumber: 3, endPlayerPhase: vi.fn() };

    scene.onPhaseChange('player', 3);
    const pipeline = delayedCallbacks.find((entry) => entry.ms === 1200);
    expect(pipeline).toBeDefined();

    // A forced phase replacement supersedes the queued callback.
    scene.turnManager.currentPhase = 'enemy';
    scene.battleState = 'ENEMY_PHASE';
    await pipeline.cb();

    expect(scene.processTurnStartEffects).not.toHaveBeenCalled();
    expect(scene.processBallistaFire).not.toHaveBeenCalled();
  });

  it('still runs turn-start effects when the phase is unchanged', async () => {
    const { scene, delayedCallbacks } = makePlayerPhaseScene();
    scene.turnManager = { currentPhase: 'player', turnNumber: 3, endPlayerPhase: vi.fn() };

    scene.onPhaseChange('player', 3);
    const pipeline = delayedCallbacks.find((entry) => entry.ms === 1200);
    await pipeline.cb();

    expect(scene.processTurnStartEffects).toHaveBeenCalledTimes(1);
    expect(scene.processBallistaFire).toHaveBeenCalledTimes(1);
  });

  it('skips the pipeline after a rewind moved the game to a different turn', async () => {
    const { scene, delayedCallbacks } = makePlayerPhaseScene();
    scene.turnManager = { currentPhase: 'player', turnNumber: 5, endPlayerPhase: vi.fn() };

    scene.onPhaseChange('player', 5);
    const pipeline = delayedCallbacks.find((entry) => entry.ms === 1200);

    scene.turnManager.turnNumber = 4; // rewound
    await pipeline.cb();

    expect(scene.processTurnStartEffects).not.toHaveBeenCalled();
  });
});

function makeEnemyPhaseScene() {
  const scene = new BattleScene();
  scene.scene = { isActive: () => true };
  scene.battleState = 'ENEMY_PHASE';
  scene.battleConfig = { objective: 'rout' };
  scene.playerUnits = [{ name: 'Edric', currentHP: 10 }];
  scene.enemyUnits = [{ name: 'Brigand', currentHP: 10 }];
  scene.npcUnits = [];
  scene.visionDialog = null;
  scene.isDevToolsEnabled = vi.fn(() => false);
  scene.createEnemyPhaseAiStats = vi.fn(() => ({}));
  scene.finalizeEnemyPhaseAiStats = vi.fn();
  scene.recordEnemyAiDecision = vi.fn();
  scene.dimUnit = vi.fn();
  scene.aiController = { processEnemyPhase: vi.fn(async () => {}) };
  scene.processTerrainDamage = vi.fn(async () => {});
  scene.applyReinforcementsForTurn = vi.fn();
  scene.turnManager = { currentPhase: 'enemy', turnNumber: 4, endEnemyPhase: vi.fn() };
  scene.checkBattleEnd = vi.fn(() => false);
  return scene;
}

describe('enemy-phase tail vs Vision prompt / rewind', () => {
  it('runs the full tail in the normal case', async () => {
    const scene = makeEnemyPhaseScene();
    await scene.startEnemyPhase();
    expect(scene.processTerrainDamage).toHaveBeenCalledTimes(1);
    expect(scene.applyReinforcementsForTurn).toHaveBeenCalledTimes(1);
    expect(scene.turnManager.endEnemyPhase).toHaveBeenCalledTimes(1);
  });

  it('skips the tail entirely when the Vision prompt is open after the AI loop', async () => {
    const scene = makeEnemyPhaseScene();
    scene.aiController.processEnemyPhase = vi.fn(async () => {
      scene.visionDialog = {}; // lord died mid-phase, prompt opened
    });
    await scene.startEnemyPhase();
    expect(scene.processTerrainDamage).not.toHaveBeenCalled();
    expect(scene.applyReinforcementsForTurn).not.toHaveBeenCalled();
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
  });

  it('does not spawn reinforcements or end the phase when a rewind supersedes it mid-tail', async () => {
    const scene = makeEnemyPhaseScene();
    scene.processTerrainDamage = vi.fn(async () => {
      // Rewind clicked during terrain-damage animations.
      scene._enemyPhaseEpoch += 1;
      scene.turnManager.currentPhase = 'player';
      scene.battleState = 'PLAYER_IDLE';
    });
    await scene.startEnemyPhase();
    expect(scene.applyReinforcementsForTurn).not.toHaveBeenCalled();
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
  });

  it('does not end the phase when the tail battle-end check opens the Vision prompt', async () => {
    const scene = makeEnemyPhaseScene();
    scene.checkBattleEnd = vi.fn(() => {
      scene.visionDialog = {}; // Edric died to terrain damage in the tail
      scene.battleState = 'PAUSED';
      return true;
    });
    await scene.startEnemyPhase();
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
  });

  it('blocks AI action callbacks after a rewind bumps the phase epoch', async () => {
    const scene = makeEnemyPhaseScene();
    scene.executeEnemyCombat = vi.fn(async () => {});
    scene.animateEnemyMove = vi.fn(async () => {});
    scene.aiController.processEnemyPhase = vi.fn(async (enemies, players, npcs, callbacks) => {
      // Simulate: prompt opened, player clicked Rewind (dialog closed, epoch
      // bumped, state restored), then the still-draining AI loop fires.
      scene._enemyPhaseEpoch += 1;
      scene.battleState = 'PLAYER_IDLE';
      await callbacks.onAttack(scene.enemyUnits[0], scene.playerUnits[0]);
      await callbacks.onMoveUnit(scene.enemyUnits[0], [{ col: 0, row: 0 }]);
    });
    await scene.startEnemyPhase();
    expect(scene.executeEnemyCombat).not.toHaveBeenCalled();
    expect(scene.animateEnemyMove).not.toHaveBeenCalled();
  });
});

describe('checkBattleEnd idempotence', () => {
  function makeEndCheckScene() {
    const scene = new BattleScene();
    scene.battleConfig = { objective: 'rout' };
    scene.playerUnits = [];
    scene.enemyUnits = [{ name: 'Brigand' }];
    scene.visionDialog = null;
    scene.turnManager = { currentPhase: 'enemy' };
    scene.onDefeat = vi.fn();
    scene.onVictory = vi.fn();
    scene.showLordDeathVisionPrompt = vi.fn(() => true);
    return scene;
  }

  it('returns true without re-triggering defeat once the battle has ended', () => {
    const scene = makeEndCheckScene();
    scene.battleState = 'BATTLE_END';
    expect(scene.checkBattleEnd()).toBe(true);
    expect(scene.onDefeat).not.toHaveBeenCalled();
    expect(scene.showLordDeathVisionPrompt).not.toHaveBeenCalled();
  });

  it('does not stack a second prompt while the Vision dialog is open', () => {
    const scene = makeEndCheckScene();
    scene.battleState = 'PAUSED';
    scene.visionDialog = {};
    expect(scene.checkBattleEnd()).toBe(true);
    expect(scene.showLordDeathVisionPrompt).not.toHaveBeenCalled();
    expect(scene.onDefeat).not.toHaveBeenCalled();
  });

  it('still shows the prompt on first lord death during the enemy phase', () => {
    const scene = makeEndCheckScene();
    scene.battleState = 'ENEMY_PHASE';
    expect(scene.checkBattleEnd()).toBe(true);
    expect(scene.showLordDeathVisionPrompt).toHaveBeenCalledTimes(1);
    expect(scene.onDefeat).not.toHaveBeenCalled();
  });
});

describe('player turn-start input ownership', () => {
  function readyScene() {
    const setup = makePlayerPhaseScene();
    setup.scene.turnManager = { currentPhase: 'player', turnNumber: 3, endPlayerPhase: vi.fn() };
    setup.scene._captureSuspendCheckpoint = vi.fn();
    return setup;
  }
  const pending = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  it('captures queued enemy-phase levels once before presenting them and never reseeds again on dismissal', async () => {
    const { scene, delayedCallbacks } = readyScene();
    scene.playerUnits = [{ name: 'Veteran', currentHP: 20, skills: [], stats: {} }];
    scene._pendingLevelUpPopups = [{ unitName: 'Veteran', levelUp: {}, learnedNames: [] }];
    scene._playLevelUpSfx = vi.fn();
    scene._stopLevelUpSfx = vi.fn();
    scene.updateHPBar = vi.fn();
    scene.onPhaseChange('player', 3);
    await delayedCallbacks.find((entry) => entry.ms === 1200).cb();
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(2);
    expect(scene._captureSuspendCheckpoint).toHaveBeenLastCalledWith({ preserveRng: true });
    expect(scene._pendingLevelUpPopups).toEqual([]);
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });

  it('blocks End Turn and selection through banner, healing and ballista, then unlocks once', async () => {
    const { scene, delayedCallbacks } = readyScene();
    const healing = pending();
    const ballista = pending();
    scene.processTurnStartEffects = vi.fn(() => healing.promise);
    scene.processBallistaFire = vi.fn(() => ballista.promise);
    scene.onPhaseChange('player', 3);
    expect(scene.battleState).toBe('TURN_START_RESOLVING');
    expect(scene.canForceEndTurn()).toBe(false);
    scene.forceEndTurn();
    scene.selectUnit({ name: 'Sera' });
    expect(scene.selectedUnit).toBeUndefined();
    expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
    expect(scene.captureVisionSnapshot).not.toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    const running = delayedCallbacks.find((entry) => entry.ms === 1200).cb();
    await Promise.resolve();
    scene.forceEndTurn();
    expect(scene.canForceEndTurn()).toBe(false);
    healing.resolve();
    await Promise.resolve();
    await Promise.resolve();
    scene.forceEndTurn();
    expect(scene.canForceEndTurn()).toBe(false);
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    ballista.resolve();
    await running;
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.canForceEndTurn()).toBe(true);
    expect(scene.processTurnStartEffects).toHaveBeenCalledOnce();
    expect(scene.processBallistaFire).toHaveBeenCalledOnce();
    expect(scene.captureVisionSnapshot).toHaveBeenCalledOnce();
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledOnce();
    expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
  });

  it.each(['defeat', 'rewind', 'shutdown', 'prompt'])(
    'does not continue or unlock after %s during healing',
    async (kind) => {
      const { scene, delayedCallbacks } = readyScene();
      const healing = pending();
      scene.processTurnStartEffects = vi.fn(() => healing.promise);
      scene.onPhaseChange('player', 3);
      const running = delayedCallbacks.find((entry) => entry.ms === 1200).cb();
      await Promise.resolve();
      if (kind === 'defeat') scene.battleState = 'BATTLE_END';
      if (kind === 'rewind') {
        scene._enemyPhaseEpoch = 1;
        scene.battleState = 'PLAYER_IDLE';
      }
      if (kind === 'shutdown') scene.scene.isActive = () => false;
      if (kind === 'prompt') {
        scene.visionDialog = {};
        scene.battleState = 'PAUSED';
      }
      const state = scene.battleState;
      healing.resolve();
      await running;
      expect(scene.processBallistaFire).not.toHaveBeenCalled();
      expect(scene.captureVisionSnapshot).not.toHaveBeenCalled();
      expect(scene.battleState).toBe(state);
      expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
      expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
    },
  );

  it('does not restore idle or checkpoint when ballista ends the battle', async () => {
    const { scene, delayedCallbacks } = readyScene();
    scene.processBallistaFire = vi.fn(async () => {
      scene.battleState = 'BATTLE_END';
    });
    scene.onPhaseChange('player', 3);
    await delayedCallbacks.find((entry) => entry.ms === 1200).cb();
    expect(scene.battleState).toBe('BATTLE_END');
    expect(scene.captureVisionSnapshot).not.toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
  });

  it('waits for effects before opening first-turn hints', async () => {
    const { scene, delayedCallbacks } = readyScene();
    scene.turnManager.turnNumber = 1;
    scene.registry.get = () => ({ shouldShow: () => true });
    const healing = pending();
    scene.processTurnStartEffects = vi.fn(() => healing.promise);
    scene.onPhaseChange('player', 1);
    const running = delayedCallbacks.find((entry) => entry.ms === 1200).cb();
    const hint = delayedCallbacks.find((entry) => entry.ms === 1500).cb();
    await Promise.resolve();
    expect(scene.battleState).toBe('TURN_START_RESOLVING');
    expect(showContextualHint).not.toHaveBeenCalled();
    healing.resolve();
    await running;
    await hint;
    expect(showContextualHint).toHaveBeenCalledOnce();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });

  it('stops remaining terrain heals after an await invalidates the turn', async () => {
    const { scene } = readyScene();
    const units = [0, 1].map((col) => ({ col, row: 0, currentHP: 10, stats: { HP: 20 } }));
    scene.grid.mapLayout = [[TERRAIN.Fort, TERRAIN.Fort]];
    scene.updateHPBar = vi.fn();
    let current = true;
    scene.animateHeal = vi.fn(async () => {
      current = false;
    });
    await scene.processTerrainHealing(units, () => current);
    expect(units[0].currentHP).toBeGreaterThan(10);
    expect(units[1].currentHP).toBe(10);
    expect(scene.animateHeal).toHaveBeenCalledOnce();
  });

  it('reports an effect error and unlocks without capturing a partial-effects checkpoint', async () => {
    const { scene, delayedCallbacks } = readyScene();
    scene.processTurnStartEffects = vi.fn(async () => {
      throw new Error('heal animation failed');
    });
    scene.showBriefBanner = vi.fn();
    scene.onPhaseChange('player', 3);
    await delayedCallbacks.find((entry) => entry.ms === 1200).cb();
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.showBriefBanner).toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
  });
});

describe('enemy-phase error recovery', () => {
  function makeFailingEnemyPhaseScene() {
    const scene = makeEnemyPhaseScene();
    scene.battleState = 'PLAYER_IDLE';
    scene.turnManager.currentPhase = 'enemy';
    scene._isSceneActiveForAsync = () => true;
    scene.updateAntiTurtlePressure = vi.fn();
    scene.grid = { tickTemporaryTerrains: vi.fn() };
    scene.showPhaseBanner = vi.fn();
    scene.dangerZone = { hide: vi.fn() };
    scene.refreshEndTurnControl = vi.fn();
    scene.processTurnStartEffects = vi.fn(async () => {});
    scene.processZombieRevival = vi.fn(async () => {});
    scene.processBallistaFire = vi.fn(async () => {});
    scene.applyDueHybridOverridesForTurn = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.showBriefBanner = vi.fn();
    scene.playerUnits[0].graphic = {};
    scene.enemyUnits[0].graphic = {};
    const delayed = [];
    scene.time = {
      delayedCall: vi.fn((ms, cb) => {
        const timer = { ms, cb, remove: vi.fn() };
        delayed.push(timer);
        return timer;
      }),
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return { scene, delayed };
  }

  async function runEnemyPipeline(scene, delayed) {
    scene.onPhaseChange('enemy', 4);
    const pipeline = delayed.find((entry) => entry.ms === 1400);
    expect(pipeline).toBeDefined();
    await pipeline.cb();
  }

  it('hands the turn back to the player when the AI throws', async () => {
    const { scene, delayed } = makeFailingEnemyPhaseScene();
    scene.aiController.processEnemyPhase = vi.fn(async () => {
      throw new TypeError('ai exploded');
    });

    await runEnemyPipeline(scene, delayed);

    expect(reportAsyncErrorMock).toHaveBeenCalledWith(
      'battle_delayed_async_error',
      expect.any(TypeError),
      expect.objectContaining({ label: 'enemy_phase_turn_start_pipeline' }),
    );
    expect(scene.applyReinforcementsForTurn).toHaveBeenCalledWith(4);
    expect(scene.checkBattleEnd).toHaveBeenCalled();
    expect(scene.turnManager.endEnemyPhase).toHaveBeenCalledTimes(1);
    expect(scene.updateUnitPosition).toHaveBeenCalledTimes(2);
    expect(scene._reinforcementsPendingThisTurn).toBe(false);
  });

  it('recovers from a turn-start effect error before the AI runs', async () => {
    const { scene, delayed } = makeFailingEnemyPhaseScene();
    scene.processTurnStartEffects = vi.fn(async () => {
      throw new Error('poison tick failed');
    });

    await runEnemyPipeline(scene, delayed);

    expect(scene.aiController.processEnemyPhase).not.toHaveBeenCalled();
    expect(scene.turnManager.endEnemyPhase).toHaveBeenCalledTimes(1);
  });

  it('does not re-apply reinforcements the tail already spawned this turn', async () => {
    const { scene, delayed } = makeFailingEnemyPhaseScene();
    scene.turnManager.endEnemyPhase = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('phase change failed');
      })
      .mockImplementation(() => {});

    await runEnemyPipeline(scene, delayed);

    expect(scene.applyReinforcementsForTurn).toHaveBeenCalledTimes(1);
    expect(scene.turnManager.endEnemyPhase).toHaveBeenCalledTimes(2);
  });

  it('ends the battle instead of the phase when the recovery check finds it over', async () => {
    const { scene, delayed } = makeFailingEnemyPhaseScene();
    scene.aiController.processEnemyPhase = vi.fn(async () => {
      throw new Error('boom');
    });
    scene.checkBattleEnd = vi.fn(() => true);

    await runEnemyPipeline(scene, delayed);

    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
  });

  it.each([
    ['the battle already ended', (s) => (s.battleState = 'BATTLE_END')],
    ['a Vision prompt owns the flow', (s) => (s.visionDialog = {})],
    ['a rewind returned to the player phase', (s) => (s.turnManager.currentPhase = 'player')],
    ['a different turn is running', (s) => (s.turnManager.turnNumber = 5)],
  ])('stands down when %s', (_label, mutate) => {
    const { scene } = makeFailingEnemyPhaseScene();
    scene.battleState = 'ENEMY_PHASE';
    mutate(scene);

    expect(scene._recoverEnemyPhaseError(4, new Error('late'))).toBe(false);
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
    expect(scene.applyReinforcementsForTurn).not.toHaveBeenCalled();
  });
});
