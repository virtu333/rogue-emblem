import { describe, it, expect, vi } from 'vitest';
import { BattleLightLayer, LIGHT_LAYER_DEPTH } from '../src/art/BattleLightLayer.js';
import { LIGHT_PRESETS } from '../src/art/atmosphereConfig.js';

function makeTarget() {
  const t = {
    calls: [],
    depth: 0,
    alpha: 1,
    destroyed: false,
    texture: { setFilter: vi.fn() },
    setOrigin: () => t,
    setDisplaySize: () => t,
    setDepth: (d) => ((t.depth = d), t),
    setBlendMode: () => t,
    setAlpha: (a) => ((t.alpha = a), t),
    clear: () => (t.calls.push('clear'), t),
    fill: () => (t.calls.push('fill'), t),
    erase: () => (t.calls.push('erase'), t),
    draw: () => (t.calls.push('draw'), t),
    drawFrame: () => (t.calls.push('drawFrame'), t),
    destroy: () => (t.destroyed = true),
    setFilter: vi.fn(),
  };
  return t;
}

function makeScene({ fog = false } = {}) {
  const listeners = {};
  const textures = new Map();
  const rts = [];
  const terrain = [{ name: 'Plain' }, { name: 'Lava Crack' }];
  const layout = [
    [0, 1, 0],
    [0, 0, 0],
  ];
  const unit = (faction, col, row, extra = {}) => ({
    faction,
    currentHP: 10,
    graphic: { x: 16 + col * 32, y: 16 + row * 32, visible: true, alpha: 1 },
    ...extra,
  });
  const scene = {
    grid: {
      cols: 3,
      rows: 2,
      offsetX: 0,
      offsetY: 0,
      terrainRevision: 0,
      fogEnabled: fog,
      visibleSet: new Set(['0,0']),
      isVisible(col, row) {
        return this.visibleSet.has(`${col},${row}`);
      },
      getTerrainAt: (col, row) => terrain[layout[row][col]],
    },
    playerUnits: [unit('player', 0, 0)],
    npcUnits: [],
    enemyUnits: [unit('enemy', 2, 1)],
    textures: {
      exists: (k) => textures.has(k),
      remove: (k) => textures.delete(k),
      addDynamicTexture: (k) => {
        const t = makeTarget();
        textures.set(k, t);
        return t;
      },
      createCanvas: (k) => {
        const tex = {
          getContext: () => ({
            createRadialGradient: () => ({ addColorStop() {} }),
            fillRect() {},
          }),
          refresh() {},
          setFilter() {},
        };
        textures.set(k, tex);
        return tex;
      },
    },
    add: {
      renderTexture: () => {
        const t = makeTarget();
        rts.push(t);
        return t;
      },
    },
    make: {
      image: () => ({
        setDisplaySize() {},
        setAlpha() {},
        setTint() {},
        clearTint() {},
        destroy() {},
      }),
    },
    events: {
      on: (e, fn) => (listeners[e] ||= new Set()).add(fn),
      off: (e, fn) => listeners[e]?.delete(fn),
      emit: (e, ...a) => [...(listeners[e] || [])].forEach((fn) => fn(...a)),
      listeners,
    },
  };
  return { scene, rts, textures, unit };
}

describe('BattleLightLayer', () => {
  it('sits above fog and below the danger zone, ranges, rings and units', () => {
    expect(LIGHT_LAYER_DEPTH).toBeGreaterThan(3);
    expect(LIGHT_LAYER_DEPTH).toBeLessThan(4);
    const { scene, rts } = makeScene();
    new BattleLightLayer(scene, LIGHT_PRESETS.ashfall).create();
    expect(rts.map((r) => r.depth).every((d) => d > 3 && d < 4)).toBe(true);
  });

  it('redraws only when something changed', () => {
    const { scene } = makeScene();
    const layer = new BattleLightLayer(scene, LIGHT_PRESETS.ashfall).create();
    const start = { ...layer.stats };
    for (let i = 0; i < 10; i++) scene.events.emit('update', i * 16);
    expect(layer.stats).toEqual(start);
    scene.playerUnits[0].graphic.x += 32; // a unit moved
    scene.events.emit('update', 200);
    expect(layer.stats.unitRedraws).toBe(start.unitRedraws + 1);
    expect(layer.stats.staticRedraws).toBe(start.staticRedraws);
    scene.grid.terrainRevision += 1; // a cell changed
    scene.events.emit('update', 216);
    expect(layer.stats.staticRedraws).toBe(start.staticRedraws + 1);
    layer.destroy();
  });

  it('only your units and allies carry light; dead, hidden and enemy units do not', () => {
    const { scene, unit } = makeScene();
    scene.npcUnits = [unit('npc', 1, 1)];
    scene.playerUnits.push(unit('player', 1, 0, { currentHP: 0 }));
    scene.playerUnits.push(unit('player', 2, 0));
    scene.playerUnits.at(-1).graphic.visible = false;
    const layer = new BattleLightLayer(scene, LIGHT_PRESETS.ashfall).create();
    expect(layer._litUnits().map((l) => l.kind)).toEqual(['player', 'ally']);
    layer.destroy();
  });

  it('the Entity bleeds unlight only in presets that define it', () => {
    const { scene, unit } = makeScene();
    scene.enemyUnits.push(unit('enemy', 1, 1, { isEntity: true }));
    const ash = new BattleLightLayer(scene, LIGHT_PRESETS.ashfall).create();
    expect(ash._litUnits().some((l) => l.kind === 'entity')).toBe(false);
    ash.destroy();
    const deep = new BattleLightLayer(scene, LIGHT_PRESETS.deep).create();
    expect(deep._litUnits().some((l) => l.kind === 'entity')).toBe(true);
    deep.destroy();
  });

  it('fogged emitters stay dark and refresh when fog visibility changes', () => {
    const { scene } = makeScene({ fog: true });
    const layer = new BattleLightLayer(scene, LIGHT_PRESETS.ashfall).create();
    expect(layer._emitters).toHaveLength(0); // the lava cell (1,0) is fogged
    scene.grid.visibleSet = new Set(['0,0', '1,0']);
    scene.events.emit('update', 16);
    expect(layer._emitters).toHaveLength(1);
    layer.destroy();
  });

  it('flicker animates alpha without redrawing, and only when enabled', () => {
    const { scene, rts } = makeScene({ fog: false });
    const layer = new BattleLightLayer(scene, { ...LIGHT_PRESETS.ashfall, flicker: true }).create();
    const glowStatic = rts[1];
    const before = { ...layer.stats };
    scene.events.emit('update', 1000);
    const a1 = glowStatic.alpha;
    scene.events.emit('update', 1300);
    expect(glowStatic.alpha).not.toBe(a1);
    expect(layer.stats).toEqual(before);
    layer.setOptions({ flicker: false });
    expect(glowStatic.alpha).toBe(1);
    layer.destroy();
  });

  it('destroy releases objects, the cached texture and the update listener', () => {
    const { scene, rts, textures } = makeScene();
    const layer = new BattleLightLayer(scene, LIGHT_PRESETS.deep).create();
    const key = layer.staticKey;
    expect(textures.has(key)).toBe(true);
    layer.destroy();
    expect(rts.every((r) => r.destroyed)).toBe(true);
    expect(textures.has(key)).toBe(false);
    expect(scene.events.listeners.update.size).toBe(0);
  });

  it('rebuilds itself when the battle replaces its grid', () => {
    const { scene, rts } = makeScene();
    const layer = new BattleLightLayer(scene, LIGHT_PRESETS.ashfall).create();
    const firstObjects = rts.length;
    scene.grid = { ...scene.grid, cols: 4, visibleSet: new Set(), getTerrainAt: () => null };
    scene.events.emit('update', 16);
    expect(rts.length).toBe(firstObjects * 2);
    expect(rts.slice(0, firstObjects).every((r) => r.destroyed)).toBe(true);
    expect(scene.events.listeners.update.size).toBe(1);
    layer.destroy();
  });

  it('is a no-op without a grid or render textures (headless)', () => {
    const layer = new BattleLightLayer({ grid: null }, {}).create();
    expect(layer.dark).toBeNull();
    expect(() => layer.update(0)).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();
  });
});
