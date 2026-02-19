import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RosterOverlay } from '../src/ui/RosterOverlay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

let NodeMapScene;
const gameData = loadGameData();

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setInteractive() {
      this._interactive = true;
      return this;
    },
    setOrigin() {
      return this;
    },
    setDisplaySize() {
      return this;
    },
    setColor() {
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy() {
      this._destroyed = true;
    },
  };
}

function makeSceneStub() {
  const created = {
    rectangles: [],
    texts: [],
    images: [],
  };
  const scene = {
    add: {
      rectangle: (x, y, width, height, color, alpha) => {
        const obj = makeDisplayObject({ kind: 'rectangle', x, y, width, height, color, alpha });
        created.rectangles.push(obj);
        return obj;
      },
      text: (x, y, text, style) => {
        const obj = makeDisplayObject({ kind: 'text', x, y, text, style });
        created.texts.push(obj);
        return obj;
      },
      image: (x, y, key) => {
        const obj = makeDisplayObject({ kind: 'image', x, y, key });
        created.images.push(obj);
        return obj;
      },
    },
    textures: {
      exists: () => false,
    },
    registry: {
      get: () => null,
    },
    input: {
      keyboard: {
        on() {},
        off() {},
      },
      on() {},
      off() {},
    },
    events: {
      on() {},
      off() {},
    },
    created,
  };
  return scene;
}

function makeOverlay(activeTab = 'gear') {
  const rm = new RunManager(gameData);
  rm.startRun();
  const scene = makeSceneStub();
  const overlay = new RosterOverlay(scene, rm, {
    lords: gameData.lords || [],
    classes: gameData.classes || [],
    skills: gameData.skills || [],
    accessories: gameData.accessories || [],
    weaponArts: gameData.weaponArts || { arts: [] },
  });
  overlay._activeTab = activeTab;
  return { overlay, rm, scene };
}

function seedRoster(rm, count) {
  const template = structuredClone(rm.roster[0]);
  rm.roster = Array.from({ length: count }, (_, i) => {
    const unit = structuredClone(template);
    unit.name = `Unit${i + 1}`;
    unit.level = Number.isFinite(unit.level) ? unit.level : 1;
    unit.stats = unit.stats || { HP: 20 };
    unit.currentHP = Number.isFinite(unit.currentHP) ? unit.currentHP : unit.stats.HP;
    unit.inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
    unit.consumables = Array.isArray(unit.consumables) ? unit.consumables : [];
    unit.skills = Array.isArray(unit.skills) ? unit.skills : [];
    return unit;
  });
}

beforeAll(async () => {
  ({ NodeMapScene } = await import('../src/scenes/NodeMapScene.js'));
});

describe('accessory UI flows', () => {
  it('shows [Equip] when unit has no accessory and pool is non-empty', () => {
    const { overlay, rm } = makeOverlay();
    const unit = rm.roster[0];
    unit.accessory = null;
    rm.accessories = [{ name: 'Goddess Icon', effects: { LCK: 5 } }];

    const labels = [];
    overlay._actionBtn = (_x, _y, label) => {
      labels.push(label);
      return makeDisplayObject();
    };

    overlay.drawUnitDetails();
    expect(labels).toContain('[Equip]');
  });

  it('shows [Swap] and [Unequip] when unit has accessory and pool is non-empty', () => {
    const { overlay, rm } = makeOverlay();
    const unit = rm.roster[0];
    unit.accessory = { name: 'Power Ring', effects: { STR: 2 } };
    rm.accessories = [{ name: 'Goddess Icon', effects: { LCK: 5 } }];

    const labels = [];
    overlay._actionBtn = (_x, _y, label) => {
      labels.push(label);
      return makeDisplayObject();
    };

    overlay.drawUnitDetails();
    expect(labels).toContain('[Unequip]');
    expect(labels).toContain('[Swap]');
  });

  it('sizes accessory picker to actual row count when pool is small', () => {
    const { overlay, rm, scene } = makeOverlay();
    const unit = rm.roster[0];
    rm.accessories = [
      { name: 'Goddess Icon', effects: { LCK: 5 } },
      { name: 'Power Ring', effects: { STR: 2 } },
    ];

    overlay._showAccessoryPicker(unit);

    const pickerBg = scene.created.rectangles[0];
    expect(pickerBg).toBeTruthy();
    expect(pickerBg.height).toBe(142); // title(34) + rows(2*24) + nav(2*24) + pad(12)
    expect(scene.created.texts.some((t) => t.text === 'Page 1/1')).toBe(true);
  });

  it('caps visible rows at 8 and supports paging for larger pools', () => {
    const { overlay, rm, scene } = makeOverlay();
    const unit = rm.roster[0];
    rm.accessories = Array.from({ length: 10 }, (_v, i) => ({
      name: `Accessory ${i + 1}`,
      effects: { STR: 1 },
    }));

    overlay._showAccessoryPicker(unit);

    const pickerBg = scene.created.rectangles[0];
    expect(pickerBg).toBeTruthy();
    expect(pickerBg.height).toBe(286); // title(34) + rows(8*24) + nav(2*24) + pad(12)
    expect(scene.created.texts.some((t) => t.text === 'Page 1/2')).toBe(true);

    const nextBtn = scene.created.texts.find((t) => t.text === 'Next');
    expect(nextBtn?.handlers.pointerdown).toBeTypeOf('function');
    nextBtn.handlers.pointerdown();

    expect(scene.created.texts.some((t) => t.text === 'Page 2/2')).toBe(true);
  });

  it('equips selected accessory from picker and returns prior accessory to pool', () => {
    const { overlay, rm } = makeOverlay();
    const unit = rm.roster[0];
    unit.accessory = { name: 'Old Charm', effects: {} };
    rm.accessories = [{ name: 'Goddess Icon', effects: { LCK: 5 } }];
    overlay._showBanner = vi.fn();

    overlay._showAccessoryPicker(unit);

    const equipBtn = overlay.tradeObjects.find(
      (obj) => typeof obj?.text === 'string' && obj.text.startsWith('Goddess Icon'),
    );
    expect(equipBtn?.handlers.pointerdown).toBeTypeOf('function');

    equipBtn.handlers.pointerdown();

    expect(unit.accessory?.name).toBe('Goddess Icon');
    expect(rm.accessories.some((a) => a.name === 'Old Charm')).toBe(true);
    expect(rm.accessories.some((a) => a.name === 'Goddess Icon')).toBe(false);
  });

  it('preserves roster left-panel scroll while switching detail tabs', () => {
    const { overlay, rm } = makeOverlay('gear');
    seedRoster(rm, 14);

    overlay.show();
    overlay.select('unit', 13);
    expect(overlay._rosterScrollOffset).toBeGreaterThan(0);
    const scrollOffsetBefore = overlay._rosterScrollOffset;

    overlay._activeTab = 'stats';
    overlay.drawUnitDetails();
    overlay._activeTab = 'gear';
    overlay.drawUnitDetails();

    expect(overlay.selection).toEqual({ kind: 'unit', index: 13 });
    expect(overlay._rosterScrollOffset).toBe(scrollOffsetBefore);
  });

  it('shows correct pool banner for scroll purchases', () => {
    const audio = { playSFX: vi.fn() };
    const entry = {
      type: 'scroll',
      price: 120,
      item: { name: 'Sol Scroll' },
    };
    const rm = {
      gold: 9999,
      scrolls: [],
      accessories: [],
      spendGold: vi.fn(() => true),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(ctx.showShopBanner).toHaveBeenCalledWith(
      'Got Sol Scroll! Added to Scroll Pool.',
      '#88ff88',
    );
    expect(rm.scrolls).toHaveLength(1);
  });

  it('shows correct pool banner for accessory purchases', () => {
    const audio = { playSFX: vi.fn() };
    const entry = {
      type: 'accessory',
      price: 1500,
      item: { name: 'Goddess Icon', effects: { LCK: 5 } },
    };
    const rm = {
      gold: 9999,
      scrolls: [],
      accessories: [],
      spendGold: vi.fn(() => true),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(ctx.showShopBanner).toHaveBeenCalledWith(
      'Got Goddess Icon! Added to Accessory Pool.',
      '#88ff88',
    );
    expect(rm.accessories).toHaveLength(1);
  });
});
