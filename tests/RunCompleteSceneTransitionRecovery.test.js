import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  TRANSITION_REASONS: {
    RETURN_HOME: 'return_home',
    RETURN_TITLE: 'return_title',
  },
  transitionToScene: vi.fn(),
}));

const { RunCompleteScene } = await import('../src/scenes/RunCompleteScene.js');
const { transitionToScene, TRANSITION_REASONS } = await import('../src/utils/SceneRouter.js');

function makeScene() {
  const audio = {
    stopMusic: vi.fn(),
    playMusic: vi.fn(),
  };
  return {
    isTransitioning: false,
    gameData: { id: 'run-complete-test' },
    _resultMusicKey: 'defeat',
    registry: {
      get: vi.fn((key) => (key === 'audio' ? audio : null)),
    },
    __audio: audio,
  };
}

describe('RunCompleteScene transition recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets transition lock when transition start is rejected (false)', async () => {
    transitionToScene.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const scene = makeScene();

    const first = await RunCompleteScene.prototype._attemptSceneTransition.call(
      scene,
      'Title',
      TRANSITION_REASONS.RETURN_TITLE,
    );
    expect(first).toBe(false);
    expect(scene.isTransitioning).toBe(false);
    expect(scene.__audio.playMusic).toHaveBeenCalledTimes(1);

    const second = await RunCompleteScene.prototype._attemptSceneTransition.call(
      scene,
      'Title',
      TRANSITION_REASONS.RETURN_TITLE,
    );
    expect(second).toBe(true);
    expect(transitionToScene).toHaveBeenCalledTimes(2);
    expect(scene.__audio.stopMusic).toHaveBeenCalledTimes(2);
  });

  it('resets transition lock when transition throws', async () => {
    transitionToScene.mockRejectedValueOnce(new Error('boom'));
    const scene = makeScene();

    const ok = await RunCompleteScene.prototype._attemptSceneTransition.call(
      scene,
      'HomeBase',
      TRANSITION_REASONS.RETURN_HOME,
    );
    expect(ok).toBe(false);
    expect(scene.isTransitioning).toBe(false);
    expect(scene.__audio.stopMusic).toHaveBeenCalledTimes(1);
    expect(scene.__audio.playMusic).toHaveBeenCalledTimes(1);
  });

  it('keeps single-fire guard when already transitioning', async () => {
    const scene = makeScene();
    scene.isTransitioning = true;

    const ok = await RunCompleteScene.prototype._attemptSceneTransition.call(
      scene,
      'HomeBase',
      TRANSITION_REASONS.RETURN_HOME,
    );
    expect(ok).toBe(false);
    expect(transitionToScene).not.toHaveBeenCalled();
    expect(scene.__audio.stopMusic).not.toHaveBeenCalled();
  });
});
