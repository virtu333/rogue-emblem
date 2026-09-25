// Combat v2 runtime against a recording stub scene (no Phaser): step order and waits,
// cleanup (units home, untinted, scale 1, no live objects) and no battle-RNG use.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1, NORMAL: 0 } } }));
import { CombatChoreography } from '../src/ui/CombatChoreography.js';
import { CombatFxController } from '../src/ui/CombatFxController.js';
import { FxMotePool } from '../src/ui/FxMotePool.js';

function makeObject(kind, x = 0, y = 0) {
  const o = {
    kind,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    depth: 0,
    visible: true,
    active: true,
    scene: {},
    tint: null,
    isTinted: false,
    anims: { isPlaying: false, timeScale: 1 },
    destroyed: false,
  };
  const chain = (name, fn) => {
    o[name] = vi.fn((...args) => {
      fn?.(...args);
      return o;
    });
  };
  chain('setDepth', (d) => (o.depth = d));
  chain('setBlendMode');
  chain('setRotation');
  chain('setScale');
  chain('setOrigin');
  chain('setFlipX');
  chain('setFrame', (f) => (o.frame = { name: f }));
  chain('setAlpha', (a) => (o.alpha = a));
  chain('setVisible', (v) => (o.visible = v));
  chain('setPosition', (px, py) => {
    o.x = px;
    o.y = py;
  });
  chain('setDisplaySize');
  chain('setTint', (c) => {
    o.tint = c;
    o.isTinted = true;
  });
  chain('setTintFill', (c) => {
    o.tint = c;
    o.isTinted = true;
  });
  chain('clearTint', () => {
    o.tint = null;
    o.isTinted = false;
  });
  chain('play', () => (o.anims.isPlaying = true));
  o.once = vi.fn();
  o.destroy = vi.fn(() => {
    o.destroyed = true;
    o.active = false;
    o.scene = undefined;
  });
  return o;
}

function makeScene({ speed = 'normal', reduced = false, quality = 'high' } = {}) {
  const labels = [];
  const created = [];
  const tweens = [];
  const timers = [];
  const scene = {
    labels,
    created,
    tweenLog: tweens,
    registry: { get: (k) => (k === 'settings' ? { getBattleSpeed: () => speed } : null) },
    _reduceMotion: () => reduced,
    _effectsQuality: () => quality,
    sys: { isActive: () => true },
    turnManager: { turnNumber: 3 },
    grid: {
      getTerrainAt: () => ({ name: 'Plain' }),
      gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
    },
    cameras: { main: { width: 640, height: 480, zoom: 1, setZoom: vi.fn() } },
    textures: { exists: (k) => k === 'fx_atlas' },
    anims: { exists: () => false, create: vi.fn() },
    events: { on: vi.fn(), off: vi.fn() },
    time: {
      now: 0,
      delayedCall: vi.fn((ms, cb) => {
        const t = { ms, cb, remove: vi.fn(() => (t.removed = true)) };
        timers.push(t);
        return t;
      }),
    },
    tweens: {
      add: vi.fn((cfg) => {
        const t = { cfg, remove: vi.fn(() => (t.removed = true)) };
        tweens.push(t);
        return t;
      }),
      killTweensOf: vi.fn(),
    },
    add: {
      sprite: vi.fn((x, y) => {
        const o = makeObject('sprite', x, y);
        created.push(o);
        return o;
      }),
      image: vi.fn((x, y) => {
        const o = makeObject('image', x, y);
        created.push(o);
        return o;
      }),
    },
    _awaitSceneDelay: vi.fn(async (ms, { label } = {}) => {
      labels.push(label);
    }),
    _awaitSceneTween: vi.fn(async (cfg, { label } = {}) => {
      labels.push(label);
      const targets = Array.isArray(cfg.targets) ? cfg.targets : [cfg.targets];
      for (const t of targets)
        for (const k of ['x', 'y', 'alpha', 'u', 'p']) if (k in cfg) t[k] = cfg[k];
      cfg.onUpdate?.();
      cfg.onComplete?.();
    }),
  };
  return scene;
}

function unit(name, faction, col, row) {
  const g = makeObject('unit', col * 32 + 16, row * 32 + 16);
  g.texture = { key: 'u', has: () => false };
  g.frame = { name: 'idle0' };
  g.displayHeight = 64;
  return { name, battleEntityId: name, faction, col, row, graphic: g, weapon: null };
}

const home = (u) => ({
  x: u.graphic.x,
  y: u.graphic.y,
  sx: u.graphic.scaleX,
  sy: u.graphic.scaleY,
});

let rng;
beforeEach(() => {
  rng = vi.spyOn(Math, 'random');
});
afterEach(() => rng.mockRestore());

async function strike(scene, opts) {
  const a = opts.a || unit('Edric', 'player', 2, 2);
  const b = opts.b || unit('Knight', 'enemy', 2 + (opts.distance || 1), 2);
  a.weapon = { name: opts.weapon || 'Iron Sword', type: opts.type || 'Sword' };
  const before = [home(a), home(b)];
  const calls = [];
  await new CombatChoreography(scene).playStrike({
    event: { miss: Boolean(opts.miss), isCrit: Boolean(opts.crit), damage: 5 },
    striker: a,
    target: b,
    split: { striker: [], target: [] },
    followUp: false,
    windUp: false,
    strikeIndex: 0,
    onContact: () => calls.push(['contact', [...scene.labels]]),
    onMiss: () => calls.push(['miss', [...scene.labels]]),
  });
  return { a, b, before, calls };
}

describe('CombatChoreography', () => {
  it('melee hit: lunge, contact, hit-stop, hold, recover; everything settles', async () => {
    const scene = makeScene();
    const { a, b, before, calls } = await strike(scene, {});
    expect(scene.labels).toEqual([
      'combat_fx_lunge_forward',
      'combat_fx_hit_stop',
      'animate_strike_hit_hold',
      'combat_fx_lunge_back',
    ]);
    // Numbers appear at contact, before the freeze.
    expect(calls).toEqual([['contact', ['combat_fx_lunge_forward']]]);
    expect([home(a), home(b)]).toEqual(before);
    expect(b.graphic.isTinted).toBe(false);
    expect(a.graphic._fxHomeX).toBeUndefined();
    const fx = scene._combatFx;
    expect(fx.liveObjects).toMatchObject({ strike: 0, tweens: 0, timers: 0, poses: 0 });
    // Overlays still animating finish on their own; a reset (rewind) drops them too.
    const sprites = scene.created.filter((o) => o.kind === 'sprite');
    expect(sprites.length).toBeGreaterThan(0);
    for (const o of sprites) expect(o.destroyed || fx._lingering.has(o)).toBe(true);
    fx.reset();
    for (const o of sprites) expect(o.destroyed).toBe(true);
    for (const t of scene.tweenLog) expect(t.removed || t.cfg.onComplete).toBeTruthy();
    expect(rng).not.toHaveBeenCalled();
  });

  it('ranged: the arrow travels before contact and the archer settles without a wait', async () => {
    const scene = makeScene();
    const { a, b, before } = await strike(scene, { distance: 2, weapon: 'Iron Bow', type: 'Bow' });
    expect(scene.labels).toEqual([
      'combat_fx_lunge_forward',
      'combat_fx_travel',
      'combat_fx_hit_stop',
      'animate_strike_hit_hold',
    ]);
    expect(scene.created.some((o) => o.kind === 'sprite')).toBe(true);
    expect([home(a), home(b)]).toEqual(before);
    expect(rng).not.toHaveBeenCalled();
  });

  it('miss: dodge with an afterimage, the miss hold, recover', async () => {
    const scene = makeScene();
    const { a, b, before, calls } = await strike(scene, { miss: true });
    expect(scene.labels).toEqual([
      'combat_fx_lunge_forward',
      'animate_strike_miss_hold',
      'combat_fx_lunge_back',
    ]);
    expect(calls[0][0]).toBe('miss');
    expect([home(a), home(b)]).toEqual(before);
  });

  it('crit: longer freeze, ink vignette needs a canvas (skipped headless), shock + starburst', async () => {
    const scene = makeScene();
    await strike(scene, { crit: true });
    expect(
      scene._awaitSceneDelay.mock.calls.find(([, o]) => o.label === 'combat_fx_hit_stop')[0],
    ).toBe(110);
    expect(rng).not.toHaveBeenCalled();
  });

  it('Instant adds no waits beyond the legacy ones and draws no travel', async () => {
    const scene = makeScene({ speed: 'instant' });
    await strike(scene, { distance: 2, weapon: 'Iron Bow', type: 'Bow' });
    expect(scene.labels).toEqual([
      'combat_fx_lunge_forward',
      'animate_strike_hit_hold',
      'combat_fx_lunge_back',
    ]);
  });

  it('reduced motion: no displacement at all, only the hold', async () => {
    const scene = makeScene({ reduced: true });
    const { a, b, before } = await strike(scene, { crit: true });
    expect(scene.labels).toEqual(['animate_strike_hit_hold']);
    const moves = scene.tweenLog.filter((t) => 'x' in t.cfg || 'y' in t.cfg || 'scaleX' in t.cfg);
    expect(moves).toEqual([]);
    expect([home(a), home(b)]).toEqual(before);
  });

  it('low quality keeps motion but spawns no effect sprites', async () => {
    const scene = makeScene({ quality: 'low' });
    await strike(scene, { crit: true });
    expect(scene.created.filter((o) => o.kind === 'sprite')).toEqual([]);
    expect(scene.labels).toContain('combat_fx_hit_stop');
  });

  it('an interrupted strike (rewind mid-freeze) leaves units home, untinted, at scale 1', async () => {
    const scene = makeScene();
    let release;
    scene._awaitSceneDelay = vi.fn(
      (ms, { label } = {}) =>
        new Promise((resolve) => {
          scene.labels.push(label);
          if (label === 'combat_fx_hit_stop') release = resolve;
          else resolve();
        }),
    );
    const a = unit('Edric', 'player', 2, 2);
    const b = unit('Knight', 'enemy', 3, 2);
    const before = [home(a), home(b)];
    a.weapon = { name: 'Iron Sword', type: 'Sword' };
    const run = new CombatChoreography(scene).playStrike({
      event: { isCrit: true, damage: 9 },
      striker: a,
      target: b,
      split: { striker: [], target: [] },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.labels).toContain('combat_fx_hit_stop');
    // Mid-freeze: the target is flashed and the striker sits at its contact point.
    expect(b.graphic.isTinted).toBe(true);
    a.graphic.x += 10;
    a.graphic.scaleX = 1.18;
    scene._combatFx.reset();
    expect([home(a), home(b)]).toEqual(before);
    expect(b.graphic.isTinted).toBe(false);
    expect(scene._combatFx.liveObjects).toMatchObject({
      strike: 0,
      tweens: 0,
      timers: 0,
      lingering: 0,
    });
    // The rest of the strike belongs to the discarded timeline: it stops, drawing,
    // moving and waiting on nothing more.
    const createdAtReset = scene.created.length;
    const labelsAtReset = scene.labels.length;
    const tweensAtReset = scene.tweenLog.length;
    release();
    await run;
    expect(scene.created.length).toBe(createdAtReset);
    expect(scene.labels.length).toBe(labelsAtReset);
    expect(scene.tweenLog.length).toBe(tweensAtReset);
    expect([home(a), home(b)]).toEqual(before);
    expect(b.graphic.isTinted).toBe(false);
    expect(rng).not.toHaveBeenCalled();
  });

  for (const [label, interrupt] of [
    ['a shutdown mid-lunge', (scene) => scene._combatFx.destroy()],
    ['a rewind mid-flight', (scene) => scene._combatFx.reset()],
  ])
    it(`${label} stops the strike: nothing more is drawn, units home, untinted`, async () => {
      const scene = makeScene();
      const pending = [];
      scene._awaitSceneTween = vi.fn(
        (cfg, { label: l } = {}) =>
          new Promise((resolve) => {
            scene.labels.push(l);
            pending.push({ cfg, resolve });
          }),
      );
      const ranged = label.includes('flight');
      const a = unit('Edric', 'player', 2, 2);
      const b = unit('Knight', 'enemy', ranged ? 4 : 3, 2);
      a.weapon = ranged ? { name: 'Iron Bow', type: 'Bow' } : { name: 'Iron Sword', type: 'Sword' };
      const before = [home(a), home(b)];
      const contacts = [];
      const run = new CombatChoreography(scene).playStrike({
        event: { damage: 4 },
        striker: a,
        target: b,
        split: { striker: [], target: [] },
        onContact: () => contacts.push('contact'),
      });
      const settleOne = async () => {
        await Promise.resolve();
        const p = pending.shift();
        const targets = Array.isArray(p.cfg.targets) ? p.cfg.targets : [p.cfg.targets];
        for (const t of targets) for (const k of ['x', 'y', 'u']) if (k in p.cfg) t[k] = p.cfg[k];
        p.cfg.onUpdate?.();
        return p;
      };
      await Promise.resolve();
      // Mid-lunge (or mid-flight after the draw): interrupt, then let the await settle.
      let p = await settleOne();
      if (ranged) {
        p.resolve();
        await Promise.resolve();
        await Promise.resolve();
        p = await settleOne(); // the flight
        expect(scene.labels).toContain('combat_fx_travel');
      }
      interrupt(scene);
      const fx = scene._combatFx;
      const created = scene.created.length;
      p.resolve();
      await run;
      expect(scene.created.length).toBe(created);
      expect(contacts).toEqual([]);
      expect([home(a), home(b)]).toEqual(before);
      expect([a, b].map((u) => u.graphic.isTinted)).toEqual([false, false]);
      expect(fx.liveObjects).toMatchObject({ strike: 0, tweens: 0, timers: 0, poses: 0 });
      // Everything is gone except pooled motes, which are parked hidden for reuse.
      const pooled = new Set((fx.motes?.records || []).map((r) => r.image));
      for (const o of scene.created) {
        if (pooled.has(o)) expect(o.visible).toBe(false);
        else expect(o.destroyed).toBe(true);
      }
      expect(rng).not.toHaveBeenCalled();
    });

  it('a rewind while the lunge tween is still running stops it (the unit stays home)', async () => {
    // Traced sprites hold their pose from the start of the lunge, so a rewind can land
    // before contact, with the scene's lunge tween still carrying the striker forward.
    const scene = makeScene();
    const live = [];
    scene._awaitSceneTween = vi.fn(
      (cfg, { label: l } = {}) =>
        new Promise((resolve) => {
          scene.labels.push(l);
          const tween = {
            cfg,
            stopped: false,
            stop: vi.fn(() => {
              tween.stopped = true;
              cfg.onStop?.();
              resolve();
            }),
            finish() {
              // the game loop running the tween to its end
              const targets = Array.isArray(cfg.targets) ? cfg.targets : [cfg.targets];
              for (const t of targets) for (const k of ['x', 'y']) if (k in cfg) t[k] = cfg[k];
              resolve();
            },
          };
          live.push(tween);
        }),
    );
    scene.tweens.getTweensOf = vi.fn((g) =>
      live.filter((t) => !t.stopped && [].concat(t.cfg.targets).includes(g)),
    );
    const a = unit('Edric', 'player', 2, 2);
    const b = unit('Knight', 'enemy', 3, 2);
    a.weapon = { name: 'Iron Sword', type: 'Sword' };
    const before = [home(a), home(b)];
    const contacts = [];
    const run = new CombatChoreography(scene).playStrike({
      event: { damage: 4 },
      striker: a,
      target: b,
      split: { striker: [], target: [] },
      onContact: () => contacts.push('contact'),
    });
    await Promise.resolve();
    expect(scene.labels).toContain('combat_fx_lunge_forward');
    scene._combatFx.reset();
    // whatever the game loop still runs afterwards must not move anyone
    for (const t of live.filter((x) => !x.stopped)) t.finish();
    await run;
    expect(live[0].stop).toHaveBeenCalled();
    expect(contacts).toEqual([]);
    expect([home(a), home(b)]).toEqual(before);
    expect(scene._combatFx.liveObjects).toMatchObject({ poses: 0, tweens: 0 });
  });
});

describe('CombatFxController lifecycle', () => {
  it('lingering overlays finish on their own; reset and destroy drop them', () => {
    const scene = makeScene();
    const fx = new CombatFxController(scene);
    const playing = makeObject('sprite');
    playing._fxLinger = true;
    playing.anims.isPlaying = true;
    const idle = makeObject('sprite');
    fx._sprites.add(playing);
    fx._sprites.add(idle);
    fx.finishStrike();
    expect(idle.destroyed).toBe(true);
    expect(playing.destroyed).toBe(false);
    expect(fx.liveObjects.lingering).toBe(1);
    fx.destroy();
    expect(playing.destroyed).toBe(true);
    expect(fx.liveObjects.lingering).toBe(0);
  });

  it('releaseUnit frees a unit mid-death and restores its texture before removal', () => {
    const scene = makeScene();
    scene.textures.exists = (k) => k === 'fx_atlas' || k === 'fx-dissolve-x';
    scene.textures.remove = vi.fn();
    const fx = new CombatFxController(scene);
    const u = unit('Knight', 'enemy', 1, 1);
    u.graphic.texture.key = 'fx-dissolve-x';
    u.graphic.setTexture = vi.fn();
    fx._dissolves.set(u, {
      key: 'fx-dissolve-x',
      graphic: u.graphic,
      restoreKey: 'u',
      restoreFrame: 'idle0',
    });
    fx.releaseUnit(u);
    expect(u.graphic.setTexture).toHaveBeenCalledWith('u', 'idle0');
    expect(scene.textures.remove).toHaveBeenCalledWith('fx-dissolve-x');
    expect(fx.liveObjects.dissolves).toBe(0);
  });

  it('traced poses show windup/strike and always restore an idle frame', () => {
    const scene = makeScene();
    const fx = new CombatFxController(scene);
    const u = unit('Edric', 'player', 1, 1);
    u.graphic.texture.has = (f) => ['idle0', 'idle1', 'windup', 'strike'].includes(f);
    u.graphic.frame = { name: 'idle1' };
    expect(fx.setPose(u, 'windup')).toBe(true);
    expect(u.graphic.frame.name).toBe('windup');
    fx.setPose(u, 'strike');
    // The idle ticker repaints mid-lunge; the pose guard wins before render.
    u.graphic.frame = { name: 'idle2' };
    fx._reassertPoses();
    expect(u.graphic.frame.name).toBe('strike');
    fx.finishStrike();
    expect(u.graphic.frame.name).toBe('idle1');
    expect(u.graphic._fxPose).toBeUndefined();
    expect(scene.events.off).toHaveBeenCalledWith('postupdate', expect.any(Function));
    // Units without traced frames fall back cleanly.
    const plain = unit('Knight', 'enemy', 2, 1);
    expect(fx.setPose(plain, 'windup')).toBe(false);
  });
});

describe('ballista bolts', () => {
  for (const [speed, reduced] of [
    ['normal', false],
    ['fast', false],
    ['instant', false],
    ['normal', true],
  ])
    it(`fly, hold the impact, knock back and settle home (${speed}${reduced ? ', reduced' : ''})`, async () => {
      const scene = makeScene({ speed, reduced });
      const fx = new CombatFxController(scene);
      const target = unit('Edric', 'player', 5, 2);
      const before = home(target);
      await fx.ballistaShot({ col: 1, row: 2 }, target, { hit: true, seed: 7 });
      const full = speed !== 'instant' && !reduced;
      expect(scene.labels).toEqual(
        full
          ? ['combat_fx_travel', 'combat_fx_hit_stop']
          : speed === 'fast'
            ? ['combat_fx_hit_stop']
            : [],
      );
      expect(target.graphic.isTinted).toBe(true);
      // The settle timer ends the beat: home, untinted, no stale home left behind.
      for (const t of scene.time.delayedCall.mock.results.map((r) => r.value))
        if (!t.removed) t.cb();
      expect(home(target)).toEqual(before);
      expect(target.graphic.isTinted).toBe(false);
      expect(target.graphic._fxHomeX).toBeUndefined();
      expect(fx.liveObjects).toMatchObject({ tweens: 0, timers: 0, poses: 0 });
      expect(rng).not.toHaveBeenCalled();
    });
});

describe('FxMotePool', () => {
  it('is bounded, reuses images and retires motes without Math.random', () => {
    const scene = makeScene();
    const pool = new FxMotePool(scene, { capacity: 8 });
    let spawned = 0;
    for (let i = 0; i < 20; i++) if (pool.spawn({ x: 0, y: 0, dy: -10, lifeMs: 100 })) spawned++;
    expect(spawned).toBe(8);
    expect(scene.created.filter((o) => o.kind === 'image')).toHaveLength(8);
    scene.time.now = 50;
    pool.update();
    expect(pool.liveCount).toBe(8);
    scene.time.now = 200;
    pool.update();
    expect(pool.liveCount).toBe(0);
    expect(scene.events.off).toHaveBeenCalled();
    for (let i = 0; i < 4; i++) pool.spawn({ x: 0, y: 0, lifeMs: 100 });
    expect(scene.created.filter((o) => o.kind === 'image')).toHaveLength(8);
    pool.releaseAll();
    expect(pool.liveCount).toBe(0);
    pool.destroy();
    for (const o of scene.created) expect(o.destroyed).toBe(true);
    expect(rng).not.toHaveBeenCalled();
  });
});
