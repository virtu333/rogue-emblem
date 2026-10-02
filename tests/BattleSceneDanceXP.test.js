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
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    destroy() {},
  };
}

function makeSceneCtx({ xpMultiplier = 1 } = {}) {
  return Object.assign(new BattleScene(), {
    _battleSession: 1,
    battleParams: { xpMultiplier },
    registry: { get: () => ({ playSFX() {} }) },
    grid: { gridToPixel: () => ({ x: 0, y: 0 }), clearAttackHighlights() {} },
    add: {
      circle: () => ({
        setDepth() {
          return this;
        },
        destroy() {},
      }),
      text: () => makeTextStub(),
    },
    time: { delayedCall: (_ms, cb) => cb() },
    tweens: {
      add: ({ onComplete }) => {
        if (onComplete) onComplete();
      },
    },
    _reduceMotion: () => true,
    commitVisionSnapshotIfPending: () => false,
    hideActionMenu() {},
    undimUnit() {},
    finishUnitAction() {},
    updateHPBar() {},
    _presentScaledXP() {},
    gameData: { classes: [], skills: [] },
  });
}

describe('BattleScene Dance XP', () => {
  it('executeDance awards base dance XP through shared XP path', async () => {
    const ctx = makeSceneCtx();
    const awardScaledXP = vi.fn(() => 20);
    const finishUnitAction = vi.fn();
    ctx.awardScaledXP = awardScaledXP;
    ctx.finishUnitAction = finishUnitAction;

    const dancer = {
      name: 'Dancer',
      col: 1,
      row: 1,
      currentHP: 20,
      stats: { HP: 20 },
      skills: ['dance'],
    };
    const ally = { col: 1, row: 2, currentHP: 20, hasMoved: true, hasActed: true };

    ctx.playerUnits = [dancer, ally];
    await BattleScene.prototype.executeDance.call(ctx, dancer, { ally });

    expect(ally.hasMoved).toBe(false);
    expect(ally.hasActed).toBe(false);
    expect(awardScaledXP).toHaveBeenCalledWith(dancer, XP_BASE_DANCE, { present: false });
    expect(finishUnitAction).toHaveBeenCalledWith(dancer, { session: ctx._battleSession });
  });

  it('executeDance still consumes the action once if domain XP throws', async () => {
    const ctx = makeSceneCtx();
    ctx.awardScaledXP = vi.fn(() => {
      throw new Error('growth failed');
    });
    ctx.finishUnitAction = vi.fn();

    const dancer = {
      name: 'Dancer',
      col: 1,
      row: 1,
      currentHP: 20,
      stats: { HP: 20 },
      skills: ['dance'],
    };
    const ally = { col: 1, row: 2, currentHP: 20, hasMoved: true, hasActed: true };

    ctx.playerUnits = [dancer, ally];
    await BattleScene.prototype.executeDance.call(ctx, dancer, { ally }).catch(() => {});

    expect(ctx.finishUnitAction).toHaveBeenCalledWith(dancer, {
      skipCanto: true,
      session: ctx._battleSession,
    });
    expect(ctx.finishUnitAction).toHaveBeenCalledTimes(1);
  });

  it('awardScaledXP applies difficulty multiplier and floors XP', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 0.5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 20);

    expect(unit.xp).toBe(10);
  });
});
