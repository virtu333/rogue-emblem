import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { SettingsOverlay } from '../src/ui/SettingsOverlay.js';
import { HowToPlayOverlay } from '../src/ui/HowToPlayOverlay.js';
import { TitleScene } from '../src/scenes/TitleScene.js';

function makeDisplayObject(extra = {}) {
  return {
    handlers: {},
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setColor() { return this; },
    on(event, handler) { this.handlers[event] = handler; return this; },
    destroy: vi.fn(),
    ...extra,
  };
}

function makeOverlayScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: () => makeDisplayObject(),
      text: () => makeDisplayObject(),
      graphics: () => ({
        ...makeDisplayObject(),
        lineStyle() { return this; },
        beginPath() { return this; },
        moveTo() { return this; },
        lineTo() { return this; },
        strokePath() { return this; },
      }),
    },
    input: {
      keyboard: {
        addKey: () => ({ on: vi.fn(), off: vi.fn() }),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    game: {
      events: {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    registry: {
      get: vi.fn((key) => {
        if (key === 'settings') {
          return {
            getMusicVolume: () => 0.5,
            getSFXVolume: () => 0.5,
            getReducedEffects: () => false,
            setMusicVolume: vi.fn(),
            setSFXVolume: vi.fn(),
            setReducedEffects: vi.fn(),
          };
        }
        if (key === 'audio') {
          return {
            setMusicVolume: vi.fn(),
            setSFXVolume: vi.fn(),
            playSFX: vi.fn(),
          };
        }
        return null;
      }),
    },
  };
}

describe('overlay lifecycle guards', () => {
  it('SettingsOverlay show() does not fire onClose during initial hide()', () => {
    const onClose = vi.fn();
    const overlay = new SettingsOverlay(makeOverlayScene(), onClose);

    overlay.show();
    expect(overlay.visible).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    overlay.hide();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('HowToPlayOverlay show() does not fire onClose during initial hide()', () => {
    const onClose = vi.fn();
    const overlay = new HowToPlayOverlay(makeOverlayScene(), onClose);

    overlay.show();
    expect(overlay.visible).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    overlay.hide();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TitleScene shutdown overlay cleanup', () => {
  it('hides visible overlays and clears refs', () => {
    const scene = new TitleScene();
    const settings = { visible: true, hide: vi.fn() };
    const howToPlay = { visible: true, hide: vi.fn() };
    const help = { visible: false, hide: vi.fn() };
    const compendium = { visible: true, hide: vi.fn() };

    scene.settingsOverlay = settings;
    scene.howToPlayOverlay = howToPlay;
    scene.helpOverlay = help;
    scene.compendiumOverlay = compendium;

    scene._cleanupTitleOverlaysForShutdown();

    expect(settings.hide).toHaveBeenCalledTimes(1);
    expect(howToPlay.hide).toHaveBeenCalledTimes(1);
    expect(help.hide).not.toHaveBeenCalled();
    expect(compendium.hide).toHaveBeenCalledTimes(1);
    expect(scene.settingsOverlay).toBeNull();
    expect(scene.howToPlayOverlay).toBeNull();
    expect(scene.helpOverlay).toBeNull();
    expect(scene.compendiumOverlay).toBeNull();
  });
});
