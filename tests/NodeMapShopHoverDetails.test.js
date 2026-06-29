import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
    BlendModes: { ADD: 1 },
  },
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';

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
    setInteractive(opts) {
      this._interactive = opts;
      return this;
    },
    setOrigin() {
      return this;
    },
    setColor(color) {
      this._color = color;
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
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

function makeBuyListScene({ gold, entry, gameData = {} }) {
  const createdTexts = [];
  const scene = {
    runManager: { gold },
    gameData,
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

function makeSellListScene({ unit, convoy, gameData = {} }) {
  const createdTexts = [];
  const scene = {
    runManager: {
      roster: [unit],
      addGold: vi.fn(),
      convoy: convoy || { weapons: [], consumables: [] },
      takeFromConvoy: vi.fn((type, idx) => {
        const arr =
          type === 'consumable'
            ? scene.runManager.convoy.consumables
            : scene.runManager.convoy.weapons;
        return arr.splice(idx, 1)[0] || null;
      }),
    },
    gameData,
    shopScrollOffsets: { buy: 0, sell: 0, forge: 0 },
    shopContentGroup: [],
    shopOverlay: [],
    registry: { get: () => null },
    refreshShop: vi.fn(),
    showShopBanner: vi.fn(),
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

function makeForgeListScene({ unit, convoy, gameData = {} }) {
  const createdTexts = [];
  const scene = {
    runManager: {
      roster: [unit],
      currentAct: 1,
      convoy: convoy || { weapons: [], consumables: [] },
    },
    gameData,
    shopForgesUsed: 0,
    shopScrollOffsets: { buy: 0, sell: 0, forge: 0 },
    shopContentGroup: [],
    shopOverlay: [],
    _hideForgeTooltip: vi.fn(),
    _showForgeTooltip: vi.fn(),
    showForgeStatPicker: vi.fn(),
    add: {
      text: (x, y, text, style) => {
        const obj = makeDisplayObject({ x, y, text, style, width: String(text).length * 6 });
        createdTexts.push(obj);
        return obj;
      },
      rectangle: (x, y, width, height, color, alpha) =>
        makeDisplayObject({ x, y, width, height, color, alpha }),
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
    // pointerdown exists for touch tooltip display on unaffordable items
    expect(typeof row.handlers.pointerdown).toBe('function');

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

    row.handlers.pointerdown({ button: 0 });
    expect(scene.onBuyItem).toHaveBeenCalledWith(entry);
  });

  it('adds * marker for buy rows when weapon has bound weapon art', () => {
    const entry = {
      type: 'weapon',
      price: 1200,
      item: {
        name: 'Iron Bow',
        type: 'Bow',
        might: 6,
        hit: 85,
        crit: 0,
        weight: 5,
        range: '2',
        weaponArtId: 'bow_curved_shot',
      },
    };
    const { scene, createdTexts } = makeBuyListScene({
      gold: 9999,
      entry,
      gameData: { weaponArts: { arts: [{ id: 'bow_curved_shot', name: 'Curved Shot' }] } },
    });

    NodeMapScene.prototype.drawShopBuyList.call(scene);

    expect(createdTexts[0].text).toContain('Iron Bow *');
  });

  it('keeps last-weapon sell rows disabled with the last-weapon marker', () => {
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      rankRequired: 'Prof',
      price: 500,
      range: '1',
    };
    const unit = {
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [sword],
      weapon: sword,
    };
    const { scene, createdTexts } = makeSellListScene({ unit });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    const row = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.includes('Iron Sword'),
    );
    expect(row).toBeTruthy();
    expect(row.text).toContain('(last weapon)');
    expect(row._interactive).toBeUndefined();
    expect(row.handlers.pointerdown).toBeUndefined();
  });

  it('adds * marker for sell rows when weapon has bound weapon art', () => {
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      rankRequired: 'Prof',
      price: 500,
      range: '1',
      weaponArtId: 'sword_precise_cut',
    };
    const unit = {
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [sword],
      weapon: sword,
    };
    const { scene, createdTexts } = makeSellListScene({
      unit,
      gameData: { weaponArts: { arts: [{ id: 'sword_precise_cut', name: 'Precise Cut' }] } },
    });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    const row = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.includes('Iron Sword'),
    );
    expect(row).toBeTruthy();
    expect(row.text).toContain('Iron Sword *');
  });

  it('renders sellable consumables and sells them on click', () => {
    const vulnerary = { name: 'Vulnerary', type: 'Consumable', price: 150, uses: 3 };
    const unit = {
      name: 'Iris',
      proficiencies: [],
      inventory: [],
      consumables: [vulnerary],
      weapon: null,
    };
    const { scene, createdTexts } = makeSellListScene({ unit });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    const row = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.includes('Vulnerary'),
    );
    expect(row).toBeTruthy();
    expect(row._interactive).toEqual({ useHandCursor: true });
    expect(row.handlers.pointerdown).toBeTypeOf('function');

    row.handlers.pointerdown({ button: 0 });
    expect(scene.runManager.addGold).toHaveBeenCalledWith(expect.any(Number));
    expect(unit.consumables).toHaveLength(0);
    expect(scene.refreshShop).toHaveBeenCalledTimes(1);
    expect(scene.showShopBanner).toHaveBeenCalledWith(
      expect.stringContaining('Sold Vulnerary for '),
      '#ffdd44',
    );
  });

  it('omits unsellable consumables from sell rows', () => {
    const unit = {
      name: 'Iris',
      proficiencies: [],
      inventory: [],
      consumables: [{ name: 'Free Tonic', type: 'Consumable', price: 0, uses: 1 }],
      weapon: null,
    };
    const { scene, createdTexts } = makeSellListScene({ unit });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    expect(
      createdTexts.some((obj) => typeof obj.text === 'string' && obj.text.includes('Free Tonic')),
    ).toBe(false);
  });

  it('sell scroll range counts only renderable sell rows', () => {
    const unit = {
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: Array.from({ length: 20 }, (_v, idx) => ({
        name: `Rusty ${idx + 1}`,
        type: 'Sword',
        range: '1',
        rankRequired: 'Prof',
        price: 0,
      })),
      consumables: [],
      weapon: null,
    };
    const { scene, createdTexts } = makeSellListScene({ unit });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    expect(scene.shopScrollMax).toBe(0);
    expect(
      createdTexts.some((obj) => typeof obj.text === 'string' && obj.text.includes('Rusty')),
    ).toBe(false);
  });

  it('renders convoy weapons in sell list and sells on click', () => {
    const convoyWeapon = { name: 'Steel Lance', type: 'Lance', price: 1000, range: '1' };
    const unit = {
      name: 'Edric',
      proficiencies: [],
      inventory: [],
      consumables: [],
      weapon: null,
    };
    const { scene, createdTexts } = makeSellListScene({
      unit,
      convoy: { weapons: [convoyWeapon], consumables: [] },
    });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    // Should have a "Convoy:" header
    expect(
      createdTexts.some((obj) => typeof obj.text === 'string' && obj.text.includes('Convoy:')),
    ).toBe(true);
    // Should have the weapon row
    const row = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.includes('Steel Lance'),
    );
    expect(row).toBeTruthy();
    expect(row._interactive).toEqual({ useHandCursor: true });

    // Sell it
    row.handlers.pointerdown({ button: 0 });
    expect(scene.runManager.takeFromConvoy).toHaveBeenCalledWith('weapon', 0);
    expect(scene.runManager.addGold).toHaveBeenCalled();
    expect(scene.refreshShop).toHaveBeenCalledTimes(1);
  });

  it('renders convoy consumables in sell list and sells on click', () => {
    const convoyConsumable = { name: 'Vulnerary', type: 'Consumable', price: 300, uses: 3 };
    const unit = {
      name: 'Edric',
      proficiencies: [],
      inventory: [],
      consumables: [],
      weapon: null,
    };
    const { scene, createdTexts } = makeSellListScene({
      unit,
      convoy: { weapons: [], consumables: [convoyConsumable] },
    });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    const row = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.includes('Vulnerary'),
    );
    expect(row).toBeTruthy();

    row.handlers.pointerdown({ button: 0 });
    expect(scene.runManager.takeFromConvoy).toHaveBeenCalledWith('consumable', 0);
    expect(scene.runManager.addGold).toHaveBeenCalled();
    expect(scene.refreshShop).toHaveBeenCalledTimes(1);
  });

  it('unit picker only shows no prof for proficiency-relevant items', () => {
    const createdTexts = [];
    const makePickerScene = () => ({
      runManager: {
        roster: [
          {
            name: 'Mora',
            inventory: [],
            consumables: [],
            proficiencies: [{ type: 'Axe', rank: 'Prof' }],
          },
        ],
      },
      unitPicker: null,
      add: {
        rectangle: (x, y, width, height, color, alpha) =>
          makeDisplayObject({ x, y, width, height, color, alpha }),
        text: (x, y, text, style) => {
          const obj = makeDisplayObject({ x, y, text, style, width: String(text).length * 6 });
          createdTexts.push(obj);
          return obj;
        },
      },
      closeUnitPicker: NodeMapScene.prototype.closeUnitPicker,
    });

    const scene = makePickerScene();
    scene.unitPickerState = {
      callback: vi.fn(),
      profCheckItem: null,
      itemTypeContext: 'consumable',
      offset: 0,
      maxOffset: 0,
      viewportTop: 120,
      viewportBottom: 400,
    };
    NodeMapScene.prototype.renderUnitPicker.call(scene);

    const consumableRow = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.startsWith('Mora ('),
    );
    expect(consumableRow).toBeTruthy();
    expect(consumableRow.text).toContain('Inventory 0/5 | Consumables 0/3');
    expect(consumableRow.text).not.toContain('no prof');

    createdTexts.length = 0;
    scene.unitPickerState = {
      callback: vi.fn(),
      profCheckItem: { name: 'Iron Sword', type: 'Sword' },
      itemTypeContext: 'inventory',
      offset: 0,
      maxOffset: 0,
      viewportTop: 120,
      viewportBottom: 400,
    };
    NodeMapScene.prototype.renderUnitPicker.call(scene);

    const weaponRow = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.startsWith('Mora ('),
    );
    expect(weaponRow).toBeTruthy();
    expect(weaponRow.text).toContain('no prof');
  });

  it('unit picker truncates long unit names while keeping capacity labels', () => {
    const createdTexts = [];
    const scene = {
      runManager: {
        roster: [
          {
            name: 'ExtremelyLongUnitNameForOverflow',
            inventory: [],
            consumables: [],
            proficiencies: [{ type: 'Sword', rank: 'Prof' }],
          },
        ],
      },
      unitPicker: null,
      add: {
        rectangle: (x, y, width, height, color, alpha) =>
          makeDisplayObject({ x, y, width, height, color, alpha }),
        text: (x, y, text, style) => {
          const obj = makeDisplayObject({ x, y, text, style, width: String(text).length * 6 });
          createdTexts.push(obj);
          return obj;
        },
      },
      closeUnitPicker: NodeMapScene.prototype.closeUnitPicker,
    };

    scene.unitPickerState = {
      callback: vi.fn(),
      profCheckItem: null,
      itemTypeContext: 'consumable',
      offset: 0,
      maxOffset: 0,
      viewportTop: 120,
      viewportBottom: 400,
    };

    NodeMapScene.prototype.renderUnitPicker.call(scene);

    const row = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text.includes('(Inventory'),
    );
    expect(row).toBeTruthy();
    expect(row.text).toContain('Inventory 0/5 | Consumables 0/3');
    expect(row.text).toContain('...');
    expect(row.text.includes('ExtremelyLongUnitNameForOverflow (')).toBe(false);
  });

  it('showUnitPicker keeps backward compatibility for legacy item arg', () => {
    const renderUnitPicker = vi.fn();
    const itemForProfCheck = { name: 'Iron Sword', type: 'Sword' };
    const scene = {
      runManager: { roster: [] },
      closeUnitPicker: vi.fn(),
      renderUnitPicker,
    };

    NodeMapScene.prototype.showUnitPicker.call(scene, vi.fn(), itemForProfCheck);

    expect(scene.unitPickerState.profCheckItem).toBe(itemForProfCheck);
    expect(scene.unitPickerState.itemTypeContext).toBeNull();
    expect(renderUnitPicker).toHaveBeenCalledTimes(1);
  });

  it('adds * marker for forge rows when weapon has bound weapon art', () => {
    const bow = {
      name: 'Iron Bow',
      type: 'Bow',
      rankRequired: 'Prof',
      might: 6,
      hit: 85,
      crit: 0,
      weight: 5,
      range: '2',
      weaponArtId: 'bow_curved_shot',
    };
    const unit = {
      name: 'Iris',
      inventory: [bow],
      weapon: bow,
    };
    const { scene, createdTexts } = makeForgeListScene({
      unit,
      gameData: { weaponArts: { arts: [{ id: 'bow_curved_shot', name: 'Curved Shot' }] } },
    });

    NodeMapScene.prototype.drawShopForgeList.call(scene);

    expect(
      createdTexts.some((obj) => typeof obj.text === 'string' && obj.text.includes('Iron Bow *')),
    ).toBe(true);
  });

  it('renders convoy weapons in forge list with Forge button', () => {
    const convoyWeapon = {
      name: 'Silver Sword',
      type: 'Sword',
      rankRequired: 'Mast',
      might: 13,
      hit: 80,
      crit: 0,
      weight: 8,
      range: '1',
    };
    const unit = {
      name: 'Edric',
      inventory: [],
      weapon: null,
    };
    const { scene, createdTexts } = makeForgeListScene({
      unit,
      convoy: { weapons: [convoyWeapon], consumables: [] },
    });

    NodeMapScene.prototype.drawShopForgeList.call(scene);

    expect(
      createdTexts.some((obj) => typeof obj.text === 'string' && obj.text.includes('Convoy:')),
    ).toBe(true);
    expect(
      createdTexts.some((obj) => typeof obj.text === 'string' && obj.text.includes('Silver Sword')),
    ).toBe(true);
    const forgeBtn = createdTexts.find(
      (obj) => typeof obj.text === 'string' && obj.text === '[ Forge ]',
    );
    expect(forgeBtn).toBeTruthy();
    forgeBtn.handlers.pointerdown({ button: 0 });
    expect(scene.showForgeStatPicker).toHaveBeenCalledWith(convoyWeapon);
  });

  it('formats detail text for accessory and weapon shop entries', () => {
    const accessoryText = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'accessory',
        item: { name: 'Power Ring', type: 'Accessory', effects: { STR: 2 } },
      },
    );
    expect(accessoryText).toContain('+2 STR');

    const weaponText = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'weapon',
        item: {
          name: 'Venin Blade',
          might: 8,
          hit: 90,
          crit: 0,
          weight: 3,
          range: '1',
          special: 'Poison',
        },
      },
    );
    expect(weaponText).toContain('Mt: 8');
    expect(weaponText).toContain('Wt: 3');
    expect(weaponText).toContain('Special: Poison');
  });

  it('includes weapon art lines in weapon detail text', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {
        gameData: {
          weaponArts: {
            arts: [
              {
                id: 'bow_curved_shot',
                name: 'Curved Shot',
                combatMods: { rangeBonus: 1, hitBonus: 15 },
              },
            ],
          },
        },
      },
      {
        type: 'weapon',
        item: {
          name: 'Iron Bow',
          type: 'Bow',
          might: 6,
          hit: 85,
          crit: 0,
          weight: 5,
          range: '2',
          weaponArtId: 'bow_curved_shot',
        },
      },
    );
    expect(text).toContain('Art: Curved Shot - Hit +15, Range +1');
  });

  it('formats detail text for scroll entries with skill descriptions', () => {
    const skills = [
      {
        id: 'adept',
        description: 'SPD% chance for an extra follow-up strike at full damage (once per combat)',
      },
    ];
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      { gameData: { skills } },
      {
        type: 'scroll',
        item: { name: 'Adept Scroll', type: 'Scroll', skillId: 'adept', special: 'Teaches Adept' },
      },
    );
    expect(text).toContain('Teaches Adept');
    expect(text).toContain('SPD% chance');
    expect(text.split('\n')).toHaveLength(2);
  });

  it('formats detail text for cure consumable (Herb)', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'consumable',
        item: { name: 'Herb', type: 'Consumable', effect: 'cure', uses: 2 },
      },
    );
    expect(text).toBe('Cure all status conditions (2 uses)');
  });

  it('formats detail text for cureHeal consumable (Remedy)', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'consumable',
        item: { name: 'Remedy', type: 'Consumable', effect: 'cureHeal', value: 15, uses: 1 },
      },
    );
    expect(text).toBe('Cure conditions & restore 15 HP (1 use)');
  });

  it('includes weapon type in detail text', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'weapon',
        item: {
          name: 'Iron Sword',
          type: 'Sword',
          might: 5,
          hit: 90,
          crit: 0,
          weight: 5,
          range: '1',
        },
      },
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('Sword');
    expect(lines[1]).toContain('Mt: 5');
  });

  it('tooltip box is sized from text dimensions with wordWrap', () => {
    const createdRects = [];
    const scene = {
      shopItemTooltip: null,
      _hideShopItemTooltip: NodeMapScene.prototype._hideShopItemTooltip,
      _getShopItemDetailText: NodeMapScene.prototype._getShopItemDetailText,
      gameData: { skills: [] },
      add: {
        text: (_x, _y, _text, style) => {
          const obj = makeDisplayObject({
            x: _x,
            y: _y,
            text: _text,
            style,
            width: 200,
            height: 40,
          });
          return obj;
        },
        rectangle: (x, y, w, h, color, alpha) => {
          const obj = makeDisplayObject({ x, y, width: w, height: h, color, alpha });
          createdRects.push(obj);
          return obj;
        },
      },
    };

    const entry = {
      type: 'weapon',
      item: {
        name: 'Iron Sword',
        type: 'Sword',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 5,
        range: '1',
      },
    };

    NodeMapScene.prototype._showShopItemTooltip.call(scene, entry, 100, 100);

    expect(scene.shopItemTooltip).toHaveLength(2);
    const [bg, detailText] = scene.shopItemTooltip;

    // Text should use wordWrap width of 304
    expect(detailText.style.wordWrap).toEqual({ width: 304 });

    // Box dimensions: Clamp(200 + 16, 150, 320) = 216, height = 40 + 12 = 52
    const expectedW = Math.min(320, Math.max(150, 200 + 16));
    const expectedH = 40 + 12;
    expect(bg.width).toBe(expectedW);
    expect(bg.height).toBe(expectedH);
  });

  it('forge tooltip includes weapon art line and grows with extra lines', () => {
    const makeScene = () => ({
      forgeTooltip: null,
      gameData: {
        weaponArts: {
          arts: [
            {
              id: 'bow_curved_shot',
              name: 'Curved Shot',
              combatMods: { rangeBonus: 1 },
            },
          ],
        },
      },
      _hideForgeTooltip: NodeMapScene.prototype._hideForgeTooltip,
      _getWeaponArtCatalog: NodeMapScene.prototype._getWeaponArtCatalog,
      add: {
        text: (_x, _y, text, style) => {
          const lineCount = String(text).split('\n').length;
          const obj = makeDisplayObject({
            x: _x,
            y: _y,
            text,
            style,
            width: 200,
            height: 10 + lineCount * 12,
          });
          return obj;
        },
        rectangle: (x, y, w, h, color, alpha) =>
          makeDisplayObject({ x, y, width: w, height: h, color, alpha }),
      },
    });

    const noArtScene = makeScene();
    NodeMapScene.prototype._showForgeTooltip.call(
      noArtScene,
      {
        name: 'Iron Bow',
        might: 6,
        hit: 85,
        crit: 0,
        weight: 5,
        range: '2',
        special: '',
      },
      100,
      100,
    );
    const noArtHeight = noArtScene.forgeTooltip[0].height;

    const artScene = makeScene();
    NodeMapScene.prototype._showForgeTooltip.call(
      artScene,
      {
        name: 'Iron Bow',
        might: 6,
        hit: 85,
        crit: 0,
        weight: 5,
        range: '2',
        special: '',
        weaponArtId: 'bow_curved_shot',
      },
      100,
      100,
    );

    const tooltipText = artScene.forgeTooltip
      .filter((obj) => typeof obj.text === 'string')
      .map((obj) => obj.text)
      .join('\n');
    expect(tooltipText).toContain('Art: Curved Shot - Range +1');
    expect(artScene.forgeTooltip[0].height).toBeGreaterThan(noArtHeight);
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

describe('shop touch two-tap buy', () => {
  const touchPointer = (x = 100, y = 100) => ({
    button: 0,
    wasTouch: true,
    x,
    y,
  });

  let realDateNow;
  let mockNow;

  beforeEach(() => {
    realDateNow = Date.now;
    mockNow = 1000;
    Date.now = () => mockNow;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  it('first touch tap shows tooltip only, does not buy', () => {
    const entry = {
      type: 'weapon',
      price: 500,
      item: { name: 'Iron Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1' },
    };
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry });
    NodeMapScene.prototype.drawShopBuyList.call(scene);

    const row = createdTexts[0];
    const ptr = touchPointer();
    // pointerdown records tap start, shows tooltip
    row.handlers.pointerdown(ptr);
    expect(scene.onBuyItem).not.toHaveBeenCalled();
    expect(scene._showShopItemTooltip).toHaveBeenCalledWith(entry, expect.any(Number), row.y);

    // pointerup on first tap = preview only (not buy)
    row.handlers.pointerup(ptr);
    expect(scene.onBuyItem).not.toHaveBeenCalled();
    expect(scene._touchPreviewedShopEntry).toBe(entry);
  });

  it('second touch tap within 3s buys', () => {
    const entry = {
      type: 'weapon',
      price: 500,
      item: { name: 'Iron Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1' },
    };
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry });
    NodeMapScene.prototype.drawShopBuyList.call(scene);

    const row = createdTexts[0];
    const ptr = touchPointer();

    // First tap cycle: preview
    row.handlers.pointerdown(ptr);
    row.handlers.pointerup(ptr);
    expect(scene.onBuyItem).not.toHaveBeenCalled();

    // Advance time within 3s window
    mockNow = 2500;

    // Second tap cycle: buy
    row.handlers.pointerdown(ptr);
    row.handlers.pointerup(ptr);
    expect(scene.onBuyItem).toHaveBeenCalledWith(entry);
  });

  it('second touch tap after 3s does not buy (re-previews)', () => {
    const entry = {
      type: 'weapon',
      price: 500,
      item: { name: 'Iron Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1' },
    };
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry });
    NodeMapScene.prototype.drawShopBuyList.call(scene);

    const row = createdTexts[0];
    const ptr = touchPointer();

    // First tap cycle
    row.handlers.pointerdown(ptr);
    row.handlers.pointerup(ptr);

    // Advance past 3s window
    mockNow = 4500;

    // Second tap cycle: should re-preview, not buy
    row.handlers.pointerdown(ptr);
    row.handlers.pointerup(ptr);
    expect(scene.onBuyItem).not.toHaveBeenCalled();
    expect(scene._touchPreviewedShopEntry).toBe(entry);
  });

  it('tapping unaffordable row disarms buy latch', () => {
    const affordable = {
      type: 'weapon',
      price: 500,
      item: { name: 'Iron Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1' },
    };
    const unaffordable = {
      type: 'weapon',
      price: 9999,
      item: { name: 'Silver Sword', might: 13, hit: 80, crit: 0, weight: 8, range: '1' },
    };
    const createdTexts = [];
    const scene = {
      runManager: { gold: 1000 },
      gameData: {},
      shopBuyItems: [affordable, unaffordable],
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
    NodeMapScene.prototype.drawShopBuyList.call(scene);

    const affordableRow = createdTexts[0]; // Iron Sword (affordable)
    const unaffordableRow = createdTexts[1]; // Silver Sword (unaffordable)

    const ptr = touchPointer();

    // First tap on affordable A → preview latched
    affordableRow.handlers.pointerdown(ptr);
    affordableRow.handlers.pointerup(ptr);
    expect(scene._touchPreviewedShopEntry).toBe(affordable);

    // Tap unaffordable B → latch cleared
    unaffordableRow.handlers.pointerdown(ptr);
    expect(scene._touchPreviewedShopEntry).toBeNull();

    // Single tap on A again → should NOT buy (re-previews instead)
    affordableRow.handlers.pointerdown(ptr);
    affordableRow.handlers.pointerup(ptr);
    expect(scene.onBuyItem).not.toHaveBeenCalled();
    expect(scene._touchPreviewedShopEntry).toBe(affordable);
  });

  it('scroll gesture (finger moved > 12px) disarms buy latch', () => {
    const entry = {
      type: 'weapon',
      price: 500,
      item: { name: 'Iron Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1' },
    };
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry });
    NodeMapScene.prototype.drawShopBuyList.call(scene);

    const row = createdTexts[0];

    // First tap cycle to latch preview
    const ptr = touchPointer(100, 100);
    row.handlers.pointerdown(ptr);
    row.handlers.pointerup(ptr);
    expect(scene._touchPreviewedShopEntry).toBe(entry);

    mockNow = 2000;

    // Second tap: pointerdown at (100,100) then pointerup at (100,120) — 20px move
    row.handlers.pointerdown(touchPointer(100, 100));
    row.handlers.pointerup(touchPointer(100, 120));

    // Latch should be cleared, not bought
    expect(scene.onBuyItem).not.toHaveBeenCalled();
    expect(scene._touchPreviewedShopEntry).toBeNull();
  });
});

describe('onPointerUp drag-disarm', () => {
  it('clears both two-tap latches when touch drag exceeds threshold', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: { x: 100, y: 100 },
      _tapMoveThreshold: 12,
      _touchPreviewedNodeId: 'n1',
      _touchPreviewedShopEntry: { type: 'weapon', item: { name: 'Iron Sword' } },
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => false),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
    };

    // Pointer moved 20px — exceeds threshold
    const pointer = { wasTouch: true, button: 0, x: 100, y: 120 };
    NodeMapScene.prototype.onPointerUp.call(scene, pointer);

    expect(scene._touchTapDown).toBeNull();
    expect(scene._touchPreviewedNodeId).toBeNull();
    expect(scene._touchPreviewedShopEntry).toBeNull();
    // Should have returned early — requestCancel not called
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });
});

describe('node touch two-tap navigation', () => {
  const touchPointer = () => ({ button: 0, wasTouch: true, x: 100, y: 100 });

  let realDateNow;
  let mockNow;

  beforeEach(() => {
    realDateNow = Date.now;
    mockNow = 1000;
    Date.now = () => mockNow;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  function bindNode(scene, node, pos, isAvailable) {
    const nodeObj = makeDisplayObject();
    NodeMapScene.prototype._bindNodeTouchHandlers.call(scene, nodeObj, node, pos, isAvailable);
    return nodeObj;
  }

  it('first tap shows tooltip, second tap within 3s navigates', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    // First tap → preview
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.showNodeTooltip).toHaveBeenCalledWith(node, pos);
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Second tap within 3s → navigate
    mockNow = 2500;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).toHaveBeenCalledWith(node);
    expect(scene._touchPreviewedNodeId).toBeNull();
  });

  it('second tap after 3s re-previews instead of navigating', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const nodeObj = bindNode(scene, node, { x: 100, y: 200 }, true);

    nodeObj.handlers.pointerdown(touchPointer());
    mockNow = 4500;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');
  });

  it('tapping locked node disarms navigation latch', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const nodeA = { id: 'n1', type: 'battle' };
    const lockedNode = { id: 'n2', type: 'battle' };
    const nodeObjA = bindNode(scene, nodeA, { x: 100, y: 200 }, true);
    const nodeObjLocked = bindNode(scene, lockedNode, { x: 200, y: 200 }, false);

    // First tap on available A → preview latched
    nodeObjA.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Tap locked node → latch cleared
    nodeObjLocked.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBeNull();

    // Tap A again → should NOT navigate (re-previews instead)
    mockNow = 2000;
    nodeObjA.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');
  });

  it('tapping a different available node resets latch to new node', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const nodeA = { id: 'n1', type: 'battle' };
    const nodeB = { id: 'n2', type: 'shop' };
    const nodeObjA = bindNode(scene, nodeA, { x: 100, y: 200 }, true);
    const nodeObjB = bindNode(scene, nodeB, { x: 200, y: 200 }, true);

    // Tap A → latched to n1
    nodeObjA.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Tap B → latched to n2 (not navigate A)
    mockNow = 2000;
    nodeObjB.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n2');
  });

  it('tapping interactive UI between node taps disarms latch', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      _touchDownLatchKind: null,
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: { x: 100, y: 100 },
      _tapMoveThreshold: 12,
      _touchPreviewedShopEntry: null,
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => true),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    // First tap on node → game-object pointerdown sets kind + arms latch
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');
    expect(scene._touchDownLatchKind).toBe('node');

    // Scene onPointerDown (kind='node') → preserves node latch
    const ptr1 = { wasTouch: true, button: 0, x: 100, y: 100 };
    NodeMapScene.prototype.onPointerDown.call(scene, ptr1);
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // onPointerUp over interactive → returns early, latch preserved
    NodeMapScene.prototype.onPointerUp.call(scene, ptr1);
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Now simulate gear-icon tap (no game-object sets kind → kind=null)
    // Scene onPointerDown (kind=null) → clears both latches
    const gearPtr = { wasTouch: true, button: 0, x: 200, y: 200 };
    NodeMapScene.prototype.onPointerDown.call(scene, gearPtr);
    expect(scene._touchPreviewedNodeId).toBeNull();

    // onPointerUp over interactive → early return
    NodeMapScene.prototype.onPointerUp.call(scene, gearPtr);
    expect(scene.requestCancel).not.toHaveBeenCalled();

    // Second tap on same node within 3s → should NOT navigate (re-previews)
    mockNow = 2500;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');
  });

  it('mouse click navigates immediately without showing tooltip', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    // Mouse click (no wasTouch) → immediate navigate
    nodeObj.handlers.pointerdown({ button: 0 });
    expect(scene.onNodeClick).toHaveBeenCalledWith(node);
    expect(scene.showNodeTooltip).not.toHaveBeenCalled();
  });

  it('pointerover shows tooltip and pointerout hides it', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    nodeObj.handlers.pointerover();
    expect(scene.showNodeTooltip).toHaveBeenCalledWith(node, pos);

    nodeObj.handlers.pointerout();
    expect(scene.hideNodeTooltip).toHaveBeenCalledTimes(1);
  });
});

describe('two-tap latch lifecycle with full pointerdown-pointerup cycle', () => {
  const touchPointer = (x = 100, y = 100) => ({ button: 0, wasTouch: true, x, y });

  let realDateNow;
  let mockNow;

  beforeEach(() => {
    realDateNow = Date.now;
    mockNow = 1000;
    Date.now = () => mockNow;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  function bindNode(scene, node, pos, isAvailable) {
    const nodeObj = makeDisplayObject();
    NodeMapScene.prototype._bindNodeTouchHandlers.call(scene, nodeObj, node, pos, isAvailable);
    return nodeObj;
  }

  function makeLifecycleScene(overrides = {}) {
    return {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      _touchPreviewedShopEntry: null,
      _touchPreviewedShopAt: null,
      _touchDownLatchKind: null,
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: { x: 100, y: 100 },
      _tapMoveThreshold: 12,
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => true),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
      ...overrides,
    };
  }

  it('node two-tap with full pointerdown-pointerup cycle navigates', () => {
    const scene = makeLifecycleScene();
    const node = { id: 'n1', type: 'battle' };
    const nodeObj = bindNode(scene, node, { x: 100, y: 200 }, true);

    // Tap 1: game-object pointerdown → arms latch + sets kind
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');
    expect(scene._touchDownLatchKind).toBe('node');

    // Scene onPointerDown (kind='node') → preserves node latch
    NodeMapScene.prototype.onPointerDown.call(scene, touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // onPointerUp over interactive → early return, latch preserved
    NodeMapScene.prototype.onPointerUp.call(scene, touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Tap 2: game-object pointerdown → latch matches → navigate
    mockNow = 2000;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).toHaveBeenCalledWith(node);
  });

  it('shop two-tap with full pointerdown-pointerup cycle buys', () => {
    const entry = { type: 'weapon', price: 500, item: { name: 'Iron Sword' } };
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry });

    // Add lifecycle properties
    scene._touchPreviewedNodeId = null;
    scene._touchPreviewedShopEntry = null;
    scene._touchPreviewedShopAt = null;
    scene._touchDownLatchKind = null;
    scene._storyDialogueActive = false;
    scene.dialogueOverlay = null;
    scene._touchScrollDrag = null;
    scene._touchTapDown = { x: 100, y: 100 };
    scene._tapMoveThreshold = 12;
    scene._churchMapViewSuppressCancel = false;
    scene._isPointerOverInteractive = vi.fn(() => true);
    scene._clearTouchPreviewLatches = NodeMapScene.prototype._clearTouchPreviewLatches;
    scene.requestCancel = vi.fn();

    NodeMapScene.prototype.drawShopBuyList.call(scene);
    const row = createdTexts[0];

    // Tap 1: game-object pointerdown (tooltip + kind='shop')
    const ptr = touchPointer();
    row.handlers.pointerdown(ptr);
    expect(scene._touchDownLatchKind).toBe('shop');

    // Scene onPointerDown (kind='shop') → preserves shop latch, clears node
    NodeMapScene.prototype.onPointerDown.call(scene, ptr);
    expect(scene._touchPreviewedNodeId).toBeNull();

    // game-object pointerup → arms latch
    row.handlers.pointerup(ptr);
    expect(scene._touchPreviewedShopEntry).toBe(entry);

    // Scene onPointerUp over interactive → early return
    NodeMapScene.prototype.onPointerUp.call(scene, ptr);
    expect(scene._touchPreviewedShopEntry).toBe(entry);

    // Tap 2: game-object pointerdown (kind='shop')
    mockNow = 2000;
    const ptr2 = touchPointer();
    row.handlers.pointerdown(ptr2);
    expect(scene._touchDownLatchKind).toBe('shop');

    // Scene onPointerDown (kind='shop') → preserves shop latch
    NodeMapScene.prototype.onPointerDown.call(scene, ptr2);
    expect(scene._touchPreviewedShopEntry).toBe(entry);

    // game-object pointerup → latch matches → buy
    row.handlers.pointerup(ptr2);
    expect(scene.onBuyItem).toHaveBeenCalledWith(entry);
  });

  it('cross-type tap clears mismatched latch', () => {
    const scene = makeLifecycleScene();
    const node = { id: 'n1', type: 'battle' };
    const nodeObj = bindNode(scene, node, { x: 100, y: 200 }, true);

    // Arm node latch
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Scene onPointerDown (kind='node') → preserves
    NodeMapScene.prototype.onPointerDown.call(scene, touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Now simulate shop item tap (kind='shop')
    scene._touchDownLatchKind = 'shop';
    NodeMapScene.prototype.onPointerDown.call(scene, touchPointer());

    // Node latch cleared because kind was 'shop', not 'node'
    expect(scene._touchPreviewedNodeId).toBeNull();
  });

  it('event-order robustness: shop pointerup before scene onPointerUp', () => {
    const entry = { type: 'weapon', price: 500, item: { name: 'Iron Sword' } };
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry });

    scene._touchPreviewedNodeId = null;
    scene._touchPreviewedShopEntry = null;
    scene._touchPreviewedShopAt = null;
    scene._touchDownLatchKind = null;
    scene._storyDialogueActive = false;
    scene.dialogueOverlay = null;
    scene._touchScrollDrag = null;
    scene._touchTapDown = { x: 100, y: 100 };
    scene._tapMoveThreshold = 12;
    scene._churchMapViewSuppressCancel = false;
    scene._isPointerOverInteractive = vi.fn(() => true);
    scene._clearTouchPreviewLatches = NodeMapScene.prototype._clearTouchPreviewLatches;
    scene.requestCancel = vi.fn();

    NodeMapScene.prototype.drawShopBuyList.call(scene);
    const row = createdTexts[0];

    // Tap 1 cycle
    const ptr = touchPointer();
    row.handlers.pointerdown(ptr);
    NodeMapScene.prototype.onPointerDown.call(scene, ptr);
    row.handlers.pointerup(ptr);
    expect(scene._touchPreviewedShopEntry).toBe(entry);
    // Scene onPointerUp after game-object pointerup — latch still preserved
    NodeMapScene.prototype.onPointerUp.call(scene, ptr);
    expect(scene._touchPreviewedShopEntry).toBe(entry);

    // Tap 2 — reversed: scene onPointerUp BEFORE game-object pointerup
    mockNow = 2000;
    const ptr2 = touchPointer();
    row.handlers.pointerdown(ptr2);
    NodeMapScene.prototype.onPointerDown.call(scene, ptr2);
    // Scene onPointerUp fires first (over interactive → early return)
    NodeMapScene.prototype.onPointerUp.call(scene, ptr2);
    expect(scene._touchPreviewedShopEntry).toBe(entry);
    // Game-object pointerup fires → latch matches → buy
    row.handlers.pointerup(ptr2);
    expect(scene.onBuyItem).toHaveBeenCalledWith(entry);
  });
});

describe('drawMap node handler delegation', () => {
  it('calls _bindNodeTouchHandlers for available and locked nodes', () => {
    const availableNode = {
      id: 'n0',
      row: 0,
      col: 2,
      type: 'battle',
      completed: false,
      edges: ['n1'],
    };
    const lockedNode = {
      id: 'n1',
      row: 1,
      col: 2,
      type: 'battle',
      completed: false,
      edges: ['n0'],
    };

    const chainable = () => {
      const obj = makeDisplayObject();
      obj.setDisplaySize = function () {
        return this;
      };
      obj.setTint = function () {
        return this;
      };
      obj.setAlpha = function () {
        return this;
      };
      obj.setBlendMode = function () {
        return this;
      };
      return obj;
    };

    const scene = {
      children: { removeAll: vi.fn() },
      cameras: { main: { centerX: 320, width: 640 } },
      textures: { exists: vi.fn(() => false) },
      tweens: { add: vi.fn() },
      registry: { get: vi.fn(() => null) },
      add: {
        text: () => chainable(),
        graphics: () => ({
          lineStyle: vi.fn(),
          lineBetween: vi.fn(),
        }),
        rectangle: () => chainable(),
        circle: () => chainable(),
        image: () => chainable(),
      },
      runManager: {
        nodeMap: {
          actId: 'act1',
          startNodeId: 'n0',
          nodes: [availableNode, lockedNode],
        },
        currentAct: 'act1',
        actIndex: 0,
        currentNodeId: null,
        gold: 500,
        difficultyModifiers: null,
        noMetaMode: false,
        winStreak: 0,
        getAvailableNodes: () => [availableNode],
      },
      _bindNodeTouchHandlers: vi.fn(),
      drawRoster: vi.fn(),
    };

    NodeMapScene.prototype.drawMap.call(scene);

    expect(scene._bindNodeTouchHandlers).toHaveBeenCalledTimes(2);
    // Available node: isAvailable = true
    expect(scene._bindNodeTouchHandlers).toHaveBeenCalledWith(
      expect.any(Object),
      availableNode,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      true,
    );
    // Locked node: isAvailable = false
    expect(scene._bindNodeTouchHandlers).toHaveBeenCalledWith(
      expect.any(Object),
      lockedNode,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      false,
    );
  });
});

describe('pointerupoutside lifecycle', () => {
  it('resets touch state without calling requestCancel', () => {
    const scene = {
      _touchScrollDrag: { type: 'church', startY: 100, startOffset: 0 },
      _touchTapDown: { x: 50, y: 50 },
      _touchDownLatchKind: 'node',
      _churchMapViewSuppressCancel: true,
      _touchPreviewedNodeId: 'n3',
      _touchPreviewedShopEntry: { type: 'weapon', item: { name: 'Iron Sword' } },
      requestCancel: vi.fn(),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
    };

    NodeMapScene.prototype.onPointerUpOutside.call(scene, { button: 0, x: -10, y: -10 });

    expect(scene._touchScrollDrag).toBeNull();
    expect(scene._touchTapDown).toBeNull();
    expect(scene._touchDownLatchKind).toBeNull();
    expect(scene._churchMapViewSuppressCancel).toBe(false);
    expect(scene._touchPreviewedNodeId).toBeNull();
    expect(scene._touchPreviewedShopEntry).toBeNull();
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });

  it('blank-map tap clears latches and calls requestCancel', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: null,
      _tapMoveThreshold: 12,
      _touchDownLatchKind: null,
      _churchMapViewSuppressCancel: false,
      _touchPreviewedNodeId: 'n2',
      _touchPreviewedShopEntry: { type: 'weapon', item: { name: 'Steel Axe' } },
      _isPointerOverInteractive: vi.fn(() => false),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
    };

    NodeMapScene.prototype.onPointerUp.call(scene, { button: 0, x: 200, y: 200 });

    expect(scene._touchPreviewedNodeId).toBeNull();
    expect(scene._touchPreviewedShopEntry).toBeNull();
    expect(scene.requestCancel).toHaveBeenCalledWith({ allowPause: false });
  });

  it('_touchDownLatchKind is cleared in onPointerUp as safety net', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: null,
      _tapMoveThreshold: 12,
      _touchDownLatchKind: 'node',
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => true),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
    };

    NodeMapScene.prototype.onPointerUp.call(scene, { button: 0, x: 100, y: 100 });

    expect(scene._touchDownLatchKind).toBeNull();
  });

  it('_touchDownLatchKind is cleared on story-dialogue early return', () => {
    const scene = {
      _storyDialogueActive: true,
      dialogueOverlay: null,
      _touchDownLatchKind: 'shop',
      requestCancel: vi.fn(),
    };

    NodeMapScene.prototype.onPointerUp.call(scene, { button: 0, x: 100, y: 100 });

    expect(scene._touchDownLatchKind).toBeNull();
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });
});

// Exercises the gamepad focus-entry generation INSIDE the real draw fns (the
// regression-prone half the synthetic ShopControllerGamepad tests inject around):
// which rows are registered as focusable, that off-screen rows still register, and
// that only rendered rows carry the _shopFocusKey tag the ring resolves against.
describe('NodeMap shop gamepad focus entries (real draw fns)', () => {
  it('buy list: one focus entry per row incl. off-screen; only rendered rows are tagged', () => {
    const items = Array.from({ length: 16 }, (_v, i) => ({
      type: 'weapon',
      price: 100,
      item: {
        name: `Blade ${i}`,
        type: 'Sword',
        might: 5,
        hit: 70,
        crit: 0,
        weight: 5,
        range: '1',
      },
    }));
    const { scene, createdTexts } = makeBuyListScene({ gold: 9999, entry: items[0] });
    scene.shopBuyItems = items;

    NodeMapScene.prototype.drawShopBuyList.call(scene);

    // every item registers a focus entry (incl. rows culled below the fold)...
    expect(scene._shopFocusEntries).toHaveLength(16);
    expect(scene._shopFocusEntries.map((e) => e.key)).toEqual([...Array(16).keys()]);
    // ...but only on-screen rows are rendered + tagged
    const tagged = createdTexts.filter((t) => t._shopFocusKey !== undefined);
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.length).toBeLessThan(16);
    tagged.forEach((t) => expect(t._shopFocusKey).toBeLessThan(16));
  });

  it('sell list: unit header rows are not focusable; sellable item rows are', () => {
    const vulnerary = { name: 'Vulnerary', type: 'Consumable', price: 150, uses: 3 };
    const unit = {
      name: 'Iris',
      proficiencies: [],
      inventory: [],
      consumables: [vulnerary],
      weapon: null,
    };
    const { scene, createdTexts } = makeSellListScene({ unit });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    expect(scene._shopFocusEntries).toHaveLength(1); // only the consumable
    expect(createdTexts.find((t) => t.text === 'Iris:')._shopFocusKey).toBeUndefined();
    const row = createdTexts.find(
      (t) => typeof t.text === 'string' && t.text.includes('Vulnerary'),
    );
    expect(row._shopFocusKey).toBe(0);
  });

  it('sell list: a locked last-weapon row is not focusable', () => {
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      rankRequired: 'Prof',
      price: 500,
      range: '1',
    };
    const unit = {
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [sword],
      weapon: sword,
    };
    const { scene, createdTexts } = makeSellListScene({ unit });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    expect(scene._shopFocusEntries).toHaveLength(0); // last weapon is locked
    const row = createdTexts.find(
      (t) => typeof t.text === 'string' && t.text.includes('Iron Sword'),
    );
    expect(row._shopFocusKey).toBeUndefined();
  });

  it('forge list: only the actionable [ Forge ] button is focusable, not the labels', () => {
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      rankRequired: 'Prof',
      might: 5,
      hit: 80,
      crit: 0,
      weight: 5,
      range: '1',
    };
    const unit = { name: 'Edric', inventory: [sword], weapon: sword };
    const { scene, createdTexts } = makeForgeListScene({ unit });

    NodeMapScene.prototype.drawShopForgeList.call(scene);

    expect(scene._shopFocusEntries).toHaveLength(1); // the forgeable weapon's button
    expect(createdTexts.find((t) => t.text === '[ Forge ]')._shopFocusKey).toBe(0);
    // the weapon-name label and the 'Edric:' unit header are NOT focusable
    const nameRow = createdTexts.find(
      (t) => typeof t.text === 'string' && t.text.includes('Iron Sword'),
    );
    expect(nameRow._shopFocusKey).toBeUndefined();
    expect(createdTexts.find((t) => t.text === 'Edric:')._shopFocusKey).toBeUndefined();
  });
});
