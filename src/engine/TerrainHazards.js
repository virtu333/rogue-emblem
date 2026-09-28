import {
  ACID_DAMAGE_MAX,
  ACID_DAMAGE_PERCENT,
  ACID_TERRAIN_TYPES,
  LAVA_CRACK_DAMAGE,
  STATUS_CONDITIONS,
  TERRAIN,
} from '../utils/constants.js';

export function isLavaCrackTerrainIndex(terrainIndex) {
  return terrainIndex === TERRAIN.LavaCrack;
}

export function computeLavaCrackHp(currentHP, damage = LAVA_CRACK_DAMAGE) {
  const safeHp = Number(currentHP) || 0;
  const nextHP = Math.max(1, safeHp - damage);
  return {
    nextHP,
    appliedDamage: Math.max(0, safeHp - nextHP),
  };
}

export function isAcidTerrainIndex(terrainIndex) {
  return ACID_TERRAIN_TYPES.has(terrainIndex);
}

/**
 * Turn starts on which acid ground still hurts after a unit's last exposure.
 * Standing on it at the end of its phase gives the unit Acid for
 * STATUS_CONDITIONS.acid.maxTurns; each turn start counts that down before the
 * damage (BattleScene.processTurnStartEffects), so the last count-down clears
 * it without a hit.
 */
export const ACID_DAMAGE_TURNS = STATUS_CONDITIONS.acid.maxTurns - 1;

export function computeAcidDamage(maxHP) {
  const safeMaxHp = Number(maxHP) || 1;
  const raw = Math.ceil(safeMaxHp * ACID_DAMAGE_PERCENT);
  return Math.max(1, Math.min(ACID_DAMAGE_MAX, raw));
}
