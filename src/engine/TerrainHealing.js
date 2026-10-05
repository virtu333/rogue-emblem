// TerrainHealing.js — Fort and Throne healing at a side's turn start (pure, no Phaser).
//
// A unit standing on a Fort or Throne at the start of its side's phase heals 10% of its
// max HP (at least 1). Staying put decays it (FORT_HEAL_DECAY_MULTIPLIERS, by the unit's
// `_fortHealStreak`); stepping off resets the streak, and so does starting a combat
// (resetFortHealStreak). BattleScene plays the heal; the headless harness applies it
// without presentation. Both settle it here, then heal through UnitHealth.

import { FORT_HEAL_DECAY_MULTIPLIERS, TERRAIN, TERRAIN_HEAL_PERCENT } from '../utils/constants.js';

export function isHealingTerrainIndex(terrainIdx) {
  return terrainIdx === TERRAIN.Fort || terrainIdx === TERRAIN.Throne;
}

/**
 * Settle one unit's terrain heal for this turn start (mutates `_fortHealStreak`).
 * @returns {number} HP to heal (0: none)
 */
export function settleTerrainHeal(unit, terrainIdx) {
  if (!unit) return 0;
  if (!isHealingTerrainIndex(terrainIdx)) {
    unit._fortHealStreak = 0;
    return 0;
  }
  if (unit.currentHP >= unit.stats.HP) return 0;
  const streak = Math.max(0, unit._fortHealStreak || 0);
  const decayIdx = Math.min(streak, FORT_HEAL_DECAY_MULTIPLIERS.length - 1);
  const baseHeal = Math.max(1, Math.floor(unit.stats.HP * TERRAIN_HEAL_PERCENT));
  unit._fortHealStreak = streak + 1;
  return Math.max(0, Math.floor(baseHeal * FORT_HEAL_DECAY_MULTIPLIERS[decayIdx]));
}

/** A unit that starts a combat gives up its Fort streak. */
export function resetFortHealStreak(unit) {
  if (unit) unit._fortHealStreak = 0;
}
