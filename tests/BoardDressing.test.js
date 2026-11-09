// The board's dressing (graphics pass, Nov 2026): range overlays drawn as regions, the
// walk ribbon, the board frame and the moving river. All presentation: each test names
// a way the drawing could go wrong or leak into the game.
import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../src/engine/Grid.js';
import { TILE_SIZE } from '../src/utils/constants.js';
import {
  planRange,
  planPath,
  dashSegments,
  lighten,
  RANGE_STYLE,
} from '../src/ui/rangeDressingModel.js';
import { RangeDressing, attachRangeDressing } from '../src/ui/RangeDressing.js';
import { planBoardFrame, FRAME_STYLE } from '../src/ui/boardFrameModel.js';
import { boardRect } from '../src/ui/BoardFrame.js';
import { collectWater, waterFrame, hash3 } from '../src/art/terrain/waterMotion.js';
import { renderBattlefieldTerrain } from '../src/art/terrain/index.js';
import { G } from '../src/art/terrain/biomes.js';
import { rampPosition } from '../src/art/terrain/palette.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');
const S = TILE_SIZE;
const centre = (col, row) => ({ x: col * S + S / 2, y: row * S + S / 2 });
const area = (list) => list.reduce((sum, [, , w, h]) => sum + w * h, 0);
const inside = ([x, y, w, h], box) =>
  x >= box.x && y >= box.y && x + w <= box.x + box.width && y + h <= box.y + box.height;

describe('planRange', () => {
  it('rims only the outside of a region: a 2x2 block has no rim on its shared edges', () => {
    const plan = planRange([centre(0, 0), centre(1, 0), centre(0, 1), centre(1, 1)], S);
    expect(plan.fills).toHaveLength(4);
    // Perimeter 8 tile edges, each one rim strip of S x rim.
    expect(plan.rims).toHaveLength(8);
    expect(area(plan.rims)).toBe(8 * S * RANGE_STYLE.rim);
    const box = { x: 0, y: 0, width: 2 * S, height: 2 * S };
    for (const rim of plan.rims) expect(inside(rim, box)).toBe(true);
    // Under-strokes sit just outside the region, never over its tiles.
    for (const under of plan.unders) expect(inside(under, box)).toBe(false);
    // One seam between each pair of neighbours (4 pairs).
    expect(plan.seams).toHaveLength(4);
  });

  it('joins the rim where the border turns into the region (an L has one corner block)', () => {
    const plan = planRange([centre(0, 0), centre(0, 1), centre(1, 1)], S);
    const blocks = plan.rims.filter(([, , w, h]) => w === RANGE_STYLE.rim && h === RANGE_STYLE.rim);
    expect(blocks).toHaveLength(1);
    // The inner corner is the top-right of tile (0,1).
    expect(blocks[0].slice(0, 2)).toEqual([S - RANGE_STYLE.rim, S]);
  });

  it('draws no rim round a quiet tile inside the region and washes it apart', () => {
    const ring = [];
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) if (c !== 1 || r !== 1) ring.push(centre(c, r));
    const holed = planRange(ring, S);
    const whole = planRange(ring, S, RANGE_STYLE, { quiet: [centre(1, 1)] });
    expect(holed.rims.length).toBeGreaterThan(whole.rims.length);
    expect(whole.rims).toHaveLength(12); // the 3x3 square's perimeter only
    expect(whole.quiets).toEqual([[S, S, S, S]]);
    expect(whole.fills).toHaveLength(8);
  });

  it('leaves the border beside another layer to that layer', () => {
    const alone = planRange([centre(1, 0)], S);
    const beside = planRange([centre(1, 0)], S, RANGE_STYLE, { beside: [centre(0, 0)] });
    expect(alone.rims).toHaveLength(4);
    expect(beside.rims).toHaveLength(3);
    expect(beside.fills).toHaveLength(1); // the other layer's tile is not filled here
    expect(beside.seams).toHaveLength(0); // nor seamed
  });

  it('ignores a duplicate tile', () => {
    expect(planRange([centre(2, 2), centre(2, 2)], S).fills).toHaveLength(1);
  });
});

describe('planPath', () => {
  it('has no ribbon for a path that goes nowhere', () => {
    expect(planPath([centre(0, 0)])).toBeNull();
    expect(planPath([])).toBeNull();
  });

  it('points the arrowhead along the last step, whichever way the path turns', () => {
    const cases = [
      [[centre(0, 0), centre(1, 0)], 1, 0],
      [[centre(1, 0), centre(0, 0)], -1, 0],
      [[centre(0, 0), centre(1, 0), centre(1, 1)], 0, 1],
      [[centre(0, 1), centre(0, 0)], 0, -1],
    ];
    for (const [points, dx, dy] of cases) {
      const plan = planPath(points);
      const end = points[points.length - 1];
      const [tip, a, b] = plan.head;
      const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(Math.sign(Math.round(tip.x - base.x))).toBe(dx);
      expect(Math.sign(Math.round(tip.y - base.y))).toBe(dy);
      // The tip stays inside the destination tile.
      expect(Math.abs(tip.x - end.x)).toBeLessThan(S / 2);
      expect(Math.abs(tip.y - end.y)).toBeLessThan(S / 2);
      // The ribbon starts on the unit's own tile.
      expect(plan.points[0]).toEqual(points[0]);
    }
  });
});

describe('dashSegments', () => {
  it('covers dash/(dash+gap) of a line and carries the pattern round a corner', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 45, y: 0 },
      { x: 45, y: 45 },
    ];
    const dashes = dashSegments(line, 5, 4);
    const drawn = dashes.reduce((sum, [x1, y1, x2, y2]) => sum + Math.hypot(x2 - x1, y2 - y1), 0);
    expect(drawn).toBeCloseTo(50, 5); // 90 px of line: ten whole 5 px dashes
    for (const [x1, y1, x2, y2] of dashes)
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThanOrEqual(5);
  });
});

describe('lighten', () => {
  it('moves each channel toward white and keeps black and white fixed points', () => {
    expect(lighten(0x000000, 0)).toBe(0x000000);
    expect(lighten(0x000000, 1)).toBe(0xffffff);
    expect(lighten(0x3366cc, 0.5)).toBe(0x99b3e6);
  });
});

// --- The drawing, against a fake scene -------------------------------------------------

function fakeScene({ reduceMotion = false, failGraphics = false } = {}) {
  const graphics = [];
  const tweens = [];
  const rect = (x, y, w, h, fill, alpha) => ({
    x,
    y,
    w,
    h,
    fill,
    alpha,
    destroyed: false,
    setAlpha(a) {
      this.alpha = a;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setDepth(d) {
      this.depth = d;
      return this;
    },
    destroy() {
      this.destroyed = true;
    },
  });
  const makeGraphics = () => {
    if (failGraphics) throw new Error('no graphics');
    const g = {
      rects: [],
      alpha: 1,
      destroyed: false,
      scene: true,
      setDepth(d) {
        this.depth = d;
        return this;
      },
      setAlpha(a) {
        this.alpha = a;
        return this;
      },
      fillStyle(color, alpha) {
        this.style = { color, alpha };
      },
      fillRect(x, y, w, h) {
        this.rects.push([x, y, w, h, this.style.color, this.style.alpha]);
      },
      lineStyle() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      strokePath() {},
      lineBetween() {},
      fillTriangle() {},
      fillCircle() {},
      destroy() {
        this.destroyed = true;
        this.scene = null;
      },
    };
    graphics.push(g);
    return g;
  };
  const stub = () => new Proxy({}, { get: () => () => stub() });
  return {
    graphics,
    cameras: { main: { width: 640, height: 480 } },
    registry: { get: () => ({ getReduceMotion: () => reduceMotion }) },
    add: { rectangle: rect, graphics: makeGraphics, image: stub, text: stub, container: stub },
    textures: { exists: () => false },
    tweens: {
      add: (cfg) => {
        const tween = { ...cfg, removed: false, remove: () => (tween.removed = true) };
        tweens.push(tween);
        return tween;
      },
      killTweensOf: () => {},
    },
    tweenLog: tweens,
  };
}

function makeGrid(scene, cols = 6, rows = 5) {
  const map = Array.from({ length: rows }, () => Array(cols).fill(PLAIN));
  return new Grid(scene, cols, rows, gameData.terrain, map, false);
}

/** A reach as Grid.computeMovementRange returns it: Map of "col,row" -> entry. */
function reach(entries) {
  return new Map(entries.map(([col, row, more = {}]) => [`${col},${row}`, { cost: 1, ...more }]));
}

describe('RangeDressing on a grid', () => {
  const RANGE = reach([
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3, { stoppable: false }],
    [1, 2],
  ]);

  it("keeps the grid's highlight list (count and positions) and hides those rectangles", () => {
    const plain = makeGrid(fakeScene());
    plain.showMovementRange(RANGE, 2, 2);
    const scene = fakeScene();
    const grid = makeGrid(scene);
    attachRangeDressing(scene, grid);
    grid.showMovementRange(RANGE, 2, 2);
    expect(grid.highlightTiles.map((h) => [h.x, h.y])).toEqual(
      plain.highlightTiles.map((h) => [h.x, h.y]),
    );
    expect(grid.highlightTiles).toHaveLength(3); // not the unit's tile, not the pass-through one
    for (const h of grid.highlightTiles) expect(h.alpha).toBe(0);
    for (const h of plain.highlightTiles) expect(h.alpha).toBe(0.4);
    // The region drawn covers the stoppable tiles in full and the two quiet ones thinly.
    const fill = scene.graphics[0];
    const washes = fill.rects.filter(([, , w, h]) => w === S && h === S);
    expect(washes.filter(([, , , , , a]) => a === RANGE_STYLE.fillAlpha)).toHaveLength(3);
    expect(washes.filter(([, , , , , a]) => a === RANGE_STYLE.quietAlpha)).toHaveLength(2);
  });

  it('removes every drawing when the highlights are cleared, and on a second selection', () => {
    const scene = fakeScene();
    const grid = makeGrid(scene);
    attachRangeDressing(scene, grid);
    grid.showMovementRange(RANGE, 2, 2);
    grid.showAttackRange([{ col: 4, row: 2 }]);
    grid.showMovementRange(RANGE, 2, 2); // reselect: the old move region must go
    expect(scene.graphics.filter((g) => !g.destroyed)).toHaveLength(4); // move + attack, 2 each
    grid.clearHighlights();
    grid.clearAttackHighlights();
    expect(scene.graphics.filter((g) => !g.destroyed)).toHaveLength(0);
    expect(grid.rangeDressing.layers.size).toBe(0);
    for (const t of scene.tweenLog) expect(t.removed).toBe(true);
  });

  it('does not animate under Reduce motion', () => {
    const scene = fakeScene({ reduceMotion: true });
    const grid = makeGrid(scene);
    attachRangeDressing(scene, grid);
    grid.showMovementRange(RANGE, 2, 2);
    expect(scene.tweenLog).toHaveLength(0);
    for (const g of scene.graphics) expect(g.alpha).toBe(1);
  });

  it('falls back to the plain rectangles when drawing fails', () => {
    const scene = fakeScene({ failGraphics: true });
    const grid = makeGrid(scene);
    grid.rangeDressing = new RangeDressing(scene);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    grid.showMovementRange(RANGE, 2, 2);
    grid.showPath([
      { col: 2, row: 2 },
      { col: 1, row: 2 },
    ]);
    warn.mockRestore();
    for (const h of grid.highlightTiles) expect(h.alpha).not.toBe(0);
    expect(grid.pathTiles).toHaveLength(1); // the old dot for the one step
  });

  it('draws the walk as one object the grid clears with its path', () => {
    const scene = fakeScene();
    const grid = makeGrid(scene);
    attachRangeDressing(scene, grid);
    grid.showPath([
      { col: 2, row: 2 },
      { col: 1, row: 2 },
      { col: 1, row: 1 },
    ]);
    grid.showSlidePath([
      { col: 1, row: 1 },
      { col: 1, row: 0 },
    ]);
    expect(grid.pathTiles).toHaveLength(2);
    const drawn = [...grid.pathTiles];
    grid.clearPath();
    expect(grid.pathTiles).toHaveLength(0);
    for (const g of drawn) expect(g.destroyed).toBe(true);
  });

  it('leaves the Warp guide (its own outlined squares) alone', () => {
    const scene = fakeScene();
    const grid = makeGrid(scene);
    attachRangeDressing(scene, grid);
    grid.showRelocateGuide({ col: 0, row: 0 }, [{ col: 1, row: 1 }], { reduceMotion: true });
    expect(scene.graphics).toHaveLength(0);
    expect(grid.attackHighlightTiles[0].alpha).toBe(0.35);
  });
});

describe('the board frame', () => {
  const rect = { x: 64, y: 32, width: 20 * S, height: 13 * S };
  const plan = planBoardFrame(rect);

  it('keeps the border and skirt off the map and the shade on it', () => {
    const overlaps = ([x, y, w, h]) =>
      x < rect.x + rect.width && x + w > rect.x && y < rect.y + rect.height && y + h > rect.y;
    for (const r of [...plan.border, ...plan.skirt]) expect(overlaps(r)).toBe(false);
    for (const r of plan.shade) expect(inside(r, rect)).toBe(true);
    expect(plan.skirt.length).toBeGreaterThan(0);
  });

  it('never reaches further than its skirt (the margin round a phone board is small)', () => {
    const reachOut = FRAME_STYLE.skirt + FRAME_STYLE.gap + 2 + FRAME_STYLE.cell;
    for (const [x, y, w, h] of [...plan.border, ...plan.skirt, ...plan.corners]) {
      expect(x).toBeGreaterThanOrEqual(rect.x - reachOut);
      expect(y).toBeGreaterThanOrEqual(rect.y - reachOut);
      expect(x + w).toBeLessThanOrEqual(rect.x + rect.width + reachOut);
      expect(y + h).toBeLessThanOrEqual(rect.y + rect.height + reachOut);
    }
  });

  it('shades the map lightly: the darkest step stays well short of hiding a tile edge', () => {
    for (const [, , , , , alpha] of plan.shade) expect(alpha).toBeLessThanOrEqual(0.35);
    // Each strip's distance in from the edge it lies along.
    const depth = Math.max(
      ...plan.shade.map(([x, y, w, h]) =>
        Math.min(x - rect.x, y - rect.y, rect.x + rect.width - x - w, rect.y + rect.height - y - h),
      ),
    );
    expect(depth).toBeLessThan(S / 4);
  });

  it('measures the board from the grid as drawn', () => {
    const grid = makeGrid(fakeScene(), 6, 5);
    const r = boardRect(grid);
    const first = grid.gridToPixel(0, 0);
    expect(r.x).toBe(first.x - S / 2);
    expect(r.y).toBe(first.y - S / 2);
    expect(r.width).toBe(6 * S);
    expect(r.height).toBe(5 * S);
  });
});

describe('moving water', () => {
  const names = [
    ['Plain', 'Water', 'Water', 'Water', 'Plain'],
    ['Plain', 'Water', 'Bridge', 'Water', 'Plain'],
    ['Plain', 'Water', 'Water', 'Water', 'Plain'],
    ['Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
  ];
  const state = renderBattlefieldTerrain({ names, biome: 'grassland', seed: 7 }).state;
  const water = collectWater(state);

  it('finds open water only: never land, never a bridge deck', () => {
    expect(water.count).toBeGreaterThan(500);
    for (let k = 0; k < water.count; k++) {
      const i = water.index[k];
      expect(state.mat[i]).toBe(G.WATER);
      expect(rampPosition(state.idx[i])[0]).toBe('tide');
    }
    // The bridge cell (col 2, row 1) keeps most of its pixels out of the list.
    const cell = 24;
    let onBridge = 0;
    for (let k = 0; k < water.count; k++)
      if (Math.floor(water.x[k] / cell) === 2 && Math.floor(water.y[k] / cell) === 1) onBridge++;
    expect(onBridge).toBeLessThan((cell * cell) / 2);
  });

  it('writes only water pixels, moves with time, and repeats exactly for the same time', () => {
    const frame = (t) => {
      const out = new Uint32Array(state.W * state.H);
      const lit = waterFrame(water, out, t);
      return { out, lit };
    };
    const a = frame(1000);
    const again = frame(1000);
    const later = frame(3000);
    expect(a.lit).toBeGreaterThan(0);
    expect(Array.from(a.out)).toEqual(Array.from(again.out));
    expect(Array.from(a.out)).not.toEqual(Array.from(later.out));
    const isWater = new Uint8Array(state.W * state.H);
    for (let k = 0; k < water.count; k++) isWater[water.index[k]] = 1;
    for (let i = 0; i < a.out.length; i++) if (a.out[i]) expect(isWater[i]).toBe(1);
    // Mostly still water: the streaks and foam are an accent, not a repaint.
    expect(a.lit / water.count).toBeLessThan(0.25);
  });

  it('clears a pixel it lit once the streak has passed', () => {
    const out = new Uint32Array(state.W * state.H);
    waterFrame(water, out, 0);
    const before = out.slice();
    waterFrame(water, out, 5000);
    const fresh = new Uint32Array(state.W * state.H);
    waterFrame(water, fresh, 5000);
    expect(Array.from(out)).toEqual(Array.from(fresh));
    expect(Array.from(out)).not.toEqual(Array.from(before));
  });

  it('never draws from Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    waterFrame(collectWater(state), new Uint32Array(state.W * state.H), 1234);
    hash3(1, 2, 3);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
