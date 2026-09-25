import { describe, it, expect, vi } from 'vitest';
import {
  renderBattlefieldTerrain,
  repaintCells,
  syncTerrainLayout,
  createTerrainJob,
  namesFromLayout,
  buildCellObject,
  OBJECT_LIMITS,
  PALETTE,
  PALETTE_SIZE,
  PAINTED_TERRAIN,
  BIOME_NAMES,
  ART_CELL,
  TerrainState,
  collectShimmer,
  shimmerFrame,
} from '../src/art/terrain/index.js';
import { renderAll } from '../src/art/terrain/pipeline.js';
import { renderTerrainSliced, packResult, unpackResult } from '../src/art/terrain/async.js';
import { warmTerrainRenderer, createShimmerOverlay } from '../src/art/terrain/canvas.js';
import { G, groundOf, HARD } from '../src/art/terrain/biomes.js';
import { massifPlan } from '../src/art/terrain/mountains.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { mulberry32 } from '../src/art/terrain/noise.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const TERRAIN_NAMES = data.terrain.map((t) => t.name);

function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Random layout mixing every terrain type (with some clustering). */
function randomNames(cols, rows, seed, pool = TERRAIN_NAMES) {
  const rnd = mulberry32(seed);
  const names = [];
  for (let r = 0; r < rows; r++) {
    names.push([]);
    for (let c = 0; c < cols; c++) {
      const prev = c > 0 && rnd() < 0.35 ? names[r][c - 1] : null;
      const above = r > 0 && rnd() < 0.3 ? names[r - 1][c] : null;
      names[r].push(prev || above || pool[Math.floor(rnd() * pool.length)]);
    }
  }
  return names;
}

function render(names, biome, seed = 11, cellPx = 48) {
  return renderBattlefieldTerrain({ names, biome, seed, cellPx });
}

function seededBattle(params, seed) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return generateBattle({ difficultyId: 'hard', ...params }, data);
  } finally {
    Math.random = original;
  }
}

describe('procedural terrain: determinism and output', { timeout: 60000 }, () => {
  it('same seed and layout give identical pixels; another seed differs', () => {
    const names = randomNames(9, 7, 3);
    const a = render(names, 'grassland', 5);
    const b = render(
      names.map((r) => [...r]),
      'grassland',
      5,
    );
    const c = render(names, 'grassland', 6);
    expect(a.width).toBe(9 * 48);
    expect(a.height).toBe(7 * 48);
    expect(a.pixels.length).toBe(a.width * a.height * 4);
    expect(fnv(a.pixels)).toBe(fnv(b.pixels));
    expect(fnv(a.pixels)).not.toBe(fnv(c.pixels));
  });

  it('pins a snapshot hash per biome (update deliberately when the art changes)', () => {
    const names = randomNames(8, 6, 99);
    const hashes = Object.fromEntries(
      BIOME_NAMES.map((b) => [b, fnv(render(names, b, 1234).state.idx)]),
    );
    expect(new Set(Object.values(hashes)).size).toBe(BIOME_NAMES.length);
    expect(hashes).toMatchSnapshot();
  });

  it('never consumes Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      render(randomNames(6, 5, 8), 'swamp', 3);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts Grid-style mapLayout + terrainData, a null biome and string seeds', () => {
    const cfg = seededBattle({ act: 'act1', objective: 'rout' }, 7);
    const a = renderBattlefieldTerrain({
      mapLayout: cfg.mapLayout,
      terrainData: data.terrain,
      biome: null,
      seed: 'node-3-2',
    });
    const b = renderBattlefieldTerrain({
      names: namesFromLayout(cfg.mapLayout, data.terrain),
      biome: 'grassland',
      seed: 'node-3-2',
    });
    expect(a.biome).toBe('grassland');
    expect(fnv(a.pixels)).toBe(fnv(b.pixels));
  });

  it('scales by whole pixels for any cellPx that is a multiple of 24', () => {
    const names = randomNames(4, 3, 12);
    const small = render(names, 'grassland', 2, 24);
    const big = render(names, 'grassland', 2, 72);
    expect(big.width).toBe(small.width * 3);
    for (const [x, y] of [
      [0, 0],
      [17, 40],
      [95, 71],
    ]) {
      const s = (y * small.width + x) * 4;
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
          const d = ((y * 3 + dy) * big.width + x * 3 + dx) * 4;
          expect([...big.pixels.slice(d, d + 4)]).toEqual([...small.pixels.slice(s, s + 4)]);
        }
    }
    expect(() => render(names, 'grassland', 2, 32)).toThrow(/multiple of 24/);
  });

  it('a banded (time-sliced) render equals a one-shot render', () => {
    const names = randomNames(7, 9, 21);
    const job = createTerrainJob({ names, biome: 'volcano', seed: 4 });
    let steps = 0;
    for (const step of job.steps(1)) steps += step ? 1 : 0;
    expect(steps).toBeGreaterThan(9 * 5);
    const banded = job.finish();
    const whole = render(names, 'volcano', 4);
    expect(fnv(banded.pixels)).toBe(fnv(whole.pixels));
  });
});

describe('procedural terrain: coverage', { timeout: 120000 }, () => {
  it('has a painter for every terrain in data/terrain.json', () => {
    for (const name of TERRAIN_NAMES) expect(PAINTED_TERRAIN, name).toContain(name);
  });

  it.each(BIOME_NAMES)('renders every terrain type in the %s biome without throwing', (biome) => {
    // each terrain alone, as a block, and mixed with everything else
    for (const name of [...TERRAIN_NAMES, 'River', 'Unknown Terrain']) {
      const names = [
        ['Plain', name, 'Plain', name],
        [name, name, 'Water', name],
        ['Plain', name, 'Wall', 'Floor'],
      ];
      const res = render(names, biome, 3);
      expect(res.pixels.length).toBe(4 * 3 * 48 * 48 * 4);
    }
    render(randomNames(10, 8, biome.length * 7), biome, 9);
  });

  it('renders real MapGenerator battles for every template (including the void arena)', () => {
    const biomes = new Set();
    let rendered = 0;
    for (const [objective, list] of Object.entries(data.mapTemplates))
      for (const [k, t] of list.entries()) {
        const cfg = seededBattle(
          { act: t.acts?.[0] || 'act2', objective, templateId: t.id },
          100 + k,
        );
        expect(cfg.templateId).toBe(t.id);
        const res = renderBattlefieldTerrain({
          mapLayout: cfg.mapLayout,
          terrainData: data.terrain,
          biome: cfg.biome,
          seed: k,
        });
        expect(res.width).toBe(cfg.cols * 48);
        expect(res.height).toBe(cfg.rows * 48);
        biomes.add(res.biome);
        rendered++;
      }
    expect(rendered).toBe(Object.values(data.mapTemplates).flat().length);
    expect([...biomes].sort()).toEqual([...BIOME_NAMES].sort());
  });

  it('only ever writes palette colours (index and RGBA)', () => {
    const lut = new Set(PALETTE.map(([r, g, b]) => (r << 16) | (g << 8) | b));
    for (const biome of BIOME_NAMES) {
      const res = render(randomNames(9, 7, biome.length * 13), biome, 77);
      expect(Math.max(...res.state.idx)).toBeLessThan(PALETTE_SIZE);
      const px = res.pixels;
      for (let i = 0; i < px.length; i += 4) {
        if (!lut.has((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]) || px[i + 3] !== 255)
          throw new Error(`off-palette pixel in ${biome} at ${i / 4}`);
      }
    }
  });
});

describe('procedural terrain: objects fit their cells (owner rule)', { timeout: 120000 }, () => {
  const objectTerrain = ['Forest', 'Mountain', 'Fort', 'Village', 'Throne', 'Ballista', 'Pillar'];

  /** Layout that clusters `pool` names, so every cell sees lone, edge and interior cases. */
  function clustered(cols, rows, seed, pool) {
    const rnd = mulberry32(seed);
    return Array.from({ length: rows }, () => []).map((row, r, all) => {
      for (let c = 0; c < cols; c++) {
        const prev = c > 0 && rnd() < 0.45 ? row[c - 1] : null;
        const above = r > 0 && rnd() < 0.4 ? all[r - 1][c] : null;
        row.push(prev || above || pool[Math.floor(rnd() * pool.length)]);
      }
      return row;
    });
  }

  function checkFit(S, c, r, label) {
    const o = buildCellObject(S, c, r);
    if (!o) return 0;
    const lim = OBJECT_LIMITS[o.sprite.kind];
    const x0 = c * ART_CELL - lim.left,
      x1 = (c + 1) * ART_CELL + lim.right,
      y0 = r * ART_CELL - lim.top,
      y1 = (r + 1) * ART_CELL + lim.bottom;
    let n = 0;
    o.sprite.forEach((x, y) => {
      n++;
      if (x < x0 || x >= x1 || y < y0 || y >= y1)
        throw new Error(`${label} (${c},${r}) pixel ${x},${y} outside its cell`);
    });
    expect(n, label).toBeGreaterThan(20);
    // Shapes are planned to fit; the clip is only a safety net.
    expect(o.sprite.clipped / n, `${label} clipped`).toBeLessThan(0.04);
    return 1;
  }

  it('every opaque object pixel stays within the allowed overhang of its own cell', () => {
    let checked = 0;
    for (const biome of BIOME_NAMES)
      for (const name of objectTerrain)
        for (let seed = 1; seed <= 6; seed++) {
          // a uniform block (interior + edges) ...
          const names = Array.from({ length: 5 }, () => Array(6).fill(name));
          const S = new TerrainState({ names, biome, seed: seed * 7919 });
          for (let r = 0; r < 5; r++)
            for (let c = 0; c < 6; c++) checked += checkFit(S, c, r, `${biome} ${name}`);
        }
    expect(checked).toBe(BIOME_NAMES.length * objectTerrain.length * 6 * 30);
    // ... and mixed layouts (lone cells, ranges, forest edges, neighbours of every kind)
    for (const biome of BIOME_NAMES)
      for (let seed = 1; seed <= 4; seed++) {
        const names = clustered(9, 7, seed * 31 + biome.length, [
          'Plain',
          'Forest',
          'Forest',
          'Mountain',
          'Mountain',
          'Pillar',
          'Water',
        ]);
        const S = new TerrainState({ names, biome, seed });
        for (let r = 0; r < 7; r++)
          for (let c = 0; c < 9; c++) checkFit(S, c, r, `${biome} mixed ${names[r][c]}`);
      }
  });

  it('limits ("mostly fit"): canopies and peaks <= 4 px over the top and sides, 1-2 px down; columns <= 1 px cap; structures inside', () => {
    expect(OBJECT_LIMITS.tree).toEqual({ left: 4, right: 4, top: 4, bottom: 2 });
    expect(OBJECT_LIMITS.mountain).toEqual({ left: 3, right: 3, top: 4, bottom: 1 });
    expect(OBJECT_LIMITS.pillar).toEqual({ left: 0, right: 0, top: 1, bottom: 0 });
    expect(OBJECT_LIMITS.structure).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('a unit cell above an object cell keeps its bottom half clear of the object', () => {
    // The unit's feet / ring sit in the lower half of its cell; the object
    // below may reach at most OBJECT_LIMITS.top (4) art px into the cell above.
    for (const biome of BIOME_NAMES)
      for (let seed = 1; seed <= 5; seed++) {
        const names = [
          ['Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
          ['Forest', 'Pillar', 'Mountain', 'Fort', 'Forest', 'Mountain'],
          ['Forest', 'Forest', 'Mountain', 'Plain', 'Forest', 'Mountain'],
        ];
        const res = render(names, biome, seed);
        const { owner, W } = res.state;
        for (let y = 0; y < ART_CELL; y++)
          for (let x = 0; x < W; x++)
            if (owner[y * W + x]) expect(y).toBeGreaterThanOrEqual(ART_CELL - 4);
      }
  });

  it('open ground stays open: trees reach at most 2 px into a non-forest cell, objects cover little of it', () => {
    let worstShare = 0;
    for (const biome of BIOME_NAMES)
      for (let seed = 1; seed <= 5; seed++) {
        const names = clustered(10, 8, seed * 17 + biome.length, [
          'Plain',
          'Plain',
          'Forest',
          'Forest',
          'Mountain',
          'Water',
        ]);
        const res = render(names, biome, seed);
        const S = res.state;
        for (let r = 0; r < S.rows; r++)
          for (let c = 0; c < S.cols; c++) {
            if (names[r][c] !== 'Plain' && names[r][c] !== 'Water') continue;
            let other = 0;
            for (let y = r * ART_CELL; y < (r + 1) * ART_CELL; y++)
              for (let x = c * ART_CELL; x < (c + 1) * ART_CELL; x++) {
                const w = S.owner[y * S.W + x];
                if (!w) continue;
                other++;
                const oc = (w - 1) % S.cols,
                  or = ((w - 1) / S.cols) | 0;
                if (names[or][oc] !== 'Forest') continue;
                // depth into this cell from the owner's side
                const dx = oc < c ? x - c * ART_CELL + 1 : oc > c ? (c + 1) * ART_CELL - x : 0;
                const dy = or < r ? y - r * ART_CELL + 1 : or > r ? (r + 1) * ART_CELL - y : 0;
                expect(Math.max(dx, dy), `${biome} tree into open (${c},${r})`).toBeLessThanOrEqual(
                  2,
                );
              }
            worstShare = Math.max(worstShare, other / (ART_CELL * ART_CELL));
          }
      }
    expect(worstShare).toBeLessThan(0.1);
  });
});

describe('procedural terrain: natural variation (owner feedback)', { timeout: 120000 }, () => {
  function ownCover(S, c, r) {
    const id = r * S.cols + c + 1;
    let n = 0;
    for (let y = r * ART_CELL; y < (r + 1) * ART_CELL; y++)
      for (let x = c * ART_CELL; x < (c + 1) * ART_CELL; x++) if (S.owner[y * S.W + x] === id) n++;
    return n / (ART_CELL * ART_CELL);
  }

  it('forest cells are not one stamp: tree counts and layouts vary, interiors are denser than edges', () => {
    for (const biome of ['grassland', 'tundra', 'swamp', 'castle'])
      for (let seed = 1; seed <= 3; seed++) {
        const names = Array.from({ length: 7 }, (_, r) =>
          Array.from({ length: 9 }, (_, c) =>
            r >= 1 && r <= 5 && c >= 1 && c <= 7 ? 'Forest' : 'Plain',
          ),
        );
        const res = render(names, biome, seed);
        const S = res.state;
        const counts = new Set(),
          masks = new Set();
        let interior = 0,
          nInterior = 0,
          edge = 0,
          nEdge = 0;
        for (let r = 1; r <= 5; r++)
          for (let c = 1; c <= 7; c++) {
            const o = buildCellObject(new TerrainState({ names, biome, seed }), c, r);
            counts.add(o.parts.length);
            const bits = [];
            o.sprite.forEach((x, y) => bits.push((x - c * ART_CELL) * 64 + y - r * ART_CELL));
            masks.add(bits.join(','));
            const cover = ownCover(S, c, r);
            expect(cover, `${biome} forest (${c},${r}) reads as cover`).toBeGreaterThan(0.2);
            if (r > 1 && r < 5 && c > 1 && c < 7) {
              interior += cover;
              nInterior++;
            } else {
              edge += cover;
              nEdge++;
            }
          }
        expect(counts.size, `${biome} tree counts`).toBeGreaterThanOrEqual(3);
        expect(masks.size, `${biome} layouts`).toBe(35);
        expect(interior / nInterior, `${biome} interior denser`).toBeGreaterThan(edge / nEdge);
      }
  });

  it('a lone forest cell is a tree or a small copse that still reads as cover', () => {
    for (const biome of BIOME_NAMES)
      for (let seed = 1; seed <= 12; seed++) {
        const names = [
          ['Plain', 'Plain', 'Plain'],
          ['Plain', 'Forest', 'Plain'],
          ['Plain', 'Plain', 'Plain'],
        ];
        const res = render(names, biome, seed);
        const o = buildCellObject(res.state, 1, 1);
        expect(o.parts.length).toBeGreaterThanOrEqual(1);
        expect(o.parts.length).toBeLessThanOrEqual(6);
        const dead = biome === 'volcano' || biome === 'void';
        expect(ownCover(res.state, 1, 1), `${biome} lone forest`).toBeGreaterThan(
          dead ? 0.06 : 0.2,
        );
      }
  });

  it('mountains vary in shape and join their neighbours into ranges', () => {
    const shapes = new Set();
    for (const biome of BIOME_NAMES)
      for (let seed = 1; seed <= 3; seed++) {
        const names = [
          ['Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
          ['Plain', 'Mountain', 'Mountain', 'Mountain', 'Plain'],
          ['Plain', 'Mountain', 'Mountain', 'Plain', 'Plain'],
          ['Plain', 'Plain', 'Plain', 'Plain', 'Mountain'],
        ];
        const res = render(names, biome, seed);
        const S = res.state;
        for (const [c, r] of [
          [1, 1],
          [2, 1],
          [3, 1],
          [1, 2],
          [2, 2],
          [4, 3],
        ])
          shapes.add(massifPlan(S, c, r).kind);
        // the shared border of two mountain neighbours is rock, not a seam of ground
        const W = S.W;
        let rock = 0;
        const x = 2 * ART_CELL;
        for (let y = ART_CELL + 12; y < 2 * ART_CELL; y++)
          for (const xx of [x - 1, x]) if (S.owner[y * W + xx]) rock++;
        expect(rock, `${biome} ridge between (1,1) and (2,1)`).toBeGreaterThan(12);
      }
    expect(shapes.size).toBeGreaterThanOrEqual(4);
  });
});

describe('procedural terrain: locality and repaint', { timeout: 180000 }, () => {
  const BUFFERS = ['idx', 'mat', 'dU', 'dD', 'dL', 'dR', 'shadow', 'owner', 'anim'];

  function diffCells(a, b, buf) {
    const S = a.state,
      out = new Set();
    const A = a.state[buf],
      B = b.state[buf];
    for (let i = 0; i < A.length; i++)
      if (A[i] !== B[i]) {
        const x = i % S.W,
          y = (i / S.W) | 0;
        out.add(`${(x / ART_CELL) | 0},${(y / ART_CELL) | 0}`);
      }
    return out;
  }

  it('changing one cell only changes pixels in its 3x3 neighbourhood', () => {
    const rnd = mulberry32(2024);
    let trials = 0;
    for (const biome of BIOME_NAMES)
      for (let t = 0; t < 10; t++) {
        const cols = 7,
          rows = 6;
        const names = randomNames(cols, rows, 1000 + t * 31 + biome.length);
        const col = Math.floor(rnd() * cols),
          row = Math.floor(rnd() * rows);
        const before = render(names, biome, 50 + t);
        const changed = names.map((r) => [...r]);
        const pool = [...TERRAIN_NAMES].filter((n) => n !== names[row][col]);
        changed[row][col] = pool[Math.floor(rnd() * pool.length)];
        const after = render(changed, biome, 50 + t);
        for (const buf of BUFFERS)
          for (const key of diffCells(before, after, buf)) {
            const [c, r] = key.split(',').map(Number);
            expect(
              Math.max(Math.abs(c - col), Math.abs(r - row)),
              `${biome} ${buf}: ${names[row][col]} -> ${changed[row][col]} at ${col},${row} changed cell ${key}`,
            ).toBeLessThanOrEqual(1);
          }
        trials++;
      }
    expect(trials).toBe(BIOME_NAMES.length * 10);
  });

  it('incremental repaint equals a full render (single, clustered, far-apart, edge cells)', () => {
    const rnd = mulberry32(77);
    for (const biome of BIOME_NAMES)
      for (let t = 0; t < 6; t++) {
        const cols = 9,
          rows = 7;
        const names = randomNames(cols, rows, 500 + t * 17 + biome.length);
        const res = render(names, biome, 900 + t);
        const edits = [];
        const n = 1 + (t % 4);
        for (let k = 0; k < n; k++) {
          const col = t === 5 ? (k % 2) * (cols - 1) : Math.floor(rnd() * cols);
          const row = t === 5 ? (k >> 1) * (rows - 1) : Math.floor(rnd() * rows);
          edits.push({ col, row, name: TERRAIN_NAMES[Math.floor(rnd() * TERRAIN_NAMES.length)] });
        }
        const changed = names.map((r) => [...r]);
        for (const e of edits) changed[e.row][e.col] = e.name;
        const rects = repaintCells(res, edits);
        const full = render(changed, biome, 900 + t);
        expect(fnv(res.state.idx), `${biome} trial ${t}`).toBe(fnv(full.state.idx));
        expect(fnv(res.pixels)).toBe(fnv(full.pixels));
        for (const r of rects) {
          expect(r.width).toBeLessThanOrEqual(cols * 48);
          expect(r.x % 48).toBe(0);
        }
      }
  });

  it('repaints from mapLayout, reports output-pixel rects and skips no-op edits', () => {
    const cfg = seededBattle({ act: 'act2', objective: 'rout', templateId: 'river_crossing' }, 3);
    const layout = cfg.mapLayout.map((r) => [...r]);
    const res = renderBattlefieldTerrain({ mapLayout: layout, terrainData: data.terrain, seed: 1 });
    expect(
      repaintCells(res, [{ col: 2, row: 2 }], { mapLayout: layout, terrainData: data.terrain }),
    ).toEqual([]);
    const plain = TERRAIN_NAMES.indexOf('Plain'),
      village = TERRAIN_NAMES.indexOf('Village');
    layout[2][2] = layout[2][2] === village ? plain : village;
    const rects = repaintCells(res, [{ col: 2, row: 2 }], {
      mapLayout: layout,
      terrainData: data.terrain,
    });
    expect(rects).toEqual([{ x: 48, y: 48, width: 144, height: 144 }]);
    // a temporary terrain + restore round trip returns to the original pixels
    const original = renderBattlefieldTerrain({
      mapLayout: cfg.mapLayout,
      terrainData: data.terrain,
      seed: 1,
    });
    syncTerrainLayout(res, cfg.mapLayout, data.terrain);
    expect(fnv(res.pixels)).toBe(fnv(original.pixels));
  });
});

describe('procedural terrain: borders stay on the cell grid', { timeout: 60000 }, () => {
  it('soft materials drift at most 3 art px off the true cell line', () => {
    let worst = 0;
    for (const biome of ['grassland', 'swamp', 'tundra', 'volcano'])
      for (let t = 0; t < 4; t++) {
        const res = render(randomNames(10, 8, 300 + t), biome, 40 + t);
        const S = res.state;
        for (let y = 0; y < S.H; y++)
          for (let x = 0; x < S.W; x++) {
            const own = S.groundAt((x / ART_CELL) | 0, (y / ART_CELL) | 0);
            const m = S.mat[y * S.W + x];
            if (m === own || HARD[own] || HARD[m]) continue;
            const u = x % ART_CELL,
              v = y % ART_CELL;
            const d = Math.min(u, v, ART_CELL - 1 - u, ART_CELL - 1 - v) + 1;
            worst = Math.max(worst, d);
          }
      }
    expect(worst).toBeLessThanOrEqual(3);
    expect(groundOf('Forest', G.FLOOR)).toBe(G.GRASS);
  });
});

describe('procedural terrain: shimmer', () => {
  it('tags only liquid pixels and recolours them from the palette', () => {
    const names = [
      ['Water', 'Water', 'Water', 'Lava Crack', 'Lava Crack'],
      ['Water', 'Water', 'Water', 'Lava Crack', 'Lava Crack'],
      ['Acidic Swamp', 'Acidic Swamp', 'Plain', 'Lava Crack', 'Lava Crack'],
    ];
    const res = render(names, 'volcano', 3);
    const sh = collectShimmer(res.state);
    expect(sh.count).toBeGreaterThan(0);
    const allowed = new Set([G.WATER, G.LAVA, G.ASWAMP, G.ABOG]);
    for (let k = 0; k < sh.count; k++) expect(allowed.has(res.state.mat[sh.index[k]])).toBe(true);
    const out = new Uint32Array(res.state.W * res.state.H);
    const a = shimmerFrame(sh, out, 0);
    expect(a).toBe(sh.count);
    const b = shimmerFrame(sh, out, 1000);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThanOrEqual(sh.count);
  });

  it('renderAll is idempotent', () => {
    const res = render(randomNames(5, 4, 1), 'grassland', 1);
    const h = fnv(res.state.idx);
    renderAll(res.state);
    expect(fnv(res.state.idx)).toBe(h);
  });
});

describe('procedural terrain: non-blocking painting', { timeout: 60000 }, () => {
  it('time-sliced painting yields between slices and equals the sync render', async () => {
    const names = randomNames(9, 8, 41);
    let yields = 0;
    let clock = 0;
    const res = await renderTerrainSliced(
      { names, biome: 'swamp', seed: 12 },
      {
        budgetMs: 3,
        // deterministic fake clock: every check advances 1 ms
        now: () => clock++,
        yieldFn: async () => {
          yields++;
        },
      },
    );
    expect(yields).toBeGreaterThan(10);
    expect(res.stats.slices).toBe(yields + 1);
    expect(fnv(res.pixels)).toBe(fnv(render(names, 'swamp', 12).pixels));
  });

  it('aborts cleanly', async () => {
    const ctrl = new AbortController();
    const p = renderTerrainSliced(
      { names: randomNames(6, 6, 2), biome: 'grassland', seed: 1 },
      {
        budgetMs: 0,
        signal: ctrl.signal,
        yieldFn: async () => ctrl.abort(),
      },
    );
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('browser adapter: idle warm-up and reduced-motion opt-out work without a DOM', () => {
    expect(() => warmTerrainRenderer()).not.toThrow();
    const res = render([['Water', 'Water', 'Lava Crack']], 'volcano', 2);
    expect(createShimmerOverlay(res, { reducedMotion: true })).toBeNull();
  });

  it('a result packed for postMessage unpacks into a repaintable result', () => {
    const names = randomNames(8, 6, 17);
    const a = render(names, 'tundra', 3);
    const packed = packResult(a);
    expect(packed.transfer.length).toBeGreaterThan(5);
    const { transfer: _t, ...message } = packed;
    const b = unpackResult(structuredClone(message));
    const edit = [{ col: 3, row: 2, name: 'Mountain' }];
    repaintCells(b, edit);
    const changed = names.map((r) => [...r]);
    changed[2][3] = 'Mountain';
    expect(fnv(b.pixels)).toBe(fnv(render(changed, 'tundra', 3).pixels));
  });
});
