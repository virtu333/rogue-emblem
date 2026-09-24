// A resume that throws partway must not leave mid-battle run state behind:
// non-fatal checkpoints get the sanctioned entry revert (same as Continue
// from Map); a fatal-pending checkpoint is parked as unrestorable so the slot
// screen settles the recorded defeat instead of granting a free map restart.

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

function makeScene(checkpointOverrides = {}) {
  const rm = new RunManager(loadGameData());
  rm.startRun({ runSeed: 7, applyBlessingsAtStart: false });
  rm.gold = 400;
  rm.visionChargesRemaining = 2;
  rm.beginBattleInProgress('node_3');
  // applyUnits already loaded the checkpoint's mid-battle run state.
  rm.gold = 950;
  rm.visionChargesRemaining = 0;
  rm.setBattleCheckpoint({ version: 2, checkpointIndex: 4, ...checkpointOverrides });
  const scene = Object.create(BattleScene.prototype);
  scene.runManager = rm;
  scene._persistBattleRunState = vi.fn(() => ({ ok: true }));
  return { scene, rm };
}

describe('BattleScene._abandonUnrestorableResume', () => {
  it('reverts a non-fatal checkpoint to battle entry before persisting', () => {
    const { scene, rm } = makeScene();

    expect(scene._abandonUnrestorableResume()).toBe('reverted');

    expect(rm.battleInProgress).toBeNull();
    expect(rm.gold).toBe(400);
    expect(rm.visionChargesRemaining).toBe(2);
    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
    expect(scene._fatalResumeParked).not.toBe(true);
  });

  it('parks a fatal checkpoint as unrestorable instead of reverting it', () => {
    const { scene, rm } = makeScene({ recoveryKind: 'fatal_pending' });

    expect(scene._abandonUnrestorableResume()).toBe('fatal');

    expect(rm.battleInProgress).toBeTruthy();
    expect(rm.battleInProgress.checkpoint.restoreFailed).toBe(true);
    expect(scene._fatalResumeParked).toBe(true);
    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
    const reloaded = RunManager.fromJSON(rm.toJSON(), loadGameData());
    expect(reloaded._battleRecoveryRestoreFailed).toBe(true);
    expect(reloaded.battleInProgress.checkpoint.recoveryKind).toBe('fatal_pending');
  });

  it('is a no-op once the flag is gone', () => {
    const { scene, rm } = makeScene();
    rm.clearBattleInProgress();
    expect(scene._abandonUnrestorableResume()).toBe('none');
    expect(scene._persistBattleRunState).not.toHaveBeenCalled();
  });
});
