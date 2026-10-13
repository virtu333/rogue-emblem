// How soon a track starts (audit, Oct 2026: a battle's music waited on the first gesture
// Phaser saw, then on its primary, then on each layer in turn):
// - a gesture on a DOM surface resumes the context without Phaser seeing it: the
//   context's state unlocks music anyway;
// - while audio is locked the track is fetched and decoded, so the gesture only starts it;
// - the adaptive layers load beside the primary, not after it;
// - a boss's enrage layer never holds the start up: it joins the running timeline.
import { describe, it, expect, vi } from 'vitest';
import { rememberAudioBuffer } from '../src/utils/audioAssets.js';
import { AudioManager } from '../src/utils/AudioManager.js';
import { LoopedMusic } from '../src/utils/LoopedMusic.js';
import { getBossEnrageLayer, getMusicLayers, getMusicLoop } from '../src/utils/musicConfig.js';

const BATTLE = 'music_battle_act1';
const CALM = getMusicLayers(BATTLE).calm;
const BOSS = 'music_boss_act1';
const ENRAGE = getBossEnrageLayer(BOSS, 'Iron Captain');

function decoded(key) {
  const loop = getMusicLoop(key);
  return rememberAudioBuffer(key, {
    duration: loop ? loop.duration : 60,
    getChannelData: () => new Float32Array(1),
  });
}

function makeContext(state = 'running') {
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
  const listeners = {};
  return {
    state,
    currentTime: 0,
    destination: {},
    listeners,
    addEventListener: vi.fn((type, fn) => {
      (listeners[type] ||= []).push(fn);
    }),
    resume: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
    createBufferSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };
}

/** Phaser's sound manager as far as the music path reads it, locked or not. */
function makeSound({ loaded = [], locked = false } = {}) {
  const store = new Map(loaded.map((k) => [k, decoded(k)]));
  const handlers = {};
  const sound = {
    locked,
    unlocked: false,
    sounds: [],
    context: makeContext(locked ? 'suspended' : 'running'),
    destination: { id: 'master' },
    handlers,
    once: vi.fn((event, fn) => {
      handlers[event] = fn;
    }),
    add: vi.fn(),
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
    store,
    /** What Phaser's BaseSoundManager.update does with the flag each step. */
    step() {
      if (this.unlocked) {
        this.unlocked = false;
        this.locked = false;
        this.handlers.unlocked?.();
      }
    },
  };
  return sound;
}

/** Loads that finish only when the test says so: key -> { resolve, reject }. */
function deferredLoads(audio, sound) {
  const pending = new Map();
  const calls = [];
  vi.spyOn(audio, '_ensureMusicLoaded').mockImplementation((key) => {
    calls.push(key);
    if (sound.store.has(key)) return Promise.resolve();
    if (pending.has(key)) return pending.get(key).promise;
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = () => {
        sound.store.set(key, decoded(key));
        res();
      };
      reject = rej;
    });
    pending.set(key, { promise, resolve, reject });
    return promise;
  });
  return { pending, calls };
}

function quietStingers(audio) {
  audio.preloadStingers = vi.fn();
  audio.prefetchStingers = vi.fn();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('unlocking on the context, not only on Phaser', () => {
  it('a context resumed by a tap Phaser never saw plays the track at once', async () => {
    const sound = makeSound({ loaded: [BATTLE, CALM], locked: true });
    const audio = new AudioManager(sound);
    quietStingers(audio);
    // audioRecovery's capture-phase listener resumed it; Phaser still says locked.
    sound.context.state = 'running';
    await audio.playMusic(BATTLE, null, 0);
    expect(audio.currentMusic).toBeInstanceOf(LoopedMusic);
    expect(audio.currentMusicKey).toBe(BATTLE);
    // ...and Phaser is told, so its own lock clears on its next step.
    expect(sound.unlocked).toBe(true);
  });

  it('a track deferred while locked starts when the context begins running', async () => {
    const sound = makeSound({ loaded: [BATTLE, CALM], locked: true });
    const audio = new AudioManager(sound);
    quietStingers(audio);
    await audio.playMusic(BATTLE, null, 0);
    expect(audio.currentMusic).toBeNull();
    // The tap lands on a menu: the context resumes, Phaser's body listener never fires.
    sound.context.state = 'running';
    for (const fn of sound.context.listeners.statechange || []) fn();
    sound.step();
    await vi.waitFor(() => expect(audio.currentMusicKey).toBe(BATTLE));
    expect(audio.currentMusic.isPlaying).toBe(true);
  });

  it('a context that suspends again (a blur) is not taken for an unlock', () => {
    const sound = makeSound({ locked: true });
    new AudioManager(sound);
    sound.context.state = 'interrupted';
    for (const fn of sound.context.listeners.statechange || []) fn();
    expect(sound.unlocked).toBe(false);
  });

  it('an older deferred request never replays over a track that started since', async () => {
    const sound = makeSound({ loaded: [BATTLE, CALM, 'music_title'], locked: true });
    const audio = new AudioManager(sound);
    quietStingers(audio);
    await audio.playMusic('music_title', null, 0);
    sound.context.state = 'running';
    await audio.playMusic(BATTLE, null, 0);
    sound.step(); // Phaser's 'unlocked' arrives after the battle theme started
    await flush();
    expect(audio.currentMusicKey).toBe(BATTLE);
  });
});

describe('fetching while locked', () => {
  it('fetches and decodes the track and its start layers before the first gesture', async () => {
    const sound = makeSound({ locked: true });
    const audio = new AudioManager(sound);
    quietStingers(audio);
    const { pending, calls } = deferredLoads(audio, sound);
    await audio.playMusic(BATTLE, null, 0);
    expect(audio.currentMusic).toBeNull();
    expect(calls.sort()).toEqual([BATTLE, CALM].sort());
    pending.get(BATTLE).resolve();
    pending.get(CALM).resolve();
    await flush();
    calls.length = 0;
    // The gesture: the track starts from what is already decoded.
    sound.context.state = 'running';
    sound.unlocked = true;
    sound.step();
    await vi.waitFor(() => expect(audio.currentMusicKey).toBe(BATTLE));
    expect(audio.currentMusic.hasLayer('calm')).toBe(true);
    expect(calls.filter((k) => !sound.store.has(k))).toEqual([]);
  });

  it('keeps what it fetched ahead out of the cache budget while it waits', async () => {
    const sound = makeSound({ locked: true });
    const audio = new AudioManager(sound);
    quietStingers(audio);
    deferredLoads(audio, sound);
    await audio.playMusic(BATTLE, null, 0);
    expect(audio.getAudioDiagnostics().requested.sort()).toEqual([BATTLE, CALM].sort());
  });
});

describe('loading the layers', () => {
  it('starts the calm layer loading beside the primary, not after it', async () => {
    const sound = makeSound();
    const audio = new AudioManager(sound);
    quietStingers(audio);
    audio.setMusicIntensity('calm', 0);
    const { pending, calls } = deferredLoads(audio, sound);
    const play = audio.playMusic(BATTLE, null, 0);
    await flush();
    // The primary has not finished, and the calm mix is already on its way.
    expect(calls).toContain(BATTLE);
    expect(calls).toContain(CALM);
    pending.get(BATTLE).resolve();
    await flush();
    // The battle opens on calm, so the start still waits for it.
    expect(audio.currentMusic).toBeNull();
    pending.get(CALM).resolve();
    await play;
    expect(audio.currentMusic.layer).toBe('calm');
  });

  it("a boss's enrage layer never holds up the start; it joins the running track", async () => {
    const sound = makeSound({ loaded: [BOSS] });
    const audio = new AudioManager(sound);
    quietStingers(audio);
    const { pending } = deferredLoads(audio, sound);
    await audio.playMusic(BOSS, null, 0, { layers: { enrage: ENRAGE } });
    const music = audio.currentMusic;
    expect(music).toBeInstanceOf(LoopedMusic);
    expect(music.isPlaying).toBe(true);
    expect(music.hasLayer('enrage')).toBe(false);
    // Turn pressure enrages the boss before the layer has arrived: full plays on...
    audio.setMusicIntensity('enrage', 0);
    expect(music.layer).toBe('full');
    // ...and the layer crossfades in once it is decoded, on the same voice.
    pending.get(ENRAGE).resolve();
    await vi.waitFor(() => expect(music.hasLayer('enrage')).toBe(true));
    expect(audio.currentMusic).toBe(music);
    expect(music.layer).toBe('enrage');
    expect(audio.currentMusicLayerKeys).toContain(ENRAGE);
  });

  it('an additive layer (the finale hum) is still there at the first note', async () => {
    const finale = 'music_boss_entity_finale';
    const hum = 'music_boss_entity_finale_hum';
    const sound = makeSound({ loaded: [finale] });
    const audio = new AudioManager(sound);
    quietStingers(audio);
    const { pending } = deferredLoads(audio, sound);
    const play = audio.playMusic(finale, null, 0, {
      layers: { hum },
      layerGains: { hum: 0.4 },
    });
    await flush();
    expect(audio.currentMusic).toBeNull();
    pending.get(hum).resolve();
    await play;
    expect(audio.currentMusic.layerNames).toEqual(['full', 'hum']);
  });
});
