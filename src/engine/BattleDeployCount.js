// How many units a battle deployed (battleParams.deployCount). Map generation sizes
// spawns and enemy counts by it, and the Last deed needs it at victory (DeedController).
// Pure, no Phaser.

import { DEPLOY_LIMITS } from '../utils/constants.js';
import { isPrologueRun } from './ScriptedBattle.js';

/**
 * @param {{deployedRoster?: object[]|null, resuming?: boolean, recorded?: unknown}} options
 *   recorded: battleParams.deployCount as saved with the battle in progress.
 * @returns {number}
 */
export function battleDeployCount({ deployedRoster = null, resuming = false, recorded } = {}) {
  if (Array.isArray(deployedRoster)) return deployedRoster.length;
  // A resumed battle's units come from its checkpoint, not a deployment: keep the
  // count recorded when the battle began (it was reset to 2, so no resumed battle
  // could ever award the Last).
  const saved = Number(recorded);
  if (resuming && Number.isInteger(saved) && saved > 0) return saved;
  return 2;
}

/**
 * The deploy screen's limits for a battle: the act's min, and its max plus the deploy
 * bonus. A battle's map is locked the first time it
 * is entered (RunManager.lockBattleConfig) with one player spawn per unit deployed then,
 * and Continue from Map keeps that lock so the encounter can't be rerolled. Re-entering
 * may therefore deploy no more units than the lock has spawns: a unit past the last
 * spawn would never be placed (and, missing from both the field and the bench, would be
 * counted as fallen at victory).
 *
 * @param {{base?: {min: number, max: number}, deployBonus?: number,
 *          lockedSpawnCount?: number|null}} options
 * @returns {{min: number, max: number, lockedTo: number|null}}
 *   lockedTo: the lock's spawn count when it lowered the cap, else null.
 */
export function resolveDeployLimits({
  base = { min: 3, max: 4 },
  deployBonus = 0,
  lockedSpawnCount = null,
} = {}) {
  // A deploy bonus (Tactical Advantage, Scout Blessing) opens more slots; it never
  // raises the number of units a battle requires.
  const bonus = Math.trunc(Number(deployBonus) || 0);
  let min = Math.max(1, base.min);
  let max = Math.max(min, base.max + bonus);
  let lockedTo = null;
  const locked = Number(lockedSpawnCount);
  if (Number.isInteger(locked) && locked > 0 && locked < max) {
    max = locked;
    min = Math.min(min, locked);
    lockedTo = locked;
  }
  return { min, max, lockedTo };
}

/**
 * The deploy slots a run's battles open in its current act (the deploy screen's max:
 * the act's max plus the deploy bonus), for the roster's header. A re-entered battle
 * may open fewer (its locked map: resolveDeployLimits), which only the deploy screen
 * knows. Null for no run and for the prologue, whose chapters author their own deploys.
 * @param {object|null} run a RunManager
 * @returns {{slots: number, bonus: number, units: number}|null}
 */
export function rosterDeploySlots(run) {
  if (!run || isPrologueRun(run)) return null;
  const base = DEPLOY_LIMITS[run.currentAct] || DEPLOY_LIMITS.act1;
  const bonus = Math.trunc(Number(run.getDeployBonus?.()) || 0);
  const { max } = resolveDeployLimits({ base, deployBonus: bonus });
  return { slots: max, bonus, units: Array.isArray(run.roster) ? run.roster.length : 0 };
}
