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

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setOrigin() { return this; },
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    destroy() {},
    setVisible() { return this; },
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

    lootCard.handlers.pointerdown();

    const unitBtn = [...rectangles].reverse().find((obj) => obj.args?.[2] === 200 && typeof obj.handlers.pointerdown === 'function');
    expect(unitBtn).toBeTruthy();

    unitBtn.handlers.pointerdown();

    expect(unit.stats.STR).toBe(10);
    expect(scene.finalizeLootPick).toHaveBeenCalledTimes(1);
  });
});
