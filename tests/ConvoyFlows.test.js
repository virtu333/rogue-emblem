import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RosterOverlay } from '../src/ui/RosterOverlay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

let NodeMapScene;
const gameData = loadGameData();

function makeDisplayObject() {
  return {
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setInteractive() { return this; },
    setOrigin() { return this; },
    setDisplaySize() { return this; },
    setColor() { return this; },
    on() { return this; },
    destroy() {},
  };
}

function makeRosterSceneStub() {
  return {
    add: {
      rectangle: () => makeDisplayObject(),
      text: () => makeDisplayObject(),
      image: () => makeDisplayObject(),
    },
    textures: {
      exists: () => false,
    },
  };
}

beforeAll(async () => {
  ({ NodeMapScene } = await import('../src/scenes/NodeMapScene.js'));
});

describe('convoy scene/UI flows', () => {
  it('routes full-consumable shop purchase to convoy', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Iris', inventory: [], consumables: new Array(CONSUMABLE_MAX).fill({}) };
    const entry = { price: 120, item: { name: 'Vulnerary', type: 'Consumable', uses: 3 } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => true),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(0);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Vulnerary sent to convoy.', '#88ccff');
  });

  it('does not consume shop entry when overflow convoy purchase cannot spend gold', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Iris', inventory: [], consumables: new Array(CONSUMABLE_MAX).fill({}) };
    const entry = { price: 120, item: { name: 'Vulnerary', type: 'Consumable', uses: 3 } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => false),
      addToConvoy: vi.fn(() => true),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).not.toHaveBeenCalled();
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Not enough gold.', '#ff8888');
  });

  it('routes full-inventory shop purchase to convoy', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Kane', inventory: new Array(INVENTORY_MAX).fill({}), consumables: [] };
    const entry = { price: 200, item: { name: 'Iron Sword', type: 'Sword' } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => true),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(0);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Iron Sword sent to convoy.', '#88ccff');
  });

  it('does not consume weapon shop entry when overflow convoy purchase cannot spend gold', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Kane', inventory: new Array(INVENTORY_MAX).fill({}), consumables: [] };
    const entry = { price: 200, item: { name: 'Iron Sword', type: 'Sword' } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => false),
      addToConvoy: vi.fn(() => true),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).not.toHaveBeenCalled();
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Not enough gold.', '#ff8888');
  });

  it('refunds gold and aborts when consumable overflow convoy add fails after spend', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Iris', inventory: [], consumables: new Array(CONSUMABLE_MAX).fill({}) };
    const entry = { price: 120, item: { name: 'Vulnerary', type: 'Consumable', uses: 3 } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => false),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.addGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith("Iris's consumables are full!", '#ff8888');
  });

  it('refunds gold and aborts when weapon overflow convoy add fails after spend', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Kane', inventory: new Array(INVENTORY_MAX).fill({}), consumables: [] };
    const entry = { price: 200, item: { name: 'Iron Sword', type: 'Sword' } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => false),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.addGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith("Kane's inventory is full!", '#ff8888');
  });

  it('stores a consumable from roster into convoy via store action', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    unit.inventory = [];
    unit.consumables = [structuredClone(vuln)];
    unit.skills = unit.skills || [];
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });
    const actions = [];
    overlay._actionBtn = (x, y, label, onClick) => {
      actions.push({ label, onClick });
      return makeDisplayObject();
    };

    overlay._activeTab = 'gear';
    overlay.drawUnitDetails();
    const storeAction = actions.find(a => a.label === '[Store]');
    expect(storeAction).toBeTruthy();
    storeAction.onClick();

    expect(unit.consumables).toHaveLength(0);
    expect(rm.getConvoyCounts().consumables).toBe(1);
  });

  it('takes a consumable from convoy into roster via take action', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    unit.inventory = [];
    unit.consumables = [];
    unit.skills = unit.skills || [];
    rm.addToConvoy(vuln);
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });
    const actions = [];
    overlay._actionBtn = (x, y, label, onClick) => {
      actions.push({ label, onClick });
      return makeDisplayObject();
    };

    overlay.select('convoy');
    overlay.drawUnitDetails();
    const takeAction = actions.find(a => a.label === '[ Withdraw ]');
    expect(takeAction).toBeTruthy();
    takeAction.onClick();

    expect(unit.consumables).toHaveLength(1);
    expect(unit.consumables[0].name).toBe('Vulnerary');
    expect(rm.getConvoyCounts().consumables).toBe(0);
  });

  it('does not crash convoy detail when roster is empty', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.roster = [];
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    rm.addToConvoy(vuln);

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });

    overlay.select('convoy');
    expect(() => overlay.drawUnitDetails()).not.toThrow();
  });

  it('show/hide is safe when scene input plugins are unavailable', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });

    expect(() => overlay.show()).not.toThrow();
    expect(() => overlay.hide()).not.toThrow();
  });

  it('does not fire onClose during initial show', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const onClose = vi.fn();
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    }, { onClose });

    overlay.show();
    expect(onClose).not.toHaveBeenCalled();

    overlay.hide();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clamps convoy scroll offset after convoy content shrinks', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    const ironSword = gameData.weapons.find(w => w.name === 'Iron Sword');
    const unit = rm.roster[0];
    unit.inventory = [];
    unit.consumables = [];

    for (let i = 0; i < 60; i++) {
      rm.addToConvoy(vuln);
    }
    rm.addToConvoy(ironSword);

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });

    overlay.select('convoy');
    overlay._convoyScrollOffset = 2000;
    overlay.drawUnitDetails();
    const beforeMax = overlay._convoyScrollMax;
    expect(beforeMax).toBeGreaterThan(0);
    expect(overlay._convoyScrollOffset).toBeLessThanOrEqual(beforeMax);

    while (rm.convoy.consumables.length > 0) {
      const pulled = rm.takeFromConvoy('consumable', 0);
      if (!pulled) break;
      unit.consumables.push(pulled);
      unit.consumables = [];
    }
    while (rm.convoy.weapons.length > 0) {
      const pulled = rm.takeFromConvoy('weapon', 0);
      if (!pulled) break;
      unit.inventory.push(pulled);
      unit.inventory = [];
    }

    overlay.drawUnitDetails();
    expect(overlay._convoyScrollMax).toBe(0);
    expect(overlay._convoyScrollOffset).toBe(0);
  });
});
