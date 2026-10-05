// The prologue run's opening (NodeMapScene._launchPrologueOpening): a fresh prologue
// run enters P1 at once without drawing the route map. When that entry fails (the
// transition is refused, or throws), the scene must fall back to the route map's own
// entry (drawn, made ready, P1's node there to try again), never leave a blank scene
// with input on until a refresh.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));

const { transitionToScene } = vi.hoisted(() => ({ transitionToScene: vi.fn() }));
vi.mock('../src/utils/SceneRouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transitionToScene,
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';

const P1_NODE = {
  id: 'prologue_0',
  type: 'battle',
  battleParams: { prologueChapter: 'p1_banner_at_dawn' },
};

function scene() {
  const s = Object.create(NodeMapScene.prototype);
  s._sceneLifecycleGeneration = 1;
  s._sceneShuttingDown = false;
  s.isTransitioning = false;
  s.isSceneReady = false;
  s.battleLaunchInFlight = false;
  s.input = { enabled: true };
  s.gameData = {};
  s.registry = { get: () => null };
  s.scene = { isActive: () => true };
  s.runManager = {
    mode: 'prologue',
    currentNodeId: null,
    pendingBattleReward: null,
    battleInProgress: false,
    currentAct: 'act1',
    isActComplete: () => false,
    getAvailableNodes: () => [P1_NODE],
    getBattleParams: (node) => node.battleParams,
    getRoster: () => [],
  };
  s.drawMap = vi.fn();
  s.finalizeSceneReady = vi.fn(() => Promise.resolve());
  s.showTransientMessage = vi.fn();
  s._preparationNoteUnit = () => null;
  return s;
}

/** Let the launch's promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  transitionToScene.mockReset();
});

describe('route map: the prologue opening', () => {
  it('enters P1 without drawing the map', async () => {
    const s = scene();
    transitionToScene.mockResolvedValue(true);
    expect(s._launchPrologueOpening(1)).toBe(true);
    await settle();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    expect(transitionToScene.mock.calls[0][1]).toBe('Battle');
    expect(transitionToScene.mock.calls[0][2]).toMatchObject({ nodeId: 'prologue_0' });
    expect(s.drawMap).not.toHaveBeenCalled();
    expect(s.finalizeSceneReady).not.toHaveBeenCalled();
  });

  it('a refused entry falls back to the drawn route map', async () => {
    const s = scene();
    transitionToScene.mockResolvedValue(false);
    expect(s._launchPrologueOpening(1)).toBe(true);
    await settle();
    expect(s.drawMap).toHaveBeenCalledTimes(1);
    expect(s.finalizeSceneReady).toHaveBeenCalledWith(1);
    // Input waits for finalizeSceneReady, as on any entry; the launch is over.
    expect(s.input.enabled).toBe(false);
    expect(s.isSceneReady).toBe(false);
    expect(s.battleLaunchInFlight).toBe(false);
    expect(s.isTransitioning).toBe(false);
    expect(s.showTransientMessage).toHaveBeenCalledWith(
      'Failed to enter battle. Please try again.',
      expect.anything(),
    );
  });

  it('an entry that throws falls back to the drawn route map', async () => {
    const s = scene();
    transitionToScene.mockRejectedValue(new Error('Battle scene failed to load'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    s._launchPrologueOpening(1);
    await settle();
    error.mockRestore();
    expect(s.drawMap).toHaveBeenCalledTimes(1);
    expect(s.finalizeSceneReady).toHaveBeenCalledWith(1);
    expect(s.battleLaunchInFlight).toBe(false);
    // The message is shown again over the drawn map (drawing clears the scene).
    expect(s.showTransientMessage).toHaveBeenLastCalledWith(
      'Failed to enter battle. Please try again.',
      expect.anything(),
    );
  });

  it('a scene that left meanwhile draws nothing', async () => {
    const s = scene();
    transitionToScene.mockImplementation(async () => {
      s._sceneShuttingDown = true;
      return false;
    });
    s._launchPrologueOpening(1);
    await settle();
    expect(s.drawMap).not.toHaveBeenCalled();
  });
});
