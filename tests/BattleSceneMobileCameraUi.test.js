import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Scenes: {
      Events: {
        ADDED_TO_SCENE: 'added_to_scene',
        REMOVED_FROM_SCENE: 'removed_from_scene',
      },
    },
  },
}));

import Phaser from 'phaser';
import { BattleScene } from '../src/scenes/BattleScene.js';

function makeTextObject() {
  return {
    setOrigin() { return this; },
    setDepth() { return this; },
    setAlpha() { return this; },
    destroy: vi.fn(),
  };
}

function makeBannerScene() {
  const banner = makeTextObject();
  return {
    banner,
    scene: {
      cameras: { main: { centerX: 320, centerY: 240 } },
      add: {
        text: vi.fn(() => banner),
      },
      tweens: {
        add: vi.fn((config) => {
          config?.onComplete?.();
          return {};
        }),
      },
      time: {
        delayedCall: vi.fn((_ms, cb) => cb?.()),
      },
      _pinToScreen: vi.fn(),
      _isReducedEffects: vi.fn(() => false),
    },
  };
}

function makeUiCameraScene() {
  const scene = new BattleScene();
  const uiCamera = {
    id: 2,
    setRoundPixels: vi.fn().mockReturnThis(),
  };
  scene.mobileCameraEnabled = true;
  scene.cameras = {
    main: {
      id: 1,
      width: 640,
      height: 480,
      roundPixels: true,
      setZoom: vi.fn(),
      setScroll: vi.fn(),
    },
    add: vi.fn(() => uiCamera),
    remove: vi.fn(),
  };
  scene.events = {
    on: vi.fn(),
    off: vi.fn(),
  };
  scene._syncPinnedUiCameraFilters = vi.fn();
  return { scene, uiCamera };
}

describe('BattleScene mobile camera UI pinning', () => {
  it('does not auto-pin world-forced high-depth objects', () => {
    const scene = new BattleScene();

    const worldHint = { depth: 1000, _forceWorldCamera: true };
    const uiObject = { depth: 1000 };

    expect(BattleScene.prototype._isAutoPinCandidate.call(scene, worldHint)).toBe(false);
    expect(BattleScene.prototype._isAutoPinCandidate.call(scene, uiObject)).toBe(true);
  });

  it('pins reinforcement banner to screen camera', () => {
    const { scene, banner } = makeBannerScene();
    BattleScene.prototype.showReinforcementBanner.call(scene, 2);
    expect(scene._pinToScreen).toHaveBeenCalledWith(banner);
  });

  it('pins brief banner to screen camera', async () => {
    const { scene, banner } = makeBannerScene();
    await BattleScene.prototype.showBriefBanner.call(scene, 'Ready!', '#ffdd44');
    expect(scene._pinToScreen).toHaveBeenCalledWith(banner);
  });

  it('pins phase banner to screen camera', () => {
    const { scene, banner } = makeBannerScene();
    BattleScene.prototype.showPhaseBanner.call(scene, 'player', 2);
    expect(scene._pinToScreen).toHaveBeenCalledWith(banner);
  });
});

describe('BattleScene UI camera dirty tracking', () => {
  it('marks camera filters dirty on display-list add/remove events', () => {
    const { scene } = makeUiCameraScene();

    scene._cameraFilterDirty = false;
    BattleScene.prototype._setupUiCamera.call(scene);

    expect(scene.events.on).toHaveBeenCalledWith(
      Phaser.Scenes.Events.ADDED_TO_SCENE,
      scene._displayListDirtyHandler,
    );
    expect(scene.events.on).toHaveBeenCalledWith(
      Phaser.Scenes.Events.REMOVED_FROM_SCENE,
      scene._displayListDirtyHandler,
    );

    scene._cameraFilterDirty = false;
    scene._displayListDirtyHandler();
    expect(scene._cameraFilterDirty).toBe(true);
  });

  it('unregisters display-list listeners during battle camera teardown', () => {
    const { scene, uiCamera } = makeUiCameraScene();
    BattleScene.prototype._setupUiCamera.call(scene);
    const dirtyHandler = scene._displayListDirtyHandler;
    const battleCamera = { destroy: vi.fn() };

    scene._battleCamera = battleCamera;
    scene._setBattleCanvasTouchAction = vi.fn();
    scene.isMobileInput = true;
    scene.game = { events: { emit: vi.fn() } };

    BattleScene.prototype._teardownBattleCameraSystem.call(scene);

    expect(scene.events.off).toHaveBeenCalledWith(Phaser.Scenes.Events.ADDED_TO_SCENE, dirtyHandler);
    expect(scene.events.off).toHaveBeenCalledWith(Phaser.Scenes.Events.REMOVED_FROM_SCENE, dirtyHandler);
    expect(scene.cameras.remove).toHaveBeenCalledWith(uiCamera);
    expect(battleCamera.destroy).toHaveBeenCalledTimes(1);
    expect(scene._displayListDirtyHandler).toBeNull();
  });
});
