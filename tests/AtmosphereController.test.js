import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => {
  class PostFXPipeline {
    constructor(config) {
      this.config = config;
    }
  }
  return { default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline } } } } };
});

const lightInstances = [];
vi.mock('../src/art/BattleLightLayer.js', () => ({
  BattleLightLayer: class {
    constructor(scene, options) {
      this.scene = scene;
      this.options = options;
      this.destroyed = false;
      lightInstances.push(this);
    }
    create() {
      return this;
    }
    setOptions(options) {
      this.options = { ...this.options, ...options };
      return this;
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

import {
  AtmosphereController,
  atmosphereContextFromScene,
} from '../src/ui/AtmosphereController.js';
import { UI_DEPTHS } from '../src/utils/uiDepths.js';

function makeCamera(id) {
  const cam = {
    id,
    width: 640,
    height: 480,
    zoom: 1,
    rotation: 0,
    scrollX: 0,
    scrollY: 0,
    roundPixels: true,
    pipelines: [],
    setPostPipeline: vi.fn((key) => {
      cam.pipelines.push({ key, setGrade: vi.fn() });
    }),
    getPostPipeline: vi.fn(() => cam.pipelines[0] || null),
    removePostPipeline: vi.fn(() => {
      cam.pipelines = [];
    }),
    setRoundPixels: vi.fn(),
    setZoom: vi.fn((z) => (cam.zoom = z)),
    setRotation: vi.fn((r) => (cam.rotation = r)),
    setScroll: vi.fn((x, y) => Object.assign(cam, { scrollX: x, scrollY: y })),
    setSize: vi.fn((w, h) => Object.assign(cam, { width: w, height: h })),
  };
  return cam;
}

function makeScene({ gl = true, act = 'act1', biome = null, preference = 'auto', uiCamera } = {}) {
  const listeners = {};
  const settingsListeners = new Set();
  const settings = {
    preference,
    getAtmosphere: vi.fn(() => settings.preference),
    getEffectsQuality: vi.fn(() => 'high'),
    getReduceMotion: vi.fn(() => false),
    onChange: vi.fn((fn) => {
      settingsListeners.add(fn);
      return () => settingsListeners.delete(fn);
    }),
    emit() {
      for (const fn of settingsListeners) fn();
    },
    listeners: settingsListeners,
  };
  const main = makeCamera(1);
  const added = [];
  const scene = {
    battleParams: { act },
    battleConfig: { biome },
    enemyUnits: [],
    grid: { biome },
    children: {
      list: [
        { depth: 0, cameraFilter: 0 },
        { depth: 10, cameraFilter: 0 },
        { depth: UI_DEPTHS.SCREEN_UI, cameraFilter: 0 },
        { depth: 900, cameraFilter: 0 },
      ],
    },
    registry: { get: (key) => (key === 'settings' ? settings : null) },
    events: {
      on: vi.fn((ev, fn) => ((listeners[ev] ||= new Set()).add(fn), undefined)),
      off: vi.fn((ev, fn) => listeners[ev]?.delete(fn)),
      emit: (ev, ...args) => {
        for (const fn of listeners[ev] || []) fn(...args);
      },
      listeners,
    },
    scale: { on: vi.fn(), off: vi.fn() },
    cameras: {
      main,
      add: vi.fn(() => {
        // Phaser draws UUIDs/randoms internally; the controller must isolate them.
        Math.random();
        const cam = makeCamera(2);
        added.push(cam);
        return cam;
      }),
      remove: vi.fn(),
      added,
    },
    sys: {
      game: {
        renderer: gl
          ? {
              gl: {},
              pipelines: {
                postPipelineClasses: new Map(),
                addPostPipeline: vi.fn(function (key, cls) {
                  this.postPipelineClasses.set(key, cls);
                }),
              },
            }
          : { pipelines: null },
      },
    },
    _uiCamera: uiCamera || null,
  };
  main.scene = scene;
  return { scene, settings, main };
}

beforeEach(() => {
  lightInstances.length = 0;
});

describe('AtmosphereController', () => {
  it('no WebGL: silently off, nothing added', () => {
    const { scene, main } = makeScene({ gl: false });
    const c = new AtmosphereController(scene).create();
    expect(c.state.mode).toBe('off');
    expect(c.state.supported).toBe(false);
    expect(main.setPostPipeline).not.toHaveBeenCalled();
    expect(scene.cameras.add).not.toHaveBeenCalled();
    c.destroy();
  });

  it('headless mocks without sys/cameras never throw', () => {
    const c = new AtmosphereController({ battleParams: {} }).create();
    expect(c.state.mode).toBe('off');
    expect(() => c.destroy()).not.toThrow();
    expect(() => new AtmosphereController(null).create().destroy()).not.toThrow();
  });

  it('desktop: grades only the main camera and routes UI depths to an ungraded camera', () => {
    const { scene, main } = makeScene({ act: 'act2' });
    const c = new AtmosphereController(scene).create();
    expect(c.state).toMatchObject({ mode: 'full', gradeKey: 'act2', night: false });
    expect(main.setPostPipeline).toHaveBeenCalledTimes(1);
    const ui = scene.cameras.added[0];
    expect(ui).toBeDefined();
    expect(ui.setPostPipeline).not.toHaveBeenCalled();
    scene.events.emit('prerender');
    const [ground, unit, hud, overlay] = scene.children.list;
    // cameraFilter bits EXCLUDE a camera.
    expect(ground.cameraFilter).toBe(ui.id);
    expect(unit.cameraFilter).toBe(ui.id);
    expect(hud.cameraFilter).toBe(main.id);
    expect(overlay.cameraFilter).toBe(main.id);
    expect(lightInstances).toHaveLength(0);
    c.destroy();
    expect(main.removePostPipeline).toHaveBeenCalled();
    expect(scene.cameras.remove).toHaveBeenCalledWith(ui);
    expect(scene.children.list.every((o) => o.cameraFilter === 0)).toBe(true);
  });

  it('mirrors the main camera view onto the UI camera (zoom punch, shake)', () => {
    const { scene, main } = makeScene();
    const c = new AtmosphereController(scene).create();
    main.zoom = 1.06;
    main.rotation = 0.004;
    scene.events.emit('prerender');
    const ui = scene.cameras.added[0];
    expect(ui.zoom).toBe(1.06);
    expect(ui.rotation).toBe(0.004);
    c.destroy();
  });

  it('phones reuse the pinned UI camera instead of adding one', () => {
    const { scene, main } = makeScene({ uiCamera: makeCamera(4) });
    const c = new AtmosphereController(scene).create();
    expect(main.setPostPipeline).toHaveBeenCalled();
    expect(scene.cameras.add).not.toHaveBeenCalled();
    c.destroy();
  });

  it('night acts add the light layer; the setting applies live and Off tears down', () => {
    const { scene, settings, main } = makeScene({ act: 'act4', preference: 'full' });
    const c = new AtmosphereController(scene).create();
    expect(c.state).toMatchObject({ mode: 'full', gradeKey: 'act4', night: true });
    expect(lightInstances).toHaveLength(1);
    expect(lightInstances[0].options.flicker).toBe(true);
    const fullDarkness = lightInstances[0].options.darkness;

    settings.preference = 'reduced';
    settings.emit();
    expect(c.state.mode).toBe('reduced');
    expect(lightInstances).toHaveLength(1);
    expect(lightInstances[0].options.flicker).toBe(false);
    expect(lightInstances[0].options.darkness).toBeLessThan(fullDarkness);
    expect(main.pipelines[0].setGrade).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ reduced: true }),
    );

    settings.preference = 'off';
    settings.emit();
    expect(c.state.mode).toBe('off');
    expect(lightInstances[0].destroyed).toBe(true);
    expect(main.pipelines).toHaveLength(0);
    expect(scene.cameras.remove).toHaveBeenCalled();

    settings.preference = 'full';
    settings.emit();
    expect(c.state.mode).toBe('full');
    expect(lightInstances).toHaveLength(2);
    c.destroy();
    expect(settings.listeners.size).toBe(0);
    expect(scene.events.listeners.prerender?.size || 0).toBe(0);
  });

  it('never advances the battle RNG while building presentation objects', () => {
    const { scene } = makeScene({ act: 'act4' });
    const battleRandom = vi.fn(() => 0.5);
    const previous = Math.random;
    Math.random = battleRandom;
    try {
      new AtmosphereController(scene).create().destroy();
    } finally {
      Math.random = previous;
    }
    expect(scene.cameras.add).toHaveBeenCalled();
    expect(battleRandom).not.toHaveBeenCalled();
  });
});

describe('atmosphereContextFromScene', () => {
  it('reads act, biome, boss and Entity presence', () => {
    const ctx = atmosphereContextFromScene({
      battleParams: { act: 'finalBoss' },
      battleConfig: { biome: 'void' },
      isBoss: true,
      enemyUnits: [{ isEntity: true }],
    });
    expect(ctx).toMatchObject({
      act: 'finalBoss',
      biome: 'void',
      isBoss: true,
      isFinalBoss: true,
      hasEntity: true,
      isTutorial: false,
    });
    expect(
      atmosphereContextFromScene({ battleParams: { act: 'act1', tutorialMode: true } }).isTutorial,
    ).toBe(true);
  });
});
