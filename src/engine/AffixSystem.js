// AffixSystem.js — Pure affix logic evaluation (no Phaser dependencies)
// Similar to SkillSystem.js but for randomized enemy modifiers.

import { gridDistance } from './Combat.js';

function getAffix(affixId, affixData) {
  return affixData?.affixes?.find(a => a.id === affixId) || null;
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
    movBonus: 0,
    terrainDefBonus: 0,
    immuneToDisplacement: false,
    activated: [], // [{id, name}] for UI
  };

  if (!affixData || !unit.affixes) return mods;

  for (const aid of unit.affixes) {
    const affix = getAffix(aid, affixData);
    if (!affix) continue;

    if (affix.trigger === 'passive') {
      const fx = affix.effects;
      if (fx.atkBonus) mods.atkBonus += fx.atkBonus;
      if (fx.defPenalty) mods.defBonus += fx.defPenalty; // negative
      if (fx.movBonus) mods.movBonus += fx.movBonus;
      if (fx.immuneToDisplacement) mods.immuneToDisplacement = true;
      if (fx.terrainDefBonus && terrain && fx.terrainDefBonus[terrain.name]) {
        mods.terrainDefBonus += fx.terrainDefBonus[terrain.name];
      }
      mods.activated.push({ id: affix.id, name: affix.name });
    }
  }

  // Aura buffs from allies
  for (const ally of allAllies) {
    if (ally === unit || !ally.affixes) continue;
    for (const aid of ally.affixes) {
      const affix = getAffix(aid, affixData);
      if (!affix || affix.trigger !== 'passive-aura') continue;

      const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
      if (dist <= (affix.range || 0) && affix.effects) {
        if (affix.effects.atkBonus) mods.atkBonus += affix.effects.atkBonus;
        // Don't add to activated list here (ally's aura)
      }
    }
  }

  return mods;
}

/**
 * Roll on-defend affix effects (Shielded, Teleporter, Thorns).
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

  if (!affixData || !defender.affixes) return result;

  for (const aid of defender.affixes) {
    const affix = getAffix(aid, affixData);
    if (!affix || affix.trigger !== 'on-defend') continue;

    // Shielded: negate first hit per phase
    if (aid === 'shielded' && isFirstHitPerPhase) {
      result.modifiedDamage = 0;
      result.activated.push({ id: aid, name: affix.name });
    }

    // Thorns: reflect melee damage taken (only if Shielded didn't negate it)
    if (aid === 'thorns' && isMelee && result.modifiedDamage > 0) {
      const reflectPct = affix.effects?.reflectMeleePct || 0;
      result.reflectDamage = Math.floor(result.modifiedDamage * reflectPct);
      result.activated.push({ id: aid, name: affix.name });
    }

    // Teleporter: warp after taking damage (condition: after_taking_damage)
    if (aid === 'teleporter' && result.modifiedDamage > 0) {
      result.warpRange = affix.effects?.warpRange || 0;
      result.activated.push({ id: aid, name: affix.name });
    }
  }

  return result;
}

/**
 * Gather on-attack affix effects (Venomous, Corrosive).
 * @param {object} attacker
 * @param {object} affixData
 * @returns {object} { poisonDamage, debuffStat, debuffValue, activated: [] }
 */
export function getAttackAffixes(attacker, affixData) {
  const result = {
    poisonDamage: 0,
    debuffStat: null,
    debuffValue: 0,
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
  }

  return result;
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
          effects.push({ type: 'heal', target: unit, amount: Math.min(healAmt, unit.stats.HP - unit.currentHP), source: affix.name });
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
