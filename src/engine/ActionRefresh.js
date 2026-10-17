// ActionRefresh.js — the one transition that lets a unit that has acted move and act again.
// Pure, a leaf (no imports), so every refresh can share it without an import cycle.
//
// Every source of a fresh action goes through `refreshUnitAction`: the Galeforce Charm
// (GaleforceCharm.consumeGaleforce), Commander's Gambit and a kill-move art's refreshActor
// (BattlePresentationCheckpoint.completeResolvedAction, and the harness), Dance and Goddess
// Dance (ActionAbilitySystem.refreshActedAlly). It resets the action flags, the movement the
// last action spent (so Canto, Ride Down and the like read the new action's walk only) and
// any Galeforce Charm proc still waiting: refreshes never stack, so when another refresh wins
// on the same action the charm's proc is used up by it (it still counts as one of the charm's
// uses), never carried to a later Wait.
//
// `keepMovementSpent`: Dance's refresh has always left `_movementSpent` alone; it keeps that.

export function refreshUnitAction(unit, { keepMovementSpent = false } = {}) {
  if (!unit) return unit;
  unit.hasMoved = false;
  unit._movementCommitted = false;
  unit.hasActed = false;
  if (!keepMovementSpent) unit._movementSpent = 0;
  delete unit._galeforceReady;
  return unit;
}
