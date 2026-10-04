// "Skip the rest of the prologue" from the route map (NodeMapScene._skipPrologueRest;
// docs/specs/prologue-chapter.md §9): the ending, then Home Base. A save that fails
// must not freeze the map: input comes back (isTransitioning cleared) and the retry
// offered is a real one (it runs the skip again), and a skip that started leaves the
// map locked while the scene leaves.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));

const { finishPrologue, offerSkipRetry } = vi.hoisted(() => ({
  finishPrologue: vi.fn(),
  offerSkipRetry: vi.fn(),
}));
vi.mock('../src/ui/PrologueEnding.js', () => ({ finishPrologue, offerSkipRetry }));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';

function scene() {
  const s = Object.create(NodeMapScene.prototype);
  s.isTransitioning = false;
  s._sceneShuttingDown = false;
  s.sys = { isActive: () => true };
  return s;
}

beforeEach(() => {
  finishPrologue.mockReset();
  offerSkipRetry.mockReset();
});

describe('route map: skip the rest of the prologue', () => {
  it('a failed save gives the map back and offers a retry that runs the skip again', async () => {
    const s = scene();
    let lockedDuringSkip = null;
    finishPrologue.mockImplementationOnce(async () => {
      lockedDuringSkip = s.isTransitioning;
      return false;
    });
    offerSkipRetry.mockImplementationOnce(async (_scene, retry) => {
      // While the retry offer is up, the map is usable again.
      expect(s.isTransitioning).toBe(false);
      finishPrologue.mockImplementationOnce(async () => true);
      return retry();
    });
    expect(await s._skipPrologueRest()).toBe(true);
    expect(lockedDuringSkip).toBe(true);
    expect(finishPrologue).toHaveBeenCalledTimes(2);
    // The write failure is the retry offer's to tell, not a second minor hint.
    expect(typeof finishPrologue.mock.calls[0][1]?.onCommitFailed).toBe('function');
    // The skip that started keeps the map locked while it leaves.
    expect(s.isTransitioning).toBe(true);
  });

  it('Keep playing leaves the map usable', async () => {
    const s = scene();
    finishPrologue.mockResolvedValue(false);
    offerSkipRetry.mockResolvedValue(false);
    expect(await s._skipPrologueRest()).toBe(false);
    expect(s.isTransitioning).toBe(false);
    expect(offerSkipRetry).toHaveBeenCalledTimes(1);
  });

  it('a scene already shutting down offers nothing', async () => {
    const s = scene();
    s._sceneShuttingDown = true;
    finishPrologue.mockResolvedValue(false);
    await s._skipPrologueRest();
    expect(offerSkipRetry).not.toHaveBeenCalled();
  });
});
