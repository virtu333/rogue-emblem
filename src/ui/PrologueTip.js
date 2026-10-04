// PrologueTip — a prologue chapter's non-blocking note (a beat's `tip` action,
// docs/specs/prologue-chapter.md §2 "Core and reinforcement").
//
// The chapter's core lessons are modal field notes at their decision points; the rest
// is reinforcement, shown as the in-run Guidance note is (GuidanceNote: docked in a
// corner of the battlefield away from the units, click-through, no backdrop). It never
// holds input or the simulation. It is read when the player taps "Got it" (or an extra
// action such as "Open Rewind") or after it stayed visible long enough to read; only
// then does the controller mark the HintManager ids it stands in for, so a tip closed
// unread leaves its lesson to Act 1's point-of-use note.
//
// Presentation only: no game state, no RNG.

import { canInspectUnit } from '../engine/BattleInformation.js';
import { hasDOMHost } from '../utils/domUI.js';
import { showGuidanceNote } from './GuidanceNote.js';

/** One line: a tip reads as a paragraph (a note's line breaks are for the modal). */
export function tipText(text) {
  return String(text || '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/**
 * Show a tip. Returns the GuidanceNote handle ({ close(read), isRead(), onClose }) or
 * null without a DOM host or text.
 * @param {object} scene - BattleScene (its GuidanceController places the note)
 * @param {{ id: string, text: string, unit?: object|null, actions?: Array<{label: string, onClick: Function}>, onRead?: Function }} opts
 */
export function showPrologueTip(scene, { id, text, unit = null, actions = [], onRead } = {}) {
  const line = tipText(text);
  if (!hasDOMHost() || !line) return null;
  const guidance = scene?._guidance || null;
  const point = (u) => guidance?.screenPoint?.(u) || null;
  return showGuidanceNote(scene, {
    id: `prologue:${id}`,
    text: line,
    kicker: 'Tip',
    actions,
    anchor: unit ? point(unit) : null,
    bounds: guidance?.battlefieldRect ? () => guidance.battlefieldRect() : null,
    avoid: () => [
      ...[...(scene?.playerUnits || []), ...(scene?.enemyUnits || [])]
        .filter((u) => u?.currentHP > 0 && (!scene.grid || canInspectUnit(scene.grid, u)))
        .map(point),
      ...(guidance?.hudPoints?.() || []),
    ],
    reduceMotion: Boolean(scene?._reduceMotion?.()),
    onRead,
  });
}
