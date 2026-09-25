// traitContent.js — what a trait does for THIS unit, as one readable line.
//
// Pure text helpers shared by every surface that shows traits (recruit and
// boss-recruit cards, roster sheet, unit details). The catalog `description`
// in traits.json is the class-agnostic rule; these helpers resolve it for a
// specific unit: the stat Kindled actually raises, the battle count Studious
// or Slow Oath actually sets, the class perk Slow Oath actually doubles.

import {
  ATTACK_STAT_TOKEN,
  getTraitAttackStat,
  getTraitRoles,
  getUnitTraits,
} from '../engine/TraitSystem.js';
import { getMasteryPerk, getMasteryThreshold } from '../engine/MasterySystem.js';
import { MASTERY_BATTLES } from '../utils/constants.js';
import { formatPerkMods } from './rosterDisplay.js';

const STAT_LABELS = {
  HP: 'HP',
  STR: 'Str',
  MAG: 'Mag',
  SKL: 'Skl',
  SPD: 'Spd',
  DEF: 'Def',
  RES: 'Res',
  LCK: 'Lck',
  MOV: 'Move',
};

function signed(value) {
  return value < 0 ? `-${Math.abs(value)}` : `+${value}`;
}

function statLabel(stat, unit) {
  if (stat !== ATTACK_STAT_TOKEN) return STAT_LABELS[stat] || stat;
  return unit ? STAT_LABELS[getTraitAttackStat(unit)] : 'Str or Mag';
}

/** "+1 Mag and +10% Mag growth (its attack stat)" for a creation-mod trait. */
function creationText(trait, unit) {
  const mods = trait.creationMods || {};
  const parts = [];
  for (const [stat, value] of Object.entries(mods.stats || {})) {
    if (Number.isFinite(value) && value !== 0)
      parts.push(`${signed(value)} ${statLabel(stat, unit)}`);
  }
  for (const [stat, value] of Object.entries(mods.growths || {})) {
    if (Number.isFinite(value) && value !== 0)
      parts.push(`${signed(value)}% ${statLabel(stat, unit)} growth`);
  }
  if (!parts.length) return null;
  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const usesAttack =
    ATTACK_STAT_TOKEN in (mods.stats || {}) || ATTACK_STAT_TOKEN in (mods.growths || {});
  if (!usesAttack || !unit) return `${joined}.`;
  const heals = !getTraitRoles(unit).has('attacker');
  return `${joined} (the stat it ${heals ? 'heals' : 'fights'} with).`;
}

/** Concrete mastery text for threshold / perk-multiplier traits. */
function masteryText(trait, unit, gameData) {
  const delta = Number.isFinite(trait.masteryBattlesDelta) ? trait.masteryBattlesDelta : 0;
  const multiplier = Number.isFinite(trait.masteryPerkMultiplier) ? trait.masteryPerkMultiplier : 1;
  if (!delta && multiplier === 1) return null;
  if (!unit?.className) return null;
  const traitsData = gameData?.traits || null;
  const threshold = getMasteryThreshold(unit, traitsData);
  const totalDelta = threshold - MASTERY_BATTLES;
  let when = `Masters its class in ${threshold} battles`;
  if (delta && totalDelta === delta) when += `, not ${MASTERY_BATTLES}`;
  else if (delta)
    when = `Masters its class ${Math.abs(delta)} battles ${delta < 0 ? 'sooner' : 'later'} (${threshold} with its other traits)`;
  if (multiplier === 1) return `${when}.`;
  const perk = getMasteryPerk(unit, gameData?.classes || null, traitsData);
  if (!perk) return `${when}; its mastery perk is doubled.`;
  const baseName = perk.name.replace(/ ×[\d.]+$/, '');
  return `${when}; ${baseName} becomes ${formatPerkMods(perk.mods)} (from ${formatPerkMods(perk.classMods)}).`;
}

/**
 * One line describing what `trait` does for `unit`. Falls back to the catalog
 * description whenever there is nothing unit-specific to say (combat and XP
 * traits read the same on every unit).
 */
export function traitEffectText(trait, unit = null, gameData = null) {
  if (!trait) return '';
  // Legendary and retired traits read exactly as the catalog describes them.
  if (trait.rarity === 'legendary' || trait.retired) return trait.description || '';
  return (
    masteryText(trait, unit, gameData) ||
    (trait.creationMods ? creationText(trait, unit) : null) ||
    trait.description ||
    ''
  );
}

/** Display rows for every trait on a unit: `{ id, name, text, legendary }`. */
export function traitLines(unit, gameData) {
  return getUnitTraits(unit, gameData?.traits || null).map((trait) => ({
    id: trait.id,
    name: trait.name,
    text: traitEffectText(trait, unit, gameData),
    legendary: trait.rarity === 'legendary',
  }));
}
