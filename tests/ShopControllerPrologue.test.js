// Harrow's Market (docs/specs/prologue-chapter.md §6 "Route map, row 2"): the prologue
// shop sells its authored wares at a real Act 1 shop's prices (the run's own price
// rules then apply, as for any shop), never a random Act 1 draw, and has no Restock.
// A standard run's shop is untouched (random stock, Restock offered).

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));

import { ShopController } from '../src/ui/ShopController.js';
import { actShopPrice } from '../src/engine/ShopEconomy.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const marketEntry = gameData.prologue.route.nodes.find((n) => n.id === 'prologue_2a');

function makeScene({ mode = 'prologue', gold = 500 } = {}) {
  return {
    registry: { get: vi.fn(() => null) },
    gameData,
    runManager: {
      mode,
      currentAct: 'act1',
      roster: [],
      gold,
      spendGold: vi.fn(function (n) {
        if (this.gold < n) return false;
        this.gold -= n;
        return true;
      }),
      consumeSkipFirstShop: vi.fn(() => false),
      getShopState: vi.fn(() => null),
      saveShopState: vi.fn(),
      getShopItemCountDelta: vi.fn(() => 0),
      getWeaponArtSpawnConfig: vi.fn(() => null),
      difficultyModifiers: {},
      markNodeComplete: vi.fn(),
      clearShopState: vi.fn(),
    },
    shopRerollCount: 0,
    applyDifficultyShopPricing: vi.fn((items) => items),
    applyRuinsMarkup: vi.fn((items) => items),
    applyAmbushDiscount: vi.fn((items) => items),
    showShopOverlay: vi.fn(),
    closeShopOverlay: vi.fn(),
    checkActComplete: vi.fn(),
    _isPendingAmbushNode: vi.fn(() => false),
  };
}

const market = () => ({
  id: 'prologue_2a',
  type: 'shop',
  title: marketEntry.title,
  prologueStock: [...marketEntry.stock],
});

describe("Harrow's Market", () => {
  it('sells exactly its authored wares at act-1 prices, through the run price rules', () => {
    const scene = makeScene();
    new ShopController(scene).handleShop(market());
    expect(scene.showShopOverlay).toHaveBeenCalledTimes(1);
    const [, items] = scene.showShopOverlay.mock.calls[0];
    expect(items.map((e) => e.item.name)).toEqual(marketEntry.stock);
    const catalogue = [...gameData.weapons, ...gameData.consumables];
    for (const entry of items) {
      const base = catalogue.find((i) => i.name === entry.item.name).price;
      expect(entry.price, entry.item.name).toBe(actShopPrice(base, 'act1'));
    }
    // The Vulnerary the spec promises is on the shelf, at an honest price.
    expect(items.filter((e) => e.item.name === 'Vulnerary')).toHaveLength(2);
    expect(scene.applyDifficultyShopPricing).toHaveBeenCalledTimes(1);
  });

  it('the same wares every visit and every seed (no random Act 1 stock)', () => {
    const names = [];
    for (const seed of [0.01, 0.5, 0.99]) {
      const random = Math.random;
      Math.random = () => seed;
      try {
        const scene = makeScene();
        new ShopController(scene).handleShop(market());
        names.push(scene.showShopOverlay.mock.calls[0][1].map((e) => e.item.name));
      } finally {
        Math.random = random;
      }
    }
    expect(names[1]).toEqual(names[0]);
    expect(names[2]).toEqual(names[0]);
  });

  it('no Restock in the prologue; a standard shop keeps it', () => {
    const scene = makeScene({ gold: 5000 });
    const ctrl = new ShopController(scene);
    expect(ctrl.canReroll()).toBe(false);
    scene.shopBuyItems = [];
    expect(ctrl.rerollShop()).toBe(false);
    expect(scene.runManager.gold).toBe(5000);
    expect(scene.shopRerollCount).toBe(0);
    const standard = makeScene({ mode: 'standard' });
    expect(new ShopController(standard).canReroll()).toBe(true);
  });
});
