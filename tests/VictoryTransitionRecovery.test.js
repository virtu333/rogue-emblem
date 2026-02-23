import { describe, it, expect, vi } from 'vitest';
import { retryBooleanAction } from '../src/utils/retry.js';

// ---- Helpers ----

/** Minimal Phaser scene mock for showVictoryTransitionRecovery */
function mockBattleScene(overrides = {}) {
  const objects = [];
  const scene = {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    add: {
      rectangle: (_x, _y, _w, _h, _c, _a) => {
        const obj = {
          setDepth: function () {
            return this;
          },
          setInteractive: function () {
            return this;
          },
          setStrokeStyle: function () {
            return this;
          },
          destroy: vi.fn(),
          type: 'rectangle',
        };
        objects.push(obj);
        return obj;
      },
      text: (_x, _y, label, _style) => {
        const obj = {
          text: label,
          setOrigin: function () {
            return this;
          },
          setDepth: function () {
            return this;
          },
          setInteractive: function () {
            return this;
          },
          disableInteractive: function () {
            return this;
          },
          setColor: function () {
            return this;
          },
          setText: function (t) {
            this.text = t;
            return this;
          },
          on: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
          type: 'text',
        };
        objects.push(obj);
        return obj;
      },
    },
    scene: { isActive: () => true, start: vi.fn() },
    time: {
      delayedCall: (ms, cb) => cb(),
    },
    gameData: {},
    runManager: {},
    victoryRecoveryPrompt: null,
    _victoryBanner: null,
    registry: { get: () => null },
    _createdObjects: objects,
    ...overrides,
  };
  return scene;
}

// ---- Inline showVictoryTransitionRecovery logic (structural smoke tests) ----
// NOTE: These are structural smoke tests using an inline clone of the production method.
// Integration tests that exercise the real BattleScene.showVictoryTransitionRecovery()
// are in BattleSceneVictoryFlow.test.js.

function showVictoryRecoveryOn(scene) {
  if (scene.victoryRecoveryPrompt?.length) return;

  if (scene._victoryBanner) {
    scene._victoryBanner.destroy();
    scene._victoryBanner = null;
  }

  const cam = scene.cameras.main;
  const group = [];

  const blocker = scene.add
    .rectangle(cam.centerX, cam.centerY, cam.width, cam.height, 0x000000, 0.72)
    .setDepth(910)
    .setInteractive();
  group.push(blocker);

  const panel = scene.add
    .rectangle(cam.centerX, cam.centerY, 420, 170, 0x111122, 0.97)
    .setDepth(911)
    .setStrokeStyle(2, 0x777777)
    .setInteractive();
  group.push(panel);

  const title = scene.add
    .text(cam.centerX, cam.centerY - 42, 'Transition failed', {})
    .setOrigin(0.5)
    .setDepth(912);
  group.push(title);

  const msg = scene.add
    .text(
      cam.centerX,
      cam.centerY - 12,
      'Could not open Run Complete.\nRetry or return to title.',
      {},
    )
    .setOrigin(0.5)
    .setDepth(912);
  group.push(msg);

  const retryBtn = scene.add
    .text(cam.centerX - 84, cam.centerY + 44, '[ Retry ]', {})
    .setOrigin(0.5)
    .setDepth(912)
    .setInteractive();
  group.push(retryBtn);

  const titleBtn = scene.add
    .text(cam.centerX + 84, cam.centerY + 44, '[ Title ]', {})
    .setOrigin(0.5)
    .setDepth(912)
    .setInteractive();
  group.push(titleBtn);

  scene.victoryRecoveryPrompt = group;
}

// ---- Tests: transitionToRunCompleteWithRetry with victory reason ----

describe('transitionToRunCompleteWithRetry (victory path)', () => {
  it('returns true on first success', async () => {
    const action = vi.fn().mockResolvedValue(true);
    const result = await retryBooleanAction(action, {
      attempts: 4,
      initialDelayMs: 0,
    });
    expect(result).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on later attempt', async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = await retryBooleanAction(action, {
      attempts: 4,
      initialDelayMs: 1,
      delayMultiplier: 1,
    });
    expect(result).toBe(true);
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('returns false after exhausting all 4 attempts', async () => {
    const action = vi.fn().mockResolvedValue(false);
    const result = await retryBooleanAction(action, {
      attempts: 4,
      initialDelayMs: 1,
      delayMultiplier: 1,
    });
    expect(result).toBe(false);
    expect(action).toHaveBeenCalledTimes(4);
  });
});

// ---- Tests: showVictoryTransitionRecovery ----

describe('showVictoryTransitionRecovery', () => {
  it('creates recovery UI elements', () => {
    const scene = mockBattleScene();
    showVictoryRecoveryOn(scene);
    expect(scene.victoryRecoveryPrompt).not.toBeNull();
    expect(scene.victoryRecoveryPrompt.length).toBe(6); // blocker, panel, title, msg, retry, title btn
  });

  it('does not create duplicate UI when called twice', () => {
    const scene = mockBattleScene();
    showVictoryRecoveryOn(scene);
    const firstGroup = scene.victoryRecoveryPrompt;
    showVictoryRecoveryOn(scene);
    expect(scene.victoryRecoveryPrompt).toBe(firstGroup);
  });

  it('recovery UI contains Retry and Title buttons', () => {
    const scene = mockBattleScene();
    showVictoryRecoveryOn(scene);
    const textObjects = scene._createdObjects.filter((o) => o.type === 'text');
    const labels = textObjects.map((o) => o.text);
    expect(labels).toContain('[ Retry ]');
    expect(labels).toContain('[ Title ]');
  });

  it('destroys victory banner before showing recovery UI', () => {
    const banner = { destroy: vi.fn() };
    const scene = mockBattleScene({ _victoryBanner: banner });
    showVictoryRecoveryOn(scene);
    expect(banner.destroy).toHaveBeenCalledTimes(1);
    expect(scene._victoryBanner).toBeNull();
  });

  it('handles missing victory banner gracefully', () => {
    const scene = mockBattleScene({ _victoryBanner: null });
    showVictoryRecoveryOn(scene);
    expect(scene.victoryRecoveryPrompt.length).toBe(6);
  });
});
