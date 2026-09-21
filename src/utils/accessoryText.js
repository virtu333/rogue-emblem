const ACCESSORY_STAT_ORDER = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'LCK', 'DEF', 'RES', 'MOV'];

export const HANDLED_ACCESSORY_COMBAT_EFFECT_KEYS = Object.freeze([
  'atkBonus',
  'avoidBonus',
  'bloodGem',
  'bountyGoldOnKill',
  'buffDEF',
  'buffRES',
  'condition',
  'critBonus',
  'defBonus',
  'doubleThresholdReduction',
  'gambler',
  'gamblerCoin',
  'goldPerKill',
  'hitBonus',
  'moontide',
  'moveTypeOverride',
  'negateEffectiveness',
  'negateFlierWeakness',
  'perHitHeal',
  'phoenixBrooch',
  'phoenixHeal',
  'phoenixThreshold',
  'preventEnemyDouble',
  'recoilGuard',
  'resBonus',
  'statusImmunity',
  'turnStartHealPercent',
  'weaponArtCostReduction',
  'weaponArtDefBuff',
  'weaponArtHpCostReduction',
  'xpShare',
]);

export const HANDLED_ACCESSORY_TURN_START_EFFECT_KEYS = Object.freeze([
  'healSelfFlat',
  'healSelfPercent',
  'turnStartHealPercent',
]);

function formatSignedStat(value, stat) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num} ${stat}`;
}

function buildOrderedStatEntries(effects) {
  if (!effects || typeof effects !== 'object') return [];
  const ordered = [];
  const seen = new Set();
  for (const stat of ACCESSORY_STAT_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(effects, stat)) continue;
    ordered.push([stat, effects[stat]]);
    seen.add(stat);
  }
  for (const [stat, value] of Object.entries(effects)) {
    if (seen.has(stat)) continue;
    ordered.push([stat, value]);
  }
  return ordered;
}

function combatConditionLabel(condition) {
  if (condition === 'below50') return 'below 50% HP';
  if (condition === 'above75') return 'above 75% HP';
  if (condition === 'on_forest') return 'on a forest tile';
  if (condition === 'adjacent_ally') return 'next to an ally';
  if (condition === 'no_ally_within_2') return 'no ally is within 2 tiles';
  if (condition === 'enemies_nearby_2plus') return 'at least 2 enemies are within 2 tiles';
  if (condition === 'on_forest_or_mountain') return 'on a forest or mountain tile';
  if (condition === 'isolated_duel') {
    return 'no other unit is within 2 tiles of you or your foe';
  }
  return '';
}

function firstNumericValue(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function formatTurnStartEffect(accessory) {
  const turnStart = accessory?.turnStartEffects;
  const combatEffects = accessory?.combatEffects;
  const hasTurnStart = turnStart && typeof turnStart === 'object';
  const hasCombatEffects = combatEffects && typeof combatEffects === 'object';
  if (!hasTurnStart && !hasCombatEffects) return '';

  const healFlat = Math.max(
    0,
    Math.trunc(firstNumericValue(turnStart?.healSelfFlat, combatEffects?.turnStartHealFlat) || 0),
  );
  const healPercentRaw = Math.max(
    0,
    firstNumericValue(
      turnStart?.healSelfPercent,
      turnStart?.turnStartHealPercent,
      combatEffects?.turnStartHealPercent,
    ) || 0,
  );
  const healPercent = healPercentRaw <= 1 ? healPercentRaw * 100 : healPercentRaw;

  const healParts = [];
  if (healFlat > 0) healParts.push(`+${healFlat} HP`);
  if (healPercent > 0) healParts.push(`${Number(healPercent.toFixed(2))}% HP`);
  if (healParts.length <= 0) return '';

  return `At turn start, restore ${healParts.join(' + ')}`;
}

export function formatAccessoryEffects(accessory, options = {}) {
  const separator = options.separator ?? ' ';
  const entries = buildOrderedStatEntries(accessory?.effects);
  const parts = entries.map(([stat, value]) => formatSignedStat(value, stat)).filter(Boolean);
  return parts.join(separator);
}

export function formatAccessoryCombatEffect(accessory) {
  const combatEffects = accessory?.combatEffects;
  const turnStartText = formatTurnStartEffect(accessory);
  const hasCombatEffects = combatEffects && typeof combatEffects === 'object';
  if (!hasCombatEffects && !turnStartText) return '';

  const parts = [];
  const critBonus = firstNumericValue(combatEffects?.critBonus);
  if (critBonus !== null) parts.push(`+${critBonus} Crit`);

  const atkBonus = firstNumericValue(combatEffects?.atkBonus);
  if (atkBonus !== null) parts.push(`+${atkBonus} Atk`);

  const defBonus = firstNumericValue(combatEffects?.defBonus);
  if (defBonus !== null) parts.push(`+${defBonus} Def`);

  const resBonus = firstNumericValue(combatEffects?.resBonus);
  if (resBonus !== null) parts.push(`+${resBonus} Res`);

  const avoidBonus = firstNumericValue(combatEffects?.avoidBonus);
  if (avoidBonus !== null) parts.push(`+${avoidBonus} Avoid`);

  const hitBonus = firstNumericValue(combatEffects?.hitBonus);
  if (hitBonus !== null) parts.push(`+${hitBonus} Hit`);

  if (combatEffects?.preventEnemyDouble) parts.push('Foes cannot make follow-up attacks');

  const doubleThresholdReduction = firstNumericValue(combatEffects?.doubleThresholdReduction);
  if (doubleThresholdReduction !== null) {
    const needed = Math.max(0, 5 - doubleThresholdReduction);
    parts.push(`Make follow-up attacks with ${needed} more Attack Speed than your foe`);
  }

  if (combatEffects?.negateEffectiveness) parts.push('Negates weapon effectiveness');
  if (combatEffects?.negateFlierWeakness) parts.push('Negates flier weakness to bows');
  if (combatEffects?.statusImmunity) parts.push('Immune to status conditions');

  const xpShare = firstNumericValue(combatEffects?.xpShare);
  if (xpShare !== null && xpShare > 0) {
    const percent = xpShare <= 1 ? xpShare * 100 : xpShare;
    parts.push(`Adjacent lower-level allies gain ${Number(percent.toFixed(2))}% combat XP`);
  }

  if (typeof combatEffects?.moveTypeOverride === 'string' && combatEffects.moveTypeOverride) {
    parts.push(`Move as ${combatEffects.moveTypeOverride}`);
  }

  const weaponArtCostReduction = firstNumericValue(
    combatEffects?.weaponArtCostReduction,
    combatEffects?.weaponArtHpCostReduction,
  );
  if (weaponArtCostReduction !== null) {
    parts.push(`Weapon arts cost ${weaponArtCostReduction} less HP`);
  }

  const perHitHeal = firstNumericValue(combatEffects?.perHitHeal);
  if (perHitHeal !== null) parts.push(`Restore ${perHitHeal} HP per hit`);

  const bountyGold = firstNumericValue(combatEffects?.goldPerKill, combatEffects?.bountyGoldOnKill);
  if (bountyGold !== null) parts.push(`Gain +${bountyGold} gold per kill`);

  if (combatEffects?.moontide) parts.push('Odd turns: +2 Atk; even turns: +2 Def');
  if (combatEffects?.gamblerCoin || combatEffects?.gambler)
    parts.push('Gambler: each combat, 50% chance of +5 Attack; otherwise -3 Attack.');

  const recoilBuffDef = firstNumericValue(combatEffects?.buffDEF);
  const recoilBuffRes = firstNumericValue(combatEffects?.buffRES);
  const recoilParts = [];
  if (recoilBuffDef !== null) recoilParts.push(`+${recoilBuffDef} Def`);
  if (recoilBuffRes !== null) recoilParts.push(`+${recoilBuffRes} Res`);
  if (combatEffects?.weaponArtDefBuff || combatEffects?.recoilGuard) {
    if (recoilParts.length > 0) {
      parts.push(`${recoilParts.join('/')} after using a weapon art`);
    } else {
      parts.push('Gain a temporary defensive boost after using a weapon art');
    }
  } else if (recoilParts.length > 0) {
    parts.push(`${recoilParts.join('/')} after using a weapon art`);
  }

  if (combatEffects?.phoenixBrooch) {
    const phoenixHeal = firstNumericValue(combatEffects?.phoenixHeal, combatEffects?.healFlat);
    const phoenixThresholdRaw = firstNumericValue(combatEffects?.phoenixThreshold);
    const phoenixThresholdPercent =
      phoenixThresholdRaw !== null
        ? phoenixThresholdRaw <= 1
          ? phoenixThresholdRaw * 100
          : phoenixThresholdRaw
        : null;

    if (phoenixHeal !== null || phoenixThresholdPercent !== null) {
      const thresholdText =
        phoenixThresholdPercent !== null
          ? `${Number(phoenixThresholdPercent.toFixed(2))}% HP`
          : 'low HP';
      const healText = phoenixHeal !== null ? `heal ${phoenixHeal} HP` : 'heal';
      parts.push(`Once per map, ${healText} at ${thresholdText} or less`);
    } else {
      parts.push('Once per map, heal at low HP');
    }
  }
  if (turnStartText) parts.push(turnStartText);

  const condition = combatConditionLabel(combatEffects?.condition);
  if (parts.length > 0) {
    const base = parts.join(' · ');
    return condition ? `${base} when ${condition}` : base;
  }

  return hasCombatEffects ? 'Combat effect' : '';
}

export function formatAccessoryDetail(accessory, options = {}) {
  const separator = options.separator ?? ' | ';
  const includeStats = options.includeStats !== false;
  const includeCombat = options.includeCombat !== false;
  const fallback = options.fallback ?? '';

  const parts = [];
  if (includeStats) {
    const stats = formatAccessoryEffects(accessory, { separator: options.statSeparator ?? ' ' });
    if (stats) parts.push(stats);
  }
  if (includeCombat) {
    const combat = formatAccessoryCombatEffect(accessory);
    if (combat) parts.push(combat);
  }

  if (parts.length <= 0) return fallback;
  return parts.join(separator);
}
