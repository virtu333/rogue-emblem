import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { XP_BASE_DANCE } from '../src/utils/constants.js';

function makeTextStub() {
  return {
    setOrigin() { return this; },
    setDepth() { return this; },
    destroy() {},
  };
}

function makeSceneCtx({ xpMultiplier = 1 } = {}) {
  return {
    battleParams: { xpMultiplier },
    registry: { get: () => ({ playSFX() {} }) },
    grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
    add: {
      circle: () => ({ setDepth() { return this; }, destroy() {} }),
      text: () => makeTextStub(),
    },
    time: { delayedCall: (_ms, cb) => cb() },
    tweens: { add: ({ onComplete }) => { if (onComplete) onComplete(); } },
    _isReducedEffects: () => true,
    hideActionMenu() {},
    undimUnit() {},
    finishUnitAction() {},
    updateHPBar() {},
    gameData: { classes: [], skills: [] },
  };
}

describe('BattleScene Dance XP', () => {
  it('executeDance awards base dance XP through shared XP path', async () => {
    const ctx = makeSceneCtx();
    const awardScaledXP = vi.fn(async () => {});
    const finishUnitAction = vi.fn();
    ctx.awardScaledXP = awardScaledXP;
    ctx.finishUnitAction = finishUnitAction;

    const dancer = { col: 1, row: 1 };
    const ally = { col: 1, row: 2, hasMoved: true, hasActed: true };

    await BattleScene.prototype.executeDance.call(ctx, dancer, { ally });

    expect(ally.hasMoved).toBe(false);
    expect(ally.hasActed).toBe(false);
    expect(awardScaledXP).toHaveBeenCalledWith(dancer, XP_BASE_DANCE);
    expect(finishUnitAction).toHaveBeenCalledWith(dancer);
  });

  it('awardScaledXP applies difficulty multiplier and floors XP', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 0.5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 20);

    expect(unit.xp).toBe(10);
  });
});

