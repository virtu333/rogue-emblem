import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateLootChoicesMock } = vi.hoisted(() => ({
  generateLootChoicesMock: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/LootSystem.js', async () => {
  const actual = await vi.importActual('../src/engine/LootSystem.js');
  return {
    ...actual,
    generateLootChoices: generateLootChoicesMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import * as LootSystem from '../src/engine/LootSystem.js';
import { GOLD_LOOT_REWARD_MULTIPLIER } from '../src/utils/constants.js';

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    visible: true,
    input: null,
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    setInteractive() {
      if (!this.input) this.input = {};
      this.input.enabled = true;
      return this;
    },
    disableInteractive() {
      if (this.input) this.input.enabled = false;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setColor() {
      return this;
    },
    setAlpha() {
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy() {
      this.destroyed = true;
    },
    setVisible(visible) {
      this.visible = visible;
      return this;
    },
  };
}

function makeScene(metaEffects) {
  const scene = new BattleScene();
  scene.isElite = false;
  scene.isBoss = false;
  scene.goldEarned = 0;
  scene.registry = {
    get: (key) => {
      if (key === 'audio') return null;
      if (key === 'hints') return { shouldShow: () => false };
      return null;
    },
  };
  scene.cameras = {
    main: { centerX: 320, centerY: 240, width: 640, height: 480 },
  };
  scene.add = {
    rectangle: () => makeDisplayObject(),
    text: () => makeDisplayObject(),
  };
  scene.input = {
    on: vi.fn(),
    off: vi.fn(),
    keyboard: {
      on: vi.fn(),
      off: vi.fn(),
    },
  };
  scene.time = {
    delayedCall: vi.fn(() => ({ remove: vi.fn() })),
  };
  scene.runManager = {
    currentAct: 'act1',
    roster: [],
    gold: 0,
    addGold: vi.fn(),
    getWeaponArtSpawnConfig: () => null,
    ...(metaEffects ? { metaEffects } : {}),
  };
  scene.gameData = {
    lootTables: {},
    weapons: [],
    consumables: [],
    accessories: [],
    whetstones: [],
    classes: [],
  };
  return scene;
}

describe('BattleScene loot meta wiring', () => {
  beforeEach(() => {
    generateLootChoicesMock.mockReset();
    generateLootChoicesMock.mockReturnValue([]);
  });

  it('passes meta lootWeaponQualityBonus as arg #6 and keeps weight options passthrough', () => {
    const lootCategoryWeightBonuses = { weapon: 2, healing: -1 };
    const scene = makeScene({
      lootWeaponQualityBonus: 10,
      lootCategoryWeightBonuses,
    });

    BattleScene.prototype.showLootScreen.call(scene);

    expect(generateLootChoicesMock).toHaveBeenCalledTimes(1);
    const args = generateLootChoicesMock.mock.calls[0];
    expect(args[5]).toBe(10);
    expect(args[13]).toEqual({ lootCategoryWeightBonuses });
  });

  it('defaults arg #6 to 0 when meta lootWeaponQualityBonus is absent', () => {
    const scene = makeScene({
      lootCategoryWeightBonuses: { accessory: 2 },
    });

    BattleScene.prototype.showLootScreen.call(scene);

    expect(generateLootChoicesMock).toHaveBeenCalledTimes(1);
    const args = generateLootChoicesMock.mock.calls[0];
    expect(args[5]).toBe(0);
  });

  it('falls back to legacy lootWeaponWeightBonus when quality field is absent', () => {
    const scene = makeScene({
      lootWeaponWeightBonus: 12,
      lootCategoryWeightBonuses: { weapon: 2 },
    });

    BattleScene.prototype.showLootScreen.call(scene);

    expect(generateLootChoicesMock).toHaveBeenCalledTimes(1);
    const args = generateLootChoicesMock.mock.calls[0];
    expect(args[5]).toBe(12);
  });

  it('maps split loot categories to display icon/color buckets', () => {
    const textCalls = [];
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'healing',
        item: { id: 'potion', name: 'Potion', description: 'Heals HP.' },
      },
    ]);
    const scene = makeScene({
      lootWeaponQualityBonus: 0,
    });
    scene.add.text = (...args) => {
      textCalls.push(args);
      return makeDisplayObject();
    };

    BattleScene.prototype.showLootScreen.call(scene);

    const iconCalls = textCalls.filter((call) => call[3]?.fontSize === '28px');
    const iconTexts = iconCalls.map((call) => call[2]);
    expect(iconTexts).toContain('H');
    expect(iconTexts).not.toContain('?');
    const healingIcon = iconCalls.find((call) => call[2] === 'H');
    expect(healingIcon[3].color).toBe('#88ff88');
  });

  it('shows accessory pool feedback when accessory loot is selected', () => {
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'accessory',
        item: {
          name: 'Goddess Icon',
          type: 'Accessory',
          effects: { LCK: 5 },
          price: 1000,
        },
      },
    ]);
    const scene = makeScene({
      lootWeaponQualityBonus: 0,
    });
    scene.showLootStatus = vi.fn();
    scene.finalizeLootPick = vi.fn();

    BattleScene.prototype.showLootScreen.call(scene);

    const lootCard = scene._lootCards?.[0]?.bg;
    expect(lootCard).toBeTruthy();
    expect(typeof lootCard.handlers.pointerdown).toBe('function');

    lootCard.handlers.pointerdown({ button: 0 });

    expect(scene.runManager.accessories).toHaveLength(1);
    expect(scene.runManager.accessories[0].name).toBe('Goddess Icon');
    expect(scene.showLootStatus).toHaveBeenCalledWith(
      'Added Goddess Icon to Accessory Pool.',
      '#88ff88',
    );
    expect(scene.finalizeLootPick).toHaveBeenCalledTimes(1);
  });

  it('routes stat-booster loot through unit picker and applies boost on selection', () => {
    const rectangles = [];
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'statBooster',
        item: {
          name: 'Energy Drop',
          type: 'Consumable',
          effect: 'statBoost',
          stat: 'STR',
          value: 2,
          price: 2000,
        },
      },
    ]);
    const scene = makeScene({
      lootWeaponQualityBonus: 0,
    });
    const unit = {
      name: 'Edric',
      stats: { STR: 8, HP: 24 },
      currentHP: 24,
      inventory: [],
      consumables: [],
    };
    scene.runManager.roster = [unit];
    scene.add.rectangle = (...args) => {
      const obj = makeDisplayObject({ args });
      rectangles.push(obj);
      return obj;
    };
    scene.add.text = (..._args) => makeDisplayObject();
    scene.finalizeLootPick = vi.fn();

    BattleScene.prototype.showLootScreen.call(scene);

    const lootCard = scene._lootCards?.[0]?.bg;
    expect(lootCard).toBeTruthy();
    expect(typeof lootCard.handlers.pointerdown).toBe('function');

    lootCard.handlers.pointerdown({ button: 0 });

    const unitBtn = [...rectangles]
      .reverse()
      .find((obj) => obj.args?.[2] === 200 && typeof obj.handlers.pointerdown === 'function');
    expect(unitBtn).toBeTruthy();

    unitBtn.handlers.pointerdown({ button: 0 });

    expect(unit.stats.STR).toBe(10);
    expect(scene.finalizeLootPick).toHaveBeenCalledTimes(1);
  });

  it('keeps large stat-booster rosters scrollable and selectable', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.finalizeLootPick = vi.fn();
    scene.runManager.roster = Array.from({ length: 14 }, (_v, i) => ({
      name: `Unit${i}`,
      stats: { RES: i, HP: 20 },
      currentHP: 20,
      inventory: [],
      consumables: [],
    }));

    const rowButtons = [];
    scene.add.rectangle = (...args) => {
      const obj = makeDisplayObject({ args });
      if (args[2] === 200) rowButtons.push(obj);
      return obj;
    };
    scene.add.text = (...args) => makeDisplayObject({ args, text: args[2] });

    const lootGroup = [makeDisplayObject(), makeDisplayObject()];
    const item = { name: 'Talisman', effect: 'statBoost', stat: 'RES', value: 2 };
    BattleScene.prototype.showStatBoostUnitPicker.call(scene, item, lootGroup, 0);

    expect(rowButtons).toHaveLength(14);
    const lastBtn = rowButtons[rowButtons.length - 1];
    expect(lastBtn.visible).toBe(false);
    expect(lastBtn.input?.enabled).toBe(false);

    const wheelCall = scene.input.on.mock.calls.find((call) => call[0] === 'wheel');
    expect(wheelCall).toBeTruthy();
    const wheelHandler = wheelCall[1];
    for (let i = 0; i < 20; i++) {
      wheelHandler({ x: 320, y: 200 }, null, 0, 120);
    }

    expect(lastBtn.visible).toBe(true);
    expect(lastBtn.input?.enabled).toBe(true);

    lastBtn.handlers.pointerdown({ button: 0 });
    expect(scene.runManager.roster[13].stats.RES).toBe(15);
    expect(scene.finalizeLootPick).toHaveBeenCalledTimes(1);
  });

  it('Escape backs out of stat-booster picker and detaches scroll handlers', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.runManager.roster = Array.from({ length: 12 }, (_v, i) => ({
      name: `Unit${i}`,
      stats: { DEF: i, HP: 20 },
      currentHP: 20,
      inventory: [],
      consumables: [],
    }));

    scene.add.rectangle = (...args) => makeDisplayObject({ args });
    scene.add.text = (...args) => makeDisplayObject({ args, text: args[2] });

    const lootGroup = [makeDisplayObject(), makeDisplayObject()];
    const item = { name: 'Dracoshield', effect: 'statBoost', stat: 'DEF', value: 2 };
    BattleScene.prototype.showStatBoostUnitPicker.call(scene, item, lootGroup, 0);

    const wheelCall = scene.input.on.mock.calls.find((call) => call[0] === 'wheel');
    expect(wheelCall).toBeTruthy();
    const wheelHandler = wheelCall[1];

    const keyCall = scene.input.keyboard.on.mock.calls.find((call) => call[0] === 'keydown');
    expect(keyCall).toBeTruthy();
    const keyHandler = keyCall[1];

    const preventDefault = vi.fn();
    keyHandler({ key: 'Escape', preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(lootGroup.every((obj) => obj.visible === true)).toBe(true);
    expect(scene.input.off).toHaveBeenCalledWith('wheel', wheelHandler);
    expect(scene.input.keyboard.off).toHaveBeenCalledWith('keydown', keyHandler);
  });

  it('renders category-aware detail text for weapons, accessories, and promotion loot', () => {
    const textCalls = [];
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'weapon',
        item: {
          name: 'Iron Sword',
          type: 'Sword',
          might: 5,
          hit: 95,
          crit: 0,
          weight: 3,
          range: '1',
          price: 500,
        },
      },
      {
        type: 'accessory',
        item: {
          name: 'Nullify Ring',
          type: 'Accessory',
          effects: { STR: 2 },
          combatEffects: { negateEffectiveness: true },
          price: 2500,
        },
      },
      {
        type: 'promotion',
        item: {
          name: 'Master Seal',
          type: 'Consumable',
          effect: 'promote',
          uses: 1,
          price: 2500,
        },
      },
    ]);
    const scene = makeScene({
      lootWeaponQualityBonus: 0,
    });
    scene.add.text = (...args) => {
      textCalls.push(args);
      return makeDisplayObject();
    };

    BattleScene.prototype.showLootScreen.call(scene);

    const labels = textCalls.map((call) => call[2]).filter((text) => typeof text === 'string');
    expect(labels.some((text) => text.includes('5Mt 95Hit 0Crt'))).toBe(true);
    expect(labels.some((text) => text.includes('3Wt Rng1'))).toBe(true);
    expect(labels.some((text) => text.includes('+2 STR'))).toBe(true);
    expect(labels.some((text) => /Negate(\s+effectiveness|\.\.\.)/.test(text))).toBe(true);
    expect(labels.some((text) => /Promote a Lv 10\+/.test(text))).toBe(true);
  });

  it('uses pre-scaled loot gold amount for display and award (no second multiplier)', () => {
    const textCalls = [];
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'gold',
        goldAmount: 500,
      },
    ]);
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.finalizeLootPick = vi.fn();
    scene.add.text = (...args) => {
      textCalls.push(args);
      return makeDisplayObject();
    };

    BattleScene.prototype.showLootScreen.call(scene);

    const lootCard = scene._lootCards?.[0]?.bg;
    expect(lootCard).toBeTruthy();
    lootCard.handlers.pointerdown({ button: 0 });

    // goldAmount is already pre-multiplied by LootSystem - no second multiplier at display.
    expect(scene.runManager.addGold).toHaveBeenCalledWith(500);
    expect(textCalls.some((call) => call[2] === '500G')).toBe(true);
  });

  it('scales loot gold card display and claim by late-pressure multiplier', () => {
    const textCalls = [];
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'gold',
        goldAmount: 500,
      },
    ]);
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.finalizeLootPick = vi.fn();
    scene._victoryPressureState = { active: true, xpMultiplier: 0.5, goldMultiplier: 0.6 };
    scene.add.text = (...args) => {
      textCalls.push(args);
      return makeDisplayObject();
    };

    BattleScene.prototype.showLootScreen.call(scene);

    const lootCard = scene._lootCards?.[0]?.bg;
    expect(lootCard).toBeTruthy();
    lootCard.handlers.pointerdown({ button: 0 });

    expect(scene.runManager.addGold).toHaveBeenCalledWith(300);
    expect(textCalls.some((call) => call[2] === '300G')).toBe(true);
  });

  it('applies loot multiplier exactly once to skip-loot payout', () => {
    const rectangles = [];
    const textCalls = [];
    const skipBonusSpy = vi.spyOn(LootSystem, 'calculateSkipLootBonus');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateLootChoicesMock.mockReturnValue([]);
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.goldEarned = 480;
    scene.runManager.isActComplete = vi.fn(() => false);
    scene.cleanupLootScreen = vi.fn();
    scene.add.rectangle = (...args) => {
      const obj = makeDisplayObject({ args });
      rectangles.push(obj);
      return obj;
    };
    scene.add.text = (...args) => {
      textCalls.push(args);
      return makeDisplayObject();
    };

    BattleScene.prototype.showLootScreen.call(scene);

    expect(skipBonusSpy).toHaveBeenCalled();
    const skipBaseGold = Number(skipBonusSpy.mock.results[0]?.value ?? 0);
    const expectedSkipGold = Math.floor(skipBaseGold * GOLD_LOOT_REWARD_MULTIPLIER);
    expect(textCalls.some((call) => call[2] === `+${expectedSkipGold}G`)).toBe(true);

    const skipCard = rectangles.find(
      (obj) => obj.args?.[4] === 0x554433 && typeof obj.handlers.pointerdown === 'function',
    );
    expect(skipCard).toBeTruthy();
    skipCard.handlers.pointerdown({ button: 0 });

    expect(scene.runManager.addGold).toHaveBeenCalledWith(expectedSkipGold);
    expect(scene.cleanupLootScreen).toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    skipBonusSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('normalizes and truncates weapon special lines for loot card details', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    const detail = BattleScene.prototype.getLootCardDetailLines.call(
      scene,
      { type: 'weapon' },
      {
        type: 'Sword',
        might: 7,
        hit: 90,
        crit: 5,
        weight: 6,
        range: '1',
        special:
          '  Heals HP equal to MAG+5 and grants barrier to allies nearby\r\nSecond line with extra detail that should be wrapped\r\nThird line should be truncated  ',
      },
      100,
    );

    expect(detail.lines[0]).toBe('Sword');
    expect(detail.lines[1]).toContain('7Mt 90Hit 5Crt');
    expect(detail.lines[2]).toContain('6Wt Rng1');
    const specialLines = detail.lines.slice(3);
    expect(specialLines).toHaveLength(1);
    expect(specialLines.join('\n').includes('\r')).toBe(false);
    expect(specialLines[0].endsWith('...')).toBe(true);
  });

  it('wraps and truncates non-weapon loot detail lines to fit card width', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    const cardWidth = 100;
    const maxChars = Math.max(10, Math.floor((cardWidth - 12) / 5));
    scene.getAccessoryDetailText = vi.fn(
      () => 'AccessoryPassiveBonusTokenWithoutSpacesABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    );

    const cases = [
      {
        choice: { type: 'accessory' },
        item: { type: 'Accessory' },
        expectsTruncation: true,
      },
      {
        choice: { type: 'weaponArtScroll' },
        item: {
          type: 'Scroll',
          teachesWeaponArtId: 'flare-strike',
          allowedWeaponTypes: [
            'SwordLanceAxeBowTomeLightStaffSuperLongTokenWithoutSpaces1234567890',
          ],
        },
        expectsTruncation: true,
      },
      {
        choice: { type: 'skillScroll' },
        item: {
          type: 'Scroll',
          special: 'TeachesSuperLongUnbrokenSkillDescriptorABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        },
        expectsTruncation: true,
      },
      {
        choice: { type: 'statBooster' },
        item: {
          effect: 'statBoost',
          value: 2,
          stat: 'VeryLongStatTokenWithoutSpacesABCDEFGHIJKLMNOPQRSTUVWXYZ',
        },
        expectsTruncation: true,
      },
      {
        choice: { type: 'promotion' },
        item: { effect: 'promote' },
        expectsTruncation: false,
      },
    ];

    for (const entry of cases) {
      const detail = BattleScene.prototype.getLootCardDetailLines.call(
        scene,
        entry.choice,
        entry.item,
        cardWidth,
      );
      expect(detail.lines.length).toBeGreaterThan(0);
      const maxLines = entry.item?.type === 'Scroll' && !entry.item?.teachesWeaponArtId ? 3 : 2;
      expect(detail.lines.length).toBeLessThanOrEqual(maxLines);
      expect(
        detail.lines.every((line) => typeof line === 'string' && line.length <= maxChars),
      ).toBe(true);
      if (entry.expectsTruncation) {
        expect(detail.lines[detail.lines.length - 1].endsWith('...')).toBe(true);
      }
    }
  });

  it('equip menu uses compact name-only labels with fixed row height', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.grid = {
      cols: 10,
      gridToPixel: () => ({ x: 64, y: 64 }),
    };
    scene._showWeaponDetailTooltip = vi.fn();
    scene._hideWeaponDetailTooltip = vi.fn();
    scene.add.rectangle = (...args) => makeDisplayObject({ args });
    scene.add.text = (...args) => makeDisplayObject({ args });

    const rowCalls = [];
    scene._makeMenuTextButton = vi.fn(
      (x, y, label, _textStyle, _defaultColor, _onClick, options = {}) => {
        rowCalls.push({ x, y, label, options });
        return makeDisplayObject({ x, y, input: { enabled: true } });
      },
    );

    const unit = {
      col: 1,
      row: 1,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [
        {
          name: 'Iron Sword',
          type: 'Sword',
          rankRequired: 'Prof',
          might: 5,
          hit: 95,
          crit: 0,
          weight: 3,
          range: '1',
        },
        {
          name: 'Steel Sword',
          type: 'Sword',
          rankRequired: 'Prof',
          might: 8,
          hit: 80,
          crit: 0,
          weight: 7,
          range: '1',
          special: 'Long special text',
        },
        {
          name: 'Slim Sword',
          type: 'Sword',
          rankRequired: 'Prof',
          might: 4,
          hit: 100,
          crit: 5,
          weight: 2,
          range: '1',
        },
        {
          name: 'Killing Edge',
          type: 'Sword',
          rankRequired: 'Prof',
          might: 9,
          hit: 75,
          crit: 30,
          weight: 9,
          range: '1',
        },
      ],
    };
    unit.weapon = unit.inventory[0];

    BattleScene.prototype.showEquipMenu.call(scene, unit);

    expect(rowCalls).toHaveLength(4);
    // All rows use fixed height (20px) with pointerdown (clickOnPointerUp disabled)
    for (const row of rowCalls) {
      expect(row.options.hitHeight).toBe(20);
      expect(row.options.clickOnPointerUp).toBeFalsy();
      // Labels are name-only (no stat lines)
      expect(row.label.split('\n')).toHaveLength(1);
    }
    // Equipped marker present on first weapon
    expect(rowCalls[0].label).toContain('\u25b6');
    expect(rowCalls[1].label).toContain('Steel Sword');
    // Auto-show tooltip fires
    expect(scene._showWeaponDetailTooltip).toHaveBeenCalled();
  });
});

describe('Loot card hover tooltip lifecycle', () => {
  beforeEach(() => {
    generateLootChoicesMock.mockReset();
  });

  function makeTooltipScene() {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    const delayedCalls = [];
    scene.time.delayedCall = vi.fn((delay, cb) => {
      const timer = {
        delay,
        cb,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      delayedCalls.push(timer);
      return timer;
    });
    scene.finalizeLootPick = vi.fn();
    scene.cleanupLootScreen = vi.fn();
    scene.showLootStatus = vi.fn();
    return { scene, delayedCalls };
  }

  it('wires pointerover/pointerout on item cards', () => {
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'weapon',
        item: {
          name: 'Iron Sword',
          type: 'Sword',
          might: 5,
          hit: 90,
          crit: 0,
          weight: 3,
          range: '1',
          price: 500,
        },
      },
    ]);
    const { scene } = makeTooltipScene();
    BattleScene.prototype.showLootScreen.call(scene);

    const card = scene._lootCards?.[0]?.bg;
    expect(card).toBeTruthy();
    expect(typeof card.handlers.pointerover).toBe('function');
    expect(typeof card.handlers.pointerout).toBe('function');
  });

  it('wires pointerover/pointerout on forge cards', () => {
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'forge',
        item: { name: 'Silver Whetstone', type: 'Whetstone', forgeStat: 'choice', price: 0 },
      },
    ]);
    const { scene } = makeTooltipScene();
    scene.showForgeLootPicker = vi.fn();
    BattleScene.prototype.showLootScreen.call(scene);

    const card = scene._lootCards?.[0]?.bg;
    expect(typeof card.handlers.pointerover).toBe('function');
    expect(typeof card.handlers.pointerout).toBe('function');
  });

  it('pointerdown on item card calls _hideLootTooltip before action', () => {
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'accessory',
        item: { name: 'Power Ring', type: 'Accessory', effects: { STR: 2 }, price: 800 },
      },
    ]);
    const { scene } = makeTooltipScene();
    const hideOrder = [];
    scene._hideLootTooltip = vi.fn(() => hideOrder.push('hide'));
    scene.finalizeLootPick = vi.fn(() => hideOrder.push('finalize'));
    BattleScene.prototype.showLootScreen.call(scene);

    scene._lootCards[0].bg.handlers.pointerdown({ button: 0 });
    expect(hideOrder[0]).toBe('hide');
  });

  it('pointerout cancels pending tooltip timer', () => {
    generateLootChoicesMock.mockReturnValue([
      {
        type: 'weapon',
        item: {
          name: 'Iron Sword',
          type: 'Sword',
          might: 5,
          hit: 90,
          crit: 0,
          weight: 3,
          range: '1',
          price: 500,
        },
      },
    ]);
    const { scene, delayedCalls } = makeTooltipScene();
    BattleScene.prototype.showLootScreen.call(scene);

    const card = scene._lootCards[0].bg;
    card.handlers.pointerover();
    expect(delayedCalls).toHaveLength(1);
    expect(scene._lootTooltipTimer).toBe(delayedCalls[0]);

    card.handlers.pointerout();
    expect(delayedCalls[0].removed).toBe(true);
    expect(scene._lootTooltipTimer).toBeNull();
  });

  it('cleanupLootScreen clears tooltip even before the guard', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    const mockTooltip = { destroy: vi.fn() };
    scene._lootTooltip = mockTooltip;
    scene._lootCleanedUp = true; // simulate re-entry

    BattleScene.prototype.cleanupLootScreen.call(scene);

    expect(mockTooltip.destroy).toHaveBeenCalled();
    expect(scene._lootTooltip).toBeNull();
  });

  it('finalizeLootPick clears tooltip', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    const mockTooltip = { destroy: vi.fn() };
    scene._lootTooltip = mockTooltip;
    scene._lootResolving = false;
    scene.isElite = false;
    scene.scheduleLootCleanup = vi.fn();

    BattleScene.prototype.finalizeLootPick.call(scene, [], 0);

    expect(mockTooltip.destroy).toHaveBeenCalled();
  });

  it('_getLootTooltipText returns null for gold choices', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    const result = BattleScene.prototype._getLootTooltipText.call(scene, { type: 'gold' }, null);
    expect(result).toBeNull();
  });

  it('_getLootTooltipText returns weapon art details with shared summarizer', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.gameData.weaponArts = {
      arts: [
        {
          id: 'heavy-blade',
          name: 'Heavy Blade',
          weaponType: 'Sword',
          hpCost: 5,
          requiredRank: 'Prof',
          perTurnLimit: 1,
          perMapLimit: 3,
          description: 'A powerful overhead strike.',
          combatMods: { atkBonus: 8, hitBonus: -10 },
        },
      ],
    };
    const item = { teachesWeaponArtId: 'heavy-blade', type: 'Scroll', name: 'Heavy Blade Scroll' };
    const result = BattleScene.prototype._getLootTooltipText.call(
      scene,
      { type: 'weaponArtScroll' },
      item,
    );

    expect(result).toContain('Heavy Blade');
    expect(result).toContain('HP Cost: 5');
    expect(result).toContain('Sword');
    expect(result).toContain('1/turn');
    expect(result).toContain('A powerful overhead strike.');
    expect(result).toContain('Mt +8');
    expect(result).toContain('Hit -10');
  });

  it('_getLootTooltipText returns skill scroll details', () => {
    const scene = makeScene({ lootWeaponQualityBonus: 0 });
    scene.gameData.skills = [
      {
        id: 'vantage',
        name: 'Vantage',
        description: 'Strike first when below 50% HP.',
        trigger: 'on-combat-start',
      },
    ];
    const item = {
      type: 'Scroll',
      skillId: 'vantage',
      name: 'Vantage Scroll',
      special: 'Teaches Vantage',
    };
    const result = BattleScene.prototype._getLootTooltipText.call(
      scene,
      { type: 'skillScroll' },
      item,
    );

    expect(result).toContain('Vantage Scroll');
    expect(result).toContain('Strike first when below 50% HP.');
    expect(result).toContain('on-combat-start');
  });
});
