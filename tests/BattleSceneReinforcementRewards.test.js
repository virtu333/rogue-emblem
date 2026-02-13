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
});
