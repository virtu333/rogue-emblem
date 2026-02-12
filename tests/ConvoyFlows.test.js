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

    overlay.drawUnitDetails();
    const takeAction = actions.find(a => a.label === '[Take]');
    expect(takeAction).toBeTruthy();
    takeAction.onClick();

    expect(unit.consumables).toHaveLength(1);
    expect(unit.consumables[0].name).toBe('Vulnerary');
    expect(rm.getConvoyCounts().consumables).toBe(0);
  });
});
