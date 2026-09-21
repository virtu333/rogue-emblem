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

/** Static item/reference copy: never carries last battle's usage counters. */
export function weaponArtDetailLines(art) {
  if (!art) return ['Weapon art details unavailable.'];
  const types = art.allowedTypes?.length ? art.allowedTypes : [art.weaponType].filter(Boolean);
  const rank =
    { Prof: 'Proficient', Mast: 'Master rank' }[art.requiredRank] ||
    art.requiredRank ||
    'Proficient';
  const limits = [];
  if (art.perMapLimit)
    limits.push(
      `${art.perMapLimit} ${art.perMapLimit === 1 ? 'use' : 'uses'} per battle (reset each battle)`,
    );
  if (art.perTurnLimit)
    limits.push(`${art.perTurnLimit} ${art.perTurnLimit === 1 ? 'use' : 'uses'} per turn`);
  return [
    formatWeaponArtEffects(art),
    `Requires ${types.join(' / ')} · ${rank}.`,
    `Base HP cost: ${Math.max(0, Number(art.hpCost) || 0)} per use. The user must have more HP than the effective cost.`,
    limits.join(' · ') || 'No usage limit.',
    'Active attack: choose Weapon Art in battle, then confirm the attack to spend HP and a use.',
    'Weapon arts do not gain a follow-up attack from Speed. Arts with multiple strikes use their stated strike count.',
  ];
}

export function weaponArtScrollText(scroll, catalog = []) {
  const art = catalog.find((a) => a.id === scroll?.teachesWeaponArtId);
  const types = scroll?.allowedWeaponTypes?.length
    ? scroll.allowedWeaponTypes
    : art?.allowedTypes?.length
      ? art.allowedTypes
      : [art?.weaponType].filter(Boolean);
  return [
    `Weapon Art Scroll — adds ${art?.name || 'an active attack'} to one compatible ${types.length ? `${types.join(' / ')} ` : ''}weapon.`,
    'Stored in Team scrolls. Open Roster → Skills → Bind to weapon. The scroll is consumed only after binding; the art stays on that weapon for this run.',
    ...weaponArtDetailLines(art),
  ].join('\n\n');
}
