// VillageController: BattleScene-facing wiring for the village & bandit
// secondary objective. Pure roll/placement/state logic is covered by
// VillageSystem.test.js; this file covers the Phaser-facing glue (setup,
// resume skip, visit reward grant, raze banner, bandit sanitization).

import { describe, it, expect, vi } from 'vitest';
import { VillageController } from '../src/ui/VillageController.js';
import { TERRAIN, VILLAGE_GOLD_BY_ACT } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function makeText() {
  const obj = {
    setOrigin: () => obj,
    setDepth: () => obj,
    setAlpha: () => obj,
    destroy: vi.fn(),
  };
  return obj;
}

function makeRect() {
  const obj = { setDepth: () => obj, destroy: vi.fn() };
  return obj;
}

function makeScene(overrides = {}) {
  return {
    battleConfig: {},
    battleParams: { act: 'act1' },
    gameData,
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    goldEarned: 0,
    runManager: { addToConvoy: vi.fn(() => true) },
    grid: {
      gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
      setTerrainAt: vi.fn(() => true),
    },
    registry: { get: vi.fn(() => null) },
    cameras: { main: { centerX: 320, height: 480 } },
    add: { text: () => makeText(), rectangle: () => makeRect() },
    tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    time: { delayedCall: vi.fn() },
    showBriefBanner: vi.fn(() => Promise.resolve()),
    updateObjectiveText: vi.fn(),
    _isReducedEffects: () => true,
    ...overrides,
  };
}

function makeUnit(overrides = {}) {
  return { faction: 'player', col: 4, row: 6, currentHP: 20, name: 'Edric', ...overrides };
}

const TILE = { col: 4, row: 6 };

describe('VillageController', () => {
  describe('create', () => {
    it('does nothing when battleConfig has no villageTile', () => {
      const scene = makeScene();
      const ctrl = new VillageController(scene);
      ctrl.create();
      expect(scene._villageState).toBeUndefined();
      expect(ctrl.markers).toHaveLength(0);
    });

    it('creates intact state and markers from battleConfig.villageTile', () => {
      const scene = makeScene({ battleConfig: { villageTile: { ...TILE } } });
      const ctrl = new VillageController(scene);
      ctrl.create();
      expect(scene._villageState).toEqual({ col: 4, row: 6, status: 'intact' });
      expect(ctrl.markers.length).toBeGreaterThan(0);
    });

    it('shows the first-encounter hint exactly once', () => {
      const shouldShow = vi.fn(() => true);
      const scene = makeScene({
        battleConfig: { villageTile: { ...TILE } },
        registry: { get: vi.fn(() => ({ shouldShow })) },
      });
      new VillageController(scene).create();
      expect(shouldShow).toHaveBeenCalledWith('battle_village');
    });

    it('on resume keeps the checkpoint-restored state instead of resetting it', () => {
      const scene = makeScene({
        battleConfig: { villageTile: { ...TILE } },
        _resumeCheckpoint: { some: 'checkpoint' },
        _villageState: { col: 4, row: 6, status: 'intact' },
      });
      const ctrl = new VillageController(scene);
      ctrl.create();
      expect(scene._villageState.status).toBe('intact');
      expect(ctrl.markers.length).toBeGreaterThan(0);
      expect(scene.grid.setTerrainAt).not.toHaveBeenCalled();
    });

    it('on resume re-applies Plain terrain (no marker) for a resolved village', () => {
      const scene = makeScene({
        battleConfig: { villageTile: { ...TILE } },
        _resumeCheckpoint: { some: 'checkpoint' },
        _villageState: { col: 4, row: 6, status: 'visited' },
      });
      const ctrl = new VillageController(scene);
      ctrl.create();
      expect(scene.grid.setTerrainAt).toHaveBeenCalledWith(4, 6, TERRAIN.Plain);
      expect(ctrl.markers).toHaveLength(0);
    });
  });

  describe('handleUnitActionEnd (visit)', () => {
    function setupIntact(sceneOverrides = {}) {
      const scene = makeScene({
        battleConfig: { villageTile: { ...TILE } },
        ...sceneOverrides,
      });
      const ctrl = new VillageController(scene);
      ctrl.create();
      return { scene, ctrl };
    }

    it('grants act-scaled gold into scene.goldEarned and an item to the convoy', () => {
      const { scene, ctrl } = setupIntact({ battleParams: { act: 'act2' } });
      const unit = makeUnit();
      expect(ctrl.handleUnitActionEnd(unit)).toBe(true);
      expect(scene.goldEarned).toBe(VILLAGE_GOLD_BY_ACT.act2);
      expect(scene.runManager.addToConvoy).toHaveBeenCalledTimes(1);
      const item = scene.runManager.addToConvoy.mock.calls[0][0];
      expect(typeof item.name).toBe('string');
      expect(scene._villageState.status).toBe('visited');
      expect(scene.grid.setTerrainAt).toHaveBeenCalledWith(4, 6, TERRAIN.Plain);
      expect(scene.showBriefBanner).toHaveBeenCalled();
      expect(scene.updateObjectiveText).toHaveBeenCalled();
    });

    it('reverts surviving seek_tile bandits to chase on visit', () => {
      const bandit = { aiMode: 'seek_tile', aiTargetTile: { ...TILE }, currentHP: 10 };
      const { ctrl } = setupIntact({ enemyUnits: [bandit] });
      ctrl.handleUnitActionEnd(makeUnit());
      expect(bandit.aiMode).toBe('chase');
      expect(bandit.aiTargetTile).toBeUndefined();
    });

    it('does not re-trigger on a second visit (tile resolved)', () => {
      const { scene, ctrl } = setupIntact();
      expect(ctrl.handleUnitActionEnd(makeUnit())).toBe(true);
      expect(ctrl.handleUnitActionEnd(makeUnit())).toBe(false);
      expect(scene.goldEarned).toBe(VILLAGE_GOLD_BY_ACT.act1);
    });

    it('ignores units not on the tile, non-player units, and downed units', () => {
      const { scene, ctrl } = setupIntact();
      expect(ctrl.handleUnitActionEnd(makeUnit({ col: 3 }))).toBe(false);
      expect(ctrl.handleUnitActionEnd(makeUnit({ faction: 'npc' }))).toBe(false);
      expect(ctrl.handleUnitActionEnd(makeUnit({ currentHP: 0 }))).toBe(false);
      expect(scene.goldEarned).toBe(0);
      expect(scene._villageState.status).toBe('intact');
    });

    it('still pays gold when the convoy is full (item grant fails gracefully)', () => {
      const { scene, ctrl } = setupIntact({
        runManager: { addToConvoy: vi.fn(() => false) },
      });
      expect(ctrl.handleUnitActionEnd(makeUnit())).toBe(true);
      expect(scene.goldEarned).toBe(VILLAGE_GOLD_BY_ACT.act1);
      expect(scene.showBriefBanner).toHaveBeenCalledWith(
        expect.not.stringContaining('convoy'),
        expect.any(String),
      );
    });
  });

  describe('handleEnemyUnitDone (raze)', () => {
    function setupIntact(sceneOverrides = {}) {
      const scene = makeScene({ battleConfig: { villageTile: { ...TILE } }, ...sceneOverrides });
      const ctrl = new VillageController(scene);
      ctrl.create();
      return { scene, ctrl };
    }

    it('a seek_tile bandit ending on the tile razes it', () => {
      const bandit = makeUnit({ faction: 'enemy', aiMode: 'seek_tile', aiTargetTile: { ...TILE } });
      const other = { aiMode: 'seek_tile', aiTargetTile: { ...TILE }, currentHP: 8 };
      const { scene, ctrl } = setupIntact({ enemyUnits: [bandit, other] });
      expect(ctrl.handleEnemyUnitDone(bandit)).toBe(true);
      expect(scene._villageState.status).toBe('razed');
      expect(scene.grid.setTerrainAt).toHaveBeenCalledWith(4, 6, TERRAIN.Plain);
      expect(scene.showBriefBanner).toHaveBeenCalledWith('Village razed!', expect.any(String));
      // Survivors join the battle.
      expect(bandit.aiMode).toBe('chase');
      expect(other.aiMode).toBe('chase');
    });

    it('a regular chase enemy parking on the tile does NOT raze it', () => {
      const chaser = makeUnit({ faction: 'enemy', aiMode: 'chase' });
      const { scene, ctrl } = setupIntact();
      expect(ctrl.handleEnemyUnitDone(chaser)).toBe(false);
      expect(scene._villageState.status).toBe('intact');
    });

    it('ignores bandits not on the tile and razes only once', () => {
      const bandit = makeUnit({ faction: 'enemy', aiMode: 'seek_tile', aiTargetTile: { ...TILE } });
      const { scene, ctrl } = setupIntact();
      expect(ctrl.handleEnemyUnitDone({ ...bandit, col: 0 })).toBe(false);
      expect(ctrl.handleEnemyUnitDone(bandit)).toBe(true);
      expect(ctrl.handleEnemyUnitDone({ ...bandit, aiMode: 'seek_tile' })).toBe(false);
      expect(scene._villageState.status).toBe('razed');
    });
  });

  describe('sanitizeSpawnedEnemy', () => {
    it('reverts a seek_tile spawn to chase when the village already resolved', () => {
      const scene = makeScene({
        battleConfig: { villageTile: { ...TILE } },
        _villageState: { ...TILE, status: 'visited' },
      });
      const ctrl = new VillageController(scene);
      const bandit = { aiMode: 'seek_tile', aiTargetTile: { ...TILE } };
      ctrl.sanitizeSpawnedEnemy(bandit);
      expect(bandit.aiMode).toBe('chase');
      expect(bandit.aiTargetTile).toBeUndefined();
    });

    it('leaves a seek_tile spawn alone while the village is intact', () => {
      const scene = makeScene({
        battleConfig: { villageTile: { ...TILE } },
        _villageState: { ...TILE, status: 'intact' },
      });
      const ctrl = new VillageController(scene);
      const bandit = { aiMode: 'seek_tile', aiTargetTile: { ...TILE } };
      ctrl.sanitizeSpawnedEnemy(bandit);
      expect(bandit.aiMode).toBe('seek_tile');
      expect(bandit.aiTargetTile).toEqual(TILE);
    });
  });

  describe('objective suffix and banners', () => {
    it('exposes the race subtext only while intact', () => {
      const scene = makeScene({ battleConfig: { villageTile: { ...TILE } } });
      const ctrl = new VillageController(scene);
      ctrl.create();
      expect(ctrl.getObjectiveSuffix()).toBe('Village: Visit before bandits!');
      scene._villageState.status = 'razed';
      expect(ctrl.getObjectiveSuffix()).toBeNull();
    });

    it('shows the bandit arrival banner only while intact', () => {
      const scene = makeScene({ battleConfig: { villageTile: { ...TILE } } });
      const ctrl = new VillageController(scene);
      ctrl.create();
      ctrl.showBanditArrivalBanner();
      expect(scene.showBriefBanner).toHaveBeenCalledTimes(1);
      scene._villageState.status = 'visited';
      ctrl.showBanditArrivalBanner();
      expect(scene.showBriefBanner).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('destroys markers and detaches the scene', () => {
      const scene = makeScene({ battleConfig: { villageTile: { ...TILE } } });
      const ctrl = new VillageController(scene);
      ctrl.create();
      const markers = [...ctrl.markers];
      expect(markers.length).toBeGreaterThan(0);
      ctrl.destroy();
      for (const m of markers) expect(m.destroy).toHaveBeenCalled();
      expect(ctrl.markers).toHaveLength(0);
      expect(ctrl.scene).toBeNull();
    });
  });
});
