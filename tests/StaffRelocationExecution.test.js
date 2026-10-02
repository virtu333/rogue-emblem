// Warp/Rescue staff execution flow — scene-stub tests (HealXP.test.js pattern).
// Covers executeRelocate resolution, the two-phase targeting handlers, and
// error recovery (finishUnitAction always runs — BattleSceneMovementRecovery
// pattern).
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { settleTeleporterWarp } from '../src/engine/AffixSystem.js';
import { XP_BASE_HEAL } from '../src/utils/constants.js';
import { UI_HEX } from '../src/utils/uiStyles.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function freshStaff(name) {
  return { ...structuredClone(gameData.weapons.find((w) => w.name === name)), _usesSpent: 0 };
}

function makeSceneCtx() {
  return {
    _battleSession: 1,
    battleParams: { xpMultiplier: 1 },
    battleState: '',
    registry: { get: () => ({ playSFX() {} }) },
    grid: {
      fogEnabled: false,
      cols: 12,
      rows: 12,
      getMoveCost: () => 1,
      clearAttackHighlights: vi.fn(),
      showAttackRange: vi.fn(),
      showHealRange: vi.fn(),
      showRelocateGuide: vi.fn(),
      gridToPixel: () => ({ x: 0, y: 0 }),
    },
    _awaitSceneTween: vi.fn(async () => {}),
    updateUnitPosition: vi.fn(),
    finishUnitAction: vi.fn(),
    awardScaledXP: vi.fn(() => {}),
    _recoverUnitActionError: vi.fn(),
    getUnitAt: () => null,
    hideActionMenu() {},
    gameData: { classes: [], skills: [] },
    playerUnits: [],
    npcUnits: [],
    showActionMenu: vi.fn(),
  };
}

function makeHealer(staff, overrides = {}) {
  return {
    name: 'Bishop',
    faction: 'player',
    col: 4,
    row: 4,
    weapon: staff,
    inventory: [staff],
    proficiencies: [{ type: 'Staff', rank: 'Mast' }],
    stats: { HP: 24, MAG: 5, MOV: 5 },
    currentHP: 24,
    hasActed: false,
    ...overrides,
  };
}

function makeAlly(overrides = {}) {
  return {
    name: 'Edric',
    col: 4,
    row: 7,
    moveType: 'Infantry',
    stats: { HP: 30, MAG: 0 },
    currentHP: 30,
    hasActed: false,
    ...overrides,
  };
}

describe('executeRelocate', () => {
  it('moves the ally, spends one use, awards XP once, finishes the CASTER action', async () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Rescue Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly();

    ctx.playerUnits = [healer, ally];
    if (staff.relocate === 'warp') ally.row = healer.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx, healer, ally, { col: 5, row: 4 });

    expect(ally.col).toBe(5);
    expect(ally.row).toBe(4);
    expect(ctx.updateUnitPosition).toHaveBeenCalledWith(ally);
    expect(staff._usesSpent).toBe(1);
    expect(ctx.awardScaledXP).toHaveBeenCalledTimes(1);
    expect(ctx.awardScaledXP).toHaveBeenCalledWith(healer, XP_BASE_HEAL, { present: false });
    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer, { session: ctx._battleSession });
    expect(ctx._recoverUnitActionError).not.toHaveBeenCalled();
  });

  it("does NOT touch the moved ally's acted state (un-acted ally can still act)", async () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Warp Staff');
    const healer = makeHealer(staff);
    const unacted = makeAlly({ hasActed: false });

    ctx.playerUnits = [healer, unacted];
    unacted.row = healer.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx, healer, unacted, { col: 8, row: 4 });
    expect(unacted.hasActed).toBe(false);
    expect(ctx.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer, { session: ctx._battleSession });

    const ctx2 = makeSceneCtx();
    const staff2 = freshStaff('Warp Staff');
    const healer2 = makeHealer(staff2);
    const acted = makeAlly({ hasActed: true });
    ctx2.playerUnits = [healer2, acted];
    acted.row = healer2.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx2, healer2, acted, { col: 8, row: 4 });
    expect(acted.hasActed).toBe(true);
    expect(ctx2.finishUnitAction).toHaveBeenCalledWith(healer2, { session: ctx2._battleSession });
  });

  it.each([
    ['Rescue Staff', true],
    ['Rescue Staff', false],
    ['Warp Staff', true],
    ['Warp Staff', false],
    ['Teleporter', true],
  ])('%s preserves visual opacity for acted=%s and the next turn', async (name, hasActed) => {
    const ctx = makeSceneCtx();
    const visual = () => ({
      alpha: 1,
      setAlpha(alpha) {
        this.alpha = alpha;
      },
      setTint(tint) {
        this.tint = tint;
      },
      clearTint() {
        this.tint = null;
      },
    });
    const ally = makeAlly({
      hasActed,
      graphic: visual(),
      label: visual(),
      factionIndicator: visual(),
      hpBar: { bg: visual(), fill: visual() },
    });
    if (hasActed) BattleScene.prototype.dimUnit.call(ctx, ally);
    const targets = [
      ally.graphic,
      ally.label,
      ally.factionIndicator,
      ally.hpBar.bg,
      ally.hpBar.fill,
    ];
    const before = targets.map((target) => target.alpha);
    ctx._awaitSceneTween = vi.fn(async ({ targets, alpha }) => {
      for (const target of targets)
        target.alpha = typeof alpha === 'function' ? alpha(target) : alpha;
    });

    if (name === 'Teleporter') {
      ctx.grid.cols = 10;
      ctx.grid.rows = 10;
      ctx.grid.getMoveCost = () => 1;
      const random = vi.fn(() => 0);
      const warp = settleTeleporterWarp({
        unit: ally,
        range: 2,
        attacker: { col: 4, row: 6 },
        grid: ctx.grid,
        getUnitAt: ctx.getUnitAt,
        random,
      });
      expect(warp).not.toBeNull();
      expect(random).toHaveBeenCalledTimes(1);
      expect({ col: ally.col, row: ally.row }).toEqual(warp.to);
      await BattleScene.prototype._presentWarp.call(ctx, ally, warp, {
        session: ctx._battleSession,
      });
      expect(ctx.updateUnitPosition).toHaveBeenCalledWith(ally);
    } else {
      await BattleScene.prototype.executeRelocate.call(ctx, makeHealer(freshStaff(name)), ally, {
        col: 5,
        row: 4,
      });
    }

    expect(ally.hasActed).toBe(hasActed);
    expect(targets.map((target) => target.alpha)).toEqual(before);
    // This is the visual reset the player-turn handler uses. The sprite and HP
    // bar must not retain an opacity that this reset does not change.
    ally.hasActed = false;
    BattleScene.prototype.undimUnit.call(ctx, ally);
    expect(targets.map((target) => target.alpha)).toEqual([1, 1, 1, 1, 1]);
    expect(ally.graphic.tint).toBeNull();
  });

  it('enters HEAL_RESOLVING and clears the relocation selection state', async () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Rescue Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly();
    ctx.staffRelocateTargets = [ally];
    ctx.staffRelocateAlly = ally;
    ctx.staffRelocateTiles = [{ col: 5, row: 4 }];
    let stateAtFade = null;
    ctx._awaitSceneTween = vi.fn(async () => {
      stateAtFade = ctx.battleState;
    });
    ally.graphic = {}; // so the fade path runs

    ctx.playerUnits = [healer, ally];
    if (staff.relocate === 'warp') ally.row = healer.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx, healer, ally, { col: 5, row: 4 });

    expect(stateAtFade).toBe('HEAL_RESOLVING');
    expect(ctx.grid.clearAttackHighlights).toHaveBeenCalled();
    expect(ctx.staffRelocateTargets).toEqual([]);
    expect(ctx.staffRelocateAlly).toBeNull();
    expect(ctx.staffRelocateTiles).toEqual([]);
  });

  it('auto-swaps to a combat weapon when the staff is depleted', async () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Warp Staff'); // 1 use at MAG < 8
    const sword = structuredClone(gameData.weapons.find((w) => w.name === 'Iron Sword'));
    const healer = makeHealer(staff, {
      inventory: [staff, sword],
      proficiencies: [
        { type: 'Staff', rank: 'Mast' },
        { type: 'Sword', rank: 'Prof' },
      ],
    });
    const ally = makeAlly();

    ctx.playerUnits = [healer, ally];
    if (staff.relocate === 'warp') ally.row = healer.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx, healer, ally, { col: 5, row: 4 });

    expect(staff._usesSpent).toBe(1);
    expect(healer.weapon).toBe(sword);
  });

  it('keeps the staff equipped while uses remain', async () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Rescue Staff'); // 2 uses at MAG < 8
    const sword = structuredClone(gameData.weapons.find((w) => w.name === 'Iron Sword'));
    const healer = makeHealer(staff, {
      inventory: [staff, sword],
      proficiencies: [
        { type: 'Staff', rank: 'Mast' },
        { type: 'Sword', rank: 'Prof' },
      ],
    });
    const ally = makeAlly();

    ctx.playerUnits = [healer, ally];
    if (staff.relocate === 'warp') ally.row = healer.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx, healer, ally, { col: 5, row: 4 });

    expect(staff._usesSpent).toBe(1);
    expect(healer.weapon).toBe(sword);
  });

  it('still calls finishUnitAction if awardScaledXP rejects, then routes to error recovery', async () => {
    const ctx = makeSceneCtx();
    ctx.awardScaledXP = vi.fn(() => {
      throw new Error('popup failed');
    });
    const staff = freshStaff('Rescue Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly();

    ctx.playerUnits = [healer, ally];
    await BattleScene.prototype.executeRelocate
      .call(ctx, healer, ally, { col: 5, row: 4 })
      .catch(() => {});

    expect(ctx.finishUnitAction).not.toHaveBeenCalled();
    expect(ctx._recoverUnitActionError).toHaveBeenCalledWith(
      healer,
      'staffRelocate',
      expect.any(Error),
      { session: ctx._battleSession },
    );
  });

  it('routes animation failures to _recoverUnitActionError (never strands the state machine)', async () => {
    const ctx = makeSceneCtx();
    ctx._awaitSceneTween = vi.fn(async () => {
      throw new Error('tween exploded');
    });
    const staff = freshStaff('Rescue Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly({ graphic: {} });

    ctx.playerUnits = [healer, ally];
    if (staff.relocate === 'warp') ally.row = healer.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx, healer, ally, { col: 5, row: 4 });

    expect(ctx._recoverUnitActionError).not.toHaveBeenCalled();
    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer, { session: ctx._battleSession });
    expect(staff._usesSpent).toBe(1);
  });

  it('leaves the fog to the action completion (finishUnitAction), never before it', async () => {
    const ctx = makeSceneCtx();
    ctx.grid.fogEnabled = true;
    ctx.grid.isVisible = () => true;
    ctx.grid.updateFogOfWar = vi.fn();
    ctx.updateEnemyVisibility = vi.fn();
    ctx.playerUnits = [];
    const staff = freshStaff('Warp Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly();

    let fogBeforeFinish = null;
    const finish = ctx.finishUnitAction;
    ctx.finishUnitAction = vi.fn((...args) => {
      fogBeforeFinish = ctx.grid.updateFogOfWar.mock.calls.length;
      return finish?.(...args);
    });

    ctx.playerUnits = [healer, ally];
    if (staff.relocate === 'warp') ally.row = healer.row + 1;
    await BattleScene.prototype.executeRelocate.call(ctx, healer, ally, { col: 8, row: 4 });

    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer, { session: ctx._battleSession });
    expect(fogBeforeFinish).toBe(0);
    expect(ctx.updateEnemyVisibility).not.toHaveBeenCalled();
  });
});

describe('two-phase targeting handlers', () => {
  it('startHealTargetSelection with a relocate staff enters SELECTING_STAFF_ALLY', () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Rescue Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly();
    ctx.registry = { get: () => null };

    BattleScene.prototype.startHealTargetSelection.call(ctx, healer, [ally], staff);

    expect(ctx.battleState).toBe('SELECTING_STAFF_ALLY');
    expect(ctx.staffRelocateTargets).toEqual([ally]);
    expect(ctx.grid.showHealRange).toHaveBeenCalledWith([{ col: ally.col, row: ally.row }]);
  });

  it('handleStaffAllyClick stores the ally, shows destinations, enters SELECTING_STAFF_TILE', () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Rescue Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly();
    ctx.selectedUnit = healer;
    ctx.staffRelocateTargets = [ally];
    ctx.grid.cols = 11;
    ctx.grid.rows = 11;
    ctx.grid.getMoveCost = () => 1;
    ctx.getUnitAt = (c, r) => [healer, ally].find((u) => u.col === c && u.row === r) || null;

    BattleScene.prototype.handleStaffAllyClick.call(ctx, { col: ally.col, row: ally.row });

    expect(ctx.battleState).toBe('SELECTING_STAFF_TILE');
    expect(ctx.staffRelocateAlly).toBe(ally);
    expect(ctx.staffRelocateTiles).toHaveLength(4); // all four caster-adjacent tiles free
    // The chosen ally shimmers and its landing squares show in gold.
    expect(ctx.grid.showRelocateGuide).toHaveBeenCalledWith(ally, ctx.staffRelocateTiles, {
      reduceMotion: false,
      fill: UI_HEX.accent,
      edge: UI_HEX.accentText,
    });
  });

  it('handleStaffAllyClick ignores clicks on non-target tiles', () => {
    const ctx = makeSceneCtx();
    ctx.battleState = 'SELECTING_STAFF_ALLY';
    ctx.staffRelocateTargets = [makeAlly()];
    ctx.selectedUnit = makeHealer(freshStaff('Rescue Staff'));

    BattleScene.prototype.handleStaffAllyClick.call(ctx, { col: 0, row: 0 });

    expect(ctx.battleState).toBe('SELECTING_STAFF_ALLY');
    expect(ctx.staffRelocateAlly).toBeUndefined();
  });

  it('handleStaffTileClick resolves the relocation for a highlighted tile only', () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Warp Staff');
    const healer = makeHealer(staff);
    const ally = makeAlly({ col: 4, row: 5 });
    ctx.selectedUnit = healer;
    ctx.staffRelocateAlly = ally;
    ctx.staffRelocateTiles = [{ col: 6, row: 4 }];
    ctx.executeRelocate = vi.fn();

    BattleScene.prototype.handleStaffTileClick.call(ctx, { col: 2, row: 2 });
    expect(ctx.executeRelocate).not.toHaveBeenCalled();

    BattleScene.prototype.handleStaffTileClick.call(ctx, { col: 6, row: 4 });
    expect(ctx.executeRelocate).toHaveBeenCalledWith(healer, ally, { col: 6, row: 4 });
  });

  it('findHealTargets routes relocate staves through findRelocateTargets (ally targeting)', () => {
    const ctx = makeSceneCtx();
    const staff = freshStaff('Rescue Staff');
    const healer = makeHealer(staff);
    const farAlly = makeAlly({ col: 4, row: 7, currentHP: 30 }); // full HP, dist 3
    const adjacentAlly = makeAlly({ name: 'Near', col: 4, row: 5, currentHP: 10 });
    ctx.playerUnits = [healer, farAlly, adjacentAlly];
    ctx.grid.cols = 11;
    ctx.grid.rows = 11;
    ctx.grid.getMoveCost = () => 1;
    ctx.getUnitAt = (c, r) => ctx.playerUnits.find((u) => u.col === c && u.row === r) || null;

    const targets = BattleScene.prototype.findHealTargets.call(ctx, healer, staff);

    // Full-HP far ally IS a rescue target; adjacent ally is not (no-op).
    expect(targets).toEqual([farAlly]);
  });
});

describe('cancel flow', () => {
  function makeCancelCtx() {
    const ctx = makeSceneCtx();
    ctx.registry = { get: () => ({ playSFX() {} }) };
    ctx.showActionMenu = vi.fn();
    ctx.refreshEndTurnControl = vi.fn();
    ctx.selectedUnit = makeHealer(freshStaff('Rescue Staff'));
    return ctx;
  }

  it('cancel from SELECTING_STAFF_TILE returns to SELECTING_STAFF_ALLY', () => {
    const ctx = makeCancelCtx();
    const ally = makeAlly();
    ctx.battleState = 'SELECTING_STAFF_TILE';
    ctx.staffRelocateTargets = [ally];
    ctx.staffRelocateAlly = ally;
    ctx.staffRelocateTiles = [{ col: 5, row: 4 }];

    BattleScene.prototype.handleCancel.call(ctx);

    expect(ctx.battleState).toBe('SELECTING_STAFF_ALLY');
    expect(ctx.staffRelocateAlly).toBeNull();
    expect(ctx.staffRelocateTiles).toEqual([]);
    expect(ctx.grid.showHealRange).toHaveBeenCalledWith([{ col: ally.col, row: ally.row }]);
    expect(ctx.showActionMenu).not.toHaveBeenCalled();
  });

  it('cancel from SELECTING_STAFF_ALLY returns to the action menu', () => {
    const ctx = makeCancelCtx();
    ctx.battleState = 'SELECTING_STAFF_ALLY';
    ctx.staffRelocateTargets = [makeAlly()];

    BattleScene.prototype.handleCancel.call(ctx);

    expect(ctx.staffRelocateTargets).toEqual([]);
    expect(ctx.showActionMenu).toHaveBeenCalledWith(ctx.selectedUnit);
  });

  it('both staff states are cancelable and count as player-input states', () => {
    const ctx = {};
    for (const state of ['SELECTING_STAFF_ALLY', 'SELECTING_STAFF_TILE']) {
      ctx.battleState = state;
      expect(BattleScene.prototype.isCancelableBattleState.call(ctx)).toBe(true);
    }
  });

  it('canForceEndTurn allows End Turn during both staff states', () => {
    for (const state of ['SELECTING_STAFF_ALLY', 'SELECTING_STAFF_TILE']) {
      const ctx = {
        _battleSession: 1,
        isStoryInputLocked: () => false,
        battleState: state,
        turnManager: { currentPhase: 'player' },
        pauseOverlay: null,
        unitDetailOverlay: null,
        lootSettingsOverlay: null,
      };
      expect(BattleScene.prototype.canForceEndTurn.call(ctx)).toBe(true);
    }
  });
});
