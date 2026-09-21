import { getEffectiveWeaponArtHpCost } from '../engine/WeaponArtSystem.js';

const MOD_LABELS = {
  atkBonus: 'Attack',
  hitBonus: 'Hit',
  critBonus: 'Crit',
  avoidBonus: 'Avoid',
  defBonus: 'Defense',
  resBonus: 'Resistance',
  spdBonus: 'Speed',
  rangeBonus: 'range',
};

// Authored prose retains complex positional/conditional effects; numeric combat
// modifiers are displayed explicitly so flavor text never hides an art's benefit.
export function formatWeaponArtEffects(art) {
  if (!art) return '';
  const mods = art.combatMods || {};
  const parts = Object.entries(MOD_LABELS)
    .filter(([key]) => Number.isFinite(mods[key]) && mods[key] !== 0)
    .map(([key, label]) => `${mods[key] > 0 ? '+' : ''}${mods[key]} ${label}`);
  if (mods.damageMultiplier) parts.push(`×${mods.damageMultiplier} damage`);
  if (mods.multiHit)
    parts.push(
      `${mods.multiHit.count} strikes at ${Math.round(mods.multiHit.damageMultiplier * 100)}% damage`,
    );
  if (mods.effectiveness) {
    const targets = [
      ...(mods.effectiveness.moveTypes || []),
      ...(mods.effectiveness.classNames || []),
    ];
    if (targets.length)
      parts.push(`×${mods.effectiveness.multiplier} weapon might against ${targets.join(', ')}`);
  }
  if (mods.rangeOverride) parts.push(`Range ${mods.rangeOverride.min}–${mods.rangeOverride.max}`);
  if (mods.statScaling)
    parts.push(`Adds ${mods.statScaling.stat} ÷ ${mods.statScaling.divisor} to Attack`);
  if (mods.drainPercent)
    parts.push(`Heals ${Math.round(mods.drainPercent * 100)}% of damage dealt`);
  for (const [key, label] of Object.entries({
    preventCounter: 'Prevents counterattacks',
    ignoreRES: 'Ignores Resistance',
    targetsRES: 'Targets Resistance',
    ignoreTerrainAvoid: 'Ignores terrain Avoid',
    ignoreWeaponTriangle: 'Ignores weapon triangle',
    halfPhysicalDamage: 'Halves physical damage',
  }))
    if (mods[key]) parts.push(label);
  return [parts.join(' · '), art.description].filter(Boolean).join('. ');
}

export function weaponArtCostText(unit, art, options = {}) {
  const cost = getEffectiveWeaponArtHpCost(unit, art, options);
  const base = Math.max(0, Number(art?.hpCost) || 0);
  return `HP cost ${cost}${cost !== base ? ` (base ${base})` : ''}`;
}

export function weaponArtUsesText(unit, art, turnNumber) {
  const usage = unit?._battleWeaponArtUsage || {};
  const parts = [];
  if (Number(art?.perMapLimit) > 0)
    parts.push(
      `${Math.max(0, art.perMapLimit - (usage.map?.[art.id] || 0))}/${art.perMapLimit} map uses left`,
    );
  if (Number(art?.perTurnLimit) > 0 && turnNumber != null) {
    const used = usage.turnKey === String(turnNumber) ? usage.turn?.[art.id] || 0 : 0;
    parts.push(`${Math.max(0, art.perTurnLimit - used)}/${art.perTurnLimit} turn uses left`);
  }
  return parts.join(' · ') || 'No usage limit';
}
