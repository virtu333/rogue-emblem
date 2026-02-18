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
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    destroy() { this._destroyed = true; },
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

function makeSellListScene({ unit, gameData = {} }) {
  const createdTexts = [];
  const scene = {
    runManager: {
      roster: [unit],
      addGold: vi.fn(),
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

function makeForgeListScene({ unit, gameData = {} }) {
  const createdTexts = [];
  const scene = {
    runManager: {
      roster: [unit],
      currentAct: 1,
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
      rectangle: (x, y, width, height, color, alpha) => makeDisplayObject({ x, y, width, height, color, alpha }),
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
    const sword = { name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof', price: 500, range: '1' };
    const unit = {
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [sword],
      weapon: sword,
    };
    const { scene, createdTexts } = makeSellListScene({ unit });

    NodeMapScene.prototype.drawShopSellList.call(scene);

    const row = createdTexts.find((obj) => typeof obj.text === 'string' && obj.text.includes('Iron Sword'));
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

    const row = createdTexts.find((obj) => typeof obj.text === 'string' && obj.text.includes('Iron Sword'));
    expect(row).toBeTruthy();
    expect(row.text).toContain('Iron Sword *');
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

    expect(createdTexts.some((obj) => typeof obj.text === 'string' && obj.text.includes('Iron Bow *'))).toBe(true);
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

  it('includes weapon art lines in weapon detail text', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {
        gameData: {
          weaponArts: {
            arts: [{
              id: 'bow_curved_shot',
              name: 'Curved Shot',
              combatMods: { rangeBonus: 1, hitBonus: 15 },
            }],
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
      }
    );
    expect(text).toContain('Art: Curved Shot - Hit +15, Range +1');
  });

  it('formats detail text for scroll entries with skill descriptions', () => {
    const skills = [{ id: 'adept', description: 'SPD% chance for an extra follow-up strike at full damage (once per combat)' }];
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      { gameData: { skills } },
      { type: 'scroll', item: { name: 'Adept Scroll', type: 'Scroll', skillId: 'adept', special: 'Teaches Adept' } }
    );
    expect(text).toContain('Teaches Adept');
    expect(text).toContain('SPD% chance');
    expect(text.split('\n')).toHaveLength(2);
  });

  it('includes weapon type in detail text', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call({}, {
      type: 'weapon',
      item: { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1' },
    });
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
          const obj = makeDisplayObject({ x: _x, y: _y, text: _text, style, width: 200, height: 40 });
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
      item: { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1' },
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
          arts: [{
            id: 'bow_curved_shot',
            name: 'Curved Shot',
            combatMods: { rangeBonus: 1 },
          }],
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
            height: 10 + (lineCount * 12),
          });
          return obj;
        },
        rectangle: (x, y, w, h, color, alpha) => makeDisplayObject({ x, y, width: w, height: h, color, alpha }),
      },
    });

    const noArtScene = makeScene();
    NodeMapScene.prototype._showForgeTooltip.call(noArtScene, {
      name: 'Iron Bow',
      might: 6,
      hit: 85,
      crit: 0,
      weight: 5,
      range: '2',
      special: '',
    }, 100, 100);
    const noArtHeight = noArtScene.forgeTooltip[0].height;

    const artScene = makeScene();
    NodeMapScene.prototype._showForgeTooltip.call(artScene, {
      name: 'Iron Bow',
      might: 6,
      hit: 85,
      crit: 0,
      weight: 5,
      range: '2',
      special: '',
      weaponArtId: 'bow_curved_shot',
    }, 100, 100);

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
