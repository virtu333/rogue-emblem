import { describe, it, expect, vi } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';
import { NODE_TYPES } from '../../src/utils/constants.js';

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

  it('applies ambush discount in simulation pricing', () => {
    const gameData = loadGameData();
    const driver = new RunSimulationDriver(gameData);
    driver.runManager = {
      getDifficultyModifier: (key, fallback) => (key === 'shopPriceMultiplier' ? 1.15 : fallback),
      getShopPriceDiscount: () => 0.15,
    };

    const priced = driver._applyShopPricing([
      { item: { name: 'Iron Sword' }, type: 'weapon', price: 100 },
    ], { ambushDiscount: true });

    expect(priced).toHaveLength(1);
    expect(priced[0].price).toBe(77);
  });

  it('runs ambush shop nodes as battle-first then shop resolution', async () => {
    const gameData = loadGameData();
    const driver = new RunSimulationDriver(gameData);
    driver.runManager = {
      consumeSkipFirstShop: () => false,
      getShopItemCountDelta: () => 0,
      currentAct: 'act1',
      roster: [],
      gold: 0,
      markNodeComplete: vi.fn(),
      clearAmbushPendingNode: vi.fn(),
      spendGold: vi.fn(() => false),
      addGold: vi.fn(),
    };
    driver._runBattleNode = vi.fn(async () => ({ result: 'victory' }));
    driver._applyShopPricing = vi.fn(() => []);

    const node = { id: 'shop_ambush_1', type: NODE_TYPES.SHOP, isAmbush: true, ambushCleared: false };
    const result = await driver._runShopNode(node);

    expect(driver._runBattleNode).toHaveBeenCalledWith(node);
    expect(driver.runManager.markNodeComplete).toHaveBeenCalledWith(node.id);
    expect(driver.runManager.clearAmbushPendingNode).toHaveBeenCalledWith(node.id);
    expect(driver.metrics.ambushBattles).toBe(1);
    expect(result.result).toBe('shop_done');
  });

  it('returns defeat immediately when ambush battle is lost on a shop node', async () => {
    const gameData = loadGameData();
    const driver = new RunSimulationDriver(gameData);
    driver.runManager = {
      consumeSkipFirstShop: () => false,
      getShopItemCountDelta: () => 0,
      currentAct: 'act1',
      roster: [],
      gold: 0,
      markNodeComplete: vi.fn(),
      clearAmbushPendingNode: vi.fn(),
      spendGold: vi.fn(() => false),
      addGold: vi.fn(),
    };
    driver._runBattleNode = vi.fn(async () => ({ result: 'defeat' }));
    driver._applyShopPricing = vi.fn(() => []);

    const node = { id: 'shop_ambush_defeat_1', type: NODE_TYPES.SHOP, isAmbush: true, ambushCleared: false };
    const result = await driver._runShopNode(node);

    expect(driver._runBattleNode).toHaveBeenCalledWith(node);
    expect(driver._applyShopPricing).not.toHaveBeenCalled();
    expect(driver.runManager.markNodeComplete).not.toHaveBeenCalled();
    expect(driver.runManager.clearAmbushPendingNode).not.toHaveBeenCalled();
    expect(driver.metrics.ambushBattles).toBe(1);
    expect(result.result).toBe('defeat');
  });

  it('returns timeout immediately when ambush battle times out on a shop node', async () => {
    const gameData = loadGameData();
    const driver = new RunSimulationDriver(gameData);
    driver.runManager = {
      consumeSkipFirstShop: () => false,
      getShopItemCountDelta: () => 0,
      currentAct: 'act1',
      roster: [],
      gold: 0,
      markNodeComplete: vi.fn(),
      clearAmbushPendingNode: vi.fn(),
      spendGold: vi.fn(() => false),
      addGold: vi.fn(),
    };
    driver._runBattleNode = vi.fn(async () => ({ result: 'timeout' }));
    driver._applyShopPricing = vi.fn(() => []);

    const node = { id: 'shop_ambush_timeout_1', type: NODE_TYPES.SHOP, isAmbush: true, ambushCleared: false };
    const result = await driver._runShopNode(node);

    expect(driver._runBattleNode).toHaveBeenCalledWith(node);
    expect(driver._applyShopPricing).not.toHaveBeenCalled();
    expect(driver.runManager.markNodeComplete).not.toHaveBeenCalled();
    expect(driver.runManager.clearAmbushPendingNode).not.toHaveBeenCalled();
    expect(driver.metrics.ambushBattles).toBe(1);
    expect(result.result).toBe('timeout');
  });
});
