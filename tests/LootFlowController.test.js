import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canForgeMock, canForgeStatMock, applyForgeMock, isForgedMock, getStatForgeCountMock } =
  vi.hoisted(() => ({
    canForgeMock: vi.fn(() => true),
    canForgeStatMock: vi.fn(() => true),
    applyForgeMock: vi.fn(() => ({ success: true })),
    isForgedMock: vi.fn(() => false),
    getStatForgeCountMock: vi.fn(() => 0),
  }));

vi.mock('../src/engine/ForgeSystem.js', async () => {
  const actual = await vi.importActual('../src/engine/ForgeSystem.js');
  return {
    ...actual,
    canForge: canForgeMock,
    canForgeStat: canForgeStatMock,
    applyForge: applyForgeMock,
    isForged: isForgedMock,
    getStatForgeCount: getStatForgeCountMock,
  };
});

const { getDisplayLevelMock } = vi.hoisted(() => ({
  getDisplayLevelMock: vi.fn(() => 7),
}));

vi.mock('../src/engine/UnitManager.js', async () => {
  const actual = await vi.importActual('../src/engine/UnitManager.js');
  return {
    ...actual,
    getDisplayLevel: getDisplayLevelMock,
  };
});

import { LootFlowController } from '../src/ui/LootFlowController.js';

function makeDisplayObject(seed = {}) {
  return {
    active: true,
    visible: true,
    handlers: {},
    ...seed,
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    setInteractive() {
      this.interactive = true;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setFillStyle() {
      return this;
    },
    setColor() {
      return this;
    },
    setText(text) {
      this.text = text;
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    setVisible(visible) {
      this.visible = visible;
      return this;
    },
    removeAllListeners() {
      return this;
    },
    disableInteractive() {
      this.interactive = false;
      return this;
    },
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    destroy: vi.fn(function destroy() {
      this.active = false;
    }),
  };
}

function makeScene() {
  const rectangles = [];
  const texts = [];
  const containers = [];
  const audio = { playSFX: vi.fn() };
  const scene = {
    cameras: {
      main: {
        centerX: 320,
        centerY: 240,
        width: 640,
        height: 480,
      },
    },
    add: {
      rectangle: vi.fn((x, y, width, height) => {
        const obj = makeDisplayObject({ kind: 'rect', x, y, width, height });
        rectangles.push(obj);
        return obj;
      }),
      text: vi.fn((x, y, text) => {
        const obj = makeDisplayObject({
          kind: 'text',
          x,
          y,
          text,
          width: Math.max(1, String(text ?? '').length) * 6,
          height: 14,
        });
        texts.push(obj);
        return obj;
      }),
      container: vi.fn((x, y, children = []) => {
        const obj = makeDisplayObject({ kind: 'container', x, y, list: children });
        containers.push(obj);
        return obj;
      }),
    },
    registry: {
      get: vi.fn((key) => (key === 'audio' ? audio : null)),
    },
    runManager: {
      roster: [],
    },
    _getLootTooltipText: vi.fn(() => 'detail text'),
    _pinToScreen: vi.fn(),
    showForgeLootPicker: vi.fn(),
    reportLootError: vi.fn(),
    showLootStatus: vi.fn(),
    transitionAfterBattle: vi.fn(async () => true),
    forceTransitionAfterBattle: vi.fn(),
    isStoryInputLocked: vi.fn(() => false),
    _lootTooltip: null,
    _lootTooltipTimer: null,
    _lootCleanupScheduled: false,
    _lootCleanedUp: false,
    _sceneShutdownCleanedUp: false,
    lootRosterVisible: false,
    lootRosterGroup: null,
    lootSettingsOverlay: null,
    lootGroup: null,
    __rectangles: rectangles,
    __texts: texts,
    __containers: containers,
    __audio: audio,
  };
  return scene;
}

describe('LootFlowController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canForgeMock.mockReturnValue(true);
    canForgeStatMock.mockReturnValue(true);
    applyForgeMock.mockReturnValue({ success: true });
    isForgedMock.mockReturnValue(false);
    getStatForgeCountMock.mockReturnValue(0);
    getDisplayLevelMock.mockReturnValue(7);
  });

  it('finalizeLootPick handles non-elite cleanup and elite decrement paths', () => {
    const scene = makeScene();
    const controller = new LootFlowController(scene);
    const scheduleSpy = vi.spyOn(controller, 'scheduleLootCleanup').mockImplementation(() => {});
    const instruction = makeDisplayObject();

    scene.isElite = false;
    scene._lootResolving = false;
    scene._elitePicksRemaining = 1;
    scene._lootCards = [{ bg: makeDisplayObject() }];
    scene._lootInstruction = instruction;
    controller.finalizeLootPick([makeDisplayObject()], 0);

    expect(scene._lootResolving).toBe(true);
    expect(scene._lootCards).toBeNull();
    expect(scene._lootInstruction).toBeNull();
    expect(scheduleSpy).toHaveBeenCalledTimes(1);

    const eliteCardBg = makeDisplayObject();
    const eliteInstruction = makeDisplayObject();
    const setTextSpy = vi.spyOn(eliteInstruction, 'setText');
    const eliteGroup = [
      makeDisplayObject({ visible: false }),
      makeDisplayObject({ visible: false }),
    ];
    scene.isElite = true;
    scene._lootResolving = false;
    scene._elitePicksRemaining = 2;
    scene._lootCards = [{ bg: eliteCardBg }];
    scene._lootInstruction = eliteInstruction;
    controller.finalizeLootPick(eliteGroup, 0);

    expect(scene._elitePicksRemaining).toBe(1);
    expect(eliteGroup.every((obj) => obj.visible === true)).toBe(true);
    expect(setTextSpy).toHaveBeenCalledWith('Choose 1 more reward');
  });

  it('cleanupLootScreen destroys loot objects once and starts post-loot transition', () => {
    const scene = makeScene();
    const controller = new LootFlowController(scene);
    const startSpy = vi.spyOn(controller, '_startPostLootTransition').mockImplementation(() => {});
    const hideRosterSpy = vi.spyOn(controller, 'hideLootRoster').mockImplementation(() => {});
    const settings = { hide: vi.fn() };
    const a = makeDisplayObject();
    const b = makeDisplayObject();
    scene.lootSettingsOverlay = settings;
    scene.lootGroup = [a, b];

    controller.cleanupLootScreen();
    controller.cleanupLootScreen();

    expect(settings.hide).toHaveBeenCalledTimes(1);
    expect(a.destroy).toHaveBeenCalledTimes(1);
    expect(b.destroy).toHaveBeenCalledTimes(1);
    expect(scene.lootGroup).toBeNull();
    expect(scene._lootCleanedUp).toBe(true);
    expect(hideRosterSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('scheduleLootCleanup dedupes Promise/setTimeout cleanup execution', async () => {
    vi.useFakeTimers();
    const scene = makeScene();
    const controller = new LootFlowController(scene);
    const cleanupSpy = vi.spyOn(controller, 'cleanupLootScreen').mockImplementation(() => {
      scene._lootCleanedUp = true;
    });

    controller.scheduleLootCleanup([]);
    controller.scheduleLootCleanup([]);
    await Promise.resolve();
    vi.runAllTimers();

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('_startPostLootTransition handles success and fallback timeout paths', async () => {
    vi.useFakeTimers();
    const scene = makeScene();
    const controller = new LootFlowController(scene);

    controller._startPostLootTransition();
    await Promise.resolve();
    await Promise.resolve();

    expect(scene.transitionAfterBattle).toHaveBeenCalledTimes(1);
    expect(scene._postLootTransitionCompleted).toBe(true);
    expect(scene._postLootTransitionTimer).toBeNull();

    const fallbackScene = makeScene();
    fallbackScene.transitionAfterBattle = vi.fn(async () => false);
    const fallbackController = new LootFlowController(fallbackScene);

    fallbackController._startPostLootTransition();
    vi.advanceTimersByTime(8000);

    expect(fallbackScene.forceTransitionAfterBattle).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('showForgeWeaponPicker branches to stat picker for choice and finalizes for specific forge', () => {
    const scene = makeScene();
    const controller = new LootFlowController(scene);
    const unit = {
      name: 'Edric',
      inventory: [{ name: 'Iron Sword', might: 5, hit: 80, crit: 0, weight: 5, _forgeLevel: 0 }],
    };
    const lootGroup = [makeDisplayObject()];
    const finalizeSpy = vi.spyOn(controller, 'finalizeLootPick').mockImplementation(() => {});
    const statPickerSpy = vi
      .spyOn(controller, 'showForgeStatPickerLoot')
      .mockImplementation(() => {});

    controller.showForgeWeaponPicker({ forgeStat: 'choice' }, unit, lootGroup, 0);
    const choiceBtn = scene.__rectangles.find(
      (obj) => typeof obj.handlers.pointerdown === 'function',
    );
    choiceBtn.handlers.pointerdown({ button: 0 });
    expect(statPickerSpy).toHaveBeenCalledTimes(1);

    scene.__rectangles.length = 0;
    scene.__texts.length = 0;
    controller.showForgeWeaponPicker({ forgeStat: 'might' }, unit, lootGroup, 1);
    const specificBtn = scene.__rectangles.find(
      (obj) => typeof obj.handlers.pointerdown === 'function',
    );
    specificBtn.handlers.pointerdown({ button: 0 });

    expect(applyForgeMock).toHaveBeenCalledWith(unit.inventory[0], 'might');
    expect(scene.__audio.playSFX).toHaveBeenCalledWith('sfx_gold');
    expect(finalizeSpy).toHaveBeenCalledWith(lootGroup, 1);
  });

  it('showForgeStatPickerLoot applies forge and supports back navigation', () => {
    const scene = makeScene();
    const controller = new LootFlowController(scene);
    const finalizeSpy = vi.spyOn(controller, 'finalizeLootPick').mockImplementation(() => {});
    const weapon = { name: 'Iron Sword' };
    const whetstone = { forgeStat: 'choice' };
    const lootGroup = [makeDisplayObject()];

    controller.showForgeStatPickerLoot(whetstone, weapon, lootGroup, 3);

    const statBtn = scene.__rectangles.find(
      (obj) => typeof obj.handlers.pointerdown === 'function',
    );
    statBtn.handlers.pointerdown({ button: 0 });
    expect(applyForgeMock).toHaveBeenCalledWith(weapon, 'might');
    expect(finalizeSpy).toHaveBeenCalledWith(lootGroup, 3);

    const backBtn = scene.__texts.find(
      (obj) => obj.text === '< Back' && typeof obj.handlers.pointerdown === 'function',
    );
    backBtn.handlers.pointerdown({ button: 0 });
    expect(scene.showForgeLootPicker).toHaveBeenCalledWith(whetstone, lootGroup, 3);
  });

  it('show/hide loot roster and tooltip lifecycle use scene-owned state', () => {
    const scene = makeScene();
    scene.runManager.roster = [
      {
        name: 'Sera',
        className: 'Myrmidon',
        stats: { HP: 20 },
        maxHP: 22,
        inventory: [{ name: 'Iron Sword' }],
      },
    ];
    const controller = new LootFlowController(scene);

    controller.showLootRoster();
    expect(scene.lootRosterVisible).toBe(true);
    expect(scene.lootRosterGroup.length).toBeGreaterThan(0);
    expect(scene._pinToScreen).toHaveBeenCalledWith(scene.lootRosterGroup);

    controller.hideLootRoster();
    expect(scene.lootRosterVisible).toBe(false);
    expect(scene.lootRosterGroup).toBeNull();

    controller._showLootTooltip({}, {}, 2, 10, 20);
    expect(scene._lootTooltip).toBeTruthy();
    const bg = scene._lootTooltip.list?.[0];
    expect(bg.x - bg.width / 2).toBeGreaterThanOrEqual(5);

    controller._hideLootTooltip();
    expect(scene._lootTooltip).toBeNull();
  });
});
