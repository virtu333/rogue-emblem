// RemainsMarkerController: the bone pile and countdown drawn for Zombie remains.
// Rendering only, re-derived from scene._zombieTombstones and the fog. Ways it breaks:
//   - drawn in the wrong cell on the turned (portrait) board
//   - drawn for remains the player never saw (a fall in the fog), or lost once the
//     seen pile's tile goes back into fog
//   - the countdown shows a stale number, or a dropped / smashed record keeps its pile
//   - drawn above the fog (it would show through) or under the terrain
//   - "1" does not stand out (red, pulsing unless motion is reduced)
import { describe, expect, it, vi } from 'vitest';
import {
  REMAINS_MARKER_DEPTH,
  RemainsMarkerController,
} from '../src/ui/RemainsMarkerController.js';
import { createRemains } from '../src/engine/ZombieRemains.js';
import { createBoardTransform } from '../src/utils/boardOrientation.js';
import { UI_PALETTE } from '../src/utils/uiStyles.js';
import { TILE_SIZE } from '../src/utils/constants.js';

const FOG_DEPTH = 3; // Grid.initFogOverlays
const TERRAIN_DEPTH = 0;

function object(kind, extra = {}) {
  const obj = { kind, depth: 0, destroyed: false, ...extra };
  obj.setDepth = vi.fn((d) => {
    obj.depth = d;
    return obj;
  });
  obj.setOrigin = vi.fn(() => obj);
  obj.destroy = vi.fn(() => (obj.destroyed = true));
  for (const m of [
    'fillStyle',
    'fillCircle',
    'fillRect',
    'lineStyle',
    'lineBetween',
    'strokeCircle',
  ])
    obj[m] = vi.fn(() => obj);
  return obj;
}

// A board like Grid's: offsets, the presentation transform, and gridToPixel's formula.
function board({ cols = 10, rows = 8, rotation = 'none', visible = () => true } = {}) {
  const transform = createBoardTransform(cols, rows, rotation);
  const offsetX = 20;
  const offsetY = 40;
  return {
    fogEnabled: true,
    isVisible: visible,
    gridToPixel(col, row) {
      const cell = transform.toDisplay(col, row);
      return {
        x: offsetX + cell.col * TILE_SIZE + TILE_SIZE / 2,
        y: offsetY + cell.row * TILE_SIZE + TILE_SIZE / 2,
      };
    },
  };
}

function scene(records, grid = board(), { reduceMotion = false } = {}) {
  const made = [];
  const add = (kind) => (x, y, text, style) => {
    const o = object(kind, { x, y, text, style });
    made.push(o);
    return o;
  };
  return {
    made,
    _zombieTombstones: records,
    grid,
    add: { graphics: add('graphics'), text: add('text') },
    tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    _reduceMotion: () => reduceMotion,
  };
}

const unit = {
  className: 'Zombie',
  level: 3,
  stats: { HP: 20, MOV: 4 },
  skills: [],
  inventory: [],
  weapon: null,
};
const remains = (col, row, turnsRemaining = 3, seen = true) => ({
  ...createRemains(unit, { col, row }, { seen }),
  turnsRemaining,
});
const live = (s) => s.made.filter((o) => !o.destroyed);
const countdowns = (s) => live(s).filter((o) => o.kind === 'text');

describe('RemainsMarkerController', () => {
  it('on the portrait board (ccw) a pile at game (0,0) is drawn in the bottom-left cell', () => {
    // ccw: "the left edge (col 0) is drawn at the bottom; row 0 becomes the left edge".
    // 10 cols x 8 rows turns into 8 display cols x 10 display rows: (0,0) -> display (0, 9).
    const s = scene([remains(0, 0)], board({ rotation: 'ccw' }));
    const ctrl = new RemainsMarkerController(s).create();
    expect(ctrl.shown).toEqual([
      { col: 0, row: 0, turnsRemaining: 3, count: 1, x: 20 + 16, y: 40 + 9 * 32 + 16 },
    ]);
    // The badge sits in the same cell (top-right corner), not in the unturned one.
    const [label] = countdowns(s);
    expect(label.x).toBeGreaterThan(20 + 16);
    expect(label.x).toBeLessThan(20 + 32);
    expect(label.y).toBeGreaterThan(40 + 9 * 32);
    expect(label.y).toBeLessThan(40 + 9 * 32 + 16);
  });

  it('draws nothing for remains that fell unseen in the fog, and keeps a seen pile in fog', () => {
    const inSight = new Set(['2,2']);
    const s = scene(
      [remains(2, 2, 3, false), remains(6, 6, 3, false), remains(7, 1, 2, true)],
      board({ visible: (c, r) => inSight.has(`${c},${r}`) }),
    );
    const ctrl = new RemainsMarkerController(s).create();
    expect(ctrl.shown.map((m) => [m.col, m.row])).toEqual([
      [2, 2],
      [7, 1],
    ]);
    // (2,2) goes into fog before anyone marked it seen: its pile goes with it.
    inSight.clear();
    ctrl.sync();
    expect(ctrl.shown.map((m) => [m.col, m.row])).toEqual([[7, 1]]);
  });

  it('sits above the terrain and below the fog', () => {
    const s = scene([remains(3, 3)]);
    new RemainsMarkerController(s).create();
    for (const o of live(s)) {
      expect(o.depth).toBeGreaterThan(TERRAIN_DEPTH);
      expect(o.depth).toBeLessThan(FOG_DEPTH);
    }
    expect(REMAINS_MARKER_DEPTH).toBeLessThan(FOG_DEPTH);
  });

  it('follows the records: the count ticks down, a smashed or dropped record leaves no pile', () => {
    const s = scene([remains(3, 3, 3), remains(5, 5, 2)]);
    const ctrl = new RemainsMarkerController(s).create();
    expect(countdowns(s).map((t) => t.text)).toEqual(['3', '2']);
    s._zombieTombstones = s._zombieTombstones.map((r) => ({
      ...r,
      turnsRemaining: r.turnsRemaining - 1,
    }));
    ctrl.sync();
    expect(countdowns(s).map((t) => t.text)).toEqual(['2', '1']);
    s._zombieTombstones = [s._zombieTombstones[0]];
    ctrl.sync();
    expect(ctrl.shown.map((m) => [m.col, m.row])).toEqual([[3, 3]]);
    expect(countdowns(s).map((t) => t.text)).toEqual(['2']);
    s._zombieTombstones = [];
    ctrl.sync();
    expect(live(s)).toEqual([]);
  });

  it('"1" is red and pulses; with reduced motion it stays red and still', () => {
    const s = scene([remains(3, 3, 1), remains(4, 4, 2)]);
    new RemainsMarkerController(s).create();
    const [one, two] = countdowns(s);
    expect(one.style.color).toBe(UI_PALETTE.alarm);
    expect(two.style.color).not.toBe(UI_PALETTE.alarm);
    expect(s.tweens.add).toHaveBeenCalledTimes(1);
    expect(s.tweens.add.mock.calls[0][0].targets).toContain(one);

    const calm = scene([remains(3, 3, 1)], board(), { reduceMotion: true });
    new RemainsMarkerController(calm).create();
    expect(countdowns(calm)[0].style.color).toBe(UI_PALETTE.alarm);
    expect(calm.tweens.add).not.toHaveBeenCalled();
  });

  it('two records on one tile: one pile showing the sooner rise', () => {
    const s = scene([remains(3, 3, 3), remains(3, 3, 1)]);
    const ctrl = new RemainsMarkerController(s).create();
    expect(ctrl.shown).toHaveLength(1);
    expect(countdowns(s).map((t) => t.text)).toEqual(['1']);
  });

  it('destroy removes everything it drew', () => {
    const s = scene([remains(3, 3)]);
    const ctrl = new RemainsMarkerController(s).create();
    ctrl.destroy();
    expect(live(s)).toEqual([]);
  });
});
