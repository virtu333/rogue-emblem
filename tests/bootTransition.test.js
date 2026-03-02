import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transitionToSceneMock, resetTransitionLocksMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(),
  resetTransitionLocksMock: vi.fn(),
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: transitionToSceneMock,
}));

vi.mock('../src/utils/sceneLoader.js', () => ({
  resetTransitionLocks: resetTransitionLocksMock,
}));

import { bootTransition } from '../src/scenes/bootTransition.js';

function makeScene() {
  return {
    scene: {
      start: vi.fn(),
    },
  };
}

describe('bootTransition', () => {
  beforeEach(() => {
    transitionToSceneMock.mockReset();
    resetTransitionLocksMock.mockReset();
  });

  it('returns on first transition success', async () => {
    const scene = makeScene();
    transitionToSceneMock.mockResolvedValueOnce(true);

    await bootTransition(scene, 'Title', { gameData: { ok: 1 } }, 'boot');

    expect(transitionToSceneMock).toHaveBeenCalledTimes(1);
    expect(resetTransitionLocksMock).not.toHaveBeenCalled();
    expect(scene.scene.start).not.toHaveBeenCalled();
  });

  it('resets locks and retries when first transition fails', async () => {
    const scene = makeScene();
    transitionToSceneMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await bootTransition(scene, 'Title', { gameData: { ok: 1 } }, 'boot');

    expect(transitionToSceneMock).toHaveBeenCalledTimes(2);
    expect(resetTransitionLocksMock).toHaveBeenCalledTimes(1);
    expect(resetTransitionLocksMock).toHaveBeenCalledWith(scene);
    expect(scene.scene.start).not.toHaveBeenCalled();
  });

  it('falls back to direct scene.start when retry also fails', async () => {
    const scene = makeScene();
    transitionToSceneMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await bootTransition(scene, 'Title', { gameData: { ok: 1 } }, 'boot');

    expect(transitionToSceneMock).toHaveBeenCalledTimes(2);
    expect(resetTransitionLocksMock).toHaveBeenCalledTimes(1);
    expect(scene.scene.start).toHaveBeenCalledTimes(1);
    expect(scene.scene.start).toHaveBeenCalledWith('Title', { gameData: { ok: 1 } });
  });

  it('swallows direct scene.start errors and logs them', async () => {
    const scene = makeScene();
    const startError = new Error('start exploded');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    transitionToSceneMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    scene.scene.start.mockImplementation(() => {
      throw startError;
    });

    await expect(
      bootTransition(scene, 'Title', { gameData: { ok: 1 } }, 'boot'),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      '[BootScene] Direct scene.start fallback failed:',
      startError,
    );

    errorSpy.mockRestore();
  });
});
