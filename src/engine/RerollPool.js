// Branching Threads' rerolls (a Home Base upgrade): ONE pool a run spends on battle-reward
// rerolls (engine/PendingBattleRewards.js) and level-up rerolls (engine/LevelUpReroll.js).
// The save keeps the old names: the run's granted count is `metaEffects.rewardRerolls`
// (snapshotted at run start) and the spent count `run.rewardRerollsSpent` (older saves read
// 0). Pure.
import { isPrologueRun } from './ScriptedBattle.js';

/**
 * Rerolls this run was granted (the Home Base upgrade, snapshotted into the run's meta
 * effects at its start). The prologue run applies no meta effects and has none.
 */
export function rerollsGranted(run) {
  if (!run || isPrologueRun(run)) return 0;
  return Math.max(0, Math.trunc(Number(run.metaEffects?.rewardRerolls) || 0));
}

/** Rerolls spent this run, on either use (saved as `run.rewardRerollsSpent`). */
export function rerollsSpent(run) {
  return Math.max(0, Math.trunc(Number(run?.rewardRerollsSpent) || 0));
}

/** Rerolls left this run. */
export function rerollsLeft(run) {
  return Math.max(0, rerollsGranted(run) - rerollsSpent(run));
}
