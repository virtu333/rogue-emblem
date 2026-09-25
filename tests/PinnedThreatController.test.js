import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { PinnedThreatController } from '../src/ui/PinnedThreatController.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';

function fixture(count = 6) {
  const scene = new BattleScene();
  scene.enemyUnits = Array.from({ length: count }, (_, i) => ({
    name: `Enemy ${i}`,
    faction: 'enemy',
    col: i + 2,
    row: 2,
    currentHP: 20,
    stats: { HP: 20, MOV: 1 },
    weapon: { uid: `weapon_${i}`, range: '1' },
    inventory: [],
    moveType: 'Infantry',
    graphic: { setPosition: vi.fn(), setDepth: vi.fn() },
  }));
  scene.playerUnits = [];
  scene.npcUnits = [];
  scene.grid = {
    cols: 20,
    rows: 20,
    fogEnabled: false,
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
    getMovementRange: (col, row) => new Map([[`${col},${row}`, { stoppable: true }]]),
    getAttackRange: Grid.prototype.getAttackRange,
  };
  scene.buildUnitPositionMap = () => new Map();
  scene._getCostModifier = () => 0;
  scene.updateHPBar = vi.fn();
  scene.updateAffixPips = vi.fn();
  scene._updateConditionIconPositions = vi.fn();
  const rectangles = [];
  scene.add = {
    rectangle: vi.fn((...args) => {
      const r = {
        args,
        setDepth: vi.fn().mockReturnThis(),
        setStrokeStyle: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      };
      rectangles.push(r);
      return r;
    }),
  };
  const controller = new PinnedThreatController(scene);
  scene._pinnedThreats = controller;
  scene.pinnedThreatEnemies = controller.enemies;
  scene.calculateDangerZone = vi.fn(BattleScene.prototype.calculateDangerZone.bind(scene));
  return { scene, controller, rectangles };
}
afterEach(() => vi.restoreAllMocks());

describe('pinned enemy threat lifecycle', () => {
  it('caps at five, evicts oldest, and unpins without disturbing newer pins', () => {
    const { scene, controller } = fixture();
    for (const unit of scene.enemyUnits) expect(controller.toggle(unit)).toBe(true);
    expect([...controller.enemies]).toEqual(scene.enemyUnits.slice(1));
    controller.toggle(scene.enemyUnits[3]);
    expect([...controller.enemies]).toEqual([
      scene.enemyUnits[1],
      scene.enemyUnits[2],
      scene.enemyUnits[4],
      scene.enemyUnits[5],
    ]);
    controller.toggle(scene.enemyUnits[0]);
    expect([...controller.enemies].at(-1)).toBe(scene.enemyUnits[0]);
  });

  it('rejects non-roster, dead and fog-hidden targets, pruning existing pins even when clean', () => {
    const { scene, controller } = fixture(3);
    const [dead, hidden, visible] = scene.enemyUnits;
    controller.toggle(dead);
    controller.toggle(hidden);
    controller.toggle(visible);
    dead.currentHP = 0;
    scene.grid.fogEnabled = true;
    scene.grid.isVisible = (col) => col === visible.col;
    expect(controller.dirty).toBe(false);
    controller.refresh();
    expect([...controller.enemies]).toEqual([visible]);
    expect(controller.toggle(dead)).toBe(false);
    expect(controller.toggle(hidden)).toBe(false);
    expect(controller.toggle({ ...visible })).toBe(false);
    scene.enemyUnits = [];
    controller.refresh();
    expect(controller.enemies.size).toBe(0);
    expect(controller.overlay.visible).toBe(false);
  });

  it('keeps partially visible entities eligible but drops them when the entire footprint is hidden', () => {
    const { scene, controller } = fixture(1);
    const unit = scene.enemyUnits[0];
    unit.isEntity = true;
    scene.grid.fogEnabled = true;
    scene.grid.isVisible = (col, row) => col === unit.col + 2 && row === unit.row + 2;
    expect(controller.toggle(unit)).toBe(true);
    scene.grid.isVisible = () => false;
    controller.refresh();
    expect(controller.enemies.size).toBe(0);
  });

  it('recomputes after production position updates with global danger hidden and stays lazy otherwise', () => {
    const { scene, controller } = fixture(1);
    const unit = scene.enemyUnits[0];
    scene.dangerZone = { visible: false, show: vi.fn() };
    controller.toggle(unit);
    const oldTiles = controller.overlay.tiles.map((t) => `${t.col},${t.row}`);
    scene.calculateDangerZone.mockClear();
    controller.refresh();
    controller.refresh();
    expect(scene.calculateDangerZone).not.toHaveBeenCalled();
    unit.col = 10;
    scene.updateUnitPosition(unit);
    expect(controller.dirty).toBe(true);
    controller.refresh();
    expect(scene.calculateDangerZone).toHaveBeenCalledExactlyOnceWith(unit);
    expect(controller.overlay.tiles.every((t) => t.col >= 9)).toBe(true);
    expect(controller.overlay.tiles.map((t) => `${t.col},${t.row}`)).not.toEqual(oldTiles);
    expect(scene.dangerZone.show).not.toHaveBeenCalled();
  });

  it('merges overlapping pinned damage sources while preserving staff-only coverage', () => {
    const { scene, controller } = fixture(3);
    scene.calculateDangerZone.mockImplementation((unit) => [
      {
        col: 7,
        row: 7,
        count: unit === scene.enemyUnits[2] ? 0 : 1,
        damageThreat: unit !== scene.enemyUnits[2],
        statusThreat: unit === scene.enemyUnits[2],
      },
    ]);
    for (const unit of scene.enemyUnits) controller.toggle(unit);
    expect(controller.overlay.tiles).toHaveLength(1);
    const tile = controller.overlay.tiles[0];
    expect(controller.overlay.color).toBe(0xd8342c);
    expect(controller.overlay.variant).toBe('pinned');
    expect(tile.count).toBe(2);
    expect(tile.tier).toBe(2);
    expect(tile.statusThreat).toBe(true);
  });

  it('does not consume battle RNG or change the real suspend checkpoint', () => {
    const { scene, controller } = fixture(2);
    const suspend = new BattleSuspendController(scene);
    const before = suspend._buildCheckpoint(2, 123);
    const rng = vi.spyOn(Math, 'random');
    controller.toggle(scene.enemyUnits[0]);
    controller.toggle(scene.enemyUnits[1]);
    controller.invalidate();
    controller.refresh();
    const after = suspend._buildCheckpoint(2, 123);
    expect(rng).not.toHaveBeenCalled();
    expect(after).toEqual(before);
    expect(Object.keys(after).some((key) => /pin|threat/i.test(key))).toBe(false);
  });

  it('destroys its drawing and references without disturbing the units', () => {
    const { scene, controller } = fixture(1);
    controller.toggle(scene.enemyUnits[0]);
    expect(controller.overlay.tiles.length).toBeGreaterThan(0);
    const destroy = vi.spyOn(controller.overlay, 'destroy');
    controller.destroy();
    expect(controller.enemies.size).toBe(0);
    expect(controller.overlay.tiles).toEqual([]);
    expect(destroy).toHaveBeenCalledOnce();
    expect(scene.enemyUnits).toHaveLength(1);
  });
});
