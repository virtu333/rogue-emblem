// PrologueArrival — a prologue service node's arrival (docs/specs/prologue-chapter.md §6
// "Route map, row 2" and "row 4"): the units that join there (joins.atNode: Tamsin) join
// the run, the node's arrival lines are marked spoken (route node `lines`: the
// watchtower's vision), the run is saved, and then each newcomer gets the standard
// recruit card with its authored line and the lines play, before the service (Market,
// Chapel or the Ruins) opens. Lines play once per run: a reload at the node goes straight
// to the service. Pure flow, no rendering of its own beyond the card
// (GrowthCeremonyController.showRecruit) or, without a DOM host, a dialogue line.

import { isPrologueRun } from '../engine/ScriptedBattle.js';
import { saveServiceRun } from './serviceSave.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { hasDOMHost } from '../utils/domUI.js';
import { showMinorHint } from './HintDisplay.js';
import { unitPortraitKey } from './RebuiltPortraits.js';

/** The first spoken line of a dialogue.json `prologue` key, or null. */
export function prologueLine(gameData, key) {
  const entries = gameData?.dialogue?.prologue?.[key];
  const line = Array.isArray(entries) ? entries[0]?.line : null;
  return typeof line === 'string' && line ? line : null;
}

/** The run's dialogue key that records a node's arrival lines as spoken. */
export function arrivalLinesKey(nodeId) {
  return `prologue_lines:${nodeId}`;
}

/** A spoken line's face: a lord's portrait, else none (route-map lines). */
/**
 * A prologue line's face: the speaker in the army (Gaspar's own, a lord's) through the
 * one portrait resolver, else a lord's by name, else none.
 */
export function prologueSpeakerPortrait(scene, speaker) {
  if (!speaker) return null;
  const units = [...(scene?.runManager?.roster || []), ...(scene?.playerUnits || [])];
  const unit = units.find((u) => u?.name === speaker);
  const lord = (scene?.gameData?.lords || []).find((l) => l?.name === speaker);
  const lordKey = lord ? `portrait_lord_${String(lord.name).toLowerCase()}` : null;
  if (!unit) return lordKey;
  try {
    return unitPortraitKey(scene, unit, scene.gameData || {}) || lordKey;
  } catch {
    return lordKey;
  }
}

/**
 * Apply the node's arrivals (RunManager.arriveAtPrologueNode: once, idempotent) and
 * mark its arrival lines spoken, save, then show each newcomer's card and play the
 * lines. Resolves with the arrival result plus `lines` (the key played, or null).
 */
export async function arriveAtPrologueNode(scene, node) {
  const rm = scene?.runManager;
  if (!isPrologueRun(rm) || !node?.id) return { joined: [], granted: [], lines: null };
  const result = { ...rm.arriveAtPrologueNode(node.id), lines: null };
  const linesKey = typeof node.prologueLines === 'string' ? node.prologueLines : null;
  const entries = linesKey ? scene.gameData?.dialogue?.prologue?.[linesKey] : null;
  if (
    Array.isArray(entries) &&
    entries.length &&
    !rm.hasShownDialogue?.(arrivalLinesKey(node.id))
  ) {
    // Marked before it plays (as story lines are): a reload mid-line never replays it.
    rm.markDialogueShown?.(arrivalLinesKey(node.id));
    result.lines = linesKey;
  }
  if (!result.joined.length && !result.lines) return result;
  const warning = saveServiceRun(scene);
  if (warning) void showMinorHint(scene, warning.trim());
  for (const { name, line } of result.joined) {
    const unit = rm.roster.find((u) => u?.name === name);
    const text = prologueLine(scene.gameData, line);
    if (!unit) continue;
    let carded = false;
    try {
      const growth = hasDOMHost() ? growthCeremonies(scene) : null;
      if (growth) carded = await growth.showRecruit({ unit, kind: 'recruit', line: text, frame: 'screen' }); // prettier-ignore
    } catch {
      carded = false;
    }
    if (!carded && text && scene.dialogueOverlay) {
      try {
        await scene.dialogueOverlay.show(name, text, null);
      } catch {
        /* a line is presentation: the arrival stands without it */
      }
    }
  }
  if (result.lines && scene.dialogueOverlay?.showSequence) {
    scene._storyDialogueActive = true;
    try {
      await scene.dialogueOverlay.showSequence(
        entries.map((e) => ({
          speaker: e?.speaker || null,
          line: e?.line || '',
          portrait: prologueSpeakerPortrait(scene, e?.speaker),
        })),
        { category: 'prologue', key: result.lines },
      );
    } catch {
      /* a line is presentation: the arrival stands without it */
    } finally {
      scene._storyDialogueActive = false;
    }
  }
  return result;
}
