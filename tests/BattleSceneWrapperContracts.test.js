import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Phaser mock ──────────────────────────────────────────────
vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

// ── BossRecruitSystem mock ───────────────────────────────────
const { generateBossRecruitCandidatesMock } = vi.hoisted(() => ({
  generateBossRecruitCandidatesMock: vi.fn(),
}));
vi.mock('../src/engine/BossRecruitSystem.js', async () => {
  const actual = await vi.importActual('../src/engine/BossRecruitSystem.js');
  return { ...actual, generateBossRecruitCandidates: generateBossRecruitCandidatesMock };
});

// ── LootSystem mock ─────────────────────────────────────────
const { generateLootChoicesMock, calculateSkipLootBonusMock } = vi.hoisted(() => ({
  generateLootChoicesMock: vi.fn(),
  calculateSkipLootBonusMock: vi.fn(),
}));
vi.mock('../src/engine/LootSystem.js', async () => {
  const actual = await vi.importActual('../src/engine/LootSystem.js');
  return {
    ...actual,
    generateLootChoices: generateLootChoicesMock,
    calculateSkipLootBonus: calculateSkipLootBonusMock,
  };
});

const { transitionToSceneMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: transitionToSceneMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { BossRecruitOverlay } from '../src/ui/BossRecruitOverlay.js';
import { DeployScreenOverlay } from '../src/ui/DeployScreenOverlay.js';
import { ForecastOverlay } from '../src/ui/ForecastOverlay.js';
import { InputController } from '../src/ui/InputController.js';
import { LootFlowController } from '../src/ui/LootFlowController.js';
import { LootScreenController } from '../src/ui/LootScreenController.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { TransitionRecoveryController } from '../src/ui/TransitionRecoveryController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { WeaponArtController } from '../src/ui/WeaponArtController.js';

// ── Helpers ──────────────────────────────────────────────────

function makeDisplayObject(seed = {}) {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 14,
    depth: 0,
    originX: 0,
    originY: 0,
    list: null,
    visible: true,
    ...seed,
    handlers: {},
    setOrigin(x = 0, y = x) {
      this.originX = x;
      this.originY = y;
      return this;
    },
    setDepth(d) {
      this.depth = d;
      return this;
    },
    setInteractive() {
      this.interactive = true;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    setScrollFactor() {
      return this;
    },
    setVisible(v) {
      this.visible = v;
      return this;
    },
    setFillStyle() {
      return this;
    },
    setText(t) {
      this.text = t;
      return this;
    },
    removeAllListeners() {
      return this;
    },
    disableInteractive() {
      return this;
    },
    setColor() {
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    getBounds() {
      const left = this.x - this.width * this.originX;
      const top = this.y - this.height * this.originY;
      return { left, top, right: left + this.width, bottom: top + this.height };
    },
    destroy() {},
  };
}

function makeScene() {
  const scene = new BattleScene();
  scene.registry = { get: () => null };
  scene.cameras = {
    main: {
      centerX: 320,
      centerY: 240,
      width: 640,
      height: 480,
      setZoom: vi.fn(),
      setScroll: vi.fn(),
    },
  };
  scene.time = {
    delayedCall: vi.fn((ms, cb) => ({ remove: vi.fn(), cb, ms })),
  };
  scene.add = {
    rectangle: (x, y, w, h) => makeDisplayObject({ x, y, width: w, height: h }),
    text: (...args) => {
      const content = typeof args[2] === 'string' ? args[2] : '';
      return makeDisplayObject({
        x: args[0],
        y: args[1],
        text: content,
        width: Math.max(1, content.length) * 6,
      });
    },
    container: (x, y, children = []) => makeDisplayObject({ x, y, list: children }),
  };
  scene.hideLootRoster = vi.fn();
  scene.showLootScreen = vi.fn();
  scene._pinToScreen = vi.fn();
  scene._hideMenuTooltip = vi.fn();
  scene._clearMenuTooltipTimer = vi.fn();
  scene._hideLootTooltip = vi.fn();
  scene.runManager = {
    currentAct: 'act1',
    roster: [],
    getEffectiveMetaEffects: () => ({}),
    addGold: vi.fn(),
    awardGold: vi.fn((n) => n),
    gold: 500,
    metaEffects: {},
    canAddToConvoy: vi.fn(() => true),
    addToConvoy: vi.fn(() => true),
    getWeaponArtSpawnConfig: vi.fn(() => null),
    shouldTriggerThirdLord: vi.fn(() => false),
  };
  scene.gameData = { weapons: [], accessories: [], consumables: [], skills: [], classes: [] };
  scene.isElite = false;
  scene.isBoss = false;
  scene.goldEarned = 100;
  scene.turnPar = 10;
  scene.turnBonusConfig = {
    brackets: [
      { threshold: 0, rating: 'S', bonusMultiplier: 1.0 },
      { threshold: 3, rating: 'A', bonusMultiplier: 0.6 },
      { threshold: 6, rating: 'B', bonusMultiplier: 0.25 },
      { threshold: Infinity, rating: 'C', bonusMultiplier: 0.0 },
    ],
    baseBonusGold: { act1: 150 },
  };
  scene.turnManager = { turnNumber: 5 };
  scene._victoryPressureState = null;
  scene._completionGoldAward = 0;
  scene._battleCompletionAwardedGold = 0;
  return scene;
}

// ── Tests ────────────────────────────────────────────────────

describe('BattleScene shim delegation contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    generateBossRecruitCandidatesMock.mockReset();
    generateLootChoicesMock.mockReset();
    calculateSkipLootBonusMock.mockReset();
    transitionToSceneMock.mockReset();
    transitionToSceneMock.mockResolvedValue(true);
  });

  // ── Boss recruit contracts ────────────────────────────────

  describe('showBossRecruitScreen()', () => {
    it('creates BossRecruitOverlay and sets lootGroup to overlay displayObjects', () => {
      const fakeUnit = { name: 'TestRecruit', className: 'Myrmidon', stats: { HP: 20 } };
      generateBossRecruitCandidatesMock.mockReturnValue([
        { unit: fakeUnit, displayName: 'TestRecruit', isLord: false },
      ]);

      const scene = makeScene();
      // Replace showLootScreen so the callback doesn't try to build real loot UI
      scene.showLootScreen = vi.fn();

      BattleScene.prototype.showBossRecruitScreen.call(scene);

      // lootGroup should be the overlay's displayObjects array
      expect(scene.lootGroup).toBeInstanceOf(Array);
      expect(scene.lootGroup.length).toBeGreaterThan(0);
      // The overlay instance should be stored
      expect(scene._bossRecruitOverlay).toBeInstanceOf(BossRecruitOverlay);
    });

    it('boss recruit callback pushes selected unit to roster, nulls lootGroup, calls showLootScreen', () => {
      const fakeUnit = { name: 'Recruit', className: 'Fighter', stats: { HP: 25, STR: 8 } };
      generateBossRecruitCandidatesMock.mockReturnValue([
        { unit: fakeUnit, displayName: 'Recruit', isLord: false },
      ]);

      const scene = makeScene();
      scene.showLootScreen = vi.fn();

      BattleScene.prototype.showBossRecruitScreen.call(scene);

      const overlay = scene._bossRecruitOverlay;
      expect(overlay).toBeTruthy();

      // Find clickable cards — those with both interactive flag AND a pointerdown handler
      const clickableCards = overlay.displayObjects.filter(
        (obj) => obj.interactive && typeof obj.handlers?.pointerdown === 'function',
      );
      expect(clickableCards.length).toBeGreaterThan(0);

      // First clickable card is the candidate (last is the skip card)
      const candidateCard = clickableCards[0];
      candidateCard.handlers['pointerdown']({ button: 0 });

      expect(scene.runManager.roster).toContain(fakeUnit);
      expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
      // Overlay reference should be cleared after resolution
      expect(scene._bossRecruitOverlay).toBeNull();
    });

    it.each([
      { label: 'empty array', returnValue: [] },
      { label: 'null', returnValue: null },
    ])(
      'empty candidates ($label): no throw, showLootScreen called, lootGroup not dereferenced',
      ({ returnValue }) => {
        generateBossRecruitCandidatesMock.mockReturnValue(returnValue);
        const scene = makeScene();
        scene.showLootScreen = vi.fn();

        expect(() => {
          BattleScene.prototype.showBossRecruitScreen.call(scene);
        }).not.toThrow();

        expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
        expect(scene.runManager.roster).toHaveLength(0);
        expect(scene.lootGroup).toBeNull();
        expect(scene._bossRecruitOverlay).toBeNull();
      },
    );

    it('boss recruit skip (null) still nulls lootGroup and calls showLootScreen', () => {
      const fakeUnit = { name: 'Recruit', className: 'Archer', stats: { HP: 18, STR: 6 } };
      generateBossRecruitCandidatesMock.mockReturnValue([
        { unit: fakeUnit, displayName: 'Recruit', isLord: false },
      ]);

      const scene = makeScene();
      scene.showLootScreen = vi.fn();

      BattleScene.prototype.showBossRecruitScreen.call(scene);

      // Find the skip card — it's the last interactive card
      const overlay = scene._bossRecruitOverlay;
      const interactiveCards = overlay.displayObjects.filter((obj) => obj.interactive);
      const skipCard = interactiveCards[interactiveCards.length - 1];

      skipCard.handlers['pointerdown']({ button: 0 });

      // Should NOT add any unit to roster
      expect(scene.runManager.roster).toHaveLength(0);
      expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
      expect(scene._bossRecruitOverlay).toBeNull();
    });
  });

  // ── Loot screen contracts ─────────────────────────────────

  describe('showLootScreen()', () => {
    it('creates LootScreenController and sets lootGroup to controller lootGroup array', () => {
      generateLootChoicesMock.mockReturnValue([
        { type: 'gold', item: null, goldAmount: 100 },
        { type: 'gold', item: null, goldAmount: 200 },
        { type: 'gold', item: null, goldAmount: 150 },
      ]);
      calculateSkipLootBonusMock.mockReturnValue(50);

      const scene = makeScene();

      BattleScene.prototype.showLootScreen.call(scene);

      expect(scene._lootController).toBeInstanceOf(LootScreenController);
      expect(scene.lootGroup).toBeInstanceOf(Array);
      expect(scene.lootGroup).toBe(scene._lootController.lootGroup);
    });

    it('initializes _elitePicksRemaining, _lootCleanedUp, _lootResolving on scene', () => {
      generateLootChoicesMock.mockReturnValue([{ type: 'gold', item: null, goldAmount: 100 }]);
      calculateSkipLootBonusMock.mockReturnValue(50);

      const scene = makeScene();
      scene.isElite = false;

      BattleScene.prototype.showLootScreen.call(scene);

      expect(scene._elitePicksRemaining).toBe(1);
      expect(scene._lootCleanedUp).toBe(false);
      expect(scene._lootResolving).toBe(false);

      // Elite case
      const eliteScene = makeScene();
      eliteScene.isElite = true;

      BattleScene.prototype.showLootScreen.call(eliteScene);

      expect(eliteScene._elitePicksRemaining).toBeGreaterThan(1);
      expect(eliteScene._lootCleanedUp).toBe(false);
      expect(eliteScene._lootResolving).toBe(false);
    });
  });

  // ── Static delegation contracts ───────────────────────────

  describe('static delegation shims', () => {
    it('showLootUnitPicker delegates to LootScreenController.renderUnitPicker', () => {
      const spy = vi.spyOn(LootScreenController, 'renderUnitPicker').mockImplementation(() => {});
      const scene = makeScene();
      const item = { name: 'Iron Sword' };
      const group = [];
      BattleScene.prototype.showLootUnitPicker.call(scene, item, group, 0);
      expect(spy).toHaveBeenCalledWith(scene, item, group, 0);
      spy.mockRestore();
    });

    it('showConsumableUnitPicker delegates to LootScreenController.renderConsumableUnitPicker', () => {
      const spy = vi
        .spyOn(LootScreenController, 'renderConsumableUnitPicker')
        .mockImplementation(() => {});
      const scene = makeScene();
      const item = { name: 'Vulnerary', effect: 'heal', value: 10 };
      const group = [];
      BattleScene.prototype.showConsumableUnitPicker.call(scene, item, group, 2);
      expect(spy).toHaveBeenCalledWith(scene, item, group, 2);
      spy.mockRestore();
    });

    it('showStatBoostUnitPicker delegates to LootScreenController.renderStatBoostPicker', () => {
      const spy = vi
        .spyOn(LootScreenController, 'renderStatBoostPicker')
        .mockImplementation(() => {});
      const scene = makeScene();
      const item = { name: 'Energy Drop', effect: 'statBoost' };
      const group = [];
      BattleScene.prototype.showStatBoostUnitPicker.call(scene, item, group, 1);
      expect(spy).toHaveBeenCalledWith(scene, item, group, 1);
      spy.mockRestore();
    });

    it('getLootCardDetailLines delegates to LootScreenController.getCardDetailLines', () => {
      const spy = vi
        .spyOn(LootScreenController, 'getCardDetailLines')
        .mockReturnValue({ lines: ['test'], color: '#ffffff' });
      const scene = makeScene();
      const choice = { type: 'weapon' };
      const item = { name: 'Iron Sword', might: 5 };
      const result = BattleScene.prototype.getLootCardDetailLines.call(scene, choice, item, 120);
      expect(spy).toHaveBeenCalledWith(scene, choice, item, 120);
      expect(result).toEqual({ lines: ['test'], color: '#ffffff' });
      spy.mockRestore();
    });

    it('_getLootTooltipText delegates to LootScreenController.getTooltipText', () => {
      const spy = vi.spyOn(LootScreenController, 'getTooltipText').mockReturnValue('tooltip text');
      const scene = makeScene();
      const choice = { type: 'weapon' };
      const item = { name: 'Steel Lance' };
      const result = BattleScene.prototype._getLootTooltipText.call(scene, choice, item);
      expect(spy).toHaveBeenCalledWith(scene, choice, item);
      expect(result).toBe('tooltip text');
      spy.mockRestore();
    });
  });

  // ── Loot-flow shims ───────────────────────────────────────

  describe('Loot-flow shims', () => {
    it('showLootRoster lazy-inits LootFlowController once and reuses it', () => {
      const scene = makeScene();
      const spy = vi
        .spyOn(LootFlowController.prototype, 'showLootRoster')
        .mockImplementation(() => {});

      BattleScene.prototype.showLootRoster.call(scene);
      const firstController = scene._lootFlowController;
      BattleScene.prototype.showLootRoster.call(scene);

      expect(firstController).toBeInstanceOf(LootFlowController);
      expect(scene._lootFlowController).toBe(firstController);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it.each([
      ['finalizeLootPick', 'finalizeLootPick', [[], 0]],
      ['cleanupLootScreen', 'cleanupLootScreen', [[]]],
      ['scheduleLootCleanup', 'scheduleLootCleanup', [[]]],
      ['_startPostLootTransition', '_startPostLootTransition', []],
      ['_clearPostLootTransitionFallback', '_clearPostLootTransitionFallback', []],
      [
        'showForgeWeaponPicker',
        'showForgeWeaponPicker',
        [{ forgeStat: 'might' }, { inventory: [] }, [], 0],
      ],
      [
        'showForgeStatPickerLoot',
        'showForgeStatPickerLoot',
        [{ forgeStat: 'choice' }, { name: 'Iron Sword' }, [], 0],
      ],
      [
        '_showLootTooltip',
        '_showLootTooltip',
        [{ type: 'weapon' }, { name: 'Iron Sword' }, 100, 120, 80],
      ],
      ['_hideLootTooltip', '_hideLootTooltip', []],
      ['_clearLootTooltipTimer', '_clearLootTooltipTimer', []],
      ['showLootRoster', 'showLootRoster', []],
      ['hideLootRoster', 'hideLootRoster', []],
    ])('%s delegates to LootFlowController.%s', (sceneMethod, controllerMethod, args) => {
      const scene = makeScene();
      const spy = vi
        .spyOn(LootFlowController.prototype, controllerMethod)
        .mockImplementation(() => {});

      BattleScene.prototype[sceneMethod].call(scene, ...args);

      expect(scene._lootFlowController).toBeInstanceOf(LootFlowController);
      expect(spy).toHaveBeenCalledWith(...args);
      spy.mockRestore();
    });
  });

  // ── Forecast shim contracts ──────────────────────────────────

  describe('Input shims', () => {
    it('onPointerMove lazy-inits InputController once and reuses it', () => {
      const scene = makeScene();
      const spy = vi.spyOn(InputController.prototype, 'onPointerMove').mockImplementation(() => {});

      BattleScene.prototype.onPointerMove.call(scene, { x: 1, y: 2 });
      const firstController = scene._inputController;
      BattleScene.prototype.onPointerMove.call(scene, { x: 3, y: 4 });

      expect(firstController).toBeInstanceOf(InputController);
      expect(scene._inputController).toBe(firstController);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it.each([
      ['onPointerMove', 'onPointerMove', [{ x: 10, y: 20 }]],
      ['onPointerDown', 'onPointerDown', [{ x: 10, y: 20 }]],
      ['onPointerUp', 'onPointerUp', [{ x: 10, y: 20, button: 0, rightButtonDown: () => false }]],
      ['onRightClick', 'onRightClick', [{ x: 10, y: 20 }]],
      ['onClick', 'onClick', [{ x: 10, y: 20 }, null]],
      ['handleIdleClick', 'handleIdleClick', [{ col: 1, row: 2 }]],
      ['handleSelectedClick', 'handleSelectedClick', [{ col: 1, row: 2 }]],
      ['handleActionMenuClick', 'handleActionMenuClick', [{ col: 1, row: 2 }]],
      ['handleTargetClick', 'handleTargetClick', [{ col: 1, row: 2 }]],
      ['handleForecastClick', 'handleForecastClick', [{ col: 1, row: 2 }]],
      ['startTouchInspectHold', 'startTouchInspectHold', [{ x: 10, y: 20, id: 1 }]],
      ['updateTouchInspectHold', 'updateTouchInspectHold', [{ x: 10, y: 20, id: 1 }]],
      ['cancelTouchInspectHold', 'cancelTouchInspectHold', []],
      ['_screenToWorld', '_screenToWorld', [10, 20]],
      ['_worldToScreen', '_worldToScreen', [10, 20]],
      ['_pointerToWorld', '_pointerToWorld', [{ x: 10, y: 20 }]],
      ['_pointerToGrid', '_pointerToGrid', [{ x: 10, y: 20 }]],
      ['_handleCameraGesturePointerDown', '_handleCameraGesturePointerDown', [{ id: 1 }]],
      ['_handleCameraGesturePointerMove', '_handleCameraGesturePointerMove', [{ id: 1 }]],
      ['_handleCameraGesturePointerUp', '_handleCameraGesturePointerUp', [{ id: 1 }]],
      ['_showInspectionAtPixel', '_showInspectionAtPixel', [10, 20]],
      ['clearInspectionVisuals', 'clearInspectionVisuals', []],
      ['toggleInspectMode', 'toggleInspectMode', []],
      ['handleInspectModeTap', 'handleInspectModeTap', [{}, 10, 20]],
      ['_isPointerOverInteractive', '_isPointerOverInteractive', [{ x: 10, y: 20 }]],
      ['updateTopLeftHudLayout', 'updateTopLeftHudLayout', []],
      ['openUnitDetailOverlay', 'openUnitDetailOverlay', []],
    ])('%s delegates to InputController.%s', (sceneMethod, controllerMethod, args) => {
      const scene = makeScene();
      const spy = vi
        .spyOn(InputController.prototype, controllerMethod)
        .mockImplementation(() => {});

      BattleScene.prototype[sceneMethod].call(scene, ...args);

      expect(scene._inputController).toBeInstanceOf(InputController);
      expect(spy).toHaveBeenCalledWith(...args);
      spy.mockRestore();
    });

    it.each([
      ['_screenToWorld', '_screenToWorld', [10, 20]],
      ['_worldToScreen', '_worldToScreen', [10, 20]],
      ['_pointerToWorld', '_pointerToWorld', [{ x: 10, y: 20 }]],
      ['_pointerToGrid', '_pointerToGrid', [{ x: 10, y: 20 }]],
      ['_handleCameraGesturePointerDown', '_handleCameraGesturePointerDown', [{ id: 1 }]],
      ['_handleCameraGesturePointerMove', '_handleCameraGesturePointerMove', [{ id: 1 }]],
      ['_handleCameraGesturePointerUp', '_handleCameraGesturePointerUp', [{ id: 1 }]],
      ['_showInspectionAtPixel', '_showInspectionAtPixel', [10, 20]],
      ['handleInspectModeTap', 'handleInspectModeTap', [{}, 10, 20]],
      ['_isPointerOverInteractive', '_isPointerOverInteractive', [{ x: 10, y: 20 }]],
    ])('%s returns InputController.%s result', (sceneMethod, controllerMethod, args) => {
      const scene = makeScene();
      const expected = { tag: sceneMethod };
      const spy = vi
        .spyOn(InputController.prototype, controllerMethod)
        .mockImplementation(() => expected);

      const result = BattleScene.prototype[sceneMethod].call(scene, ...args);

      expect(scene._inputController).toBeInstanceOf(InputController);
      expect(spy).toHaveBeenCalledWith(...args);
      expect(result).toBe(expected);
      spy.mockRestore();
    });
  });

  // Weapon art shim contracts
  describe('Weapon art shims', () => {
    it('showWeaponArtPicker lazy-inits WeaponArtController once and reuses it', () => {
      const scene = makeScene();
      const spy = vi
        .spyOn(WeaponArtController.prototype, 'showWeaponArtPicker')
        .mockImplementation(() => {});

      BattleScene.prototype.showWeaponArtPicker.call(scene, { name: 'Edric' });
      const firstController = scene._weaponArtController;
      BattleScene.prototype.showWeaponArtPicker.call(scene, { name: 'Sera' });

      expect(firstController).toBeInstanceOf(WeaponArtController);
      expect(scene._weaponArtController).toBe(firstController);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it.each([
      ['showWeaponArtPicker', 'showWeaponArtPicker', [{ name: 'Edric' }]],
      ['_showWeaponArtTooltip', '_showWeaponArtTooltip', [{ getBounds: () => ({}) }, { id: 'a' }]],
      ['_wireWeaponArtTooltip', '_wireWeaponArtTooltip', [{ on: vi.fn() }, { id: 'a' }]],
      [
        '_setSelectedWeaponArt',
        '_setSelectedWeaponArt',
        [{ name: 'Edric', inventory: [] }, 'a', null],
      ],
      ['_clearSelectedWeaponArt', '_clearSelectedWeaponArt', []],
      [
        '_clearSelectedWeaponArtIfInvalid',
        '_clearSelectedWeaponArtIfInvalid',
        [{ name: 'Edric' }, {}],
      ],
    ])('%s delegates to WeaponArtController.%s', (sceneMethod, controllerMethod, args) => {
      const scene = makeScene();
      const spy = vi
        .spyOn(WeaponArtController.prototype, controllerMethod)
        .mockImplementation(() => {});

      BattleScene.prototype[sceneMethod].call(scene, ...args);

      expect(scene._weaponArtController).toBeInstanceOf(WeaponArtController);
      expect(spy).toHaveBeenCalledWith(...args);
      spy.mockRestore();
    });

    it.each([
      [
        '_resolveSelectedWeaponArtEntry',
        '_resolveSelectedWeaponArtEntry',
        [{ name: 'Edric' }],
        { art: { id: 'a' } },
      ],
      [
        '_getSelectedWeaponArtForUnit',
        '_getSelectedWeaponArtForUnit',
        [{ name: 'Edric' }, { isInitiating: true }],
        { id: 'art_a' },
      ],
      ['_getWeaponArtCatalog', '_getWeaponArtCatalog', [], [{ id: 'art_a' }]],
      [
        '_collectWeaponBoundArts',
        '_collectWeaponBoundArts',
        [{ id: 'iron_sword' }],
        [{ id: 'art_b' }],
      ],
      [
        '_getAvailableWeaponArtEntriesForUnit',
        '_getAvailableWeaponArtEntriesForUnit',
        [{ name: 'Edric' }],
        [{ weapon: {}, art: {} }],
      ],
      [
        '_getAvailableWeaponArtCatalogForUnit',
        '_getAvailableWeaponArtCatalogForUnit',
        [{ name: 'Edric' }],
        [{ id: 'art_c' }],
      ],
      [
        '_getWeaponArtChoices',
        '_getWeaponArtChoices',
        [{ name: 'Edric' }, { id: 'iron_sword' }, {}, {}],
        [{ canUse: true }],
      ],
      [
        '_hasUsableWeaponArtTargets',
        '_hasUsableWeaponArtTargets',
        [{ name: 'Edric' }, { id: 'iron_sword' }, {}],
        true,
      ],
      [
        '_resolveWeaponArtCostValues',
        '_resolveWeaponArtCostValues',
        [{ currentHP: 20 }, { hpCost: 2 }],
        { baseCost: 2, effectiveCost: 1 },
      ],
      [
        '_formatWeaponArtCostLabel',
        '_formatWeaponArtCostLabel',
        [{ currentHP: 20 }, { hpCost: 2 }],
        '1 (base 2)',
      ],
      [
        '_getWeaponArtHpAfterCost',
        '_getWeaponArtHpAfterCost',
        [{ currentHP: 20 }, { hpCost: 2 }],
        18,
      ],
      [
        '_getWeaponArtUsageCounts',
        '_getWeaponArtUsageCounts',
        [{ name: 'Edric' }, { id: 'art_d' }],
        { mapCount: 1, turnCount: 0 },
      ],
      [
        '_getWeaponArtStatusLine',
        '_getWeaponArtStatusLine',
        [{ currentHP: 20 }, { id: 'art_e' }, { canUse: true }],
        'status line',
      ],
      ['_weaponArtReasonLabel', '_weaponArtReasonLabel', ['insufficient_hp'], 'Not enough HP'],
      [
        '_scoreEnemyWeaponArt',
        '_scoreEnemyWeaponArt',
        [{ name: 'Enemy' }, { id: 'enemy_art' }],
        3.5,
      ],
      ['_getEnemyWeaponArtDifficultyId', '_getEnemyWeaponArtDifficultyId', [], 'lunatic'],
      [
        '_getEnemyWeaponArtTuning',
        '_getEnemyWeaponArtTuning',
        [],
        { minScore: 0.25, useChance: 1 },
      ],
      [
        '_selectEnemyWeaponArt',
        '_selectEnemyWeaponArt',
        [{ name: 'Enemy', weapon: {} }, { name: 'Target' }],
        { id: 'enemy_art' },
      ],
      ['_rollEnemyWeaponArtChance', '_rollEnemyWeaponArtChance', [], 0.25],
    ])(
      '%s returns WeaponArtController.%s result',
      (sceneMethod, controllerMethod, args, expected) => {
        const scene = makeScene();
        const spy = vi
          .spyOn(WeaponArtController.prototype, controllerMethod)
          .mockImplementation(() => expected);

        const result = BattleScene.prototype[sceneMethod].call(scene, ...args);

        expect(scene._weaponArtController).toBeInstanceOf(WeaponArtController);
        expect(spy).toHaveBeenCalledWith(...args);
        expect(result).toBe(expected);
        spy.mockRestore();
      },
    );
  });

  // Forecast shim contracts
  describe('showForecast / hideForecast shim', () => {
    function makeForecastScene() {
      const scene = makeScene();
      // Mock methods needed by showForecast orchestration
      scene._clearSelectedWeaponArtIfInvalid = vi.fn();
      scene._prepareCombatContext = vi.fn(() => ({
        dist: 1,
        atkTerrain: { name: 'Plain' },
        defTerrain: { name: 'Plain' },
        selectedArt: null,
        rollSession: {},
      }));
      scene._resolveSelectedWeaponArtEntry = vi.fn(() => null);
      scene.ensureValidWeaponForRange = vi.fn();
      scene._buildForecastSkillCtx = vi.fn(() => ({
        atkMods: {},
        defMods: {},
        rollStrikeSkills: vi.fn(() => ({})),
        rollDefenseSkills: vi.fn(() => ({})),
        checkAstra: vi.fn(() => false),
        skillsData: [],
      }));
      scene._getGamblerAtkDelta = vi.fn(() => 0);
      scene._isDistanceInWeaponRange = vi.fn(() => true);
      scene._getSelectedWeaponArtForUnit = vi.fn(() => null);
      scene._getPortraitKey = vi.fn(() => null);
      scene._getWeaponArtHpAfterCost = vi.fn(() => 15);
      scene._formatWeaponArtCostLabel = vi.fn(() => '5');
      scene.textures = { exists: vi.fn(() => false) };
      scene.isStoryInputLocked = vi.fn(() => false);
      scene.battleParams = {};
      const ironSword = {
        name: 'Iron Sword',
        type: 'Sword',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 5,
        rankRequired: 'Prof',
      };
      scene.selectedUnit = {
        name: 'Edric',
        className: 'Lord',
        currentHP: 20,
        stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 7, DEF: 5, RES: 3, LCK: 5 },
        weapon: ironSword,
        weapons: [ironSword],
        inventory: [ironSword],
        proficiencies: [{ type: 'Sword', rank: 'Prof' }],
        skills: [],
        faction: 'player',
        col: 2,
        row: 2,
      };
      // Add graphics mock for divider
      scene.add.graphics = () => {
        const g = makeDisplayObject();
        g.fillStyle = vi.fn();
        g.fillRect = vi.fn();
        g.lineStyle = vi.fn();
        g.lineBetween = vi.fn();
        return g;
      };
      scene.add.image = (x, y, key) => makeDisplayObject({ x, y, textureKey: key });
      return scene;
    }

    it('showForecast creates _forecastOverlay and calls render()', async () => {
      const scene = makeForecastScene();
      const attacker = scene.selectedUnit;
      const defender = {
        name: 'Fighter',
        className: 'Fighter',
        currentHP: 18,
        stats: { HP: 18, STR: 6, MAG: 0, SKL: 4, SPD: 5, DEF: 3, RES: 1, LCK: 3 },
        weapon: { name: 'Iron Axe', type: 'Axe', might: 8, hit: 75, crit: 0, weight: 8 },
        skills: [],
        faction: 'enemy',
        col: 3,
        row: 2,
      };

      await BattleScene.prototype.showForecast.call(scene, attacker, defender);

      expect(scene._forecastOverlay).toBeInstanceOf(ForecastOverlay);
      expect(scene.forecastObjects).toBe(scene._forecastOverlay.displayObjects);
      expect(scene.forecastObjects.length).toBeGreaterThan(0);
    });

    it('hideForecast calls overlay destroy() and nulls _forecastOverlay reference', () => {
      const scene = makeForecastScene();
      const mockOverlay = { destroy: vi.fn(), displayObjects: [makeDisplayObject()] };
      scene._forecastOverlay = mockOverlay;
      scene.forecastObjects = mockOverlay.displayObjects;
      scene.forecastTarget = { name: 'Enemy' };
      scene._forecastValidWeapons = [{}];
      scene._forecastWeaponArt = {};
      scene._forecastGamblerLine = 'test';

      BattleScene.prototype.hideForecast.call(scene);

      expect(mockOverlay.destroy).toHaveBeenCalledTimes(1);
      expect(scene._forecastOverlay).toBeNull();
    });

    it('hideForecast clears all forecast state fields', () => {
      const scene = makeForecastScene();
      scene._forecastOverlay = { destroy: vi.fn(), displayObjects: [] };
      scene.forecastObjects = [];
      scene.forecastTarget = { name: 'Enemy' };
      scene._forecastValidWeapons = [{}];
      scene._forecastWeaponArt = { name: 'Art' };
      scene._forecastGamblerLine = 'GAMBLER: ATK +2 (locked)';

      BattleScene.prototype.hideForecast.call(scene);

      expect(scene.forecastObjects).toBeNull();
      expect(scene.forecastTarget).toBeNull();
      expect(scene._forecastValidWeapons).toBeNull();
      expect(scene._forecastWeaponArt).toBeNull();
      expect(scene._forecastGamblerLine).toBeNull();
    });

    it('scene shutdown calls hideForecast(), clearing all forecast state', () => {
      const scene = makeForecastScene();
      const mockOverlay = { destroy: vi.fn(), displayObjects: [makeDisplayObject()] };
      scene._forecastOverlay = mockOverlay;
      scene.forecastObjects = mockOverlay.displayObjects;
      scene.forecastTarget = { name: 'Enemy' };
      scene._forecastValidWeapons = [{}];
      scene._forecastWeaponArt = {};
      scene._forecastGamblerLine = 'test';

      BattleScene.prototype._runSceneShutdownCleanup.call(scene);

      expect(mockOverlay.destroy).toHaveBeenCalledTimes(1);
      expect(scene._forecastOverlay).toBeNull();
      expect(scene.forecastTarget).toBeNull();
      expect(scene._forecastValidWeapons).toBeNull();
      expect(scene._forecastWeaponArt).toBeNull();
      expect(scene._forecastGamblerLine).toBeNull();
    });
  });

  // ── Deploy screen shim contracts ────────────────────────────

  describe('showDeployScreen shim', () => {
    it('sets battleState to DEPLOY_SELECTION and creates DeployScreenOverlay', () => {
      const scene = makeScene();
      const roster = [
        { name: 'Edric', level: 1, className: 'Lord', stats: { HP: 20 }, currentHP: 20 },
        { name: 'Sera', level: 1, className: 'Myrmidon', stats: { HP: 18 }, currentHP: 18 },
      ];

      BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 1, max: 2 }, vi.fn());

      expect(scene.battleState).toBe('DEPLOY_SELECTION');
      expect(scene._deployOverlay).toBeInstanceOf(DeployScreenOverlay);
    });

    it('confirm callback fires onConfirm with selected roster', () => {
      const scene = makeScene();
      const roster = [
        { name: 'Edric', level: 1, className: 'Lord', stats: { HP: 20 }, currentHP: 20 },
        { name: 'Sera', level: 1, className: 'Myrmidon', stats: { HP: 18 }, currentHP: 18 },
      ];
      const onConfirm = vi.fn();

      BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 1, max: 2 }, onConfirm);

      // Find the confirm button (120x32 rectangle)
      const overlay = scene._deployOverlay;
      expect(overlay).toBeTruthy();

      // Find confirm bg among display objects
      const confirmBg = overlay.displayObjects.find(
        (obj) => obj.width === 120 && obj.height === 32,
      );
      expect(confirmBg).toBeTruthy();

      // Click confirm — Edric is auto-selected so min=1 is satisfied
      confirmBg.handlers['pointerdown']({ button: 0 });

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const selectedNames = onConfirm.mock.calls[0][0].map((u) => u.name);
      expect(selectedNames).toContain('Edric');
    });

    it('scene shutdown cleans up deploy overlay and nulls reference', () => {
      const scene = makeScene();
      const roster = [
        { name: 'Edric', level: 1, className: 'Lord', stats: { HP: 20 }, currentHP: 20 },
        { name: 'Sera', level: 1, className: 'Myrmidon', stats: { HP: 18 }, currentHP: 18 },
      ];

      BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 1, max: 2 }, vi.fn());

      const overlay = scene._deployOverlay;
      expect(overlay).toBeTruthy();
      expect(overlay._closed).toBe(false);

      // Simulate scene shutdown cleanup
      BattleScene.prototype._runSceneShutdownCleanup.call(scene);

      expect(overlay._closed).toBe(true);
      expect(scene._deployOverlay).toBeNull();
    });
  });

  // ── Vision Rewind shims ─────────────────────────────────

  describe('Post-combat shims', () => {
    it('onVictory lazy-inits PostCombatController once and reuses it', () => {
      const scene = makeScene();
      const spy = vi
        .spyOn(PostCombatController.prototype, 'onVictory')
        .mockImplementation(() => {});

      BattleScene.prototype.onVictory.call(scene);
      const firstController = scene._postCombatController;
      BattleScene.prototype.onVictory.call(scene);

      expect(firstController).toBeInstanceOf(PostCombatController);
      expect(scene._postCombatController).toBe(firstController);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it.each([
      ['onDefeat', 'onDefeat', []],
      ['showBossRecruitScreen', 'showBossRecruitScreen', []],
      ['_showThirdLordArrival', '_showThirdLordArrival', []],
      ['showLootScreen', 'showLootScreen', []],
      ['showLootStatus', 'showLootStatus', ['status text', '#ffaa00']],
      ['reportLootError', 'reportLootError', ['ctx', new Error('boom'), { x: 1 }]],
    ])('%s delegates to PostCombatController.%s', (sceneMethod, controllerMethod, args) => {
      const scene = makeScene();
      const spy = vi
        .spyOn(PostCombatController.prototype, controllerMethod)
        .mockImplementation(() => {});

      BattleScene.prototype[sceneMethod].call(scene, ...args);

      expect(scene._postCombatController).toBeInstanceOf(PostCombatController);
      expect(spy).toHaveBeenCalledWith(...args);
      spy.mockRestore();
    });

    it('_awardTurnBonusGold delegates and returns PostCombatController result', () => {
      const scene = makeScene();
      const spy = vi
        .spyOn(PostCombatController.prototype, '_awardTurnBonusGold')
        .mockImplementation(() => 17);

      const result = BattleScene.prototype._awardTurnBonusGold.call(scene);

      expect(scene._postCombatController).toBeInstanceOf(PostCombatController);
      expect(spy).toHaveBeenCalledWith();
      expect(result).toBe(17);
      spy.mockRestore();
    });

    it.each([
      ['transitionAfterBattle', 'transitionAfterBattle', [], true],
      ['forceTransitionAfterBattle', 'forceTransitionAfterBattle', [], false],
      ['transitionToRunCompleteWithRetry', 'transitionToRunCompleteWithRetry', ['victory'], true],
    ])(
      '%s delegates and resolves PostCombatController.%s result',
      async (sceneMethod, controllerMethod, args, expectedValue) => {
        const scene = makeScene();
        const spy = vi
          .spyOn(PostCombatController.prototype, controllerMethod)
          .mockImplementation(async () => expectedValue);

        const result = BattleScene.prototype[sceneMethod].call(scene, ...args);

        expect(scene._postCombatController).toBeInstanceOf(PostCombatController);
        expect(spy).toHaveBeenCalledWith(...args);
        await expect(result).resolves.toBe(expectedValue);
        spy.mockRestore();
      },
    );
  });

  describe('Transition recovery shims', () => {
    it.each([
      ['showDefeatTransitionRecovery', 'showDefeatRecovery'],
      ['showVictoryTransitionRecovery', 'showVictoryRecovery'],
    ])(
      '%s lazy-inits TransitionRecoveryController and delegates',
      (sceneMethod, controllerMethod) => {
        const scene = makeScene();
        const spy = vi
          .spyOn(TransitionRecoveryController.prototype, controllerMethod)
          .mockImplementation(() => {});

        BattleScene.prototype[sceneMethod].call(scene);
        const firstController = scene._recoveryController;
        BattleScene.prototype[sceneMethod].call(scene);

        expect(firstController).toBeInstanceOf(TransitionRecoveryController);
        expect(scene._recoveryController).toBe(firstController);
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
      },
    );
  });

  describe('Vision Rewind shims', () => {
    function makeVisionScene() {
      const scene = makeScene();
      scene.turnManager = { currentPhase: 'player', turnNumber: 1 };
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.grid = {
        fogEnabled: false,
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
        clearPath: vi.fn(),
      };
      scene.hideActionMenu = vi.fn();
      scene.cleanupTradeUI = vi.fn();
      scene.reseedBattleRng = vi.fn();
      scene.updateObjectiveText = vi.fn();
      scene.refreshEndTurnControl = vi.fn();
      scene.updateTopLeftHudLayout = vi.fn();
      scene.getTurnPressureSummary = vi.fn(() => '');
      scene.getBestLordThroneDistance = vi.fn(() => 5);
      scene.tweens = { add: vi.fn() };
      scene.deriveBattleSeed = vi.fn(() => 42);
      scene.isStoryInputLocked = vi.fn(() => false);
      scene.removeUnitGraphic = vi.fn();
      scene.addUnitGraphic = vi.fn();
      scene.antiTurtleState = {};
      scene.ballistas = [];
      scene._zombieTombstones = [];
      scene.inspectionPanel = null;
      scene.unitDetailOverlay = null;
      scene.pauseOverlay = null;
      scene.objectiveText = null;
      scene.turnPar = null;
      scene.turnBonusConfig = null;
      scene.turnCounterText = null;
      scene.visionHudText = null;
      return scene;
    }

    it('captureVisionSnapshot delegates to controller', () => {
      const scene = makeVisionScene();
      scene.playerUnits = [{ name: 'A', stats: {}, currentHP: 10, skills: [], col: 0, row: 0 }];
      BattleScene.prototype.captureVisionSnapshot.call(scene);
      expect(scene.visionSnapshot).not.toBeNull();
      expect(scene._visionController).toBeInstanceOf(VisionRewindController);
    });

    it('commitVisionSnapshotIfPending delegates to controller', () => {
      const scene = makeVisionScene();
      scene.pendingVisionSnapshot = { id: 'pending' };
      scene.visionSnapshot = { id: 'old' };
      const result = BattleScene.prototype.commitVisionSnapshotIfPending.call(scene);
      expect(result).toBe(true);
      expect(scene.visionSnapshot).toEqual({ id: 'pending' });
    });

    it('requestVisionRewind delegates to controller and returns boolean', () => {
      const scene = makeVisionScene();
      scene.visionSnapshot = { id: 'snap' };
      scene.runManager = {
        ...scene.runManager,
        visionChargesRemaining: 2,
        visionCount: 0,
      };
      scene.battleState = 'PLAYER_IDLE';
      const result = BattleScene.prototype.requestVisionRewind.call(scene);
      expect(result).toBe(true);
      expect(scene.visionDialog).not.toBeNull();
    });

    it('cancelVisionDialog delegates to controller', () => {
      const scene = makeVisionScene();
      const obj = makeDisplayObject();
      const destroySpy = vi.spyOn(obj, 'destroy');
      scene.visionDialog = {
        group: [obj],
        prevState: 'PLAYER_IDLE',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      BattleScene.prototype.cancelVisionDialog.call(scene);
      expect(scene.visionDialog).toBeNull();
      expect(destroySpy).toHaveBeenCalled();
    });

    it('scene shutdown calls closeVisionDialog (dialog leak fix)', () => {
      const scene = makeVisionScene();
      const obj = makeDisplayObject();
      const destroySpy = vi.spyOn(obj, 'destroy');
      scene.visionDialog = {
        group: [obj],
        prevState: 'PLAYER_IDLE',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      BattleScene.prototype._runSceneShutdownCleanup.call(scene);
      expect(scene.visionDialog).toBeNull();
      expect(destroySpy).toHaveBeenCalled();
    });

    it('getVisionChargesRemaining returns number via controller', () => {
      const scene = makeVisionScene();
      scene.runManager = { ...scene.runManager, visionChargesRemaining: 5 };
      const result = BattleScene.prototype.getVisionChargesRemaining.call(scene);
      expect(result).toBe(5);
    });
  });

  describe('shutdown cleanup with active pauseOverlay', () => {
    it('does not invoke onResume or refreshEndTurnControl during shutdown', () => {
      const scene = makeScene();
      const onResume = vi.fn();
      scene.refreshEndTurnControl = vi.fn();
      scene.pauseOverlay = {
        visible: true,
        objects: [makeDisplayObject()],
        confirmObjects: [],
        hideForTransition: vi.fn(function () {
          for (const obj of this.objects) obj.destroy();
          this.objects = [];
          this.visible = false;
        }),
        hide: vi.fn(function () {
          this.hideForTransition();
          onResume();
        }),
      };

      BattleScene.prototype._runSceneShutdownCleanup.call(scene);

      expect(scene.pauseOverlay).toBeNull();
      expect(onResume).not.toHaveBeenCalled();
      expect(scene.refreshEndTurnControl).not.toHaveBeenCalled();
    });
  });

  describe('shutdown cleanup controller hygiene', () => {
    it('destroys WeaponArtController and nulls reference', () => {
      const scene = makeScene();
      const destroy = vi.fn();
      scene._weaponArtController = { destroy };

      BattleScene.prototype._runSceneShutdownCleanup.call(scene);

      expect(destroy).toHaveBeenCalledTimes(1);
      expect(scene._weaponArtController).toBeNull();
    });

    it('destroys InputController and nulls reference', () => {
      const scene = makeScene();
      const destroy = vi.fn();
      scene._inputController = { cancelTouchInspectHold: vi.fn(), destroy };

      BattleScene.prototype._runSceneShutdownCleanup.call(scene);

      expect(destroy).toHaveBeenCalledTimes(1);
      expect(scene._inputController).toBeNull();
    });
  });

  describe('showPauseMenu() transition watchdog', () => {
    it('Save & Return falls back to scene.start when transitionToScene hangs', async () => {
      vi.useFakeTimers();
      try {
        transitionToSceneMock.mockImplementation(() => new Promise(() => {}));
        const scene = makeScene();
        scene.scene = { start: vi.fn() };
        scene.playerUnits = [];
        scene.nonDeployedUnits = [];
        scene.showPauseTransitionRecovery = vi.fn();

        BattleScene.prototype.showPauseMenu.call(scene);
        expect(typeof scene.pauseOverlay?.onSaveAndExit).toBe('function');

        const exitPromise = scene.pauseOverlay.onSaveAndExit();
        await vi.advanceTimersByTimeAsync(6100);
        await exitPromise;

        expect(transitionToSceneMock).toHaveBeenCalledTimes(1);
        expect(scene.scene.start).toHaveBeenCalledWith('Title', { gameData: scene.gameData });
        expect(scene.showPauseTransitionRecovery).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
