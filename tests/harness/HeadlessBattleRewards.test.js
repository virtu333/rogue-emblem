import { describe, expect, it } from 'vitest';

import { HeadlessBattle } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';

describe('HeadlessBattle reward multipliers', () => {
  it('applies +30% XP for boss enemies', () => {
    const gameData = loadGameData();
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });

    expect(battle._getEnemyXpMultiplier({ isBoss: true })).toBe(1.3);
  });

  it('applies +30% XP for elite targets', () => {
    const gameData = loadGameData();
    const battle = new HeadlessBattle(gameData, {
      act: 'act1',
      objective: 'rout',
      row: 2,
      isElite: true,
    });

    expect(battle._getEnemyXpMultiplier({ isElite: true })).toBe(1.3);
  });

  it('does not apply +30% XP from elite encounter context alone', () => {
    const gameData = loadGameData();
    const battle = new HeadlessBattle(gameData, {
      act: 'act1',
      objective: 'rout',
      row: 2,
      isElite: true,
    });

    expect(battle._getEnemyXpMultiplier({})).toBe(1);
  });

  it('stacks reinforcement and special-enemy XP multipliers once', () => {
    const gameData = loadGameData();
    const battle = new HeadlessBattle(gameData, {
      act: 'act1',
      objective: 'rout',
      row: 2,
      isElite: true,
    });
    const enemy = {
      _isReinforcement: true,
      _reinforcementRewardMultiplier: 0.25,
      isBoss: true,
    };

    expect(battle._getEnemyXpMultiplier(enemy)).toBeCloseTo(0.325, 8);
  });

  it('keeps gold reward multiplier on reinforcement-only path', () => {
    const gameData = loadGameData();
    const battle = new HeadlessBattle(gameData, {
      act: 'act1',
      objective: 'rout',
      row: 2,
      isElite: true,
    });
    const enemy = {
      _isReinforcement: true,
      _reinforcementRewardMultiplier: 0.5,
      isBoss: true,
    };

    expect(battle._getEnemyRewardMultiplier(enemy)).toBe(0.5);
    expect(battle._getEnemyXpMultiplier(enemy)).toBeCloseTo(0.65, 8);
  });
});
