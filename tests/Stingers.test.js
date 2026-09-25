import { describe, it, expect, vi } from 'vitest';
import { StingerPlayer } from '../src/utils/StingerPlayer.js';
import { AudioManager } from '../src/utils/AudioManager.js';
import { STINGER_PRELOAD, getMusicLoop } from '../src/utils/musicConfig.js';
import { MUSIC_STINGERS } from '../src/utils/musicStingers.js';
import { MUSIC_LOOPS } from '../src/utils/musicLoops.js';

function makeParam(value = 1) {
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
  return {
    sources,
    gains,
    state: 'running',
    currentTime: 5,
    destination: { id: 'ctx-dest' },
    createGain: vi.fn(() => {
      const g = { gain: makeParam(1), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    }),
    createBufferSource: vi.fn(() => {
      const s = {
        buffer: null,
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(s);
      return s;
    }),
  };
}

const stingerBuffer = () => ({ duration: 3, length: 144000, numberOfChannels: 2 });

describe('StingerPlayer', () => {
  function makePlayer(maxCached = 3) {
    const context = makeContext();
    const loadBuffer = vi.fn(async () => stingerBuffer());
    const player = new StingerPlayer({
      getContext: () => context,
      getDestination: () => context.destination,
      loadBuffer,
      maxCached,
    });
    return { context, loadBuffer, player };
  }

  it('decodes each stinger once, even when asked twice at the same time', async () => {
    const { loadBuffer, player } = makePlayer();
    await Promise.all([player.load('stinger_levelup_D'), player.load('stinger_levelup_D')]);
    expect(loadBuffer).toHaveBeenCalledTimes(1);
    expect(player.has('stinger_levelup_D')).toBe(true);
  });

  it('plays a decoded stinger through its own gain, and fades it out on stop', async () => {
    const { context, player } = makePlayer();
    expect(player.play('stinger_levelup_D')).toBeNull(); // not decoded yet
    await player.load('stinger_levelup_D');
    const voice = player.play('stinger_levelup_D', { volume: 0.4 });
    expect(voice).not.toBeNull();
    expect(player.playing).toBe(true);
    const source = context.sources[0];
    expect(source.start).toHaveBeenCalled();
    expect(voice.gain.gain.value).toBe(0.4);
    voice.stop(200);
    expect(voice.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 5.2);
    expect(source.stop).toHaveBeenCalledWith(5.2 + 0.02);
    source.onended();
    expect(player.playing).toBe(false);
  });

  it('stays silent at zero volume', async () => {
    const { player } = makePlayer();
    await player.load('k');
    expect(player.play('k', { volume: 0 })).toBeNull();
  });

  it('keeps a bounded cache and never evicts a sounding stinger', async () => {
    const { player } = makePlayer(2);
    await player.load('a');
    player.play('a');
    await player.load('b');
    await player.load('c');
    expect(player.has('a')).toBe(true); // playing: protected
    expect(player.has('b')).toBe(false);
    expect(player.has('c')).toBe(true);
  });
});

function makeSound(loaded = {}) {
  const store = new Map(Object.entries(loaded));
  const context = makeContext();
  return {
    locked: false,
    sounds: [],
    context,
    destination: { id: 'master' },
    play: vi.fn(),
    add: vi.fn((key, opts) => ({
      key,
      loop: Boolean(opts?.loop),
      volume: opts?.volume ?? 1,
      isPlaying: false,
      play: vi.fn(function () {
        this.isPlaying = true;
      }),
      stop: vi.fn(),
      destroy: vi.fn(),
      setVolume: vi.fn(),
    })),
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

function musicBuffer(key, seconds = null) {
  const duration = seconds ?? getMusicLoop(key)?.duration ?? 60;
  return {
    duration,
    length: Math.round(duration * 48000),
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(1),
  };
}

describe('AudioManager stingers', () => {
  it('picks the stinger file in the key of the music playing', async () => {
    const sound = makeSound({ music_battle_act2: musicBuffer('music_battle_act2') });
    const audio = new AudioManager(sound);
    audio._fetchAndDecodeStinger = vi.fn(async () => stingerBuffer());
    await audio.playMusic('music_battle_act2', null, 0);
    expect(MUSIC_LOOPS.music_battle_act2.tonic).toBe('C');
    expect(audio.stingerKeyFor('levelup')).toBe('stinger_levelup_C');
    expect(audio.stingerKeyFor('levelup', 'B')).toBe('stinger_levelup_B');
    // a key no file exists for falls back to D
    expect(audio.stingerKeyFor('levelup', 'Gb')).toBe('stinger_levelup_D');
    expect(audio.stingerKeyFor('no_such_stinger')).toBeNull();
  });

  it('preloads the common cues in the new track key when music starts', async () => {
    const sound = makeSound({ music_battle_act1_2: musicBuffer('music_battle_act1_2') });
    const audio = new AudioManager(sound);
    audio._fetchAndDecodeStinger = vi.fn(async () => stingerBuffer());
    await audio.playMusic('music_battle_act1_2', null, 0);
    const requested = audio._fetchAndDecodeStinger.mock.calls.map(([key]) => key);
    for (const name of STINGER_PRELOAD.filter((n) => MUSIC_STINGERS[n])) {
      expect(requested).toContain(`stinger_${name}_G`);
    }
  });

  it('plays a decoded stinger at music volume and ducks the track until its notes end', async () => {
    const sound = makeSound({ music_battle_act1: musicBuffer('music_battle_act1') });
    const audio = new AudioManager(sound);
    audio.setMusicVolume(0.5);
    audio._fetchAndDecodeStinger = vi.fn(async () => stingerBuffer());
    await audio.playMusic('music_battle_act1', null, 0);
    await audio.stingers.load('stinger_levelup_D');
    const duck = vi.spyOn(audio.currentMusic, 'duck');
    const voice = await audio.playStinger('levelup', { duck: 0.3 });
    expect(voice).not.toBeNull();
    expect(voice.gain.gain.value).toBeCloseTo(0.25);
    expect(duck).toHaveBeenCalledWith(0.3, {
      hold: MUSIC_STINGERS.levelup.notesEnd - 0.1,
      release: 0.9,
    });
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('falls back to the sound effect when the cue is not ready, and loads it for next time', async () => {
    const sound = makeSound({
      music_battle_act1: musicBuffer('music_battle_act1'),
      sfx_levelup: {},
    });
    const audio = new AudioManager(sound);
    let release;
    audio._fetchAndDecodeStinger = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(stingerBuffer());
        }),
    );
    await audio.playMusic('music_battle_act1', null, 0);
    const result = await audio.playStinger('levelup', { fallbackSfx: 'sfx_levelup' });
    expect(result).toBeNull();
    expect(sound.play).toHaveBeenCalledWith('sfx_levelup', expect.any(Object));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.stingers.has('stinger_levelup_D')).toBe(true);
  });

  it('can wait briefly for a rare cue to decode', async () => {
    const sound = makeSound({ music_title: musicBuffer('music_title') });
    const audio = new AudioManager(sound);
    audio._fetchAndDecodeStinger = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(stingerBuffer()), 5)),
    );
    await audio.playMusic('music_title', null, 0);
    const voice = await audio.playStinger('levelup', { waitMs: 200 });
    expect(voice).not.toBeNull();
  });

  it('keeps a skipped ceremony silent: stop cancels a cue still decoding and unducks', async () => {
    const sound = makeSound({ music_title: musicBuffer('music_title') });
    const audio = new AudioManager(sound);
    audio._fetchAndDecodeStinger = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(stingerBuffer()), 5)),
    );
    await audio.playMusic('music_title', null, 0);
    audio.stingers._buffers.clear();
    const pending = audio.playStinger('levelup', { waitMs: 200 });
    audio.stopStingers();
    expect(await pending).toBeNull();
    // a cue that is playing fades and the music comes back up
    const voice = await audio.playStinger('levelup', { waitMs: 200 });
    const unduck = vi.spyOn(audio.currentMusic, 'unduck');
    audio.stopStingers(100);
    expect(voice.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    expect(unduck).toHaveBeenCalled();
  });

  it('plays the fallback, not the cue, when music is muted', async () => {
    const sound = makeSound({ music_title: musicBuffer('music_title'), sfx_levelup: {} });
    const audio = new AudioManager(sound);
    audio._fetchAndDecodeStinger = vi.fn(async () => stingerBuffer());
    await audio.playMusic('music_title', null, 0);
    await audio.stingers.load('stinger_levelup_D');
    audio.setMusicVolume(0);
    expect(await audio.playStinger('levelup', { fallbackSfx: 'sfx_levelup' })).toBeNull();
    expect(sound.play).toHaveBeenCalledWith('sfx_levelup', expect.any(Object));
  });
});

describe('AudioManager music cache byte budget', () => {
  it('evicts older decoded tracks once the byte budget is exceeded', async () => {
    const sound = makeSound({
      music_title: musicBuffer('music_title', 100), // ~36.6 MB decoded
      music_shop: musicBuffer('music_shop', 100),
      music_home_base: musicBuffer('music_home_base', 100),
    });
    const audio = new AudioManager(sound, {
      maxCachedMusicTracks: 10,
      maxCachedMusicMegabytes: 80,
    });
    await audio.playMusic('music_title', null, 0);
    await audio.playMusic('music_shop', null, 0);
    expect(sound.game.cache.audio.has('music_title')).toBe(true);
    await audio.playMusic('music_home_base', null, 0);
    // three tracks would be ~110 MB: the oldest goes, the playing one stays
    expect(sound.game.cache.audio.has('music_title')).toBe(false);
    expect(sound.game.cache.audio.has('music_shop')).toBe(true);
    expect(sound.game.cache.audio.has('music_home_base')).toBe(true);
  });
});
