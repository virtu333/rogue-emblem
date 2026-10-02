// HoldDisturbance.js — the moment a holder is disturbed (docs/specs/dusk-pressure.md §2b).
// Pure, no imports, so the hooks that change a unit (UnitHealth, StatusConditionSystem,
// forced movement) can call it without import cycles.
//
// A holder is disturbed when it takes damage, takes a status or is moved. The mark is
// written when that happens, never inferred later from HP or conditions: by the time the
// enemy phase checks, a fort, Renewal or Regenerator may have healed the wound, and
// status recovery may have cleared the hex. HoldActivation.wakeHolders reads the mark.

export const HOLD_AI_MODE = 'hold';

/** Mark a holder disturbed ('hurt' | 'status' | 'moved'); the first reason is kept. */
export function markHoldDisturbed(unit, reason) {
  if (unit?.aiMode !== HOLD_AI_MODE || unit.holdDisturbed) return;
  unit.holdDisturbed = reason;
}
