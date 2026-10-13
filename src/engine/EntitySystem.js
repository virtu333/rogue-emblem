// EntitySystem.js — Multi-tile Entity boss helpers (pure, no Phaser deps)

import {
  ENTITY_FOOTPRINT,
  ENTITY_SPLASH_COUNT,
  ENTITY_SPLASH_COUNT_MAX,
  ENTITY_SPLASH_DAMAGE,
} from '../utils/constants.js';
import { gridDistance } from './CombatGeometry.js';
import { damageUnitDetailed } from './UnitHealth.js';

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

/**
 * The distance between two units (or a unit and a tile): entityDistanceTo when either is the
 * Entity, so it is measured from the nearest tile of its 3x3 body, else plain Manhattan
 * distance. Every rule that asks how far one unit is from another reads this (attack range,
 * auras, adjacency and within-N conditions, ally reach, Deathburst, heal range), never the
 * Entity's top-left anchor alone.
 */
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
 *  Returns array of {col, row}.
 *  Draws: one per shuffle swap (candidates − 1, none for fewer than two candidates), then one
 *  for the count, whatever `splashCount` is (0 included): the count only maps that last draw
 *  onto 0..min(splashCount, candidates), so a different count changes which tiles are struck
 *  (and so how many damage draws follow), never how many draws the tiles take. */
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

/**
 * How many tiles the Entity's splash may strike in this battle: the locked config's
 * `entitySplashCount` (written at generation; the Rite's tier moves it by one) or
 * ENTITY_SPLASH_COUNT, a whole number clamped to 0..ENTITY_SPLASH_COUNT_MAX (the four
 * orthogonal neighbours). Anything but a finite number reads as the default.
 */
export function entitySplashCountFor(config) {
  const raw = config?.entitySplashCount;
  if (!Number.isFinite(raw)) return ENTITY_SPLASH_COUNT;
  return Math.max(0, Math.min(ENTITY_SPLASH_COUNT_MAX, Math.trunc(raw)));
}

/**
 * The Entity's splash after its strike on `primaryTarget` (the rule BattleScene drives with
 * presentation and the harness drives without). Rolls the tiles (rollSplashTiles, with
 * entitySplashCountFor(world.battleConfig)), then, tile by tile, strikes the living non-enemy
 * unit standing there (never the primary target) for rollSplashDamage through
 * UnitHealth.damageUnitDetailed (no hit roll, no Miracle): a Revival Stone refills a bar and
 * the Unbroken Banner holds a player unit at 1 (`world.battleBlessings`).
 *
 * A generator: each hit is yielded after its HP change and before the next tile is read, so
 * the caller presents it and removes a fallen victim (killer: the Entity) first, and every
 * draw (the battle stream, `world.rng` or Math.random read at each draw) interleaves with
 * the caller's exactly as the scene's inline loop did. Yields
 *   { kind: 'splash', victim, tile: { col, row }, damage, lost, stoneBroken, bannerHeld, fell }
 * and returns the plain record { count, tiles, hits }.
 *
 * world: { cols, rows, getUnitAt(col, row), battleBlessings, battleConfig, rng? }
 */
export function* entitySplash(entity, primaryTarget, world) {
  const count = entitySplashCountFor(world.battleConfig);
  const tiles = rollSplashTiles(
    primaryTarget.col,
    primaryTarget.row,
    entity,
    world.cols,
    world.rows,
    count,
    world.rng,
  );
  const hits = [];
  for (const tile of tiles) {
    const victim = world.getUnitAt(tile.col, tile.row);
    if (!victim || victim === primaryTarget || victim.currentHP <= 0) continue;
    if (victim.faction === 'enemy') continue; // Don't splash allies
    const damage = rollSplashDamage(world.rng);
    const { lost, stoneBroken, bannerHeld } = damageUnitDetailed(victim, damage, {
      blessings: world.battleBlessings,
    });
    const hit = {
      kind: 'splash',
      victim,
      tile: { col: tile.col, row: tile.row },
      damage,
      lost,
      stoneBroken: Boolean(stoneBroken),
      bannerHeld: Boolean(bannerHeld),
      fell: victim.currentHP <= 0,
    };
    hits.push(hit);
    yield hit;
  }
  return { count, tiles: tiles.map((t) => ({ col: t.col, row: t.row })), hits };
}

/**
 * Drive the splash without presentation (the harness): a fallen victim is removed through
 * `remove(victim, { killer: entity })` before the next tile, as the scene does. Returns the
 * step's record.
 */
export function runEntitySplashSync(entity, primaryTarget, world, { remove } = {}) {
  const steps = entitySplash(entity, primaryTarget, world);
  for (;;) {
    const { value, done } = steps.next();
    if (done) return value;
    if (value.victim.currentHP <= 0) remove?.(value.victim, { killer: entity });
  }
}

/**
 * The Entity's health among `units`: { current, max, ratio } for the first
 * Entity found (null when there is none or its max HP is unknown).
 */
export function entityHealth(units) {
  const entity = (units || []).find((u) => isEntity(u));
  const max = Number(entity?.stats?.HP);
  if (!entity || !(max > 0)) return null;
  const current = Math.max(0, Math.min(max, Number(entity.currentHP) || 0));
  return { current, max, ratio: current / max };
}

/** Returns center tile of Entity (for camera targeting) */
export function getEntityCenter(unit) {
  if (!isEntity(unit)) return { col: unit.col, row: unit.row };
  return {
    col: unit.col + Math.floor(ENTITY_FOOTPRINT.width / 2),
    row: unit.row + Math.floor(ENTITY_FOOTPRINT.height / 2),
  };
}
