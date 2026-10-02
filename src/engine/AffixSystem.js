// AffixSystem.js — Pure affix logic evaluation (no Phaser dependencies)
// Similar to SkillSystem.js but for randomized enemy modifiers.

import { gridDistance, thornsReflectDamage } from './Combat.js';
import { applyCondition } from './StatusConditionSystem.js';
export { affixForecastNotes } from './AffixForecast.js';

function getAffix(affixId, affixData) {
  return affixData?.affixes?.find((a) => a.id === affixId) || null;
}

/**
 * Gather stat modifiers from affixes for a unit entering combat.
 * @param {object} unit
 * @param {object} opponent
 * @param {Array} allAllies
 * @param {object} affixData
 * @param {object} terrain
 * @returns {object} flat modifiers
 */
export function getAffixCombatMods(unit, opponent, allAllies, affixData, terrain) {
  const mods = {
    atkBonus: 0,
    defBonus: 0,
    resBonus: 0,
    hitBonus: 0,
    avoidBonus: 0,
    terrainDefBonus: 0,
    immuneToDisplacement: false,
    activated: [], // [{id, name}] for UI
  };

  if (!affixData || !unit || !Array.isArray(unit.affixes)) return mods;
  const allies = Array.isArray(allAllies) ? allAllies : [];

  for (const aid of unit.affixes) {
    const affix = getAffix(aid, affixData);
    if (!affix) continue;

    if (affix.trigger === 'passive') {
      const fx = affix.effects;
      if (fx.atkBonus) mods.atkBonus += fx.atkBonus;
      if (fx.defPenalty) mods.defBonus += fx.defPenalty; // negative
      if (fx.immuneToDisplacement) mods.immuneToDisplacement = true;
      if (fx.terrainDefBonus && terrain && fx.terrainDefBonus[terrain.name]) {
        mods.terrainDefBonus += fx.terrainDefBonus[terrain.name];
      }
      mods.activated.push({ id: affix.id, name: affix.name });
    }
  }

  // Aura buffs from allies
  for (const ally of allies) {
    if (ally === unit || !Array.isArray(ally.affixes) || ally.currentHP <= 0) continue;
    for (const aid of ally.affixes) {
      const affix = getAffix(aid, affixData);
      if (!affix || affix.trigger !== 'passive-aura') continue;

      const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
      if (dist <= (affix.range || 0) && affix.effects) {
        if (affix.effects.atkBonus) mods.atkBonus += affix.effects.atkBonus;
        if (!mods.activated.some((entry) => entry.id === affix.id))
          mods.activated.push({ id: affix.id, name: affix.name });
      }
    }
  }

  return mods;
}

/**
 * Anchored: a passive affix that keeps its holder on its tile whatever moves it
 * (Shove, Pull, and weapon-art push, swap and ram alike).
 */
export function isDisplacementImmune(unit, affixData) {
  if (!affixData || !Array.isArray(unit?.affixes)) return false;
  return unit.affixes.some((aid) => {
    const affix = getAffix(aid, affixData);
    return affix?.trigger === 'passive' && affix.effects?.immuneToDisplacement === true;
  });
}

/**
 * Roll on-defend affix effects (Shielded, Teleporter, Thorns).
 * Damage-changing affixes (Shielded) settle first, whatever order the affixes were
 * rolled in, so the reactions (Thorns, Teleporter) read the damage actually taken.
 * @param {object} defender
 * @param {number} damage
 * @param {boolean} isMelee
 * @param {boolean} isFirstHitPerPhase
 * @param {object} affixData
 * @returns {object} { modifiedDamage, reflectDamage, warpRange, activated: [] }
 */
export function rollDefenseAffixes(defender, damage, isMelee, isFirstHitPerPhase, affixData) {
  const result = {
    modifiedDamage: damage,
    reflectDamage: 0,
    warpRange: 0,
    activated: [],
  };

  if (!affixData || !defender || !Array.isArray(defender.affixes)) return result;

  const onDefend = defender.affixes
    .map((aid) => [aid, getAffix(aid, affixData)])
    .filter(([, affix]) => affix?.trigger === 'on-defend');

  // 1. Damage changes. Shielded: negate first hit per phase.
  for (const [aid, affix] of onDefend) {
    if (aid === 'shielded' && isFirstHitPerPhase) {
      result.modifiedDamage = 0;
      result.activated.push({ id: aid, name: affix.name });
    }
  }

  // 2. Reactions to the damage taken.
  for (const [aid, affix] of onDefend) {
    // Thorns: reflect a share of an adjacent hit, rounded down (a 0 reflect is no proc).
    if (aid === 'thorns' && isMelee && result.modifiedDamage > 0) {
      const reflect = thornsReflectDamage(
        result.modifiedDamage,
        Number(affix.effects?.reflectMeleePct) || 0,
      );
      if (reflect > 0) {
        result.reflectDamage = reflect;
        result.activated.push({ id: aid, name: affix.name });
      }
    }

    // Teleporter: warp after taking damage (once per combat, cancels remaining strikes)
    if (aid === 'teleporter' && result.modifiedDamage > 0 && !defender._teleportUsedThisCombat) {
      result.warpRange = affix.effects?.warpRange || 0;
      if (result.warpRange > 0) defender._teleportUsedThisCombat = true;
      result.activated.push({ id: aid, name: affix.name });
    }
  }

  return result;
}

/**
 * Gather on-attack affix effects (Venomous, Corrosive, Grievous).
 * @param {object} attacker
 * @param {object} affixData
 * @returns {object} { poisonDamage, debuffStat, debuffValue, inflictStatus, statusTurns,
 *   activated: [] }
 */
export function getAttackAffixes(attacker, affixData) {
  const result = {
    poisonDamage: 0,
    debuffStat: null,
    debuffValue: 0,
    inflictStatus: null,
    statusTurns: 0,
    activated: [],
  };

  if (!affixData || !attacker.affixes) return result;

  for (const aid of attacker.affixes) {
    const affix = getAffix(aid, affixData);
    if (!affix || affix.trigger !== 'on-attack') continue;

    if (affix.effects?.poisonDamage) {
      result.poisonDamage += affix.effects.poisonDamage;
      result.activated.push({ id: aid, name: affix.name });
    }

    if (affix.effects?.debuffStat) {
      result.debuffStat = affix.effects.debuffStat;
      result.debuffValue = affix.effects.debuffValue;
      result.activated.push({ id: aid, name: affix.name });
    }

    if (affix.effects?.inflictStatus) {
      result.inflictStatus = affix.effects.inflictStatus;
      result.statusTurns = Math.max(1, Math.trunc(Number(affix.effects.statusTurns) || 1));
      result.activated.push({ id: aid, name: affix.name });
    }
  }

  return result;
}

/**
 * Apply an on-attack status (Grievous: Wounded) to the unit that was hit. It lasts
 * `statusTurns` of the target's own turns (+1: the phase in progress does not count).
 * Returns whether it took (a status-immune unit shrugs it off).
 */
export function applyGrievousStatus(target, affixResult) {
  if (!target || !affixResult?.inflictStatus) return false;
  return applyCondition(target, affixResult.inflictStatus, affixResult.statusTurns + 1, {
    recoveryChance: 0,
  });
}

/**
 * Gather turn-start affix effects (Regenerator, Waller).
 */
export function getTurnStartAffixes(units, affixData) {
  const effects = [];
  if (!affixData || !units) return effects;

  for (const unit of units) {
    if (!unit.affixes) continue;
    for (const aid of unit.affixes) {
      const affix = getAffix(aid, affixData);
      if (!affix || affix.trigger !== 'on-turn-start') continue;

      if (affix.effects?.healSelfPct) {
        const healAmt = Math.floor(unit.stats.HP * affix.effects.healSelfPct);
        if (unit.currentHP < unit.stats.HP) {
          effects.push({
            type: 'heal',
            target: unit,
            amount: Math.min(healAmt, unit.stats.HP - unit.currentHP),
            source: affix.name,
          });
        }
      }

      if (affix.effects?.spawnTerrain) {
        effects.push({
          type: 'spawn_terrain',
          sourceUnit: unit,
          terrainType: affix.effects.spawnTerrain,
          duration: affix.effects.terrainDuration,
          range: affix.effects.terrainRange,
          source: affix.name,
        });
      }
    }
  }
  return effects;
}

/**
 * Gather on-death affix effects (Deathburst).
 */
export function getOnDeathAffixes(unit, affixData) {
  const effects = [];
  if (!affixData || !unit.affixes) return effects;

  for (const aid of unit.affixes) {
    const affix = getAffix(aid, affixData);
    if (!affix || affix.trigger !== 'on-death') continue;

    if (affix.effects?.aoeDamage) {
      effects.push({
        type: 'aoe_damage',
        sourceUnit: unit,
        amount: affix.effects.aoeDamage,
        range: affix.range || 1,
        source: affix.name,
      });
    }
  }
  return effects;
}

/**
 * Get total MOV bonus from passive affixes (applied at spawn, not combat-time).
 * @param {string[]} affixIds
 * @param {object} affixData
 * @returns {number}
 */
export function getAffixMovBonus(affixIds, affixData) {
  if (!affixData?.affixes || !Array.isArray(affixIds)) return 0;
  let total = 0;
  for (const aid of affixIds) {
    const affix = getAffix(aid, affixData);
    if (!affix || affix.trigger !== 'passive') continue;
    if (affix.effects?.movBonus) total += affix.effects.movBonus;
  }
  return total;
}

/**
 * Find valid warp tiles for Teleporter affix.
 * Returns { col, row, distToAttacker }[] representing candidates at the MAXIMUM valid distance.
 */
/** Settle a Teleporter move with one draw iff a legal destination exists. */
export function settleTeleporterWarp({
  unit,
  range,
  attacker,
  grid,
  getUnitAt,
  random = Math.random,
}) {
  const candidates = getWarpCandidates(unit, range, attacker, grid, getUnitAt);
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(random() * candidates.length)];
  const from = { col: unit.col, row: unit.row };
  unit.col = pick.col;
  unit.row = pick.row;
  return { unit, from, to: { col: pick.col, row: pick.row } };
}

export function getWarpCandidates(unit, range, attacker, grid, getUnitAt) {
  const candidates = [];
  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (Math.abs(dr) + Math.abs(dc) > range) continue;
      const col = unit.col + dc;
      const row = unit.row + dr;
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue;
      if (getUnitAt(col, row)) continue;
      if (grid.getMoveCost(col, row, unit.moveType) === Infinity) continue;
      const distToAttacker = gridDistance(col, row, attacker.col, attacker.row);
      candidates.push({ col, row, distToAttacker });
    }
  }

  if (candidates.length === 0) return [];
  // Sort by distance descending
  candidates.sort((a, b) => b.distToAttacker - a.distToAttacker);
  const maxDist = candidates[0].distToAttacker;
  return candidates.filter((c) => c.distToAttacker === maxDist);
}
