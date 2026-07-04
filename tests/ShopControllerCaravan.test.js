// ShopController: Merchant Caravan reward shop variant. handleShop(node=null,
// { caravan: true }) must skip node-tied behaviors (skip-first-shop, ambush
// discount, shop-state caching), route through generateShopInventory with
// rareBias + the caravan item-count range, and leaveShopNode must clear
// pendingCaravanShop rather than touching markNodeComplete.

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));

import { ShopController } from '../src/ui/ShopController.js';
import { CARAVAN_SHOP_ITEM_COUNT_RANGE } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function makeScene(overrides = {}) {
  return {
    registry: { get: vi.fn(() => null) },
    gameData: {
      lootTables: gameData.lootTables,
      weapons: gameData.weapons,
      consumables: gameData.consumables,
      accessories: gameData.accessories,
    },
    runManager: {
      currentAct: 'act2',
      roster: [],
      gold: 500,
      consumeSkipFirstShop: vi.fn(() => false),
      getShopState: vi.fn(() => null),
      getShopItemCountDelta: vi.fn(() => 0),
      getWeaponArtSpawnConfig: vi.fn(() => null),
      difficultyModifiers: {},
      clearPendingCaravanShop: vi.fn(),
      markNodeComplete: vi.fn(),
      clearShopState: vi.fn(),
    },
    applyDifficultyShopPricing: vi.fn((items) => items),
    applyRuinsMarkup: vi.fn((items) => items),
    applyAmbushDiscount: vi.fn((items) => items),
    showShopOverlay: vi.fn(),
    closeShopOverlay: vi.fn(),
    checkActComplete: vi.fn(),
    handleRuins: vi.fn(),
    _isPendingAmbushNode: vi.fn(() => false),
    _clearPendingAmbushForNode: vi.fn(),
    ...overrides,
  };
}

describe('ShopController caravan variant', () => {
  it('handleShop(null, { caravan: true }) generates a 3-4 item rare-biased shop', () => {
    const scene = makeScene();
    const ctrl = new ShopController(scene);

    ctrl.handleShop(null, { caravan: true, caravanActId: 'act2' });

    expect(scene.showShopOverlay).toHaveBeenCalledTimes(1);
    const [nodeArg, items, options] = scene.showShopOverlay.mock.calls[0];
    expect(nodeArg).toBeNull();
    expect(options.caravan).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(CARAVAN_SHOP_ITEM_COUNT_RANGE.min);
    expect(items.length).toBeLessThanOrEqual(CARAVAN_SHOP_ITEM_COUNT_RANGE.max);
  });

  it('does not consult consumeSkipFirstShop or shop-state caching for the caravan variant', () => {
    const scene = makeScene();
    const ctrl = new ShopController(scene);

    ctrl.handleShop(null, { caravan: true, caravanActId: 'act2' });

    expect(scene.runManager.consumeSkipFirstShop).not.toHaveBeenCalled();
    expect(scene.runManager.getShopState).not.toHaveBeenCalled();
  });

  it('does not apply ambush discount or ruins markup for the caravan variant', () => {
    const scene = makeScene();
    const ctrl = new ShopController(scene);

    ctrl.handleShop(null, { caravan: true, caravanActId: 'act2' });

    expect(scene.applyAmbushDiscount).not.toHaveBeenCalled();
    expect(scene.applyRuinsMarkup).not.toHaveBeenCalled();
  });

  it('_getShopTabs excludes Forge when _currentShopIsCaravan is set', () => {
    const scene = makeScene({ _currentShopIsCaravan: true });
    const ctrl = new ShopController(scene);
    const tabs = ctrl._getShopTabs();
    expect(tabs.map((t) => t.key)).toEqual(['buy', 'sell']);
  });

  it('_getShopTabs includes Forge for a normal (non-caravan, non-ruins) shop', () => {
    const scene = makeScene({ _currentShopIsCaravan: false, _currentShopIsRuins: false });
    const ctrl = new ShopController(scene);
    const tabs = ctrl._getShopTabs();
    expect(tabs.map((t) => t.key)).toEqual(['buy', 'sell', 'forge']);
  });

  it('leaveShopNode clears pendingCaravanShop and skips markNodeComplete/shop-state', () => {
    const scene = makeScene({
      shopOverlay: [{}],
      _currentShopIsCaravan: true,
      _shopNode: null,
    });
    const ctrl = new ShopController(scene);

    ctrl.leaveShopNode();

    expect(scene.runManager.clearPendingCaravanShop).toHaveBeenCalledTimes(1);
    expect(scene.runManager.markNodeComplete).not.toHaveBeenCalled();
    expect(scene.runManager.clearShopState).not.toHaveBeenCalled();
    expect(scene.closeShopOverlay).toHaveBeenCalledTimes(1);
  });

  it('leaveShopNode for a normal village shop still marks the node complete (regression guard)', () => {
    const node = { id: 'shop-1' };
    const scene = makeScene({
      shopOverlay: [{}],
      _currentShopIsCaravan: false,
      _currentShopIsRuins: false,
      _shopNode: node,
    });
    const ctrl = new ShopController(scene);

    ctrl.leaveShopNode();

    expect(scene.runManager.clearPendingCaravanShop).not.toHaveBeenCalled();
    expect(scene.runManager.markNodeComplete).toHaveBeenCalledWith(node.id);
  });
});
