import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/Combat.js', async () => {
  const actual = await vi.importActual('../src/engine/Combat.js');
  return {
    ...actual,
    resolveCombat: vi.fn(actual.resolveCombat),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { calculateKillGold } from '../src/engine/LootSystem.js';
import { calculateCombatXP } from '../src/engine/UnitManager.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const turnBonusConfig = gameData.turnBonus;

describe('BattleScene reinforcement reward scaling', () => {
  it('scales awarded XP for reinforcement kills', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});

    const attacker = { level: 8 };
    const defender = {
      level: 4,
      _isReinforcement: true,
      _reinforcementRewardMultiplier: 0.25,
    };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 0.25));
  });

  it('applies +30% XP against boss enemies', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});

    const attacker = { level: 8 };
    const defender = {
      level: 4,
      isBoss: true,
    };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 1.3));
  });

  it('applies +30% XP for elite targets and stacks with reinforcement multiplier', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});

    const attacker = { level: 8 };
    const defender = {
      level: 4,
      isElite: true,
      _isReinforcement: true,
      _reinforcementRewardMultiplier: 0.25,
    };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 0.25 * 1.3));
  });

  it('does not double-apply +30% XP when both boss and elite flags are present', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});

    const attacker = { level: 8 };
    const defender = {
      level: 4,
      isBoss: true,
      isElite: true,
    };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 1.3));
  });

  it('does not apply +30% XP from elite encounter context alone', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});
    scene.isElite = true;

    const attacker = { level: 8 };
    const defender = { level: 4 };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, baseXp);
  });

  it('scales non-lethal XP by damage dealt ratio', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});

    const attacker = { level: 5 };
    const defender = { level: 5 };
    const baseXp = calculateCombatXP(attacker, defender, false);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, false, 5, 20);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 0.25));
  });

  it('awards no XP for zero-damage non-lethal engagements', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});

    const attacker = { level: 8 };
    const defender = { level: 4 };
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, false, 0, 20);

    expect(scene.awardScaledXP).not.toHaveBeenCalled();
  });

  it('applies late-pressure XP multiplier after damage/reinforcement scaling', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});
    scene.turnPar = 10;
    scene.turnManager = { turnNumber: 18 };
    scene.turnBonusConfig = turnBonusConfig;

    const attacker = { level: 8 };
    const defender = { level: 4 };
    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    // turnsOver=8, startOverPar=2, step=ceil((8-2)/2)=3 → xpMult[3]=0.35
    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 0.35));
  });

  it('scales kill gold for reinforcement enemies', async () => {
    const scene = new BattleScene();
    scene.registry = { get: () => ({ playSFX() {} }) };
    scene.removeUnitGraphic = vi.fn();
    scene.updateObjectiveText = vi.fn();
    scene.runManager = {};
    scene.playerUnits = [];
    scene.npcUnits = [];
    scene.gameData = { affixes: [] };
    scene.battleConfig = { objective: 'rout' };
    scene.goldEarned = 0;

    const enemy = {
      faction: 'enemy',
      level: 10,
      col: 1,
      row: 1,
      _isReinforcement: true,
      _reinforcementRewardMultiplier: 0.5,
    };
    scene.enemyUnits = [enemy];

    await BattleScene.prototype.removeUnit.call(scene, enemy);

    expect(scene.goldEarned).toBe(Math.floor(calculateKillGold(enemy) * 0.5));
  });

  it('keeps non-reinforcement boss gold unchanged by XP bonus rules', async () => {
    const scene = new BattleScene();
    scene.registry = { get: () => ({ playSFX() {} }) };
    scene.removeUnitGraphic = vi.fn();
    scene.updateObjectiveText = vi.fn();
    scene.runManager = {};
    scene.playerUnits = [];
    scene.npcUnits = [];
    scene.gameData = { affixes: [] };
    scene.battleConfig = { objective: 'rout' };
    scene.goldEarned = 0;
    scene.isElite = true;

    const enemy = {
      faction: 'enemy',
      level: 10,
      col: 1,
      row: 1,
      isBoss: true,
      isElite: true,
    };
    scene.enemyUnits = [enemy];

    await BattleScene.prototype.removeUnit.call(scene, enemy);

    expect(scene.goldEarned).toBe(calculateKillGold(enemy));
  });

  it('applies late-pressure gold multiplier to kill rewards', async () => {
    const scene = new BattleScene();
    scene.registry = { get: () => ({ playSFX() {} }) };
    scene.removeUnitGraphic = vi.fn();
    scene.updateObjectiveText = vi.fn();
    scene.runManager = {};
    scene.playerUnits = [];
    scene.npcUnits = [];
    scene.gameData = { affixes: [] };
    scene.battleConfig = { objective: 'rout' };
    scene.goldEarned = 0;
    scene.turnPar = 10;
    scene.turnManager = { turnNumber: 18 };
    scene.turnBonusConfig = turnBonusConfig;

    const enemy = {
      faction: 'enemy',
      level: 10,
      col: 1,
      row: 1,
    };
    scene.enemyUnits = [enemy];

    await BattleScene.prototype.removeUnit.call(scene, enemy);

    // turnsOver=8, startOverPar=2, step=ceil((8-2)/2)=3 → goldMult[3]=0.4
    expect(scene.goldEarned).toBe(Math.floor(calculateKillGold(enemy) * 0.4));
  });

  it('enemy-phase flow applies hybrid overrides before reinforcements', async () => {
    const scene = new BattleScene();
    const order = [];

    scene.scene = { isActive: () => true };
    scene.showPhaseBanner = vi.fn();
    scene.dangerZone = { hide: vi.fn() };
    scene.updateAntiTurtlePressure = vi.fn();
    scene.grid = {
      tickTemporaryTerrains: vi.fn(),
      fogEnabled: false,
    };
    scene.enemyUnits = [];
    scene.refreshEndTurnControl = vi.fn();
    scene.processTerrainDamage = vi.fn(async () => {
      order.push('terrainDamage');
    });
    scene.processTurnStartEffects = vi.fn(async () => {
      order.push('turnStartEffects');
    });
    scene.applyDueHybridOverridesForTurn = vi.fn((turn) => {
      order.push(`overrides:${turn}`);
    });
    scene.applyReinforcementsForTurn = vi.fn((turn) => {
      order.push(`reinforcements:${turn}`);
    });
    scene.startEnemyPhase = vi.fn(() => {
      order.push('startEnemyPhase');
    });
    scene.turnManager = { currentPhase: 'enemy', turnNumber: 4 };

    let enemyPhaseCallback = null;
    scene.time = {
      delayedCall: vi.fn((_ms, cb) => {
        enemyPhaseCallback = cb;
      }),
    };

    BattleScene.prototype.onPhaseChange.call(scene, 'enemy', 4);
    expect(scene.time.delayedCall).toHaveBeenCalledTimes(1);
    expect(typeof enemyPhaseCallback).toBe('function');

    await enemyPhaseCallback();

    expect(order).toEqual(['terrainDamage', 'turnStartEffects', 'overrides:4', 'startEnemyPhase']);
  });

  it('awaits startEnemyPhase inside enemy-phase delayed callback', async () => {
    const scene = new BattleScene();
    scene.scene = { isActive: () => true };
    scene.showPhaseBanner = vi.fn();
    scene.dangerZone = { hide: vi.fn() };
    scene.updateAntiTurtlePressure = vi.fn();
    scene.grid = { tickTemporaryTerrains: vi.fn(), fogEnabled: false };
    scene.enemyUnits = [];
    scene.refreshEndTurnControl = vi.fn();
    scene.processTerrainDamage = vi.fn(async () => {});
    scene.processTurnStartEffects = vi.fn(async () => {});
    scene.processZombieRevival = vi.fn(async () => {});
    scene.processBallistaFire = vi.fn(async () => {});
    scene.applyDueHybridOverridesForTurn = vi.fn();

    let resolveEnemyPhase;
    scene.startEnemyPhase = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveEnemyPhase = resolve;
        }),
    );
    scene.turnManager = { currentPhase: 'enemy', turnNumber: 4 };

    let enemyPhaseCallback = null;
    scene.time = {
      delayedCall: vi.fn((_ms, cb) => {
        enemyPhaseCallback = cb;
      }),
    };

    BattleScene.prototype.onPhaseChange.call(scene, 'enemy', 4);
    const callbackPromise = enemyPhaseCallback();
    let settled = false;
    callbackPromise.then(() => {
      settled = true;
    });
    for (let i = 0; i < 8 && !resolveEnemyPhase; i++) {
      await Promise.resolve();
    }
    expect(typeof resolveEnemyPhase).toBe('function');
    expect(settled).toBe(false);

    resolveEnemyPhase();
    await callbackPromise;
    expect(settled).toBe(true);
  });

  it('reinforcements spawn after AI in startEnemyPhase, preventing premature rout victory', async () => {
    const scene = new BattleScene();
    const events = [];

    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene.isDevToolsEnabled = () => false;
    scene.turnManager = {
      turnNumber: 4,
      endEnemyPhase: vi.fn(() => {
        events.push('endEnemyPhase');
      }),
    };

    // AI kills the last enemy during processing
    scene.enemyUnits = [{ name: 'Goblin', hasActed: false }];
    scene.playerUnits = [{ name: 'Edric', isCommander: true }];
    scene.npcUnits = [];
    scene.aiController = {
      processEnemyPhase: vi.fn(async () => {
        // Simulate all enemies dying during AI phase
        scene.enemyUnits.length = 0;
        events.push('aiDone');
      }),
    };
    scene.processTerrainDamage = vi.fn(async () => {
      events.push('terrainDamage');
    });
    scene.applyReinforcementsForTurn = vi.fn((turn) => {
      // Simulate reinforcements spawning
      scene.enemyUnits.push({ name: 'Reinforcement', _isReinforcement: true });
      events.push(`reinforcements:${turn}`);
    });
    scene.createEnemyPhaseAiStats = vi.fn(() => ({}));
    scene.finalizeEnemyPhaseAiStats = vi.fn();
    scene.dimUnit = vi.fn();
    scene.recordEnemyAiDecision = vi.fn();

    await BattleScene.prototype.startEnemyPhase.call(scene);

    // Reinforcements should happen after AI + terrain damage, before endEnemyPhase
    expect(events).toEqual(['aiDone', 'terrainDamage', 'reinforcements:4', 'endEnemyPhase']);
    // Enemy array should have the reinforcement, preventing premature rout
    expect(scene.enemyUnits.length).toBe(1);
  });

  it('clears deferred rout flag when debug-skip reinforcement application throws', async () => {
    const scene = new BattleScene();

    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene.isDevToolsEnabled = () => true;
    scene._debugSkipEnemyPhase = true;
    scene.turnManager = {
      turnNumber: 4,
      endEnemyPhase: vi.fn(),
    };
    scene.applyReinforcementsForTurn = vi.fn(() => {
      throw new Error('reinforcement boom');
    });

    await expect(BattleScene.prototype.startEnemyPhase.call(scene)).rejects.toThrow(
      'reinforcement boom',
    );

    expect(scene._reinforcementsPendingThisTurn).toBe(false);
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
  });

  it('clears deferred rout flag when enemy phase ends during AI processing', async () => {
    const scene = new BattleScene();

    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene.isDevToolsEnabled = () => false;
    scene.turnManager = {
      turnNumber: 4,
      endEnemyPhase: vi.fn(),
    };
    scene.enemyUnits = [{ name: 'Enemy', hasActed: false }];
    scene.playerUnits = [{ name: 'Edric', isCommander: true }];
    scene.npcUnits = [];
    scene.aiController = {
      processEnemyPhase: vi.fn(async () => {
        scene.battleState = 'BATTLE_END';
      }),
    };
    scene.processTerrainDamage = vi.fn(async () => {});
    scene.applyReinforcementsForTurn = vi.fn();
    scene.createEnemyPhaseAiStats = vi.fn(() => ({}));
    scene.finalizeEnemyPhaseAiStats = vi.fn();
    scene.dimUnit = vi.fn();
    scene.recordEnemyAiDecision = vi.fn();

    await BattleScene.prototype.startEnemyPhase.call(scene);

    expect(scene._reinforcementsPendingThisTurn).toBe(false);
    expect(scene.applyReinforcementsForTurn).not.toHaveBeenCalled();
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
  });

  it('defers rout when executeEnemyCombat removes the last enemy while reinforcements are pending', async () => {
    const scene = new BattleScene();
    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene._reinforcementsPendingThisTurn = true;
    scene.onVictory = vi.fn();
    scene.onDefeat = vi.fn();
    scene.isDevToolsEnabled = () => false;
    scene.grid = { getTerrainAt: vi.fn(() => 'Plain') };
    scene.turnManager = { turnNumber: 4 };
    scene.resetFortHealStreak = vi.fn();
    scene._ensureCombatRollSession = vi.fn();
    scene._selectEnemyWeaponArt = vi.fn(() => null);
    scene.buildSkillCtx = vi.fn(() => ({}));
    scene.animateSkillActivation = vi.fn(async () => {});
    scene.animateStrike = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene._applyResolvedCombatPostEffects = vi.fn(async () => {});
    scene._checkPhoenixBrooch = vi.fn(async () => {});
    scene.awardXP = vi.fn(async () => {});
    scene._clearCombatRollSession = vi.fn();

    const enemy = {
      name: 'Enemy',
      faction: 'enemy',
      col: 2,
      row: 2,
      currentHP: 10,
      weapon: { name: 'Iron Lance' },
    };
    const edric = {
      name: 'Edric',
      isCommander: true,
      faction: 'player',
      col: 2,
      row: 1,
      currentHP: 20,
      weapon: { name: 'Iron Sword' },
      stats: { HP: 20 },
    };
    scene.enemyUnits = [enemy];
    scene.playerUnits = [edric];

    vi.mocked(resolveCombat).mockReturnValueOnce({
      events: [],
      attackerHP: 0,
      defenderHP: 20,
    });
    scene.removeUnit = vi.fn(async (unit) => {
      const idx = scene.enemyUnits.indexOf(unit);
      if (idx !== -1) scene.enemyUnits.splice(idx, 1);
    });

    await BattleScene.prototype.executeEnemyCombat.call(scene, enemy, edric);

    expect(scene.removeUnit).toHaveBeenCalledWith(enemy, { killer: edric });
    expect(scene.enemyUnits).toHaveLength(0);
    expect(scene.onVictory).not.toHaveBeenCalled();
  });

  it('grants rout victory after reinforcements when no enemies remain', () => {
    const scene = new BattleScene();

    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene._reinforcementsPendingThisTurn = false;
    scene.onVictory = vi.fn();
    scene.enemyUnits = [];
    scene.playerUnits = [{ name: 'Edric', isCommander: true }];

    const ended = BattleScene.prototype.checkBattleEnd.call(scene);
    expect(ended).toBe(true);
    expect(scene.onVictory).toHaveBeenCalled();
  });

  it('enemy-phase timed enrage enables aggressive mode when a boss is alive', () => {
    const scene = new BattleScene();

    scene.showPhaseBanner = vi.fn();
    scene.dangerZone = { hide: vi.fn() };
    scene.grid = {
      tickTemporaryTerrains: vi.fn(),
      fogEnabled: false,
    };
    scene.refreshEndTurnControl = vi.fn();
    scene.processTerrainDamage = vi.fn(async () => {});
    scene.processTurnStartEffects = vi.fn(async () => {});
    scene.applyDueHybridOverridesForTurn = vi.fn();
    scene.applyReinforcementsForTurn = vi.fn();
    scene.startEnemyPhase = vi.fn();
    scene.time = {
      delayedCall: vi.fn(),
    };

    scene.turnPar = 10;
    scene.turnBonusConfig = turnBonusConfig;
    scene.getBestLordThroneDistance = vi.fn(() => 99);
    scene.aiController = { setAggressiveMode: vi.fn() };
    scene.antiTurtleState = {
      noProgressTurns: 0,
      bestEnemyCount: 1,
      bestLordThroneDistance: 99,
      aggressiveMode: false,
      turnEnrageActive: false,
    };
    scene.enemyUnits = [{ isBoss: true, currentHP: 20 }];

    BattleScene.prototype.onPhaseChange.call(scene, 'enemy', 12);

    expect(scene.antiTurtleState.turnEnrageActive).toBe(true);
    expect(scene.antiTurtleState.aggressiveMode).toBe(true);
    expect(scene.aiController.setAggressiveMode).toHaveBeenCalledWith(true);
  });

  it('rout resolves through startEnemyPhase when no reinforcements spawn and no enemies remain', async () => {
    const scene = new BattleScene();
    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene.isDevToolsEnabled = () => false;
    scene.turnManager = {
      turnNumber: 4,
      endEnemyPhase: vi.fn(),
    };
    scene.enemyUnits = [{ name: 'Goblin', hasActed: false }];
    scene.playerUnits = [{ name: 'Edric', isCommander: true }];
    scene.npcUnits = [];
    scene.aiController = {
      processEnemyPhase: vi.fn(async () => {
        scene.enemyUnits.length = 0; // all enemies die
      }),
    };
    scene.processTerrainDamage = vi.fn(async () => {});
    scene.applyReinforcementsForTurn = vi.fn(); // no-op, spawns nothing
    scene.onVictory = vi.fn(() => {
      scene.battleState = 'BATTLE_END';
    });
    scene.createEnemyPhaseAiStats = vi.fn(() => ({}));
    scene.finalizeEnemyPhaseAiStats = vi.fn();
    scene.dimUnit = vi.fn();
    scene.recordEnemyAiDecision = vi.fn();

    await BattleScene.prototype.startEnemyPhase.call(scene);

    expect(scene.onVictory).toHaveBeenCalled();
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
  });

  it('routes The Emperor boss to enemy_emperor with safe fallback', () => {
    const scene = new BattleScene();
    scene.textures = { exists: vi.fn((key) => key === 'enemy_emperor') };

    const emperor = { faction: 'enemy', className: 'General', isBoss: true, name: 'The Emperor' };
    expect(BattleScene.prototype.getSpriteKey.call(scene, emperor)).toBe('enemy_emperor');

    scene.textures.exists = vi.fn(() => false);
    expect(BattleScene.prototype.getSpriteKey.call(scene, emperor)).toBe('enemy_general');
  });

  describe('reinforcement par bump', () => {
    it('bumps turnPar by count of waves with spawned units', () => {
      const scene = new BattleScene();
      scene.turnPar = 8;
      scene.dangerZoneStale = false;
      scene.grid = { fogEnabled: false };
      scene.updateObjectiveText = vi.fn();
      scene.showReinforcementBanner = vi.fn();

      // Mock resolveReinforcementsForTurn to return 2 waves, both with spawns
      scene.resolveReinforcementsForTurn = vi.fn(() => ({
        spawns: [
          { col: 0, row: 0, waveIndex: 0 },
          { col: 1, row: 0, waveIndex: 1 },
        ],
        dueWaves: [
          { spawnedCount: 1, requestedCount: 1 },
          { spawnedCount: 1, requestedCount: 2 },
        ],
        blockedSpawns: 1,
      }));
      scene.buildReinforcementSpawnSpec = vi.fn((s) => s);
      scene.addEnemyFromSpawn = vi.fn(() => ({ name: 'Enemy' }));

      BattleScene.prototype.applyReinforcementsForTurn.call(scene, 4);

      expect(scene.turnPar).toBe(10); // 8 + 2 effective waves
    });

    it('does not bump turnPar when all waves blocked (spawnedCount=0)', () => {
      const scene = new BattleScene();
      scene.turnPar = 8;
      scene.grid = { fogEnabled: false };

      scene.resolveReinforcementsForTurn = vi.fn(() => ({
        spawns: [],
        dueWaves: [{ spawnedCount: 0, requestedCount: 2 }],
        blockedSpawns: 2,
      }));

      BattleScene.prototype.applyReinforcementsForTurn.call(scene, 4);

      expect(scene.turnPar).toBe(8); // unchanged — no spawns means spawned=0 guard
    });

    it('does not bump turnPar when turnPar is null', () => {
      const scene = new BattleScene();
      scene.turnPar = null;
      scene.dangerZoneStale = false;
      scene.grid = { fogEnabled: false };
      scene.updateObjectiveText = vi.fn();
      scene.showReinforcementBanner = vi.fn();

      scene.resolveReinforcementsForTurn = vi.fn(() => ({
        spawns: [{ col: 0, row: 0, waveIndex: 0 }],
        dueWaves: [{ spawnedCount: 1, requestedCount: 1 }],
        blockedSpawns: 0,
      }));
      scene.buildReinforcementSpawnSpec = vi.fn((s) => s);
      scene.addEnemyFromSpawn = vi.fn(() => ({ name: 'Enemy' }));

      BattleScene.prototype.applyReinforcementsForTurn.call(scene, 4);

      expect(scene.turnPar).toBeNull(); // unchanged
    });

    it('only counts waves whose spawns actually instantiate', () => {
      const scene = new BattleScene();
      scene.turnPar = 10;
      scene.dangerZoneStale = false;
      scene.grid = { fogEnabled: false };
      scene.updateObjectiveText = vi.fn();
      scene.showReinforcementBanner = vi.fn();

      // Two waves: wave 0 has one spawn that succeeds, wave 1 has one spawn that fails
      scene.resolveReinforcementsForTurn = vi.fn(() => ({
        spawns: [
          { col: 0, row: 0, waveIndex: 0 },
          { col: 1, row: 0, waveIndex: 1 },
        ],
        dueWaves: [
          { spawnedCount: 1, requestedCount: 1 },
          { spawnedCount: 1, requestedCount: 1 },
        ],
        blockedSpawns: 0,
      }));
      scene.buildReinforcementSpawnSpec = vi.fn((s) => s);
      // Wave 0 spawn succeeds, wave 1 spawn fails
      scene.addEnemyFromSpawn = vi
        .fn()
        .mockReturnValueOnce({ name: 'Enemy' })
        .mockReturnValueOnce(null);

      BattleScene.prototype.applyReinforcementsForTurn.call(scene, 5);

      expect(scene.turnPar).toBe(11); // 10 + 1 (only wave 0 succeeded)
    });

    it('counts scripted and procedural waves with same waveIndex as distinct', () => {
      const scene = new BattleScene();
      scene.turnPar = 8;
      scene.dangerZoneStale = false;
      scene.grid = { fogEnabled: false };
      scene.updateObjectiveText = vi.fn();
      scene.showReinforcementBanner = vi.fn();

      // Scripted wave 0 and procedural wave 0 fire on the same turn
      scene.resolveReinforcementsForTurn = vi.fn(() => ({
        spawns: [
          { col: 0, row: 0, waveIndex: 0, waveType: 'scripted' },
          { col: 1, row: 0, waveIndex: 0 },
        ],
        dueWaves: [
          { spawnedCount: 1, requestedCount: 1 },
          { spawnedCount: 1, requestedCount: 1 },
        ],
        blockedSpawns: 0,
      }));
      scene.buildReinforcementSpawnSpec = vi.fn((s) => s);
      scene.addEnemyFromSpawn = vi.fn(() => ({ name: 'Enemy' }));

      BattleScene.prototype.applyReinforcementsForTurn.call(scene, 4);

      expect(scene.turnPar).toBe(10); // 8 + 2 (scripted:0 and procedural:0 are distinct)
    });

    it('does not bump par when addEnemyFromSpawn fails for all spawns', () => {
      const scene = new BattleScene();
      scene.turnPar = 8;
      scene.dangerZoneStale = false;
      scene.grid = { fogEnabled: false };

      // Scheduler resolved spawns, but addEnemyFromSpawn returns null for all
      scene.resolveReinforcementsForTurn = vi.fn(() => ({
        spawns: [
          { col: 0, row: 0, waveIndex: 0 },
          { col: 1, row: 0, waveIndex: 0 },
        ],
        dueWaves: [{ spawnedCount: 2, requestedCount: 2 }],
        blockedSpawns: 0,
      }));
      scene.buildReinforcementSpawnSpec = vi.fn((s) => s);
      scene.addEnemyFromSpawn = vi.fn(() => null); // all fail

      BattleScene.prototype.applyReinforcementsForTurn.call(scene, 4);

      expect(scene.turnPar).toBe(8); // unchanged — no actual enemies created
    });
  });
});
