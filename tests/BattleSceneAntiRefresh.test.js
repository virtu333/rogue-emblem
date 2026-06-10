// Anti-refresh casualty lock, BattleScene side: deaths are persisted into the
// run save the moment they happen, the casualty list is recomputed from live
// state (so Vision rewinds self-heal it), and Save & Exit scrubs the lock as
// the sanctioned full revert.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

const { saveRunMock, clearBattleInProgressInSaveMock } = vi.hoisted(() => ({
  saveRunMock: vi.fn(() => ({ ok: true })),
  clearBattleInProgressInSaveMock: vi.fn(() => ({ ok: true })),
}));
vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return {
    ...actual,
    saveRun: saveRunMock,
    clearBattleInProgressInSave: clearBattleInProgressInSaveMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';

function makeCtx(extra = {}) {
  const ctx = Object.create(BattleScene.prototype);
  ctx.registry = { get: vi.fn((key) => (key === 'activeSlot' ? 2 : null)) };
  ctx.runManager = { battleInProgress: null, roster: [] };
  return Object.assign(ctx, extra);
}

describe('BattleScene anti-refresh casualty lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveRunMock.mockReturnValue({ ok: true });
  });

  describe('_persistBattleRunState', () => {
    it('saves the run for the active slot', () => {
      const ctx = makeCtx();
      BattleScene.prototype._persistBattleRunState.call(ctx);
      expect(saveRunMock).toHaveBeenCalledWith(ctx.runManager, null, 2);
    });

    it('routes the cloud push callback when a cloud session exists', () => {
      const ctx = makeCtx();
      ctx.registry = {
        get: vi.fn((key) => {
          if (key === 'cloud') return { userId: 'user-1' };
          if (key === 'activeSlot') return 3;
          return null;
        }),
      };
      BattleScene.prototype._persistBattleRunState.call(ctx);
      expect(saveRunMock).toHaveBeenCalledWith(ctx.runManager, expect.any(Function), 3);
    });

    it('no-ops without a runManager', () => {
      const ctx = makeCtx({ runManager: null });
      BattleScene.prototype._persistBattleRunState.call(ctx);
      expect(saveRunMock).not.toHaveBeenCalled();
    });

    it('never throws when the save fails (lock degrades, gameplay continues)', () => {
      const ctx = makeCtx();
      saveRunMock.mockImplementationOnce(() => {
        throw new Error('storage exploded');
      });
      expect(() => BattleScene.prototype._persistBattleRunState.call(ctx)).not.toThrow();
    });
  });

  describe('_syncBattleCasualtiesToRun', () => {
    function makeSyncCtx({ casualties = [], phase = 'player' } = {}) {
      return makeCtx({
        runManager: {
          battleInProgress: { nodeId: 'n1', casualties },
          roster: [{ name: 'Edric' }, { name: 'Sera' }, { name: 'Galvin' }, { name: 'Mira' }],
          setBattleCasualties: vi.fn(),
        },
        playerUnits: [{ name: 'Edric' }],
        nonDeployedUnits: [{ name: 'Mira' }],
        turnManager: { currentPhase: phase },
        _persistBattleRunState: vi.fn(),
      });
    }

    it('records roster units that are neither alive nor benched, then persists', () => {
      const ctx = makeSyncCtx({ phase: 'enemy' });
      BattleScene.prototype._syncBattleCasualtiesToRun.call(ctx);
      expect(ctx.runManager.setBattleCasualties).toHaveBeenCalledWith([
        { name: 'Sera', phase: 'enemy' },
        { name: 'Galvin', phase: 'enemy' },
      ]);
      expect(ctx._persistBattleRunState).toHaveBeenCalledTimes(1);
    });

    it('preserves the phase recorded at death time for known casualties', () => {
      const ctx = makeSyncCtx({
        casualties: [{ name: 'Sera', phase: 'enemy' }],
        phase: 'player',
      });
      BattleScene.prototype._syncBattleCasualtiesToRun.call(ctx);
      expect(ctx.runManager.setBattleCasualties).toHaveBeenCalledWith([
        { name: 'Sera', phase: 'enemy' },
        { name: 'Galvin', phase: 'player' },
      ]);
    });

    it('drops units a Vision rewind brought back to life', () => {
      const ctx = makeSyncCtx({
        casualties: [
          { name: 'Sera', phase: 'enemy' },
          { name: 'Galvin', phase: 'enemy' },
        ],
      });
      ctx.playerUnits = [{ name: 'Edric' }, { name: 'Galvin' }];
      BattleScene.prototype._syncBattleCasualtiesToRun.call(ctx);
      expect(ctx.runManager.setBattleCasualties).toHaveBeenCalledWith([
        { name: 'Sera', phase: 'enemy' },
      ]);
    });

    it('no-ops when no battle is in progress (tutorial/standalone)', () => {
      const ctx = makeSyncCtx();
      ctx.runManager.battleInProgress = null;
      BattleScene.prototype._syncBattleCasualtiesToRun.call(ctx);
      expect(ctx.runManager.setBattleCasualties).not.toHaveBeenCalled();
      expect(ctx._persistBattleRunState).not.toHaveBeenCalled();
    });
  });

  describe('removeUnit death lock', () => {
    function makeRemovalCtx(unit) {
      return makeCtx({
        playerUnits: unit.faction === 'player' ? [unit] : [],
        enemyUnits: unit.faction === 'enemy' ? [unit] : [],
        npcUnits: [],
        gameData: { affixes: [] },
        battleConfig: { objective: 'rout' },
        removeUnitGraphic: vi.fn(),
        updateObjectiveText: vi.fn(),
        _syncBattleCasualtiesToRun: vi.fn(),
        _applyKillRewards: vi.fn(),
        grid: { clearTemporaryTerrainsBySource: vi.fn() },
      });
    }

    it('locks a player death into the save before any dialogue plays out', async () => {
      const unit = { name: 'Galvin', faction: 'player', col: 1, row: 1, isLord: false };
      const ctx = makeRemovalCtx(unit);
      await BattleScene.prototype.removeUnit.call(ctx, unit);
      expect(ctx.playerUnits).toHaveLength(0);
      expect(ctx._syncBattleCasualtiesToRun).toHaveBeenCalledTimes(1);
    });

    it('does not touch the lock for enemy deaths', async () => {
      const unit = { name: 'Bandit', faction: 'enemy', col: 1, row: 1 };
      const ctx = makeRemovalCtx(unit);
      await BattleScene.prototype.removeUnit.call(ctx, unit);
      expect(ctx.enemyUnits).toHaveLength(0);
      expect(ctx._syncBattleCasualtiesToRun).not.toHaveBeenCalled();
    });
  });

  describe('applyVisionSnapshot re-sync', () => {
    it('re-syncs the casualty lock after a successful rewind', () => {
      const applySpy = vi
        .spyOn(VisionRewindController.prototype, '_applySnapshot')
        .mockReturnValue(true);
      const ctx = makeCtx({ _syncBattleCasualtiesToRun: vi.fn() });
      const result = BattleScene.prototype.applyVisionSnapshot.call(ctx);
      expect(result).toBe(true);
      expect(ctx._syncBattleCasualtiesToRun).toHaveBeenCalledTimes(1);
      applySpy.mockRestore();
    });

    it('leaves the lock alone when the rewind did not apply', () => {
      const applySpy = vi
        .spyOn(VisionRewindController.prototype, '_applySnapshot')
        .mockReturnValue(false);
      const ctx = makeCtx({ _syncBattleCasualtiesToRun: vi.fn() });
      const result = BattleScene.prototype.applyVisionSnapshot.call(ctx);
      expect(result).toBe(false);
      expect(ctx._syncBattleCasualtiesToRun).not.toHaveBeenCalled();
      applySpy.mockRestore();
    });
  });
});
