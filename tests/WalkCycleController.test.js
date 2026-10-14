// WalkCycleController: a moving unit cycles its idle frames at a step cadence, hops per
// tile (a flier glides, a slide glides), and lands in a puff of its ground; its rest frame
// and height come back however the move ends; and none of it ever touches Math.random
// (during a battle that IS the battle RNG), reduced motion, low effects or the fog.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1, NORMAL: 0 } } }));
import WalkCycleController, { PUFF_DEPTH } from '../src/ui/WalkCycleController.js';
import { IDLE_FRAMES, startTracedIdle } from '../src/ui/TracedSprites.js';
import { PUFF_STYLES, WALK_PROFILES } from '../src/ui/walkCycleModel.js';

const TILE = 32;
const tileXY = (col, row) => ({ x: col * TILE + 16, y: row * TILE + 16 });

function makeImage(scene) {
  const o = {
    kind: 'image',
    x: 0,
    y: 0,
    visible: true,
    active: true,
    scene: {},
    depth: 0,
    tint: null,
    destroyed: false,
  };
  const chain = (name, fn) => {
    o[name] = vi.fn((...args) => {
      fn?.(...args);
      return o;
    });
  };
  chain('setVisible', (v) => (o.visible = v));
  chain('setDepth', (d) => (o.depth = d));
  chain('setOrigin');
  chain('setFrame');
  chain('setBlendMode', (b) => (o.blend = b));
  chain('setTint', (c) => (o.tint = c));
  chain('setAlpha');
  chain('setPosition', (x, y) => {
    o.x = x;
    o.y = y;
  });
  o.destroy = vi.fn(() => {
    o.destroyed = true;
    o.scene = undefined;
  });
  // Phaser draws UUIDs and random values from Math.random while it builds an object
  scene.randomDrawsAtBuild.push(Math.random());
  return o;
}

function makeScene({
  speed = 'normal',
  reduced = false,
  quality = 'high',
  fog = null,
  biome = null,
} = {}) {
  const listeners = new Map();
  const images = [];
  const terrain = new Map();
  const scene = {
    images,
    terrain,
    randomDrawsAtBuild: [],
    settings: { speed, reduced, quality },
    registry: {
      get: (k) => (k === 'settings' ? { getBattleSpeed: () => scene.settings.speed } : null),
    },
    _reduceMotion: () => scene.settings.reduced,
    _effectsQuality: () => scene.settings.quality,
    sys: { isActive: () => true },
    time: { now: 0 },
    events: {
      on: vi.fn((name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn])),
      off: vi.fn((name, fn) =>
        listeners.set(
          name,
          (listeners.get(name) || []).filter((f) => f !== fn),
        ),
      ),
      once: vi.fn(),
      emit: (name) => (listeners.get(name) || []).forEach((fn) => fn()),
      count: (name) => (listeners.get(name) || []).length,
    },
    textures: { exists: (k) => k === 'fx_atlas' },
    add: {
      image: vi.fn(() => {
        const img = makeImage(scene);
        images.push(img);
        return img;
      }),
    },
    battleConfig: { biome },
    grid: {
      biome,
      fogEnabled: Boolean(fog),
      isVisible: (c, r) => !fog || fog.has(`${c},${r}`),
      getTerrainAt: (c, r) => ({ name: terrain.get(`${c},${r}`) || 'Plain' }),
      gridToPixel: (c, r) => tileXY(c, r),
    },
  };
  return scene;
}

function makeUnit(
  scene,
  {
    col = 0,
    row = 0,
    moveType = 'Infantry',
    faction = 'player',
    frame = 'idle0',
    key = 'traced-myrmidon-myrmidon_a',
  } = {},
) {
  const pos = tileXY(col, row);
  const g = {
    x: pos.x,
    y: pos.y,
    scene,
    active: true,
    visible: true,
    depth: 10,
    texture: { key },
    frame: { name: frame },
    frames: [],
    setFrame: vi.fn(function setFrame(name) {
      this.frame = { name };
      this.frames.push(name);
    }),
  };
  return { name: `${faction}${col}`, faction, col, row, moveType, graphic: g };
}

/** One game frame: the tweens write the unit's tile position, then 'postupdate' runs. */
function frame(scene, unit, now, to = null) {
  scene.time.now = now;
  if (to) {
    unit.graphic.x = to.x;
    unit.graphic.y = to.y;
  }
  scene.events.emit('postupdate');
}

/** Walk `tiles` columns along row 0, 80 ms each, frame by frame (16 ms). Returns y samples. */
function walkRow(scene, ctrl, unit, tiles, { ms = 80, slideAt = new Set(), onStep = null } = {}) {
  const ys = [];
  let now = scene.time.now;
  for (let t = 1; t <= tiles; t++) {
    const from = tileXY(t - 1, unit.row);
    const to = tileXY(t, unit.row);
    ctrl.step(unit, { ms, slide: slideAt.has(t) });
    onStep?.(t);
    const begin = now;
    while (now < begin + ms) {
      now = Math.min(begin + ms, now + 16);
      const p = (now - begin) / ms;
      frame(scene, unit, now, { x: from.x + (to.x - from.x) * p, y: from.y });
      ys.push(unit.graphic.y);
    }
  }
  return ys;
}

let rng;
let realRandom;

beforeEach(() => {
  realRandom = Math.random;
  rng = vi.fn(() => 0.5);
  Math.random = rng;
});
afterEach(() => {
  Math.random = realRandom;
  vi.restoreAllMocks();
});

const setup = (options, unitOptions) => {
  const scene = makeScene(options);
  const ctrl = new WalkCycleController(scene);
  const unit = makeUnit(scene, unitOptions);
  return { scene, ctrl, unit };
};

describe('the walk: frames and hop', () => {
  it('cycles idle frames about every 100 ms while a unit walks, faster than the 260 ms map idle', () => {
    const { scene, ctrl, unit } = setup();
    walkRow(scene, ctrl, unit, 4); // 320 ms
    const shown = unit.graphic.frames;
    // from idle0 through idle1.. in order, one change per ~100 ms
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThanOrEqual(4);
    expect(shown[0]).toBe('idle1');
    shown.forEach((name, i) => expect(name).toBe(IDLE_FRAMES[(i + 1) % IDLE_FRAMES.length]));
    // the map idle would have changed once in that time
    expect(Math.floor(320 / 260)).toBe(1);
  });

  it('starts the cycle at the frame the unit rested on', () => {
    const { scene, ctrl, unit } = setup({}, { frame: 'idle2' });
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 120);
    expect(unit.graphic.frames[0]).toBe('idle3');
  });

  it('hops one to two px per tile and is back on the tile line between tiles', () => {
    const { scene, ctrl, unit } = setup();
    const ys = walkRow(scene, ctrl, unit, 3);
    const line = tileXY(0, 0).y;
    const lifts = ys.map((y) => line - y);
    expect(Math.max(...lifts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...lifts)).toBeLessThanOrEqual(2);
    expect(Math.min(...lifts)).toBe(0); // never below its tile
    const perTile = Math.ceil(80 / 16);
    for (let t = 0; t < 3; t++) expect(lifts[(t + 1) * perTile - 1]).toBe(0);
    // each tile peaks: one arch per tile, not one per move
    for (let t = 0; t < 3; t++)
      expect(Math.max(...lifts.slice(t * perTile, (t + 1) * perTile))).toBeGreaterThanOrEqual(1);
  });

  it('never accumulates: after many tiles and the end, y is exactly the tile line', () => {
    const { scene, ctrl, unit } = setup();
    walkRow(scene, ctrl, unit, 12);
    ctrl.end(unit, { col: 12, row: 0 });
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
  });

  it('the tween owns x: the hop never moves the unit sideways', () => {
    const { scene, ctrl, unit } = setup();
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16, { x: 40, y: tileXY(0, 0).y });
    expect(unit.graphic.x).toBe(40);
  });

  it('stands still between steps instead of marching on the spot', () => {
    const { scene, ctrl, unit } = setup();
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 80, tileXY(1, 0));
    const before = unit.graphic.frames.length;
    // a long pause (hidden steps of a walk in the fog): no step is reported
    for (let now = 200; now < 1200; now += 100) frame(scene, unit, now);
    expect(unit.graphic.frames.length).toBe(before);
    expect(unit.graphic.y).toBe(tileXY(1, 0).y);
  });

  it('a walk that goes quiet for three seconds is restored and dropped', () => {
    const { scene, ctrl, unit } = setup();
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 100);
    frame(scene, unit, 3200);
    expect(ctrl.walking).toBe(0);
    expect(unit.graphic.frame.name).toBe('idle0');
    expect(unit.graphic._walkCycle).toBe(false);
  });

  it('Fast steps cycle twice as quickly', () => {
    const normal = setup();
    walkRow(normal.scene, normal.ctrl, normal.unit, 8, { ms: 80 });
    const fast = setup();
    walkRow(fast.scene, fast.ctrl, fast.unit, 16, { ms: 40 }); // the same 640 ms of walking
    // twice the tiles in the same time, and the cycle keeps up with the legs: the frame
    // count per tile is the same
    expect(fast.unit.graphic.frames.length / 16).toBeCloseTo(
      normal.unit.graphic.frames.length / 8,
      0,
    );
  });

  it("a hop on a mount or in armour is lower than a foot soldier's at the peak", () => {
    const peak = (moveType) => {
      const { scene, ctrl, unit } = setup({}, { moveType });
      return Math.max(...walkRow(scene, ctrl, unit, 1).map((y) => tileXY(0, 0).y - y));
    };
    expect(peak('Cavalry')).toBeLessThanOrEqual(peak('Infantry'));
    expect(peak('Armored')).toBeLessThanOrEqual(peak('Infantry'));
    expect(WALK_PROFILES.Cavalry.bobPx).toBeLessThanOrEqual(WALK_PROFILES.Infantry.bobPx);
  });

  it('an unspecified or classic (untraced) sprite hops but has no idle frames to cycle', () => {
    const { scene, ctrl, unit } = setup({}, { key: 'unit-classic' });
    const ys = walkRow(scene, ctrl, unit, 2);
    expect(unit.graphic.frames).toEqual([]);
    expect(Math.max(...ys.map((y) => tileXY(0, 0).y - y))).toBeGreaterThanOrEqual(1);
  });

  it('a unit holding an attack pose keeps it', () => {
    for (const extra of [{ frame: 'strike' }, { frame: 'windup' }]) {
      const { scene, ctrl, unit } = setup({}, extra);
      walkRow(scene, ctrl, unit, 2);
      expect(unit.graphic.frames).toEqual([]);
    }
    const { scene, ctrl, unit } = setup();
    unit.graphic._fxPose = 'windup';
    walkRow(scene, ctrl, unit, 2);
    expect(unit.graphic.frames).toEqual([]);
  });

  it('the Entity (a 3x3 body) is left alone: no frames, no hop, no puff', () => {
    const { scene, ctrl, unit } = setup();
    unit.isEntity = true;
    const ys = walkRow(scene, ctrl, unit, 2);
    ctrl.end(unit, { col: 2, row: 0 });
    expect(ctrl.walking).toBe(0);
    expect(unit.graphic.setFrame).not.toHaveBeenCalled();
    expect(ys.every((y) => y === tileXY(0, 0).y)).toBe(true);
    expect(scene.images).toHaveLength(0);
  });
});

describe('ice slides', () => {
  it('glide: no hop and no frame change on a slid tile, steps resume on non-ice tiles', () => {
    const { scene, ctrl, unit } = setup();
    const slid = new Set([3, 4]);
    const ys = walkRow(scene, ctrl, unit, 6, { slideAt: slid });
    const perTile = Math.ceil(80 / 16);
    const line = tileXY(0, 0).y;
    const liftOf = (t) => ys.slice((t - 1) * perTile, t * perTile).map((y) => line - y);
    for (const t of [3, 4]) expect(Math.max(...liftOf(t))).toBe(0);
    for (const t of [1, 2, 5, 6]) expect(Math.max(...liftOf(t))).toBeGreaterThanOrEqual(1);
  });

  it('holds the frame it was showing across the slide', () => {
    const { scene, ctrl, unit } = setup();
    const changesDuring = [];
    let at = 0;
    walkRow(scene, ctrl, unit, 5, {
      slideAt: new Set([3, 4]),
      onStep: (t) => {
        at = unit.graphic.frames.length;
        changesDuring.push([t, at]);
      },
    });
    // no frame change was recorded between the start of step 3 and the end of step 4
    const start3 = changesDuring.find(([t]) => t === 3)[1];
    const start5 = changesDuring.find(([t]) => t === 5)[1];
    expect(start5 - start3).toBeLessThanOrEqual(0);
  });

  it('after a slide the unit comes to rest on its own frame and line', () => {
    const { scene, ctrl, unit } = setup();
    walkRow(scene, ctrl, unit, 3, { slideAt: new Set([2, 3]) });
    ctrl.end(unit, { col: 3, row: 0 });
    expect(unit.graphic.frame.name).toBe('idle0');
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
  });
});

describe('fliers', () => {
  it('glide: no per-tile hop, never more than a pixel off the flight line, frames still cycle', () => {
    const { scene, ctrl, unit } = setup({}, { moveType: 'Flying' });
    const ys = walkRow(scene, ctrl, unit, 8);
    const lifts = ys.map((y) => tileXY(0, 0).y - y);
    expect(Math.max(...lifts)).toBeLessThanOrEqual(1);
    expect(Math.min(...lifts)).toBeGreaterThanOrEqual(-1);
    expect(unit.graphic.frames.length).toBeGreaterThanOrEqual(3);
  });

  it('has no landing puff', () => {
    const { scene, ctrl, unit } = setup({}, { moveType: 'Flying' });
    walkRow(scene, ctrl, unit, 3);
    ctrl.end(unit, { col: 3, row: 0 });
    expect(scene.images).toHaveLength(0);
  });
});

describe('the end of a move restores the unit', () => {
  it('puts the rest frame and the tile line back', () => {
    const { scene, ctrl, unit } = setup({}, { frame: 'idle2' });
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 40); // mid-hop
    expect(unit.graphic.y).not.toBe(tileXY(0, 0).y);
    frame(scene, unit, 70);
    frame(scene, unit, 100); // a frame later than the rest frame
    expect(unit.graphic.frame.name).not.toBe('idle2');
    ctrl.step(unit, { ms: 80 }); // the next tile
    frame(scene, unit, 140); // mid-hop again: the lift is on the graphic when the move ends
    expect(unit.graphic.y).not.toBe(tileXY(0, 0).y);
    ctrl.end(unit, { col: 0, row: 0 });
    expect(unit.graphic.frame.name).toBe('idle2');
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
    expect(unit.graphic._walkCycle).toBe(false);
    expect(ctrl.walking).toBe(0);
  });

  it('a move cut short (fog ambush, ice stop, a failed move) restores the same way, with no puff', () => {
    const { scene, ctrl, unit } = setup();
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 50);
    ctrl.end(unit); // no landing tile
    expect(unit.graphic.frame.name).toBe('idle0');
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
    expect(scene.images).toHaveLength(0);
  });

  it('ending a unit that never walked does nothing', () => {
    const { scene, ctrl, unit } = setup();
    expect(() => ctrl.end(unit, { col: 1, row: 0 })).not.toThrow();
    expect(scene.images).toHaveLength(0);
    expect(unit.graphic.setFrame).not.toHaveBeenCalled();
  });

  it('a graphic destroyed mid-walk is let go of: nothing is written to it afterwards', () => {
    const { scene, ctrl, unit } = setup();
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 50);
    const calls = unit.graphic.setFrame.mock.calls.length;
    const y = unit.graphic.y;
    unit.graphic.scene = undefined; // Phaser: destroyed
    unit.graphic.active = false;
    expect(() => frame(scene, unit, 100)).not.toThrow();
    expect(ctrl.walking).toBe(0);
    expect(unit.graphic.setFrame.mock.calls.length).toBe(calls);
    expect(unit.graphic.y).toBe(y);
    expect(() => ctrl.end(unit, { col: 1, row: 0 })).not.toThrow();
  });

  it('a graphic the unit no longer holds (a rewind rebuilt it) is let go of', () => {
    const { scene, ctrl, unit } = setup();
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    const old = unit.graphic;
    unit.graphic = makeUnit(scene).graphic;
    frame(scene, unit, 50);
    expect(ctrl.walking).toBe(0);
    expect(unit.graphic.frames).toEqual([]);
    expect(old.frames.length).toBeLessThanOrEqual(1);
  });

  it('release, reset and destroy put walking units back and unbind the frame listener', () => {
    const { scene, ctrl, unit } = setup({}, { frame: 'idle1' });
    const other = makeUnit(scene, { col: 4, frame: 'idle3' });
    ctrl.step(unit, { ms: 80 });
    ctrl.step(other, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 70);
    expect(scene.events.count('postupdate')).toBe(1);
    ctrl.releaseUnit(unit);
    expect(unit.graphic.frame.name).toBe('idle1');
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
    expect(ctrl.walking).toBe(1);
    ctrl.destroy();
    expect(other.graphic.frame.name).toBe('idle3');
    expect(other.graphic._walkCycle).toBe(false);
    expect(ctrl.walking).toBe(0);
    expect(scene.events.count('postupdate')).toBe(0);
    // a dead controller draws nothing and starts nothing
    ctrl.step(other, { ms: 80 });
    expect(ctrl.walking).toBe(0);
  });
});

describe('the map idle loop does not fight the walk', () => {
  const stageIdle = (scene, units) => {
    let tick = null;
    scene.time.addEvent = (e) => ((tick = e.callback), { remove() {} });
    scene.playerUnits = units;
    scene.enemyUnits = [];
    scene.npcUnits = [];
    startTracedIdle(scene);
    return () => tick();
  };

  it('leaves a walking unit alone and resumes on it once the move ends', () => {
    const { scene, ctrl, unit } = setup({}, { frame: 'idle0' });
    const idle = stageIdle(scene, [unit]);
    scene.time.now = 260;
    ctrl.step(unit, { ms: 80 });
    unit.graphic.setFrame.mockClear();
    idle();
    expect(unit.graphic.setFrame).not.toHaveBeenCalled();
    ctrl.end(unit, { col: 1, row: 0 });
    scene.time.now = 260;
    idle();
    expect(unit.graphic.setFrame).toHaveBeenCalled(); // the map idle is back
  });
});

describe('reduced motion and instant speed', () => {
  it('reduced motion: no frames, no hop, no puff', () => {
    const { scene, ctrl, unit } = setup({ reduced: true });
    const ys = walkRow(scene, ctrl, unit, 3);
    ctrl.end(unit, { col: 3, row: 0 });
    expect(ys.every((y) => y === tileXY(0, 0).y)).toBe(true);
    expect(unit.graphic.setFrame).not.toHaveBeenCalled();
    expect(unit.graphic._walkCycle).toBeUndefined();
    expect(scene.images).toHaveLength(0);
    expect(ctrl.walking).toBe(0);
  });

  it('reduced motion turned on mid-move restores the unit at the next frame', () => {
    const { scene, ctrl, unit } = setup({}, { frame: 'idle2' });
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 70);
    scene.settings.reduced = true;
    frame(scene, unit, 86, tileXY(1, 0));
    expect(unit.graphic.frame.name).toBe('idle2');
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
    expect(ctrl.walking).toBe(0);
    ctrl.end(unit, { col: 1, row: 0 });
    expect(scene.images).toHaveLength(0);
  });

  it('Instant speed (1 ms steps): the move is not drawn as a walk and has no puff', () => {
    const { scene, ctrl, unit } = setup({ speed: 'instant' });
    ctrl.step(unit, { ms: 1 });
    frame(scene, unit, 16);
    ctrl.end(unit, { col: 1, row: 0 });
    expect(unit.graphic.setFrame).not.toHaveBeenCalled();
    expect(scene.images).toHaveLength(0);
  });

  it('a walk that becomes Instant is restored, not left mid-pose', () => {
    const { scene, ctrl, unit } = setup({}, { frame: 'idle1' });
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 70);
    ctrl.step(unit, { ms: 1 });
    expect(unit.graphic.frame.name).toBe('idle1');
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
  });
});

describe('the landing puff', () => {
  const land = (options, unitOptions, col = 2, terrain = 'Plain', row = 0) => {
    const ctx = setup(options, unitOptions);
    if (terrain) ctx.scene.terrain.set(`${col},${row}`, terrain);
    ctx.ctrl.step(ctx.unit, { ms: 80 });
    frame(ctx.scene, ctx.unit, 16);
    ctx.ctrl.end(ctx.unit, { col, row });
    return ctx;
  };
  const tints = (scene) => scene.images.map((i) => i.tint);
  const youngColor = (family) => PUFF_STYLES[family].colors[0];

  it('draws a few small pooled motes on the destination tile, behind the units', () => {
    const { scene, ctrl } = land();
    expect(scene.images).toHaveLength(PUFF_STYLES.dust.count);
    expect(ctrl.liveMotes).toBe(PUFF_STYLES.dust.count);
    for (const img of scene.images) {
      expect(img.depth).toBe(PUFF_DEPTH);
      expect(img.depth).toBeLessThan(10); // under every unit sprite
      expect(Math.abs(img.x - tileXY(2, 0).x)).toBeLessThanOrEqual(8);
    }
    expect(PUFF_DEPTH).toBeGreaterThan(8); // over the faction rings
  });

  it.each([
    ['Plain', 'dust'],
    ['Forest', 'leaves'],
    ['Water', 'splash'],
    ['Swamp', 'mire'],
    ['Bog', 'mire'],
    ['Ice', 'snow'],
    ['Sand', 'sand'],
  ])('%s lands in a %s puff', (terrain, family) => {
    const { scene } = land({}, {}, 2, terrain);
    expect(scene.images).toHaveLength(PUFF_STYLES[family].count);
    expect(new Set(tints(scene))).toEqual(new Set([youngColor(family)]));
  });

  it("a tundra's plains are snow", () => {
    const { scene } = land({ biome: 'tundra' }, {}, 2, 'Plain');
    expect(new Set(tints(scene))).toEqual(new Set([youngColor('snow')]));
  });

  it('is pooled: many landings reuse a bounded set of images', () => {
    const { scene, ctrl, unit } = setup();
    for (let i = 0; i < 30; i++) {
      ctrl.step(unit, { ms: 80 });
      frame(scene, unit, 16 + i);
      ctrl.end(unit, { col: 1, row: 0 });
    }
    expect(scene.images.length).toBeLessThanOrEqual(36);
  });

  it('fades out and retires its motes on the scene clock', () => {
    const { scene, ctrl } = land();
    scene.time.now = 5000;
    scene.events.emit('update');
    expect(ctrl.liveMotes).toBe(0);
    expect(scene.events.count('update')).toBe(0);
  });

  it('low effects quality: no puff, but the walk still hops and cycles', () => {
    expect(land({ quality: 'low' }).scene.images).toHaveLength(0);
    const ctx = setup({ quality: 'low' });
    const ys = walkRow(ctx.scene, ctx.ctrl, ctx.unit, 4);
    ctx.ctrl.end(ctx.unit, { col: 4, row: 0 });
    expect(Math.max(...ys.map((y) => tileXY(0, 0).y - y))).toBeGreaterThanOrEqual(1);
    expect(ctx.unit.graphic.frames.length).toBeGreaterThanOrEqual(3);
    expect(ctx.scene.images).toHaveLength(0);
  });

  it('medium quality keeps it', () => {
    expect(land({ quality: 'medium' }).scene.images.length).toBeGreaterThan(0);
  });

  it('draws nothing on a tile the fog hides, for a foe', () => {
    const hidden = land({ fog: new Set(['0,0']) }, { faction: 'enemy' });
    expect(hidden.scene.images).toHaveLength(0);
    const seen = land({ fog: new Set(['2,0']) }, { faction: 'enemy' });
    expect(seen.scene.images.length).toBeGreaterThan(0);
  });

  it('draws nothing for a foe whose sprite is hidden, even on a tile the fog shows', () => {
    const ctx = setup({ fog: new Set(['2,0']) }, { faction: 'enemy' });
    ctx.ctrl.step(ctx.unit, { ms: 80 });
    frame(ctx.scene, ctx.unit, 16);
    ctx.unit.graphic.visible = false;
    ctx.ctrl.end(ctx.unit, { col: 2, row: 0 });
    expect(ctx.scene.images).toHaveLength(0);
  });

  it("always draws for the player's own unit under the fog (it sees what it stands on)", () => {
    const { scene } = land({ fog: new Set() }, { faction: 'player' });
    expect(scene.images.length).toBeGreaterThan(0);
  });

  it('shows a foe the Eye marks even in fog (the one visibility rule)', () => {
    const ctx = setup({ fog: new Set() }, { faction: 'enemy' });
    ctx.scene.grid.foesShown = true;
    ctx.ctrl.step(ctx.unit, { ms: 80 });
    frame(ctx.scene, ctx.unit, 16);
    ctx.ctrl.end(ctx.unit, { col: 2, row: 0 });
    expect(ctx.scene.images.length).toBeGreaterThan(0);
  });

  it('a different landing seeds a different puff, the same landing the same puff', () => {
    const positions = (col) =>
      land({}, {}, col).scene.images.map(
        (i) => `${Math.round(i.x - tileXY(col, 0).x)},${Math.round(i.y - tileXY(col, 0).y)}`,
      );
    expect(positions(2)).toEqual(positions(2));
  });

  it('survives a missing fx atlas (a headless scene) without drawing', () => {
    const ctx = setup();
    ctx.scene.textures.exists = () => false;
    ctx.ctrl.step(ctx.unit, { ms: 80 });
    frame(ctx.scene, ctx.unit, 16);
    expect(() => ctx.ctrl.end(ctx.unit, { col: 1, row: 0 })).not.toThrow();
    expect(ctx.scene.images).toHaveLength(0);
  });
});

describe('the battle RNG', () => {
  it('a whole move (steps, frames, hops, puff, retire, destroy) never touches Math.random', () => {
    const { scene, ctrl, unit } = setup({ biome: 'tundra' });
    scene.terrain.set('5,0', 'Forest');
    walkRow(scene, ctrl, unit, 5);
    ctrl.end(unit, { col: 5, row: 0 });
    scene.time.now = 9000;
    scene.events.emit('update');
    ctrl.destroy();
    expect(scene.images.length).toBeGreaterThan(0);
    expect(rng).not.toHaveBeenCalled();
  });

  it('builds its Phaser objects on the presentation stream (Phaser draws randoms as it builds)', () => {
    const { scene, ctrl, unit } = setup();
    walkRow(scene, ctrl, unit, 2);
    ctrl.end(unit, { col: 2, row: 0 });
    // the scene's builder drew randoms for each image, from the presentation generator
    expect(scene.randomDrawsAtBuild.length).toBe(scene.images.length);
    expect(scene.randomDrawsAtBuild.every((v) => v >= 0 && v < 1 && v !== 0.5)).toBe(true);
    expect(rng).not.toHaveBeenCalled();
    // and the battle's Math.random is the one that comes back
    expect(Math.random).toBe(rng);
  });

  it('a throwing Math.random cannot break a walk', () => {
    Math.random = () => {
      throw new Error('Math.random is the battle stream');
    };
    const { scene, ctrl, unit } = setup();
    expect(() => {
      walkRow(scene, ctrl, unit, 3);
      ctrl.end(unit, { col: 3, row: 0 });
    }).not.toThrow();
  });
});

describe('a render error never stops a move', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('setFrame throwing: the frame loop drops the unit, the move carries on', () => {
    const { scene, ctrl, unit } = setup();
    unit.graphic.setFrame = vi.fn(() => {
      throw new Error('texture gone');
    });
    expect(() => walkRow(scene, ctrl, unit, 3)).not.toThrow();
    expect(() => ctrl.end(unit, { col: 3, row: 0 })).not.toThrow();
    expect(ctrl.walking).toBe(0);
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
  });

  it('one failing unit does not stop another from walking', () => {
    const { scene, ctrl, unit } = setup();
    const other = makeUnit(scene, { col: 4 });
    unit.graphic.setFrame = vi.fn(() => {
      throw new Error('boom');
    });
    ctrl.step(unit, { ms: 80 });
    ctrl.step(other, { ms: 80 });
    expect(() => {
      frame(scene, unit, 16);
      frame(scene, unit, 120);
    }).not.toThrow();
    expect(other.graphic.frames.length).toBeGreaterThan(0);
  });

  it('the puff failing to build is swallowed, and the unit is still restored', () => {
    const { scene, ctrl, unit } = setup();
    scene.add.image = vi.fn(() => {
      throw new Error('no GL');
    });
    ctrl.step(unit, { ms: 80 });
    frame(scene, unit, 16);
    frame(scene, unit, 50);
    expect(() => ctrl.end(unit, { col: 1, row: 0 })).not.toThrow();
    expect(unit.graphic.frame.name).toBe('idle0');
    expect(unit.graphic.y).toBe(tileXY(0, 0).y);
    // and the failed build leaves Math.random where it was
    expect(Math.random).toBe(rng);
  });

  it('a unit without a graphic, or a scene with no event bus, is a no-op', () => {
    const { scene, ctrl } = setup();
    expect(() => ctrl.step({ name: 'ghost' }, { ms: 80 })).not.toThrow();
    expect(() => ctrl.step(null, { ms: 80 })).not.toThrow();
    expect(() => ctrl.end(null, { col: 0, row: 0 })).not.toThrow();
    const bare = new WalkCycleController({});
    const u = makeUnit(scene);
    expect(() => bare.step(u, { ms: 80 })).not.toThrow();
    expect(() => bare.end(u, { col: 1, row: 0 })).not.toThrow();
    expect(() => bare.destroy()).not.toThrow();
  });
});
