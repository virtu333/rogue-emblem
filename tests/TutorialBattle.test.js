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
    it('onVictory writes tutorial completion flag and transitions to Title', async () => {
      const setItem = vi.fn();
      vi.stubGlobal('localStorage', { setItem });

      const scene = new BattleScene();
      scene.battleState = 'PLAYER_IDLE';
      scene.battleParams = { tutorialMode: true };
      scene.registry = { get: () => ({ playMusic: vi.fn() }) };
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
    });
  });
});
