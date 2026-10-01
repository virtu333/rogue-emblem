// EnemyArtScoring — how the enemy AI picks a weapon art (docs/specs/aoe-weapon-arts.md §7).
// The one implementation behind BattleScene (WeaponArtController) and the headless
// harness. Pure: the only randomness is the use-chance roll the caller passes in.
//
// An art's score is its stat value (mods, effectiveness, statuses, cost). An area art
// adds what its blows would do around the chosen target: the AI sees every unit, so it
// plans over the whole world (execution's view, never a preview's).

import { planAreaBlows } from './AreaDamage.js';
import {
  getEffectiveWeaponArtHpCost,
  getWeaponArtArea,
  getWeaponArtCombatMods,
  getWeaponArtKillEffects,
  getWeaponArtMissEffects,
  getWeaponArtTargeting,
  getWeaponArtTier2Effects,
} from './WeaponArtSystem.js';

/** The art's value on its own: its mods and effects against its HP cost. */
export function scoreEnemyWeaponArt(unit, art, { weaponArtHpCostDelta = 0 } = {}) {
  const mods = getWeaponArtCombatMods(art);
  const hpCost = getEffectiveWeaponArtHpCost(unit, art, { weaponArtHpCostDelta });
  const effectivenessScore =
    mods.effectiveness?.multiplier > 1 ? (mods.effectiveness.multiplier - 1) * 4 : 0;
  const rangeOverrideScore = mods.rangeOverride
    ? (Math.max(mods.rangeOverride.min, mods.rangeOverride.max) - 1) * 1.5
    : 0;
  const statusCount = getWeaponArtTier2Effects(art).inflictStatus.length;
  const { selfDamageOnMiss } = getWeaponArtMissEffects(art);
  const { killBuff } = getWeaponArtKillEffects(art);
  return (
    mods.atkBonus * 3 +
    mods.hitBonus * 0.35 +
    mods.critBonus * 0.25 +
    mods.spdBonus * 0.5 +
    mods.avoidBonus * 0.15 +
    mods.defBonus * 0.1 +
    effectivenessScore +
    (mods.rangeBonus || 0) * 1.2 +
    rangeOverrideScore +
    (mods.preventCounter ? 3.5 : 0) +
    (mods.targetsRES ? 2.5 : 0) +
    (mods.halfPhysicalDamage ? 2.5 : 0) +
    (mods.vengeance ? 4 : 0) +
    statusCount * 3 +
    (mods.damageMultiplier > 1 ? (mods.damageMultiplier - 1) * 6 : 0) +
    (mods.ignoreWeaponTriangle ? 1.5 : 0) +
    (mods.ignoreRES ? 3 : 0) +
    (killBuff ? 1 : 0) -
    (selfDamageOnMiss ? selfDamageOnMiss * 0.3 : 0) -
    hpCost * 0.75
  );
}

/**
 * What an area art's blows are worth around `target` from where `unit` stands:
 * 0.8 × Σ (share of each victim's HP taken × 4 + 6 per kill). A normal-attack area only
 * (the AI never aims a chosen-center art); zero when nobody is in reach. Its own side is
 * never in a hostile area, so nothing is subtracted for allies.
 * @param {object} world { cols, rows, getMoveCost, getTerrainAt?, hostilesOf(unit) }
 */
export function scoreAreaBonus(unit, art, target, world) {
  if (!unit || !target || !world || getWeaponArtTargeting(art) !== 'normal_attack') return 0;
  const area = getWeaponArtArea(art);
  if (!area) return 0;
  const plan = planAreaBlows({
    source: unit,
    primary: target,
    area,
    units: world.hostilesOf(unit),
    world,
    strikeMods: getWeaponArtCombatMods(art),
  });
  let value = 0;
  for (const { unit: victim, damage } of plan) {
    const hp = Math.max(1, Number(victim.currentHP) || 0);
    value += (Math.min(damage, hp) / hp) * 4 + (damage >= hp && !area.nonLethal ? 6 : 0);
  }
  return 0.8 * value;
}

/** Difficulty tuning: the least score worth an art, and how often the AI uses one. */
export function enemyWeaponArtTuning(difficultyId) {
  if (!difficultyId) return { minScore: 0.75, useChance: 1.0 };
  const id = String(difficultyId).toLowerCase();
  if (id === 'normal') return { minScore: 2.25, useChance: 0.6 };
  if (id === 'dusk') return { minScore: 1.5, useChance: 0.75 };
  if (id === 'lunatic') return { minScore: 0.25, useChance: 1.0 };
  return { minScore: 0.75, useChance: 0.9 };
}

/**
 * The art the AI uses against `target`, or null. `choices` are the usable
 * { art } entries for its weapon; `roll()` is drawn once, only when some art clears the
 * minimum score and the difficulty's use chance is below 1 (the order the battle RNG
 * has always seen).
 */
export function selectEnemyWeaponArt({
  unit,
  target,
  choices,
  world = null, // the battle (or a getter for it): { cols, rows, getMoveCost, hostilesOf, ... }
  difficultyId = null,
  weaponArtHpCostDelta = 0,
  roll = Math.random,
}) {
  const tuning = enemyWeaponArtTuning(difficultyId);
  // `world` may be a getter: it is read only when an area art is in play.
  let areaWorld;
  const worldFor = () => (areaWorld ??= typeof world === 'function' ? world() : world);
  const scored = (choices || [])
    .filter((choice) => getWeaponArtTargeting(choice.art) === 'normal_attack')
    .map((choice) => ({
      art: choice.art,
      score:
        scoreEnemyWeaponArt(unit, choice.art, { weaponArtHpCostDelta }) +
        (getWeaponArtArea(choice.art) ? scoreAreaBonus(unit, choice.art, target, worldFor()) : 0),
    }))
    .filter((entry) => entry.score >= tuning.minScore);
  if (scored.length <= 0) return null;
  if (tuning.useChance < 1 && roll() > tuning.useChance) return null;
  const cost = (art) => getEffectiveWeaponArtHpCost(unit, art, { weaponArtHpCostDelta });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aCost = cost(a.art);
    const bCost = cost(b.art);
    if (aCost !== bCost) return aCost - bCost;
    return String(a.art?.id || '').localeCompare(String(b.art?.id || ''));
  });
  return scored[0].art;
}
