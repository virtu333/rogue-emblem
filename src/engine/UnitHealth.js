// UnitHealth — the one owner of a unit's current HP in play (no Phaser deps, no RNG).
//
// Every heal, hit and HP cost goes through here, so the rules that ride on HP hold
// however the change is shown, or whether it is shown at all (a headless run, a
// skipped animation, a redraw that never happens). Rendering reads HP; it never
// settles anything.
//
// The rule it keeps today: HP accessory debt. Taking off an HP accessory keeps
// missing HP the same but never kills, so at critical HP the floor at 1 is HP the
// unit did not pay for; UnitManager.applyAccessoryStats records it on
// `_accessoryHpOwed` and the next HP bonus pays it back first. The debt is forgiven
// the moment the unit stands at full HP or goes down (it rested, was healed past it,
// or fell), so a later wound cannot make an old debt bite.
//
// Callers keep what belongs to their action: XP, staff uses, deeds, floors such as
// "poison never kills", death removal, banners and animation.

/** HP the unit owes from taking off an HP accessory at critical HP (0 when none). */
export function accessoryHpOwed(unit) {
  const owed = Math.trunc(Number(unit?._accessoryHpOwed) || 0);
  return owed > 0 ? owed : 0;
}

export function setAccessoryHpOwed(unit, amount) {
  if (amount > 0) unit._accessoryHpOwed = amount;
  else delete unit._accessoryHpOwed;
}

/**
 * Forget the debt once it no longer matters: the unit is at full HP or down. Pure
 * reconciliation with the unit's current state, so calling it again changes nothing.
 * Revival starts a unit afresh and clears the debt outright (RunManager).
 */
export function settleAccessoryHpOwed(unit) {
  if (!unit || typeof unit !== 'object' || unit._accessoryHpOwed === undefined) return;
  const current = Number(unit.currentHP);
  const max = Number(unit.stats?.HP);
  if (!accessoryHpOwed(unit) || !(current > 0) || current >= max) delete unit._accessoryHpOwed;
}

import { isWounded } from './StatusConditionSystem.js';
import { markHoldDisturbed } from './HoldDisturbance.js';

const maxHpOf = (unit) => Number(unit?.stats?.HP);

/**
 * Set a unit's current HP (the caller has already applied its own floor or cap).
 * @returns {{ prev: number, hp: number, delta: number }}
 */
export function setUnitHP(unit, hp) {
  const prev = Number(unit.currentHP) || 0;
  unit.currentHP = hp;
  if (hp < prev) markHoldDisturbed(unit, 'hurt'); // a holder struck wakes its pack
  settleAccessoryHpOwed(unit);
  return { prev, hp, delta: hp - prev };
}

/**
 * Heal up to max HP. @returns the HP actually restored (0 when already full).
 * A Wounded unit recovers nothing (drain, items, Renewal, forts): only a staff heals
 * it, and staff heals set HP through setUnitHP.
 */
export function healUnit(unit, amount) {
  const prev = Number(unit.currentHP) || 0;
  if (isWounded(unit)) return 0;
  const max = maxHpOf(unit);
  const raised = prev + Math.max(0, Number(amount) || 0);
  const next = Number.isFinite(max) ? Math.max(prev, Math.min(max, raised)) : raised;
  setUnitHP(unit, next);
  return next - prev;
}

/** Restore a unit to its max HP (never while Wounded). @returns the HP restored. */
export function healUnitFully(unit) {
  const prev = Number(unit.currentHP) || 0;
  if (isWounded(unit)) return 0;
  setUnitHP(unit, Math.max(prev, maxHpOf(unit)));
  return unit.currentHP - prev;
}

/**
 * Take damage, never below `floor` (1 for effects that cannot kill). A unit already
 * at or below the floor loses nothing. @returns the HP actually lost.
 */
export function damageUnit(unit, amount, { floor = 0 } = {}) {
  const prev = Number(unit.currentHP) || 0;
  const next = Math.min(prev, Math.max(floor, prev - Math.max(0, Number(amount) || 0)));
  setUnitHP(unit, next);
  return prev - next;
}

/**
 * Apply a resolved combat (Combat.resolveCombat) to both units: each side's HP after
 * every strike, heal and reflection it records, then the final HP. A side that stood
 * at full HP at any point in the exchange (a drain that topped it up before the
 * counter landed) settles its debt exactly as it would with every strike shown.
 */
export function applyCombatHP(attacker, defender, result) {
  applyCombatSideHP(attacker, 'attacker', result);
  applyCombatSideHP(defender, 'defender', result);
}

/** Settle one strike before presentation: target damage, drain, then reflection. */
export function applyStrikeHP(striker, target, event) {
  if (!event || event.type !== 'strike' || event.miss) return;
  setUnitHP(target, event.targetHPAfter);
  if (event.heal > 0 && event.strikerHealTo !== undefined) setUnitHP(striker, event.strikerHealTo);
  if (event.reflectDamage > 0 && event.strikerHPAfter !== undefined)
    setUnitHP(striker, event.strikerHPAfter);
}

/**
 * One side of applyCombatHP ('attacker' | 'defender'), for callers that keep only one
 * unit (the arena's challenger is not kept). `floor` holds the final HP up (the
 * arena never lets its fighter die).
 */
export function applyCombatSideHP(unit, side, result, { floor = 0 } = {}) {
  const start = Number(unit?.currentHP);
  for (const event of result?.events || []) {
    if (event?.type !== 'strike' || event.miss) continue;
    const strikerSide = event.attackerSide === 'defender' ? 'defender' : 'attacker';
    if (strikerSide === side) {
      touchHP(unit, event.strikerHealTo);
      touchHP(unit, event.strikerHPAfter);
      if (event.strikerHPAfter < start) markHoldDisturbed(unit, 'hurt');
    } else {
      touchHP(unit, event.targetHPAfter);
      // Struck mid-exchange, even if a drain tops it back up before the end.
      if (event.targetHPAfter < start) markHoldDisturbed(unit, 'hurt');
    }
  }
  const final = side === 'defender' ? result.defenderHP : result.attackerHP;
  setUnitHP(unit, Math.max(floor, final));
}

/** Settle a debt the unit would settle if it stood at `hp` (a moment mid-combat). */
function touchHP(unit, hp) {
  if (!unit || !Number.isFinite(hp) || unit._accessoryHpOwed === undefined) return;
  if (hp <= 0 || hp >= maxHpOf(unit)) delete unit._accessoryHpOwed;
}
