import { describe, it, expect, vi } from 'vitest';
import { PauseOverlay } from '../src/ui/PauseOverlay.js';

// Minimal Phaser scene mock
function mockScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: () => ({
        setDepth: function () { return this; },
        setInteractive: function () { return this; },
        setStrokeStyle: function () { return this; },
        destroy: vi.fn(),
      }),
      text: (_x, _y, _label, _style) => ({
        setOrigin: function () { return this; },
        setDepth: function () { return this; },
        setInteractive: function () { return this; },
        setColor: function () { return this; },
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
    },
  };
}

describe('PauseOverlay', () => {
  it('hide() calls onResume', () => {
    const onResume = vi.fn();
    const overlay = new PauseOverlay(mockScene(), { onResume });
    overlay.show();
    overlay.hide();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('hideForTransition() does NOT call onResume', () => {
    const onResume = vi.fn();
    const overlay = new PauseOverlay(mockScene(), { onResume });
    overlay.show();
    overlay.hideForTransition();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('hideForTransition() cleans up UI objects and sets visible to false', () => {
    const onResume = vi.fn();
    const overlay = new PauseOverlay(mockScene(), { onResume });
    overlay.show();
    expect(overlay.visible).toBe(true);
    expect(overlay.objects.length).toBeGreaterThan(0);

    overlay.hideForTransition();
    expect(overlay.visible).toBe(false);
    expect(overlay.objects).toEqual([]);
  });
});
