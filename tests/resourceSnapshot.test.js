import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioManager } from '../src/utils/AudioManager.js';
import {
  captureResourceSnapshot,
  countLeakableSounds,
  isLeakableSound,
} from '../src/utils/resourceSnapshot.js';

const require = createRequire(import.meta.url);
const BaseSound = require('phaser/src/sound/BaseSound.js');
const BaseSoundManager = require('phaser/src/sound/BaseSoundManager.js');

function makeEmitter(counts) {
  const entries = Object.entries(counts);
  return {
    eventNames: () => entries.map(([name]) => name),
    listenerCount: (name) => counts[name] || 0,
  };
}

describe('captureResourceSnapshot', () => {
  afterEach(() => {
    delete globalThis.__sceneState;
  });

  it('returns zeroed snapshot for null scene', () => {
    const snap = captureResourceSnapshot(null);
    expect(snap).toEqual({
      sounds: 0,
      tweens: 0,
      timers: 0,
      objects: 0,
      overlayOpen: 0,
      listeners: {
        sceneEvents: 0,
        input: 0,
        keyboard: 0,
        game: 0,
        scale: 0,
      },
      listenerTotal: 0,
    });
  });

  it('captures resource counts and listener totals defensively', () => {
    globalThis.__sceneState = {
      overlays: {
        pauseOverlay: true,
        debugOverlay: false,
        unitDetailOverlay: true,
      },
    };

    const scene = {
      game: {
        sound: {
          sounds: [{ isPlaying: true }, { isPlaying: false }, { isPlaying: true }],
        },
        events: makeEmitter({ any: 4 }),
      },
      tweens: {
        getTweens: () => [{}, {}, {}],
      },
      time: {
        getAllEvents: () => [{}, {}],
      },
      children: {
        list: [{}, {}, {}, {}],
      },
      events: makeEmitter({ create: 1, shutdown: 2 }),
      input: makeEmitter({ pointerdown: 3 }),
      scale: makeEmitter({ resize: 2 }),
    };
    scene.input.keyboard = makeEmitter({ keydown: 5 });

    const snap = captureResourceSnapshot(scene);
    expect(snap.sounds).toBe(2);
    expect(snap.tweens).toBe(3);
    expect(snap.timers).toBe(2);
    expect(snap.objects).toBe(4);
    expect(snap.overlayOpen).toBe(2);
    expect(snap.listeners.sceneEvents).toBe(3);
    expect(snap.listeners.input).toBe(3);
    expect(snap.listeners.keyboard).toBe(5);
    expect(snap.listeners.game).toBe(4);
    expect(snap.listeners.scale).toBe(2);
    expect(snap.listenerTotal).toBe(17);
  });
});

// Phaser's own sound classes: `play` is BaseSoundManager's fire-and-forget (add, destroy
// on complete, play), `add` a BaseSound like the Web Audio manager's.
function makePhaserSoundManager(keys = []) {
  const cached = new Set(keys);
  return {
    sounds: [],
    game: { cache: { audio: { has: (key) => cached.has(key) } } },
    add(key, config) {
      const sound = new BaseSound(this, key, config);
      this.sounds.push(sound);
      return sound;
    },
    play: BaseSoundManager.prototype.play,
  };
}

describe('leakable sounds', () => {
  it('leaves out one-shot effects still sounding into the next scene, and counts the music', () => {
    // journey-run-loop: Begin Run, Confirm, No blessing, Confirm inside the 1.4 s an
    // effect lasts left four effects playing as the route map opened ("sound_leak: 4").
    const sound = makePhaserSoundManager(['sfx_confirm', 'sfx_cursor']);
    const audio = new AudioManager(sound);
    audio.setSFXVolume(0);
    for (const key of ['sfx_confirm', 'sfx_confirm', 'sfx_cursor', 'sfx_confirm']) {
      audio.playSFX(key);
    }
    const music = sound.add('music_explore', { loop: true });
    music.play();

    expect(sound.sounds.filter((s) => s.isPlaying)).toHaveLength(5);
    expect(countLeakableSounds(sound)).toBe(1);
    expect(captureResourceSnapshot({ game: { sound } }).sounds).toBe(1);
    expect(isLeakableSound(music)).toBe(true);
  });

  it('counts a looping sound even when it was played fire-and-forget', () => {
    const sound = makePhaserSoundManager();
    sound.play('music_loop', { loop: true });
    expect(countLeakableSounds(sound)).toBe(1);
  });

  it('counts a one-shot that nothing destroys when it ends', () => {
    const sound = makePhaserSoundManager();
    sound.add('sfx_kept').play();
    expect(countLeakableSounds(sound)).toBe(1);
  });

  it('counts nothing that has stopped', () => {
    const sound = makePhaserSoundManager();
    const music = sound.add('music_explore', { loop: true });
    music.play();
    music.stop();
    expect(countLeakableSounds(sound)).toBe(0);
    expect(countLeakableSounds(null)).toBe(0);
  });
});
