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
//     A Necromancer raises at most MAX_RAISES_PER_NECROMANCER (6) in a battle in all, however
//     many stand: `_raisedCount` on the Necromancer counts them.
//   - THE SKELETON. A base-class Skeleton at the Necromancer's level less 4 (never below 1;
//     its XP-effective level, so an Act IV Necromancer's Skeleton is level 8 to 14). Its
//     weapon (an Iron sword, lance or bow), growths and level-ups come from its own keyed
//     stream,
//     `keyedBattleRandom(battleSeed, 'raise:<necromancer id>:<turn>:<n>')`, never the
//     battle's `Math.random`: a raise leaves the battle stream where it was, and a resume
//     or rewind that replays the phase raises the same Skeleton. `_raisedBy` links it to
//     its Necromancer's `battleEntityId`, which survives saves and rewinds.
//   - REWARDS. `isRaisedUnit` (engine/ConjuredUnits.js, re-exported here), read through
//     `isConjuredUnit` by ReinforcementSpawns, BattleXp and EnemyCarry: no gold, a quarter of
//     the XP, no survival XP, no deed record, never a carrier.
//   - CRUMBLING. When a Necromancer falls, `crumbleFor` takes its own Skeletons off the
//     board with no killer: no gold, no XP. It runs before the battle-end check, so a rout
//     completes when the Necromancer was the last living foe.
//
// Raised units are ordinary enemies otherwise (serialization, rewind and the rout rule are
// untouched). Reinforcement templates never copy a Necromancer or a Skeleton
// (`isNecromancyClass`: the raising rules) nor any class in `isNeverCopiedClass`, which also
// holds Act V's Circle Adept and Hollowed.

import { NECROMANCER_RAISE_CAP } from '../utils/constants.js';
import { keyedBattleRandom } from './BattleRng.js';
import { RAISED_XP_MULTIPLIER, isRaisedUnit } from './ConjuredUnits.js';
import { riseTile } from './ZombieRemains.js';
import {
  applyEnemyDifficultyModifiers,
  createUnit,
  getXpEffectiveLevel,
  parseWeaponProficiencies,
} from './UnitManager.js';

export const NECROMANCER_CLASS = 'Necromancer';
export const SKELETON_CLASS = 'Skeleton';

/** A Necromancer keeps this many living Skeletons; below it, the next phase raises one. */
export const MAX_SKELETONS_PER_NECROMANCER = 2;
/** In all, a Necromancer raises this many in a battle (constants.js; then it raises no more). */
export const MAX_RAISES_PER_NECROMANCER = NECROMANCER_RAISE_CAP;
/** A Skeleton's level is its Necromancer's less this (never below 1). */
export const SKELETON_LEVEL_OFFSET = 4;
/** A raised unit pays this share of the XP its level would (gold: none; ConjuredUnits.js). */
export { RAISED_XP_MULTIPLIER, isRaisedUnit };

/**
 * The classes that exist only through a Necromancer on the map: a Necromancer is placed by
 * the map generator (one per battle) and a Skeleton only by a raise, so no scripted wave may
 * name one either.
 */
const NECROMANCY_CLASSES = new Set([NECROMANCER_CLASS, SKELETON_CLASS]);

/** True for the Necromancer and the Skeleton: the classes the raising rules (above) are about. */
export function isNecromancyClass(className) {
  return NECROMANCY_CLASSES.has(className);
}

export const CIRCLE_ADEPT_CLASS = 'Circle Adept';
export const HOLLOWED_CLASS = 'Hollowed';

/**
 * The enemy-only classes no copying path may produce: an arrival's template pool (a map
 * spawn copied, the act pool, a promoted ladder wave) and an arena entrant. The Necromancer
 * and Skeleton exist through the raise, the Circle Adept and the Hollowed through an authored
 * Act V set piece and its summoning (docs/specs/act-v-descent.md §5). A scripted wave that NAMES
 * a class is not a copy (`isNecromancyClass` alone keeps the raising classes out of those), so
 * a set piece's own waves may field Hollowed.
 */
const NEVER_COPIED_CLASSES = new Set([
  NECROMANCER_CLASS,
  SKELETON_CLASS,
  CIRCLE_ADEPT_CLASS,
  HOLLOWED_CLASS,
  // The Entity's Grasping Limb (engine/EntityKit.js): it rises only from a strike on the Entity.
  'Grasping Limb',
]);

/** True for a class an arrival template or an arena bout may never copy or draw. */
export function isNeverCopiedClass(className) {
  return NEVER_COPIED_CLASSES.has(className);
}

export function isNecromancer(unit) {
  return unit?.className === NECROMANCER_CLASS;
}

/** How many Skeletons `necromancer` has raised so far this battle (saved on the unit). */
export function raisedCountOf(necromancer) {
  return Math.max(0, Math.trunc(Number(necromancer?._raisedCount) || 0));
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
 * The Necromancers that raise this phase, in `enemyUnits` order: living, under their
 * lifetime cap, and fielding fewer than MAX_SKELETONS_PER_NECROMANCER living Skeletons of
 * their own. Decided from the
 * board as it stands, so each Necromancer's count ignores the others' raises.
 */
export function raisers(enemyUnits) {
  return (enemyUnits || []).filter(
    (unit) =>
      isNecromancer(unit) &&
      alive(unit) &&
      typeof unit.battleEntityId === 'string' &&
      raisedCountOf(unit) < MAX_RAISES_PER_NECROMANCER &&
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
 * The Skeleton's level for this Necromancer: its XP-effective level (a promoted unit counts
 * 12 more, as every level comparison in the game does) less SKELETON_LEVEL_OFFSET, never
 * below 1. A promoted Act IV Necromancer's Skeleton sits a little below the act's base foes
 * (docs/specs/phase3.md 3I; tests/sim/NecromancerXp.test.js).
 */
export function skeletonLevelFor(necromancer) {
  return Math.max(1, getXpEffectiveLevel(necromancer) - SKELETON_LEVEL_OFFSET);
}

/** The keyed-stream key of the raise `ordinal` (how many it already fields) on `turn`. */
export function raiseKey(necromancer, turn, ordinal) {
  return `raise:${necromancer.battleEntityId}:${Math.max(1, Math.trunc(Number(turn) || 1))}:${ordinal}`;
}

/** The plain Iron weapon of a type (no special: never a Javelin or Hand Axe). Vigil.js too. */
export const ironWeaponOfType = (weapons, type) =>
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
 * neighbour, or the data lacks the class). The caller places the unit on its roster; a
 * successful raise counts toward the Necromancer's lifetime cap (`_raisedCount`).
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
  if (!unit) return null;
  // The lifetime count rides the Necromancer (serializeBattleUnit keeps it, so a suspend
  // restores it and a rewind takes it back with the Skeleton).
  necromancer._raisedCount = raisedCountOf(necromancer) + 1;
  return { unit, tile };
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
