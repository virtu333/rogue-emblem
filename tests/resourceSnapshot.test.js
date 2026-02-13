import { afterEach, describe, expect, it } from 'vitest';
import { captureResourceSnapshot } from '../src/utils/resourceSnapshot.js';

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
