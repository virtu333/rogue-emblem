// The ability-slot split (#344) for a suspended battle's saved copies of the army. Pure.
//
// A save from before the split may hold a unit with more abilities equipped than the three
// ability slots. RunManager.fromJSON settles the roster and the fallen on load
// (SkillLoadout.settleSlotOverflow), but a battle in progress keeps copies of its own that
// never pass through the roster: the checkpoint's unit groups (Resume Battle installs them as
// they are), its Vision anchors (`visionSnapshot`, `pendingVisionSnapshot`) and every
// destination the rewind timeline stores. Left alone, Resume Battle and a Vision rewind would
// bring back the old loadout that Continue from Map (the settled roster) no longer has: two
// recovery choices, two slot rules. So every copy is settled on load by the same rule, with
// the same locked-first order, so a copy and the roster unit it came from agree.
//
// Only the loadout lists move (`skills`, `benchedSkills`, `benchedUnseen`): no RNG, positions,
// items or battle ids, so the checkpoint's RNG state, the run-domain snapshot
// (`runBattleState`), the entry state and the rewind fingerprint (positions and items) are
// untouched, and validateBattleState reads none of them. The walk is idempotent (a settled
// unit moves nothing), so like the roster's it needs no revision marker: a load re-applies it
// harmlessly, and a save written back by an older build is settled again on the next load.

import { settleSlotOverflow } from './SkillLoadout.js';
import { reviseBattleTimelineStates } from './BattleTimeline.js';

/** The groups that hold the army's own units: never a foe's or a green NPC's. */
const ARMY_GROUPS = ['playerUnits', 'escapedUnits', 'nonDeployedUnits'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Settle every army unit a saved battle state holds (its groups and its Talk recruits'
 * records), in place. Returns how many units changed.
 */
export function settleBattleStateSlots(state, gameData = {}) {
  if (!isRecord(state)) return 0;
  let changed = 0;
  const settle = (unit) => {
    if (isRecord(unit) && settleSlotOverflow(unit, gameData).length) changed++;
  };
  for (const group of ARMY_GROUPS) if (Array.isArray(state[group])) state[group].forEach(settle);
  if (Array.isArray(state.battleRecruits))
    for (const entry of state.battleRecruits) settle(entry?.unit);
  return changed;
}

/**
 * Settle a loaded battle flag's checkpoint, its Vision anchors and its (hydrated) timeline,
 * in place. Returns how many unit copies changed.
 */
export function settleSavedBattleSlots(flag, gameData = {}) {
  if (!isRecord(flag) || !isRecord(flag.checkpoint)) return 0;
  const checkpoint = flag.checkpoint;
  let changed = settleBattleStateSlots(checkpoint, gameData);
  for (const key of ['visionSnapshot', 'pendingVisionSnapshot'])
    changed += settleBattleStateSlots(checkpoint[key], gameData);
  if (isRecord(flag.timeline)) {
    flag.timeline = reviseBattleTimelineStates(flag.timeline, (state) => {
      const n = settleBattleStateSlots(state, gameData);
      changed += n;
      return n > 0;
    });
  }
  return changed;
}
