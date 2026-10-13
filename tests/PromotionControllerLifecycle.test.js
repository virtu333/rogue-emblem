import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  promote: vi.fn(() => ({ droppedSkills: [] })),
}));
vi.mock('../src/engine/UnitManager.js', async () => ({
  ...(await vi.importActual('../src/engine/UnitManager.js')),
  resolvePromotionTargets: mocks.resolve,
  promoteUnit: mocks.promote,
}));
import { PromotionController } from '../src/ui/PromotionController.js';
import { LevelUpPopup } from '../src/ui/LevelUpPopup.js';
import { PromotionChoicePanel } from '../src/ui/PromotionChoicePanel.js';
function fixture() {
  const seal = { effect: 'promote', uses: 1 };
  const unit = {
    name: 'Test',
    className: 'Fighter',
    proficiencies: [],
    inventory: [],
    consumables: [seal],
  };
  const scene = {
    _battleSession: 1,
    gameData: { lords: [], classes: [], skills: [], weapons: [] },
    showActionMenu: vi.fn(),
    removeUnitGraphic: vi.fn(),
    addUnitGraphic: vi.fn(),
    updateHPBar: vi.fn(),
    finishUnitAction: vi.fn(),
    showBriefBanner: vi.fn(),
    sys: { isActive: () => !scene._sceneShutdownCleanedUp },
  };
  return { seal, unit, scene, controller: new PromotionController(scene) };
}
describe('promotion UI shutdown', () => {
  it('settled chooser on shutdown does not reopen battle menus or spend a seal', async () => {
    const { seal, unit, scene, controller } = fixture();
    mocks.resolve.mockReturnValue([{ name: 'Hero' }, { name: 'Berserker' }]);
    let release;
    const spy = vi.spyOn(PromotionChoicePanel.prototype, 'show').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = controller.executePromotion(unit, seal);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    scene._sceneShutdownCleanedUp = true;
    release(null);
    expect(await pending).toBe(false);
    expect(scene.showActionMenu).not.toHaveBeenCalled();
    expect(seal.uses).toBe(1);
    spy.mockRestore();
  });
  it('promotion commits its seal before a banner that can be interrupted', async () => {
    const { seal, unit, scene, controller } = fixture();
    mocks.resolve.mockReturnValue([{ name: 'Hero', promotionBonuses: { STR: 2 } }]);
    let release;
    scene.showPromotionBanner = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = controller.executePromotion(unit, seal);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(seal.uses).toBe(0);
    expect(unit.consumables).toEqual([]);
    scene._sceneShutdownCleanedUp = true;
    release();
    expect(await pending).toBe(true);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
  });
});

for (const shutdown of [false, true])
  it(`promotion audio stops when popup ${shutdown ? 'shuts down' : 'closes'}`, async () => {
    const { seal, unit, scene, controller } = fixture();
    mocks.resolve.mockReturnValue([{ name: 'Hero', promotionBonuses: { STR: 2, MOV: 1 } }]);
    scene.showPromotionBanner = vi.fn(async () => {});
    scene._playLevelUpSfx = vi.fn();
    scene._stopLevelUpSfx = vi.fn();
    let release;
    const spy = vi.spyOn(LevelUpPopup.prototype, 'show').mockImplementation(function () {
      expect(this.levelUpResult.gains.MOV).toBe(1);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    try {
      const pending = controller.executePromotion(unit, seal);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect(scene._playLevelUpSfx).toHaveBeenCalledTimes(1);
      if (shutdown) scene._sceneShutdownCleanedUp = true;
      release();
      expect(await pending).toBe(true);
      expect(scene._stopLevelUpSfx).toHaveBeenCalledTimes(shutdown ? 0 : 1);
      expect(scene.finishUnitAction).toHaveBeenCalledTimes(shutdown ? 0 : 1);
      expect(unit.consumables).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

it('a full bag and no convoy says which starter weapon a promotion could not grant', async () => {
  const { seal, unit, scene, controller } = fixture();
  const ironLance = { name: 'Iron Lance', type: 'Lance', tier: 'Iron' };
  scene.gameData.weapons = [ironLance];
  unit.proficiencies = [{ type: 'Sword', rank: 'Prof' }];
  unit.inventory = [1, 2, 3, 4, 5].map((n) => ({ name: `Sword ${n}`, type: 'Sword' }));
  mocks.resolve.mockReturnValue([{ name: 'Hero', promotionBonuses: { STR: 2 } }]);
  mocks.promote.mockImplementationOnce(() => {
    unit.proficiencies.push({ type: 'Lance', rank: 'Prof' });
    return { droppedSkills: [] };
  });
  scene.showPromotionBanner = vi.fn(async () => {});
  scene._playLevelUpSfx = vi.fn();
  scene._stopLevelUpSfx = vi.fn();
  const spy = vi.spyOn(LevelUpPopup.prototype, 'show').mockResolvedValue();
  try {
    expect(await controller.executePromotion(unit, seal)).toBe(true);
  } finally {
    spy.mockRestore();
  }
  expect(unit.inventory).toHaveLength(5);
  expect(scene.showBriefBanner).toHaveBeenCalledWith(
    'Bag and convoy full: Iron Lance could not be granted.',
    expect.anything(),
  );
});

it('a full bag sends the starter weapon to the run convoy, and the banner says so', async () => {
  const { seal, unit, scene, controller } = fixture();
  const ironLance = { name: 'Iron Lance', type: 'Lance', tier: 'Iron' };
  scene.gameData.weapons = [ironLance];
  const convoy = [];
  scene.runManager = {
    getConvoyCapacities: () => ({ weapons: 20, consumables: 20 }),
    getConvoyCounts: () => ({ weapons: convoy.length, consumables: 0 }),
    addToConvoy: (item) => convoy.push(structuredClone(item)) > 0,
  };
  unit.proficiencies = [{ type: 'Sword', rank: 'Prof' }];
  unit.inventory = [1, 2, 3, 4, 5].map((n) => ({ name: `Sword ${n}`, type: 'Sword' }));
  mocks.resolve.mockReturnValue([{ name: 'Hero', promotionBonuses: { STR: 2 } }]);
  mocks.promote.mockImplementationOnce(() => {
    unit.proficiencies.push({ type: 'Lance', rank: 'Prof' });
    return { droppedSkills: [] };
  });
  scene.showPromotionBanner = vi.fn(async () => {});
  scene._playLevelUpSfx = vi.fn();
  scene._stopLevelUpSfx = vi.fn();
  const spy = vi.spyOn(LevelUpPopup.prototype, 'show').mockResolvedValue();
  try {
    expect(await controller.executePromotion(unit, seal)).toBe(true);
  } finally {
    spy.mockRestore();
  }
  expect(unit.inventory).toHaveLength(5);
  expect(convoy.map((w) => w.name)).toEqual(['Iron Lance']);
  expect(scene.showBriefBanner).toHaveBeenCalledWith(
    'Bag full: Iron Lance sent to the convoy.',
    expect.anything(),
  );
});

it('Gaspar refuses a Master Seal through the scene flow without spending item or action', async () => {
  const { scene, seal, controller } = fixture();
  const { loadGameData } = await import('./testData.js');
  const { readFileSync } = await import('node:fs');
  const { createVeteranKnight } = await import('../src/engine/SpecialCharacters.js');
  scene.gameData = loadGameData();
  scene.gameData.dialogue = JSON.parse(
    readFileSync(new URL('../data/dialogue.json', import.meta.url)),
  );
  const unit = createVeteranKnight(scene.gameData);
  unit.consumables.push(seal);
  expect(await controller.executePromotion(unit, seal)).toBe(false);
  expect(scene.showBriefBanner).toHaveBeenCalledWith(
    expect.stringMatching(/^Gaspar: /),
    expect.anything(),
  );
  expect(scene.battleState).toBe('UNIT_ACTION_MENU');
  expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
  expect(scene.finishUnitAction).not.toHaveBeenCalled();
  expect(seal.uses).toBe(1);
  expect(unit.consumables).toContain(seal);
});
