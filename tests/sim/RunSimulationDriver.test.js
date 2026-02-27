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

  it('passes meta effects and fallen units into battle params for headless parity', async () => {
    const gameData = loadGameData();
    installSeed(2468);
    try {
      let capturedBattleDriver = null;
      const driver = new RunSimulationDriver(gameData, {
        runOptions: { runSeed: 2468, difficultyId: 'normal' },
        maxBattleActions: 0,
        battleAgentFactory: (battleDriver) => {
          capturedBattleDriver = battleDriver;
          return { chooseAction: () => null };
        },
      });
      driver.init();
      driver.runManager.metaEffects = {
        ...(driver.runManager.metaEffects || {}),
        recruitPromotionChanceBonus: 0.24,
        lordRecruitChanceBonus: 0.5,
      };
      const effectiveMetaEffects = {
        ...driver.runManager.metaEffects,
        recruitPromotionChanceBonus: 0.31,
      };
      const getEffectiveMetaEffectsSpy = vi
        .spyOn(driver.runManager, 'getEffectiveMetaEffects')
        .mockReturnValue(effectiveMetaEffects);
      const sampleFallen = structuredClone(driver.runManager.roster[0]);
      sampleFallen.name = `${sampleFallen.name} Fallen`;
      driver.runManager.fallenUnits = [sampleFallen];
      const expectedFallenUnits = structuredClone(driver.runManager.fallenUnits);

      const node =
        driver.runManager.getAvailableNodes().find((entry) => Boolean(entry?.battleParams)) ||
        driver.runManager.nodeMap?.nodes?.find((entry) => Boolean(entry?.battleParams));
      expect(node).toBeTruthy();

      await driver._runBattleNode(node);
      expect(capturedBattleDriver).toBeTruthy();

      const battleParams = capturedBattleDriver.battle.battleParams;
      expect(getEffectiveMetaEffectsSpy).toHaveBeenCalled();
      expect(battleParams.metaEffects).toMatchObject({
        recruitPromotionChanceBonus: 0.31,
        lordRecruitChanceBonus: 0.5,
      });
      expect(battleParams.metaEffects).not.toBe(effectiveMetaEffects);
      expect(battleParams.metaEffects).not.toBe(driver.runManager.metaEffects);
      expect(battleParams.fallenUnits).toEqual(expectedFallenUnits);
      expect(battleParams.fallenUnits).not.toBe(driver.runManager.fallenUnits);
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
  }, 15000);

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

    const priced = driver._applyShopPricing(
      [{ item: { name: 'Iron Sword' }, type: 'weapon', price: 100 }],
      { ambushDiscount: true },
    );

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

    const node = {
      id: 'shop_ambush_1',
      type: NODE_TYPES.SHOP,
      isAmbush: true,
      ambushCleared: false,
    };
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

    const node = {
      id: 'shop_ambush_defeat_1',
      type: NODE_TYPES.SHOP,
      isAmbush: true,
      ambushCleared: false,
    };
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

    const node = {
      id: 'shop_ambush_timeout_1',
      type: NODE_TYPES.SHOP,
      isAmbush: true,
      ambushCleared: false,
    };
    const result = await driver._runShopNode(node);

    expect(driver._runBattleNode).toHaveBeenCalledWith(node);
    expect(driver._applyShopPricing).not.toHaveBeenCalled();
    expect(driver.runManager.markNodeComplete).not.toHaveBeenCalled();
    expect(driver.runManager.clearAmbushPendingNode).not.toHaveBeenCalled();
    expect(driver.metrics.ambushBattles).toBe(1);
    expect(result.result).toBe('timeout');
  });

  it('revives the cheapest affordable fallen unit at church', () => {
    const gameData = loadGameData();
    const driver = new RunSimulationDriver(gameData);
    driver.runManager = {
      gold: 1000,
      fallenUnits: [
        { name: 'Expensive', level: 10, tier: 'promoted' },
        { name: 'Cheap', level: 1, tier: 'base' },
      ],
      reviveFallenUnit: vi.fn((name, cost) => name === 'Cheap' && cost === 800),
      rest: vi.fn(),
      roster: [],
    };
    driver._tryChurchPromotion = vi.fn(() => null);

    const node = { id: 'church_test_1', type: NODE_TYPES.CHURCH };
    const result = driver._runChurchNode(node);

    expect(driver.runManager.reviveFallenUnit).toHaveBeenCalledWith('Cheap', 800);
    expect(result).toEqual({ result: 'church_done', revived: 'Cheap', promoted: null });
    expect(driver.metrics.churchGoldSpent).toBe(800);
    expect(driver.runManager.rest).toHaveBeenCalledWith(node.id);
  });
});
