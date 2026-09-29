// How many units a battle deployed (battleParams.deployCount). Map generation sizes
// spawns and enemy counts by it, and the Last deed needs it at victory (DeedController).
// Pure, no Phaser.

/**
 * @param {{tutorialMode?: boolean, deployedRoster?: object[]|null, resuming?: boolean,
 *          recorded?: unknown}} options
 *   recorded: battleParams.deployCount as saved with the battle in progress.
 * @returns {number}
 */
export function battleDeployCount({
  tutorialMode = false,
  deployedRoster = null,
  resuming = false,
  recorded,
} = {}) {
  if (tutorialMode) return 2;
  if (Array.isArray(deployedRoster)) return deployedRoster.length;
  // A resumed battle's units come from its checkpoint, not a deployment: keep the
  // count recorded when the battle began (it was reset to 2, so no resumed battle
  // could ever award the Last).
  const saved = Number(recorded);
  if (resuming && Number.isInteger(saved) && saved > 0) return saved;
  return 2;
}

/**
 * The deploy screen's limits for a battle. A battle's map is locked the first time it
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
  const bonus = Math.trunc(Number(deployBonus) || 0);
  let min = Math.max(1, base.min + bonus);
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
