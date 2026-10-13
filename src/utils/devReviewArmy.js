// The map-template review's army (`?devScene=battle&template=<id>`): the starter roster grown
// to the act's full deploy, at about the levels a run has reached by then, so the shape is
// judged with the foe count a real battle of that act fields (MapGenerator sizes the enemy
// count by the units deployed). Dev routes only: a real run never reads this.
//
// Seeded from the review's seed (keyedBattleRandom), never Math.random, so a link replays.

import { keyedBattleRandom } from '../engine/BattleRng.js';
import {
  applyLevelUpGains,
  createUnit,
  getWeaponByTier,
  levelUp,
  promoteUnit,
} from '../engine/UnitManager.js';
import { ensureItemUid } from './itemUid.js';
import { DEPLOY_LIMITS } from './constants.js';

// The level the run's own units have reached at an act's battles (base class, never promoted here).
const LORD_LEVEL_BY_ACT = { act1: 3, act2: 8, act3: 14, act4: 20 };
// A recruit's weapon tier by act (createUnit hands out the class's default, an Iron one).
const WEAPON_TIER_BY_ACT = { act1: 'Iron', act2: 'Steel', act3: 'Steel', act4: 'Silver' };
// The base level a promoted recruit is built to before it promotes.
const PROMOTE_AT_LEVEL = 10;
const MAX_ARMY = 12;

/** How many units the review army fields: `army` when given (0 keeps the roster), else the act's max deploy. */
export function reviewArmySize(act, army = null) {
  const asked = army === null || army === undefined || army === '' ? NaN : Number(army);
  if (Number.isInteger(asked) && asked >= 0) return Math.min(asked, MAX_ARMY);
  return (DEPLOY_LIMITS[act] || DEPLOY_LIMITS.act1).max;
}

function levelTo(unit, level, rng) {
  while (unit.level < level) {
    const gains = levelUp(unit, rng);
    if (!gains) break;
    applyLevelUpGains(unit, gains);
  }
}

function buildRecruit(classData, level, gameData, rng, name) {
  const { classes, weapons, skills } = gameData;
  let unit;
  if (classData.tier === 'promoted') {
    const base = classes.find((c) => c.name === classData.promotesFrom);
    if (!base) return null;
    unit = createUnit(base, PROMOTE_AT_LEVEL, weapons, { name, rng });
    promoteUnit(unit, classData, classData.promotionBonuses || {}, skills);
    unit.level = 1;
    levelTo(unit, level, rng);
  } else {
    unit = createUnit(classData, level, weapons, { name, rng });
  }
  unit.currentHP = unit.stats.HP;
  return unit;
}

function equipTier(unit, tier, weapons) {
  const weapon = getWeaponByTier(unit.proficiencies, weapons, tier);
  if (!weapon || unit.weapon?.name === weapon.name) return;
  const copy = ensureItemUid(structuredClone(weapon));
  unit.inventory = [copy, ...(unit.inventory || []).filter((w) => w !== unit.weapon)].slice(0, 5);
  unit.weapon = copy;
}

/**
 * Grow `runManager.roster` to the review army: lords levelled to the act, then recruits from
 * the act's recruit pool (recruits.json) at the pool's top level, one class each before any
 * repeats. Returns the units added.
 */
export function addReviewArmy(runManager, { act, seed = 0, army = null } = {}) {
  const gameData = runManager.gameData;
  const size = reviewArmySize(act, army);
  const rng = keyedBattleRandom(Number(seed) >>> 0, `review-army:${act}`);
  const lordLevel = LORD_LEVEL_BY_ACT[act] || 1;
  // The run's own units (the lords and any starter) stand at the lords' level for the act.
  for (const unit of runManager.roster) {
    if (unit.tier === 'promoted') continue;
    levelTo(unit, lordLevel, rng);
    unit.currentHP = unit.stats.HP;
  }
  const pool = gameData.recruits?.[act] || gameData.recruits?.act1;
  const classes = (pool?.classPool || [])
    .map((name) => gameData.classes.find((c) => c.name === name))
    .filter(Boolean);
  const level = pool?.levelRange?.[1] || 1;
  const tier = WEAPON_TIER_BY_ACT[act] || 'Iron';
  // A seeded order of the pool, walked round and round.
  const order = classes
    .map((c) => ({ c, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .map((e) => e.c);
  const taken = new Set(runManager.roster.map((u) => u.name));
  const added = [];
  for (let i = 0; runManager.roster.length < size && order.length && i < MAX_ARMY * 2; i++) {
    const classData = order[i % order.length];
    const names = gameData.recruits?.namePool?.[classData.promotesFrom || classData.name] || [];
    const name =
      names.find((n) => !taken.has(n)) || `${classData.name} ${Math.floor(i / order.length) + 1}`;
    const unit = buildRecruit(classData, level, gameData, rng, name);
    if (!unit) continue;
    equipTier(unit, tier, gameData.weapons);
    taken.add(name);
    runManager.assignUnitUid(unit);
    runManager.roster.push(unit);
    added.push(unit);
  }
  if (added.length) runManager.ensurePortraitVariants();
  return added;
}
