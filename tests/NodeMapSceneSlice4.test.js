import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateShopInventoryMock } = vi.hoisted(() => ({
  generateShopInventoryMock: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: {
      Clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    },
  },
}));

vi.mock('../src/engine/LootSystem.js', () => ({
  generateShopInventory: generateShopInventoryMock,
  getSellPrice: vi.fn(() => 0),
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { NODE_TYPES } from '../src/utils/constants.js';

function makeDisplayObject(seed = {}) {
  return {
    visible: true,
    active: true,
    input: null,
    handlers: {},
    ...seed,
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setAlpha() { return this; },
    setColor(color) { this._color = color; return this; },
    setBackgroundColor(color) { this._bg = color; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setInteractive(opts) {
      this._interactive = opts;
      this.input = this.input || {};
      this.input.enabled = true;
      return this;
    },
    setVisible(next) { this.visible = next; return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    destroy() { this._destroyed = true; this.active = false; },
  };
}

function makeCancelableScene(overrides = {}) {
  return {
    _storyDialogueActive: false,
    dialogueOverlay: { visible: false },
    isDevToolsEnabled: () => false,
    debugOverlay: null,
    forgePicker: null,
    unitPicker: null,
    unitPickerState: null,
    settingsOverlay: null,
    rosterOverlay: null,
    pauseOverlay: null,
    shopOverlay: null,
    shopContentGroup: null,
    shopTabObjects: null,
    churchOverlay: null,
    _shopViewingMap: false,
    _churchViewingMap: false,
    showPauseMenu: vi.fn(),
    leaveShopNode: vi.fn(),
    leaveChurchNode: vi.fn(),
    _setOverlayVisibility: NodeMapScene.prototype._setOverlayVisibility,
    _setShopOverlayVisibility: NodeMapScene.prototype._setShopOverlayVisibility,
    _setChurchOverlayVisibility: NodeMapScene.prototype._setChurchOverlayVisibility,
    canRequestCancel(opts) {
      return NodeMapScene.prototype.canRequestCancel.call(this, opts);
    },
    ...overrides,
  };
}

function makeShopEntry(name, type = 'weapon', price = 100) {
  return {
    type,
    price,
    item: { name, type: 'Sword' },
  };
}

function makeRerollScene({ shopBuyItems, originalCount, gold = 9999 }) {
  const createdTexts = [];
  const scene = {
    runManager: {
      gold,
      spendGold: vi.fn((amount) => {
        scene.runManager.gold -= amount;
        return true;
      }),
      currentAct: 1,
      roster: [],
      getWeaponArtSpawnConfig: vi.fn(() => ({})),
    },
    gameData: { lootTables: {}, weapons: [], consumables: [], accessories: [] },
    applyDifficultyShopPricing: (items) => (Array.isArray(items) ? items.map((entry) => ({ ...entry })) : []),
    shopBuyItems: shopBuyItems.map((entry, i) => ({ ...entry, index: i })),
    _shopOriginalSlotCount: originalCount,
    shopRerollCount: 0,
    shopOverlay: [],
    shopContentGroup: [],
    registry: { get: vi.fn(() => null) },
    refreshShop: vi.fn(),
    showShopBanner: vi.fn(),
    add: {
      text: (x, y, text, style) => {
        const obj = makeDisplayObject({ x, y, text, style });
        createdTexts.push(obj);
        return obj;
      },
    },
  };
  return { scene, createdTexts };
}

function makeRosterUnit(name, { isLord = false, level = 1 } = {}) {
  return {
    name,
    isLord,
    level,
    className: isLord ? 'Lord' : 'Mercenary',
    currentHP: 18,
    stats: { HP: 20 },
  };
}

describe('NodeMapScene Slice 4', () => {
  beforeEach(() => {
    generateShopInventoryMock.mockReset();
  });

  it('handleShop passes blessing item delta into shop generation and prices inventory', () => {
    const generated = [makeShopEntry('Iron Sword', 'weapon', 100)];
    const priced = [makeShopEntry('Iron Sword', 'weapon', 90)];
    generateShopInventoryMock.mockReturnValueOnce(generated);
    const node = { id: 'shop-1' };

    const scene = {
      runManager: {
        consumeSkipFirstShop: vi.fn(() => false),
        currentAct: 'act1',
        roster: [],
        getWeaponArtSpawnConfig: vi.fn(() => null),
        getShopItemCountDelta: vi.fn(() => 1),
      },
      gameData: { lootTables: {}, weapons: [], consumables: [], accessories: [] },
      registry: { get: vi.fn(() => null) },
      applyDifficultyShopPricing: vi.fn(() => priced),
      showShopOverlay: vi.fn(),
    };

    NodeMapScene.prototype.handleShop.call(scene, node);

    expect(generateShopInventoryMock).toHaveBeenCalledWith(
      'act1',
      scene.gameData.lootTables,
      scene.gameData.weapons,
      scene.gameData.consumables,
      scene.gameData.accessories,
      scene.runManager.roster,
      null,
      { itemCountBonus: 1 }
    );
    expect(scene.applyDifficultyShopPricing).toHaveBeenCalledWith(generated);
    expect(scene.showShopOverlay).toHaveBeenCalledWith(node, priced);
  });

  it('applyDifficultyShopPricing combines difficulty multiplier with blessing discount', () => {
    const scene = {
      runManager: {
        getDifficultyModifier: vi.fn((key, fallback) => (key === 'shopPriceMultiplier' ? 1.15 : fallback)),
        getShopPriceDiscount: vi.fn(() => 0.15),
      },
    };

    const priced = NodeMapScene.prototype.applyDifficultyShopPricing.call(scene, [
      { item: { name: 'Iron Sword' }, type: 'weapon', price: 100 },
    ]);

    expect(priced).toHaveLength(1);
    expect(priced[0].price).toBe(97);
  });

  it('blocks opening roster while shop/church overlay is active', () => {
    const withShopOverlay = {
      rosterOverlay: null,
      shopOverlay: [makeDisplayObject()],
      churchOverlay: null,
      pauseOverlay: null,
      settingsOverlay: null,
    };
    const withChurchOverlay = {
      rosterOverlay: null,
      shopOverlay: null,
      churchOverlay: [makeDisplayObject()],
      pauseOverlay: null,
      settingsOverlay: null,
    };

    expect(() => NodeMapScene.prototype._openRoster.call(withShopOverlay)).not.toThrow();
    expect(() => NodeMapScene.prototype._openRoster.call(withChurchOverlay)).not.toThrow();
    expect(withShopOverlay.rosterOverlay).toBeNull();
    expect(withChurchOverlay.rosterOverlay).toBeNull();
  });

  it('blocks opening roster while pause or settings overlay is visible', () => {
    const withPause = {
      rosterOverlay: null,
      shopOverlay: null,
      churchOverlay: null,
      pauseOverlay: { visible: true },
      settingsOverlay: null,
    };
    const withSettings = {
      rosterOverlay: null,
      shopOverlay: null,
      churchOverlay: null,
      pauseOverlay: null,
      settingsOverlay: { visible: true },
    };

    expect(() => NodeMapScene.prototype._openRoster.call(withPause)).not.toThrow();
    expect(() => NodeMapScene.prototype._openRoster.call(withSettings)).not.toThrow();
    expect(withPause.rosterOverlay).toBeNull();
    expect(withSettings.rosterOverlay).toBeNull();
  });

  it('requestCancel restores hidden shop overlay before leaving', () => {
    const shopObj = makeDisplayObject().setInteractive({ useHandCursor: true });
    shopObj.visible = false;
    shopObj.input.enabled = false;
    const scene = makeCancelableScene({
      shopOverlay: [shopObj],
      _shopViewingMap: true,
    });

    const handled = NodeMapScene.prototype.requestCancel.call(scene);

    expect(handled).toBe(true);
    expect(scene._shopViewingMap).toBe(false);
    expect(shopObj.visible).toBe(true);
    expect(shopObj.input.enabled).toBe(true);
    expect(scene.leaveShopNode).not.toHaveBeenCalled();
  });

  it('requestCancel restores hidden church overlay before leaving', () => {
    const churchObj = makeDisplayObject().setInteractive({ useHandCursor: true });
    churchObj.visible = false;
    churchObj.input.enabled = false;
    const scene = makeCancelableScene({
      churchOverlay: [churchObj],
      _churchViewingMap: true,
    });

    const handled = NodeMapScene.prototype.requestCancel.call(scene);

    expect(handled).toBe(true);
    expect(scene._churchViewingMap).toBe(false);
    expect(churchObj.visible).toBe(true);
    expect(churchObj.input.enabled).toBe(true);
    expect(scene.leaveChurchNode).not.toHaveBeenCalled();
  });

  it('requestCancel keeps normal shop/church leave behavior when not viewing map', () => {
    const shopScene = makeCancelableScene({ shopOverlay: [makeDisplayObject()] });
    const churchScene = makeCancelableScene({ churchOverlay: [makeDisplayObject()] });

    NodeMapScene.prototype.requestCancel.call(shopScene);
    NodeMapScene.prototype.requestCancel.call(churchScene);

    expect(shopScene.leaveShopNode).toHaveBeenCalledTimes(1);
    expect(churchScene.leaveChurchNode).toHaveBeenCalledTimes(1);
  });

  it('view-map mode blocks shop touch and wheel scrolling mutations', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      _shopViewingMap: true,
      shopOverlay: [makeDisplayObject()],
      activeShopTab: 'buy',
      forgePicker: null,
      unitPicker: null,
      shopScrollMax: 100,
      shopScrollOffsets: { buy: 12 },
      drawActiveTabContent: vi.fn(),
      _touchScrollDrag: null,
    };

    NodeMapScene.prototype.onPointerDown.call(scene, { pointerType: 'touch', y: 200 });
    expect(scene._touchScrollDrag).toBeNull();

    scene._touchScrollDrag = { type: 'shop', tab: 'buy', startY: 180, startOffset: 12 };
    NodeMapScene.prototype.onPointerMove.call(scene, { pointerType: 'touch', y: 120 });
    NodeMapScene.prototype.onWheel.call(scene, { y: 220 }, 0, 24);

    expect(scene.shopScrollOffsets.buy).toBe(12);
    expect(scene.drawActiveTabContent).not.toHaveBeenCalled();
  });

  it('reroll with purchases preserves remaining items and refills to original slot count', () => {
    const keepA = makeShopEntry('Keep A');
    const keepB = makeShopEntry('Keep B');
    generateShopInventoryMock
      .mockReturnValueOnce([makeShopEntry('Keep A'), makeShopEntry('New C')])
      .mockReturnValueOnce([makeShopEntry('New D')]);

    const { scene, createdTexts } = makeRerollScene({
      shopBuyItems: [keepA, keepB],
      originalCount: 4,
    });

    NodeMapScene.prototype.drawRerollButton.call(scene);
    createdTexts[0].handlers.pointerdown();

    const names = scene.shopBuyItems.map((entry) => entry.item.name);
    expect(scene.shopBuyItems).toHaveLength(4);
    expect(names).toEqual(expect.arrayContaining(['Keep A', 'Keep B']));
    expect(scene.shopBuyItems.map((entry) => entry.index)).toEqual([0, 1, 2, 3]);
    expect(scene.refreshShop).toHaveBeenCalledTimes(1);
    expect(scene.showShopBanner).toHaveBeenCalledWith('Shop restocked!', '#aaddff');
  });

  it('reroll with no purchases remains full reroll and keeps original slot count', () => {
    generateShopInventoryMock.mockReturnValueOnce([
      makeShopEntry('Fresh A'),
      makeShopEntry('Fresh B'),
      makeShopEntry('Fresh C'),
    ]);

    const { scene, createdTexts } = makeRerollScene({
      shopBuyItems: [makeShopEntry('Old A'), makeShopEntry('Old B'), makeShopEntry('Old C')],
      originalCount: 3,
    });

    NodeMapScene.prototype.drawRerollButton.call(scene);
    createdTexts[0].handlers.pointerdown();

    expect(scene.shopBuyItems).toHaveLength(3);
    expect(scene.shopBuyItems.map((entry) => entry.item.name)).toEqual(['Fresh A', 'Fresh B', 'Fresh C']);
    expect(scene.runManager.spendGold).toHaveBeenCalledTimes(1);
    expect(scene.shopRerollCount).toBe(1);
  });

  it('drawRoster shows lords only and +N more for omitted non-lords', () => {
    const texts = [];
    const scene = {
      runManager: {
        roster: [
          makeRosterUnit('Edric', { isLord: true }),
          makeRosterUnit('Sera', { isLord: true }),
          makeRosterUnit('Axehand'),
          makeRosterUnit('Cleric'),
          makeRosterUnit('Rogue'),
        ],
      },
      gameData: { lords: [] },
      add: {
        text: (x, y, text, style) => {
          const obj = makeDisplayObject({ x, y, text, style });
          texts.push(obj);
          return obj;
        },
        rectangle: () => makeDisplayObject(),
      },
    };

    NodeMapScene.prototype.drawRoster.call(scene);

    const values = texts.map((entry) => entry.text);
    expect(values.some((label) => label.includes('Edric Lv'))).toBe(true);
    expect(values.some((label) => label.includes('Sera Lv'))).toBe(true);
    expect(values.some((label) => label.includes('Axehand Lv'))).toBe(false);
    expect(values).toContain('+3 more');
  });

  it('drawRoster shows first four units when no lords exist and appends +N more', () => {
    const texts = [];
    const scene = {
      runManager: {
        roster: [
          makeRosterUnit('Unit1'),
          makeRosterUnit('Unit2'),
          makeRosterUnit('Unit3'),
          makeRosterUnit('Unit4'),
          makeRosterUnit('Unit5'),
          makeRosterUnit('Unit6'),
        ],
      },
      gameData: { lords: [] },
      add: {
        text: (x, y, text, style) => {
          const obj = makeDisplayObject({ x, y, text, style });
          texts.push(obj);
          return obj;
        },
        rectangle: () => makeDisplayObject(),
      },
    };

    NodeMapScene.prototype.drawRoster.call(scene);

    const values = texts.map((entry) => entry.text);
    expect(values.some((label) => label.includes('Unit1 Lv'))).toBe(true);
    expect(values.some((label) => label.includes('Unit4 Lv'))).toBe(true);
    expect(values.some((label) => label.includes('Unit5 Lv'))).toBe(false);
    expect(values).toContain('+2 more');
  });

  it('keeps node click blocked while overlay exists in view-map mode, then exits normally after restore', () => {
    const shopObj = makeDisplayObject().setInteractive({ useHandCursor: true });
    shopObj.visible = false;
    shopObj.input.enabled = false;
    const scene = makeCancelableScene({
      isTransitioning: false,
      battleLaunchInFlight: false,
      isSceneReady: true,
      shopOverlay: [shopObj],
      _shopViewingMap: true,
      handleShop: vi.fn(),
      handleChurch: vi.fn(),
      handleBattle: vi.fn(),
    });

    NodeMapScene.prototype.onNodeClick.call(scene, { id: 'shop1', type: NODE_TYPES.SHOP });
    expect(scene.handleShop).not.toHaveBeenCalled();

    NodeMapScene.prototype.requestCancel.call(scene);
    expect(scene._shopViewingMap).toBe(false);
    expect(scene.leaveShopNode).not.toHaveBeenCalled();

    NodeMapScene.prototype.requestCancel.call(scene);
    expect(scene.leaveShopNode).toHaveBeenCalledTimes(1);
  });

  it('close overlays reset viewing flags', () => {
    const scene = {
      closeForgeStatPicker: vi.fn(),
      _hideForgeTooltip: vi.fn(),
      _hideShopItemTooltip: vi.fn(),
      shopOverlay: [makeDisplayObject()],
      shopContentGroup: [makeDisplayObject()],
      shopTabObjects: [makeDisplayObject()],
      unitPicker: null,
      _shopViewingMap: true,
      _shopOriginalSlotCount: 5,
      _shopNode: { id: 's1' },
      churchOverlay: [makeDisplayObject()],
      churchContentGroup: [makeDisplayObject()],
      churchMessage: null,
      churchGoldText: makeDisplayObject(),
      _churchNode: { id: 'c1' },
      _churchViewingMap: true,
      _sceneTimers: new Set(),
      _churchMessageTimer: null,
      _touchScrollDrag: { type: 'church', startY: 200, startOffset: 0 },
      churchScrollOffset: 50,
      churchScrollMax: 100,
      _churchScrollItems: [{ type: 'label', text: 'test', y: 0 }],
    };

    NodeMapScene.prototype.closeShopOverlay.call(scene);
    expect(scene._shopViewingMap).toBe(false);
    expect(scene._shopOriginalSlotCount).toBe(0);

    NodeMapScene.prototype.closeChurchOverlay.call(scene);
    expect(scene._churchViewingMap).toBe(false);
    expect(scene.churchScrollOffset).toBe(0);
    expect(scene.churchScrollMax).toBe(0);
    expect(scene._churchScrollItems).toBeNull();
    expect(scene._touchScrollDrag).toBeNull();
  });

  it('church map-view hide/show includes scroll group', () => {
    const churchObj = makeDisplayObject().setInteractive({ useHandCursor: true });
    const scrollObj = makeDisplayObject().setInteractive({ useHandCursor: true });
    const scene = makeCancelableScene({
      churchOverlay: [churchObj],
      churchContentGroup: [scrollObj],
    });

    scene._setChurchOverlayVisibility(false);
    expect(churchObj.visible).toBe(false);
    expect(scrollObj.visible).toBe(false);

    scene._setChurchOverlayVisibility(true);
    expect(churchObj.visible).toBe(true);
    expect(scrollObj.visible).toBe(true);
  });

  it('church wheel/drag blocked during map-view', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      unitPickerState: null,
      churchOverlay: [makeDisplayObject()],
      _churchViewingMap: true,
      churchScrollMax: 100,
      churchScrollOffset: 0,
      drawChurchScrollContent: vi.fn(),
      shopOverlay: null,
      forgePicker: null,
      unitPicker: null,
      _touchScrollDrag: null,
    };

    // Wheel should be blocked by _churchViewingMap
    NodeMapScene.prototype.onWheel.call(scene, { y: 200 }, 0, 30);
    expect(scene.churchScrollOffset).toBe(0);
    expect(scene.drawChurchScrollContent).not.toHaveBeenCalled();
  });

  it('church wheel scrolls within bounds and clamps', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      unitPickerState: null,
      churchOverlay: [makeDisplayObject()],
      _churchViewingMap: false,
      churchScrollMax: 60,
      churchScrollOffset: 0,
      drawChurchScrollContent: vi.fn(),
      shopOverlay: null,
    };

    // Scroll down
    NodeMapScene.prototype.onWheel.call(scene, { y: 200 }, 0, 30);
    expect(scene.churchScrollOffset).toBe(30);
    expect(scene.drawChurchScrollContent).toHaveBeenCalledTimes(1);

    // Scroll down past max — should clamp to 60
    NodeMapScene.prototype.onWheel.call(scene, { y: 200 }, 0, 300);
    expect(scene.churchScrollOffset).toBe(60);

    // Scroll up — step-based, goes to 30
    NodeMapScene.prototype.onWheel.call(scene, { y: 200 }, 0, -300);
    expect(scene.churchScrollOffset).toBe(30);

    // Scroll up again — goes to 0
    NodeMapScene.prototype.onWheel.call(scene, { y: 200 }, 0, -300);
    expect(scene.churchScrollOffset).toBe(0);

    // Scroll up once more — clamped at 0, no change
    scene.drawChurchScrollContent.mockClear();
    NodeMapScene.prototype.onWheel.call(scene, { y: 200 }, 0, -300);
    expect(scene.churchScrollOffset).toBe(0);
    expect(scene.drawChurchScrollContent).not.toHaveBeenCalled();
  });

  it('church wheel ignores pointer outside list bounds', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      unitPickerState: null,
      churchOverlay: [makeDisplayObject()],
      _churchViewingMap: false,
      churchScrollMax: 100,
      churchScrollOffset: 0,
      drawChurchScrollContent: vi.fn(),
      shopOverlay: null,
    };

    // Pointer above the list area
    NodeMapScene.prototype.onWheel.call(scene, { y: 50 }, 0, 30);
    expect(scene.churchScrollOffset).toBe(0);
    expect(scene.drawChurchScrollContent).not.toHaveBeenCalled();

    // Pointer below the list area
    NodeMapScene.prototype.onWheel.call(scene, { y: 450 }, 0, 30);
    expect(scene.churchScrollOffset).toBe(0);
    expect(scene.drawChurchScrollContent).not.toHaveBeenCalled();
  });

  it('no stale drag after church close', () => {
    const scene = {
      _touchScrollDrag: { type: 'church', startY: 200, startOffset: 0 },
      churchOverlay: [makeDisplayObject()],
      churchContentGroup: [makeDisplayObject()],
      churchMessage: null,
      churchGoldText: null,
      _churchNode: { id: 'c1' },
      _churchViewingMap: false,
      _sceneTimers: new Set(),
      _churchMessageTimer: null,
      churchScrollOffset: 30,
      churchScrollMax: 60,
      _churchScrollItems: [],
    };

    NodeMapScene.prototype.closeChurchOverlay.call(scene);
    expect(scene._touchScrollDrag).toBeNull();
  });

  it('no stale drag after church map-view entry', () => {
    const scene = {
      churchOverlay: [makeDisplayObject()],
      churchContentGroup: [makeDisplayObject()],
      _churchViewingMap: false,
      _touchScrollDrag: { type: 'church', startY: 200, startOffset: 0 },
      _setOverlayVisibility: NodeMapScene.prototype._setOverlayVisibility,
      _setChurchOverlayVisibility: NodeMapScene.prototype._setChurchOverlayVisibility,
    };

    NodeMapScene.prototype._enterChurchMapView.call(scene);
    expect(scene._touchScrollDrag).toBeNull();
    expect(scene._churchViewingMap).toBe(true);
  });

  it('requestCancel restores both churchOverlay and churchContentGroup from map-view', () => {
    const churchObj = makeDisplayObject().setInteractive({ useHandCursor: true });
    const scrollObj = makeDisplayObject().setInteractive({ useHandCursor: true });
    churchObj.visible = false;
    churchObj.input.enabled = false;
    scrollObj.visible = false;
    scrollObj.input.enabled = false;
    const scene = makeCancelableScene({
      churchOverlay: [churchObj],
      churchContentGroup: [scrollObj],
      _churchViewingMap: true,
    });

    const handled = NodeMapScene.prototype.requestCancel.call(scene);

    expect(handled).toBe(true);
    expect(scene._churchViewingMap).toBe(false);
    expect(churchObj.visible).toBe(true);
    expect(churchObj.input.enabled).toBe(true);
    expect(scrollObj.visible).toBe(true);
    expect(scrollObj.input.enabled).toBe(true);
    expect(scene.leaveChurchNode).not.toHaveBeenCalled();
  });
});
