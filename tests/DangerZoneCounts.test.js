import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { DangerZoneOverlay } from '../src/ui/DangerZoneOverlay.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';

const enemy = (extra = {}) => ({
  faction: 'enemy',
  col: 3,
  row: 3,
  currentHP: 20,
  stats: { MOV: 3 },
  moveType: 'Infantry',
  weapon: { range: '1' },
  ...extra,
});
function sceneFor(enemies) {
  const scene = new BattleScene();
  scene.enemyUnits = enemies;
  scene.grid = {
    cols: 12,
    rows: 12,
    fogEnabled: false,
    getMovementRange: vi.fn(
      () =>
        new Map([
          ['3,3', { stoppable: true }],
          ['5,3', { stoppable: true }],
          ['4,3', { stoppable: false }],
        ]),
    ),
    getAttackRange: Grid.prototype.getAttackRange,
  };
  scene.buildUnitPositionMap = () => new Map();
  scene._getCostModifier = () => 0;
  return scene;
}
const tileAt = (tiles, col, row) => tiles.find((tile) => tile.col === col && tile.row === row);

describe('distinct damage-source counts', () => {
  it('counts enemies, not the number of reachable attack origins', () => {
    const enemies = [enemy(), enemy(), enemy()];
    const scene = sceneFor(enemies);
    expect(tileAt(scene.calculateDangerZone(), 4, 3)).toEqual({
      col: 4,
      row: 3,
      count: 3,
      statusThreat: false,
      damageThreat: true,
    });
    expect(tileAt(scene.calculateDangerZone(enemies[0]), 4, 3).count).toBe(1);
    // Unstoppable (4,3) must not add the otherwise unthreatened tile (4,4).
    expect(tileAt(scene.calculateDangerZone(), 4, 4)).toBeUndefined();
  });

  it('counts overlapping entity footprint ranges as one enemy', () => {
    const scene = sceneFor([enemy({ isEntity: true })]);
    const tiles = scene.calculateDangerZone();
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => tile.count === 1)).toBe(true);
    expect(scene.grid.getMovementRange).not.toHaveBeenCalled();
  });

  it('keeps staff-only coverage at zero and adds damage count independently', () => {
    const staff = enemy({
      weapon: null,
      statusStaff: {
        name: 'Sleep',
        type: 'Staff',
        range: '1-3',
        uses: 3,
        statusEffect: 'sleep',
      },
    });
    const scene = sceneFor([staff, enemy()]);
    expect(tileAt(scene.calculateDangerZone(), 4, 3)).toEqual({
      col: 4,
      row: 3,
      count: 1,
      statusThreat: true,
      damageThreat: true,
    });
    expect(tileAt(scene.calculateDangerZone(), 3, 6)).toEqual({
      col: 3,
      row: 6,
      count: 0,
      statusThreat: true,
      damageThreat: false,
    });
    staff.statusStaff._usesSpent = 3;
    expect(tileAt(scene.calculateDangerZone(), 3, 6)).toBeUndefined();
  });

  it('excludes dead and fog-hidden enemies before accumulating counts', () => {
    const scene = sceneFor([enemy(), enemy({ col: 6 }), enemy({ currentHP: 0 })]);
    scene.grid.fogEnabled = true;
    scene.grid.isVisible = (col) => col === 3;
    expect(tileAt(scene.calculateDangerZone(), 4, 3).count).toBe(1);
    expect(scene.grid.getMovementRange).toHaveBeenCalledTimes(1);
  });

  it('includes visible enemy ballistas as global sources but never in a single-enemy pin', () => {
    const unit = enemy();
    const scene = sceneFor([unit]);
    scene.ballistas = [{ col: 1, row: 3, owner: 'enemy' }];
    expect(tileAt(scene.calculateDangerZone(), 4, 3).count).toBe(2);
    expect(tileAt(scene.calculateDangerZone(unit), 4, 3).count).toBe(1);
    scene.ballistas[0].owner = 'player';
    expect(tileAt(scene.calculateDangerZone(), 4, 3).count).toBe(1);
  });

  it('preserves roots that survive next phase and allows roots expiring then', () => {
    const rooted = enemy();
    applyCondition(rooted, 'root', 2);
    const scene = sceneFor([rooted]);
    scene.calculateDangerZone();
    expect(scene.grid.getMovementRange.mock.calls[0][2]).toBe(0);
    const expiring = enemy();
    applyCondition(expiring, 'root', 1);
    scene.enemyUnits = [expiring];
    scene.calculateDangerZone();
    expect(scene.grid.getMovementRange.mock.calls[1][2]).toBe(3);
  });
});

function overlayFixture(options) {
  const rectangles = [];
  const scene = {
    add: {
      rectangle: vi.fn((...args) => {
        const rect = {
          args,
          setDepth: vi.fn().mockReturnThis(),
          setStrokeStyle: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        };
        rectangles.push(rect);
        return rect;
      }),
    },
  };
  const grid = { gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }) };
  return { overlay: new DangerZoneOverlay(scene, grid, options), rectangles };
}
describe('danger rendering', () => {
  it('steps at 1, 2, and 3+ damage sources without Text or RNG', () => {
    const { overlay, rectangles } = overlayFixture();
    overlay.show([1, 2, 3, 5].map((count, col) => ({ col, row: 0, count, damageThreat: true })));
    expect(rectangles.map((r) => r.args[5])).toEqual([0.18, 0.3, 0.42, 0.42]);
    expect(rectangles.every((r) => r.args[4] === 0xff8800)).toBe(true);
    for (const r of rectangles) expect(r.setDepth).toHaveBeenCalledWith(4);
  });

  it('preserves the purple outline with no fill for status-only threat', () => {
    const { overlay, rectangles } = overlayFixture();
    overlay.show([
      { col: 1, row: 1, count: 0, statusThreat: true, damageThreat: false },
      { col: 2, row: 1, count: 2, statusThreat: true, damageThreat: true },
    ]);
    expect(rectangles.map((r) => r.args[5])).toEqual([0, 0.3]);
    for (const r of rectangles) expect(r.setStrokeStyle).toHaveBeenCalledWith(2, 0xb08bd6);
  });

  it('supports a pinned color/depth and destroys obsolete rectangles on redraw/hide', () => {
    const { overlay, rectangles } = overlayFixture({ color: 0xd8342c, depth: 4.5 });
    overlay.show([{ col: 1, row: 1, count: 1 }]);
    expect(rectangles[0].args[4]).toBe(0xd8342c);
    expect(rectangles[0].setDepth).toHaveBeenCalledWith(4.5);
    overlay.show([{ col: 2, row: 1, count: 2 }]);
    expect(rectangles[0].destroy).toHaveBeenCalledOnce();
    overlay.hide();
    expect(rectangles[1].destroy).toHaveBeenCalledOnce();
    expect(overlay.visible).toBe(false);
    expect(overlay.tiles).toEqual([]);
  });
});
