import { describe, it, expect, afterEach } from 'vitest';
import {
  WEATHER_SPECS,
  WEATHER_MAX_PARTICLES,
  WEATHER_MAX_STEP_MS,
  activeParticleCount,
  createWeatherField,
  resolveWeather,
  resolveWeatherMode,
  stepWeather,
  weatherKindFor,
  weatherParticleCount,
  weatherSeed,
} from '../src/art/weatherConfig.js';

const KINDS = Object.keys(WEATHER_SPECS);
const VIEW = Object.freeze({ x: 100, y: 50, w: 480, h: 360, zoom: 1 });

const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});

function snapshot(field) {
  return field.particles.map((p) => ({ ...p }));
}

function run(field, frames, view = VIEW, dt = (i) => 10 + (i % 7) * 3) {
  for (let i = 0; i < frames; i++) stepWeather(field, dt(i), view);
  return field;
}

describe('weather follows the mood', () => {
  it.each([
    // [label, ctx, kind]
    ['Ember Dusk stays clear', { act: 'act1' }, 'none'],
    ['Iron Rain rains', { act: 'act2' }, 'rain'],
    ['Iron Rain on a swamp still rains', { act: 'act2', biome: 'swamp' }, 'rain'],
    ['Iron Rain indoors: dust motes', { act: 'act2', biome: 'castle' }, 'motes'],
    ['Bleached Rite stays clear', { act: 'act3' }, 'none'],
    ['Bleached Rite indoors: dust motes', { act: 'act3', biome: 'castle' }, 'motes'],
    ['Ashfall drops ash', { act: 'act4' }, 'ash'],
    ['Ashfall on a swamp still drops ash', { act: 'act4', biome: 'swamp' }, 'ash'],
    ['postAct keeps the Ashfall', { act: 'postAct' }, 'ash'],
    ['Rime Night snows', { act: 'act4', biome: 'tundra' }, 'snow'],
    ['tundra snows in any act', { act: 'act2', biome: 'snow' }, 'snow'],
    ['volcanic ground sends embers up', { act: 'act4', biome: 'volcano' }, 'embers'],
    ['the "volcanic" spelling too', { act: 'act4', biome: 'volcanic' }, 'embers'],
    ['an Act IV castle: dust motes', { act: 'act4', biome: 'castle' }, 'motes'],
    ['the Throne: dust motes in torchlight', { act: 'finalBoss', biome: 'void' }, 'motes'],
    ['the Entity: unlight', { act: 'finalBoss', biome: 'void', hasEntity: true }, 'unlight'],
    ['the secret act: unlight', { act: 'secretAct' }, 'unlight'],
    ['a void map: unlight', { act: 'act2', biome: 'void' }, 'unlight'],
  ])('%s', (_label, ctx, kind) => {
    expect(resolveWeather(ctx)).toBe(kind);
  });

  it('a scripted battle (the prologue) stays clear whatever the act or ground', () => {
    for (const ctx of [
      { act: 'act1', biome: 'tundra', isScripted: true },
      { act: 'act4', isScripted: true },
      { act: 'act2', biome: 'castle', isScripted: true },
    ]) {
      expect(resolveWeather(ctx), JSON.stringify(ctx)).toBe('none');
    }
  });

  it('a dev override wins, an unknown one is ignored', () => {
    expect(resolveWeather({ act: 'act1', weatherOverride: 'snow' })).toBe('snow');
    expect(resolveWeather({ act: 'act1', weatherOverride: 'hail' })).toBe('none');
    expect(weatherKindFor({ gradeKey: 'act2', biome: 'grassland', isScripted: true })).toBe('none');
  });
});

describe('weather mode follows the Atmosphere setting', () => {
  it('auto: Full on desktop, Reduced on phones', () => {
    expect(resolveWeatherMode('auto', { mobile: false })).toMatchObject({
      mode: 'full',
      density: 1,
      speed: 1,
      flicker: true,
    });
    const phone = resolveWeatherMode('auto', { mobile: true });
    expect(phone.mode).toBe('reduced');
    expect(phone.density).toBeCloseTo(1 / 3, 5);
    expect(phone.speed).toBeLessThan(1);
    expect(phone.flicker).toBe(false);
  });

  it('Off, no WebGL and Reduce motion give no weather', () => {
    expect(resolveWeatherMode('off', {}).mode).toBe('off');
    expect(resolveWeatherMode('full', { webgl: false }).mode).toBe('off');
    expect(resolveWeatherMode('full', { reduceMotion: true })).toEqual({
      mode: 'off',
      density: 0,
      speed: 0,
      flicker: false,
    });
    expect(resolveWeatherMode('reduced', { reduceMotion: true }).mode).toBe('off');
  });

  it('Low effects quality caps it at Reduced (never turns Off on)', () => {
    expect(resolveWeatherMode('full', { effectsQuality: 'low' }).mode).toBe('reduced');
    expect(resolveWeatherMode('off', { effectsQuality: 'low' }).mode).toBe('off');
  });
});

describe('particle budget', () => {
  it.each(KINDS)('%s: Full ≤ 120, Reduced ≤ 40 and about a third of Full', (kind) => {
    const full = weatherParticleCount(kind, 'full');
    const reduced = weatherParticleCount(kind, 'reduced');
    expect(full).toBeGreaterThan(0);
    expect(full).toBeLessThanOrEqual(WEATHER_MAX_PARTICLES.full);
    expect(reduced).toBeLessThanOrEqual(WEATHER_MAX_PARTICLES.reduced);
    expect(Math.abs(reduced - full / 3)).toBeLessThanOrEqual(1);
    expect(weatherParticleCount(kind, 'off')).toBe(0);
  });

  it('none has no particles', () => {
    expect(weatherParticleCount('none', 'full')).toBe(0);
    expect(createWeatherField({ kind: 'none' }).particles).toHaveLength(0);
  });

  it('a smaller visible map shows proportionally fewer, never under the floor', () => {
    expect(activeParticleCount(100, { w: 640, h: 400, zoom: 1 })).toBe(100);
    expect(activeParticleCount(100, { w: 320, h: 400, zoom: 1 })).toBe(50);
    expect(activeParticleCount(100, { w: 32, h: 32, zoom: 1 })).toBe(30);
    // Zoomed in, the same screen area holds the same count.
    expect(activeParticleCount(100, { w: 320, h: 200, zoom: 2 })).toBe(100);
  });
});

describe('the simulation', () => {
  it.each(KINDS)('%s is deterministic for a seed', (kind) => {
    const a = run(createWeatherField({ kind, seed: 42, flicker: true }), 400);
    const b = run(createWeatherField({ kind, seed: 42, flicker: true }), 400);
    expect(snapshot(a)).toEqual(snapshot(b));
    const c = run(createWeatherField({ kind, seed: 43, flicker: true }), 400);
    expect(snapshot(c)).not.toEqual(snapshot(a));
  });

  it.each(KINDS)('%s never calls Math.random while creating or stepping', (kind) => {
    Math.random = () => {
      throw new Error('Math.random is the battle RNG');
    };
    for (const mode of ['full', 'reduced']) {
      const field = createWeatherField({ kind, mode, seed: 7, flicker: true });
      expect(() => run(field, 600)).not.toThrow();
      // Pans and zooms too.
      expect(() =>
        stepWeather(field, 16, { x: 900, y: 700, w: 200, h: 150, zoom: 2.5 }),
      ).not.toThrow();
    }
  });

  it('the pool is fixed: same records, same length, however long it runs', () => {
    const field = createWeatherField({ kind: 'rain', seed: 1 });
    const records = field.particles.slice();
    run(field, 3000);
    expect(field.particles).toHaveLength(records.length);
    field.particles.forEach((p, i) => expect(p).toBe(records[i]));
  });

  it('rain falls (screen down = world +y) and recycles at the top once it leaves the bottom', () => {
    const field = createWeatherField({ kind: 'rain', seed: 5 });
    stepWeather(field, 0, VIEW); // scatter
    const p = field.particles[0];
    p.y = VIEW.y + VIEW.h / 2;
    const y0 = p.y;
    stepWeather(field, 16, VIEW);
    expect(p.vy).toBeGreaterThan(0);
    expect(p.y - y0).toBeCloseTo((p.vy * 16) / 1000, 6);
    // Push it past the bottom edge: the next step brings it back in from the top.
    p.y = VIEW.y + VIEW.h + 15.9;
    const before = field.recycled;
    stepWeather(field, 16, VIEW);
    expect(field.recycled).toBe(before + 1);
    expect(p.y).toBeLessThan(VIEW.y + 16);
    expect(p.x).toBeGreaterThanOrEqual(VIEW.x - 16);
    expect(p.x).toBeLessThan(VIEW.x + VIEW.w + 16);
  });

  it('every particle stays within the view (plus its margin) through a long run', () => {
    for (const kind of KINDS) {
      const field = createWeatherField({ kind, seed: 9 });
      for (let i = 0; i < 2000; i++) {
        stepWeather(field, 16, VIEW);
        if (i % 200) continue;
        for (const p of field.particles) {
          expect(p.y).toBeGreaterThanOrEqual(VIEW.y - 16);
          expect(p.y).toBeLessThan(VIEW.y + VIEW.h + 16);
          expect(p.x).toBeGreaterThanOrEqual(VIEW.x - 16);
          expect(p.x).toBeLessThan(VIEW.x + VIEW.w + 16);
        }
      }
      expect(field.recycled, kind).toBeGreaterThan(0);
    }
  });

  it('a pan or zoom folds every particle into the new view', () => {
    const field = run(createWeatherField({ kind: 'snow', seed: 3 }), 50);
    const moved = { x: 1400, y: -600, w: 200, h: 120, zoom: 2 };
    stepWeather(field, 16, moved);
    expect(field.active).toBeGreaterThan(0);
    // The ones in play (a smaller screen area hides the rest until it grows again).
    for (const p of field.particles.slice(0, field.active)) {
      expect(p.x).toBeGreaterThanOrEqual(moved.x - 8);
      expect(p.x).toBeLessThan(moved.x + moved.w + 8);
      expect(p.y).toBeGreaterThanOrEqual(moved.y - 8);
      expect(p.y).toBeLessThan(moved.y + moved.h + 8);
    }
  });

  it('a stall (hidden tab, pause) steps no further than one clamped frame: no burst', () => {
    const a = run(createWeatherField({ kind: 'rain', seed: 11 }), 10);
    const b = run(createWeatherField({ kind: 'rain', seed: 11 }), 10);
    stepWeather(a, 60_000, VIEW);
    stepWeather(b, WEATHER_MAX_STEP_MS, VIEW);
    expect(snapshot(a)).toEqual(snapshot(b));
    stepWeather(a, -500, VIEW); // a negative delta never runs time backwards
    expect(a.time).toBe(b.time);
  });

  it('speeds are screen speeds: zoomed in, a particle moves less in world units', () => {
    const at = (zoom) => {
      const field = createWeatherField({ kind: 'rain', seed: 21 });
      const view = { ...VIEW, zoom };
      stepWeather(field, 0, view);
      const p = field.particles[0];
      p.x = VIEW.x + VIEW.w / 2;
      p.y = VIEW.y + 10;
      stepWeather(field, 20, view);
      return p.y - (VIEW.y + 10);
    };
    expect(at(2)).toBeCloseTo(at(1) / 2, 6);
  });

  it('Reduced is slower and never flickers', () => {
    const full = createWeatherField({ kind: 'embers', mode: 'full', seed: 1, flicker: true });
    const reduced = createWeatherField({ kind: 'embers', mode: 'reduced', seed: 1, flicker: true });
    expect(full.flicker).toBe(true);
    expect(reduced.flicker).toBe(false);
    expect(reduced.speed).toBeLessThan(full.speed);
    expect(reduced.particles.length).toBeLessThan(full.particles.length);
  });

  it('floating kinds fade in and out, then respawn somewhere in view', () => {
    const field = createWeatherField({ kind: 'embers', seed: 2 });
    stepWeather(field, 0, VIEW);
    const p = field.particles[0];
    p.age = 0;
    stepWeather(field, 1, VIEW);
    expect(p.drawAlpha).toBeLessThan(0.01 * p.alpha + 0.01);
    p.age = p.life - 1;
    const before = field.recycled;
    stepWeather(field, 16, VIEW);
    expect(field.recycled).toBe(before + 1);
    expect(p.age).toBe(0);
  });

  it('no view (the map is off-camera): everything hides', () => {
    const field = run(createWeatherField({ kind: 'ash', seed: 1 }), 5);
    stepWeather(field, 16, null);
    expect(field.particles.every((p) => !p.visible)).toBe(true);
    stepWeather(field, 16, { x: 0, y: 0, w: 4, h: 400, zoom: 1 });
    expect(field.particles.every((p) => !p.visible)).toBe(true);
  });

  it('the seed is stable and differs by kind', () => {
    expect(weatherSeed(123, 'rain')).toBe(weatherSeed(123, 'rain'));
    expect(weatherSeed(123, 'rain')).not.toBe(weatherSeed(123, 'snow'));
    expect(weatherSeed(undefined, 'rain')).toBe(weatherSeed(0, 'rain'));
  });
});
