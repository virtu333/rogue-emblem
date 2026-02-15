import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setInteractive(opts) { this._interactive = opts; return this; },
    setColor(color) { this._color = color; return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    destroy() { this._destroyed = true; },
  };
}

function makeBuyListScene({ gold, entry }) {
  const createdTexts = [];
  const scene = {
    runManager: { gold },
    shopBuyItems: [entry],
    shopScrollOffsets: { buy: 0, sell: 0, forge: 0 },
    shopContentGroup: [],
    shopOverlay: [],
    _showShopItemTooltip: vi.fn(),
    _hideShopItemTooltip: vi.fn(),
    onBuyItem: vi.fn(),
    add: {
      text: (x, y, text, style) => {
        const obj = makeDisplayObject({ x, y, text, style, width: String(text).length * 6 });
        createdTexts.push(obj);
        return obj;
      },
    },
  };
  return { scene, createdTexts };
}

describe('NodeMap shop hover details', () => {
  it('supports hover details on unaffordable buy rows while keeping purchase disabled', () => {
    const entry = {
      type: 'weapon',
      price: 2000,
      item: { name: 'Steel Sword', might: 8, hit: 75, crit: 0, weight: 10, range: '1' },
    };
    const { scene, createdTexts } = makeBuyListScene({ gold: 300, entry });

    NodeMapScene.prototype.drawShopBuyList.call(scene);

    const row = createdTexts[0];
    expect(row).toBeTruthy();
    expect(row._interactive).toEqual({ useHandCursor: false });
    expect(row.handlers.pointerdown).toBeUndefined();

    row.handlers.pointerover();
    expect(scene._showShopItemTooltip).toHaveBeenCalledWith(entry, 60 + row.width + 10, row.y);
    expect(row._color).toBe('#ffdd44');

    row.handlers.pointerout();
    expect(scene._hideShopItemTooltip).toHaveBeenCalledTimes(1);
    expect(row._color).toBe('#666666');
  });

  it('keeps affordable buy rows clickable and still shows hover details', () => {
    const entry = {
      type: 'consumable',
      price: 300,
      item: { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 },
    };
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry });

    NodeMapScene.prototype.drawShopBuyList.call(scene);

    const row = createdTexts[0];
    expect(row).toBeTruthy();
    expect(row._interactive).toEqual({ useHandCursor: true });
    expect(row.handlers.pointerdown).toBeTypeOf('function');

    row.handlers.pointerover();
    expect(scene._showShopItemTooltip).toHaveBeenCalledWith(entry, 60 + row.width + 10, row.y);

    row.handlers.pointerdown();
    expect(scene.onBuyItem).toHaveBeenCalledWith(entry);
  });

  it('formats detail text for accessory and weapon shop entries', () => {
    const accessoryText = NodeMapScene.prototype._getShopItemDetailText.call({}, {
      type: 'accessory',
      item: { name: 'Power Ring', type: 'Accessory', effects: { STR: 2 } },
    });
    expect(accessoryText).toContain('+2 STR');

    const weaponText = NodeMapScene.prototype._getShopItemDetailText.call({}, {
      type: 'weapon',
      item: { name: 'Venin Blade', might: 8, hit: 90, crit: 0, weight: 3, range: '1', special: 'Poison' },
    });
    expect(weaponText).toContain('Mt: 8');
    expect(weaponText).toContain('Wt: 3');
    expect(weaponText).toContain('Special: Poison');
  });

  it('hides shop tooltip on active-tab redraw', () => {
    const stale = makeDisplayObject();
    const scene = {
      _hideForgeTooltip: vi.fn(),
      _hideShopItemTooltip: vi.fn(),
      shopContentGroup: [stale],
      activeShopTab: 'buy',
      drawShopBuyList: vi.fn(),
      drawShopSellList: vi.fn(),
      drawShopForgeList: vi.fn(),
      drawRerollButton: vi.fn(),
      drawShopScrollHint: vi.fn(),
    };

    NodeMapScene.prototype.drawActiveTabContent.call(scene);

    expect(scene._hideShopItemTooltip).toHaveBeenCalledTimes(1);
    expect(stale._destroyed).toBe(true);
    expect(scene.drawShopBuyList).toHaveBeenCalledTimes(1);
    expect(scene.drawRerollButton).toHaveBeenCalledTimes(1);
  });
});

