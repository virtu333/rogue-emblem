import { describe, it, expect, vi } from 'vitest';
import { AudioManager } from '../src/utils/AudioManager.js';

function makeLoopingSound(key) {
  return {
    key,
    loop: true,
    isPlaying: true,
    volume: 1,
    stop: vi.fn(function stop() { this.isPlaying = false; }),
    destroy: vi.fn(),
    setVolume: vi.fn(function setVolume(v) { this.volume = v; }),
  };
}

function createLoader(loaded, { autoComplete = true } = {}) {
  const onListeners = new Map();
  const onceListeners = new Map();
  const queuedKeys = [];

  const emit = (event, payload) => {
    const list = onListeners.get(event) || [];
    for (const fn of [...list]) fn(payload);
    const once = onceListeners.get(event) || [];
    onceListeners.delete(event);
    for (const fn of once) fn(payload);
  };

  const completeKey = (key) => {
    loaded.add(key);
    emit(`filecomplete-audio-${key}`, { key });
  };

  const loader = {
    isLoading: vi.fn(() => false),
    once: vi.fn((event, fn) => {
      const list = onceListeners.get(event) || [];
      list.push(fn);
      onceListeners.set(event, list);
    }),
    on: vi.fn((event, fn) => {
      const list = onListeners.get(event) || [];
      list.push(fn);
      onListeners.set(event, list);
    }),
    off: vi.fn((event, fn) => {
      const list = onListeners.get(event) || [];
      onListeners.set(event, list.filter(cb => cb !== fn));
    }),
    audio: vi.fn((key) => {
      queuedKeys.push(key);
    }),
    start: vi.fn(() => {
      if (!autoComplete) return;
      while (queuedKeys.length > 0) {
        completeKey(queuedKeys.shift());
      }
    }),
    _completeKey: completeKey,
  };

  return loader;
}

function makeSoundManager({ sounds = [], loadedKeys = [], autoCompleteLoader = true } = {}) {
  const loaded = new Set(loadedKeys);
  const loader = createLoader(loaded, { autoComplete: autoCompleteLoader });
  const scene = { load: loader, tweens: { add: vi.fn() } };
  const audioCache = {
    has: vi.fn((key) => loaded.has(key)),
    add: vi.fn((key) => { loaded.add(key); }),
    remove: vi.fn((key) => { loaded.delete(key); }),
  };

  return {
    locked: false,
    sounds,
    scene,
    get: vi.fn((key) => sounds.find(s => s.key === key) || null),
    add: vi.fn((key, opts) => {
      const s = makeLoopingSound(key);
      s.loop = Boolean(opts?.loop);
      s.volume = opts?.volume ?? 1;
      s.play = vi.fn(() => { s.isPlaying = true; });
      sounds.push(s);
      return s;
    }),
    play: vi.fn(),
    once: vi.fn(),
    game: {
      cache: {
        audio: audioCache,
      },
    },
  };
}

describe('AudioManager', () => {
  it('stops orphaned looping tracks before starting new music', async () => {
    const orphanA = makeLoopingSound('music_explore_act1');
    const orphanB = makeLoopingSound('music_explore_act1_2');
    const sound = makeSoundManager({
      sounds: [orphanA, orphanB],
      loadedKeys: ['music_battle_act1_1'],
    });
    const audio = new AudioManager(sound);

    await audio.playMusic('music_battle_act1_1', null, 0);

    expect(orphanA.stop).toHaveBeenCalledTimes(1);
    expect(orphanA.destroy).toHaveBeenCalledTimes(1);
    expect(orphanB.stop).toHaveBeenCalledTimes(1);
    expect(orphanB.destroy).toHaveBeenCalledTimes(1);
    expect(audio.currentMusicKey).toBe('music_battle_act1_1');
  });

  it('stops tracked music instances even when missing from sound manager list', async () => {
    const sound = makeSoundManager({
      sounds: [],
      loadedKeys: ['music_battle_act1_1', 'music_explore_act1'],
    });
    const audio = new AudioManager(sound);

    await audio.playMusic('music_explore_act1', null, 0);
    const oldTrack = audio.currentMusic;

    // Simulate Phaser losing the old sound from its internal list.
    sound.sounds = sound.sounds.filter((s) => s !== oldTrack);

    await audio.playMusic('music_battle_act1_1', null, 0);

    expect(oldTrack.stop).toHaveBeenCalledTimes(1);
    expect(oldTrack.destroy).toHaveBeenCalledTimes(1);
    expect(audio.currentMusicKey).toBe('music_battle_act1_1');
  });

  it('stopMusic also clears looping tracks when currentMusic handle is missing', () => {
    const orphan = makeLoopingSound('music_explore_act3');
    const oneShot = { key: 'sfx_heal', loop: false, isPlaying: true, stop: vi.fn(), destroy: vi.fn() };
    const sound = makeSoundManager({ sounds: [orphan, oneShot] });
    const audio = new AudioManager(sound);

    audio.currentMusic = null;
    audio.currentMusicKey = null;
    audio.stopMusic(null, 0);

    expect(orphan.stop).toHaveBeenCalledTimes(1);
    expect(orphan.destroy).toHaveBeenCalledTimes(1);
    expect(oneShot.stop).not.toHaveBeenCalled();
  });

  it('stops active music sounds even when loop getter throws', async () => {
    const staleMusic = {
      key: 'music_explore_act1',
      isPlaying: true,
      stop: vi.fn(function stop() { this.isPlaying = false; }),
      destroy: vi.fn(),
    };
    Object.defineProperty(staleMusic, 'loop', {
      get() {
        throw new Error('stale loop getter');
      },
    });
    const sound = makeSoundManager({
      sounds: [staleMusic],
      loadedKeys: ['music_battle_act1_1'],
    });
    const audio = new AudioManager(sound);

    await audio.playMusic('music_battle_act1_1', null, 0);

    expect(staleMusic.stop).toHaveBeenCalledTimes(1);
    expect(staleMusic.destroy).toHaveBeenCalledTimes(1);
    expect(audio.currentMusicKey).toBe('music_battle_act1_1');
  });

  it('lazy-loads missing music before playing', async () => {
    const sound = makeSoundManager();
    const audio = new AudioManager(sound);

    await audio.playMusic('music_title', sound.scene, 0);

    expect(sound.scene.load.audio).toHaveBeenCalledTimes(1);
    expect(sound.scene.load.start).toHaveBeenCalledTimes(1);
    expect(sound.add).toHaveBeenCalledWith('music_title', expect.objectContaining({ loop: true }));
    expect(audio.currentMusicKey).toBe('music_title');
  });

  it('deduplicates in-flight loads for the same key', async () => {
    const sound = makeSoundManager();
    const audio = new AudioManager(sound);

    await Promise.all([
      audio.playMusic('music_title', sound.scene, 0),
      audio.playMusic('music_title', sound.scene, 0),
    ]);

    expect(sound.scene.load.audio).toHaveBeenCalledTimes(1);
    expect(sound.add).toHaveBeenCalledTimes(1);
  });

  it('does not let older delayed request override newer music request', async () => {
    const sound = makeSoundManager({ autoCompleteLoader: false });
    const audio = new AudioManager(sound);

    const p1 = audio.playMusic('music_title', sound.scene, 0);
    const p2 = audio.playMusic('music_home_base', sound.scene, 0);

    sound.scene.load._completeKey('music_title');
    sound.scene.load._completeKey('music_home_base');
    await Promise.all([p1, p2]);

    expect(audio.currentMusicKey).toBe('music_home_base');
  });

  it('cancels in-flight music load when stopMusic is called before load completes', async () => {
    const sound = makeSoundManager({ autoCompleteLoader: false });
    const audio = new AudioManager(sound);

    const pending = audio.playMusic('music_title', sound.scene, 0);
    audio.stopMusic(null, 0);

    sound.scene.load._completeKey('music_title');
    await pending;

    expect(sound.add).not.toHaveBeenCalled();
    expect(audio.currentMusicKey).toBe(null);
  });

  it('restarts same-key music when overlap is detected to clear orphan loops', async () => {
    const current = makeLoopingSound('music_battle_act2_1');
    const orphan = makeLoopingSound('music_battle_act2_2');
    const sound = makeSoundManager({
      sounds: [current, orphan],
      loadedKeys: ['music_battle_act2_1'],
    });
    const audio = new AudioManager(sound);
    audio.currentMusic = current;
    audio.currentMusicKey = 'music_battle_act2_1';

    await audio.playMusic('music_battle_act2_1', null, 0);

    expect(current.stop).toHaveBeenCalledTimes(1);
    expect(current.destroy).toHaveBeenCalledTimes(1);
    expect(orphan.stop).toHaveBeenCalledTimes(1);
    expect(orphan.destroy).toHaveBeenCalledTimes(1);
    expect(sound.add).toHaveBeenCalledWith('music_battle_act2_1', expect.objectContaining({ loop: true }));
    expect(audio.currentMusicKey).toBe('music_battle_act2_1');
  });

  it('does not stop current music when another owner requests stop', () => {
    const current = makeLoopingSound('music_battle_act1_1');
    const sound = makeSoundManager({ sounds: [current] });
    const audio = new AudioManager(sound);
    audio.currentMusic = current;
    audio.currentMusicKey = 'music_battle_act1_1';
    audio.currentMusicOwner = 'NodeMap';

    const stopped = audio.stopMusic({ scene: { key: 'Title' } }, 0);

    expect(stopped).toBe(false);
    expect(current.stop).not.toHaveBeenCalled();
    expect(audio.currentMusicKey).toBe('music_battle_act1_1');
  });

  it('releaseMusic only stops when owner matches current owner', () => {
    const current = makeLoopingSound('music_battle_act1_1');
    const sound = makeSoundManager({ sounds: [current] });
    const audio = new AudioManager(sound);
    audio.currentMusic = current;
    audio.currentMusicKey = 'music_battle_act1_1';
    audio.currentMusicOwner = 'NodeMap';

    const wrongOwnerStop = audio.releaseMusic({ scene: { key: 'Title' } }, 0);
    expect(wrongOwnerStop).toBe(false);
    expect(current.stop).not.toHaveBeenCalled();

    const rightOwnerStop = audio.releaseMusic({ scene: { key: 'NodeMap' } }, 0);
    expect(rightOwnerStop).toBe(true);
    expect(current.stop).toHaveBeenCalledTimes(1);
    expect(current.destroy).toHaveBeenCalledTimes(1);
    expect(audio.currentMusicKey).toBe(null);
  });

  it('can load missing music without a scene loader via fetch + decode', async () => {
    const sound = makeSoundManager();
    sound.scene = null;
    sound.context = {
      decodeAudioData: vi.fn((bytes, onSuccess) => onSuccess({ decoded: bytes.byteLength })),
    };

    const fakeBytes = new ArrayBuffer(32);
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => fakeBytes,
    }));
    globalThis.fetch = fetchMock;

    try {
      const audio = new AudioManager(sound);
      await audio.playMusic('music_title', null, 0);
      expect(fetchMock).toHaveBeenCalled();
      expect(sound.context.decodeAudioData).toHaveBeenCalled();
      expect(sound.game.cache.audio.add).toHaveBeenCalledWith('music_title', expect.any(Object));
      expect(sound.add).toHaveBeenCalledWith('music_title', expect.objectContaining({ loop: true }));
      expect(audio.currentMusicKey).toBe('music_title');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses mobile timeout defaults when loading music', async () => {
    const sound = makeSoundManager();
    const audio = new AudioManager(sound, { isMobile: true, mobileMusicLoadTimeoutMs: 13579 });
    const fetchSpy = vi.spyOn(audio, '_fetchAndDecodeMusic').mockResolvedValue(undefined);
    const webAudioSpy = vi.spyOn(audio, '_canUseWebAudioFetchDecode').mockReturnValue(true);

    await audio._ensureMusicLoaded('music_title', sound.scene);

    expect(webAudioSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('music_title', 13579);
  });

  it('evicts least-recent cached music buffers when over budget', async () => {
    const sound = makeSoundManager();
    sound.scene = null;
    sound.context = {
      decodeAudioData: vi.fn((bytes, onSuccess) => onSuccess({ decoded: bytes.byteLength })),
    };

    const fakeBytes = new ArrayBuffer(16);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => fakeBytes,
    }));

    try {
      const audio = new AudioManager(sound, { maxCachedMusicTracks: 2 });
      await audio.playMusic('music_title', null, 0);
      await audio.playMusic('music_home_base', null, 0);
      await audio.playMusic('music_shop', null, 0);

      expect(sound.game.cache.audio.remove).toHaveBeenCalledWith('music_title');
      expect(sound.game.cache.audio.has('music_title')).toBe(false);
      expect(sound.game.cache.audio.has('music_home_base')).toBe(true);
      expect(sound.game.cache.audio.has('music_shop')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
