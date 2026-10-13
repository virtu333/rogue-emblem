import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('phaser', () => {
  class PostFXPipeline {}
  return { default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline } } } } };
});

import { WeatherController } from '../src/ui/WeatherController.js';
import { weatherParticleCount, WEATHER_MAX_PARTICLES } from '../src/art/weatherConfig.js';
import { UI_DEPTHS } from '../src/utils/uiDepths.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { loadGameData } from './testData.js';

const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
  vi.restoreAllMocks();
});

function makeImage(scene, x, y, key) {
  // Phaser draws randoms while building objects; the controller must isolate them.
  Math.random();
  const img = {
    scene,
    key,
    x,
    y,
    depth: 0,
    alpha: 1,
    scaleX: 1,
    rotation: 0,
    tint: 0xffffff,
    visible: true,
    blendMode: 'NORMAL',
    destroyed: false,
    setOrigin: vi.fn(() => img),
    setDepth: vi.fn((d) => ((img.depth = d), img)),
    setBlendMode: vi.fn((b) => ((img.blendMode = b), img)),
    setVisible: vi.fn((v) => ((img.visible = v), img)),
    setTint: vi.fn((t) => ((img.tint = t), img)),
    setRotation: vi.fn((r) => ((img.rotation = r), img)),
    setPosition: vi.fn((px, py) => Object.assign(img, { x: px, y: py })),
    setAlpha: vi.fn((a) => ((img.alpha = a), img)),
    setScale: vi.fn((s) => ((img.scaleX = s), img)),
    destroy: vi.fn(() => {
      img.destroyed = true;
      img.scene = undefined;
    }),
  };
  return img;
}

function makeScene({
  act = 'act2',
  biome = null,
  preference = 'full',
  reduceMotion = false,
  effectsQuality = 'high',
  gl = true,
  battleParams = null,
  map = { left: 0, top: 0, width: 640, height: 400 },
  view = { x: 0, y: 0, width: 640, height: 480 },
  zoom = 1,
} = {}) {
  const listeners = {};
  const settingsListeners = new Set();
  const settings = {
    preference,
    reduceMotion,
    effectsQuality,
    getAtmosphere: () => settings.preference,
    getReduceMotion: () => settings.reduceMotion,
    getEffectsQuality: () => settings.effectsQuality,
    onChange: (fn) => {
      settingsListeners.add(fn);
      return () => settingsListeners.delete(fn);
    },
    emit: () => settingsListeners.forEach((fn) => fn()),
  };
  const images = [];
  const textures = new Map();
  const scene = {
    battleParams: battleParams || { act, battleSeed: 1234 },
    battleConfig: { biome },
    grid: { biome },
    enemyUnits: [],
    battleState: 'PLAYER_IDLE',
    registry: { get: (key) => (key === 'settings' ? settings : null) },
    events: {
      on: vi.fn((ev, fn) => (listeners[ev] ||= new Set()).add(fn)),
      off: vi.fn((ev, fn) => listeners[ev]?.delete(fn)),
      emit: (ev, ...args) => (listeners[ev] || []).forEach((fn) => fn(...args)),
      listeners,
    },
    add: {
      image: vi.fn((x, y, key) => {
        const img = makeImage(scene, x, y, key);
        images.push(img);
        return img;
      }),
    },
    textures: {
      exists: (key) => textures.has(key),
      createCanvas: vi.fn((key, w, h) => {
        Math.random();
        const ctx = { fillStyle: '', fillRect: vi.fn() };
        const tex = { key, w, h, getContext: () => ctx, refresh: vi.fn() };
        textures.set(key, tex);
        return tex;
      }),
    },
    cameras: { main: { zoom, worldView: { ...view } } },
    _getBattleMapBounds: () => ({ ...map }),
    sys: {
      game: {
        renderer: gl
          ? { gl: {}, pipelines: { addPostPipeline: () => {}, postPipelineClasses: new Map() } }
          : { pipelines: null },
      },
    },
  };
  const frames = (n, dt = 16) => {
    for (let i = 0; i < n; i++) scene.events.emit('update', i * dt, dt);
  };
  const live = () => images.filter((img) => !img.destroyed);
  return { scene, settings, images, live, frames, textures };
}

describe('WeatherController', () => {
  it('Iron Rain, Full: a bounded pool of world-depth images over the visible map', () => {
    const { scene, live, frames } = makeScene({ act: 'act2' });
    const c = new WeatherController(scene).create();
    expect(c.state).toMatchObject({ kind: 'rain', mode: 'full' });
    frames(1);
    const pool = live();
    expect(pool).toHaveLength(weatherParticleCount('rain', 'full'));
    expect(pool.length).toBeLessThanOrEqual(WEATHER_MAX_PARTICLES.full);
    for (const img of pool) {
      // World camera: under the screen-UI floor, never auto-pinned on phones.
      expect(img.depth).toBe(UI_DEPTHS.WEATHER);
      expect(img.depth).toBeLessThan(UI_DEPTHS.SCREEN_UI);
      expect(img._forceWorldCamera).toBe(true);
    }
    frames(300);
    // The pool never grows: no allocation per frame.
    expect(scene.add.image).toHaveBeenCalledTimes(pool.length);
    for (const img of live().filter((i) => i.visible)) {
      expect(img.x).toBeGreaterThanOrEqual(-16 - 10);
      expect(img.x).toBeLessThan(640 + 16 + 10);
      expect(img.y).toBeGreaterThanOrEqual(-16);
      expect(img.y).toBeLessThan(400 + 16);
    }
    c.destroy();
    expect(live()).toHaveLength(0);
    expect(scene.events.listeners.update?.size || 0).toBe(0);
  });

  it('Reduced: about a third, at most 40', () => {
    const { scene, live, frames } = makeScene({ act: 'act2', preference: 'reduced' });
    new WeatherController(scene).create();
    frames(2);
    expect(live()).toHaveLength(weatherParticleCount('rain', 'reduced'));
    expect(live().length).toBeLessThanOrEqual(WEATHER_MAX_PARTICLES.reduced);
  });

  it('Low effects quality caps at Reduced', () => {
    const { scene, live, frames } = makeScene({ act: 'act4', effectsQuality: 'low' });
    const c = new WeatherController(scene).create();
    frames(2);
    expect(c.state).toMatchObject({ kind: 'ash', mode: 'reduced' });
    expect(live()).toHaveLength(weatherParticleCount('ash', 'reduced'));
  });

  it.each([
    ['Atmosphere Off', { preference: 'off' }],
    ['Reduce motion', { reduceMotion: true }],
    ['no WebGL (the grade is off too)', { gl: false }],
    ['a clear mood (Ember Dusk)', { act: 'act1' }],
  ])('%s: nothing is built', (_label, opts) => {
    const { scene, frames } = makeScene({ act: 'act2', ...opts });
    new WeatherController(scene).create();
    frames(20);
    expect(scene.add.image).not.toHaveBeenCalled();
    expect(scene.textures.createCanvas).not.toHaveBeenCalled();
  });

  it('a scripted battle (the prologue) stays clear, on any ground', () => {
    const data = loadGameData();
    const battleParams = prologueBattleParams(data.prologue.chapters[0], {
      seed: data.prologue.seed,
    });
    const { scene, frames } = makeScene({ battleParams, biome: 'tundra' });
    const c = new WeatherController(scene).create();
    frames(5);
    expect(c.state.kind).toBe('none');
    expect(scene.add.image).not.toHaveBeenCalled();
    expect(scene.events.listeners.update?.size || 0).toBe(0);
  });

  it('follows the setting live: Full → Reduced rebuilds smaller, Off releases everything', () => {
    const { scene, settings, live, frames } = makeScene({ act: 'act4', biome: 'tundra' });
    const c = new WeatherController(scene).create();
    frames(2);
    expect(c.state.kind).toBe('snow');
    expect(live()).toHaveLength(weatherParticleCount('snow', 'full'));
    settings.preference = 'reduced';
    settings.emit();
    frames(2);
    expect(live()).toHaveLength(weatherParticleCount('snow', 'reduced'));
    settings.reduceMotion = true;
    settings.emit();
    frames(2);
    expect(live()).toHaveLength(0);
    settings.reduceMotion = false;
    settings.preference = 'full';
    settings.emit();
    frames(2);
    expect(live()).toHaveLength(weatherParticleCount('snow', 'full'));
  });

  it('the battle ending releases the pool; a battle that carries on rebuilds it', () => {
    const { scene, live, frames } = makeScene({ act: 'act2' });
    new WeatherController(scene).create();
    frames(3);
    expect(live().length).toBeGreaterThan(0);
    scene.battleState = 'BATTLE_END';
    frames(3);
    expect(live()).toHaveLength(0);
    scene.battleState = 'PLAYER_IDLE';
    frames(1);
    expect(live()).toHaveLength(weatherParticleCount('rain', 'full'));
  });

  it('a drawing failure never reaches the battle: weather turns off for the battle', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { scene, images, live, frames } = makeScene({ act: 'act2' });
    const c = new WeatherController(scene).create();
    frames(1);
    images[0].setPosition.mockImplementation(() => {
      throw new Error('renderer gone');
    });
    expect(() => frames(5)).not.toThrow();
    expect(c.failed).toBe(true);
    expect(live()).toHaveLength(0);
    const built = scene.add.image.mock.calls.length;
    frames(10);
    expect(scene.add.image.mock.calls.length).toBe(built);
  });

  it('a display list torn down under it is rebuilt, not drawn into', () => {
    const { scene, images, live, frames } = makeScene({ act: 'act2' });
    new WeatherController(scene).create();
    frames(1);
    images.forEach((img) => img.destroy());
    frames(2);
    expect(live()).toHaveLength(weatherParticleCount('rain', 'full'));
  });

  it('zoomed in, particles keep their screen size (counter-scaled by the zoom)', () => {
    const { scene, live, frames } = makeScene({
      act: 'act4',
      zoom: 2,
      view: { x: 100, y: 80, width: 320, height: 240 },
    });
    new WeatherController(scene).create();
    frames(3);
    const shown = live().filter((i) => i.visible);
    expect(shown.length).toBeGreaterThan(0);
    // Ash scale is 0.75..1.4; halved at zoom 2.
    for (const img of shown) expect(img.scaleX).toBeLessThanOrEqual(0.7 + 1e-9);
    for (const img of shown) {
      expect(img.x).toBeGreaterThanOrEqual(100 - 8 - 4);
      expect(img.x).toBeLessThan(420 + 8 + 4);
    }
  });

  it('portrait (a tall turned board): covers the board and falls down the screen', () => {
    // An upright phone: the Grid lays the turned map out tall; the camera is unrotated.
    const map = { left: 10, top: 40, width: 320, height: 640 };
    const { scene, live, frames } = makeScene({
      act: 'act2',
      map,
      view: { x: 0, y: 0, width: 390, height: 760 },
    });
    new WeatherController(scene).create();
    frames(1);
    const pool = live();
    const ys = pool.map((i) => i.y);
    expect(Math.min(...ys)).toBeLessThan(map.top + map.height * 0.25);
    expect(Math.max(...ys)).toBeGreaterThan(map.top + map.height * 0.75);
    for (const img of pool.filter((i) => i.visible)) {
      expect(img.x).toBeGreaterThanOrEqual(map.left - 16 - 1);
      expect(img.x).toBeLessThan(map.left + map.width + 16 + 1);
    }
    const shown = pool.filter((i) => i.visible);
    const before = shown.map((i) => i.y);
    frames(1);
    // Down the screen is world +y (only one recycled from the bottom edge may jump up).
    const falling = shown.filter((img, i) => img.y > before[i]).length;
    expect(falling).toBeGreaterThan(shown.length * 0.9);
  });

  it('never moves the battle RNG stream (create, hundreds of frames, a setting change, destroy)', () => {
    const reference = createSeededRng(0xbadc0de);
    reference(); // the value a battle would draw next
    const expected = reference();

    Math.random = createSeededRng(0xbadc0de);
    Math.random();
    const { scene, settings, frames } = makeScene({ act: 'act4', biome: 'volcano' });
    const c = new WeatherController(scene).create();
    frames(400);
    settings.preference = 'reduced';
    settings.emit();
    frames(200);
    scene.battleState = 'BATTLE_END';
    frames(2);
    c.destroy();
    expect(scene.add.image).toHaveBeenCalled();
    expect(Math.random()).toBe(expected);
  });

  it('a host without canvas textures stays off instead of retrying every frame', () => {
    const { scene, frames } = makeScene({ act: 'act2' });
    delete scene.textures.createCanvas;
    const c = new WeatherController(scene).create();
    frames(30);
    expect(c.failed).toBe(true);
    expect(scene.add.image).not.toHaveBeenCalled();
  });

  it('headless hosts without a scene graph never throw', () => {
    expect(() =>
      new WeatherController({ battleParams: { act: 'act2' } }).create().destroy(),
    ).not.toThrow();
    expect(() => new WeatherController(null).create().destroy()).not.toThrow();
  });
});
