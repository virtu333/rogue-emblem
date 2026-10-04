// PrologueEnding — how the prologue run ends (docs/specs/prologue-chapter.md §5 beats
// 7-8, §9): its lines and title card (data: `prologue.ending`, dialogue.json
// `prologue.<ending.dialogue>`), the slot's record (meta.completePrologue: state
// 'complete', the Home Base grant paid once), the device's lesson record, the run
// save cleared, then Home Base. Reached from the last chapter's victory (battle or,
// after a reload, the route map) and from "Skip the rest of the prologue" (either
// scene). Phase 3 replaces the lines and the card with the ritual scene by changing
// the data, not this module.
//
// Order: presentation first, then the one meta write, then the save is cleared. A
// refresh during the lines leaves the run save in place, so the route map reaches
// this ending again; a refresh after the meta write finds the grant paid and only
// clears the save. A meta write that fails keeps the run save (the ending retries
// from the route map) and says so.

import { hasDOMHost } from '../utils/domUI.js';
import { showImportantHint, showMinorHint } from './HintDisplay.js';
import { prologueEndingCard } from '../data/prologueContent.js';
import { recordTaughtLessons } from './prologueLessons.js';
import { clearSavedRun } from '../engine/RunManager.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { isPrologueRun } from '../engine/ScriptedBattle.js';

/** The chapters the run won, by chapter id (from its node map). */
export function prologueChaptersWon(runManager) {
  const nodes = Array.isArray(runManager?.nodeMap?.nodes) ? runManager.nodeMap.nodes : [];
  return nodes
    .filter((n) => n?.completed && typeof n.battleParams?.prologueChapter === 'string')
    .map((n) => n.battleParams.prologueChapter);
}

/**
 * Commit the prologue's end on the slot: meta state and grant (once), the device's
 * lesson record, and the run save cleared. Pure of presentation; returns what
 * happened. `taught` / `practised`: the live chapter's ledgers, if any.
 */
export function commitPrologueEnd(
  scene,
  {
    taught = [],
    practised = [],
    chaptersWon = null,
    slot = scene.registry?.get?.('activeSlot'),
  } = {},
) {
  const rm = scene.runManager;
  const meta = scene.registry?.get?.('meta');
  const prologue = scene.gameData?.prologue;
  const grant = prologue?.grant || { valor: 0, supply: 0 };
  recordTaughtLessons(taught);
  let paid = false;
  if (meta?.completePrologue) {
    const result = meta.completePrologue({
      grant,
      chaptersCompleted: chaptersWon || prologueChaptersWon(rm),
      practised,
    });
    if (!result.ok) return { ok: false, reason: 'meta_write_failed' };
    paid = result.paid;
  }
  if (Number.isInteger(slot)) {
    const cloud = scene.registry?.get?.('cloud');
    clearSavedRun(
      cloud
        ? (resolvedSlot, abandonedRun) => deleteRunSave(cloud.userId, resolvedSlot, abandonedRun)
        : null,
      slot,
    );
  }
  return { ok: true, paid, grant };
}

/**
 * Play the ending (lines, then the title card), commit it, and go to Home Base.
 * Resolves true once the transition started. Both the battle scene and the route
 * map call it; whichever is current.
 * @param {Phaser.Scene} scene - BattleScene or NodeMapScene of a prologue run
 * @param {{ taught?: Iterable<string>, practised?: Iterable<string> }} [ledgers]
 */
export async function finishPrologue(
  scene,
  { taught = [], practised = [], onCommitFailed = null } = {},
) {
  const rm = scene.runManager;
  if (!isPrologueRun(rm)) return false;
  // The ending plays once per scene: a retry (a failed meta write, a transition that
  // didn't start) only commits and leaves again.
  if (!scene._prologueEndingPresented) {
    await presentPrologueEnding(scene);
    if (scene.sys?.isActive?.() === false) return false;
    scene._prologueEndingPresented = true;
  }
  return commitAndLeavePrologue(scene, { taught, practised, onCommitFailed });
}

/** The ending's lines, then its title card (presentation only, never a write). */
export async function presentPrologueEnding(scene) {
  const prologue = scene.gameData?.prologue;
  const key = prologue?.ending?.dialogue;
  const entries = key ? scene.gameData?.dialogue?.prologue?.[key] : null;
  if (Array.isArray(entries) && entries.length && scene.dialogueOverlay?.showSequence) {
    try {
      await scene.dialogueOverlay.showSequence(
        entries.map((e) => ({ speaker: e?.speaker || null, line: e?.line || '', portrait: null })),
        { category: 'prologue', key },
      );
    } catch {
      /* a line is presentation: the ending goes on without it */
    }
  }
  if (scene.sys?.isActive?.() === false) return;
  const card = prologueEndingCard(prologue);
  if (card && hasDOMHost()) {
    try {
      await showImportantHint(scene, card, {
        actions: [{ label: 'Continue', value: true, primary: true }],
      });
    } catch {
      /* presentation only */
    }
  }
}

/** The commit (meta, lessons, save cleared) and the move to Home Base. Resolves true once it started. */
export async function commitAndLeavePrologue(
  scene,
  { taught = [], practised = [], onCommitFailed = null } = {},
) {
  if (!isPrologueRun(scene.runManager) || scene.sys?.isActive?.() === false) return false;
  const committed = commitPrologueEnd(scene, { taught: [...taught], practised: [...practised] });
  if (!committed.ok) {
    if (typeof onCommitFailed === 'function') onCommitFailed(committed);
    else
      void showMinorHint(scene, 'Save failed — storage may be unavailable. The ending will retry.');
    return false;
  }
  const audio = scene.registry?.get?.('audio');
  if (audio) audio.stopMusic(scene, 0);
  return transitionToScene(
    scene,
    'HomeBase',
    { gameData: scene.gameData, prologueEnded: true },
    { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
  );
}

/** The copy a failed skip shows, with its real retry (PrologueController, NodeMapScene). */
export const PROLOGUE_SKIP_FAILED =
  'The prologue could not be saved as finished: device storage may be full or unavailable. Retry, or keep playing and skip again later.';

/**
 * A skip whose save failed: offer Retry (runs `retry`) or Keep playing. Resolves with
 * what the retry resolved, or false.
 */
export async function offerSkipRetry(scene, retry) {
  if (scene.sys?.isActive?.() === false) return false;
  if (!hasDOMHost()) {
    void showMinorHint(scene, PROLOGUE_SKIP_FAILED);
    return false;
  }
  let choice;
  try {
    choice = await showImportantHint(scene, PROLOGUE_SKIP_FAILED, {
      actions: [
        { label: 'Retry', value: 'retry', primary: true },
        { label: 'Keep playing', value: false },
      ],
    });
  } catch {
    return false;
  }
  if (choice === 'retry' && typeof retry === 'function') return retry();
  return false;
}
