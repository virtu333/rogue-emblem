import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import {
  DangerZoneOverlay,
  dangerEdges,
  dangerTier,
  hatchSegments,
} from '../src/ui/DangerZoneOverlay.js';
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
  const layers = [];
  const makeGraphics = () => {
    const g = {
      calls: [],
      setDepth: vi.fn(function (d) {
        g.depth = d;
        return g;
      }),
      fillStyle: vi.fn((c, a) => g.calls.push(['fillStyle', c, a])),
      fillRect: vi.fn((...a) => g.calls.push(['fillRect', ...a])),
      lineStyle: vi.fn((w, c, a) => g.calls.push(['lineStyle', w, c, a])),
      lineBetween: vi.fn((...a) => g.calls.push(['line', ...a])),
      strokeRect: vi.fn((...a) => g.calls.push(['strokeRect', ...a])),
      clear: vi.fn(() => (g.calls = [])),
      destroy: vi.fn(),
    };
    layers.push(g);
    return g;
  };
  const scene = { add: { graphics: vi.fn(makeGraphics) } };
  const grid = { gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }) };
  return { overlay: new DangerZoneOverlay(scene, grid, options), layers };
}
describe('danger rendering', () => {
  it('steps fill alpha and hatch density at 1, 2 and 3+ damage sources without RNG', () => {
    const { overlay, layers } = overlayFixture();
    overlay.show([1, 2, 3, 5].map((count, col) => ({ col, row: 0, count, damageThreat: true })));
    expect(overlay.tiles.map((t) => t.tier)).toEqual([1, 2, 3, 3]);
    expect(overlay.tiles.map((t) => t.fillAlpha)).toEqual([0.2, 0.3, 0.4, 0.4]);
    const [fill, edge] = layers;
    expect(fill.depth).toBe(4);
    // Edges draw above move/attack ranges (depth 5).
    expect(edge.depth).toBeGreaterThan(5);
    expect(fill.calls.filter((c) => c[0] === 'fillStyle').every((c) => c[1] === 0xc8322c)).toBe(
      true,
    );
    // Denser hatch at 2, cross-hatch (both diagonals) at 3+.
    const perTile = (col) => hatchSegments(col * 32, 0, 32, overlay.tiles[col].tier).length;
    expect(perTile(1)).toBeGreaterThan(perTile(0));
    expect(perTile(2)).toBeGreaterThan(perTile(0));
  });

  it('outlines only the outer boundary of the zone', () => {
    const edges = dangerEdges([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    // A 2x1 block has 6 unit edges: top x2, bottom x2, left, right.
    expect(edges).toHaveLength(6);
    expect(edges.some((e) => e.x1 === 1 && e.x2 === 1)).toBe(false);
  });

  it('keeps hatch stripes world-aligned so they continue across neighbouring tiles', () => {
    const a = hatchSegments(0, 0, 32, 1);
    const b = hatchSegments(32, 0, 32, 1);
    const sums = (segs) => new Set(segs.map((s) => Math.round(s.x1 + s.y1) % 8));
    expect([...sums(a)]).toEqual([0]);
    expect([...sums(b)]).toEqual([0]);
  });

  it('preserves the violet outline with no fill for status-only threat', () => {
    const { overlay, layers } = overlayFixture();
    overlay.show([
      { col: 1, row: 1, count: 0, statusThreat: true, damageThreat: false },
      { col: 2, row: 1, count: 2, statusThreat: true, damageThreat: true },
    ]);
    expect(overlay.tiles.map((t) => t.fillAlpha)).toEqual([0, 0.3]);
    expect(dangerTier({ count: 0, statusThreat: true, damageThreat: false })).toBe(0);
    const strokes = layers[1].calls.filter((c) => c[0] === 'strokeRect');
    expect(strokes).toHaveLength(2);
  });

  it('supports pinned/focus variants and clears on redraw/hide', () => {
    const { overlay, layers } = overlayFixture({ color: 0xd8342c, depth: 4.5, variant: 'pinned' });
    overlay.show([{ col: 1, row: 1, count: 1 }]);
    expect(layers[0].depth).toBe(4.5);
    expect(layers[0].calls.find((c) => c[0] === 'fillStyle')[1]).toBe(0xd8342c);
    // Pinned ranges are solid (no hatch lines on the fill layer).
    expect(layers[0].calls.some((c) => c[0] === 'line')).toBe(false);
    overlay.show([{ col: 2, row: 1, count: 2 }]);
    expect(layers[0].clear).toHaveBeenCalled();
    overlay.hide();
    expect(overlay.visible).toBe(false);
    expect(overlay.tiles).toEqual([]);
    overlay.destroy();
    expect(layers[0].destroy).toHaveBeenCalledOnce();
  });
});
