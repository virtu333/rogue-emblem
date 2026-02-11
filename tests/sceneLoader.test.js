import { beforeEach, describe, it, expect, vi } from 'vitest';
import { __resetSceneLoaderForTests, startSceneLazy } from '../src/utils/sceneLoader.js';

function makeScene({ active = true } = {}) {
  return {
    sys: {
      isActive: () => active,
    },
    scene: {
      get: vi.fn(() => ({})),
      start: vi.fn(),
    },
  };
}

describe('sceneLoader.startSceneLazy', () => {
  beforeEach(() => {
    __resetSceneLoaderForTests();
  });

  it('starts scene when source scene is active', async () => {
    const scene = makeScene({ active: true });
    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(true);
    expect(scene.scene.start).toHaveBeenCalledWith('Title', { foo: 1 });
  });

  it('does not start scene when source scene is inactive', async () => {
    const scene = makeScene({ active: false });
    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(false);
    expect(scene.scene.start).not.toHaveBeenCalled();
  });

  it('drops duplicate requests while a transition is already in flight', async () => {
    const scene = makeScene({ active: true });
    scene.__startSceneLazyInFlight = true;

    const result = await startSceneLazy(scene, 'Title', { foo: 1 });

    expect(result).toBe(false);
    expect(scene.scene.start).not.toHaveBeenCalled();
  });
});
