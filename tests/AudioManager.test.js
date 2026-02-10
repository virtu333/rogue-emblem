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

function makeSoundManager({ sounds = [], has = true } = {}) {
  return {
    locked: false,
    sounds,
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
        audio: {
          has: vi.fn(() => has),
        },
      },
    },
  };
}

describe('AudioManager', () => {
  it('stops orphaned looping tracks before starting new music', () => {
    const orphanA = makeLoopingSound('music_explore_act1');
    const orphanB = makeLoopingSound('music_explore_act1_2');
    const sound = makeSoundManager({ sounds: [orphanA, orphanB] });
    const audio = new AudioManager(sound);

    audio.playMusic('music_battle_act1_1', null, 0);

    expect(orphanA.stop).toHaveBeenCalledTimes(1);
    expect(orphanA.destroy).toHaveBeenCalledTimes(1);
    expect(orphanB.stop).toHaveBeenCalledTimes(1);
    expect(orphanB.destroy).toHaveBeenCalledTimes(1);
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

  it('stops active music sounds even when loop getter throws', () => {
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
    const sound = makeSoundManager({ sounds: [staleMusic] });
    const audio = new AudioManager(sound);

    audio.playMusic('music_battle_act1_1', null, 0);

    expect(staleMusic.stop).toHaveBeenCalledTimes(1);
    expect(staleMusic.destroy).toHaveBeenCalledTimes(1);
    expect(audio.currentMusicKey).toBe('music_battle_act1_1');
  });
});
