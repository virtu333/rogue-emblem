// PrologueEnding — how the prologue run ends (docs/specs/prologue-chapter.md §5 beats
// 7-8, §9): the ending's scenes and title card (data: `prologue.ending`, lines from
// dialogue.json `prologue.<scene.dialogue>`), the slot's record (meta.completePrologue:
// state 'complete', the Home Base grant paid once), the device's lesson record, the
// run save cleared, then Home Base. Reached from the last chapter's victory (battle
// or, after a reload, the route map) and from "Skip the rest of the prologue" (either
// scene).
//
// The scenes (presentation only, every piece optional): the music turns to
// `ending.music`; each scene may sound a ceremony cue (`cue`, in the key of the
// track), shake the camera (`shake`; never under Reduce motion), lay a veil over the
// field (`veil`: 'hollow_sun' darkens the sky around a hollow sun, 'thread' is the run
// end's THE THREAD IS CUT card, which then stays up to the title card) and play its
// lines. No new art or music: the cues, the card and the track are the run's own.
//
// Order: presentation first, then the one meta write, then the save is cleared. A
// refresh during the lines leaves the run save in place, so the route map reaches
// this ending again; a refresh after the meta write finds the grant paid and only
// clears the save. A meta write that fails keeps the run save (the ending retries
// from the route map) and says so.

import { hasDOMHost } from '../utils/domUI.js';
import { showImportantHint, showMinorHint } from './HintDisplay.js';
import { PROLOGUE_THREAD_CARD, prologueEndingCard } from '../data/prologueContent.js';
import { CeremonyController } from './CeremonyController.js';
import { playCue } from './ceremonyMusic.js';
import { prologueSpeakerPortrait } from './PrologueArrival.js';
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
  // The device's lesson record is optional onboarding state (it never throws).
  recordTaughtLessons(taught);
  let paid = false;
  if (meta?.completePrologue) {
    let result;
    try {
      result = meta.completePrologue({
        grant,
        chaptersCompleted: chaptersWon || prologueChaptersWon(rm),
        practised,
      });
    } catch {
      // A write that threw (not merely refused) paid nothing: completePrologue
      // rolls its memory back before a save, so the retry pays, never twice.
      result = { ok: false, paid: false };
    }
    if (!result?.ok) return { ok: false, reason: 'meta_write_failed' };
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

/**
 * The ending's scenes as data: `ending.scenes`, or a lone `ending.dialogue` key (the
 * Phase 2 shape) as one scene. Entries without lines, a cue, a veil or a shake drop.
 */
export function prologueEndingScenes(prologue) {
  const ending = prologue?.ending;
  if (!ending || typeof ending !== 'object') return [];
  const raw = Array.isArray(ending.scenes)
    ? ending.scenes
    : typeof ending.dialogue === 'string'
      ? [{ dialogue: ending.dialogue }]
      : [];
  return raw
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      dialogue: typeof s.dialogue === 'string' ? s.dialogue : null,
      cue: typeof s.cue === 'string' ? s.cue : null,
      shake: s.shake === true,
      veil: typeof s.veil === 'string' ? s.veil : null,
    }))
    .filter((s) => s.dialogue || s.cue || s.shake || s.veil);
}

/**
 * The lines of one ending scene that this army can speak. The ending also plays after a
 * skip, before the army met everyone: a speaker of the ending's cast (everyone who
 * speaks in any of its scenes) who is not in the army speaks as `unmet` when the line
 * allows it (Sera, a voice not yet met: '???') and is otherwise left out, and a line
 * that names a cast member not in the army is left out.
 * @param {Array<{speaker, line, unmet?}>} entries
 * @param {Iterable<string>} army - the names in the army
 * @param {Iterable<string>} cast - every named speaker of the ending
 */
export function endingLinesFor(entries, army, cast) {
  const inArmy = new Set(army);
  const named = [...new Set(cast)].filter((name) => name && name !== '???');
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.line !== 'string') continue;
    let speaker = entry.speaker || null;
    if (speaker && named.includes(speaker) && !inArmy.has(speaker)) {
      if (typeof entry.unmet !== 'string' || !entry.unmet) continue;
      speaker = entry.unmet;
    }
    const strangers = named.filter((name) => name !== entry.speaker && !inArmy.has(name));
    if (strangers.some((name) => new RegExp(`\\b${name}\\b`).test(entry.line))) continue;
    out.push({ speaker, line: entry.line });
  }
  return out;
}

/** Every named speaker of the ending's scenes (the cast endingLinesFor checks). */
function endingCast(scene, scenes) {
  const lines = scene.gameData?.dialogue?.prologue || {};
  return scenes.flatMap((s) => (Array.isArray(lines[s.dialogue]) ? lines[s.dialogue] : []).map((e) => e?.speaker)); // prettier-ignore
}

function reduceMotion(scene) {
  return Boolean(scene.registry?.get?.('settings')?.getReduceMotion?.());
}

/** One scene: cue, shake, veil, lines. Returns the veil it left up, if any. */
async function playEndingScene(scene, ending, ceremonies, cast) {
  const live = () => scene.sys?.isActive?.() !== false;
  if (ending.cue) void playCue(scene, ending.cue, { waitMs: 400, duck: 0.35 });
  if (ending.shake && !reduceMotion(scene)) {
    try {
      scene.cameras?.main?.shake?.(700, 0.006);
    } catch {
      /* presentation only */
    }
  }
  let veil = null;
  if (ending.veil && ceremonies) {
    try {
      veil =
        ending.veil === 'thread'
          ? ceremonies.showRunEnd({}, { withLines: true, content: PROLOGUE_THREAD_CARD })
          : ceremonies.showVeil(ending.veil);
    } catch {
      veil = null;
    }
  }
  const army = (scene.runManager?.roster || []).map((u) => u?.name);
  const entries = endingLinesFor(
    ending.dialogue ? scene.gameData?.dialogue?.prologue?.[ending.dialogue] : null,
    army,
    cast,
  );
  if (live() && entries.length && scene.dialogueOverlay?.showSequence) {
    scene._storyDialogueActive = true;
    try {
      await scene.dialogueOverlay.showSequence(
        entries.map((e) => ({
          speaker: e.speaker,
          line: e.line,
          portrait: prologueSpeakerPortrait(scene, e.speaker),
        })),
        { category: 'prologue', key: ending.dialogue },
      );
    } catch {
      /* a line is presentation: the ending goes on without it */
    } finally {
      scene._storyDialogueActive = false;
    }
  }
  return veil;
}

/** The ending's scenes, then its title card (presentation only, never a write). */
export async function presentPrologueEnding(scene) {
  const prologue = scene.gameData?.prologue;
  const live = () => scene.sys?.isActive?.() !== false;
  const music = prologue?.ending?.music;
  const audio = scene.registry?.get?.('audio');
  if (music && audio?.playMusic) {
    try {
      void audio.playMusic(music, scene, 1200);
    } catch {
      /* sound is decoration */
    }
  }
  const ceremonies =
    hasDOMHost() && CeremonyController.available() ? new CeremonyController(scene) : null;
  const veils = [];
  try {
    const scenes = prologueEndingScenes(prologue);
    const cast = endingCast(scene, scenes);
    for (const ending of scenes) {
      if (!live()) return;
      const veil = await playEndingScene(scene, ending, ceremonies, cast);
      if (veil) veils.push(veil);
    }
    if (!live()) return;
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
  } finally {
    // The veils stay up under the title card; Home Base follows at once.
    veils.length = 0;
    ceremonies?.destroy();
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
  // The grant is paid and the save cleared: a transition that fails here is retried
  // by the caller (the same commit pays nothing the second time) and never thrown.
  try {
    return (
      (await transitionToScene(
        scene,
        'HomeBase',
        { gameData: scene.gameData, prologueEnded: true },
        { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
      )) === true
    );
  } catch {
    return false;
  }
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
