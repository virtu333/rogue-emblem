// SurvivorsUnits.js — stats for Darkest Before Dawn, read from the game's own data: a lord's
// base stats and growths (class growth ranges plus the lord's personal growths), a foe's stats
// at a level (class base + mid growth per level), the weapon a class carries, the level-up
// roll (with the same no-blank guard a battle level-up has) and the strike formula. Pure.

export const GROWN_STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];

const IRON_BY_TYPE = {
  Swords: 'Iron Sword',
  Lances: 'Iron Lance',
  Axes: 'Iron Axe',
  Bows: 'Iron Bow',
  Tomes: 'Fire',
  Light: 'Glimmer',
};
// Seasoned foes (level 10 and up, or promoted) carry steel, as later acts' foes do.
const STEEL_BY_TYPE = {
  Swords: 'Steel Sword',
  Lances: 'Steel Lance',
  Axes: 'Steel Axe',
  Bows: 'Steel Bow',
  Tomes: 'Wildfire',
  Light: 'Brilliance',
};
const STEEL_FROM_LEVEL = 10;
const MAGIC_TYPES = new Set(['Tome', 'Light']);
const RANGED_TYPES = new Set(['Bows', 'Tomes', 'Light']);

// The weapon triangle: Swords beat Axes, Axes beat Lances, Lances beat Swords.
const TRIANGLE = { Sword: 'Axe', Axe: 'Lance', Lance: 'Sword' };

/** The middle of a "55-70" growth range, as a whole percent. */
export function midGrowth(range) {
  const [lo, hi] = String(range || '0')
    .split('-')
    .map((n) => Number(n) || 0);
  return Math.round((lo + (hi ?? lo)) / 2);
}

export function classByName(gameData, name) {
  return (gameData.classes || []).find((c) => c.name === name) || null;
}

export function weaponByName(gameData, name) {
  return (gameData.weapons || []).find((w) => w.name === name) || null;
}

/** "Swords (P), Bows (P)" -> ['Swords', 'Bows']. */
export function proficiencyTypes(proficiencies) {
  return String(proficiencies || '')
    .split(',')
    .map((p) => p.replace(/\(.*\)/, '').trim())
    .filter(Boolean);
}

/** A lord as the mode plays them: stats, growths, move type and first weapon type. */
export function lordProfile(gameData, lordName) {
  const lord = (gameData.lords || []).find((l) => l.name === lordName);
  if (!lord) return null;
  const cls = classByName(gameData, lord.class);
  const growths = {};
  for (const stat of GROWN_STATS)
    growths[stat] = midGrowth(cls?.growthRanges?.[stat]) + (lord.personalGrowths?.[stat] || 0);
  return {
    name: lord.name,
    className: lord.class,
    moveType: lord.moveType || cls?.moveType || 'Infantry',
    stats: { ...lord.baseStats },
    growths,
    weaponTypes: proficiencyTypes(lord.weapon),
  };
}

/**
 * A foe of a class at a level: class base stats plus the middle growth for each level past 1.
 * A promoted class is its base class at level `promotionBaseLevel` plus the promotion bonuses
 * (and growth bonuses) and the levels past it, as the battle's promoted foes are made, so a
 * level is on one scale whichever class it is.
 */
export function enemyProfile(gameData, className, level, { promotionBaseLevel = 12 } = {}) {
  const cls = classByName(gameData, className);
  if (!cls) return null;
  const promoted = cls.tier === 'promoted' ? classByName(gameData, cls.promotesFrom) : null;
  if (cls.tier === 'promoted' && !promoted) return null;
  const baseCls = promoted || cls;
  const baseLevels = promoted ? Math.min(level, promotionBaseLevel) - 1 : level - 1;
  const promotedLevels = promoted ? Math.max(0, level - promotionBaseLevel) : 0;
  const stats = {};
  for (const stat of [...GROWN_STATS, 'MOV']) {
    const base =
      (Number(baseCls.baseStats?.[stat]) || 0) +
      (promoted ? Number(cls.promotionBonuses?.[stat]) || 0 : 0);
    const growth = stat === 'MOV' ? 0 : midGrowth(baseCls.growthRanges?.[stat]);
    const bonus = stat === 'MOV' || !promoted ? 0 : Number(cls.growthBonuses?.[stat]) || 0;
    stats[stat] =
      base +
      Math.round(
        (growth / 100) * Math.max(0, baseLevels) + ((growth + bonus) / 100) * promotedLevels,
      );
  }
  const types = proficiencyTypes(cls.weaponProficiencies || baseCls.weaponProficiencies);
  const weaponType = types.find((t) => IRON_BY_TYPE[t]) || null;
  const table = promoted || level >= STEEL_FROM_LEVEL ? STEEL_BY_TYPE : IRON_BY_TYPE;
  const weapon = weaponType ? weaponByName(gameData, table[weaponType]) : null;
  return {
    className,
    level,
    moveType: cls.moveType || baseCls.moveType || 'Infantry',
    stats,
    weapon,
    magic: Boolean(weapon && MAGIC_TYPES.has(weapon.type)),
    ranged: Boolean(weaponType && RANGED_TYPES.has(weaponType)),
  };
}

/** +triangle on advantage, -triangle on disadvantage, 0 otherwise. */
export function triangleBonus(attackerType, defenderType, amount) {
  if (!attackerType || !defenderType) return 0;
  if (TRIANGLE[attackerType] === defenderType) return amount;
  if (TRIANGLE[defenderType] === attackerType) return -amount;
  return 0;
}

/**
 * One strike: (STR or MAG + Might) - DEF or RES, never below 1, the triangle's bonus
 * applied; a crit is three times the blow. `critChance` is a 0..1 chance; one draw decides it.
 */
export function strike(
  { power, might, defense, triangle = 0, critChance = 0, damageScale = 1 },
  rng,
) {
  const base = Math.max(1, Math.round((power + might + triangle - defense) * damageScale));
  const crit = critChance > 0 && rng() < critChance;
  return { damage: crit ? base * 3 : base, crit };
}

/** Crit chance (0..1): SKL / 2 + weapon crit + bonus - the foe's LCK. */
export function critChanceOf(skl, weaponCrit, bonus, foeLck) {
  const pct = Math.floor(skl / 2) + (weaponCrit || 0) + (bonus || 0) - (foeLck || 0);
  return Math.max(0, Math.min(100, pct)) / 100;
}

/**
 * A level-up's gains from growths (percent; past 100 is a sure point plus the rest as a
 * chance). One draw per stat, in GROWN_STATS order. A level that would gain nothing gives the
 * stat whose roll came closest instead, as battle level-ups do.
 */
export function rollLevelGains(growths, rng) {
  const gains = {};
  let closest = null;
  let total = 0;
  for (const stat of GROWN_STATS) {
    const g = Math.max(0, growths[stat] || 0);
    const sure = Math.floor(g / 100);
    const chance = (g % 100) / 100;
    const roll = rng();
    const gain = sure + (roll < chance ? 1 : 0);
    gains[stat] = gain;
    total += gain;
    if (chance > 0) {
      const miss = roll - chance;
      if (!closest || miss < closest.miss) closest = { stat, miss };
    }
  }
  if (total === 0 && closest) gains[closest.stat] = 1;
  return gains;
}
