import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const turnBonusConfig = gameData.turnBonus;

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

function makeSceneCtx({ xpMultiplier = 1, turnNumber = 0, par = null } = {}) {
  return {
    battleParams: { xpMultiplier },
    turnPar: par,
    turnBonusConfig: par != null ? turnBonusConfig : undefined,
    getCurrentTurnNumber: () => turnNumber,
    registry: { get: () => ({ playSFX() {} }) },
    grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
    add: {
      text: () => makeTextStub(),
    },
    time: { delayedCall: (_ms, cb) => cb() },
    tweens: {
      add: ({ onComplete }) => {
        if (onComplete) onComplete();
      },
    },
    _isReducedEffects: () => true,
    updateHPBar() {},
    gameData: { classes: [], skills: [] },
  };
}

describe('awardScaledXP integration with par XP multiplier', () => {
  it('applies S-rank multiplier (×1.25) when under par', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 1, turnNumber: 2, par: 5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 40);

    // S-rank: parXpMult=1.25, xp = floor(40 * 1.25 * 1) = 50
    expect(unit.xp).toBe(50);
  });

  it('applies A-rank multiplier (×1.10) when slightly over par', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 1, turnNumber: 7, par: 5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 40);

    // A-rank: parXpMult=1.10, xp = floor(40 * 1.10) = 44
    expect(unit.xp).toBe(44);
  });

  it('applies B-rank multiplier (×1.00) when moderately over par', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 1, turnNumber: 10, par: 5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 40);

    // B-rank: parXpMult=1.00, xp = floor(40 * 1.00) = 40
    expect(unit.xp).toBe(40);
  });

  it('applies C-rank multiplier (×0.90) when far over par', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 1, turnNumber: 15, par: 5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 40);

    // C-rank: parXpMult=0.90, xp = floor(40 * 0.90) = 36
    expect(unit.xp).toBe(36);
  });

  it('returns parXpMult=1 when turnBonusConfig is missing', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 1, turnNumber: 15 });
    ctx.turnBonusConfig = undefined;
    ctx.turnPar = undefined;
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 40);

    // No par config → parXpMult=1, xp = floor(40 * 1) = 40
    expect(unit.xp).toBe(40);
  });

  it('returns parXpMult=1 (neutral) when getCurrentTurnNumber is not a function', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 1 });
    delete ctx.getCurrentTurnNumber;
    ctx.turnPar = 5;
    ctx.turnBonusConfig = turnBonusConfig;
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 40);

    // No getCurrentTurnNumber → parXpMult=1 (neutral), xp = floor(40 * 1) = 40
    expect(unit.xp).toBe(40);
  });

  it('stacks par multiplier with difficulty xpMultiplier', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 0.5, turnNumber: 15, par: 5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 40);

    // C-rank: parXpMult=0.90, diffMult=0.5
    // xp = floor(40 * 0.90 * 0.5) = floor(18) = 18
    expect(unit.xp).toBe(18);
  });

  it('floors to minimum 1 XP', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 0.01, turnNumber: 15, par: 5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, 1);

    expect(unit.xp).toBe(1);
  });
});
