import { describe, it, expect, vi } from 'vitest';
import { LoopedMusic, validLoopFor } from '../src/utils/LoopedMusic.js';

function makeParam(value) {
  return {
    value,
    setTargetAtTime: vi.fn(function (v) {
      this.value = v;
    }),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(function (v) {
      this.value = v;
    }),
    cancelScheduledValues: vi.fn(),
  };
}

function makeContext() {
  const sources = [];
  const gains = [];
  const ctx = {
    currentTime: 10,
    destination: { id: 'dest' },
    createGain: vi.fn(() => {
      const g = { gain: makeParam(1), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    }),
    createBufferSource: vi.fn(() => {
      const s = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(s);
      return s;
    }),
  };
  return { ctx, sources, gains };
}

const buf = (duration) => ({ duration, getChannelData: () => new Float32Array(1) });

describe('validLoopFor', () => {
  it('accepts loop points that fit the decoded buffer', () => {
    expect(validLoopFor(buf(80.4), { loopStart: 9.3, loopEnd: 79.8, duration: 80.39 })).toEqual({
      loopStart: 9.3,
      loopEnd: 79.8,
    });
  });

  it('rejects loop points for a different (e.g. stale cached) file', () => {
    expect(validLoopFor(buf(62), { loopStart: 18.5, loopEnd: 120.9, duration: 121.5 })).toBeNull();
    expect(validLoopFor(buf(130), { loopStart: 18.5, loopEnd: 120.9, duration: 121.5 })).toBeNull();
  });

  it('rejects malformed loop entries', () => {
    expect(validLoopFor(buf(10), null)).toBeNull();
    expect(validLoopFor(buf(10), { loopStart: 5, loopEnd: 4 })).toBeNull();
    expect(validLoopFor(null, { loopStart: 1, loopEnd: 2 })).toBeNull();
  });
});

describe('LoopedMusic', () => {
  const loops = {
    full: { loopStart: 9.3, loopEnd: 79.8, duration: 80.4 },
    calm: { loopStart: 9.3, loopEnd: 79.8, duration: 80.4 },
  };

  it('starts every layer at one shared time with the loop region set', () => {
    const { ctx, sources } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'music_battle_act1',
      layers: { full: buf(80.4), calm: buf(80.4) },
      loops,
      layer: 'calm',
    });
    expect(m.play()).toBe(true);
    expect(sources).toHaveLength(2);
    const whens = sources.map((s) => s.start.mock.calls[0][0]);
    expect(whens[0]).toBe(whens[1]);
    for (const s of sources) {
      expect(s.loop).toBe(true);
      expect(s.loopStart).toBe(9.3);
      expect(s.loopEnd).toBe(79.8);
      expect(s.start.mock.calls[0][1]).toBe(0);
    }
    expect(m.isPlaying).toBe(true);
    expect(m.layer).toBe('calm');
  });

  it('opens with only the chosen layer audible and crossfades on request', () => {
    const { ctx } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(80.4), calm: buf(80.4) },
      loops,
      layer: 'calm',
    });
    const full = m._layers.get('full').gain.gain;
    const calm = m._layers.get('calm').gain.gain;
    expect(full.value).toBe(0);
    expect(calm.value).toBe(1);
    expect(m.setLayer('full', 1200)).toBe(true);
    expect(full.linearRampToValueAtTime).toHaveBeenCalledWith(1, ctx.currentTime + 1.2);
    expect(calm.linearRampToValueAtTime).toHaveBeenCalledWith(0, ctx.currentTime + 1.2);
    expect(m.layer).toBe('full');
    expect(m.setLayer('full')).toBe(false);
    expect(m.setLayer('nonexistent')).toBe(false);
  });

  it('keeps an additive layer out of the crossfade, at a level of its own', () => {
    const { ctx } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(80.4), hum: buf(80.4) },
      loops,
      layerGains: { hum: 0.6 },
    });
    const full = m._layers.get('full').gain.gain;
    const hum = m._layers.get('hum').gain.gain;
    expect(m.layer).toBe('full');
    expect(full.value).toBe(1);
    expect(hum.value).toBeCloseTo(0.6);
    // not a crossfade target, and untouched by crossfades
    expect(m.setLayer('hum')).toBe(false);
    expect(m.setLayerGain('hum', 0.25, 900)).toBe(true);
    expect(hum.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.25, ctx.currentTime + 0.9);
    expect(m.setLayerGain('hum', 7, 0)).toBe(true);
    expect(hum.value).toBe(1);
    expect(m.setLayerGain('full', 0.5)).toBe(false);
    expect(m.setLayerGain('nonexistent', 0.5)).toBe(false);
  });

  it('starts at a scheduled context time (a hinge downbeat), or now if that has passed', () => {
    const { ctx, sources } = makeContext();
    const make = () =>
      new LoopedMusic({
        context: ctx,
        destination: ctx.destination,
        key: 'k',
        layers: { full: buf(80.4), hum: buf(80.4) },
        loops,
        layerGains: { hum: 1 },
      });
    const later = make();
    expect(later.startTime).toBeNull();
    later.play(13.5);
    expect(later.startTime).toBe(13.5);
    for (const s of sources) expect(s.start).toHaveBeenCalledWith(13.5, 0);
    const late = make();
    late.play(2);
    expect(late.startTime).toBeCloseTo(ctx.currentTime + 0.03);
  });

  it('plays a whole-file loop when no valid loop points exist', () => {
    const { ctx, sources } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(30) },
      loops: { full: { loopStart: 5, loopEnd: 90, duration: 91 } },
    });
    m.play();
    expect(sources[0].loop).toBe(true);
    expect(sources[0].loopEnd).toBe(0);
  });

  it('keeps layers aligned: a same-length layer without its own loop uses the primary one', () => {
    const { ctx, sources } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(80.4), calm: buf(80.4) },
      loops: { full: loops.full },
    });
    m.play();
    expect(sources.map((s) => s.loopStart)).toEqual([9.3, 9.3]);
    expect(sources.map((s) => s.loopEnd)).toEqual([79.8, 79.8]);
  });

  it('drops a stale layer instead of handing it loop points it cannot hold', () => {
    const { ctx, sources } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(80.4), calm: buf(30) },
      loops,
      layer: 'calm',
    });
    // the valid primary plays alone and audibly; the calm layer is unavailable
    expect(m.layerNames).toEqual(['full']);
    expect(m.hasLayer('calm')).toBe(false);
    expect(m.layer).toBe('full');
    expect(m._layers.get('full').gain.gain.value).toBe(1);
    expect(m.setLayer('calm')).toBe(false);
    m.play();
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer.duration).toBe(80.4);
    expect(sources[0].loopEnd).toBe(79.8);
  });

  it('drops a layer whose own loop region differs from the primary', () => {
    const { ctx } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(80.4), calm: buf(80.4) },
      loops: { full: loops.full, calm: { loopStart: 10.1, loopEnd: 79.8, duration: 80.4 } },
    });
    expect(m.layerNames).toEqual(['full']);
  });

  it('drops a fresh layer when the primary is stale, so both never loop differently', () => {
    const { ctx, sources } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(80.4), calm: buf(80.4) },
      // primary metadata describes another build; calm's own entry is valid
      loops: { full: { loopStart: 5, loopEnd: 90, duration: 91 }, calm: loops.calm },
    });
    expect(m.layerNames).toEqual(['full']);
    m.play();
    expect(sources[0].loopEnd).toBe(0); // whole-file loop
  });

  it('keeps same-length layers on a shared whole-file loop when no metadata validates', () => {
    const { ctx, sources } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(60), calm: buf(60) },
      loops: {},
    });
    expect(m.layerNames).toEqual(['full', 'calm']);
    m.play();
    expect(sources.map((s) => s.loopEnd)).toEqual([0, 0]);
  });

  it('behaves like a Phaser sound for the manager: volume, stop, destroy', () => {
    const { ctx, sources } = makeContext();
    const m = new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'k',
      layers: { full: buf(80.4) },
      loops,
      volume: 0,
    });
    m.play();
    m.setVolume(0.25);
    expect(m.volume).toBe(0.25);
    expect(m._out.gain.setTargetAtTime).toHaveBeenCalled();
    m.stop();
    expect(sources[0].stop).toHaveBeenCalled();
    expect(m.isPlaying).toBe(false);
    m.destroy();
    expect(m.pendingRemove).toBe(true);
    expect(m.play()).toBe(false);
  });
});

describe('LoopedMusic — a layer joining a running track', () => {
  const loop = { loopStart: 9.3, loopEnd: 79.8, duration: 80.4 };
  const make = (ctx) =>
    new LoopedMusic({
      context: ctx,
      destination: ctx.destination,
      key: 'music_boss_act1',
      layers: { full: buf(80.4) },
      loops: { full: loop },
      keys: { full: 'music_boss_act1', enrage: 'music_boss_act1_enrage_x' },
    });

  it('reports the cache keys of the buffers it holds, and the ones it wants', () => {
    const { ctx } = makeContext();
    const m = make(ctx);
    expect(m.bufferKeys).toEqual(['music_boss_act1']);
    expect(m.layerKeys.enrage).toBe('music_boss_act1_enrage_x');
    expect(m.hasLayer('enrage')).toBe(false);
  });

  it('starts a late layer silent at the primary playhead during the intro', () => {
    const { ctx, sources } = makeContext();
    const m = make(ctx);
    m.play(); // sources start at 10.03
    ctx.currentTime = 30; // the late layer starts at 30.03: 20 s in, before loopEnd
    expect(m.addLayer('enrage', buf(80.4), loop)).toBe(true);
    const late = sources[1];
    const [when, offset] = late.start.mock.calls[0];
    expect(when).toBeCloseTo(30.03, 9);
    expect(offset).toBeCloseTo(20, 9);
    expect(late.loop).toBe(true);
    expect(late.loopStart).toBe(9.3);
    expect(late.loopEnd).toBe(79.8);
    expect(m.bufferKeys).toEqual(['music_boss_act1', 'music_boss_act1_enrage_x']);
    expect(m.layer).toBe('full');
    // silent until asked for, then a normal crossfade
    const entry = m._layers.get('enrage');
    expect(entry.gain.gain.value).toBe(0);
    expect(m.setLayer('enrage', 2000)).toBe(true);
    expect(entry.gain.gain.value).toBe(1);
    expect(m._layers.get('full').gain.gain.value).toBe(0);
  });

  it('wraps the join point inside the loop region after the first pass', () => {
    const { ctx, sources } = makeContext();
    const m = make(ctx);
    m.play(); // sources start at 10.03
    // 79.8 s to the first loopEnd, five more loops (70.5 s each), then 12.7 s:
    // the playhead is 12.7 s past loopStart.
    ctx.currentTime = 10 + 79.8 + 5 * 70.5 + 12.7;
    m.addLayer('enrage', buf(80.4), loop);
    expect(sources[1].start.mock.calls[0][1]).toBeCloseTo(9.3 + 12.7, 6);
  });

  it('refuses a layer off the primary timeline, and a layer name it already has', () => {
    const { ctx } = makeContext();
    const m = make(ctx);
    m.play();
    expect(m.addLayer('enrage', buf(62), { loopStart: 1, loopEnd: 60, duration: 62 })).toBe(false);
    expect(m.addLayer('full', buf(80.4), loop)).toBe(false);
    expect(m.hasLayer('enrage')).toBe(false);
    m.destroy();
    expect(m.addLayer('enrage', buf(80.4), loop)).toBe(false);
  });

  it('a layer joining before a scheduled start begins on that downbeat, at the top', () => {
    const { ctx, sources } = makeContext();
    const m = make(ctx);
    m.play(13.5); // the hinge's handoff, still ahead of the clock
    expect(m.addLayer('enrage', buf(80.4), loop)).toBe(true);
    expect(sources[1].start).toHaveBeenCalledWith(13.5, 0);
  });

  it('a layer added before play() starts with the others', () => {
    const { ctx, sources } = makeContext();
    const m = make(ctx);
    expect(m.addLayer('enrage', buf(80.4), loop)).toBe(true);
    expect(sources).toHaveLength(0);
    m.play();
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.start.mock.calls[0][1])).toEqual([0, 0]);
  });
});
