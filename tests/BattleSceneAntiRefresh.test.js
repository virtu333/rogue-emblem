// Anti-refresh suspend, BattleScene side: the mid-battle run save persists at
// player-stable points via the suspend checkpoint shim, the shim lazy-inits
// BattleSuspendController, and the checkpoint hooks fire at the right
// moments (action completion before the phase may flip, end turn, rewind).

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

const { saveRunMock } = vi.hoisted(() => ({
  saveRunMock: vi.fn(() => ({ ok: true })),
}));
vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return { ...actual, saveRun: saveRunMock };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';

function makeCtx(extra = {}) {
  const ctx = Object.create(BattleScene.prototype);
  ctx.registry = { get: vi.fn((key) => (key === 'activeSlot' ? 2 : null)) };
  ctx.runManager = { battleInProgress: null, roster: [] };
  return Object.assign(ctx, extra);
}

describe('BattleScene anti-refresh suspend', () => {
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

    it('no-ops without a runManager or an active slot', () => {
      BattleScene.prototype._persistBattleRunState.call(makeCtx({ runManager: null }));
      BattleScene.prototype._persistBattleRunState.call(makeCtx({ registry: { get: () => null } }));
      expect(saveRunMock).not.toHaveBeenCalled();
    });

    it('never throws when the save fails (suspend degrades, gameplay continues)', () => {
      const ctx = makeCtx();
      saveRunMock.mockImplementationOnce(() => {
        throw new Error('storage exploded');
      });
      expect(() => BattleScene.prototype._persistBattleRunState.call(ctx)).not.toThrow();
    });
  });

  describe('_captureSuspendCheckpoint shim', () => {
    it('lazy-inits BattleSuspendController once and forwards the result', () => {
      const spy = vi
        .spyOn(BattleSuspendController.prototype, 'captureCheckpoint')
        .mockReturnValue(true);
      const ctx = makeCtx();

      expect(BattleScene.prototype._captureSuspendCheckpoint.call(ctx)).toBe(true);
      const firstController = ctx._battleSuspendController;
      BattleScene.prototype._captureSuspendCheckpoint.call(ctx);

      expect(firstController).toBeInstanceOf(BattleSuspendController);
      expect(ctx._battleSuspendController).toBe(firstController);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });
  });

  describe('checkpoint hooks', () => {
    it('finishUnitAction checkpoints the completed action before the phase may flip', () => {
      const callOrder = [];
      const unit = { name: 'Galvin', skills: [], stats: { MOV: 5 }, faction: 'player' };
      const ctx = makeCtx({
        commitVisionSnapshotIfPending: vi.fn(),
        _clearCombatRollSession: vi.fn(),
        hideActionMenu: vi.fn(),
        grid: { clearAttackHighlights: vi.fn() },
        _clearSelectedWeaponArt: vi.fn(),
        dimUnit: vi.fn(),
        _captureSuspendCheckpoint: vi.fn(() => callOrder.push('checkpoint')),
        turnManager: { unitActed: vi.fn(() => callOrder.push('unitActed')) },
      });

      BattleScene.prototype.finishUnitAction.call(ctx, unit, { skipCanto: true });

      expect(unit.hasActed).toBe(true);
      expect(callOrder).toEqual(['checkpoint', 'unitActed']);
    });

    it('applyVisionSnapshot re-checkpoints the rewound state on success only', () => {
      const applySpy = vi.spyOn(VisionRewindController.prototype, '_applySnapshot');

      applySpy.mockReturnValue(true);
      const applied = makeCtx({ _captureSuspendCheckpoint: vi.fn() });
      expect(BattleScene.prototype.applyVisionSnapshot.call(applied)).toBe(true);
      expect(applied._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);

      applySpy.mockReturnValue(false);
      const notApplied = makeCtx({ _captureSuspendCheckpoint: vi.fn() });
      expect(BattleScene.prototype.applyVisionSnapshot.call(notApplied)).toBe(false);
      expect(notApplied._captureSuspendCheckpoint).not.toHaveBeenCalled();

      applySpy.mockRestore();
    });
  });

  describe('shutdown hygiene', () => {
    it('init clears any stale suspend controller and resume checkpoint fields', () => {
      const ctx = makeCtx();
      BattleScene.prototype.init.call(ctx, { gameData: { skills: [] } });
      expect(ctx._battleSuspendController).toBeNull();
      expect(ctx._resumeCheckpoint).toBeNull();
    });

    it('init carries an incoming resume checkpoint', () => {
      const ctx = makeCtx();
      const checkpoint = { checkpointIndex: 4 };
      BattleScene.prototype.init.call(ctx, {
        gameData: { skills: [] },
        resumeCheckpoint: checkpoint,
      });
      expect(ctx._resumeCheckpoint).toBe(checkpoint);
    });
  });
});
