// Basic medicine on the shelf: every ordinary shop stocks two Vulneraries in every
// act (Act III and IV list none in their pools), the Ruins' smaller shelf one, a
// Merchant Caravan none. Drives ShopController's real generation, first visit and
// restock, so the option the Ruins pass is the one that reaches the shelf.

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));
vi.mock('../src/engine/RuinsCommands.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ruinsServiceBlock: () => '',
}));

import { ShopController } from '../src/ui/ShopController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function makeScene(act) {
  return {
    registry: { get: vi.fn(() => null) },
    gameData: {
      lootTables: gameData.lootTables,
      weapons: gameData.weapons,
      consumables: gameData.consumables,
      accessories: gameData.accessories,
    },
    runManager: {
      currentAct: act,
      roster: [],
      gold: 100000,
      consumeSkipFirstShop: vi.fn(() => false),
      getShopState: vi.fn(() => null),
      getShopItemCountDelta: vi.fn(() => 0),
      getWeaponArtSpawnConfig: vi.fn(() => null),
      getConsumableCatalog: () => gameData.consumables,
      difficultyModifiers: {},
      spendGold: vi.fn(() => true),
    },
    applyDifficultyShopPricing: vi.fn((items) => items),
    applyRuinsMarkup: vi.fn((items) => items),
    applyAmbushDiscount: vi.fn((items) => items),
    showShopOverlay: vi.fn(),
    _isPendingAmbushNode: vi.fn(() => false),
  };
}

const vulneraryRows = (items) => items.filter((entry) => entry.item?.name === 'Vulnerary');

describe('basic medicine on the shelf', () => {
  for (const act of ['act1', 'act3', 'act4']) {
    it(`an ordinary ${act} shop opens with two Vulneraries`, () => {
      for (let i = 0; i < 15; i++) {
        const scene = makeScene(act);
        new ShopController(scene).handleShop({ id: `n_${act}` });
        const [, items] = scene.showShopOverlay.mock.calls[0];
        expect(vulneraryRows(items)).toHaveLength(2);
      }
    });

    it(`the ${act} Ruins open with one Vulnerary`, () => {
      for (let i = 0; i < 15; i++) {
        const scene = makeScene(act);
        new ShopController(scene).handleShop({ id: `r_${act}` }, { ruins: true });
        const [, items, options] = scene.showShopOverlay.mock.calls[0];
        expect(options.ruins).toBe(true);
        expect(vulneraryRows(items)).toHaveLength(1);
      }
    });
  }

  it('a fresh restock stocks the pair at a shop and the one at the Ruins', () => {
    // A shelf larger than the restock's first batch is topped up from a second
    // batch: that batch's Vulneraries must not pile onto the pair.
    for (const ruins of [false, true, false, true, false, true, false, true]) {
      const scene = makeScene('act3');
      const ctrl = new ShopController(scene);
      ctrl.handleShop({ id: 'n_restock' }, { ruins });
      const [, opened] = scene.showShopOverlay.mock.calls[0];
      ctrl.canReroll = () => true;
      scene.shopRerollCount = 0;
      scene._currentShopIsRuins = ruins;
      scene._currentShopHasAmbushDiscount = false;
      scene.refreshShop = vi.fn();
      scene.showShopBanner = vi.fn();
      // Nothing bought yet, on a shelf a little longer than one batch can fill.
      scene.shopBuyItems = [...opened, opened[0], opened[0], opened[0]];
      scene._shopOriginalSlotCount = scene.shopBuyItems.length;
      expect(ctrl.rerollShop()).toBe(true);
      expect(vulneraryRows(scene.shopBuyItems)).toHaveLength(ruins ? 1 : 2);
    }
  });
});
