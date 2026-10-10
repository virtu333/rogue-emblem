// StaffBlessings.js - what the run's blessings add to a unit's staves (blessings v3 §5.3).
// Saint's Reserve (`staff_uses_bonus`): every staff a PLAYER unit carries has this many more uses
// in each battle (staves refill every battle, so it is +N per battle). Foes and green allies get
// nothing.
//
// Every reader of a staff's uses passes the options this returns to Combat.getStaffMaxUses /
// getStaffRemainingUses (and StaffSettlement.validateStaffAction), never the modifiers by hand,
// so the roster, the battle menu, the heal itself and the harness can never show different
// counts (tests/StaffBlessingBoundary.test.js). Pure: no Phaser.

import { shrineBoonsOf } from './ShrineBoons.js';

/**
 * The staff options for `unit` in `run`: `{ bonusUses }` for a player unit while Saint's Reserve
 * is held, `{}` otherwise (no run, a foe, an NPC).
 * @param {object|null} run a RunManager (or null: a standalone battle)
 * @param {object|null} unit
 * @returns {{ bonusUses?: number }}
 */
export function staffRunOptions(run, unit) {
  if (!run || unit?.faction !== 'player') return {};
  const bonusUses = shrineBoonsOf(run).staffUsesBonus;
  return bonusUses > 0 ? { bonusUses } : {};
}
