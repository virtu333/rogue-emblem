// EntitySystem.js — Multi-tile Entity boss helpers (pure, no Phaser deps)

import { ENTITY_FOOTPRINT, ENTITY_SPLASH_DAMAGE } from '../utils/constants.js';
import { gridDistance } from './Combat.js';

/** Check if a unit is an Entity (multi-tile boss) */
export function isEntity(unit) {
  return unit?.isEntity === true;
}

/** Returns array of {col, row} tiles for an Entity's 3x3 footprint.
 *  Anchor (unit.col, unit.row) is the top-left corner.
 *  Non-entity units return a single tile. */
export function getFootprint(unit) {
  if (!isEntity(unit)) return [{ col: unit.col, row: unit.row }];
  const tiles = [];
  for (let dr = 0; dr < ENTITY_FOOTPRINT.height; dr++) {
    for (let dc = 0; dc < ENTITY_FOOTPRINT.width; dc++) {
      tiles.push({ col: unit.col + dc, row: unit.row + dr });
    }
  }
  return tiles;
}

/** Returns "col,row" key strings for all occupied tiles */
export function getFootprintKeys(unit) {
  return getFootprint(unit).map((t) => `${t.col},${t.row}`);
}

/** Minimum Manhattan distance from any Entity body tile to a target tile */
export function entityDistanceTo(entity, targetCol, targetRow) {
  let minDist = Infinity;
  for (const tile of getFootprint(entity)) {
    const d = Math.abs(tile.col - targetCol) + Math.abs(tile.row - targetRow);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Compute combat distance — uses entityDistanceTo if either combatant is Entity */
export function combatDistance(unit1, unit2) {
  if (isEntity(unit1)) return entityDistanceTo(unit1, unit2.col, unit2.row);
  if (isEntity(unit2)) return entityDistanceTo(unit2, unit1.col, unit1.row);
  return gridDistance(unit1.col, unit1.row, unit2.col, unit2.row);
}

/** Pick the weapon dealing more damage to target. calcDamageFn(entity, weapon, target) → number */
export function pickBestWeapon(entity, target, calcDamageFn) {
  if (!entity.inventory || entity.inventory.length <= 1) return entity.weapon;
  let best = entity.inventory[0];
  let bestDmg = calcDamageFn(entity, best, target);
  for (let i = 1; i < entity.inventory.length; i++) {
    const dmg = calcDamageFn(entity, entity.inventory[i], target);
    if (dmg > bestDmg) {
      bestDmg = dmg;
      best = entity.inventory[i];
    }
  }
  return best;
}

/** Roll 0–splashCount random tiles within Manhattan 1 of the primary target,
 *  excluding the target tile itself and Entity body tiles.
 *  Returns array of {col, row}. */
export function rollSplashTiles(primaryCol, primaryRow, entity, cols, rows, splashCount, rng) {
  const random = rng || Math.random;
  const bodyKeys = new Set(getFootprintKeys(entity));
  const targetKey = `${primaryCol},${primaryRow}`;
  const candidates = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue; // skip target tile
      const c = primaryCol + dc;
      const r = primaryRow + dr;
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      // Manhattan distance 1 only (no diagonals — but plan says Manhattan 1)
      if (Math.abs(dc) + Math.abs(dr) > 1) continue;
      const key = `${c},${r}`;
      if (bodyKeys.has(key) || key === targetKey) continue;
      candidates.push({ col: c, row: r });
    }
  }
  // Shuffle and take random 0..maxCount tiles
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const maxCount = Math.min(splashCount, candidates.length);
  const count = Math.floor(random() * (maxCount + 1)); // 0 to maxCount
  return candidates.slice(0, count);
}

/** Roll splash damage — uniform random between ENTITY_SPLASH_DAMAGE[0] and [1] */
export function rollSplashDamage(rng) {
  const random = rng || Math.random;
  const [min, max] = ENTITY_SPLASH_DAMAGE;
  return min + Math.floor(random() * (max - min + 1));
}

/** Returns center tile of Entity (for camera targeting) */
export function getEntityCenter(unit) {
  if (!isEntity(unit)) return { col: unit.col, row: unit.row };
  return {
    col: unit.col + Math.floor(ENTITY_FOOTPRINT.width / 2),
    row: unit.row + Math.floor(ENTITY_FOOTPRINT.height / 2),
  };
}
