import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEnemy, createBoss, getData } from '../../sim/lib/SimUnitFactory.js';
import { createPromotedEnemyUnit } from '../../src/engine/UnitManager.js';
import { ENEMY_PROMOTION_BASE_LEVEL } from '../../src/utils/constants.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

describe('SimUnitFactory promoted-enemy parity', () => {
  const data = getData();

  beforeEach(() => {
    installSeed(1337);
  });

  afterEach(() => {
    restoreMathRandom();
  });

  it('matches runtime promoted formula for post-promotion levels', () => {
    const promotedClass = data.classes.find((c) => c.name === 'General');
    const targetLevel = ENEMY_PROMOTION_BASE_LEVEL + 6;

    installSeed(20260219);
    const runtime = createPromotedEnemyUnit(
      promotedClass,
      targetLevel,
      data.weapons,
      1.0,
      data.skills,
      'act3',
      data.classes,
    );
    installSeed(20260219);
    const simUnit = createEnemy('General', targetLevel, data.skills, 'act3');

    expect(simUnit.tier).toBe('promoted');
    expect(simUnit.level).toBe(7); // 1 + (target - ENEMY_PROMOTION_BASE_LEVEL)
    expect(simUnit.level).toBe(runtime.level);
    expect(simUnit.stats).toEqual(runtime.stats);
  });

  it('keeps promoted level at 1 when target level is at cap threshold', () => {
    const simUnit = createEnemy('General', ENEMY_PROMOTION_BASE_LEVEL, data.skills, 'act3');
    expect(simUnit.level).toBe(1);
  });

  it('threads act through enemy skill-roll chance', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.2);
    try {
      const act1Enemy = createEnemy('Fighter', 6, data.skills, 'act1');
      const act3Enemy = createEnemy('Fighter', 6, data.skills, 'act3');
      expect(act1Enemy.skills.length).toBe(0);
      expect(act3Enemy.skills.length).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('threads act through boss path skill-roll chance', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.2);
    try {
      const act1Boss = createBoss('Fighter', 6, 'act1');
      const act3Boss = createBoss('Fighter', 6, 'act3');
      expect(act1Boss.isBoss).toBe(true);
      expect(act3Boss.isBoss).toBe(true);
      expect(act1Boss.skills.length).toBe(0);
      expect(act3Boss.skills.length).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
