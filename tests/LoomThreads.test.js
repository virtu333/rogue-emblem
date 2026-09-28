import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { drawLoomFx, drawLoomWeave, samplePath } from '../src/art/loom/loomThreads.js';
import { buildLoomModel, layoutLoom } from '../src/ui/loomModel.js';

// The Loom's canvas painter, driven through a recording 2D context (no browser). The
// horizontal weave is pinned to its exact call log so landscape and desktop cannot drift;
// the vertical (portrait) weave is checked for what a player sees: warp threads that
// run upward, numerals beside their rows, the dark and the dissolve ahead of the party.

const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

function recorder() {
  const log = [];
  const texts = [];
  const lines = [];
  let path = [];
  const gradient = (kind, args) => {
    log.push([kind, ...args.map(round)]);
    return { addColorStop: (o, c) => log.push(['stop', round(o), c]) };
  };
  const state = {};
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (key in state) return state[key];
        if (key === 'createRadialGradient') return (...a) => gradient('radial', a);
        if (key === 'createLinearGradient') return (...a) => gradient('linear', a);
        if (key === 'drawImage')
          return (img, ...rest) => log.push(['drawImage', img.__hash, ...rest.map(round)]);
        if (key === 'fillText')
          return (text, x, y) => {
            texts.push({ text, x, y, align: state.textAlign, baseline: state.textBaseline });
            log.push(['fillText', text, round(x), round(y)]);
          };
        if (key === 'beginPath')
          return () => {
            path = [];
            log.push(['beginPath']);
          };
        if (key === 'moveTo' || key === 'lineTo')
          return (x, y) => {
            path.push({ x, y, op: key });
            log.push([key, round(x), round(y)]);
          };
        if (key === 'stroke')
          return () => {
            lines.push({ pts: path, dash: state.__dash || [], style: state.strokeStyle });
            log.push(['stroke']);
          };
        if (key === 'setLineDash')
          return (d) => {
            state.__dash = d;
            log.push(['setLineDash', ...d]);
          };
        return (...args) => log.push([key, ...args.map(round)]);
      },
      set(_, key, value) {
        state[key] = value;
        log.push(['set', key, round(value)]);
        return true;
      },
    },
  );
  return { ctx, log, texts, lines };
}

// pixelLayer() paints dithers into an offscreen canvas; hash what it painted.
function fakeCanvas() {
  const canvas = { width: 0, height: 0, __hash: null };
  canvas.getContext = () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (img) => {
      canvas.__hash = createHash('sha1').update(img.data).digest('hex').slice(0, 16);
      canvas.__data = img.data;
    },
  });
  return canvas;
}

let savedDocument;
beforeAll(() => {
  savedDocument = globalThis.document;
  globalThis.document = { createElement: () => fakeCanvas() };
});
afterAll(() => {
  globalThis.document = savedDocument;
});

// A small act: rows 0..5, a fork at row 1, the party on row 1, choices on row 2,
// a boss on row 5.
function actNodes() {
  const spec = [
    ['a0', 0, 2, ['b1', 'b3']],
    ['b1', 1, 1, ['c1', 'c2']],
    ['b3', 1, 3, ['c3']],
    ['c1', 2, 0, ['d2']],
    ['c2', 2, 2, ['d2']],
    ['c3', 2, 4, ['d2']],
    ['d2', 3, 2, ['e2']],
    ['e2', 4, 2, ['f2']],
    ['f2', 5, 2, []],
  ];
  return spec.map(([id, row, col, edges]) => ({
    id,
    row,
    col,
    edges,
    type: id === 'f2' ? 'boss' : 'battle',
    completed: id === 'a0' || id === 'b1',
    battleParams: { objective: 'rout', isElite: id === 'c2' || undefined },
  }));
}

function paint(axis, { width, height, eclipse = null } = {}) {
  const nodes = actNodes();
  const model = buildLoomModel({
    nodes,
    startNodeId: 'a0',
    availableIds: ['c1', 'c2'],
    currentId: 'b1',
  });
  const layout = layoutLoom({ rows: model.rows, width, height, medal: 36, axis });
  const positions = new Map(nodes.map((n) => [n.id, layout.pos(n.row, n.col)]));
  layout.positions = positions;
  const rec = recorder();
  const woven = drawLoomWeave(rec.ctx, {
    model,
    layout,
    positions,
    seed: 7,
    fontReady: true,
    eclipse,
  });
  return { ...rec, model, layout, positions, woven, nodes };
}

const ECLIPSE = {
  laneDarkness: [0.9, 0.2, 0, 0, 0.6],
  eclipsedIds: new Set(['e2']),
  phaseIndex: 1,
};

describe('Loom weave: horizontal is unchanged', () => {
  it('paints the exact call log it painted before the vertical loom existed', () => {
    const plain = paint('horizontal', { width: 420, height: 300 });
    const dark = paint('horizontal', { width: 420, height: 300, eclipse: ECLIPSE });
    const digest = (log) =>
      createHash('sha1').update(JSON.stringify(log)).digest('hex').slice(0, 16);
    const fx = recorder();
    drawLoomFx(fx.ctx, {
      model: plain.model,
      layout: plain.layout,
      paths: plain.woven.paths,
      leadPts: plain.woven.leadPts,
      selectedId: 'd2',
      timeMs: 1234,
      falls: [{ id: 'e2', start: 1000 }],
    });
    // Golden digests recorded from the pre-portrait renderer (origin/main 1dfd3ee9).
    expect({ plain: digest(plain.log), eclipse: digest(dark.log), fx: digest(fx.log) }).toEqual({
      plain: 'b1b495771c5da40a',
      eclipse: 'c99c9dd8f8bd81d0',
      fx: '5703e7b6e2ae06d7',
    });
  });
});

describe('Loom weave: vertical (portrait)', () => {
  const W = 366;
  const H = 520;

  it('warp threads run bottom to top, one per lane, left to right', () => {
    const { lines, layout } = paint('vertical', { width: W, height: H });
    const warp = lines.filter((l) => l.dash.join() === '3,2');
    expect(warp).toHaveLength(5);
    const xs = warp.map((l) => l.pts[0].x);
    for (const l of warp) {
      expect(l.pts[0].x).toBe(l.pts[1].x); // vertical
      expect(Math.abs(l.pts[1].y - l.pts[0].y)).toBeGreaterThan(layout.innerH * 0.9);
    }
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (let lane = 0; lane < 5; lane++)
      expect(Math.abs(xs[lane] - layout.lane(lane))).toBeLessThanOrEqual(1);
  });

  it('row numerals sit beside their rows, left of the first lane, row I lowest', () => {
    const { texts, layout } = paint('vertical', { width: W, height: H });
    const numerals = texts.filter((t) => /^[IVX]+$/.test(t.text));
    expect(numerals.map((t) => t.text)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI']);
    for (let r = 0; r < numerals.length; r++) {
      const t = numerals[r];
      expect(Math.abs(t.y - layout.row(r))).toBeLessThanOrEqual(1);
      // The numeral (up to 4 pixel glyphs, 8px each) ends before the first medal.
      const right = t.align === 'right' ? t.x : t.align === 'center' ? t.x + 16 : t.x + 32;
      expect(right).toBeLessThanOrEqual(layout.lane(0) - layout.medal / 2);
      expect(t.x).toBeGreaterThanOrEqual(0);
    }
    for (let r = 1; r < numerals.length; r++) expect(numerals[r].y).toBeLessThan(numerals[r - 1].y);
  });

  it('threads leave the lower knot and arrive at the upper one, mostly upright at both ends', () => {
    const { woven, positions } = paint('vertical', { width: W, height: H });
    const pts = woven.paths.get('b1>c2');
    const a = positions.get('b1');
    const b = positions.get('c2');
    expect(b.y).toBeLessThan(a.y);
    expect(pts[0].y).toBeLessThan(a.y);
    expect(pts[pts.length - 1].y).toBeGreaterThan(b.y);
    for (const p of [pts[0], pts[pts.length - 1]])
      expect(Math.abs(p.ty)).toBeGreaterThan(Math.abs(p.tx));
    // Monotonic climb: a vertical S-curve never doubles back.
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeLessThan(pts[i - 1].y);
  });

  it('the lead thread enters from below the loom into the first knot', () => {
    const { woven, positions, layout } = paint('vertical', { width: W, height: H });
    const start = positions.get('a0');
    const first = woven.leadPts[0];
    expect(first.y).toBeGreaterThan(layout.innerH - 1);
    expect(Math.abs(first.x - start.x)).toBeLessThan(1);
    expect(woven.leadPts.at(-1).y).toBeGreaterThan(start.y);
  });

  it('the far end dissolves toward the top, never over the party below', () => {
    const { log, layout, model } = paint('vertical', { width: W, height: H });
    // The dissolve's soft gradient runs upward from past the dissolve row.
    const y0 = layout.row(model.dissolveRow) + layout.rowStep * 0.5;
    const grads = log.filter((c) => c[0] === 'linear');
    expect(grads).toContainEqual(['linear', 0, round(Math.min(layout.innerH, y0)), 0, 0]);
  });

  it('the Eclipse darkens ahead of the party, strongest at the fallen outer lanes', () => {
    const { layout, model } = paint('vertical', { width: W, height: H, eclipse: ECLIPSE });
    // Re-run just the under-pass to read its pixels.
    let dither = null;
    const orig = globalThis.document.createElement;
    const canvases = [];
    globalThis.document.createElement = () => {
      const c = fakeCanvas();
      canvases.push(c);
      return c;
    };
    const again = paint('vertical', { width: W, height: H, eclipse: ECLIPSE });
    globalThis.document.createElement = orig;
    expect(again.layout.innerH).toBe(layout.innerH);
    // canvases: [grain, laneDark(under), dissolve, laneDark(over)]
    dither = canvases[1];
    const w = Math.ceil(layout.innerW);
    const inked = (x, y) => dither.__data[(Math.round(y) * w + Math.round(x)) * 4 + 3] > 0;
    const count = (x0, x1, y0, y1) => {
      let n = 0;
      for (let y = Math.max(0, Math.floor(y0)); y < y1; y++)
        for (let x = Math.max(0, Math.floor(x0)); x < x1; x++) if (inked(x, y)) n++;
      return n;
    };
    const front = layout.row(Math.max(0, model.frontierRow));
    const ahead = layout.row(model.frontierRow + 3);
    const band = (lane) =>
      count(layout.lane(lane) - 10, layout.lane(lane) + 10, ahead - 20, ahead + 20);
    // Lane I (0.9) is darker than lane V (0.6), which is darker than the untouched centre.
    expect(band(0)).toBeGreaterThan(band(4));
    expect(band(4)).toBeGreaterThan(band(2));
    expect(band(2)).toBe(0);
    // Nothing behind (below) the party's row.
    expect(count(0, w, front + layout.rowStep * 0.5, layout.innerH)).toBe(0);
  });

  it('samplePath keeps its horizontal default', () => {
    const h = samplePath({ x: 0, y: 0 }, { x: 100, y: 40 }, 5, 5);
    expect(Math.abs(h[0].tx)).toBeGreaterThan(0.9);
    const v = samplePath({ x: 0, y: 100 }, { x: 40, y: 0 }, 5, 5, 64, 'vertical');
    expect(Math.abs(v[0].ty)).toBeGreaterThan(0.9);
  });

  it('the fx layer clears the whole scrolled weave', () => {
    const { model, layout, woven } = paint('vertical', { width: W, height: 300 });
    const rec = recorder();
    drawLoomFx(rec.ctx, { model, layout, paths: woven.paths, leadPts: woven.leadPts });
    expect(rec.log).toContainEqual(['clearRect', 0, 0, layout.innerW, layout.innerH]);
    expect(layout.innerH).toBeGreaterThan(300);
  });
});
