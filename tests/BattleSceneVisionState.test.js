import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/Grid.js', () => ({
  Grid: class {
    constructor() {
      this.fogEnabled = false;
      this.gridToPixel = (col, row) => ({ x: col * 16, y: row * 16 });
      this.updateFogOfWar = vi.fn();
      this.clearHighlights = vi.fn();
    }
  },
  computeEffectivePath: vi.fn(),
}));

vi.mock('../src/engine/TurnManager.js', () => ({
  TurnManager: vi.fn(function () {
    this.init = vi.fn();
    this.startBattle = vi.fn();
  }),
}));

vi.mock('../src/engine/AIController.js', () => ({
  AIController: vi.fn(function () {}),
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

describe('BattleScene initializeVisionState', () => {
  it('uses runManager.getBaseVisionCharges for non-finite fallback values', () => {
    const scene = new BattleScene();
    const getBaseVisionCharges = vi.fn(() => 6);

    scene.runManager = {
      rngSeed: Number.NaN,
      visionChargesRemaining: Number.NaN,
      visionCount: Number.NaN,
      getBaseVisionCharges,
    };
    scene.deriveBattleSeed = vi.fn(() => 1234);

    BattleScene.prototype.initializeVisionState.call(scene);

    expect(scene.runManager.rngSeed).toBe(1234);
    expect(scene.visionBaseSeed).toBe(1234);
    expect(getBaseVisionCharges).toHaveBeenCalledTimes(1);
    expect(scene.runManager.visionChargesRemaining).toBe(6);
    expect(scene.runManager.visionCount).toBe(0);
  });

  it('does not overwrite finite vision charges', () => {
    const scene = new BattleScene();
    const getBaseVisionCharges = vi.fn(() => 99);

    scene.runManager = {
      rngSeed: 77,
      visionChargesRemaining: 4,
      visionCount: 1,
      getBaseVisionCharges,
    };
    scene.deriveBattleSeed = vi.fn(() => 555);

    BattleScene.prototype.initializeVisionState.call(scene);

    expect(scene.runManager.rngSeed).toBe(77);
    expect(scene.visionBaseSeed).toBe(77);
    expect(getBaseVisionCharges).not.toHaveBeenCalled();
    expect(scene.runManager.visionChargesRemaining).toBe(4);
    expect(scene.runManager.visionCount).toBe(1);
  });
});
