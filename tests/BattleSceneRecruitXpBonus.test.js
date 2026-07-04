// Training Doctrine meta upgrade (recruit_xp): +10%/+20% combat XP for
// non-lord units, applied in BattleScene.awardXP alongside the reward and
// turn-pressure multipliers. Modeled on BattleSceneReinforcementRewards.test.js.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { calculateCombatXP } from '../src/engine/UnitManager.js';

function makeScene(recruitXpBonus) {
  const scene = new BattleScene();
  scene.awardScaledXP = vi.fn(async () => {});
  scene.runManager = { metaEffects: { recruitXpBonus } };
  return scene;
}

describe('BattleScene recruit XP bonus (Training Doctrine)', () => {
  it('applies +10% combat XP to non-lord units at tier 1', async () => {
    const scene = makeScene(0.1);
    const attacker = { level: 5, isLord: false };
    const defender = { level: 5 };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 1.1));
  });

  it('applies +20% combat XP to non-lord units at tier 2', async () => {
    const scene = makeScene(0.2);
    const attacker = { level: 5, isLord: false };
    const defender = { level: 5 };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 1.2));
  });

  it('does not apply the bonus to lords', async () => {
    const scene = makeScene(0.2);
    const attacker = { level: 5, isLord: true };
    const defender = { level: 5 };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, baseXp);
  });

  it('stacks multiplicatively with enemy reward multipliers', async () => {
    const scene = makeScene(0.2);
    const attacker = { level: 8, isLord: false };
    const defender = { level: 4, isBoss: true };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, Math.floor(baseXp * 1.3 * 1.2));
  });

  it('is a no-op when the upgrade is not purchased', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});
    scene.runManager = { metaEffects: {} };
    const attacker = { level: 5, isLord: false };
    const defender = { level: 5 };

    const baseXp = calculateCombatXP(attacker, defender, true);
    await BattleScene.prototype.awardXP.call(scene, attacker, defender, true);

    expect(scene.awardScaledXP).toHaveBeenCalledWith(attacker, baseXp);
  });
});
