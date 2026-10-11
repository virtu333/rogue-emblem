// The live call sites hand the run's owned legendaries to the loot and shop draws.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));
vi.mock('../src/engine/LootSystem.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateShopInventory: vi.fn(actual.generateShopInventory) };
});

import { RunManager } from '../src/engine/RunManager.js';
import { prepareBattleRewards, rerollBattleReward } from '../src/engine/PendingBattleRewards.js';
import { applyLotteryCards } from '../src/engine/LotteryLoot.js';
import { recordLegendaryGrant } from '../src/engine/LegendaryOwnership.js';
import { generateShopInventory } from '../src/engine/LootSystem.js';
import { ShopController } from '../src/ui/ShopController.js';
import { loadGameData } from './testData.js';

function legendRun({ owned, names = ['Ragnarok', 'Namethief'] }) {
  const data = loadGameData();
  // Act 3 pays only from a legendary pool of swords (Edric wields them).
  data.lootTables.act3 = { weights: { legendaryWeapon: 1 }, legendaryWeapon: names };
  const run = new RunManager(data);
  run.startRun();
  run.actIndex = run.actSequence.indexOf('act3');
  run.metaEffects = { ...(run.metaEffects || {}), rewardRerolls: 1 };
  if (owned) recordLegendaryGrant(run, { name: 'Ragnarok', tier: 'Legend', type: 'Sword' });
  return { run, data };
}
const offered = (choices) => choices.map((c) => c.item?.name).filter(Boolean);

describe('live loot wiring', () => {
  it('the first offer leaves an owned legendary out (and offers it when unowned)', () => {
    const open = legendRun({ owned: false });
    prepareBattleRewards(open.run, open.data, {});
    expect(offered(open.run.pendingBattleReward.choices)).toContain('Ragnarok');
    const held = legendRun({ owned: true });
    prepareBattleRewards(held.run, held.data, {});
    expect(offered(held.run.pendingBattleReward.choices)).not.toContain('Ragnarok');
    expect(offered(held.run.pendingBattleReward.choices)).toContain('Namethief');
  });

  it('a Branching Threads reroll leaves it out too', () => {
    const { run, data } = legendRun({ owned: true });
    prepareBattleRewards(run, data, {});
    const result = rerollBattleReward(run, data);
    expect(result.ok).toBe(true);
    expect(offered(result.choices)).not.toContain('Ragnarok');
  });

  it("Lottery Loot's card leaves it out", () => {
    const draw = {
      actId: 'act3',
      lotteryActId: 'act3',
      lotteryCards: 1,
      lotteryKey: 'n1',
    };
    const gold = [
      { type: 'gold', goldAmount: 10 },
      { type: 'gold', goldAmount: 20 },
    ];
    const open = legendRun({ owned: false, names: ['Ragnarok'] });
    const drawn = applyLotteryCards(open.run, open.data, draw, gold);
    expect(offered(drawn)).toEqual(['Ragnarok']);
    const held = legendRun({ owned: true, names: ['Ragnarok'] });
    expect(offered(applyLotteryCards(held.run, held.data, draw, gold))).toEqual([]);
  });
});

describe('live shop wiring', () => {
  function shopScene() {
    const data = loadGameData();
    const rm = new RunManager(data);
    rm.startRun();
    rm.actIndex = rm.actSequence.indexOf('act2');
    recordLegendaryGrant(rm, { name: 'Ragnarok', tier: 'Legend', type: 'Sword' });
    return {
      registry: { get: vi.fn(() => null) },
      gameData: data,
      runManager: Object.assign(rm, {
        consumeSkipFirstShop: vi.fn(() => false),
        getShopState: vi.fn(() => null),
        spendGold: vi.fn(() => true),
      }),
      shopBuyItems: [],
      shopRerollCount: 0,
      applyDifficultyShopPricing: vi.fn((items) => items),
      applyRuinsMarkup: vi.fn((items) => items),
      applyAmbushDiscount: vi.fn((items) => items),
      showShopOverlay: vi.fn(),
      closeShopOverlay: vi.fn(),
      checkActComplete: vi.fn(),
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
      _shopOriginalSlotCount: 3,
      handleRuins: vi.fn(),
      _isPendingAmbushNode: vi.fn(() => false),
      _clearPendingAmbushForNode: vi.fn(),
    };
  }
  const lastExcluded = () => generateShopInventory.mock.calls.at(-1)[7].excludeLegendaryNames;

  it('stocking a shop passes the owned legendaries', () => {
    generateShopInventory.mockClear();
    const scene = shopScene();
    new ShopController(scene).handleShop({ id: 'n1', type: 'shop' });
    expect(generateShopInventory).toHaveBeenCalled();
    expect(lastExcluded()).toEqual(['Ragnarok']);
  });

  it('restocking passes them too', () => {
    const scene = shopScene();
    const ctrl = new ShopController(scene);
    ctrl.handleShop({ id: 'n1', type: 'shop' });
    generateShopInventory.mockClear();
    scene.shopBuyItems = [];
    scene._shopOriginalSlotCount = 3;
    ctrl.rerollShop();
    expect(generateShopInventory).toHaveBeenCalled();
    expect(lastExcluded()).toEqual(['Ragnarok']);
  });
});
