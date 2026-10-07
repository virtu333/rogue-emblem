// Necromancy — the Necromancer raises Skeletons, and they crumble when it falls
// (docs/specs/phase3.md 3I). Pure: no Phaser, no scene, never `Math.random`.
//
// The one implementation behind BattleScene (ui/NecromancyController.js) and the headless
// harness (_processNecromancy / _removeUnit), so the two cannot drift:
//
//   - RAISING. At the start of each enemy phase, right after the Zombie remains tick
//     (`processZombieRevival`), every living Necromancer with fewer than 2 living Skeletons
//     of its own raises one: onto the first free passable neighbour in `riseTile`'s order
//     (left, right, up, down), or not at all when none is free. The Necromancer's own turn
//     is not spent. The Skeleton has not acted, so it acts in that same phase.
//   - THE SKELETON. A base-class Skeleton at the Necromancer's level less 4 (never below 1;
//     the level the unit shows, so a promoted Necromancer's Skeleton is level 1 to 3). Its
//     weapon (an Iron sword, lance or bow), growths and level-ups come from its own keyed
//     stream,
//     `keyedBattleRandom(battleSeed, 'raise:<necromancer id>:<turn>:<n>')`, never the
//     battle's `Math.random`: a raise leaves the battle stream where it was, and a resume
//     or rewind that replays the phase raises the same Skeleton. `_raisedBy` links it to
//     its Necromancer's `battleEntityId`, which survives saves and rewinds.
//   - REWARDS. One predicate, `isRaisedUnit`, read by ReinforcementSpawns: no gold, a
//     quarter of the XP, no deed record.
//   - CRUMBLING. When a Necromancer falls, `crumbleFor` takes its own Skeletons off the
//     board with no killer: no gold, no XP. It runs before the battle-end check, so a rout
//     completes when the Necromancer was the last living foe.
//
// Raised units are ordinary enemies otherwise (serialization, rewind and the rout rule are
// untouched). Reinforcement templates never copy a Necromancer or a Skeleton
// (`isNecromancyClass`).

import { keyedBattleRandom } from './BattleRng.js';
import { riseTile } from './ZombieRemains.js';
import {
  applyEnemyDifficultyModifiers,
  createUnit,
  parseWeaponProficiencies,
} from './UnitManager.js';

export const NECROMANCER_CLASS = 'Necromancer';
export const SKELETON_CLASS = 'Skeleton';

/** A Necromancer keeps this many living Skeletons; below it, the next phase raises one. */
export const MAX_SKELETONS_PER_NECROMANCER = 2;
/** A Skeleton's level is its Necromancer's less this (never below 1). */
export const SKELETON_LEVEL_OFFSET = 4;
/** A raised unit pays this share of the XP its level would (gold: none). */
export const RAISED_XP_MULTIPLIER = 0.25;

/**
 * The classes that exist only through a Necromancer on the map. No reinforcement wave,
 * ladder wave, arrival template or arena entrant may become one: a Necromancer is placed by
 * the map generator (one per battle) and a Skeleton only by a raise.
 */
const NECROMANCY_CLASSES = new Set([NECROMANCER_CLASS, SKELETON_CLASS]);

/** True for the Necromancer and the Skeleton (never copied by an arrival or an arena bout). */
export function isNecromancyClass(className) {
  return NECROMANCY_CLASSES.has(className);
}

export function isNecromancer(unit) {
  return unit?.className === NECROMANCER_CLASS;
}

/**
 * A unit a Necromancer raised (its `_raisedBy` names the Necromancer's battleEntityId).
 * The one predicate for the raised unit's rewards: gold 0, XP x0.25, no deed record.
 */
export function isRaisedUnit(unit) {
  return typeof unit?._raisedBy === 'string' && unit._raisedBy.length > 0;
}

const alive = (unit) => Boolean(unit) && unit.currentHP > 0 && !unit._removing;

/** The living Skeletons `necromancer` raised (in `enemyUnits` order). */
export function skeletonsOf(necromancer, enemyUnits) {
  const id = necromancer?.battleEntityId;
  if (typeof id !== 'string' || !id) return [];
  return (enemyUnits || []).filter(
    (unit) => unit !== necromancer && unit._raisedBy === id && alive(unit),
  );
}

/**
 * The Necromancers that raise this phase, in `enemyUnits` order: living, and fielding
 * fewer than MAX_SKELETONS_PER_NECROMANCER living Skeletons of their own. Decided from the
 * board as it stands, so each Necromancer's count ignores the others' raises.
 */
export function raisers(enemyUnits) {
  return (enemyUnits || []).filter(
    (unit) =>
      isNecromancer(unit) &&
      alive(unit) &&
      typeof unit.battleEntityId === 'string' &&
      skeletonsOf(unit, enemyUnits).length < MAX_SKELETONS_PER_NECROMANCER,
  );
}

/**
 * At most one Necromancer per battle. A generator pick of a further Necromancer is MAPPED to
 * the next class of the promoted pool (wrapping; the first base class if the pool holds
 * nothing else): never re-rolled, so the pick draws exactly what it drew and the battle's
 * stream does not move. Any other class passes through.
 * @param {string} className the class just picked
 * @param {{ className: string }[]} spawns the spawns placed so far
 * @param {{ base?: string[], promoted?: string[] }} pool the filtered act pool
 */
export function mapExtraNecromancer(className, spawns, pool) {
  if (className !== NECROMANCER_CLASS) return className;
  if (!(spawns || []).some((spawn) => spawn?.className === NECROMANCER_CLASS)) return className;
  const promoted = Array.isArray(pool?.promoted) ? pool.promoted : [];
  const at = promoted.indexOf(NECROMANCER_CLASS);
  for (let step = 1; step < promoted.length; step++) {
    const next = promoted[(at + step) % promoted.length];
    if (next !== NECROMANCER_CLASS) return next;
  }
  return (pool?.base || []).find((name) => name !== NECROMANCER_CLASS) ?? className;
}

/**
 * The Skeleton's level for this Necromancer: its `level` less SKELETON_LEVEL_OFFSET, never
 * below 1. `level` is the number the unit shows (a promoted class counts from 1 again), so a
 * Necromancer's Skeleton is chaff of level 1 to 3: it blocks and chips, and the XP it pays
 * stays near the floor (docs/specs/phase3.md 3I; tests/sim/NecromancerXp.test.js).
 */
export function skeletonLevelFor(necromancer) {
  return Math.max(1, Math.trunc(Number(necromancer?.level) || 1) - SKELETON_LEVEL_OFFSET);
}

/** The keyed-stream key of the raise `ordinal` (how many it already fields) on `turn`. */
export function raiseKey(necromancer, turn, ordinal) {
  return `raise:${necromancer.battleEntityId}:${Math.max(1, Math.trunc(Number(turn) || 1))}:${ordinal}`;
}

/** The plain Iron weapon of a type (no special: never a Javelin or Hand Axe). */
const ironWeaponOfType = (weapons, type) =>
  (weapons || []).find((w) => w?.type === type && w.tier === 'Iron' && !w.special) || null;

/**
 * Where `necromancer` raises its next Skeleton: the first free passable tile among its four
 * neighbours (riseTile's order), or null. `isOccupied` and `moveCostAt` read the live board
 * (every unit, seen or not: this is execution, not a preview).
 */
export function raiseTile(necromancer, { cols, rows, isOccupied, moveCostAt }) {
  return riseTile(
    { col: necromancer.col, row: necromancer.row, snapshot: { moveType: 'Infantry' } },
    { cols, rows, isOccupied, moveCostAt },
  );
}

/**
 * Build the Skeleton `necromancer` raises on `tile`, from the keyed stream. Pure: it places
 * nothing and draws nothing from Math.random.
 *
 * Skeletons never carry items. Phase 3G gives some enemies carried items (Gold Pouches and
 * the like): a raised unit must never be handed one, or every raise would mint a fresh one
 * and the loot could be farmed. It holds its one Iron weapon and nothing else.
 *
 * @param {object} necromancer
 * @param {{ col: number, row: number }} tile
 * @param {{ classes: object[], weapons: object[], seed: number, turn: number,
 *   ordinal?: number, difficultyConfig?: object|number }} world
 * @returns {object|null} the unit (hasActed false), or null when the Skeleton class or
 *   an Iron weapon is missing from the data
 */
export function buildRaisedSkeleton(necromancer, tile, world) {
  const { classes, weapons, seed, turn, ordinal = 0, difficultyConfig = 1.0 } = world;
  const classData = (classes || []).find((c) => c?.name === SKELETON_CLASS);
  if (!classData || typeof necromancer?.battleEntityId !== 'string') return null;
  const key = raiseKey(necromancer, turn, ordinal);
  const rng = keyedBattleRandom(Number(seed) >>> 0, key);

  // The weapon first (one draw), then the unit's growths and level-ups.
  const armed = parseWeaponProficiencies(classData.weaponProficiencies)
    .map((prof) => ironWeaponOfType(weapons, prof.type))
    .filter(Boolean);
  if (armed.length === 0) return null;
  const weapon = structuredClone(armed[Math.floor(rng() * armed.length)]);
  // A uid from the key, not the global counter: the same raise replays the same item.
  weapon.uid = `itm_${key.replace(/[^a-zA-Z0-9]+/g, '_')}`;

  const unit = createUnit(classData, skeletonLevelFor(necromancer), weapons, {
    rng,
    faction: 'enemy',
    col: tile.col,
    row: tile.row,
  });
  unit.weapon = weapon;
  unit.inventory = [weapon];
  unit.consumables = [];
  unit.accessory = null;
  unit.isBoss = false;
  unit.isElite = false;
  unit._hitByPlayerThisPhase = false;
  unit._raisedBy = necromancer.battleEntityId;
  unit.hasMoved = false;
  unit.hasActed = false;
  applyEnemyDifficultyModifiers(unit, difficultyConfig);
  return unit;
}

/**
 * Raise `necromancer`'s next Skeleton: its tile and the unit, or null (no free passable
 * neighbour, or the data lacks the class). The caller places the unit on its roster.
 * @param {object} necromancer
 * @param {{ enemyUnits: object[], cols: number, rows: number,
 *   isOccupied: (col: number, row: number) => boolean,
 *   moveCostAt: (col: number, row: number, moveType: string) => (number|string|null|undefined),
 *   classes: object[], weapons: object[], seed: number, turn: number,
 *   difficultyConfig?: object|number }} world
 * @returns {{ unit: object, tile: { col: number, row: number } }|null}
 */
export function raiseFor(necromancer, world) {
  const tile = raiseTile(necromancer, world);
  if (!tile) return null;
  const ordinal = skeletonsOf(necromancer, world.enemyUnits).length;
  const unit = buildRaisedSkeleton(necromancer, tile, { ...world, ordinal });
  return unit ? { unit, tile } : null;
}

/**
 * A Necromancer fell: take its Skeletons (and only its own) off `enemyUnits`, in place.
 * A crumble is a removal with no killer, so the caller grants no gold and no XP. A Skeleton
 * already on its way out through its own removal is left to that.
 * @returns {object[]} the crumbled Skeletons, in roster order
 */
export function crumbleFor(necromancer, enemyUnits) {
  const id = necromancer?.battleEntityId;
  if (!isNecromancer(necromancer) || typeof id !== 'string' || !Array.isArray(enemyUnits))
    return [];
  const crumbled = enemyUnits.filter(
    (unit) => unit !== necromancer && unit._raisedBy === id && !unit._removing,
  );
  for (const unit of crumbled) enemyUnits.splice(enemyUnits.indexOf(unit), 1);
  return crumbled;
}
