// Layered music under the music cache budget (mobile: 3 tracks / 120 MB).
//
// An adaptive track is several cached buffers (primary + calm and/or a boss's
// enrage layer). Loading them runs the cache budget, and none of that may
// evict a buffer the current or the pending track needs, or leave the game
// silent. These tests run the real fetch + decode + LRU path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/utils/AudioManager.js';
import { LoopedMusic } from '../src/utils/LoopedMusic.js';
import {
  ENTITY_FINALE,
  getBossEnrageLayer,
  getMusicLayers,
  getMusicLoop,
} from '../src/utils/musicConfig.js';

const SAMPLE_RATE = 44100;

function decodedBuffer(key) {
  const loop = getMusicLoop(key);
  const duration = loop ? loop.duration : 30;
  return {
    key,
    duration,
    length: Math.round(duration * SAMPLE_RATE),
    numberOfChannels: 2,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => new Float32Array(1),
  };
}

/** Decoded bytes the manager accounts for one track (float32 PCM). */
function mb(key) {
  const b = decodedBuffer(key);
  return (b.length * b.numberOfChannels * 4) / (1024 * 1024);
}

function makeParam(initial) {
  return {
    value: initial,
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
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    sources: [],
    createGain: vi.fn(() => ({ gain: makeParam(1), connect: vi.fn(), disconnect: vi.fn() })),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      ctx.sources.push(source);
      return source;
    }),
    decodeAudioData: vi.fn((bytes) => Promise.resolve(decodedBuffer(bytes.key))),
  };
  return ctx;
}

function makeSound(preloaded = []) {
  const store = new Map(preloaded.map((k) => [k, decodedBuffer(k)]));
  const removed = [];
  const context = makeContext();
  const sound = {
    locked: false,
    sounds: [],
    context,
    destination: { id: 'master' },
    removed,
    add: vi.fn((key, opts) => ({
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
      setVolume: vi.fn(),
    })),
    once: vi.fn(),
    play: vi.fn(),
    game: {
      cache: {
        audio: {
          has: (k) => store.has(k),
          get: (k) => store.get(k),
          add: (k, v) => store.set(k, v),
          remove: vi.fn((k) => {
            removed.push(k);
            store.delete(k);
          }),
          keys: () => Array.from(store.keys()),
        },
      },
    },
  };
  return sound;
}

let fetchLog;
let failNext;

function keyFromSrc(src) {
  const m = /\/([^/]+)\.mp3$/.exec(String(src));
  return m ? m[1] : String(src);
}

beforeEach(() => {
  fetchLog = [];
  failNext = new Set();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (src) => {
      const key = keyFromSrc(src);
      fetchLog.push(key);
      if (failNext.has(key)) {
        failNext.delete(key);
        return { ok: false, status: 503 };
      }
      return { ok: true, arrayBuffer: async () => ({ key }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The mobile budget BootScene sets (3 tracks / 120 MB) unless overridden. */
function mobileAudio(sound, opts = {}) {
  const audio = new AudioManager(sound, {
    isMobile: true,
    maxCachedMusicTracks: 3,
    maxCachedMusicMegabytes: 120,
    ...opts,
  });
  // Stingers have their own cache; keep them out of the music fetch log.
  audio._fetchAndDecodeStinger = vi.fn(async (key) => decodedBuffer(key));
  audio._fetchStingerBytes = vi.fn(async () => new ArrayBuffer(8));
  return audio;
}

function expectPlaying(audio, key) {
  expect(audio.currentMusicKey).toBe(key);
  expect(audio.currentMusic).toBeInstanceOf(LoopedMusic);
  expect(audio.currentMusic.isPlaying).toBe(true);
}

const BATTLE = 'music_battle_act1';
const BATTLE_CALM = getMusicLayers(BATTLE).calm;
const BOSS = 'music_boss_act1';
const BOSS_ENRAGE = getBossEnrageLayer(BOSS, 'Iron Captain');
const ENTITY = ENTITY_FINALE.theme;
const FINALE = ENTITY_FINALE.track;
const FINALE_HUM = ENTITY_FINALE.hum;

describe('layered music under the mobile cache budget', () => {
  it('fixture sanity: the layer keys exist and the byte sizes are what the scenarios assume', () => {
    expect(BATTLE_CALM).toBe('music_battle_act1_calm');
    expect(BOSS_ENRAGE).toBe('music_boss_act1_enrage_iron_captain');
    expect(getMusicLoop(FINALE_HUM).duration).toBe(getMusicLoop(FINALE).duration);
    // battle pair + boss pair fit 120 MB; the track cap (3) is what binds
    expect(2 * mb(BATTLE) + 2 * mb(BOSS)).toBeLessThan(120);
    // finale pair + the cached calm layer fit 100 MB, adding the battle primary does not
    expect(mb(FINALE) + mb(FINALE_HUM) + mb(BATTLE_CALM)).toBeLessThan(100);
    expect(mb(FINALE) + mb(FINALE_HUM) + mb(BATTLE_CALM) + mb(BATTLE)).toBeGreaterThan(100);
    // the Entity's theme, finale and hum fit the mobile budget together
    expect(mb(ENTITY) + mb(FINALE) + mb(FINALE_HUM)).toBeLessThan(120);
  });

  it('track cap: battle (calm+full) -> boss (full+enrage) keeps music playing on every layer', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound);

    audio.setMusicIntensity('calm', 0);
    await audio.playMusic(BATTLE, null, 0);
    expectPlaying(audio, BATTLE);
    expect(audio.currentMusic.layer).toBe('calm');
    audio.setMusicIntensity('full', 1200);
    expect(audio.currentMusic.layer).toBe('full');

    // The boss battle starts while the battle theme (2 cached buffers) still plays.
    sound.removed.length = 0;
    audio.setMusicIntensity('full', 0);
    await audio.playMusic(BOSS, null, 0, { layers: { enrage: BOSS_ENRAGE } });

    // Loading the enrage layer must not evict the boss primary it belongs to.
    expect(sound.removed).not.toContain(BOSS);
    expect(sound.removed).not.toContain(BOSS_ENRAGE);
    expectPlaying(audio, BOSS);
    expect(audio.currentMusic.layerNames.sort()).toEqual(['enrage', 'full']);
    audio.setMusicIntensity('enrage', 2500);
    expect(audio.currentMusic.layer).toBe('enrage');
    expect(audio.currentMusic.isPlaying).toBe(true);
    // The budget is still honoured once the old theme is no longer needed.
    expect(sound.game.cache.audio.has(BOSS)).toBe(true);
    expect(sound.game.cache.audio.has(BOSS_ENRAGE)).toBe(true);
    expect(audio._musicCacheLru.length).toBeLessThanOrEqual(3);
    // Stingers (preloaded on every start) live in their own cache.
    expect(audio._musicCacheLru.every((k) => k.startsWith('music_'))).toBe(true);
    expect(sound.removed.every((k) => k.startsWith('music_'))).toBe(true);
    // Each file was fetched exactly once.
    expect(fetchLog.filter((k) => k === BOSS)).toHaveLength(1);
    expect(fetchLog.filter((k) => k === BOSS_ENRAGE)).toHaveLength(1);
  });

  it('track cap with the old theme released first (BattleScene releaseFirst)', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound, { maxCachedMusicTracks: 2 });
    await audio.playMusic('music_explore_act1', null, 0);
    audio.releaseMusic(null, 0);
    audio.stopMusic(null, 0, true);
    sound.removed.length = 0;
    await audio.playMusic(BOSS, null, 0, { layers: { enrage: BOSS_ENRAGE } });
    expect(sound.removed).not.toContain(BOSS);
    expectPlaying(audio, BOSS);
    expect(audio.currentMusic.hasLayer('enrage')).toBe(true);
  });

  it('byte budget: an already-cached layer of the pending track is neither evicted nor refetched', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound, { maxCachedMusicTracks: 10, maxCachedMusicMegabytes: 100 });
    // The calm mix is still cached from an earlier battle; its primary is not.
    sound.game.cache.audio.add(BATTLE_CALM, decodedBuffer(BATTLE_CALM));
    audio._markMusicCached(BATTLE_CALM);
    // A boss fight (the Entity's finale + its hum) then plays: ~55 MB + ~27 MB cached.
    await audio.playMusic(FINALE, null, 0, { layers: { hum: FINALE_HUM }, layerGains: { hum: 1 } });
    expectPlaying(audio, FINALE);
    expect(sound.game.cache.audio.has(BATTLE_CALM)).toBe(true);

    sound.removed.length = 0;
    fetchLog.length = 0;
    audio.setMusicIntensity('calm', 0);
    await audio.playMusic(BATTLE, null, 0);

    expect(sound.removed).not.toContain(BATTLE);
    expect(sound.removed).not.toContain(BATTLE_CALM);
    expect(fetchLog).toEqual([BATTLE]);
    expectPlaying(audio, BATTLE);
    expect(audio.currentMusic.layer).toBe('calm');
    audio.setMusicIntensity('full', 1200);
    expect(audio.currentMusic.layer).toBe('full');
    // The old boss pair made room once the battle theme took over.
    expect(audio._cachedMusicBytes()).toBeLessThanOrEqual(100 * 1024 * 1024);
  });

  it("the Entity's finale: preloaded under its theme, it starts on the downbeat with its hum", async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound);
    await audio.playMusic('music_explore_deep', null, 0);
    audio.stopMusic(null, 0, true);
    await audio.playMusic(ENTITY, null, 0);
    // BattleMusicController decodes the finale and its hum while the theme plays.
    audio.preloadMusic([FINALE, FINALE_HUM]);
    await vi.waitFor(() => expect(sound.game.cache.audio.has(FINALE_HUM)).toBe(true));
    expect(sound.game.cache.audio.has(FINALE)).toBe(true);
    expectPlaying(audio, ENTITY);
    // The first wound cuts the theme; the finale starts on the hinge's handoff.
    audio.stopMusic(null, 0, true);
    sound.removed.length = 0;
    fetchLog.length = 0;
    await audio.playMusic(FINALE, null, 0, {
      layers: { hum: FINALE_HUM },
      layerGains: { hum: 0.9 },
      startAt: 5,
    });
    expectPlaying(audio, FINALE);
    expect(fetchLog).toEqual([]);
    expect(sound.removed).not.toContain(FINALE);
    expect(sound.removed).not.toContain(FINALE_HUM);
    const music = audio.currentMusic;
    expect(music.startTime).toBe(5);
    expect(music.layerNames).toEqual(['full', 'hum']);
    expect(music.layer).toBe('full');
    expect(audio.currentMusicLayerKeys).toEqual([FINALE_HUM]);
    expect(audio._evictCachedMusic(FINALE_HUM)).toBe(false);
    expect(audio.setMusicLayerGain('hum', 0.3, 0)).toBe(true);
    expect(audio._musicCacheLru.length).toBeLessThanOrEqual(3);
    expect(audio._cachedMusicBytes()).toBeLessThanOrEqual(120 * 1024 * 1024);
  });

  it('a sibling layer finishing its load never evicts a sibling of the same pending track', async () => {
    const sound = makeSound();
    // Only room for two tracks: primary + one layer + the extra enrage layer = 3.
    const audio = mobileAudio(sound, { maxCachedMusicTracks: 2 });
    await audio.playMusic(BATTLE, null, 0, { layers: { enrage: BOSS_ENRAGE } });
    expect(sound.removed).not.toContain(BATTLE);
    expect(sound.removed).not.toContain(BATTLE_CALM);
    expectPlaying(audio, BATTLE);
    // BOSS_ENRAGE is not on BATTLE's timeline, so LoopedMusic drops it; calm stays.
    expect(audio.currentMusic.hasLayer('calm')).toBe(true);
  });

  it('never evicts a buffer a live (fading-out) LoopedMusic still plays', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound);
    await audio.playMusic(BATTLE, null, 0);
    const old = audio.currentMusic;
    const scene = {
      sys: { settings: { key: 'BattleScene' } },
      tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    };
    vi.useFakeTimers();
    try {
      audio.stopMusic(scene, 500, true);
      expect(old.isPlaying).toBe(true); // still fading out
      expect(audio._evictCachedMusic(BATTLE)).toBe(false);
      expect(audio._evictCachedMusic(BATTLE_CALM)).toBe(false);
      vi.advanceTimersByTime(1100); // fade safety net destroys it
      expect(old.isPlaying).toBe(false);
      expect(audio._evictCachedMusic(BATTLE_CALM)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('under budget nothing is evicted and nothing is refetched', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound, { maxCachedMusicTracks: 20, maxCachedMusicMegabytes: 1000 });
    audio.setMusicIntensity('calm', 0);
    await audio.playMusic(BATTLE, null, 0);
    await audio.playMusic(BOSS, null, 0, { layers: { enrage: BOSS_ENRAGE } });
    await audio.playMusic(BATTLE, null, 0);
    expect(sound.removed).toEqual([]);
    expect(fetchLog.sort()).toEqual([BATTLE, BATTLE_CALM, BOSS, BOSS_ENRAGE].sort());
    expectPlaying(audio, BATTLE);
    expect(audio.currentMusic.layer).toBe('calm');
  });
});

describe('layer switching when a layer is unavailable', () => {
  it('keeps playing when a layer buffer leaves the cache mid-play', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound);
    audio.setMusicIntensity('calm', 0);
    await audio.playMusic(BATTLE, null, 0);
    const music = audio.currentMusic;
    // Something outside the manager drops the calm buffer from Phaser's cache.
    sound.game.cache.audio.remove(BATTLE_CALM);
    audio.setMusicIntensity('full', 1200);
    audio.setMusicIntensity('calm', 3000);
    expect(audio.currentMusic).toBe(music);
    expect(music.isPlaying).toBe(true);
    expect(music.layer).toBe('calm'); // the voice holds its own buffers
  });

  it('a layer that failed to load keeps the current layer, then is reloaded and crossfaded in', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound);
    failNext.add(BOSS_ENRAGE);
    audio.setMusicIntensity('full', 0);
    await audio.playMusic(BOSS, null, 0, { layers: { enrage: BOSS_ENRAGE } });
    const music = audio.currentMusic;
    expectPlaying(audio, BOSS);
    expect(music.hasLayer('enrage')).toBe(false);
    const sourcesBefore = sound.context.sources.length;

    // Turn pressure enrages the boss: the music must keep going on 'full'...
    sound.context.currentTime = 100; // well into the loop region
    expect(audio.setMusicIntensity('enrage', 2500)).toBe('enrage');
    expect(audio.currentMusic).toBe(music);
    expect(music.isPlaying).toBe(true);
    expect(music.layer).toBe('full');

    // ...and the enrage layer, once reloaded, joins on the same timeline.
    await vi.waitFor(() => expect(music.hasLayer('enrage')).toBe(true));
    expect(music.layer).toBe('enrage');
    expect(audio.currentMusicLayerKeys).toContain(BOSS_ENRAGE);
    const added = sound.context.sources.slice(sourcesBefore);
    expect(added).toHaveLength(1);
    const [when, offset] = added[0].start.mock.calls[0];
    const loop = getMusicLoop(BOSS);
    const span = loop.loopEnd - loop.loopStart;
    const expected =
      when - music._startTime < loop.loopEnd
        ? when - music._startTime
        : loop.loopStart + ((when - music._startTime - loop.loopStart) % span);
    expect(offset).toBeCloseTo(expected, 9);
    expect(added[0].loopStart).toBe(loop.loopStart);
    expect(added[0].loopEnd).toBe(loop.loopEnd);
  });

  it('does not retry a layer that cannot join (one attempt per voice)', async () => {
    const sound = makeSound();
    const audio = mobileAudio(sound);
    failNext.add(BOSS_ENRAGE);
    await audio.playMusic(BOSS, null, 0, { layers: { enrage: BOSS_ENRAGE } });
    failNext.add(BOSS_ENRAGE);
    audio.setMusicIntensity('enrage', 0);
    await vi.waitFor(() => expect(fetchLog.filter((k) => k === BOSS_ENRAGE)).toHaveLength(2));
    await Promise.resolve();
    audio.setMusicIntensity('full', 0);
    audio.setMusicIntensity('enrage', 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchLog.filter((k) => k === BOSS_ENRAGE)).toHaveLength(2);
    expect(audio.currentMusic.isPlaying).toBe(true);
    expect(audio.currentMusic.layer).toBe('full');
  });

  it('a track started while audio was locked keeps its extra (enrage) layer after unlock', async () => {
    const sound = makeSound([BOSS, BOSS_ENRAGE]);
    sound.locked = true;
    let unlock = null;
    sound.once = vi.fn((event, cb) => {
      if (event === 'unlocked') unlock = cb;
    });
    const audio = mobileAudio(sound);
    await audio.playMusic(BOSS, null, 0, { layers: { enrage: BOSS_ENRAGE } });
    expect(audio.currentMusic).toBeNull();
    sound.locked = false;
    unlock();
    await vi.waitFor(() => expect(audio.currentMusicKey).toBe(BOSS));
    expect(audio.currentMusic.hasLayer('enrage')).toBe(true);
  });
});
