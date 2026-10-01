import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { PromotionController } from '../src/ui/PromotionController.js';
import { PromotionChoicePanel } from '../src/ui/PromotionChoicePanel.js';
import { LevelUpPopup } from '../src/ui/LevelUpPopup.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);
const plainUnit = (unit) => {
  const state = { ...unit };
  for (const field of ['graphic', 'label', 'hpBar', 'hpBg']) delete state[field];
  return JSON.parse(JSON.stringify(state));
};

function fixture(kind, failure = null) {
  _resetUidCounter();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const unit = createRecruitUnit(
    { name: 'Kai', level: kind === 'promote' ? 10 : 3 },
    cls('Fighter'),
    gameData.weapons,
  );
  const seal = {
    name: kind === 'promote' ? 'Master Seal' : 'Infantry Seal',
    effect: kind,
    uses: 1,
  };
  unit.level = kind === 'promote' ? 10 : 3;
  unit.consumables = [seal];
  unit.inventory = [];
  unit.weapon = null;
  unit.battleEntityId = 'u1';
  const scene = Object.assign(new BattleScene(), {
    gameData,
    _battleSession: 1,
    playerUnits: [unit],
    runManager: null,
    hideActionMenu: vi.fn(),
    showActionMenu: vi.fn(),
    finishUnitAction: vi.fn((actor) => {
      actor.hasActed = true;
      scene.battleState = 'PLAYER_IDLE';
    }),
    _captureSuspendCheckpoint: vi.fn(() => {
      scene.saved = {
        unit: plainUnit(unit),
        continuation: structuredClone(scene._pendingActionCompletion),
      };
      return true;
    }),
    sys: { isActive: () => true },
    _recoverUnitActionError: vi.fn(),
  });
  for (const method of [
    'removeUnitGraphic',
    'addUnitGraphic',
    'updateHPBar',
    'showBriefBanner',
    'showPromotionBanner',
  ]) {
    scene[method] = vi.fn(() => {
      // Every visual method sees the complete saved domain change, including a
      // new weapon. A failure in an early redraw cannot omit the later grant.
      expect(scene.saved?.unit.className).toBe(kind === 'promote' ? 'Warrior' : 'Mercenary');
      expect(scene.saved?.unit.consumables).toEqual([]);
      expect(scene.saved?.unit.inventory.map((w) => w.name)).toContain(
        kind === 'promote' ? 'Iron Bow' : 'Iron Sword',
      );
      if (method === failure) throw new Error(`injected ${method}`);
    });
  }
  const execute = () =>
    kind === 'promote'
      ? new PromotionController(scene).executePromotion(unit, seal)
      : scene.executeReclass(unit, seal, cls('Mercenary'));
  return { scene, unit, seal, execute };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const kind of ['reclass', 'promote'])
  describe(`${kind} presentation failures`, () => {
    it.each(
      kind === 'promote'
        ? ['removeUnitGraphic', 'addUnitGraphic', 'updateHPBar', 'showPromotionBanner', 'popup']
        : ['removeUnitGraphic', 'addUnitGraphic', 'updateHPBar', 'showBriefBanner'],
    )('%s preserves the normal complete result and saved continuation', async (failure) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(PromotionChoicePanel.prototype, 'show').mockResolvedValue(cls('Warrior'));
      vi.spyOn(LevelUpPopup.prototype, 'show').mockResolvedValue();
      const normal = fixture(kind);
      expect(await normal.execute()).toBe(true);
      const expectedState = plainUnit(normal.unit);
      // Creation rolls growths; start both scenarios from the same domain input.
      const broken = fixture(kind, failure);
      if (failure === 'popup')
        vi.spyOn(LevelUpPopup.prototype, 'show').mockRejectedValue(new Error('injected popup'));
      expect(await broken.execute()).toBe(true);
      expect(plainUnit(broken.unit)).toEqual(expectedState);
      expect(broken.scene.saved).toEqual(normal.scene.saved);
      expect(broken.scene.saved.unit.consumables).toEqual([]);
      expect(broken.scene.saved.unit.inventory.map((w) => w.name)).toContain(
        kind === 'promote' ? 'Iron Bow' : 'Iron Sword',
      );
      expect(broken.seal.uses).toBe(0);
      expect(broken.scene.finishUnitAction).toHaveBeenCalledTimes(1);
      expect(broken.scene._recoverUnitActionError).not.toHaveBeenCalled();
    });

    it('a settled old-session banner cannot finish the restarted battle', async () => {
      vi.spyOn(PromotionChoicePanel.prototype, 'show').mockResolvedValue(cls('Warrior'));
      vi.spyOn(LevelUpPopup.prototype, 'show').mockResolvedValue();
      const { scene, unit, seal, execute } = fixture(kind);
      let release;
      scene[kind === 'promote' ? 'showPromotionBanner' : 'showBriefBanner'] = vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = execute();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect(scene.saved.unit.consumables).toEqual([]);
      const saved = structuredClone(scene.saved);
      scene._sceneShutdownCleanedUp = true;
      scene.init({ gameData });
      scene.battleState = 'DEPLOY';
      scene.playerUnits = [{ name: 'New battle' }];
      release();
      expect(await pending).toBe(true);
      expect(scene.battleState).toBe('DEPLOY');
      expect(scene.saved).toEqual(saved);
      expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
      expect(scene.finishUnitAction).not.toHaveBeenCalled();
      expect(unit.consumables).toEqual([]);
      expect(seal.uses).toBe(0);
    });
  });

for (const kind of ['reclass', 'promote'])
  it(`${kind}: reload in the first redraw resumes only the committed action`, async () => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    });
    const { unit, seal } = fixture(kind);
    const run = new RunManager(gameData);
    run.startRun({ runSeed: 42 });
    run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
    run.roster.push(unit);
    const scene = journeyBattleScene(run, gameData);
    scene.playerUnits = [unit];
    scene.grid.fogEnabled = false;
    scene.addUnitGraphic(unit);
    scene.showBriefBanner = vi.fn(async () => {});
    scene.showPromotionBanner = vi.fn(async () => {});
    vi.spyOn(PromotionChoicePanel.prototype, 'show').mockResolvedValue(cls('Warrior'));
    vi.spyOn(LevelUpPopup.prototype, 'show').mockResolvedValue();
    let restored;
    scene.removeUnitGraphic = () => {
      const freshRun = loadRun(gameData, 1);
      const checkpoint = freshRun.battleInProgress.checkpoint;
      expect(checkpoint.playerUnits[0].className).toBe(
        kind === 'promote' ? 'Warrior' : 'Mercenary',
      );
      expect(checkpoint.playerUnits[0].consumables).toEqual([]);
      expect(checkpoint.playerUnits[0].inventory.map((w) => w.name)).toContain(
        kind === 'promote' ? 'Iron Bow' : 'Iron Sword',
      );
      expect(checkpoint.pendingActionCompletion).toMatchObject({
        kind: 'finish',
        unitId: unit.battleEntityId,
      });
      restored = journeyBattleScene(freshRun, gameData);
      restored.grid.fogEnabled = false;
      const suspend = new BattleSuspendController(restored);
      suspend.applyUnits(checkpoint);
      suspend.finalizeResume(checkpoint);
      expect(restored.playerUnits[0].className).toBe(checkpoint.playerUnits[0].className);
      expect(restored.playerUnits[0].consumables).toEqual([]);
      expect(restored.playerUnits[0].hasActed).toBe(true);
      expect(restored.turnManager.unitActedCalls).toBe(1);
    };
    expect(
      await (kind === 'promote'
        ? scene.executePromotion(unit, seal)
        : scene.executeReclass(unit, seal, cls('Mercenary'))),
    ).toBe(true);
    expect(restored).toBeDefined();
    expect(seal.uses).toBe(0);
    expect(scene.turnManager.unitActedCalls).toBe(1);
    expect(scene.playerUnits[0].inventory).toEqual(restored.playerUnits[0].inventory);
  });
