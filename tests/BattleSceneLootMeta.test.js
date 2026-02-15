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

function makeDisplayObject() {
  return {
    setOrigin() { return this; },
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    on() { return this; },
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
});
