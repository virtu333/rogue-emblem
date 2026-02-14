import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadGameData } from './testData.js';
import { buildTutorialBattleConfig, buildTutorialRoster } from '../src/engine/TutorialHelpers.js';
import { TERRAIN } from '../src/utils/constants.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
}));

vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: vi.fn(async () => true),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { showImportantHint } from '../src/ui/HintDisplay.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';

const gameData = loadGameData();

function makeGuideMarker() {
  return {
    setStrokeStyle() { return this; },
    setDepth() { return this; },
    destroy: vi.fn(),
  };
}

function createTutorialGateScene({ isMobileInput = false } = {}) {
  const scene = new BattleScene();
  const edric = {
    name: 'Edric',
    faction: 'player',
    hasActed: false,
    col: 1,
    row: 2,
    mov: 5,
    moveType: 'Infantry',
    graphic: { setTint: vi.fn(), clearTint: vi.fn() },
  };
  const sera = {
    name: 'Sera',
    faction: 'player',
    hasActed: false,
    col: 1,
    row: 4,
    mov: 5,
    moveType: 'Infantry',
    graphic: { setTint: vi.fn(), clearTint: vi.fn() },
  };
  scene.battleParams = { tutorialMode: true };
  scene.tutorialStep = 2;
  scene._tutorialStrictGateReleased = false;
  scene._tutorialBlockingPromptActive = false;
  scene._tutorialEdricGuide = null;
  scene._tutorialFortGuide = null;
  scene.isMobileInput = isMobileInput;
  scene.battleState = 'PLAYER_IDLE';
  scene.scene = { isActive: () => true };
  scene.turnManager = { currentPhase: 'player', endPlayerPhase: vi.fn() };
  scene.activatePendingVisionSnapshot = vi.fn();
  scene.refreshEndTurnControl = vi.fn();
  scene.inspectionPanel = { hide: vi.fn(), visible: false };
  scene.unitDetailOverlay = { visible: false, hide: vi.fn() };
  scene.dangerZone = { hide: vi.fn() };
  scene._clearSelectedWeaponArt = vi.fn();
  scene.buildUnitPositionMap = vi.fn(() => new Map());
  scene.showActionMenu = vi.fn();
  scene.moveUnit = vi.fn();
  scene._isReducedEffects = () => true;
  scene.grid = {
    cols: 8,
    rows: 6,
    fogEnabled: false,
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    gridToPixel: (col, row) => ({ x: col * 16 + 8, y: row * 16 + 8 }),
    getMovementRange: vi.fn(() => new Set(['3,3', '2,2'])),
    showMovementRange: vi.fn(),
  };
  scene.add = {
    rectangle: vi.fn(() => makeGuideMarker()),
  };
  scene.tweens = { add: vi.fn() };
  scene.playerUnits = [edric, sera];
  return { scene, edric, sera };
}

describe('TutorialBattle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('buildTutorialBattleConfig', () => {
    const config = buildTutorialBattleConfig();

    it('produces 8x6 rout map', () => {
      expect(config.cols).toBe(8);
      expect(config.rows).toBe(6);
      expect(config.objective).toBe('rout');
    });

    it('has exactly 2 player spawns', () => {
      expect(config.playerSpawns).toHaveLength(2);
      for (const sp of config.playerSpawns) {
        expect(sp).toHaveProperty('col');
        expect(sp).toHaveProperty('row');
      }
    });

    it('has exactly 2 enemy spawns with className/level/col/row', () => {
      expect(config.enemySpawns).toHaveLength(2);
      for (const sp of config.enemySpawns) {
        expect(sp).toHaveProperty('className');
        expect(sp).toHaveProperty('level');
        expect(sp).toHaveProperty('col');
        expect(sp).toHaveProperty('row');
      }
    });

    it('mapLayout dimensions match cols x rows', () => {
      expect(config.mapLayout).toHaveLength(config.rows);
      for (const row of config.mapLayout) {
        expect(row).toHaveLength(config.cols);
      }
    });

    it('all mapLayout cells are valid terrain indices', () => {
      const maxIndex = gameData.terrain.length - 1;
      for (const row of config.mapLayout) {
        for (const cell of row) {
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(cell).toBeLessThanOrEqual(maxIndex);
        }
      }
    });

    it('uses only Plain, Forest, and Fort terrain', () => {
      const allowed = new Set([TERRAIN.Plain, TERRAIN.Forest, TERRAIN.Fort]);
      for (const row of config.mapLayout) {
        for (const cell of row) {
          expect(allowed.has(cell)).toBe(true);
        }
      }
    });

    it('exposes a Fort tile that matches tutorial gate target resolution', () => {
      const scene = new BattleScene();
      scene.battleParams = { tutorialMode: true };
      scene.battleConfig = config;
      const fort = BattleScene.prototype._getTutorialFortTile.call(scene);
      expect(fort).not.toBeNull();
      expect(config.mapLayout[fort.row][fort.col]).toBe(TERRAIN.Fort);
    });

    it('has no npcSpawn or thronePos', () => {
      expect(config.npcSpawn).toBeNull();
      expect(config.thronePos).toBeNull();
    });
  });

  describe('buildTutorialRoster', () => {
    const roster = buildTutorialRoster(gameData);
    const [edric, sera] = roster;

    it('returns exactly 2 units', () => {
      expect(roster).toHaveLength(2);
    });

    it('Edric has exactly 1 inventory item (Iron Sword), not 2', () => {
      expect(edric.name).toBe('Edric');
      expect(edric.inventory).toHaveLength(1);
      expect(edric.inventory[0].name).toBe('Iron Sword');
      expect(edric.weapon.name).toBe('Iron Sword');
    });

    it('Edric is level 3 with boosted stats', () => {
      expect(edric.level).toBe(3);
    });

    it('Edric has 1 consumable (Vulnerary)', () => {
      expect(edric.consumables).toHaveLength(1);
      expect(edric.consumables[0].name).toBe('Vulnerary');
    });

    it('Sera has exactly 1 inventory item (Heal) and weapon is Staff type', () => {
      expect(sera.name).toBe('Sera');
      expect(sera.inventory).toHaveLength(1);
      expect(sera.inventory[0].name).toBe('Heal');
      expect(sera.weapon.name).toBe('Heal');
      expect(sera.weapon.type).toBe('Staff');
    });

    it('Sera has Staff proficiency', () => {
      const hasStaff = sera.proficiencies.some(p => p.type === 'Staff');
      expect(hasStaff).toBe(true);
    });

    it('Sera has 1 consumable (Vulnerary)', () => {
      expect(sera.consumables).toHaveLength(1);
      expect(sera.consumables[0].name).toBe('Vulnerary');
    });

    it('Sera is level 3 with boosted stats', () => {
      expect(sera.level).toBe(3);
    });
  });

  describe('tutorial strict gate', () => {
    it('blocks non-Edric first selection and keeps step unchanged', async () => {
      const { scene, sera } = createTutorialGateScene();
      scene.getUnitAt = vi.fn(() => sera);

      BattleScene.prototype.handleIdleClick.call(scene, { col: sera.col, row: sera.row });
      await Promise.resolve();

      expect(scene.tutorialStep).toBe(2);
      expect(scene.selectedUnit).toBeUndefined();
      expect(showImportantHint).toHaveBeenCalledWith(scene, expect.stringContaining('Select Edric first'));
    });

    it('blocks first selection when Edric is missing from roster', async () => {
      const { scene, sera } = createTutorialGateScene();
      scene.playerUnits = [sera];
      scene.getUnitAt = vi.fn(() => sera);

      BattleScene.prototype.handleIdleClick.call(scene, { col: sera.col, row: sera.row });
      await Promise.resolve();

      expect(scene.tutorialStep).toBe(2);
      expect(scene.selectedUnit).toBeUndefined();
      expect(showImportantHint).toHaveBeenCalledWith(scene, expect.stringContaining('Select Edric first'));
    });

    it('advances to Fort move gate after selecting Edric and swaps guide highlight', async () => {
      const { scene, edric } = createTutorialGateScene();

      BattleScene.prototype._setTutorialGuideHighlight.call(scene, 'edric');
      const initialEdricGuide = scene._tutorialEdricGuide;
      BattleScene.prototype.selectUnit.call(scene, edric);
      await Promise.resolve();

      expect(scene.tutorialStep).toBe(3);
      expect(scene.selectedUnit).toBe(edric);
      expect(initialEdricGuide.destroy).toHaveBeenCalledTimes(1);
      expect(scene._tutorialEdricGuide).toBeNull();
      expect(scene._tutorialFortGuide).not.toBeNull();
      expect(showImportantHint).toHaveBeenCalledWith(scene, expect.stringContaining('highlighted Fort tile'));
    });

    it('blocks non-Fort move attempts during Fort gate', async () => {
      const { scene, edric } = createTutorialGateScene();
      scene.tutorialStep = 3;
      scene.selectedUnit = edric;
      scene.movementRange = new Set(['3,3', '2,2']);

      BattleScene.prototype.handleSelectedClick.call(scene, { col: 2, row: 2 });
      await Promise.resolve();

      expect(scene.moveUnit).not.toHaveBeenCalled();
      expect(scene.tutorialStep).toBe(3);
      expect(showImportantHint).toHaveBeenCalledWith(scene, expect.stringContaining('highlighted Fort tile'));
    });

    it('post-Fort blocking hint includes required desktop guidance and gate releases after dismiss', async () => {
      const { scene, edric } = createTutorialGateScene();
      scene.tutorialStep = 3;
      scene._setTutorialGuideHighlight('fort');
      let resolveHint = null;
      showImportantHint.mockImplementationOnce(() => new Promise((resolve) => {
        resolveHint = resolve;
      }));

      const pending = BattleScene.prototype.afterMove.call(scene, edric);
      const hintText = showImportantHint.mock.calls.at(-1)[1];

      expect(hintText).toContain('top-left');
      expect(hintText).toContain('Danger Zone');
      expect(hintText).toContain('Right-click');
      expect(hintText).toContain('[V]');
      expect(scene._tutorialStrictGateReleased).toBe(false);
      expect(scene._tutorialFortGuide).toBeNull();

      resolveHint();
      await pending;

      expect(scene._tutorialStrictGateReleased).toBe(true);
      expect(scene.showActionMenu).toHaveBeenCalledWith(edric);
    });

    it('post-Fort blocking hint includes required mobile inspect guidance', async () => {
      const { scene, edric } = createTutorialGateScene({ isMobileInput: true });
      scene.tutorialStep = 3;

      await BattleScene.prototype.afterMove.call(scene, edric);
      const hintText = showImportantHint.mock.calls.at(-1)[1];

      expect(hintText).toContain('top-left');
      expect(hintText).toContain('Danger Zone');
      expect(hintText).toContain('Inspect');
      expect(hintText).toContain('long-press');
    });

    it('blocks cancel and end-turn while strict gate is active', async () => {
      const { scene, edric } = createTutorialGateScene();
      scene.tutorialStep = 3;
      scene.selectedUnit = edric;
      scene.battleState = 'UNIT_SELECTED';

      const canceled = BattleScene.prototype.requestCancel.call(scene, { allowPause: false });
      BattleScene.prototype.forceEndTurn.call(scene);
      await Promise.resolve();

      expect(canceled).toBe(true);
      expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
      expect(showImportantHint).toHaveBeenCalledWith(scene, expect.stringContaining('tutorial movement step'));
    });
  });

  describe('step-4 forecast hint blocks combat', () => {
    it('confirmForecastCombat is ignored while tutorial hint lock is active', () => {
      const scene = new BattleScene();
      scene.battleState = 'TUTORIAL_HINT';
      scene.forecastTarget = { id: 'enemy' };
      scene.selectedUnit = { id: 'ally' };
      scene.hideForecast = vi.fn();
      scene.executeCombat = vi.fn();

      BattleScene.prototype.confirmForecastCombat.call(scene);

      expect(scene.hideForecast).not.toHaveBeenCalled();
      expect(scene.executeCombat).not.toHaveBeenCalled();
    });
  });

  describe('tutorial victory localStorage', () => {
    it('skip confirm false does not transition', () => {
      const scene = new BattleScene();
      scene.gameData = {};
      const audio = { playMusic: vi.fn(), releaseMusic: vi.fn() };
      scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
      vi.stubGlobal('window', { confirm: vi.fn(() => false) });

      const transitioned = BattleScene.prototype._handleTutorialSkipRequested.call(scene);

      expect(transitioned).toBe(false);
      expect(window.confirm).toHaveBeenCalledWith('Skip tutorial and return to title?');
      expect(audio.releaseMusic).not.toHaveBeenCalled();
      expect(transitionToScene).not.toHaveBeenCalled();
    });

    it('skip confirm true transitions to Title with releaseMusic', () => {
      const scene = new BattleScene();
      scene.gameData = {};
      const audio = { playMusic: vi.fn(), releaseMusic: vi.fn() };
      scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
      vi.stubGlobal('window', { confirm: vi.fn(() => true) });

      const transitioned = BattleScene.prototype._handleTutorialSkipRequested.call(scene);

      expect(transitioned).toBe(true);
      expect(window.confirm).toHaveBeenCalledWith('Skip tutorial and return to title?');
      expect(audio.releaseMusic).toHaveBeenCalledWith(scene, 0);
      expect(transitionToScene).toHaveBeenCalledTimes(1);
      expect(audio.releaseMusic.mock.invocationCallOrder[0]).toBeLessThan(transitionToScene.mock.invocationCallOrder[0]);
    });

    it('onVictory writes tutorial completion flag and transitions to Title', async () => {
      const setItem = vi.fn();
      vi.stubGlobal('localStorage', { setItem });

      const scene = new BattleScene();
      scene.battleState = 'PLAYER_IDLE';
      scene.battleParams = { tutorialMode: true };
      const audio = { playMusic: vi.fn(), releaseMusic: vi.fn() };
      scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
      scene.cameras = { main: { centerX: 320, centerY: 240 } };
      scene.add = {
        text: vi.fn(() => ({
          setOrigin() { return this; },
          setDepth() { return this; },
        })),
      };
      const pending = [];
      scene.time = {
        delayedCall: vi.fn((_ms, cb) => {
          pending.push(cb());
        }),
      };
      scene.scene = { isActive: () => true };
      scene.gameData = {};

      BattleScene.prototype.onVictory.call(scene);
      await Promise.all(pending);

      expect(showImportantHint).toHaveBeenCalledTimes(1);
      expect(setItem).toHaveBeenCalledWith('emblem_rogue_tutorial_completed', '1');
      expect(transitionToScene).toHaveBeenCalledTimes(1);
      expect(audio.releaseMusic).toHaveBeenCalledWith(scene, 0);
      expect(audio.releaseMusic.mock.invocationCallOrder[0]).toBeLessThan(transitionToScene.mock.invocationCallOrder[0]);
    });

    it('onDefeat tutorial path releases music before transition', async () => {
      const scene = new BattleScene();
      scene.battleState = 'PLAYER_IDLE';
      scene.battleParams = { tutorialMode: true };
      const audio = { playMusic: vi.fn(), releaseMusic: vi.fn() };
      scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
      scene.cameras = { main: { centerX: 320, centerY: 240 } };
      scene.add = {
        text: vi.fn(() => ({
          setOrigin() { return this; },
          setDepth() { return this; },
        })),
      };
      scene.clearInspectionVisuals = vi.fn();
      scene.hideActionMenu = vi.fn();
      const pending = [];
      scene.time = {
        delayedCall: vi.fn((_ms, cb) => {
          pending.push(cb());
        }),
      };
      scene.scene = { isActive: () => true };
      scene.gameData = {};

      BattleScene.prototype.onDefeat.call(scene);
      await Promise.all(pending);

      expect(transitionToScene).toHaveBeenCalledTimes(1);
      expect(audio.releaseMusic).toHaveBeenCalledWith(scene, 0);
      expect(audio.releaseMusic.mock.invocationCallOrder[0]).toBeLessThan(transitionToScene.mock.invocationCallOrder[0]);
    });
  });
});
