import { readFileSync } from 'node:fs';
import { rememberAudioBuffer } from '../src/utils/audioAssets.js';
import { describe, it, expect, vi } from 'vitest';
import { AudioManager } from '../src/utils/AudioManager.js';
import { LoopedMusic } from '../src/utils/LoopedMusic.js';
import { getMusicLayers, getMusicLoop } from '../src/utils/musicConfig.js';

function makeContext() {
  const param = () => ({
    value: 1,
    setTargetAtTime: vi.fn(function (v) {
      this.value = v;
    }),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(function (v) {
      this.value = v;
    }),
    cancelScheduledValues: vi.fn(),
  });
  return {
    state: 'running',
    currentTime: 0,
    destination: {},
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
    createBufferSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };
}

function decoded(key) {
  const loop = getMusicLoop(key);
  return rememberAudioBuffer(key, {
    duration: loop ? loop.duration : 60,
    getChannelData: () => new Float32Array(1),
  });
}

function makeSound(loadedKeys) {
  const store = new Map(loadedKeys.map((k) => [k, decoded(k)]));
  const context = makeContext();
  return {
    locked: false,
    sounds: [],
    context,
    destination: { id: 'master' },
    add: vi.fn((key, opts) => {
      const s = {
        key,
        loop: Boolean(opts?.loop),
        volume: opts?.volume ?? 1,
        isPlaying: false,
        play: vi.fn(function () {
          this.isPlaying = true;
        }),
        stop: vi.fn(function () {
          this.isPlaying = false;
        }),
        destroy: vi.fn(),
        setVolume: vi.fn(function (v) {
          this.volume = v;
        }),
      };
      return s;
    }),
    game: {
      cache: {
        audio: {
          has: (k) => store.has(k),
          get: (k) => store.get(k),
          add: (k, v) => store.set(k, v),
          remove: (k) => store.delete(k),
        },
      },
    },
  };
}

describe('AudioManager — seamless loops and adaptive layers', () => {
  it('plays a composed track through LoopedMusic with its loop points', async () => {
    const sound = makeSound(['music_title']);
    const audio = new AudioManager(sound);
    await audio.playMusic('music_title', null, 0);
    expect(audio.currentMusic).toBeInstanceOf(LoopedMusic);
    expect(audio.currentMusic.isPlaying).toBe(true);
    expect(sound.add).not.toHaveBeenCalled();
  });

  it('starts an adaptive battle theme on the requested layer and crossfades on demand', async () => {
    const key = 'music_battle_act1';
    const layers = getMusicLayers(key);
    const sound = makeSound([key, layers.calm]);
    const audio = new AudioManager(sound);
    audio.setMusicIntensity('calm', 0);
    await audio.playMusic(key, null, 0);
    const music = audio.currentMusic;
    expect(music).toBeInstanceOf(LoopedMusic);
    expect(music.layerNames.sort()).toEqual(['calm', 'full']);
    expect(music.layer).toBe('calm');
    audio.setMusicIntensity('full', 1200);
    expect(music.layer).toBe('full');
    expect(audio.getMusicIntensity()).toBe('full');
  });

  it('loads a missing calm layer before starting, and protects it from cache eviction', async () => {
    const key = 'music_battle_act2';
    const layers = getMusicLayers(key);
    const sound = makeSound([key]);
    const audio = new AudioManager(sound);
    const loadSpy = vi
      .spyOn(audio, '_ensureMusicLoaded')
      .mockImplementation(async (k) => sound.game.cache.audio.add(k, decoded(k)));
    await audio.playMusic(key, null, 0);
    expect(loadSpy).toHaveBeenCalledWith(layers.calm, null);
    expect(audio.currentMusic.hasLayer('calm')).toBe(true);
    expect(audio.currentMusicLayerKeys).toEqual([layers.calm]);
    expect(audio._evictCachedMusic(layers.calm)).toBe(false);
  });

  it('degrades to a single layer when the calm mix fails to load', async () => {
    const key = 'music_battle_act3';
    const sound = makeSound([key]);
    const audio = new AudioManager(sound);
    vi.spyOn(audio, '_ensureMusicLoaded').mockRejectedValue(new Error('offline'));
    await audio.playMusic(key, null, 0);
    expect(audio.currentMusic).toBeInstanceOf(LoopedMusic);
    expect(audio.currentMusic.layerNames).toEqual(['full']);
    expect(audio.setMusicIntensity('calm')).toBe('calm');
    expect(audio.currentMusic.layer).toBe('full');
  });

  it('falls back to a plain Phaser loop without a Web Audio context', async () => {
    const sound = makeSound(['music_title']);
    delete sound.context;
    const audio = new AudioManager(sound);
    await audio.playMusic('music_title', null, 0);
    expect(sound.add).toHaveBeenCalledWith('music_title', expect.objectContaining({ loop: true }));
    expect(audio.currentMusic).not.toBeInstanceOf(LoopedMusic);
  });

  it('stopping music clears the layer bookkeeping', async () => {
    const key = 'music_battle_act1';
    const sound = makeSound([key, getMusicLayers(key).calm]);
    const audio = new AudioManager(sound);
    await audio.playMusic(key, null, 0);
    audio.stopMusic(null, 0, true);
    expect(audio.currentMusic).toBeNull();
    expect(audio.currentMusicLayerKeys).toEqual([]);
  });
});

describe('AudioManager — extra layers (a boss enrage layer)', () => {
  it('plays a boss theme with its enrage layer and crossfades to it on request', async () => {
    const theme = 'music_boss_act1';
    const layer = 'music_boss_act1_enrage_iron_captain';
    const sound = makeSound([theme, layer]);
    const audio = new AudioManager(sound);
    audio.setMusicIntensity('full', 0);
    await audio.playMusic(theme, null, 0, { layers: { enrage: layer } });
    expect(audio.currentMusic).toBeInstanceOf(LoopedMusic);
    expect(audio.currentMusic.layerNames).toEqual(['full', 'enrage']);
    expect(audio.currentMusic.layer).toBe('full');
    audio.setMusicIntensity('enrage', 2000);
    expect(audio.currentMusic.layer).toBe('enrage');
    expect(audio.getMusicIntensity()).toBe('enrage');
  });

  it('opens on the enrage layer when the intensity was set first (a resumed battle)', async () => {
    const theme = 'music_boss_act2';
    const layer = 'music_boss_act2_enrage_archmage';
    const sound = makeSound([theme, layer]);
    const audio = new AudioManager(sound);
    audio.setMusicIntensity('enrage', 0);
    await audio.playMusic(theme, null, 0, { layers: { enrage: layer } });
    expect(audio.currentMusic.layer).toBe('enrage');
  });

  it("plays the Entity's finale with its hum as an additive layer, on a scheduled downbeat", async () => {
    const finale = 'music_boss_entity_finale';
    const hum = 'music_boss_entity_finale_hum';
    const sound = makeSound([finale, hum]);
    const audio = new AudioManager(sound);
    audio.setMusicIntensity('enrage', 0);
    await audio.playMusic(finale, null, 0, {
      layers: { hum },
      layerGains: { hum: 0.4 },
      startAt: 5,
    });
    const music = audio.currentMusic;
    expect(music).toBeInstanceOf(LoopedMusic);
    expect(music.layerNames).toEqual(['full', 'hum']);
    expect(music.layer).toBe('full');
    expect(music.startTime).toBe(5);
    expect(music._layers.get('hum').gain.gain.value).toBeCloseTo(0.4);
    // the voice holds the hum's buffer, so the cache budget keeps it
    expect(audio.currentMusicLayerKeys).toEqual([hum]);
    expect(audio._evictCachedMusic(hum)).toBe(false);
    expect(audio.setMusicLayerGain('hum', 0.1, 0)).toBe(true);
    expect(music._layers.get('hum').gain.gain.value).toBeCloseTo(0.1);
    // intensity changes never touch the hum
    audio.setMusicIntensity('calm', 0);
    expect(music._layers.get('hum').gain.gain.value).toBeCloseTo(0.1);
    audio.stopMusic(null, 0, true);
    expect(audio.setMusicLayerGain('hum', 1)).toBe(false);
  });

  it('keeps the additive layer levels of a track deferred until audio unlocks', async () => {
    const finale = 'music_boss_entity_finale';
    const hum = 'music_boss_entity_finale_hum';
    const sound = makeSound([finale, hum]);
    const handlers = {};
    sound.locked = true;
    sound.once = vi.fn((event, fn) => {
      handlers[event] = fn;
    });
    const audio = new AudioManager(sound);
    await audio.playMusic(finale, null, 0, {
      layers: { hum },
      layerGains: { hum: 0.3 },
      startAt: 5,
    });
    expect(audio.currentMusic).toBeNull();
    const play = vi.spyOn(audio, 'playMusic');
    sound.locked = false;
    handlers.unlocked();
    // a scheduled downbeat is stale by the time audio unlocks: it starts now
    expect(play).toHaveBeenCalledWith(finale, null, 0, {
      layers: { hum },
      layerGains: { hum: 0.3 },
    });
    await play.mock.results[0].value;
    expect(audio.currentMusic._layers.get('hum').gain.gain.value).toBeCloseTo(0.3);
  });

  it('preloads tracks ahead of a trigger without playing them', async () => {
    const sound = makeSound([]);
    const audio = new AudioManager(sound);
    const load = vi.spyOn(audio, '_ensureMusicLoaded').mockImplementation(async (key) => {
      sound.game.cache.audio.add(key, decoded(key));
    });
    audio.preloadMusic(['music_boss_entity_finale', 'music_boss_entity_finale_hum', null]);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(sound.game.cache.audio.has('music_boss_entity_finale_hum')).toBe(true);
    expect(audio.currentMusic).toBeNull();
    load.mockClear();
    audio.preloadMusic(['music_boss_entity_finale']);
    expect(load).not.toHaveBeenCalled(); // already decoded
  });

  it('treats unknown intensity names as full', () => {
    const audio = new AudioManager(makeSound([]));
    expect(audio.setMusicIntensity('thunder')).toBe('full');
  });
});

describe('AudioManager recording recovery', () => {
  it.each(['constructor', 'start'])(
    'keeps the current verified voice and its layers when the replacement %s fails',
    async (failure) => {
      const oldKey = 'music_battle_act1';
      const calm = getMusicLayers(oldKey).calm;
      const sound = makeSound([oldKey, calm, 'music_title']);
      const audio = new AudioManager(sound);
      audio.preloadStingers = vi.fn();
      audio.prefetchStingers = vi.fn();
      await audio.playMusic(oldKey, 'NodeMap', 0);
      const previous = audio.currentMusic;
      const stop = vi.spyOn(previous, 'stop');
      const factory =
        failure === 'constructor' ? sound.context.createGain : sound.context.createBufferSource;
      factory.mockImplementationOnce(() => {
        throw new Error(`failed-${failure}`);
      });

      await audio.playMusic('music_title', 'Title', 0);

      expect(audio.currentMusic).toBe(previous);
      expect(audio.currentMusicKey).toBe(oldKey);
      expect(audio.currentMusicOwner).toBe('NodeMap');
      expect(audio.currentMusicLayerKeys).toEqual([calm]);
      expect(previous.isPlaying).toBe(true);
      expect(stop).not.toHaveBeenCalled();
      expect(sound.add).not.toHaveBeenCalled();
      audio.stopAllMusic(null);
    },
  );

  const key = 'music_battle_act1_2';
  function musicBytes() {
    const file = readFileSync(new URL('../assets/audio/music/' + key + '.mp3', import.meta.url));
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  }
  it('replaces an unverified same-duration cached recording with verified bytes', async () => {
    const sound = makeSound([key]);
    sound.game.cache.audio.add(key, {
      duration: getMusicLoop(key).duration,
      getChannelData: () => new Float32Array(1),
    });
    sound.context.decodeAudioData = vi.fn(async () => decoded(key));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => musicBytes() })),
    );
    const audio = new AudioManager(sound);
    audio._fetchAndDecodeStinger = vi.fn(async () => null);
    audio._fetchStingerBytes = vi.fn(async () => new ArrayBuffer(1));
    try {
      await audio.playMusic(key, null, 0);
      expect(audio.currentMusicKey).toBe(key);
      expect(sound.context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(audio.getAudioDiagnostics().events.some((e) => e.type === 'cache-rejected')).toBe(
        true,
      );
    } finally {
      audio.stopAllMusic(null);
      vi.unstubAllGlobals();
    }
  });
  it('a rejected response never falls through to an unverified Phaser loader', async () => {
    const sound = makeSound([]);
    sound.context.decodeAudioData = vi.fn(async () => decoded(key));
    const corrupt = musicBytes();
    new Uint8Array(corrupt)[100] ^= 1;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => corrupt })),
    );
    const scene = { load: { audio: vi.fn() } };
    const audio = new AudioManager(sound);
    try {
      await audio.playMusic(key, scene, 0);
      expect(audio.currentMusic).toBeNull();
      expect(sound.game.cache.audio.has(key)).toBe(false);
      expect(sound.context.decodeAudioData).not.toHaveBeenCalled();
      expect(scene.load.audio).not.toHaveBeenCalled();
      expect(audio.getAudioDiagnostics().events.at(-1).reason).toContain('audio-integrity-failed');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
