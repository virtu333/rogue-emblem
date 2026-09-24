import { describe, it, expect, vi } from 'vitest';
import {
  BattlefieldTerrainPainting,
  registerBattlefieldTerrainRenderer,
  getBattlefieldTerrainRenderer,
  setDefaultBattlefieldTerrainRenderer,
  terrainRendererFromCanvasFunction,
  terrainPresentationSeed,
  displayCellSize,
  paintBattlefieldTerrain,
  weatheredTerrainRenderer,
} from '../src/ui/BattlefieldArt.js';

function makeTile(key = 'terrain_plain') {
  const tile = {
    scene: {},
    texture: { key },
    frame: { name: '__BASE' },
    setTexture: vi.fn((k, f) => {
      tile.texture = { key: k };
      tile.frame = { name: f ?? '__BASE' };
      return tile;
    }),
    setDisplaySize: vi.fn(() => tile),
  };
  return tile;
}

function makeGrid() {
  const listeners = new Set();
  const grid = {
    cols: 3,
    rows: 2,
    biome: null,
    terrainData: [{ name: 'Plain' }, { name: 'Wall' }],
    mapLayout: [
      [0, 0, 1],
      [0, 1, 0],
    ],
    tiles: null,
    addTerrainListener: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    listeners,
  };
  grid.tiles = grid.mapLayout.map((row) => row.map(() => makeTile()));
  return grid;
}

function makeScene(grid) {
  const textures = new Map();
  return {
    grid,
    textures: {
      exists: (k) => textures.has(k),
      remove: (k) => textures.delete(k),
      addCanvas: (k, canvas) => {
        const frames = {};
        const tex = {
          canvas,
          frames,
          add: vi.fn((name, src, x, y, w, h) => (frames[name] = { x, y, w, h })),
          refresh: vi.fn(),
        };
        textures.set(k, tex);
        return tex;
      },
      map: textures,
    },
  };
}

function stubRenderer({ cells = false } = {}) {
  const fakeCanvas = {
    width: 144,
    height: 96,
    getContext: () => ({ clearRect() {}, drawImage() {} }),
  };
  return {
    id: 'stub',
    cellSize: 48,
    prepare: vi.fn(() => Promise.resolve({ atlas: true })),
    render: vi.fn(() => ({ canvas: fakeCanvas, painted: () => true })),
    ...(cells ? { renderCells: vi.fn() } : {}),
  };
}

describe('BattlefieldArt renderer seam', () => {
  it('ships the weathered renderer as the default', () => {
    expect(getBattlefieldTerrainRenderer()).toBe(weatheredTerrainRenderer);
    expect(getBattlefieldTerrainRenderer('missing')).toBe(weatheredTerrainRenderer);
  });

  it('adapts a pure (input) => canvas renderer and can make it the default', () => {
    const fn = vi.fn(() => ({ width: 1, height: 1 }));
    const renderer = registerBattlefieldTerrainRenderer(
      terrainRendererFromCanvasFunction('procedural-test', fn),
    );
    expect(getBattlefieldTerrainRenderer('procedural-test')).toBe(renderer);
    const input = { mapLayout: [[0]], terrainData: [], biome: null, seed: 1, cols: 1, rows: 1 };
    const out = renderer.render(null, input);
    expect(fn).toHaveBeenCalledWith(input);
    expect(out.painted(0, 0)).toBe(true);
    setDefaultBattlefieldTerrainRenderer('procedural-test');
    expect(getBattlefieldTerrainRenderer()).toBe(renderer);
    setDefaultBattlefieldTerrainRenderer('weathered');
    expect(() => setDefaultBattlefieldTerrainRenderer('nope')).toThrow();
    expect(() => registerBattlefieldTerrainRenderer({ id: 'x' })).toThrow();
  });

  it('presentation seed is deterministic and never touches Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const a = terrainPresentationSeed(
      [
        [0, 1],
        [2, 3],
      ],
      'tundra',
    );
    const b = terrainPresentationSeed(
      [
        [0, 1],
        [2, 3],
      ],
      'tundra',
    );
    const c = terrainPresentationSeed(
      [
        [0, 1],
        [2, 4],
      ],
      'tundra',
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('desktop (fixed camera) displays one texel per world pixel; phones keep 48', () => {
    expect(displayCellSize(48, { zoomable: false })).toBe(32);
    expect(displayCellSize(48, { zoomable: true })).toBe(48);
  });

  it('returns null where it cannot paint (no DOM / no tiles)', () => {
    expect(paintBattlefieldTerrain({}, null)).toBeNull();
  });
});

describe('BattlefieldTerrainPainting', () => {
  it('cuts one frame per cell and applies it to every tile, then restores on destroy', async () => {
    const grid = makeGrid();
    const scene = makeScene(grid);
    const renderer = stubRenderer();
    const painting = new BattlefieldTerrainPainting(scene, grid, renderer, { zoomable: true });
    await painting.start().ready;
    expect(painting.painted).toBe(true);
    const tex = scene.textures.map.get(painting.key);
    expect(Object.keys(tex.frames)).toHaveLength(6);
    expect(tex.frames['2,1']).toEqual({ x: 96, y: 48, w: 48, h: 48 });
    for (const [r, row] of grid.tiles.entries())
      for (const [c, tile] of row.entries()) {
        expect(tile.texture.key).toBe(painting.key);
        expect(tile.frame.name).toBe(`${c},${r}`);
      }
    painting.destroy();
    expect(grid.tiles.flat().every((t) => t.texture.key === 'terrain_plain')).toBe(true);
    expect(scene.textures.map.has(painting.key)).toBe(false);
    expect(grid.listeners.size).toBe(0);
  });

  it('a rebuilt tile gets its frame at once; neighbours repaint once per burst', async () => {
    const grid = makeGrid();
    const scene = makeScene(grid);
    const renderer = stubRenderer({ cells: true });
    const painting = new BattlefieldTerrainPainting(scene, grid, renderer, { zoomable: true });
    await painting.start().ready;
    // Grid.setTerrainAt replaced two tiles in one call stack (e.g. a checkpoint restore).
    grid.tiles[0][0] = makeTile('terrain_wall');
    grid.tiles[1][2] = makeTile('terrain_wall');
    for (const fn of grid.listeners) {
      fn(0, 0);
      fn(2, 1);
    }
    expect(grid.tiles[0][0].texture.key).toBe(painting.key);
    expect(grid.tiles[1][2].texture.key).toBe(painting.key);
    expect(renderer.renderCells).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(renderer.renderCells).toHaveBeenCalledTimes(1);
    const cells = renderer.renderCells.mock.calls[0][3];
    expect(cells).toHaveLength(6); // the 3x2 map: both 3x3 neighbourhoods, deduplicated
    expect(scene.textures.map.get(painting.key).refresh).toHaveBeenCalledTimes(1);
    painting.destroy();
  });

  it('whole-map renderers re-render on change', async () => {
    const grid = makeGrid();
    const scene = makeScene(grid);
    const renderer = stubRenderer();
    const painting = new BattlefieldTerrainPainting(scene, grid, renderer, { zoomable: true });
    await painting.start().ready;
    for (const fn of grid.listeners) fn(1, 1);
    await Promise.resolve();
    expect(renderer.render).toHaveBeenCalledTimes(2);
    painting.destroy();
  });

  it('ignores a late load after teardown or a rebuilt grid', async () => {
    const grid = makeGrid();
    const scene = makeScene(grid);
    const painting = new BattlefieldTerrainPainting(scene, grid, stubRenderer(), {
      zoomable: true,
    });
    painting.start();
    scene.grid = makeGrid();
    expect(await painting.ready).toBe(false);
    expect(grid.tiles.flat().every((t) => t.texture.key === 'terrain_plain')).toBe(true);
  });

  it('a failing renderer leaves the classic tiles and reports once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = makeGrid();
    const scene = makeScene(grid);
    const renderer = { ...stubRenderer(), prepare: () => Promise.reject(new Error('404')) };
    const painting = new BattlefieldTerrainPainting(scene, grid, renderer, { zoomable: true });
    expect(await painting.start().ready).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(grid.tiles.flat().every((t) => t.texture.key === 'terrain_plain')).toBe(true);
    warn.mockRestore();
  });

  it('ballista containers paint the ground child and hide the engine overlay', async () => {
    const grid = makeGrid();
    const ground = makeTile('terrain_floor');
    const overlay = { visible: true, setVisible: vi.fn((v) => (overlay.visible = v)), scene: {} };
    grid.tiles[0][1] = { list: [ground, overlay] };
    const scene = makeScene(grid);
    const painting = new BattlefieldTerrainPainting(scene, grid, stubRenderer(), {
      zoomable: true,
    });
    await painting.start().ready;
    expect(ground.texture.key).toBe(painting.key);
    expect(overlay.visible).toBe(false);
    painting.destroy();
    expect(ground.texture.key).toBe('terrain_floor');
    expect(overlay.visible).toBe(true);
  });
});
