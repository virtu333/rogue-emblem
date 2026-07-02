// Tests for the per-scene LIFO overlay stack (structural ESC routing).
// The stack replaces registration-order races: an overlay's ESC handler only
// acts while it is top-of-stack, and scene-level handlers defer entirely
// while any overlay is open.

import { describe, expect, it, vi } from 'vitest';
import {
  pushOverlay,
  removeOverlay,
  isTopOverlay,
  hasOpenOverlay,
  getTopOverlayName,
  cancelTopOverlay,
  clearOverlayStack,
  routeCancel,
} from '../src/utils/overlayStack.js';
import { HelpOverlay } from '../src/ui/HelpOverlay.js';
import { CampaignMapOverlay } from '../src/ui/CampaignMapOverlay.js';

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    style: {},
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setColor() {
      return this;
    },
    setAlpha() {
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy: vi.fn(),
  };
}

function makeScene() {
  const onceHandlers = new Map();
  const keyObjects = [];
  return {
    events: {
      once: vi.fn((event, cb) => {
        const list = onceHandlers.get(event) || [];
        list.push(cb);
        onceHandlers.set(event, list);
      }),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
    emitShutdown() {
      const list = onceHandlers.get('shutdown') || [];
      onceHandlers.delete('shutdown');
      for (const cb of list) cb();
    },
    input: {
      keyboard: {
        addKey: vi.fn(() => {
          const key = {
            handlers: [],
            on(event, fn, ctx) {
              this.handlers.push({ event, fn, ctx });
            },
            off() {
              this.handlers = [];
            },
            pressEsc(event) {
              for (const h of [...this.handlers]) {
                if (h.event === 'down') h.fn.call(h.ctx, this, event);
              }
            },
          };
          keyObjects.push(key);
          return key;
        }),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    add: {
      rectangle: (x, y, w, h, color, alpha) =>
        makeDisplayObject({ kind: 'rect', x, y, w, h, color, alpha }),
      text: (x, y, text, style) => makeDisplayObject({ kind: 'text', x, y, text, style }),
      circle: () => makeDisplayObject({ kind: 'circle' }),
      graphics: () =>
        makeDisplayObject({
          kind: 'graphics',
          lineStyle() {
            return this;
          },
          lineBetween() {
            return this;
          },
          beginPath() {
            return this;
          },
          moveTo() {
            return this;
          },
          lineTo() {
            return this;
          },
          strokePath() {
            return this;
          },
        }),
    },
    tweens: { add: vi.fn() },
    game: { events: null },
    registry: { get: vi.fn(() => null) },
    _keyObjects: keyObjects,
  };
}

describe('overlayStack core', () => {
  it('tracks LIFO order with push/remove and tolerates out-of-order close', () => {
    const scene = makeScene();
    expect(hasOpenOverlay(scene)).toBe(false);

    const a = pushOverlay(scene, { name: 'a' });
    const b = pushOverlay(scene, { name: 'b' });
    const c = pushOverlay(scene, { name: 'c' });

    expect(hasOpenOverlay(scene)).toBe(true);
    expect(getTopOverlayName(scene)).toBe('c');
    expect(isTopOverlay(scene, c)).toBe(true);
    expect(isTopOverlay(scene, a)).toBe(false);

    // Out-of-order close: removing the middle entry keeps c on top.
    expect(removeOverlay(scene, b)).toBe(true);
    expect(isTopOverlay(scene, c)).toBe(true);

    removeOverlay(scene, c);
    expect(isTopOverlay(scene, a)).toBe(true);
    removeOverlay(scene, a);
    expect(hasOpenOverlay(scene)).toBe(false);

    // Idempotent removal
    expect(removeOverlay(scene, a)).toBe(false);
    expect(removeOverlay(scene, null)).toBe(false);
  });

  it('cancelTopOverlay invokes only the top onCancel and force-removes broken handlers', () => {
    const scene = makeScene();
    const lowCancel = vi.fn(() => true);
    pushOverlay(scene, { name: 'low', onCancel: lowCancel });
    const topCancel = vi.fn(() => true);
    pushOverlay(scene, { name: 'top', onCancel: topCancel });

    expect(cancelTopOverlay(scene)).toBe(true);
    expect(topCancel).toHaveBeenCalledTimes(1);
    expect(lowCancel).not.toHaveBeenCalled();

    // Broken handler: must be force-removed so the stack can't wedge.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenToken = pushOverlay(scene, {
      name: 'broken',
      onCancel: () => {
        throw new Error('boom');
      },
    });
    expect(getTopOverlayName(scene)).toBe('broken');
    expect(cancelTopOverlay(scene)).toBe(true);
    expect(isTopOverlay(scene, brokenToken)).toBe(false);
    vi.restoreAllMocks();
  });

  it('auto-clears on scene shutdown so stale entries cannot survive restarts', () => {
    const scene = makeScene();
    pushOverlay(scene, { name: 'leaked' });
    expect(hasOpenOverlay(scene)).toBe(true);

    scene.emitShutdown();
    expect(hasOpenOverlay(scene)).toBe(false);

    // Stack re-arms after shutdown (scene instances are reused by Phaser).
    pushOverlay(scene, { name: 'fresh' });
    expect(hasOpenOverlay(scene)).toBe(true);
    expect(scene.events.once).toHaveBeenCalledTimes(2);
    clearOverlayStack(scene);
    expect(hasOpenOverlay(scene)).toBe(false);
  });
});

describe('overlay ESC routing via the stack', () => {
  it('a lower overlay ignores ESC while a newer overlay is on top (LIFO by construction)', async () => {
    const scene = makeScene();

    // CampaignMapOverlay opened first…
    const campaign = new CampaignMapOverlay(scene, {});
    campaign.show();
    expect(getTopOverlayName(scene)).toBe('campaign_map');

    // …then HelpOverlay opens on top of it.
    const help = new HelpOverlay(scene, null);
    help.show();
    expect(getTopOverlayName(scene)).toBe('help');

    // ESC dispatched to BOTH key handlers (simulates Phaser broadcasting the
    // key to every registered handler, in either order).
    const escEvent = {};
    for (const key of scene._keyObjects) key.pressEsc(escEvent);

    // Only the top overlay closed; the campaign map is still open and is now top.
    expect(help.visible).toBe(false);
    expect(campaign.visible).toBe(true);
    expect(getTopOverlayName(scene)).toBe('campaign_map');

    // Next ESC (new input tick — the per-tick consume flag has reset)
    // closes the campaign map.
    await new Promise((resolve) => queueMicrotask(resolve));
    for (const key of scene._keyObjects) key.pressEsc({});
    expect(campaign.visible).toBe(false);
    expect(hasOpenOverlay(scene)).toBe(false);
  });

  it('overlays remove themselves from the stack on hide', () => {
    const scene = makeScene();
    const help = new HelpOverlay(scene, null);
    help.show();
    expect(hasOpenOverlay(scene)).toBe(true);
    help.hide();
    expect(hasOpenOverlay(scene)).toBe(false);
  });
});

describe('routeCancel (device-independent back: gamepad B / mobile back)', () => {
  function makeCancelScene() {
    return { requestCancel: vi.fn(() => true), isStoryInputLocked: () => false };
  }

  it('closes only the topmost overlay per press, then falls through to requestCancel', () => {
    const scene = makeCancelScene();
    const closed = [];
    const tokenA = pushOverlay(scene, {
      name: 'a',
      onCancel: () => {
        closed.push('a');
        removeOverlay(scene, tokenA);
      },
    });
    const tokenB = pushOverlay(scene, {
      name: 'b',
      onCancel: () => {
        closed.push('b');
        removeOverlay(scene, tokenB);
      },
    });

    // First B: closes only the top overlay (b), not a, and does NOT requestCancel.
    expect(routeCancel(scene)).toBe(true);
    expect(closed).toEqual(['b']);
    expect(scene.requestCancel).not.toHaveBeenCalled();

    // Second B: closes a.
    expect(routeCancel(scene)).toBe(true);
    expect(closed).toEqual(['b', 'a']);
    expect(scene.requestCancel).not.toHaveBeenCalled();

    // Third B: no overlays left -> normal cancel chain.
    expect(routeCancel(scene)).toBe(true);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
    clearOverlayStack(scene);
  });

  it('does nothing while story input is locked', () => {
    const scene = { requestCancel: vi.fn(() => true), isStoryInputLocked: () => true };
    expect(routeCancel(scene)).toBe(false);
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });

  it('is safe with a minimal scene that has no requestCancel', () => {
    expect(routeCancel({})).toBe(false);
    expect(routeCancel(null)).toBe(false);
  });
});
