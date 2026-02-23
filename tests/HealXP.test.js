import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { XP_BASE_HEAL } from '../src/utils/constants.js';

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
  return {
    battleParams: { xpMultiplier },
    battleState: '',
    registry: { get: () => ({ playSFX() {} }) },
    grid: { clearAttackHighlights() {}, gridToPixel: () => ({ x: 0, y: 0 }) },
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
    _isReducedEffects: () => true,
    hideActionMenu() {},
    undimUnit() {},
    finishUnitAction() {},
    updateHPBar() {},
    gameData: { classes: [], skills: [] },
  };
}

describe('Heal XP', () => {
  it('XP_BASE_HEAL constant equals 20', () => {
    expect(XP_BASE_HEAL).toBe(20);
  });

  it('executeHeal awards XP_BASE_HEAL to the healer', async () => {
    const ctx = makeSceneCtx();
    const awardScaledXP = vi.fn(async () => {});
    const finishUnitAction = vi.fn();
    ctx.awardScaledXP = awardScaledXP;
    ctx.finishUnitAction = finishUnitAction;
    ctx.animateHeal = vi.fn(async () => {});

    const staff = { type: 'Staff', healBase: 5, _usesSpent: 0, uses: 3 };
    const healer = { col: 1, row: 1, weapon: staff, stats: { MAG: 10 } };
    const target = { col: 1, row: 2, currentHP: 15, stats: { HP: 30 } };

    await BattleScene.prototype.executeHeal.call(ctx, healer, target);

    expect(awardScaledXP).toHaveBeenCalledWith(healer, XP_BASE_HEAL);
    expect(finishUnitAction).toHaveBeenCalledWith(healer);
  });

  it('executeHealAll awards a single XP_BASE_HEAL for AoE heal', async () => {
    const ctx = makeSceneCtx();
    const awardScaledXP = vi.fn(async () => {});
    const finishUnitAction = vi.fn();
    ctx.awardScaledXP = awardScaledXP;
    ctx.finishUnitAction = finishUnitAction;
    ctx.animateHeal = vi.fn(async () => {});

    const staff = { type: 'Staff', healBase: 5, _usesSpent: 0, uses: 3 };
    const healer = { col: 1, row: 1, weapon: staff, stats: { MAG: 10 } };
    const targets = [
      { col: 1, row: 2, currentHP: 15, stats: { HP: 30 } },
      { col: 2, row: 2, currentHP: 10, stats: { HP: 25 } },
      { col: 3, row: 2, currentHP: 20, stats: { HP: 30 } },
    ];

    await BattleScene.prototype.executeHealAll.call(ctx, healer, targets);

    expect(awardScaledXP).toHaveBeenCalledTimes(1);
    expect(awardScaledXP).toHaveBeenCalledWith(healer, XP_BASE_HEAL);
    expect(finishUnitAction).toHaveBeenCalledWith(healer);
  });

  it('executeHeal still calls finishUnitAction if awardScaledXP rejects', async () => {
    const ctx = makeSceneCtx();
    ctx.awardScaledXP = vi.fn(async () => {
      throw new Error('popup failed');
    });
    ctx.finishUnitAction = vi.fn();
    ctx.animateHeal = vi.fn(async () => {});

    const staff = { type: 'Staff', healBase: 5, _usesSpent: 0, uses: 3 };
    const healer = { col: 1, row: 1, weapon: staff, stats: { MAG: 10 } };
    const target = { col: 1, row: 2, currentHP: 15, stats: { HP: 30 } };

    await BattleScene.prototype.executeHeal.call(ctx, healer, target).catch(() => {});

    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer);
  });

  it('executeHealAll still calls finishUnitAction if awardScaledXP rejects', async () => {
    const ctx = makeSceneCtx();
    ctx.awardScaledXP = vi.fn(async () => {
      throw new Error('popup failed');
    });
    ctx.finishUnitAction = vi.fn();
    ctx.animateHeal = vi.fn(async () => {});

    const staff = { type: 'Staff', healBase: 5, _usesSpent: 0, uses: 3 };
    const healer = { col: 1, row: 1, weapon: staff, stats: { MAG: 10 } };
    const targets = [{ col: 1, row: 2, currentHP: 15, stats: { HP: 30 } }];

    await BattleScene.prototype.executeHealAll.call(ctx, healer, targets).catch(() => {});

    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer);
  });

  it('awardScaledXP applies difficulty multiplier to heal XP', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 0.5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, XP_BASE_HEAL);

    expect(unit.xp).toBe(10); // floor(20 * 0.5) = 10
  });
});
