// firstRunFastPath — First-run onboarding shortcut.
//
// A brand-new save has nothing to do in Home Base (Valor/Supply are 0),
// Difficulty Select (Normal is the only unlocked mode), or Blessing Select
// (skipped by onboarding decision). This helper lets both new-game entry
// points (SlotPickerScene, TitleScene) drop such a save straight onto the
// act-1 node map. Later runs keep the full flow.
//
// The run-start path mirrors BlessingSelectScene._confirm's blessing-skip
// commit exactly (startRun normal → chooseBlessing(null) → transition →
// on success incrementRunsStarted + clearSavedRun) so resume/story/economy
// behave identically to the normal flow — the only difference is the three
// skipped menu scenes.

import { RunManager, clearSavedRun } from '../engine/RunManager.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { transitionToScene, TRANSITION_REASONS } from './SceneRouter.js';

/**
 * A slot qualifies for the first-run fast path when it is brand new:
 * either no meta at all (getSlotSummary returns null) or a saved meta that
 * has never started or finished a run. Any active/corrupt run → not fresh.
 *
 * @param {{ hasActiveRun?: boolean, runCorrupt?: boolean, runsStarted?: number, runsCompleted?: number } | null} summary
 * @returns {boolean}
 */
export function isFirstRunSlot(summary) {
  if (!summary) return true; // empty slot (no meta yet)
  if (summary.hasActiveRun) return false;
  if (summary.runCorrupt) return false;
  return (summary.runsStarted || 0) === 0 && (summary.runsCompleted || 0) === 0;
}

/**
 * Begin a run immediately on Normal with no blessing, skipping HomeBase /
 * DifficultySelect / BlessingSelect. Replicates the blessing-skip commit path.
 *
 * Registry meta/hints/activeSlot must already be staged by the caller (both
 * entry points do this before calling). Post-transition bookkeeping mirrors
 * BlessingSelectScene:172-179. Null-safe on meta (dev routes may have none).
 *
 * @param {Phaser.Scene} scene - the calling scene (provides registry + transition context)
 * @param {{ gameData: object, slot: number }} opts
 * @returns {Promise<boolean>} the transition result (true on success)
 */
export async function startFirstRunFastPath(scene, { gameData, slot }) {
  const meta = scene.registry.get('meta');
  const metaEffects = meta
    ? meta.getActiveEffects({ weaponArtCatalog: gameData?.weaponArts?.arts || [] })
    : null;

  const runManager = new RunManager(gameData, metaEffects);
  runManager.startRun({ difficultyId: 'normal', applyBlessingsAtStart: false });
  runManager.chooseBlessing(null); // sets activeBlessings=[], _blessingChosen=true

  const transitioned = await transitionToScene(
    scene,
    'NodeMap',
    { gameData, runManager, firstRun: true },
    { reason: TRANSITION_REASONS.BEGIN_RUN },
  );

  if (transitioned) {
    // The run is committed: count the attempt (finished runs are counted
    // separately when the run settles). Clear any stale run save only after
    // transition success — same post-transition order as BlessingSelectScene.
    meta?.incrementRunsStarted?.();
    const cloud = scene.registry.get('cloud');
    clearSavedRun(cloud ? (resolvedSlot) => deleteRunSave(cloud.userId, resolvedSlot) : null, slot);
  }

  return transitioned;
}
