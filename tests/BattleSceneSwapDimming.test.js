import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeUnit(overrides = {}) {
  return {
    col: 1,
    row: 1,
    hasActed: false,
    graphic: {},
    label: null,
    ...overrides,
  };
}

function makeScene() {
  const scene = new BattleScene();
  scene.hideActionMenu = vi.fn();
  scene.grid = {
    gridToPixel: vi.fn((col, row) => ({ x: col * 16, y: row * 16 })),
  };
  scene.tweens = {
    add: vi.fn((cfg) => {
      if (typeof cfg?.onComplete === 'function') cfg.onComplete();
      return {};
    }),
  };
  scene.updateUnitPosition = vi.fn();
  scene.dimUnit = vi.fn();
  scene.finishUnitAction = vi.fn((unit) => {
    unit.hasActed = true;
    scene.dimUnit(unit);
  });
  return scene;
}

describe('BattleScene executeSwap dim consistency', () => {
  it('keeps ally dimmed when ally already acted before swap', () => {
    const scene = makeScene();
    const actor = makeUnit({ col: 2, row: 2, hasActed: false });
    const ally = makeUnit({ col: 3, row: 2, hasActed: true });

    BattleScene.prototype.executeSwap.call(scene, actor, { ally });

    expect(actor.col).toBe(3);
    expect(actor.row).toBe(2);
    expect(ally.col).toBe(2);
    expect(ally.row).toBe(2);

    expect(actor.hasActed).toBe(true);
    expect(ally.hasActed).toBe(true);
    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(actor);

    expect(scene.dimUnit).toHaveBeenCalledWith(actor);
    expect(scene.dimUnit).toHaveBeenCalledWith(ally);
    expect(scene.hideActionMenu).toHaveBeenCalledTimes(1);
  });

  it('does not force dim ally when ally has not acted before swap', () => {
    const scene = makeScene();
    const actor = makeUnit({ col: 5, row: 1, hasActed: false });
    const ally = makeUnit({ col: 5, row: 2, hasActed: false });

    BattleScene.prototype.executeSwap.call(scene, actor, { ally });

    expect(actor.col).toBe(5);
    expect(actor.row).toBe(2);
    expect(ally.col).toBe(5);
    expect(ally.row).toBe(1);

    expect(actor.hasActed).toBe(true);
    expect(ally.hasActed).toBe(false);
    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(actor);

    expect(scene.dimUnit).toHaveBeenCalledWith(actor);
    expect(scene.dimUnit).not.toHaveBeenCalledWith(ally);
    expect(scene.hideActionMenu).toHaveBeenCalledTimes(1);
  });
});
