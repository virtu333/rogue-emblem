import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';

describe('RunSimulationDriver', () => {
  it('completes a seeded run with terminal result', async () => {
    const gameData = loadGameData();
    installSeed(1234);
    try {
      const driver = new RunSimulationDriver(gameData, {
        runOptions: { runSeed: 1234, difficultyId: 'normal' },
        maxNodes: 120,
        maxBattleActions: 1200,
      });
      const result = await driver.run();
      expect(['victory', 'defeat', 'stuck', 'timeout']).toContain(result.result);
      expect(result.metrics.nodesVisited).toBeGreaterThan(0);
      expect(result.metrics.battles).toBeGreaterThanOrEqual(1);
    } finally {
      restoreMathRandom();
    }
  });

  it('invincibility mode does not record player unit losses', async () => {
    const gameData = loadGameData();
    installSeed(7);
    try {
      const driver = new RunSimulationDriver(gameData, {
        runOptions: { runSeed: 7, difficultyId: 'hard' },
        maxNodes: 120,
        maxBattleActions: 1200,
        invincibility: true,
      });
      const result = await driver.run();
      expect(result.metrics.unitsLost).toBe(0);
    } finally {
      restoreMathRandom();
    }
  });

  it('applies difficulty and blessing shop pricing in simulation', () => {
    const gameData = loadGameData();
    const driver = new RunSimulationDriver(gameData);
    driver.runManager = {
      getDifficultyModifier: (key, fallback) => (key === 'shopPriceMultiplier' ? 1.15 : fallback),
      getShopPriceDiscount: () => 0.15,
    };

    const priced = driver._applyShopPricing([
      { item: { name: 'Iron Sword' }, type: 'weapon', price: 100 },
    ]);

    expect(priced).toHaveLength(1);
    expect(priced[0].price).toBe(97);
  });
});
