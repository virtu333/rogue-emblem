import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { ReclassController } from '../src/ui/ReclassController.js';
import { LevelUpPopup } from '../src/ui/LevelUpPopup.js';
import { PromotionController } from '../src/ui/PromotionController.js';
import { createUnit, reclassUnit } from '../src/engine/UnitManager.js';
import * as unitManager from '../src/engine/UnitManager.js';
import { healUnit } from '../src/engine/UnitHealth.js';
import { replaceUnitGraphic } from '../src/ui/replaceUnitGraphic.js';
import * as errorReporter from '../src/utils/errorReporter.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const cls = (name) => data.classes.find((item) => item.name === name);
function fixture() {
  const unit = createUnit(cls('Fighter'), 10, data.weapons, { name: 'Kai' });
  unit.faction = 'player';
  const seal = { ...data.consumables.find((item) => item.name === 'Infantry Seal') };
  unit.consumables = [seal];
  const scene = Object.assign(new BattleScene(), {
    _battleSession: 1,
    gameData: data,
    playerUnits: [unit],
    battleState: 'UNIT_ACTION_MENU',
    hideActionMenu: vi.fn(),
    showActionMenu: vi.fn(),
    showBriefBanner: vi.fn(async () => {}),
    finishUnitAction: vi.fn((actor) => {
      actor.hasActed = true;
      scene.battleState = 'PLAYER_IDLE';
    }),
    _recoverUnitActionError: vi.fn((actor) => {
      actor.hasActed = true;
      scene.battleState = 'PLAYER_IDLE';
    }),
    _captureSuspendCheckpoint: vi.fn(() => true),
    addUnitGraphic: vi.fn(),
    removeUnitGraphic: vi.fn(),
    updateHPBar: vi.fn(),
    sys: { isActive: () => true },
  });
  return { scene, unit, seal, controller: new ReclassController(scene) };
}
afterEach(() => vi.restoreAllMocks());

describe('reclass rejects malformed commands before changing state', () => {
  it.each([
    'null target',
    'current class',
    'wrong tier',
    'mounted target',
    'foreign class',
    'master seal',
    'missing uses',
    'spent seal',
    'removed seal',
    'null inventory',
    'null proficiency',
    'null stats',
  ])('%s', async (failure) => {
    const { scene, unit, seal, controller } = fixture();
    let target = cls('Mercenary');
    if (failure === 'null target') target = null;
    if (failure === 'current class') target = cls('Fighter');
    if (failure === 'wrong tier') target = cls('Warrior');
    if (failure === 'mounted target') target = cls('Cavalier');
    if (failure === 'foreign class') target = { ...target };
    if (failure === 'master seal') seal.effect = 'promote';
    if (failure === 'missing uses') delete seal.uses;
    if (failure === 'spent seal') seal.uses = 0;
    if (failure === 'removed seal') unit.consumables = [];
    if (failure === 'null inventory') unit.inventory = null;
    if (failure === 'null proficiency') unit.proficiencies = null;
    if (failure === 'null stats') unit.stats = null;
    const before = structuredClone(unit);
    expect(await controller.executeReclass(unit, seal, target)).toBe(false);
    expect(unit).toEqual(before);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    expect(scene.showBriefBanner).toHaveBeenCalled();
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
  });

  it.each(['inventory', 'proficiencies', 'stats'])(
    'engine rejects null %s with no mutation or RNG draw',
    (field) => {
      const { unit } = fixture();
      unit[field] = null;
      const before = structuredClone(unit);
      const random = vi.spyOn(Math, 'random');
      expect(
        reclassUnit(unit, cls('Mercenary'), cls('Fighter'), data.classes, data.skills),
      ).toBeNull();
      expect(unit).toEqual(before);
      expect(random).not.toHaveBeenCalled();
    },
  );

  it.each(['Fighter', 'Warrior', 'Lord'])(
    'engine rejects illegal target %s before mutation',
    (name) => {
      const { unit } = fixture();
      const before = structuredClone(unit);
      const random = vi.spyOn(Math, 'random');
      expect(reclassUnit(unit, cls(name), cls('Fighter'), data.classes, data.skills)).toBeNull();
      expect(unit).toEqual(before);
      expect(random).not.toHaveBeenCalled();
    },
  );

  it('a null engine result spends neither the seal nor the action', async () => {
    const { scene, unit, seal, controller } = fixture();
    vi.spyOn(unitManager, 'reclassUnit').mockReturnValue(null);
    const before = structuredClone(unit);
    expect(await controller.executeReclass(unit, seal, cls('Mercenary'))).toBe(false);
    expect(unit).toEqual(before);
    expect(seal.uses).toBe(1);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
  });

  it('a throw after the class assignment preserves that class, spends the seal and settles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scene, unit, seal, controller } = fixture();
    unit.inventory = new Proxy(unit.inventory, {
      get(target, key, receiver) {
        if (key === 'filter')
          return () => {
            throw new Error('injected weapon replacement');
          };
        return Reflect.get(target, key, receiver);
      },
    });
    expect(await controller.executeReclass(unit, seal, cls('Mercenary'))).toBe(true);
    expect(unit.className).toBe('Mercenary');
    expect(seal.uses).toBe(0);
    expect(unit.consumables).toEqual([]);
    expect(unit.hasActed).toBe(true);
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
    expect(scene._recoverUnitActionError).toHaveBeenCalledTimes(1);
    expect(scene.showActionMenu).not.toHaveBeenCalled();
  });

  it('a late engine throw spends the seal, captures partial state and settles once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scene, unit, seal, controller } = fixture();
    const previousStats = { ...unit.stats };
    const previousGrowths = unit.growths;
    Object.defineProperty(unit, 'growths', {
      configurable: true,
      get: () => previousGrowths,
      set: () => {
        throw new Error('injected after stats');
      },
    });
    expect(await controller.executeReclass(unit, seal, cls('Mercenary'))).toBe(true);
    expect(unit.stats).not.toEqual(previousStats);
    expect(seal.uses).toBe(0);
    expect(unit.consumables).toEqual([]);
    expect(unit.hasActed).toBe(true);
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
    expect(scene._recoverUnitActionError).toHaveBeenCalledTimes(1);
    expect(scene.showActionMenu).not.toHaveBeenCalled();
    expect(await controller.executeReclass(unit, seal, cls('Mercenary'))).toBe(false);
    expect(scene._recoverUnitActionError).toHaveBeenCalledTimes(1);
    expect(scene.showActionMenu).not.toHaveBeenCalled();
  });
});

describe('replacement graphics preserve the usable old unit', () => {
  function graphic() {
    const state = { destroy: vi.fn() };
    let result;
    result = new Proxy(state, {
      get(target, key) {
        if (!(key in target)) target[key] = vi.fn(() => result);
        return target[key];
      },
    });
    return result;
  }
  it.each([1, 2, 3, 4, 5])(
    'real graphic creation failure %s keeps an intact movable unit and its identity',
    (failureIndex) => {
      const { scene, unit } = fixture();
      const old = graphic();
      const oldBar = { bg: graphic(), fill: graphic() };
      unit.graphic = old;
      unit.hpBar = oldBar;
      const created = [];
      unit.affixes = ['deathburst'];
      let count = 0;
      const create = () => {
        if (++count === failureIndex) throw new Error('injected renderer');
        const object = graphic();
        created.push(object);
        return object;
      };
      scene.add = { image: create, rectangle: create, text: create, ellipse: create };
      scene.textures = {
        exists: () => true,
        get: () => ({ getSourceImage: () => ({ width: 32, height: 32 }) }),
      };
      scene.grid = { gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }) };
      scene.getSpriteKey = () => 'fighter';
      scene.addUnitGraphic = BattleScene.prototype.addUnitGraphic;
      scene.updateHPBar = BattleScene.prototype.updateHPBar;
      expect(() => replaceUnitGraphic(scene, unit)).toThrow('injected renderer');
      expect(unit.graphic).toBe(old);
      expect(unit.hpBar).toBe(oldBar);
      expect(old.destroy).not.toHaveBeenCalled();
      expect(created.every((item) => item.destroy.mock.calls.length === 1)).toBe(true);
      expect(scene._battleEntityOwners.get(unit.battleEntityId)).toBe(unit);
      expect(() => BattleScene.prototype.updateUnitPosition.call(scene, unit)).not.toThrow();
      healUnit(unit, 5);
      expect(() => scene.updateHPBar(unit)).not.toThrow();
    },
  );
  it('partial creation failure preserves sprite and bar and destroys partial objects', () => {
    const { scene, unit } = fixture();
    const old = graphic();
    const oldBar = { bg: graphic(), fill: graphic() };
    unit.graphic = old;
    unit.hpBar = oldBar;
    const partial = graphic();
    scene.add = { rectangle: () => partial };
    scene.addUnitGraphic = (actor) => {
      actor.graphic = scene.add.rectangle();
      throw new Error('injected graphic rebuild');
    };
    expect(() => replaceUnitGraphic(scene, unit)).toThrow('graphic rebuild');
    expect(unit.graphic).toBe(old);
    expect(unit.hpBar).toBe(oldBar);
    expect(old.destroy).not.toHaveBeenCalled();
    expect(partial.destroy).toHaveBeenCalledTimes(1);
    expect(scene.removeUnitGraphic).not.toHaveBeenCalled();
    scene.grid = { gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }) };
    scene.updateHPBar = BattleScene.prototype.updateHPBar;
    scene.updateAffixPips = vi.fn();
    scene._updateConditionIconPositions = vi.fn();
    scene._inputController = { refreshHoverInfo: vi.fn() };
    unit.col = 2;
    expect(() => BattleScene.prototype.updateUnitPosition.call(scene, unit)).not.toThrow();
    healUnit(unit, 5);
    expect(() => scene.updateHPBar(unit)).not.toThrow();
    expect(old.setPosition).toHaveBeenCalledWith(64, unit.row * 32);
    expect(scene._inputController.refreshHoverInfo).toHaveBeenCalled();
  });
  it('missing sprite or bar does not block movement, healing or hover refresh', () => {
    const { scene, unit } = fixture();
    unit.graphic = null;
    unit.hpBar = null;
    scene.grid = { gridToPixel: () => ({ x: 0, y: 0 }) };
    scene.updateHPBar = BattleScene.prototype.updateHPBar;
    scene.updateAffixPips = vi.fn();
    scene._updateConditionIconPositions = vi.fn();
    scene._inputController = { refreshHoverInfo: vi.fn() };
    expect(() => BattleScene.prototype.updateUnitPosition.call(scene, unit)).not.toThrow();
    healUnit(unit, 5);
    expect(() => scene.updateHPBar(unit)).not.toThrow();
    expect(scene._inputController.refreshHoverInfo).toHaveBeenCalledTimes(2);
  });
});

it('picker reports a rejected reclass operation', async () => {
  const { scene, unit, seal } = fixture();
  const report = vi.spyOn(errorReporter, 'reportAsyncError').mockImplementation(() => {});
  const error = new Error('rejected operation');
  scene.executeReclass = vi.fn().mockRejectedValue(error);
  const callbacks = [];
  scene.cameras = { main: { centerX: 320, centerY: 240, height: 480 } };
  scene.registry = { get: () => null };
  scene._clampMenuPosition = (x, y) => ({ x, y });
  const background = {
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
  };
  scene.add = { rectangle: () => background };
  scene._makeMenuTextButton = (_x, _y, _text, _style, _color, callback) => {
    callbacks.push(callback);
    return {};
  };
  scene._pinToScreen = vi.fn();
  scene._registerActionMenu = vi.fn();
  scene.showReclassClassPicker(unit, seal);
  callbacks[0]();
  await vi.waitFor(() =>
    expect(report).toHaveBeenCalledWith('reclass_failed', error, { unit: unit.name }),
  );
});

function promotionFixture() {
  const fixtureData = fixture();
  const { scene, unit } = fixtureData;
  const seal = { effect: 'promote', uses: 1 };
  unit.consumables = [seal];
  scene.showPromotionBanner = vi.fn(async () => {});
  scene._playLevelUpSfx = vi.fn();
  scene._stopLevelUpSfx = vi.fn();
  vi.spyOn(unitManager, 'resolvePromotionTargets').mockReturnValue([cls('Warrior')]);
  vi.spyOn(LevelUpPopup.prototype, 'show').mockResolvedValue();
  return { ...fixtureData, seal, controller: new PromotionController(scene) };
}

it('promotion rejects missing uses at validation, with a fixture that otherwise promotes', async () => {
  const valid = promotionFixture();
  expect(await valid.controller.executePromotion(valid.unit, valid.seal)).toBe(true);
  expect(valid.unit.className).toBe('Warrior');
  expect(valid.seal.uses).toBe(0);
  expect(valid.scene.finishUnitAction).toHaveBeenCalledOnce();

  const { scene, unit, seal, controller } = promotionFixture();
  delete seal.uses;
  const before = structuredClone(unit);
  const resolve = vi.spyOn(unitManager, 'resolvePromotionTargets');
  resolve.mockClear();
  expect(await controller.executePromotion(unit, seal)).toBe(false);
  expect(unit).toEqual(before);
  expect(scene.showBriefBanner).toHaveBeenCalledWith(
    'Master Seal required to promote.',
    expect.anything(),
  );
  expect(resolve).not.toHaveBeenCalled();
  expect(scene.finishUnitAction).not.toHaveBeenCalled();
  expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
});

it.each(['promotion', 'reclass'])(
  '%s controller preserves the old sprite when replacement construction fails',
  async (kind) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { scene, unit, seal, controller } = kind === 'promotion' ? promotionFixture() : fixture();
    const old = { destroy: vi.fn() };
    unit.graphic = old;
    scene.addUnitGraphic = () => {
      throw new Error('replacement unavailable');
    };
    scene.removeUnitGraphic = (removed) => removed.graphic?.destroy();
    const result =
      kind === 'promotion'
        ? await controller.executePromotion(unit, seal)
        : await controller.executeReclass(unit, seal, cls('Mercenary'));
    expect(result).toBe(true);
    expect(unit.className).toBe(kind === 'promotion' ? 'Warrior' : 'Mercenary');
    expect(unit.graphic).toBe(old);
    expect(old.destroy).not.toHaveBeenCalled();
    expect(seal.uses).toBe(0);
    expect(unit.hasActed).toBe(true);
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledOnce();
    expect(scene.finishUnitAction).toHaveBeenCalledOnce();
  },
);

it.each(['promotion', 'reclass'])(
  '%s history failure still saves its class, spends the seal and settles once',
  async (kind) => {
    const { scene, unit, seal, controller } = kind === 'promotion' ? promotionFixture() : fixture();
    const report = vi.spyOn(errorReporter, 'reportAsyncError').mockImplementation(() => {});
    scene.runManager = { battleInProgress: {} };
    scene._historyBeats = {
      length: 0,
      push: () => {
        throw new Error('history unavailable');
      },
    };
    const result =
      kind === 'promotion'
        ? await controller.executePromotion(unit, seal)
        : await controller.executeReclass(unit, seal, cls('Mercenary'));
    expect(result).toBe(true);
    expect(unit.className).toBe(kind === 'promotion' ? 'Warrior' : 'Mercenary');
    expect(seal.uses).toBe(0);
    expect(unit.consumables).toEqual([]);
    expect(unit.hasActed).toBe(true);
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledOnce();
    expect(scene.finishUnitAction).toHaveBeenCalledOnce();
    expect(scene._recoverUnitActionError).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      `${kind === 'promotion' ? 'promoted' : 'reclassed'}_history_failed`,
      expect.any(Error),
      { unit: unit.name },
    );
  },
);

it('a CombatFx release error still retires the old graphics and keeps the replacement', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { scene, unit } = fixture();
  const old = { destroy: vi.fn() };
  const replacement = { destroy: vi.fn() };
  unit.graphic = old;
  scene.addUnitGraphic = (actor) => {
    actor.graphic = replacement;
  };
  scene._combatFx = {
    releaseUnit: vi.fn((actor) => {
      expect(actor).toBe(unit);
      expect(actor.graphic).toBe(old);
      throw new Error('release failed');
    }),
  };
  scene.removeUnitGraphic = BattleScene.prototype.removeUnitGraphic;
  scene._removeAllConditionIcons = vi.fn();
  expect(() => replaceUnitGraphic(scene, unit)).not.toThrow();
  expect(unit.graphic).toBe(replacement);
  expect(old.destroy).toHaveBeenCalledOnce();
  expect(replacement.destroy).not.toHaveBeenCalled();
  expect(scene._combatFx.releaseUnit).toHaveBeenCalledOnce();
});

it('Promote menu observes a rejected promotion operation', async () => {
  const { scene, unit, seal } = promotionFixture();
  const report = vi.spyOn(errorReporter, 'reportAsyncError').mockImplementation(() => {});
  const rejection = new Error('promotion rejected');
  unit.level = 10;
  scene.executePromotion = vi.fn().mockRejectedValue(rejection);
  scene.getPromotionConsumable = () => seal;
  scene.gameData = data;
  scene.npcUnits = [];
  scene.enemyUnits = [];
  scene.battleConfig = { objective: 'rout' };
  scene.grid = { fogEnabled: false };
  scene.registry = { get: () => null };
  scene._drawActionMenuRows = vi.fn();
  scene._registerActionMenu = vi.fn();
  for (const method of [
    'findAttackTargets',
    'getUsableStaves',
    'getUsableReclassConsumables',
    'findTradeTargets',
    'findSwapTargets',
    'findBreakTargets',
  ])
    scene[method] = () => [];
  scene._hasUsableWeaponArtTargets = () => false;
  scene._hasAbilities = () => false;
  scene.showActionMenu = BattleScene.prototype.showActionMenu;
  scene.showActionMenu(unit);
  const rows = scene._registerActionMenu.mock.calls[0][0];
  const promote = rows.find((row) => row.id === 'promote');
  expect(promote).toBeTruthy();
  promote.invoke();
  await vi.waitFor(() =>
    expect(report).toHaveBeenCalledWith('promotion_failed', rejection, { unit: unit.name }),
  );
});

it('the inventory Master Seal row observes a rejected promotion operation', async () => {
  const { scene, unit, seal } = promotionFixture();
  const report = vi.spyOn(errorReporter, 'reportAsyncError').mockImplementation(() => {});
  const rejection = new Error('inventory promotion rejected');
  scene.executePromotion = vi.fn().mockRejectedValue(rejection);
  scene.grid = { fogEnabled: false };
  scene.registry = { get: () => null };
  scene._drawItemMenuRows = vi.fn();
  scene._registerActionMenu = vi.fn();
  scene.showItemMenu(unit);
  const rows = scene._registerActionMenu.mock.calls[0][0];
  const row = rows.find((entry) => entry.item === seal);
  expect(row).toBeTruthy();
  expect(row.disabled).toBe(false);
  const before = structuredClone(unit);
  row.invoke();
  await vi.waitFor(() =>
    expect(report).toHaveBeenCalledWith('promotion_failed', rejection, { unit: unit.name }),
  );
  expect(scene.executePromotion).toHaveBeenCalledWith(unit, seal);
  expect(unit).toEqual(before);
  expect(scene.finishUnitAction).not.toHaveBeenCalled();
});
