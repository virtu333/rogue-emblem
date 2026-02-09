// SkillSystem.js — Pure skill evaluation functions (no Phaser dependencies)
// Skills are identified by ID strings stored on unit.skills[].
// All functions take skillsData (from skills.json) for metadata lookup.

import { gridDistance } from './Combat.js';

// --- Helpers ---

function getSkill(skillId, skillsData) {
  return skillsData.find(s => s.id === skillId) || null;
}

function isBelow50(unit) {
  return unit.currentHP <= Math.floor(unit.stats.HP / 2);
}

function getActivationChance(unit, activation) {
  switch (activation) {
    case 'SKL':          return unit.stats.SKL;
    case 'SKL_HALF':     return Math.floor(unit.stats.SKL / 2);
    case 'LCK_QUARTER':  return Math.floor(unit.stats.LCK / 4);
    case 'SPD':          return unit.stats.SPD;
    case 'LCK':          return unit.stats.LCK;
    default:             return 0;
  }
}

// --- Static combat modifiers ---

/**
 * Gather all stat modifiers for a unit entering combat.
 * Includes: passive skills, aura buffs from allies, on-combat-start triggers.
 * Returns a flat modifier object applied to combat calculations.
 */
export function getSkillCombatMods(unit, opponent, allAllies, allEnemies, skillsData, terrain) {
  const mods = {
    hitBonus: 0,
    avoidBonus: 0,
    critBonus: 0,
    atkBonus: 0,
    defBonus: 0,
    resBonus: 0,
    ignoreTerrainAvoid: false,
    vantage: false,
    activated: [],  // [{id, name}] for UI display
  };

  if (!skillsData || !unit.skills) return mods;

  // Unit's own skills
  for (const skillId of unit.skills) {
    const skill = getSkill(skillId, skillsData);
    if (!skill) continue;

    // Passive stat bonuses
    if (skill.trigger === 'passive' && skill.effects) {
      if (skill.effects.critBonus) mods.critBonus += skill.effects.critBonus;
      if (skill.effects.atkBonus) mods.atkBonus += skill.effects.atkBonus;
      if (skill.effects.defBonus) mods.defBonus += skill.effects.defBonus;
      if (skill.effects.resBonus) mods.resBonus += skill.effects.resBonus;
      if (skill.effects.hitBonus) mods.hitBonus += skill.effects.hitBonus;
      if (skill.effects.avoidBonus) mods.avoidBonus += skill.effects.avoidBonus;
      if (skill.effects.ignoreTerrainAvoid) mods.ignoreTerrainAvoid = true;
    }

    // On-combat-start conditional skills
    if (skill.trigger === 'on-combat-start') {
      let condMet = !skill.condition;
      if (skill.condition === 'below50') condMet = isBelow50(unit);
      if (skill.condition === 'adjacent_ally') {
        condMet = allAllies.some(a => a !== unit && gridDistance(unit.col, unit.row, a.col, a.row) === 1);
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
        // Generic on-combat-start stat bonuses (Guard, etc.)
        if (skill.id !== 'resolve' && skill.id !== 'wrath' && skill.id !== 'vantage' && skill.effects) {
          if (skill.effects.defBonus) mods.defBonus += skill.effects.defBonus;
          if (skill.effects.resBonus) mods.resBonus += skill.effects.resBonus;
          if (skill.effects.atkBonus) mods.atkBonus += skill.effects.atkBonus;
          if (skill.effects.critBonus) mods.critBonus += skill.effects.critBonus;
          if (skill.effects.hitBonus) mods.hitBonus += skill.effects.hitBonus;
          if (skill.effects.avoidBonus) mods.avoidBonus += skill.effects.avoidBonus;
          mods.activated.push({ id: skill.id, name: skill.name });
        }
      }
    }
  }

  // Aura buffs from allies
  for (const ally of allAllies) {
    if (ally === unit || !ally.skills) continue;
    for (const skillId of ally.skills) {
      const skill = getSkill(skillId, skillsData);
      if (!skill || skill.trigger !== 'passive-aura') continue;

      const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
      if (dist <= (skill.range || 0) && skill.effects) {
        mods.hitBonus += skill.effects.hitBonus || 0;
        mods.avoidBonus += skill.effects.avoidBonus || 0;
      }
    }
  }

  // Accessory combat effects
  const ce = unit.accessory?.combatEffects;
  if (ce) {
    let condMet = true;
    if (ce.condition === 'below50') condMet = isBelow50(unit);
    else if (ce.condition === 'above75') condMet = unit.currentHP > Math.floor(unit.stats.HP * 0.75);
    else if (ce.condition === 'on_forest') condMet = terrain?.name === 'Forest';
    else if (ce.condition === 'adjacent_ally') condMet = allAllies.some(a => a !== unit && gridDistance(unit.col, unit.row, a.col, a.row) === 1);

    if (condMet) {
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
export function rollStrikeSkills(attacker, normalDamage, target, skillsData) {
  const result = {
    modifiedDamage: normalDamage,
    heal: 0,
    lethal: false,
    extraStrike: false,
    activated: [],
  };

  if (!skillsData || !attacker.skills) return result;

  for (const skillId of attacker.skills) {
    const skill = getSkill(skillId, skillsData);
    if (!skill || skill.trigger !== 'on-attack') continue;

    const chance = getActivationChance(attacker, skill.activation);
    const roll = Math.random() * 100;
    if (roll >= chance) continue;

    switch (skill.id) {
      case 'sol':
        // Heal damage dealt
        result.heal = normalDamage;
        result.activated.push({ id: 'sol', name: 'Sol' });
        break;

      case 'luna':
        // Halve enemy DEF/RES — recalculate damage as if def halved
        // We approximate by adding half the effective defense to damage
        result.modifiedDamage = Math.floor(normalDamage * 1.5);
        result.activated.push({ id: 'luna', name: 'Luna' });
        break;

      case 'lethality':
        result.lethal = true;
        result.activated.push({ id: 'lethality', name: 'Lethality' });
        break;

      case 'adept':
        result.extraStrike = true;
        result.activated.push({ id: 'adept', name: 'Adept' });
        break;
    }
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
    activated: [],
  };

  if (!skillsData || !defender.skills) return result;

  for (const skillId of defender.skills) {
    const skill = getSkill(skillId, skillsData);
    if (!skill || skill.trigger !== 'on-defend') continue;

    const chance = getActivationChance(defender, skill.activation);
    const roll = Math.random() * 100;
    if (roll >= chance) continue;

    if (skill.id === 'pavise' && isPhysicalAttack) {
      result.modifiedDamage = Math.floor(result.modifiedDamage / 2);
      result.activated.push({ id: 'pavise', name: 'Pavise' });
    }

    if (skill.id === 'aegis' && !isPhysicalAttack) {
      result.modifiedDamage = Math.floor(result.modifiedDamage / 2);
      result.activated.push({ id: 'aegis', name: 'Aegis' });
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
  }

  return result;
}

/**
 * Check if Astra triggers for an attack phase.
 * If triggered, the normal strike count is replaced with 5 at half damage.
 * Returns: { triggered, strikeCount, damageMult, name }
 */
export function checkAstra(attacker, skillsData) {
  if (!skillsData || !attacker.skills) return { triggered: false };

  if (!attacker.skills.includes('astra')) return { triggered: false };

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

  if (!skillsData) return effects;

  for (const unit of units) {
    if (!unit.skills) continue;

    for (const skillId of unit.skills) {
      const skill = getSkill(skillId, skillsData);
      if (!skill || skill.trigger !== 'on-turn-start') continue;

      // Renewal: self-heal 10% max HP
      if (skill.id === 'renewal') {
        const healPercent = skill.effects?.healSelf || 10;
        const healAmount = Math.max(1, Math.floor(unit.stats.HP * healPercent / 100));
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

  return effects;
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
      if (weapon.type === 'Tome' || weapon.type === 'Light') {
        bonus += skill.effects.tomeRangeBonus;
      }
    }
  }
  return bonus;
}
