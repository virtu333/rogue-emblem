// The resolved-action continuation: what a battle still owes after an action
// resolved but before its follow-ups ran (level-ups, Canto, Commander's
// Gambit). It is saved in suspend checkpoints and rewind snapshots, so its
// fields are untrusted. One definition of the shape serves both readers:
// the snapshot validator (a malformed one rejects the whole state) and the
// resume path (a malformed one is skipped). Pure, no Phaser.
import { isBattleEntityId } from './BattleEntityIdentity.js';

/** The only continuations that exist. */
export const ACTION_CONTINUATION_KINDS = Object.freeze(['combat', 'finish']);

/** Longest saved text field the battle snapshot accepts (BattleStateSnapshot). */
export const SAVED_TEXT_MAX = 8192;

/**
 * A normalized copy of a saved continuation, or null when it is malformed.
 * @param {unknown} value
 * @returns {{kind:'combat'|'finish', unitName:string, unitId?:string, skipCanto?:boolean, gambitTriggered?:boolean} | null}
 */
export function readActionContinuation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!ACTION_CONTINUATION_KINDS.includes(value.kind)) return null;
  if (value.unitId !== undefined && !isBattleEntityId(value.unitId)) return null;
  if (
    typeof value.unitName !== 'string' ||
    value.unitName.length > SAVED_TEXT_MAX ||
    !value.unitName.trim()
  )
    return null;
  if (value.skipCanto !== undefined && typeof value.skipCanto !== 'boolean') return null;
  if (value.gambitTriggered !== undefined && typeof value.gambitTriggered !== 'boolean')
    return null;
  return {
    kind: value.kind,
    unitName: value.unitName,
    ...(value.unitId ? { unitId: value.unitId } : {}),
    ...(value.skipCanto !== undefined ? { skipCanto: value.skipCanto } : {}),
    ...(value.gambitTriggered !== undefined ? { gambitTriggered: value.gambitTriggered } : {}),
  };
}
