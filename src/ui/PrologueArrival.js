// PrologueArrival — a prologue service node's arrival (docs/specs/prologue-chapter.md §6
// "Route map, row 2"): the units that join there (joins.atNode: Tamsin) join the run,
// the run is saved, and each gets the standard recruit card with its authored line,
// before the service (Market or Chapel) opens. Pure flow, no rendering of its own
// beyond the card (GrowthCeremonyController.showRecruit) or, without a DOM host, a
// dialogue line.

import { isPrologueRun } from '../engine/ScriptedBattle.js';
import { saveServiceRun } from './serviceSave.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { hasDOMHost } from '../utils/domUI.js';
import { showMinorHint } from './HintDisplay.js';

/** The first spoken line of a dialogue.json `prologue` key, or null. */
export function prologueLine(gameData, key) {
  const entries = gameData?.dialogue?.prologue?.[key];
  const line = Array.isArray(entries) ? entries[0]?.line : null;
  return typeof line === 'string' && line ? line : null;
}

/**
 * Apply the node's arrivals (RunManager.arriveAtPrologueNode: once, idempotent), save,
 * then show each newcomer's card. Resolves with the arrival result (empty outside the
 * prologue run or when nobody joins).
 */
export async function arriveAtPrologueNode(scene, node) {
  const rm = scene?.runManager;
  if (!isPrologueRun(rm) || !node?.id) return { joined: [], granted: [] };
  const result = rm.arriveAtPrologueNode(node.id);
  if (!result.joined.length) return result;
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
  return result;
}
