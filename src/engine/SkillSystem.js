// SkillSystem.js — Pure skill evaluation functions (no Phaser dependencies)
// Skills are identified by ID strings stored on unit.skills[].
// All functions take skillsData (from skills.json) for metadata lookup.

import { gridDistance, getConditionalWeaponBonuses, usesMagic } from './Combat.js';
import { getAffixCombatMods } from './AffixSystem.js';
import { isSilenced } from './StatusConditionSystem.js';

// --- Helpers ---

function getSkill(skillId, skillsData) {
  return skillsData.find((s) => s.id === skillId) || null;
}

function isBelow50(unit) {
  return unit.currentHP <= Math.floor(unit.stats.HP / 2);
}

export function getActivationChance(unit, activation) {
  switch (activation) {
    case 'SKL':
      return unit.stats.SKL;
    case 'SKL_HALF':
      return Math.floor(unit.stats.SKL / 2);
    case 'LCK_QUARTER':
      return Math.floor(unit.stats.LCK / 4);
    case 'LCK_THIRD':
      return Math.floor(unit.stats.LCK / 3);
    case 'SPD':
      return unit.stats.SPD;
    case 'LCK':
      return unit.stats.LCK;
    case 'always':
      return 100;
    default:
      return 0;
  }
}

function isWithinSkillRange(source, target, skill) {
  const maxRange = Number(skill?.range ?? 0);
  const minRange = Number(skill?.rangeMin ?? 0);
  if (!Number.isFinite(maxRange) || !Number.isFinite(minRange)) return false;
  if (maxRange < 0 || minRange < 0 || maxRange < minRange) return false;
  const dist = gridDistance(source.col, source.row, target.col, target.row);
  return dist >= minRange && dist <= maxRange;
}

function applyAuraEffects(mods, effects) {
  if (!effects) return;
  mods.hitBonus += effects.hitBonus || 0;
  mods.avoidBonus += effects.avoidBonus || 0;
  mods.atkBonus += effects.atkBonus || 0;
  mods.defBonus += effects.defBonus || 0;
  mods.resBonus += effects.resBonus || 0;
  mods.critBonus += effects.critBonus || 0;
}

function isLivingOnMap(unit) {
  if (!unit || unit.currentHP <= 0) return false;
  return Number.isFinite(Number(unit.col)) && Number.isFinite(Number(unit.row));
}

export function resolveGamblerDelta(unit, rollSession = null, rng = Math.random) {
  const combatEffects = unit?.accessory?.combatEffects;
  const gambler = combatEffects?.gambler || (combatEffects?.gamblerCoin ? {} : null);
  if (!gambler) return 0;

  if (
    rollSession?.gamblerAtkDeltaByUnit instanceof Map &&
    rollSession.gamblerAtkDeltaByUnit.has(unit)
  ) {
    return rollSession.gamblerAtkDeltaByUnit.get(unit);
  }

  const winChance = Math.min(1, Math.max(0, Number(gambler.winChance) || 0.5));
  const winAtkBonus = Math.trunc(Number(gambler.winAtkBonus) || 5);
  const rawLossPenalty = Number(gambler.lossAtkPenalty);
  const lossAtkPenalty = Number.isFinite(rawLossPenalty)
    ? rawLossPenalty > 0
      ? -Math.abs(rawLossPenalty)
      : Math.trunc(rawLossPenalty)
    : -3;
  const roller = typeof rng === 'function' ? rng : Math.random;
  const delta = roller() < winChance ? winAtkBonus : lossAtkPenalty;

  if (rollSession?.gamblerAtkDeltaByUnit instanceof Map) {
    rollSession.gamblerAtkDeltaByUnit.set(unit, delta);
  }
  return delta;
}

export function applyAccessoryPhaseCombatMods(unit, mods, options = {}) {
  if (!unit || !mods) return mods;
  const combatEffects = unit.accessory?.combatEffects;
  if (!combatEffects) return mods;

  if (!Number.isFinite(Number(mods.atkBonus))) mods.atkBonus = 0;
  if (!Number.isFinite(Number(mods.defBonus))) mods.defBonus = 0;

  const turn = Math.max(1, Math.trunc(Number(options.turnNumber) || 1));
  if (combatEffects.moontide) {
    const moontideConfig = typeof combatEffects.moontide === 'object' ? combatEffects.moontide : {};
    const oddAtkBonus = Math.trunc(Number(moontideConfig.oddAtkBonus) || 2);
    const evenDefBonus = Math.trunc(Number(moontideConfig.evenDefBonus) || 2);
    if (turn % 2 === 1) mods.atkBonus += oddAtkBonus;
    else mods.defBonus += evenDefBonus;
  }

  if (combatEffects.gambler || combatEffects.gamblerCoin) {
    mods.atkBonus += resolveGamblerDelta(unit, options.rollSession || null, options.rng);
  }
  return mods;
}

function isAccessoryConditionMet(condition, unit, opponent, allies, enemies, terrain) {
  if (!condition) return true;
  if (condition === 'below50') return isBelow50(unit);
  if (condition === 'above75') return unit.currentHP > Math.floor(unit.stats.HP * 0.75);
  if (condition === 'on_forest') return terrain?.name === 'Forest';
  if (condition === 'adjacent_ally') {
    return allies.some(
      (ally) =>
        ally !== unit &&
        isLivingOnMap(ally) &&
        gridDistance(unit.col, unit.row, ally.col, ally.row) === 1,
    );
  }
  if (condition === 'no_ally_within_2') {
    return !allies.some(
      (ally) =>
        ally !== unit &&
        isLivingOnMap(ally) &&
        gridDistance(unit.col, unit.row, ally.col, ally.row) <= 2,
    );
  }
  if (condition === 'enemies_nearby_2plus') {
    const nearby = enemies.filter(
      (enemy) =>
        enemy !== unit &&
        isLivingOnMap(enemy) &&
        gridDistance(unit.col, unit.row, enemy.col, enemy.row) <= 2,
    ).length;
    return nearby >= 2;
  }
  if (condition === 'on_forest_or_mountain') {
    return terrain?.name === 'Forest' || terrain?.name === 'Mountain';
  }
  if (condition === 'isolated_duel') {
    if (!isLivingOnMap(unit) || !isLivingOnMap(opponent)) return false;
    const others = [...(allies || []), ...(enemies || [])].filter(
      (candidate) =>
        candidate && candidate !== unit && candidate !== opponent && isLivingOnMap(candidate),
    );
    return !others.some(
      (candidate) =>
        gridDistance(unit.col, unit.row, candidate.col, candidate.row) <= 2 ||
        gridDistance(opponent.col, opponent.row, candidate.col, candidate.row) <= 2,
    );
  }
  return true;
}

// --- Static combat modifiers ---

/**
 * Gather all stat modifiers for a unit entering combat.
 * Includes: passive skills, aura buffs from allies, on-combat-start triggers.
 * Returns a flat modifier object applied to combat calculations.
 */
export function getSkillCombatMods(
  unit,
  opponent,
  allAllies,
  allEnemies,
  skillsData,
  terrain,
  isInitiating = false,
  affixData = null,
) {
  const mods = {
    hitBonus: 0,
    avoidBonus: 0,
    critBonus: 0,
    atkBonus: 0,
    defBonus: 0,
    resBonus: 0,
    spdBonus: 0,
    ignoreTerrainAvoid: false,
    vantage: false,
    desperation: false,
    quickRiposte: false,
    preventEnemyDouble: false,
    activated: [], // [{id, name}] for UI display
    // Affix specific fields
    immuneToDisplacement: false,
  };

  // Conditional weapon bonuses — independent of skillsData
  const allies = Array.isArray(allAllies) ? allAllies : [];
  const enemies = Array.isArray(allEnemies) ? allEnemies : [];
  const wpnCond = getConditionalWeaponBonuses(unit.weapon, unit, allies);
  mods.atkBonus += wpnCond.atkBonus;
  mods.spdBonus += wpnCond.spdBonus;

  if (!skillsData) return mods;

  // --- Affix Modifiers ---
  if (affixData) {
    const affixMods = getAffixCombatMods(unit, opponent, allies, affixData, terrain);
    mods.atkBonus += affixMods.atkBonus;
    mods.defBonus += affixMods.defBonus + affixMods.terrainDefBonus;
    mods.resBonus += affixMods.resBonus;
    mods.hitBonus += affixMods.hitBonus;
    mods.avoidBonus += affixMods.avoidBonus;
    mods.immuneToDisplacement = affixMods.immuneToDisplacement;
    if (affixMods.activated.length > 0) {
      mods.activated.push(...affixMods.activated);
    }
  }

  // Combine unit skills + weapon granted skill (deduped)
  const unitSkills = [...(unit.skills || [])];
  const grantedSkill = unit.weapon?._grantedSkill;
  if (grantedSkill && !unitSkills.includes(grantedSkill)) unitSkills.push(grantedSkill);
  // Silenced units contribute no skill effects (but accessory/aura from others still apply)
  const unitSilenced = isSilenced(unit);
  // Unit's own skills + weapon granted skill
  for (const skillId of unitSkills) {
    if (unitSilenced) break;
    const skill = getSkill(skillId, skillsData);
    if (!skill) continue;

    // Passive stat bonuses
    if (skill.trigger === 'passive' && skill.effects) {
      // Check passive conditions
      let passiveCondMet = true;
      if (skill.condition === 'no_adjacent_ally') {
        passiveCondMet = !allies.some(
          (a) => a !== unit && gridDistance(unit.col, unit.row, a.col, a.row) === 1,
        );
      }
      if (passiveCondMet) {
        if (skill.effects.critScalesWithMissingHP) {
          const maxCrit = skill.effects.critScaleMax || 30;
          const maxHp = Math.max(1, unit.stats.HP);
          const missingRatio = 1 - unit.currentHP / maxHp;
          mods.critBonus += Math.min(maxCrit, Math.floor(missingRatio * maxCrit));
        }
        if (skill.effects.critBonus) mods.critBonus += skill.effects.critBonus;
        if (skill.effects.atkBonus) mods.atkBonus += skill.effects.atkBonus;
        if (skill.effects.defBonus) mods.defBonus += skill.effects.defBonus;
        if (skill.effects.resBonus) mods.resBonus += skill.effects.resBonus;
        if (skill.effects.hitBonus) mods.hitBonus += skill.effects.hitBonus;
        if (skill.effects.avoidBonus) mods.avoidBonus += skill.effects.avoidBonus;
        if (skill.effects.ignoreTerrainAvoid) mods.ignoreTerrainAvoid = true;
        if (skill.effects.preventEnemyDouble) mods.preventEnemyDouble = true;
      }
    }

    // On-combat-start conditional skills
    if (skill.trigger === 'on-combat-start') {
      let condMet = !skill.condition;
      if (skill.condition === 'below50') condMet = isBelow50(unit);
      if (skill.condition === 'adjacent_ally') {
        condMet = allies.some(
          (a) => a !== unit && gridDistance(unit.col, unit.row, a.col, a.row) === 1,
        );
      }
      if (skill.condition === 'initiating') condMet = isInitiating;
      if (skill.condition === 'defending') condMet = !isInitiating;
      if (skill.condition === 'above50_defending') {
        condMet = !isInitiating && unit.currentHP > Math.floor(unit.stats.HP / 2);
      }
      if (skill.condition === 'moved_3_plus_initiating') {
        condMet = isInitiating && (unit._movementSpent || 0) >= 3;
      }
      if (condMet) {
        if (skill.id === 'resolve' && skill.effects) {
          mods.atkBonus += skill.effects.strBonus || 0;
          mods.defBonus += skill.effects.defBonus || 0;
          mods.activated.push({ id: skill.id, name: skill.name });
        }
        if (skill.id === 'wrath' && skill.effects) {
          mods.critBonus += skill.effects.critBonus || 0;
          mods.activated.push({ id: skill.id, name: skill.name });
        }
        if (skill.id === 'vantage') {
          mods.vantage = true;
          mods.activated.push({ id: skill.id, name: skill.name });
        }
        if (skill.id === 'desperation') {
          mods.desperation = true;
          mods.activated.push({ id: skill.id, name: skill.name });
        }
        if (skill.id === 'quick_riposte') {
          mods.quickRiposte = true;
          mods.activated.push({ id: skill.id, name: skill.name });
        }
        if (skill.id === 'spell_harmony') {
          const adjacentPlayerAllies = allies.filter(
            (a) =>
              a !== unit &&
              a.faction === 'player' &&
              gridDistance(unit.col, unit.row, a.col, a.row) === 1,
          ).length;
          if (adjacentPlayerAllies > 0) {
            mods.atkBonus += adjacentPlayerAllies * 2;
            mods.activated.push({ id: skill.id, name: skill.name });
          }
        }
        // Generic on-combat-start stat bonuses (Guard, Death Blow, Darting Blow, etc.)
        const specialIds = new Set([
          'resolve',
          'wrath',
          'vantage',
          'desperation',
          'quick_riposte',
          'spell_harmony',
        ]);
        if (!specialIds.has(skill.id) && skill.effects) {
          if (skill.effects.defBonus) mods.defBonus += skill.effects.defBonus;
          if (skill.effects.resBonus) mods.resBonus += skill.effects.resBonus;
          if (skill.effects.atkBonus) mods.atkBonus += skill.effects.atkBonus;
          if (skill.effects.critBonus) mods.critBonus += skill.effects.critBonus;
          if (skill.effects.hitBonus) mods.hitBonus += skill.effects.hitBonus;
          if (skill.effects.avoidBonus) mods.avoidBonus += skill.effects.avoidBonus;
          if (skill.effects.spdBonus) mods.spdBonus += skill.effects.spdBonus;
          mods.activated.push({ id: skill.id, name: skill.name });
        }
      }
    }
  }

  // Aura effects from allies (buffs by default) — silenced units don't project auras
  for (const ally of allies) {
    if (ally === unit || !ally.skills || isSilenced(ally)) continue;
    for (const skillId of ally.skills) {
      const skill = getSkill(skillId, skillsData);
      if (!skill || skill.trigger !== 'passive-aura') continue;
      const auraTarget = skill.auraTarget || 'ally';
      if (auraTarget !== 'ally') continue;
      if (!isWithinSkillRange(ally, unit, skill)) continue;
      applyAuraEffects(mods, skill.effects);
    }
  }

  // Enemy aura effects (debuffs) — silenced enemies don't project auras
  for (const enemy of enemies) {
    if (!enemy || !enemy.skills || isSilenced(enemy)) continue;
    for (const skillId of enemy.skills) {
      const skill = getSkill(skillId, skillsData);
      if (!skill || skill.trigger !== 'passive-aura') continue;
      if (skill.auraTarget !== 'enemy') continue;
      if (!isWithinSkillRange(enemy, unit, skill)) continue;
      applyAuraEffects(mods, skill.effects);
    }
  }

  // Accessory combat effects
  const ce = unit.accessory?.combatEffects;
  if (ce) {
    if (isAccessoryConditionMet(ce.condition, unit, opponent, allies, enemies, terrain)) {
      if (ce.critBonus) mods.critBonus += ce.critBonus;
      if (ce.atkBonus) mods.atkBonus += ce.atkBonus;
      if (ce.defBonus) mods.defBonus += ce.defBonus;
      if (ce.resBonus) mods.resBonus += ce.resBonus;
      if (ce.hitBonus) mods.hitBonus += ce.hitBonus;
      if (ce.avoidBonus) mods.avoidBonus += ce.avoidBonus;
    }
  }

  return mods;
}

// --- Per-strike skill checks ---

/**
 * Roll per-strike skill effects after a hit lands.
 * Returns: { modifiedDamage, heal, lethal, astra, activated: [{id, name}] }
 */
export function rollStrikeSkills(attacker, normalDamage, target, skillsData, combatState = null) {
  const result = {
    modifiedDamage: normalDamage,
    heal: 0,
    lethal: false,
    extraStrike: false,
    activated: [],
  };

  if (!skillsData || isSilenced(attacker)) return result;

  // Combine unit skills + weapon granted skill (deduped)
  const skillIds = [...(attacker.skills || [])];
  const grantedSkill = attacker.weapon?._grantedSkill;
  if (grantedSkill && !skillIds.includes(grantedSkill)) skillIds.push(grantedSkill);
  if (skillIds.length === 0) return result;

  // Resolve one offensive proc per strike with explicit precedence.
  const offensiveProcPriority = {
    aether: 0,
    flare: 1,
    luna: 2,
    sol: 3,
  };
  let selectedOffensiveProcId = null;
  let selectedOffensiveProcPriority = Number.POSITIVE_INFINITY;

  for (const skillId of skillIds) {
    const skill = getSkill(skillId, skillsData);
    if (!skill || skill.trigger !== 'on-attack') continue;

    const chance = getActivationChance(attacker, skill.activation);
    const roll = Math.random() * 100;
    if (roll >= chance) continue;

    const procPriority = offensiveProcPriority[skill.id];
    if (procPriority !== undefined) {
      if (procPriority < selectedOffensiveProcPriority) {
        selectedOffensiveProcPriority = procPriority;
        selectedOffensiveProcId = skill.id;
      }
      continue;
    }

    switch (skill.id) {
      case 'lethality':
        result.lethal = true;
        result.activated.push({ id: 'lethality', name: 'Lethality' });
        break;

      case 'adept':
        if (combatState?.adeptUsed?.has?.(attacker)) break;
        if (combatState) {
          if (!combatState.adeptUsed) combatState.adeptUsed = new Set();
          combatState.adeptUsed.add(attacker);
        }
        result.extraStrike = true;
        result.activated.push({ id: 'adept', name: 'Adept' });
        break;

      case 'commanders_gambit':
        result.commandersGambit = true;
        result.activated.push({ id: 'commanders_gambit', name: "Commander's Gambit" });
        break;

      case 'divine_charge':
        result.divineCharge = {
          percent: skill.effects?.healLowestAlly?.percent || 50,
          range: skill.effects?.healLowestAlly?.range || 3,
        };
        result.activated.push({ id: 'divine_charge', name: 'Divine Charge' });
        break;

      case 'seraph_strike': {
        const defStat = Number(target.stats?.DEF) || 0;
        const resStat = Number(target.stats?.RES) || 0;
        const lowerDef = Math.min(defStat, resStat);
        const normalDef = usesMagic(attacker.weapon) ? resStat : defStat;
        const defBonus = Math.max(0, normalDef - lowerDef);
        result.modifiedDamage = normalDamage + defBonus;
        result.activated.push({ id: 'seraph_strike', name: 'Seraph Strike' });
        break;
      }

      case 'drain':
      case 'zombie_drain': {
        const percent = skill.effects?.drainPercent || 25;
        result.heal = Math.max(1, Math.floor((normalDamage * percent) / 100));
        result.activated.push({ id: skill.id, name: skill.name });
        break;
      }
    }
  }

  if (selectedOffensiveProcId === 'aether') {
    result.heal = normalDamage;
    result.extraStrike = true;
    result.aetherLuna = true;
    result.activated.push({ id: 'aether', name: 'Aether' });
  } else if (selectedOffensiveProcId === 'flare') {
    result.modifiedDamage = normalDamage + (target.stats?.RES || 0);
    result.heal = result.modifiedDamage;
    result.activated.push({ id: 'flare', name: 'Flare' });
  } else if (selectedOffensiveProcId === 'luna') {
    result.modifiedDamage = Math.floor(normalDamage * 1.5);
    result.activated.push({ id: 'luna', name: 'Luna' });
  } else if (selectedOffensiveProcId === 'sol') {
    result.heal = normalDamage;
    result.activated.push({ id: 'sol', name: 'Sol' });
  }

  return result;
}

// --- On-defend skill checks ---

/**
 * Roll defensive skills after damage is calculated but before applying.
 * Handles Pavise (halve physical), Aegis (halve magical), Miracle (survive lethal at 1 HP).
 * Returns { modifiedDamage, miracleTriggered, activated: [{id, name}] }
 */
export function rollDefenseSkills(defender, damage, isPhysicalAttack, skillsData) {
  const result = {
    modifiedDamage: damage,
    miracleTriggered: false,
    cancelFollowUp: false,
    activated: [],
  };

  if (!skillsData || isSilenced(defender)) return result;

  const defSkills = [...(defender.skills || [])];
  const grantedSkill = defender.weapon?._grantedSkill;
  if (grantedSkill && !defSkills.includes(grantedSkill)) defSkills.push(grantedSkill);
  if (defSkills.length === 0) return result;

  for (const skillId of defSkills) {
    const skill = getSkill(skillId, skillsData);
    if (!skill || skill.trigger !== 'on-defend') continue;

    const chance = getActivationChance(defender, skill.activation);
    // Pavise gets a minimum 5% proc floor so it stays relevant on low-SKL units
    const effectiveChance = skill.id === 'pavise' ? Math.max(chance, 5) : chance;
    const roll = Math.random() * 100;
    if (roll >= effectiveChance) continue;

    if (skill.id === 'cancel') {
      result.cancelFollowUp = true;
      result.activated.push({ id: 'cancel', name: 'Cancel' });
    }

    if (skill.id === 'pavise' && isPhysicalAttack) {
      result.modifiedDamage = Math.floor(result.modifiedDamage / 2);
      result.activated.push({ id: 'pavise', name: 'Pavise' });
    }

    if (skill.id === 'aegis' && !isPhysicalAttack) {
      result.modifiedDamage = Math.floor(result.modifiedDamage / 2);
      result.activated.push({ id: 'aegis', name: 'Aegis' });
    }

    if (skill.id === 'dragon_scale') {
      const reduction = skill.effects?.damageReduction || 3;
      result.modifiedDamage = Math.max(0, result.modifiedDamage - reduction);
      result.activated.push({ id: 'dragon_scale', name: 'Dragon Scale' });
    }

    if (skill.id === 'miracle' && !defender._miracleUsed) {
      const wouldDie = defender.currentHP > 0 && defender.currentHP <= result.modifiedDamage;
      if (wouldDie) {
        result.modifiedDamage = defender.currentHP - 1;
        result.miracleTriggered = true;
        defender._miracleUsed = true;
        result.activated.push({ id: 'miracle', name: 'Miracle' });
      }
    }

    if (skill.id === 'intimidate' && skill.effects?.debuffAttacker) {
      result.debuffAttacker = skill.effects.debuffAttacker;
      result.activated.push({ id: 'intimidate', name: 'Intimidate' });
    }
  }

  return result;
}

/**
 * Check if Astra triggers for an attack phase.
 * If triggered, the normal strike count is replaced with 5 at half damage.
 * Returns: { triggered, strikeCount, damageMult, name }
 */
export function checkAstra(attacker, skillsData) {
  if (!skillsData || isSilenced(attacker)) return { triggered: false };

  const hasAstra = attacker.skills?.includes('astra') || attacker.weapon?._grantedSkill === 'astra';
  if (!hasAstra) return { triggered: false };

  const skill = getSkill('astra', skillsData);
  if (!skill) return { triggered: false };

  const chance = getActivationChance(attacker, skill.activation);
  if (Math.random() * 100 >= chance) return { triggered: false };

  return { triggered: true, strikeCount: 5, damageMult: 0.5, name: 'Astra' };
}

// --- Turn-start effects ---

/**
 * Gather all turn-start effects for a set of units.
 * Returns array of effects: [{ type: 'heal', target: unit, amount, source: skillName }]
 */
export function getTurnStartEffects(units, skillsData) {
  const effects = [];

  const resolvedSkillsData = Array.isArray(skillsData) ? skillsData : [];

  for (const unit of units) {
    // Silenced units get no turn-start skill effects
    if (Array.isArray(unit.skills) && !isSilenced(unit)) {
      for (const skillId of unit.skills) {
        const skill = getSkill(skillId, resolvedSkillsData);
        if (!skill || skill.trigger !== 'on-turn-start') continue;

        // Renewal: self-heal 10% max HP
        if (skill.id === 'renewal') {
          const healPercent = skill.effects?.healSelf || 10;
          const healAmount = Math.max(1, Math.floor((unit.stats.HP * healPercent) / 100));
          if (unit.currentHP < unit.stats.HP) {
            const actualHeal = Math.min(healAmount, unit.stats.HP - unit.currentHP);
            effects.push({
              type: 'heal',
              target: unit,
              amount: actualHeal,
              source: skill.name,
              sourceUnit: unit,
            });
          }
        }

        if (skill.id === 'renewal_aura') {
          const healAmount = skill.effects?.healAllies || 0;
          if (healAmount <= 0) continue;

          for (const ally of units) {
            if (ally === unit) continue;
            const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
            if (dist <= (skill.range || 1) && ally.currentHP < ally.stats.HP) {
              const actualHeal = Math.min(healAmount, ally.stats.HP - ally.currentHP);
              effects.push({
                type: 'heal',
                target: ally,
                amount: actualHeal,
                source: skill.name,
                sourceUnit: unit,
              });
            }
          }
        }
      }
    }

    const accessory = unit.accessory;
    const turnStart = accessory?.turnStartEffects;
    const combatEffects = accessory?.combatEffects;
    const hasSoothingStone =
      accessory?.name === 'Soothing Stone' ||
      Number.isFinite(Number(turnStart?.healSelfFlat)) ||
      Number.isFinite(Number(turnStart?.healSelfPercent)) ||
      Number.isFinite(Number(turnStart?.turnStartHealPercent)) ||
      Number.isFinite(Number(combatEffects?.turnStartHealFlat)) ||
      Number.isFinite(Number(combatEffects?.turnStartHealPercent));
    if (!hasSoothingStone) continue;
    if (unit.currentHP >= unit.stats.HP) continue;

    const healPercent = Number.isFinite(Number(turnStart?.healSelfPercent))
      ? Number(turnStart.healSelfPercent)
      : Number.isFinite(Number(turnStart?.turnStartHealPercent))
        ? Number(turnStart.turnStartHealPercent)
        : Number.isFinite(Number(combatEffects?.turnStartHealPercent))
          ? Number(combatEffects.turnStartHealPercent)
          : 20;
    const healFlatRaw = Number.isFinite(Number(turnStart?.healSelfFlat))
      ? Number(turnStart.healSelfFlat)
      : Number.isFinite(Number(combatEffects?.turnStartHealFlat))
        ? Number(combatEffects.turnStartHealFlat)
        : 0;
    const healFlat = Math.max(0, Math.trunc(healFlatRaw || 0));
    const percentComponent =
      healPercent <= 1
        ? Math.floor(unit.stats.HP * Math.max(0, healPercent))
        : Math.floor((unit.stats.HP * Math.max(0, healPercent)) / 100);
    const healAmount = Math.max(1, healFlat + percentComponent);
    const actualHeal = Math.min(healAmount, unit.stats.HP - unit.currentHP);
    if (actualHeal > 0) {
      effects.push({
        type: 'heal',
        target: unit,
        amount: actualHeal,
        source: accessory?.name || 'Accessory',
        sourceUnit: unit,
      });
    }
  }

  return effects;
}

export function checkPhoenixBrooch(unit) {
  if (!unit || unit.currentHP <= 0) return { triggered: false, amount: 0 };
  const combatEffects = unit.accessory?.combatEffects;
  const hasPhoenixBrooch =
    unit.accessory?.name === 'Phoenix Brooch' || Boolean(combatEffects?.phoenixBrooch);
  if (!hasPhoenixBrooch) return { triggered: false, amount: 0 };
  if (unit._phoenixBroochUsed) return { triggered: false, amount: 0 };

  const phoenixConfig =
    combatEffects?.phoenixBrooch && typeof combatEffects.phoenixBrooch === 'object'
      ? combatEffects.phoenixBrooch
      : {};
  const maxHp = Math.max(1, Number(unit.stats?.HP) || 1);
  const thresholdPercent = Number.isFinite(Number(phoenixConfig.thresholdPercent))
    ? Math.max(0, Number(phoenixConfig.thresholdPercent))
    : Number.isFinite(Number(combatEffects?.phoenixThreshold))
      ? Math.max(0, Number(combatEffects.phoenixThreshold))
      : 0.25;
  const thresholdHp = Number.isFinite(Number(phoenixConfig.thresholdHp))
    ? Math.max(1, Math.trunc(Number(phoenixConfig.thresholdHp)))
    : Number.isFinite(Number(combatEffects?.phoenixThresholdHp))
      ? Math.max(1, Math.trunc(Number(combatEffects.phoenixThresholdHp)))
      : Math.max(1, Math.floor(maxHp * thresholdPercent));
  if (unit.currentHP > thresholdHp) return { triggered: false, amount: 0 };

  const hasExplicitHealPercent =
    Number.isFinite(Number(phoenixConfig.healPercent)) ||
    Number.isFinite(Number(combatEffects?.phoenixHealPercent));
  const hasExplicitHealFlat =
    Number.isFinite(Number(phoenixConfig.healFlat)) ||
    Number.isFinite(Number(combatEffects?.phoenixHeal));
  const healPercentRaw = hasExplicitHealPercent
    ? Math.max(
        0,
        Number.isFinite(Number(phoenixConfig.healPercent))
          ? Number(phoenixConfig.healPercent)
          : Number(combatEffects?.phoenixHealPercent),
      )
    : 0;
  const healFlat = hasExplicitHealFlat
    ? Math.max(
        0,
        Math.trunc(
          Number.isFinite(Number(phoenixConfig.healFlat))
            ? Number(phoenixConfig.healFlat)
            : Number(combatEffects?.phoenixHeal),
        ),
      )
    : hasExplicitHealPercent
      ? 0
      : 10;
  const percentHeal =
    healPercentRaw <= 1
      ? Math.floor(maxHp * healPercentRaw)
      : Math.floor((maxHp * healPercentRaw) / 100);
  const rawHeal = Math.max(1, percentHeal + healFlat);
  const nextHp = Math.min(maxHp, unit.currentHP + rawHeal);
  const amount = nextHp - unit.currentHP;
  if (amount <= 0) return { triggered: false, amount: 0 };

  unit.currentHP = nextHp;
  unit._phoenixBroochUsed = true;
  return {
    triggered: true,
    amount,
    source: unit.accessory?.name || 'Phoenix Brooch',
  };
}

// --- Foresight range check ---

/**
 * Get bonus range for a weapon due to skills (e.g. Foresight: +1 Tome range).
 */
export function getWeaponRangeBonus(unit, weapon, skillsData) {
  if (!skillsData || !unit.skills || !weapon) return 0;

  let bonus = 0;
  for (const skillId of unit.skills) {
    const skill = getSkill(skillId, skillsData);
    if (!skill || skill.trigger !== 'passive') continue;

    if (skill.id === 'foresight' && skill.effects?.tomeRangeBonus) {
      if (weapon.type === 'Tome' || weapon.type === 'Light' || weapon.type === 'Breath') {
        bonus += skill.effects.tomeRangeBonus;
      }
    }
  }
  return bonus;
}

/** Get terrain cost reduction from unit's passive skills (e.g. Pathfinder). */
export function getTerrainCostReduction(unit, skillsData) {
  if (!skillsData || !unit?.skills) return 0;
  for (const skillId of unit.skills) {
    const skill = getSkill(skillId, skillsData);
    if (skill?.effects?.terrainCostReduction) return skill.effects.terrainCostReduction;
  }
  return 0;
}
