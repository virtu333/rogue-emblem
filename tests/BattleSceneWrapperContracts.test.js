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

import { BattleScene } from '../src/scenes/BattleScene.js';
import { BossRecruitOverlay } from '../src/ui/BossRecruitOverlay.js';
import { LootScreenController } from '../src/ui/LootScreenController.js';

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
  scene.cameras = { main: { centerX: 320, centerY: 240, width: 640, height: 480 } };
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

  // ── Self-contained flow methods ───────────────────────────

  describe('finalizeLootPick() (self-contained, no controller dependency)', () => {
    it('can be called standalone and schedules loot cleanup for non-elite', () => {
      const scene = makeScene();
      scene._lootResolving = false;
      scene._elitePicksRemaining = 1;
      scene._lootCards = [{ bg: makeDisplayObject() }];
      scene._lootInstruction = makeDisplayObject();
      scene._lootCleanedUp = false;

      // scheduleLootCleanup is called by finalizeLootPick
      scene.scheduleLootCleanup = vi.fn();

      const lootGroup = [makeDisplayObject()];
      BattleScene.prototype.finalizeLootPick.call(scene, lootGroup, 0);

      expect(scene._lootResolving).toBe(true);
      expect(scene._lootCards).toBeNull();
      expect(scene._lootInstruction).toBeNull();
      expect(scene.scheduleLootCleanup).toHaveBeenCalledWith(lootGroup);
    });

    it('decrements elite picks and keeps cards visible for remaining picks', () => {
      const scene = makeScene();
      scene.isElite = true;
      scene._lootResolving = false;
      scene._elitePicksRemaining = 2;
      scene._lootCleanedUp = false;
      scene._hideLootTooltip = vi.fn();

      const cardBg = makeDisplayObject();
      cardBg.setInteractive();
      scene._lootCards = [
        { bg: cardBg, elements: [makeDisplayObject()] },
        { bg: makeDisplayObject(), elements: [makeDisplayObject()] },
      ];
      scene._lootInstruction = makeDisplayObject();

      // All card elements need setVisible
      const lootGroup = [
        makeDisplayObject({ visible: false }),
        makeDisplayObject({ visible: false }),
      ];

      BattleScene.prototype.finalizeLootPick.call(scene, lootGroup, 0);

      // Should decrement picks, NOT set _lootResolving
      expect(scene._elitePicksRemaining).toBe(1);
      expect(scene._lootResolving).toBeFalsy();
      // Re-shows hidden loot group elements
      for (const obj of lootGroup) {
        expect(obj.visible).toBe(true);
      }
    });

    it('returns early if _lootResolving is already true', () => {
      const scene = makeScene();
      scene._lootResolving = true;
      scene._hideLootTooltip = vi.fn();
      scene.scheduleLootCleanup = vi.fn();

      BattleScene.prototype.finalizeLootPick.call(scene, [], 0);

      expect(scene.scheduleLootCleanup).not.toHaveBeenCalled();
    });
  });

  describe('cleanupLootScreen() (self-contained, nulls lootGroup)', () => {
    it('destroys loot group objects, nulls lootGroup, calls _startPostLootTransition', () => {
      const scene = makeScene();
      scene._lootCleanedUp = false;
      scene._lootResolving = false;
      scene.lootSettingsOverlay = null;
      scene._startPostLootTransition = vi.fn();
      scene.reportLootError = vi.fn();

      const obj1 = makeDisplayObject();
      const obj2 = makeDisplayObject();
      const destroySpy1 = vi.spyOn(obj1, 'destroy');
      const destroySpy2 = vi.spyOn(obj2, 'destroy');
      const lootGroup = [obj1, obj2];
      scene.lootGroup = lootGroup;

      BattleScene.prototype.cleanupLootScreen.call(scene, lootGroup);

      expect(destroySpy1).toHaveBeenCalled();
      expect(destroySpy2).toHaveBeenCalled();
      expect(scene.lootGroup).toBeNull();
      expect(scene._lootCleanedUp).toBe(true);
      expect(scene._startPostLootTransition).toHaveBeenCalledTimes(1);
    });

    it('returns early if _lootCleanedUp is already true', () => {
      const scene = makeScene();
      scene._lootCleanedUp = true;
      scene._startPostLootTransition = vi.fn();

      BattleScene.prototype.cleanupLootScreen.call(scene, []);

      expect(scene._startPostLootTransition).not.toHaveBeenCalled();
    });

    it('falls back to scene.lootGroup when no argument provided', () => {
      const scene = makeScene();
      scene._lootCleanedUp = false;
      scene.lootSettingsOverlay = null;
      scene._startPostLootTransition = vi.fn();
      scene.reportLootError = vi.fn();

      const obj = makeDisplayObject();
      const destroySpy = vi.spyOn(obj, 'destroy');
      scene.lootGroup = [obj];

      BattleScene.prototype.cleanupLootScreen.call(scene);

      expect(destroySpy).toHaveBeenCalled();
      expect(scene.lootGroup).toBeNull();
    });
  });
});
