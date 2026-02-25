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
    expect(text).toBe('Cures all conditions (2 uses)');
  });

  it('formats detail text for cureHeal consumable (Remedy)', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'consumable',
        item: { name: 'Remedy', type: 'Consumable', effect: 'cureHeal', value: 15, uses: 1 },
      },
    );
    expect(text).toBe('Cures conditions & heals 15 HP (1 use)');
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
