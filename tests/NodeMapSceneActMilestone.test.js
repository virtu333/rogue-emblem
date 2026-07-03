// NodeMapScene records a reached-act milestone on entry so the Compendium Foes
// tab can gate each act's boss. Covers the currentAct → milestone mapping, the
// hasMilestone idempotency guard, and null-safety on dev routes with no meta.

import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';

function makeMeta({ has = false } = {}) {
  return {
    recordMilestone: vi.fn(),
    hasMilestone: vi.fn(() => has),
  };
}

function makeScene({ meta, currentAct }) {
  const scene = new NodeMapScene();
  scene.registry = { get: (k) => (k === 'meta' ? meta : null) };
  scene.runManager = { currentAct };
  return scene;
}

const call = (scene) => NodeMapScene.prototype._recordActReachedMilestone.call(scene);

describe('NodeMapScene._recordActReachedMilestone', () => {
  it.each([
    ['act1', 'reachedAct1'],
    ['act2', 'reachedAct2'],
    ['act3', 'reachedAct3'],
    ['act4', 'reachedAct4'],
    ['finalBoss', 'reachedFinalBoss'],
  ])('records %s → %s when not already recorded', (currentAct, milestone) => {
    const meta = makeMeta({ has: false });
    call(makeScene({ meta, currentAct }));
    expect(meta.recordMilestone).toHaveBeenCalledTimes(1);
    expect(meta.recordMilestone).toHaveBeenCalledWith(milestone);
  });

  it('is idempotent: skips recordMilestone when the milestone already exists', () => {
    const meta = makeMeta({ has: true });
    call(makeScene({ meta, currentAct: 'act2' }));
    expect(meta.hasMilestone).toHaveBeenCalledWith('reachedAct2');
    expect(meta.recordMilestone).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown act id', () => {
    const meta = makeMeta({ has: false });
    call(makeScene({ meta, currentAct: 'postAct' }));
    expect(meta.recordMilestone).not.toHaveBeenCalled();
  });

  it('is null-safe when no meta singleton exists (dev/standalone route)', () => {
    expect(() => call(makeScene({ meta: null, currentAct: 'act1' }))).not.toThrow();
  });
});
