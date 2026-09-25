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
  return { duration: loop ? loop.duration : 60, getChannelData: () => new Float32Array(1) };
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
