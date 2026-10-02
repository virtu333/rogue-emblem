import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { XP_BASE_HEAL } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

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
    _battleSession: 1,
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
    _reduceMotion: () => true,
    hideActionMenu() {},
    undimUnit() {},
    finishUnitAction() {},
    updateHPBar() {},
    gameData: { classes: [], skills: [] },
    npcUnits: [],
    showActionMenu() {},
    _recoverUnitActionError(unit, _label, _error, { session }) {
      this.finishUnitAction(unit, { skipCanto: true, session });
    },
  };
}

describe('Heal XP', () => {
  it.each([false, true])(
    'Overflowing Grace heals once through the production staff flow (AoE=%s)',
    async (aoe) => {
      const ctx = makeSceneCtx();
      ctx.gameData = loadGameData();
      ctx.turnManager = { turnNumber: 1, currentPhase: 'player' };
      ctx.animateHeal = vi.fn(async () => {});
      ctx.awardScaledXP = vi.fn(() => {});
      const staff = {
        type: 'Staff',
        rankRequired: 'Prof',
        range: '1-3',
        healAll: true,
        healBase: 5,
        _usesSpent: 0,
        uses: 3,
      };
      const healer = {
        name: 'Sera',
        faction: 'player',
        col: 1,
        row: 1,
        currentHP: 10,
        weapon: staff,
        inventory: [staff],
        proficiencies: [{ type: 'Staff', rank: 'Prof' }],
        traits: ['overflowing_grace'],
        stats: { HP: 20, MAG: 10 },
      };
      const targets = [1, 2].map((row) => ({ col: 2, row, currentHP: 5, stats: { HP: 30 } }));
      ctx.playerUnits = [healer, ...targets];
      if (aoe) await BattleScene.prototype.executeHealAll.call(ctx, healer, targets);
      else await BattleScene.prototype.executeHeal.call(ctx, healer, targets[0]);
      expect(healer.currentHP).toBe(13);
      expect(healer._legendaryGraceTurn).toBe(1);
      expect(staff._usesSpent).toBe(1);
      expect(ctx.animateHeal).toHaveBeenCalledWith(healer, 3);
    },
  );

  it('XP_BASE_HEAL constant equals 20', () => {
    expect(XP_BASE_HEAL).toBe(20);
  });

  it('executeHeal awards XP_BASE_HEAL to the healer', async () => {
    const ctx = makeSceneCtx();
    const awardScaledXP = vi.fn(() => {});
    const finishUnitAction = vi.fn();
    ctx.awardScaledXP = awardScaledXP;
    ctx.finishUnitAction = finishUnitAction;
    ctx.animateHeal = vi.fn(async () => {});

    const staff = {
      type: 'Staff',
      rankRequired: 'Prof',
      range: '1-3',
      healAll: true,
      healBase: 5,
      _usesSpent: 0,
      uses: 3,
    };
    const healer = {
      name: 'Healer',
      faction: 'player',
      currentHP: 20,
      col: 1,
      row: 1,
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      stats: { HP: 20, MAG: 10 },
    };
    const target = { col: 1, row: 2, currentHP: 15, stats: { HP: 30 } };

    ctx.playerUnits = [healer, target];
    await BattleScene.prototype.executeHeal.call(ctx, healer, target);

    expect(awardScaledXP).toHaveBeenCalledWith(healer, XP_BASE_HEAL, { present: false });
    expect(finishUnitAction).toHaveBeenCalledWith(healer, { session: ctx._battleSession });
  });

  it('executeHealAll awards a single XP_BASE_HEAL for AoE heal', async () => {
    const ctx = makeSceneCtx();
    const awardScaledXP = vi.fn(() => {});
    const finishUnitAction = vi.fn();
    ctx.awardScaledXP = awardScaledXP;
    ctx.finishUnitAction = finishUnitAction;
    ctx.animateHeal = vi.fn(async () => {});

    const staff = {
      type: 'Staff',
      rankRequired: 'Prof',
      range: '1-3',
      healAll: true,
      healBase: 5,
      _usesSpent: 0,
      uses: 3,
    };
    const healer = {
      name: 'Healer',
      faction: 'player',
      currentHP: 20,
      col: 1,
      row: 1,
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      stats: { HP: 20, MAG: 10 },
    };
    const targets = [
      { col: 1, row: 2, currentHP: 15, stats: { HP: 30 } },
      { col: 2, row: 2, currentHP: 10, stats: { HP: 25 } },
      { col: 3, row: 2, currentHP: 20, stats: { HP: 30 } },
    ];

    ctx.playerUnits = [healer, ...targets];
    await BattleScene.prototype.executeHealAll.call(ctx, healer, targets);

    expect(awardScaledXP).toHaveBeenCalledTimes(1);
    expect(awardScaledXP).toHaveBeenCalledWith(healer, XP_BASE_HEAL, { present: false });
    expect(finishUnitAction).toHaveBeenCalledWith(healer, { session: ctx._battleSession });
  });

  it('executeHeal still calls finishUnitAction if awardScaledXP rejects', async () => {
    const ctx = makeSceneCtx();
    ctx.awardScaledXP = vi.fn(() => {
      throw new Error('popup failed');
    });
    ctx.finishUnitAction = vi.fn();
    ctx.animateHeal = vi.fn(async () => {});

    const staff = {
      type: 'Staff',
      rankRequired: 'Prof',
      range: '1-3',
      healAll: true,
      healBase: 5,
      _usesSpent: 0,
      uses: 3,
    };
    const healer = {
      name: 'Healer',
      faction: 'player',
      currentHP: 20,
      col: 1,
      row: 1,
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      stats: { HP: 20, MAG: 10 },
    };
    const target = { col: 1, row: 2, currentHP: 15, stats: { HP: 30 } };

    ctx.playerUnits = [healer, target];
    await BattleScene.prototype.executeHeal.call(ctx, healer, target).catch(() => {});

    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer, {
      skipCanto: true,
      session: ctx._battleSession,
    });
  });

  it('executeHealAll still calls finishUnitAction if awardScaledXP rejects', async () => {
    const ctx = makeSceneCtx();
    ctx.awardScaledXP = vi.fn(() => {
      throw new Error('popup failed');
    });
    ctx.finishUnitAction = vi.fn();
    ctx.animateHeal = vi.fn(async () => {});

    const staff = {
      type: 'Staff',
      rankRequired: 'Prof',
      range: '1-3',
      healAll: true,
      healBase: 5,
      _usesSpent: 0,
      uses: 3,
    };
    const healer = {
      name: 'Healer',
      faction: 'player',
      currentHP: 20,
      col: 1,
      row: 1,
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      stats: { HP: 20, MAG: 10 },
    };
    const targets = [{ col: 1, row: 2, currentHP: 15, stats: { HP: 30 } }];

    ctx.playerUnits = [healer, ...targets];
    await BattleScene.prototype.executeHealAll.call(ctx, healer, targets).catch(() => {});

    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer, {
      skipCanto: true,
      session: ctx._battleSession,
    });
  });

  it('awardScaledXP applies difficulty multiplier to heal XP', async () => {
    const ctx = makeSceneCtx({ xpMultiplier: 0.5 });
    const unit = { tier: 'base', level: 1, xp: 0 };

    await BattleScene.prototype.awardScaledXP.call(ctx, unit, XP_BASE_HEAL);

    expect(unit.xp).toBe(10); // floor(20 * 0.5) = 10
  });
});

// Item use counts (engine/ItemUsage.js): a staff counts its casts inside the
// settlement, before the checkpoint, so a resume (which restores the checkpoint and
// never settles again) or a rewind cannot count a use twice or lose one.
describe('staff cast count', () => {
  function setup() {
    const ctx = makeSceneCtx();
    ctx.gameData = loadGameData();
    ctx.runManager = {};
    ctx.turnManager = { turnNumber: 1, currentPhase: 'player' };
    ctx.animateHeal = vi.fn(async () => {});
    ctx.awardScaledXP = vi.fn(() => {});
    const staff = {
      name: 'Physic',
      type: 'Staff',
      rankRequired: 'Prof',
      range: '1-3',
      healAll: true,
      healBase: 5,
      _usesSpent: 0,
      uses: 3,
    };
    const healer = {
      name: 'Sera',
      faction: 'player',
      currentHP: 20,
      col: 1,
      row: 1,
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      stats: { HP: 20, MAG: 10 },
    };
    const targets = [1, 2, 3].map((col) => ({ col, row: 2, currentHP: 5, stats: { HP: 30 } }));
    ctx.playerUnits = [healer, ...targets];
    const atCheckpoint = [];
    ctx._captureSuspendCheckpoint = vi.fn(() => {
      atCheckpoint.push(staff._casts);
      return true;
    });
    return { ctx, staff, healer, targets, atCheckpoint };
  }

  it('one heal is one cast, counted before the checkpoint', async () => {
    const { ctx, staff, healer, targets, atCheckpoint } = setup();
    await BattleScene.prototype.executeHeal.call(ctx, healer, targets[0]);
    expect(staff._usesSpent).toBe(1);
    expect(staff._casts).toBe(1);
    expect(atCheckpoint).toEqual([1]);
  });

  it('a heal-all spends one use and is one cast, however many it mends', async () => {
    const { ctx, staff, healer, targets } = setup();
    await BattleScene.prototype.executeHealAll.call(ctx, healer, targets);
    expect(staff._usesSpent).toBe(1);
    expect(staff._casts).toBe(1);
  });

  it('a refused action (a target out of reach) counts nothing', async () => {
    const { ctx, staff, healer } = setup();
    const far = { col: 9, row: 9, currentHP: 5, stats: { HP: 30 } };
    ctx.playerUnits.push(far);
    await BattleScene.prototype.executeHeal.call(ctx, healer, far);
    expect(staff._usesSpent).toBe(0);
    expect(staff._casts).toBeUndefined();
  });
});
