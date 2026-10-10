// StaffBlessings.js - what the run's blessings add to a unit's staves (blessings v3 §5.3, §6.1).
// Saint's Reserve (`staff_uses_bonus`): every staff a PLAYER unit carries has this many more uses
// in each battle (staves refill every battle, so it is +N per battle). Saint's Reliquary
// (`staff_heal_range_bonus`, an earned blessing): a player's staff heals more HP (`healBonus`,
// added to the staff's output before the heal multiplier) and reaches further (`rangeBonus`,
// added to its longest reach: a heal or cure staff's targets, a Rescue's pull, a Warp's
// destinations). The shrine's heal multiplier (`healingMultiplier`: Blessed Hands' bonus, a
// price's cut) rides the same options. Foes and green allies get nothing.
//
// Every reader of a staff's uses, heal or reach passes the options this returns to Combat
// (getStaffMaxUses / getStaffRemainingUses, resolveHeal / calculateHealAmount /
// calculateStaffHealOutput, getEffectiveStaffRange), StaffRelocation and StaffSettlement, never
// the modifiers by hand, so the roster, the battle menu, the heal preview, the heal itself and the
// harness can never show different numbers (tests/StaffBlessingBoundary.test.js). Pure: no Phaser.

import { shrineBoonsOf } from './ShrineBoons.js';
import { staffHealRangeOf } from './EarnedBoons.js';
import { normalizeHealingMultiplier } from './Combat.js';

/**
 * The staff options for `unit` in `run`: `{ bonusUses, healBonus, rangeBonus, healingMultiplier }`,
 * each key present only when it changes something (a run holding none of them, a foe, an NPC
 * or no run at all: `{}`).
 * @param {object|null} run a RunManager (or null: a standalone battle)
 * @param {object|null} unit
 * @returns {{ bonusUses?: number, healBonus?: number, rangeBonus?: number,
 *   healingMultiplier?: number }}
 */
export function staffRunOptions(run, unit) {
  if (!run || unit?.faction !== 'player') return {};
  const options = {};
  const bonusUses = shrineBoonsOf(run).staffUsesBonus;
  if (bonusUses > 0) options.bonusUses = bonusUses;
  const { heal, range } = staffHealRangeOf(run);
  if (heal > 0) options.healBonus = heal;
  if (range > 0) options.rangeBonus = range;
  const multiplier = normalizeHealingMultiplier(
    run.blessingRuntimeModifiers?.healingEffectivenessMultiplier ?? 1,
  );
  if (multiplier !== 1) options.healingMultiplier = multiplier;
  return options;
}
