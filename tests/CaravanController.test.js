// CaravanController: BattleScene-facing wiring for the Merchant Caravan.
// Pure movement/creation logic is covered by CaravanSystem.test.js; this file
// covers the Phaser-facing glue (spawn, graphic tint, step, exit, survival).

import { describe, it, expect, vi } from 'vitest';
import { CaravanController } from '../src/ui/CaravanController.js';

function makeGrid(cols, rows, fill = 0) {
  const mapLayout = Array.from({ length: rows }, () => Array(cols).fill(fill));
  const terrainData = [
    { name: 'Plain', moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } },
    { name: 'Mountain', moveCost: { Infantry: '--', Armored: '--', Cavalry: '--', Flying: '1' } },
  ];
  return {
    cols,
    rows,
    mapLayout,
    terrainData,
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
  };
}

function makeGraphic() {
  return { setStrokeStyle: vi.fn(), x: 0, y: 0 };
}

function makeScene(overrides = {}) {
  return {
    battleConfig: {},
    battleParams: { act: 'act2' },
    npcUnits: [],
    playerUnits: [],
    enemyUnits: [],
    grid: makeGrid(10, 3),
    registry: { get: vi.fn(() => null) },
    cameras: { main: { centerX: 320, height: 480 } },
    add: {
      text: () => ({
        setOrigin: () => ({ setDepth: () => ({ setAlpha: () => ({}) }) }),
      }),
    },
    tweens: { add: vi.fn() },
    time: { delayedCall: vi.fn() },
    addUnitGraphic: vi.fn((unit) => {
      unit.graphic = makeGraphic();
      unit.factionIndicator = makeGraphic();
    }),
    removeUnitGraphic: vi.fn(),
    updateHPBar: vi.fn(),
    showBriefBanner: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('CaravanController', () => {
  describe('spawnIfConfigured', () => {
    it('does nothing when battleConfig has no caravanSpawn', () => {
      const scene = makeScene();
      const ctrl = new CaravanController(scene);
      ctrl.spawnIfConfigured();
      expect(scene.npcUnits).toHaveLength(0);
    });

    it('spawns a tinted caravan unit at the configured tile', () => {
      const scene = makeScene({ battleConfig: { caravanSpawn: { col: 3, row: 1 } } });
      const ctrl = new CaravanController(scene);
      ctrl.spawnIfConfigured();

      expect(scene.npcUnits).toHaveLength(1);
      const unit = scene.npcUnits[0];
      expect(unit.isCaravan).toBe(true);
      expect(unit.col).toBe(3);
      expect(unit.row).toBe(1);
      expect(scene.addUnitGraphic).toHaveBeenCalledWith(unit);
      expect(unit.factionIndicator.setStrokeStyle).toHaveBeenCalled();
    });

    it('skips spawning on resume (checkpoint already restored it)', () => {
      const scene = makeScene({
        battleConfig: { caravanSpawn: { col: 3, row: 1 } },
        _resumeCheckpoint: { some: 'checkpoint' },
      });
      const ctrl = new CaravanController(scene);
      ctrl.spawnIfConfigured();
      expect(scene.npcUnits).toHaveLength(0);
    });

    it('shows the first-encounter hint exactly once', () => {
      const shouldShow = vi.fn(() => true);
      const scene = makeScene({
        battleConfig: { caravanSpawn: { col: 3, row: 1 } },
        registry: { get: vi.fn(() => ({ shouldShow })) },
      });
      const ctrl = new CaravanController(scene);
      ctrl.spawnIfConfigured();
      expect(shouldShow).toHaveBeenCalledWith('battle_caravan');
    });
  });

  describe('stepTurn', () => {
    it('moves the caravan 1 tile toward the nearer edge', () => {
      const scene = makeScene({
        npcUnits: [
          {
            isCaravan: true,
            col: 2,
            row: 1,
            currentHP: 20,
            moveType: 'Infantry',
            graphic: makeGraphic(),
            factionIndicator: makeGraphic(),
            hpBar: null,
          },
        ],
      });
      const ctrl = new CaravanController(scene);
      ctrl.stepTurn();
      expect(scene.npcUnits[0].col).toBe(1); // toward left edge (nearer)
      expect(scene._caravanExited).toBeFalsy();
    });

    it('marks exited and removes the unit once it reaches the edge', () => {
      const scene = makeScene({
        npcUnits: [
          {
            isCaravan: true,
            col: 1,
            row: 1,
            currentHP: 20,
            moveType: 'Infantry',
            graphic: makeGraphic(),
            factionIndicator: makeGraphic(),
            hpBar: null,
          },
        ],
      });
      const ctrl = new CaravanController(scene);
      ctrl.stepTurn();
      expect(scene._caravanExited).toBe(true);
      expect(scene.npcUnits).toHaveLength(0);
      expect(scene.removeUnitGraphic).toHaveBeenCalled();
      expect(scene.showBriefBanner).toHaveBeenCalledWith('Caravan escaped!', expect.any(String));
    });

    it('is a no-op once the caravan has already exited', () => {
      const scene = makeScene({ _caravanExited: true });
      const ctrl = new CaravanController(scene);
      expect(() => ctrl.stepTurn()).not.toThrow();
      expect(scene.removeUnitGraphic).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no live caravan on the field', () => {
      const scene = makeScene();
      const ctrl = new CaravanController(scene);
      expect(() => ctrl.stepTurn()).not.toThrow();
    });

    it('skips the step (holds position) when the adjacent tile is occupied', () => {
      const scene = makeScene({
        npcUnits: [
          {
            isCaravan: true,
            col: 2,
            row: 1,
            currentHP: 20,
            moveType: 'Infantry',
            graphic: makeGraphic(),
            factionIndicator: makeGraphic(),
            hpBar: null,
          },
        ],
        enemyUnits: [{ col: 1, row: 1, currentHP: 10 }],
      });
      const ctrl = new CaravanController(scene);
      ctrl.stepTurn();
      expect(scene.npcUnits[0].col).toBe(2); // held, tile occupied
    });
  });

  describe('caravanSurvived / hadCaravan', () => {
    it('hadCaravan is true only when battleConfig had a caravanSpawn', () => {
      const withCaravan = new CaravanController(
        makeScene({ battleConfig: { caravanSpawn: { col: 0, row: 0 } } }),
      );
      const withoutCaravan = new CaravanController(makeScene());
      expect(withCaravan.hadCaravan()).toBe(true);
      expect(withoutCaravan.hadCaravan()).toBe(false);
    });

    it('caravanSurvived is true when the caravan is alive on the field', () => {
      const scene = makeScene({
        npcUnits: [{ isCaravan: true, currentHP: 10 }],
      });
      const ctrl = new CaravanController(scene);
      expect(ctrl.caravanSurvived()).toBe(true);
    });

    it('caravanSurvived is true when the caravan already exited', () => {
      const scene = makeScene({ _caravanExited: true, npcUnits: [] });
      const ctrl = new CaravanController(scene);
      expect(ctrl.caravanSurvived()).toBe(true);
    });

    it('caravanSurvived is false when the caravan died and did not exit', () => {
      const scene = makeScene({ npcUnits: [] });
      const ctrl = new CaravanController(scene);
      expect(ctrl.caravanSurvived()).toBe(false);
    });
  });
});
