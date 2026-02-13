import { LAVA_CRACK_DAMAGE, TERRAIN } from '../utils/constants.js';

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
