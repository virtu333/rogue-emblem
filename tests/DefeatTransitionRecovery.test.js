import { describe, it, expect, vi } from 'vitest';
import { retryBooleanAction } from '../src/utils/retry.js';

// ---- Helpers ----

/** Minimal Phaser scene mock for showDefeatTransitionRecovery */
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
    defeatRecoveryPrompt: null,
    registry: { get: () => null },
    _createdObjects: objects,
    ...overrides,
  };
  return scene;
}

// ---- Tests: transitionToRunCompleteWithRetry ----
// The method delegates to retryBooleanAction + transitionToScene.
// We test the retry orchestration directly since the method is a thin wrapper.

describe('transitionToRunCompleteWithRetry (via retryBooleanAction)', () => {
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

  it('passes attempt number to action', async () => {
    const attempts = [];
    const action = vi.fn((attempt) => {
      attempts.push(attempt);
      return Promise.resolve(attempt >= 3);
    });
    await retryBooleanAction(action, {
      attempts: 4,
      initialDelayMs: 1,
      delayMultiplier: 1,
    });
    expect(attempts).toEqual([1, 2, 3]);
  });
});

// ---- Tests: showDefeatTransitionRecovery ----

describe('showDefeatTransitionRecovery', () => {
  // Inline the method logic since BattleScene can't be imported without Phaser.
  // This tests the same branching and UI creation logic.
  function showDefeatRecoveryOn(scene) {
    if (scene.defeatRecoveryPrompt?.length) return;
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

    scene.defeatRecoveryPrompt = group;
  }

  it('creates recovery UI elements', () => {
    const scene = mockBattleScene();
    showDefeatRecoveryOn(scene);
    expect(scene.defeatRecoveryPrompt).not.toBeNull();
    expect(scene.defeatRecoveryPrompt.length).toBe(6); // blocker, panel, title, msg, retry, title btn
  });

  it('does not create duplicate UI when called twice', () => {
    const scene = mockBattleScene();
    showDefeatRecoveryOn(scene);
    const firstGroup = scene.defeatRecoveryPrompt;
    showDefeatRecoveryOn(scene);
    expect(scene.defeatRecoveryPrompt).toBe(firstGroup); // same reference, not replaced
  });

  it('recovery UI contains Retry and Title buttons', () => {
    const scene = mockBattleScene();
    showDefeatRecoveryOn(scene);
    const textObjects = scene._createdObjects.filter((o) => o.type === 'text');
    const labels = textObjects.map((o) => o.text);
    expect(labels).toContain('[ Retry ]');
    expect(labels).toContain('[ Title ]');
  });
});
