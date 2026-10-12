// The seeded camera shake: the pure plan (deterministic, decays to exactly 0, no Math.random)
// and the controller that plays it on the world camera (the render matrix only: nothing to
// restore, so a finished, interrupted, replaced or torn-down shake leaves the camera as it
// was; reduced motion, Instant and a missing UI camera mean no shake).
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1, NORMAL: 0 } } }));
import {
  MAX_SHAKE_MS,
  MAX_SHAKE_PX,
  SHAKE_KINDS,
  SHAKE_STEP_MS,
  planShake,
  shakeEnvelope,
  shakeOffsetAt,
  shakeSeed,
} from '../src/art/combatFx/screenShake.js';
import { CAMERA_PRE_RENDER, ScreenShakeController } from '../src/ui/ScreenShakeController.js';
import { CombatFxController } from '../src/ui/CombatFxController.js';

afterEach(() => vi.restoreAllMocks());

/** Math.random must never run while a shake is planned or played: it is the battle RNG. */
function banMathRandom() {
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Math.random called by the shake');
  });
}

const BASE = { tx: 100, ty: 50 };

/**
 * A camera double: a render matrix rebuilt from the base every frame (as Phaser's
 * preRender does from scroll/zoom/position), then the `prerender` listeners, then what
 * would be drawn. Writes to scroll, zoom or position throw: the shake must never make them.
 */
function makeCamera() {
  const listeners = new Set();
  const camera = {
    matrix: { tx: BASE.tx, ty: BASE.ty },
    on: (event, fn) => {
      if (event === CAMERA_PRE_RENDER) listeners.add(fn);
    },
    off: (event, fn) => {
      if (event === CAMERA_PRE_RENDER) listeners.delete(fn);
    },
    listenerCount: () => listeners.size,
    render() {
      camera.matrix.tx = BASE.tx;
      camera.matrix.ty = BASE.ty;
      for (const fn of [...listeners]) fn(camera);
      return { x: camera.matrix.tx - BASE.tx, y: camera.matrix.ty - BASE.ty };
    },
  };
  const guarded = ['scrollX', 'scrollY', 'zoom', 'x', 'y'];
  const state = { scrollX: 12, scrollY: 34, zoom: 2, x: 0, y: 0 };
  for (const key of guarded) {
    Object.defineProperty(camera, key, {
      get: () => state[key],
      set: () => {
        throw new Error(`the shake wrote camera.${key}`);
      },
    });
  }
  return camera;
}

function makeScene({ speed = 'normal', reduced = false, ui = true } = {}) {
  const camera = makeCamera();
  const scene = {
    cameras: { main: camera },
    time: { now: 1000 },
    _reduceMotion: () => reduced,
    registry: { get: (k) => (k === 'settings' ? { getBattleSpeed: () => speed } : null) },
    ...(ui ? { _uiCamera: { id: 2 } } : {}),
  };
  return { scene, camera, advance: (ms) => (scene.time.now += ms) };
}

describe('planShake (pure)', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = planShake({ seed: 7, intensity: 4, durationMs: 260 });
    const b = planShake({ seed: 7, intensity: 4, durationMs: 260 });
    const c = planShake({ seed: 8, intensity: 4, durationMs: 260 });
    expect(b).toEqual(a);
    expect(c.offsets).not.toEqual(a.offsets);
  });

  it('decays and ends at exactly (0, 0)', () => {
    const plan = planShake({ seed: 3, intensity: 6, durationMs: 400 });
    const steps = plan.offsets.length - 1;
    expect(steps).toBe(Math.ceil(400 / SHAKE_STEP_MS));
    expect(plan.offsets[steps]).toEqual({ x: 0, y: 0 });
    plan.offsets.forEach((o, i) => {
      // Whole pixels, never negative zero, inside the envelope's bound at that step.
      expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
      expect(Object.is(o.x, -0) || Object.is(o.y, -0)).toBe(false);
      const bound = Math.ceil(6 * shakeEnvelope(i / steps));
      expect(Math.abs(o.x)).toBeLessThanOrEqual(bound);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(bound);
    });
    // The last quarter has settled to nothing or next to it; the first starts big.
    const tail = plan.offsets.slice(Math.floor(steps * 0.75));
    expect(
      Math.max(...tail.map((o) => Math.max(Math.abs(o.x), Math.abs(o.y)))),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...plan.offsets.slice(0, 4).map((o) => Math.abs(o.x) + Math.abs(o.y))),
    ).toBeGreaterThan(2);
  });

  it('reads exactly 0 at and after the duration', () => {
    const plan = planShake({ seed: 5, intensity: 4, durationMs: 200 });
    expect(shakeOffsetAt(plan, plan.durationMs)).toEqual({ x: 0, y: 0 });
    expect(shakeOffsetAt(plan, plan.durationMs + 500)).toEqual({ x: 0, y: 0 });
    expect(shakeOffsetAt(plan, -5)).toEqual({ x: 0, y: 0 });
    expect(shakeOffsetAt(plan, 0)).toEqual(plan.offsets[0]);
    expect(shakeOffsetAt(plan, SHAKE_STEP_MS * 3 + 1)).toEqual(plan.offsets[3]);
  });

  it('clamps to a few pixels over a fraction of a second, and empty means no shake', () => {
    const big = planShake({ seed: 1, intensity: 99, durationMs: 99999 });
    expect(big.intensity).toBe(MAX_SHAKE_PX);
    expect(big.durationMs).toBe(MAX_SHAKE_MS);
    expect(planShake({ seed: 1, intensity: 0, durationMs: 200 }).offsets).toEqual([]);
    expect(planShake({ seed: 1, intensity: NaN, durationMs: 200 }).offsets).toEqual([]);
    expect(planShake({ seed: 1, intensity: 3, durationMs: 0 }).durationMs).toBeGreaterThan(0);
    for (const spec of Object.values(SHAKE_KINDS)) {
      expect(spec.intensity).toBeLessThanOrEqual(4);
      expect(spec.durationMs).toBeGreaterThanOrEqual(150);
      expect(spec.durationMs).toBeLessThanOrEqual(350);
    }
    // Crits are the smallest, the stone break and the Entity's splash the largest.
    expect(SHAKE_KINDS.crit.intensity).toBeLessThan(SHAKE_KINDS.stone.intensity);
    expect(SHAKE_KINDS.crit.intensity).toBeLessThan(SHAKE_KINDS.splash.intensity);
  });

  it('never calls Math.random', () => {
    banMathRandom();
    expect(() => {
      const plan = planShake({ seed: shakeSeed('stone', 2), intensity: 4, durationMs: 320 });
      shakeOffsetAt(plan, 50);
    }).not.toThrow();
  });
});

describe('ScreenShakeController', () => {
  it('offsets the render matrix by the plan, then leaves the camera exactly as it was', () => {
    banMathRandom();
    const { scene, camera, advance } = makeScene();
    const shake = new ScreenShakeController(scene);
    expect(camera.render()).toEqual({ x: 0, y: 0 });
    expect(shake.shake('stone')).toBe(true);
    expect(shake.playing).toBe(true);
    expect(camera.listenerCount()).toBe(1);

    const plan = planShake({
      seed: shakeSeed('stone', 0),
      intensity: SHAKE_KINDS.stone.intensity,
      durationMs: SHAKE_KINDS.stone.durationMs,
    });
    const seen = [];
    for (let t = 0; t < plan.durationMs; t += SHAKE_STEP_MS) {
      expect(camera.render()).toEqual(shakeOffsetAt(plan, t));
      seen.push(camera.render());
      advance(SHAKE_STEP_MS);
    }
    expect(seen.some((o) => o.x !== 0 || o.y !== 0)).toBe(true);
    // Past the end: at rest, the listener gone, nothing queued.
    advance(50);
    expect(camera.render()).toEqual({ x: 0, y: 0 });
    expect(shake.playing).toBe(false);
    expect(camera.listenerCount()).toBe(0);
    expect(camera.scrollX).toBe(12);
    expect(camera.zoom).toBe(2);
  });

  it('is at rest the next frame after reset, destroy, and Reduce motion turning on mid-shake', () => {
    for (const cut of ['reset', 'destroy']) {
      const { scene, camera, advance } = makeScene();
      const shake = new ScreenShakeController(scene);
      shake.shake('splash');
      advance(SHAKE_STEP_MS * 2);
      expect(camera.render()).not.toEqual({ x: 0, y: 0 });
      shake[cut]();
      expect(camera.render()).toEqual({ x: 0, y: 0 });
      expect(camera.listenerCount()).toBe(0);
    }
    // Reduce motion turns on under a playing shake: it lets go at its next frame.
    const { scene, camera, advance } = makeScene();
    const shake = new ScreenShakeController(scene);
    shake.shake('splash');
    scene._reduceMotion = () => true;
    advance(SHAKE_STEP_MS);
    expect(camera.render()).toEqual({ x: 0, y: 0 });
    expect(camera.listenerCount()).toBe(0);
  });

  it('a second shake over the first replaces it only when it starts as strong; no drift', () => {
    const { scene, camera, advance } = makeScene();
    const shake = new ScreenShakeController(scene);
    expect(shake.shake('crit')).toBe(true); // 2px
    advance(SHAKE_STEP_MS);
    expect(shake.shake('stone')).toBe(true); // 4px: stronger, replaces
    expect(camera.listenerCount()).toBe(1);
    advance(SHAKE_STEP_MS);
    // A weaker one while the stone shake is still big is dropped, not stacked.
    expect(shake.shake('crit')).toBe(false);
    expect(camera.listenerCount()).toBe(1);
    // Never more than the strongest shake's peak, at any frame, over the whole overlap.
    const peak = SHAKE_KINDS.stone.intensity;
    for (let t = 0; t < 500; t += SHAKE_STEP_MS) {
      const o = camera.render();
      expect(Math.abs(o.x)).toBeLessThanOrEqual(peak);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(peak);
      advance(SHAKE_STEP_MS);
    }
    expect(camera.render()).toEqual({ x: 0, y: 0 });
    expect(camera.listenerCount()).toBe(0);
    // And it can be played again afterwards.
    expect(shake.shake('boss')).toBe(true);
    expect(camera.listenerCount()).toBe(1);
  });

  it('plays the same shake the same way each time it is shown', () => {
    const run = () => {
      const { scene, camera, advance } = makeScene();
      const shake = new ScreenShakeController(scene);
      shake.shake('crit');
      const frames = [];
      for (let t = 0; t < 200; t += SHAKE_STEP_MS) {
        frames.push(camera.render());
        advance(SHAKE_STEP_MS);
      }
      return frames;
    };
    expect(run()).toEqual(run());
  });

  it('does nothing with Reduce motion on', () => {
    const { scene, camera } = makeScene({ reduced: true });
    const shake = new ScreenShakeController(scene);
    expect(shake.shake('stone')).toBe(false);
    expect(shake.playing).toBe(false);
    expect(camera.listenerCount()).toBe(0);
    expect(camera.render()).toEqual({ x: 0, y: 0 });
  });

  it('skips at Instant speed and plays shorter at Fast', () => {
    const instant = makeScene({ speed: 'instant' });
    expect(new ScreenShakeController(instant.scene).shake('stone')).toBe(false);
    expect(instant.camera.listenerCount()).toBe(0);

    const length = (speed) => {
      const { scene, camera, advance } = makeScene({ speed });
      new ScreenShakeController(scene).shake('stone');
      let t = 0;
      while (camera.listenerCount() > 0 && t < 2000) {
        camera.render();
        advance(SHAKE_STEP_MS);
        t += SHAKE_STEP_MS;
      }
      return t;
    };
    expect(length('fast')).toBeLessThan(length('normal'));
  });

  it('never shakes without a separate UI camera (the HUD would shake with the world)', () => {
    const { scene, camera } = makeScene({ ui: false });
    const shake = new ScreenShakeController(scene);
    expect(shake.shake('crit')).toBe(false);
    expect(camera.listenerCount()).toBe(0);
    // Desktop's ungraded UI camera counts.
    scene._atmosphere = { uiCamera: { id: 3 } };
    expect(shake.shake('crit')).toBe(true);
  });

  it('only listens on the world camera, never the UI camera', () => {
    const { scene } = makeScene();
    const on = vi.fn();
    scene._uiCamera = { id: 2, on, off: vi.fn(), matrix: { tx: 0, ty: 0 } };
    new ScreenShakeController(scene).shake('crit');
    expect(on).not.toHaveBeenCalled();
  });

  it('swallows a failing camera and a destroyed scene', () => {
    const { scene } = makeScene();
    scene.cameras.main.on = () => {
      throw new Error('boom');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shake = new ScreenShakeController(scene);
    expect(() => shake.shake('crit')).not.toThrow();
    expect(shake.playing).toBe(false);
    warn.mockRestore();
    const gone = new ScreenShakeController(makeScene().scene);
    gone.destroy();
    expect(gone.shake('crit')).toBe(false);
  });
});

describe('CombatFxController.shake', () => {
  it('shakes on a crit (no striker graphic needed) and is cut by reset()', () => {
    const { scene, camera, advance } = makeScene();
    const fx = new CombatFxController(scene);
    fx.critImpact({}); // no graphic: no scale pop, but the shake still plays
    expect(camera.listenerCount()).toBe(1);
    advance(SHAKE_STEP_MS);
    expect(camera.render()).not.toEqual({ x: 0, y: 0 });
    fx.reset();
    expect(camera.render()).toEqual({ x: 0, y: 0 });
    expect(camera.listenerCount()).toBe(0);
  });

  it('is off with Reduce motion and after destroy()', () => {
    const reduced = makeScene({ reduced: true });
    const fx = new CombatFxController(reduced.scene);
    fx.critImpact({});
    expect(fx.shake('stone')).toBe(false);
    expect(reduced.camera.listenerCount()).toBe(0);

    const live = makeScene();
    const fx2 = new CombatFxController(live.scene);
    expect(fx2.shake('stone')).toBe(true);
    fx2.destroy();
    expect(live.camera.listenerCount()).toBe(0);
    expect(fx2.shake('stone')).toBe(false);
  });

  it('never draws Math.random, however many shakes play', () => {
    banMathRandom();
    const { scene, camera, advance } = makeScene();
    const fx = new CombatFxController(scene);
    for (const kind of Object.keys(SHAKE_KINDS)) {
      fx.shake(kind);
      for (let i = 0; i < 30; i++) {
        camera.render();
        advance(SHAKE_STEP_MS);
      }
    }
    fx.destroy();
  });
});
