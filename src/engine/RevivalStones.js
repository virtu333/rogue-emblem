// RevivalStones — which bosses carry stones, and how many (docs/specs/phase3.md 3D). Pure.
//
// A boss with stones refills to full HP when a blow would drop it to 0, once per stone
// (UnitHealth.absorbLethal is the one rule; Combat.rollStrike and UnitHealth.damageUnit
// call it). This module decides who has them:
//
// * difficulty.json `revivalStones` per rung: `{ actBoss, emperor, lieutenant, eliteCaptain }`,
//   every rung carrying all four keys (First Light all 0).
// * MapGenerator writes the count into the boss spawn (`spawn.revivalStones`) beside the
//   rung's bossLevelBonus, so a locked map keeps it. A spawn with none carries no key, and
//   a map locked before stones existed has none: 0.
// * `applyRevivalStones` puts it on the unit (`revivalStones` remaining, `revivalStonesMax`)
//   for BattleScene and the headless harness alike.
//
// The Entity never carries stones: its finale is already its second act (BattleMusicController).

export const REVIVAL_STONE_KINDS = Object.freeze([
  'actBoss',
  'emperor',
  'lieutenant',
  'eliteCaptain',
]);

/** Acts whose boss is an "act boss" (the Emperor and the Lieutenant are their own kinds). */
const ACT_BOSS_ACTS = new Set(['act1', 'act2', 'act3']);

const wholeNumber = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Which stone kind a boss spawn is, or null for the Entity (never stoned) and for anything
 * outside the table.
 * @param {{ bossDef?: object, act?: string, isEliteCaptain?: boolean }} p
 */
export function revivalStoneKind({ bossDef = null, act = null, isEliteCaptain = false } = {}) {
  if (bossDef?.isEntity) return null;
  if (isEliteCaptain) return 'eliteCaptain';
  if (act === 'act4') return 'emperor';
  if (act === 'finalBoss') return 'lieutenant';
  if (ACT_BOSS_ACTS.has(act)) return 'actBoss';
  return null;
}

/** Stones a boss of this kind carries on this rung's table (0 for no table, kind or entry). */
export function revivalStonesFor(table, kind) {
  if (!table || typeof table !== 'object' || !kind) return 0;
  return wholeNumber(table[kind]);
}

/** Does any kind carry a stone on this table? */
export function hasRevivalStones(table) {
  return REVIVAL_STONE_KINDS.some((kind) => revivalStonesFor(table, kind) > 0);
}

/**
 * Give the unit built from `spawn` its stones (mutated). Only a boss spawn that names a
 * count carries any, and never the Entity; every other spawn is left exactly as it was.
 * @returns the unit
 */
export function applyRevivalStones(unit, spawn) {
  if (!unit || !spawn?.isBoss || spawn.isEntity) return unit;
  const stones = wholeNumber(spawn.revivalStones);
  if (stones <= 0) return unit;
  unit.revivalStones = stones;
  unit.revivalStonesMax = stones;
  return unit;
}

/** Remaining and total stones for a unit (the pips and the forecast read this). */
export function revivalStoneCount(unit) {
  const remaining = wholeNumber(unit?.revivalStones);
  const max = Math.max(remaining, wholeNumber(unit?.revivalStonesMax));
  return { remaining, max };
}
