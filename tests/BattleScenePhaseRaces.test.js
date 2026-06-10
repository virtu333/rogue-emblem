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
}));

vi.mock('../src/utils/errorReporter.js', () => ({
  reportAsyncError: reportAsyncErrorMock,
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

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

    // Player presses E during the banner delay: phase is now enemy.
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
