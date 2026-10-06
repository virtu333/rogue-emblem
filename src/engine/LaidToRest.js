// LaidToRest.js — allies an event laid to rest (docs/specs/event-nodes.md §5 `layToRest`).
//
// A unit laid to rest at the Echo leaves `run.fallenUnits` for good, so no church, ruins or
// colosseum can offer to revive it. The record stays on `run.laidToRest` (the whole
// serialized unit, saved with the run) because the run still remembers them: their names
// stay taken, a fallen lord is still a lord the run has met (never offered again as a
// recruit or third lord), and the run record lists them among the fallen. Every reader
// that asks "who has this run lost?" calls everFallenUnits instead of reading fallenUnits.
//
// Pure: no Phaser, no randomness.

/** Units still awaiting revival plus units laid to rest. */
export function everFallenUnits(run) {
  return [
    ...(Array.isArray(run?.fallenUnits) ? run.fallenUnits : []),
    ...(Array.isArray(run?.laidToRest) ? run.laidToRest : []),
  ];
}

/** True when the unit was laid to rest (it can never be revived). */
export function isLaidToRest(run, unit) {
  return (Array.isArray(run?.laidToRest) ? run.laidToRest : []).some(
    (rested) => rested === unit || (rested?.unitUid && rested.unitUid === unit?.unitUid),
  );
}
