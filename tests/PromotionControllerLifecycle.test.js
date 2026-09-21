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
      expect(scene._stopLevelUpSfx).toHaveBeenCalledTimes(1);
      expect(scene.finishUnitAction).toHaveBeenCalledTimes(shutdown ? 0 : 1);
      expect(unit.consumables).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
