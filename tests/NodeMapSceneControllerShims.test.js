// Delegation contracts for the NodeMapScene controller extraction: every
// church/shop method on the scene must lazy-init its controller once and
// forward arguments/returns unchanged, and scene shutdown must destroy both
// controllers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: {
      Clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    },
  },
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { ChurchController } from '../src/ui/ChurchController.js';
import { ShopController } from '../src/ui/ShopController.js';

function makeScene() {
  const scene = new NodeMapScene();
  scene.registry = { get: () => null };
  return scene;
}

describe('NodeMapScene controller shims', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Church shims', () => {
    it('showChurchOverlay lazy-inits ChurchController once and reuses it', () => {
      const scene = makeScene();
      const spy = vi
        .spyOn(ChurchController.prototype, 'showChurchOverlay')
        .mockImplementation(() => {});

      NodeMapScene.prototype.showChurchOverlay.call(scene, { id: 'n1' });
      const firstController = scene._churchController;
      NodeMapScene.prototype.showChurchOverlay.call(scene, { id: 'n2' });

      expect(firstController).toBeInstanceOf(ChurchController);
      expect(scene._churchController).toBe(firstController);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it.each([
      ['handleChurch', [{ id: 'church1' }]],
      ['handleRuins', [{ id: 'ruins1' }]],
      ['showChurchOverlay', [{ id: 'church1' }, {}]],
      ['drawChurchScrollContent', []],
      ['leaveChurchNode', []],
      ['_showChurchSuccessMessage', [{ id: 'n' }, 'msg', '#44ff44', 'revival']],
      ['_scheduleChurchFlavor', ['promotion', 600]],
      ['showChurchMessage', ['hello', '#ffdd44']],
      ['refreshChurchOverlay', [{ id: 'n' }]],
      ['closeChurchOverlay', []],
    ])('%s delegates to ChurchController with same args', (method, args) => {
      const scene = makeScene();
      const spy = vi.spyOn(ChurchController.prototype, method).mockImplementation(() => {});

      NodeMapScene.prototype[method].call(scene, ...args);

      expect(scene._churchController).toBeInstanceOf(ChurchController);
      expect(spy).toHaveBeenCalledWith(...args);
      spy.mockRestore();
    });
  });

  describe('Shop shims', () => {
    it('handleShop lazy-inits ShopController once and reuses it', () => {
      const scene = makeScene();
      const spy = vi.spyOn(ShopController.prototype, 'handleShop').mockImplementation(() => {});

      NodeMapScene.prototype.handleShop.call(scene, { id: 'n1' }, {});
      const firstController = scene._shopController;
      NodeMapScene.prototype.handleShop.call(scene, { id: 'n2' }, {});

      expect(firstController).toBeInstanceOf(ShopController);
      expect(scene._shopController).toBe(firstController);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it.each([
      ['handleShop', [{ id: 'n' }, { ambushDiscount: true }]],
      ['applyDifficultyShopPricing', [[{ price: 100 }]]],
      ['applyAmbushDiscount', [[{ price: 100 }]]],
      ['applyRuinsMarkup', [[{ price: 100 }]]],
      ['showShopOverlay', [{ id: 'n' }, [{ price: 100 }], { ambushDiscount: false }]],
      ['leaveShopNode', []],
      ['drawShopTabs', []],
      ['drawActiveTabContent', []],
      ['_getWeaponArtCatalog', []],
      ['drawShopBuyList', []],
      ['onBuyItem', [{ item: { name: 'Iron Sword' }, price: 500 }]],
      ['drawShopSellList', []],
      ['drawShopForgeList', []],
      ['drawShopScrollHint', []],
      ['_getShopItemDetailText', [{ item: { name: 'Iron Sword' } }]],
      ['_showShopItemTooltip', [{ item: { name: 'Iron Sword' } }, 100, 200]],
      ['_hideShopItemTooltip', []],
      ['showForgeStatPicker', [{ name: 'Iron Sword' }]],
      ['closeForgeStatPicker', []],
      ['_showForgeTooltip', [{ name: 'Iron Sword' }, 100, 200]],
      ['_hideForgeTooltip', []],
      ['_saveShopState', []],
      ['refreshShop', []],
      ['drawRerollButton', []],
      ['showUnitPicker', [vi.fn(), { name: 'Iron Sword' }]],
      ['renderUnitPicker', []],
      ['closeUnitPicker', []],
      ['showShopBanner', ['Bought!', '#44ff44']],
      ['showWeaponArtsUnlockedBanner', [['art_a']]],
      ['_showSkillDisplacementWarning', [['skill_a']]],
      ['closeShopOverlay', []],
    ])('%s delegates to ShopController with same args', (method, args) => {
      const scene = makeScene();
      const expected = { tag: method };
      const spy = vi.spyOn(ShopController.prototype, method).mockImplementation(() => expected);

      const result = NodeMapScene.prototype[method].call(scene, ...args);

      expect(scene._shopController).toBeInstanceOf(ShopController);
      expect(spy).toHaveBeenCalledWith(...args);
      expect(result).toBe(expected);
      spy.mockRestore();
    });
  });

  describe('shutdown controller hygiene', () => {
    it('destroys ChurchController and ShopController and nulls references', () => {
      const scene = makeScene();
      const churchDestroy = vi.fn();
      const shopDestroy = vi.fn();
      scene._churchController = { destroy: churchDestroy };
      scene._shopController = { destroy: shopDestroy };
      scene._unbindInputHandlers = vi.fn();
      scene._unbindDebugToggleHandler = vi.fn();
      scene.input = null;
      scene.tweens = null;
      scene.events = { off: vi.fn() };

      NodeMapScene.prototype._onSceneShutdown.call(scene);

      expect(churchDestroy).toHaveBeenCalledTimes(1);
      expect(scene._churchController).toBeNull();
      expect(shopDestroy).toHaveBeenCalledTimes(1);
      expect(scene._shopController).toBeNull();
    });
  });
});
