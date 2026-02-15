import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { calculateKillGold } from '../src/engine/LootSystem.js';
import { calculateCombatXP } from '../src/engine/UnitManager.js';

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

  it('enemy-phase flow applies hybrid overrides before reinforcements', async () => {
    const scene = new BattleScene();
    const order = [];

    scene.showPhaseBanner = vi.fn();
    scene.dangerZone = { hide: vi.fn() };
    scene.updateAntiTurtlePressure = vi.fn();
    scene.grid = {
      tickTemporaryTerrains: vi.fn(),
      fogEnabled: false,
    };
    scene.enemyUnits = [];
    scene.refreshEndTurnControl = vi.fn();
    scene.processTerrainDamage = vi.fn(async () => { order.push('terrainDamage'); });
    scene.processTurnStartEffects = vi.fn(async () => { order.push('turnStartEffects'); });
    scene.applyDueHybridOverridesForTurn = vi.fn((turn) => { order.push(`overrides:${turn}`); });
    scene.applyReinforcementsForTurn = vi.fn((turn) => { order.push(`reinforcements:${turn}`); });
    scene.startEnemyPhase = vi.fn(() => { order.push('startEnemyPhase'); });

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

    expect(order).toEqual([
      'terrainDamage',
      'turnStartEffects',
      'overrides:4',
      'reinforcements:4',
      'startEnemyPhase',
    ]);
  });

  it('routes The Emperor boss to enemy_emperor with safe fallback', () => {
    const scene = new BattleScene();
    scene.textures = { exists: vi.fn((key) => key === 'enemy_emperor') };

    const emperor = { faction: 'enemy', className: 'General', isBoss: true, name: 'The Emperor' };
    expect(BattleScene.prototype.getSpriteKey.call(scene, emperor)).toBe('enemy_emperor');

    scene.textures.exists = vi.fn(() => false);
    expect(BattleScene.prototype.getSpriteKey.call(scene, emperor)).toBe('enemy_general');
  });
});
