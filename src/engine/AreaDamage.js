// AreaDamage — who an area weapon art hits and how hard (docs/specs/aoe-weapon-arts.md
// §2.2-2.3). Pure and RNG-free: execution (PostCombatEffects), the preview and the enemy
// AI all call the same planner, each with the units it may see.
//
// An area blow is the art's own strike against each victim: the attacker's flat combat
// mods (skills, accessories, art, imbue, timed buffs), the victim's own DEF or RES,
// terrain, weapon-triangle matchup and weapon stat bonuses. It always lands, never crits,
// strike skills never trigger on it, and its effectiveness stops at 3× (only the primary
// target of a combat can reach the 5× cap).

import { strikeDamage } from './Combat.js';
import { areaTilesFor, unitsOnTiles } from './AreaShapes.js';
import { timedBuffCombatMods } from './TimedWeaponArtBuffs.js';

/** Weapon/art effectiveness an area blow can reach (owner decision 2026-10-01). */
export const AREA_EFFECTIVENESS_CAP = 3;

const isLive = (unit) => Boolean(unit) && !unit._removing && Number(unit.currentHP) > 0;

/** The board an area shape reads: size, and walls nothing crosses (impassable to fliers). */
export function areaBounds(world) {
  return {
    cols: world?.cols ?? 0,
    rows: world?.rows ?? 0,
    isSolid: (col, row) =>
      typeof world?.getMoveCost === 'function' &&
      !Number.isFinite(world.getMoveCost(col, row, 'Flying')),
  };
}

/**
 * One blow of `area` from `source` on `victim` (before any HP floor), struck with
 * `weapon` (the art's weapon; the equipped one when not given).
 */
export function areaBlowDamage(source, victim, area, strikeMods, world, weapon = source?.weapon) {
  const damage = area?.damage;
  if (!damage || !source || !victim) return 0;
  if (damage.kind === 'fixed') return Math.max(0, Math.trunc(damage.amount) || 0);
  const buffs = timedBuffCombatMods(victim);
  const terrain = world?.getTerrainAt?.(victim.col, victim.row) ?? null;
  let blow = strikeDamage(
    source,
    weapon,
    victim,
    victim.weapon || null,
    terrain,
    strikeMods,
    { defBonus: buffs.defBonus, resBonus: buffs.resBonus },
    { effectivenessCap: AREA_EFFECTIVENESS_CAP },
  );
  // One of a multi-hit art's strikes carries that art's per-strike factor.
  const multiHit = strikeMods?.multiHit;
  if (blow > 0 && multiHit?.damageMultiplier > 0 && multiHit.damageMultiplier < 1)
    blow = Math.max(1, Math.floor(blow * multiHit.damageMultiplier));
  return Math.max(0, Math.floor(blow * (Number(damage.multiplier) || 0)));
}

function lowestHpPctFirst(a, b) {
  const aPct = (Number(a.currentHP) || 0) / Math.max(1, Number(a.stats?.HP) || 1);
  const bPct = (Number(b.currentHP) || 0) / Math.max(1, Number(b.stats?.HP) || 1);
  if (aPct !== bPct) return aPct - bPct;
  if (a.row !== b.row) return a.row - b.row;
  if (a.col !== b.col) return a.col - b.col;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

/**
 * The victims of one use of an area art and each one's blow.
 * @param {object} p
 * @param {object} p.source       the art's user
 * @param {object|null} p.primary the combat's target (normal_attack); never a victim
 * @param {object|null} p.center  the chosen tile (chosen_center)
 * @param {object} p.area         a normalized area (WeaponArtSystem.getWeaponArtArea)
 * @param {object[]} p.units      candidate victims: every hostile for execution and the
 *                                AI, only the known ones for a preview
 * @param {object} p.world        { cols, rows, getMoveCost, getTerrainAt? }
 * @param {object|null} p.strikeMods the attacker's merged combat mods
 * @param {object|null} [p.weapon]  the weapon the art strikes with (default: equipped)
 * @returns {{ unit: object, damage: number }[]} in area order
 */
export function planAreaBlows({
  source,
  primary = null,
  center = null,
  area,
  units = [],
  world,
  strikeMods = null,
  weapon = null,
}) {
  if (!source || !area) return [];
  const tiles = areaTilesFor(
    area,
    { attacker: source, target: primary, center },
    areaBounds(world),
  );
  let victims = unitsOnTiles(tiles, (units || []).filter(isLive), { exclude: [primary, source] });
  if (area.pick === 'lowest_hp_pct') victims = [...victims].sort(lowestHpPctFirst);
  if (area.maxTargets > 0) victims = victims.slice(0, area.maxTargets);
  return victims.map((unit) => ({
    unit,
    damage: areaBlowDamage(source, unit, area, strikeMods, world, weapon || source.weapon),
  }));
}
