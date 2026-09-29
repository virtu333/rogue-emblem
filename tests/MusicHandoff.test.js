// Entering a battle from the route map (playtest 2026-09-28: "the castle piece was
// silent at the beginning of the map"). The route map used to stop its track on Travel;
// the battle's own track then loaded only after the deploy screen, so on a phone the
// battle opened on seconds of silence. Now the route's track is handed to the battle:
// it plays on until the battle's track is ready, then crossfades into it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/utils/AudioManager.js';

const ROUTE = 'music_explore_act2';
const BATTLE = 'music_battle_castle';

function makeSound(key) {
  const s = {
    key,
    loop: true,
    isPlaying: false,
    volume: 1,
    play: vi.fn(() => {
      s.isPlaying = true;
    }),
    stop: vi.fn(() => {
      s.isPlaying = false;
    }),
    destroy: vi.fn(() => {
      s.destroyed = true;
    }),
    setVolume: vi.fn((v) => {
      s.volume = v;
    }),
  };
  return s;
}

/** A Phaser-like loader whose files finish (or fail) when the test says so. */
function makeLoader(loaded) {
  const once = new Map();
  const on = new Map();
  const loader = {
    queued: [],
    isLoading: () => false,
    once: (event, fn) => once.set(event, [...(once.get(event) || []), fn]),
    on: (event, fn) => on.set(event, [...(on.get(event) || []), fn]),
    off: (event, fn) =>
      on.set(
        event,
        (on.get(event) || []).filter((f) => f !== fn),
      ),
    audio: (key) => loader.queued.push(key),
    start: () => {},
    finish(key) {
      loaded.add(key);
      const fns = once.get(`filecomplete-audio-${key}`) || [];
      once.delete(`filecomplete-audio-${key}`);
      for (const fn of fns) fn({ key });
    },
    fail(key) {
      for (const fn of [...(on.get('loaderror') || [])]) fn({ key });
    },
  };
  return loader;
}

function setup() {
  const loaded = new Set([ROUTE]);
  const sounds = [];
  const loader = makeLoader(loaded);
  const tweens = { add: vi.fn() };
  const sound = {
    locked: false,
    sounds,
    add: vi.fn((key, opts) => {
      const s = makeSound(key);
      s.volume = opts?.volume ?? 1;
      sounds.push(s);
      return s;
    }),
    get: (key) => sounds.find((s) => s.key === key) || null,
    once: vi.fn(),
    game: {
      cache: {
        audio: {
          has: (key) => loaded.has(key),
          add: (key) => loaded.add(key),
          remove: (key) => loaded.delete(key),
        },
      },
    },
  };
  const scene = (key) => ({ scene: { key }, sys: { settings: { key } }, load: loader, tweens });
  const audio = new AudioManager(sound);
  return { audio, sounds, loader, tweens, nodeMap: scene('NodeMap'), battle: scene('Battle') };
}

const playing = (sounds, key) => sounds.filter((s) => s.key === key && s.isPlaying);

describe('the route map hands its track to the battle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays on through the deploy screen and the battle track’s load, then crossfades', async () => {
    const { audio, sounds, loader, tweens, nodeMap, battle } = setup();
    await audio.playMusic(ROUTE, nodeMap, 0);
    const route = audio.currentMusic;

    expect(audio.handOffMusic(nodeMap, 'Battle')).toBe(true);
    // The route map shuts down: its release no longer stops what the battle holds.
    audio.releaseMusic(nodeMap, 0);
    expect(route.stop).not.toHaveBeenCalled();
    expect(audio.currentMusicOwner).toBe('Battle');

    // The battle asks for its track; while it loads the route's track is still heard.
    const started = audio.playMusic(BATTLE, battle, 800);
    await Promise.resolve();
    expect(playing(sounds, ROUTE)).toHaveLength(1);
    expect(audio.currentMusicKey).toBe(ROUTE);

    loader.finish(BATTLE);
    await started;
    expect(audio.currentMusicKey).toBe(BATTLE);
    expect(playing(sounds, BATTLE)).toHaveLength(1);
    // Crossfade, not a cut: the route's track fades out over the battle's fade-in.
    expect(route.__audioStopped).toBe(true);
    expect(route.stop).not.toHaveBeenCalled();
    const fadeOut = tweens.add.mock.calls.find(([t]) => t.value === 0);
    expect(fadeOut?.[0].duration).toBe(800);
    vi.advanceTimersByTime(1400); // the fade's safety net
    expect(route.stop).toHaveBeenCalledTimes(1);
  });

  it('a battle track that cannot load does not leave the route’s track playing in battle', async () => {
    const { audio, loader, nodeMap, battle } = setup();
    await audio.playMusic(ROUTE, nodeMap, 0);
    const route = audio.currentMusic;
    audio.handOffMusic(nodeMap, 'Battle');

    const started = audio.playMusic(BATTLE, battle, 800);
    await Promise.resolve();
    loader.fail(BATTLE);
    await started;
    expect(route.__audioStopped).toBe(true);
    expect(audio.currentMusic).toBeNull();
    vi.advanceTimersByTime(1200);
    expect(route.stop).toHaveBeenCalledTimes(1);
  });

  it('a battle left before its track starts (Back to Map, a failed launch) takes the bridge with it', async () => {
    const { audio, nodeMap } = setup();
    await audio.playMusic(ROUTE, nodeMap, 0);
    const route = audio.currentMusic;
    audio.handOffMusic(nodeMap, 'Battle');
    expect(audio.releaseMusic('Battle', 0)).toBe(true);
    expect(route.stop).toHaveBeenCalledTimes(1);
  });

  it('a failed launch that replays the route track takes it back without a restart', async () => {
    const { audio, nodeMap } = setup();
    await audio.playMusic(ROUTE, nodeMap, 0);
    const route = audio.currentMusic;
    audio.handOffMusic(nodeMap, 'Battle');
    await audio.playMusic(ROUTE, nodeMap, 300);
    expect(audio.currentMusic).toBe(route);
    expect(audio.currentMusicOwner).toBe('NodeMap');
    expect(route.stop).not.toHaveBeenCalled();
  });

  it('voids the route map’s still-loading request, as releasing did', async () => {
    const { audio, sounds, loader, nodeMap } = setup();
    await audio.playMusic(ROUTE, nodeMap, 0);
    const late = audio.playMusic('music_shop', nodeMap, 0);
    await Promise.resolve();
    audio.handOffMusic(nodeMap, 'Battle');
    loader.finish('music_shop');
    await late;
    expect(playing(sounds, 'music_shop')).toHaveLength(0);
    expect(audio.currentMusicKey).toBe(ROUTE);
  });

  it('only the owner can hand a track on', async () => {
    const { audio, nodeMap, battle } = setup();
    await audio.playMusic(ROUTE, nodeMap, 0);
    expect(audio.handOffMusic(battle, 'Title')).toBe(false);
    expect(audio.currentMusicOwner).toBe('NodeMap');
  });

  it('with no handoff, switching tracks still cuts cleanly (no stray fades)', async () => {
    const { audio, loader, tweens, nodeMap, battle } = setup();
    await audio.playMusic(ROUTE, nodeMap, 0);
    const route = audio.currentMusic;
    audio.releaseMusic(nodeMap, 0);
    expect(route.stop).toHaveBeenCalledTimes(1);
    const started = audio.playMusic(BATTLE, battle, 800);
    await Promise.resolve();
    loader.finish(BATTLE);
    await started;
    expect(tweens.add.mock.calls.some(([t]) => t.value === 0)).toBe(false);
  });
});
