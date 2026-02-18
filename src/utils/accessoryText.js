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
  'negateEffectiveness',
  'negateFlierWeakness',
  'perHitHeal',
  'phoenixBrooch',
  'phoenixHeal',
  'phoenixThreshold',
  'preventEnemyDouble',
  'recoilGuard',
  'resBonus',
  'turnStartHealPercent',
  'weaponArtCostReduction',
  'weaponArtDefBuff',
  'weaponArtHpCostReduction',
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
  if (condition === 'below50') return '<50% HP';
  if (condition === 'above75') return '>75% HP';
  if (condition === 'on_forest') return '(forest)';
  if (condition === 'no_ally_within_2') return 'no ally <=2';
  if (condition === 'enemies_nearby_2plus') return '2+ enemies <=2';
  if (condition === 'on_forest_or_mountain') return '(forest/mountain)';
  if (condition === 'isolated_duel') return 'isolated duel';
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

  const healFlat = Math.max(0, Math.trunc(firstNumericValue(turnStart?.healSelfFlat, combatEffects?.turnStartHealFlat) || 0));
  const healPercentRaw = Math.max(
    0,
    firstNumericValue(turnStart?.healSelfPercent, turnStart?.turnStartHealPercent, combatEffects?.turnStartHealPercent) || 0
  );
  const healPercent = healPercentRaw <= 1 ? healPercentRaw * 100 : healPercentRaw;

  const healParts = [];
  if (healFlat > 0) healParts.push(`+${healFlat} HP`);
  if (healPercent > 0) healParts.push(`${Number(healPercent.toFixed(2))}% HP`);
  if (healParts.length <= 0) return '';

  return `Turn start heal ${healParts.join(' + ')}`;
}

export function formatAccessoryEffects(accessory, options = {}) {
  const separator = options.separator ?? ' ';
  const entries = buildOrderedStatEntries(accessory?.effects);
  const parts = entries
    .map(([stat, value]) => formatSignedStat(value, stat))
    .filter(Boolean);
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
  if (avoidBonus !== null) parts.push(`+${avoidBonus} Avo`);

  const hitBonus = firstNumericValue(combatEffects?.hitBonus);
  if (hitBonus !== null) parts.push(`+${hitBonus} Hit`);

  if (combatEffects?.preventEnemyDouble) parts.push('Block double attacks');

  const doubleThresholdReduction = firstNumericValue(combatEffects?.doubleThresholdReduction);
  if (doubleThresholdReduction !== null) {
    const needed = Math.max(0, 5 - doubleThresholdReduction);
    parts.push(`Double at +${needed} SPD`);
  }

  if (combatEffects?.negateEffectiveness) parts.push('Negate effectiveness');
  if (combatEffects?.negateFlierWeakness) parts.push('Negate bow flier weakness');

  const weaponArtCostReduction = firstNumericValue(
    combatEffects?.weaponArtCostReduction,
    combatEffects?.weaponArtHpCostReduction,
  );
  if (weaponArtCostReduction !== null) {
    parts.push(`Art HP Cost -${weaponArtCostReduction}`);
  }

  const perHitHeal = firstNumericValue(combatEffects?.perHitHeal);
  if (perHitHeal !== null) parts.push(`Heal +${perHitHeal}/hit`);

  const bountyGold = firstNumericValue(combatEffects?.goldPerKill, combatEffects?.bountyGoldOnKill);
  if (bountyGold !== null) parts.push(`+${bountyGold}g/kill`);

  if (combatEffects?.moontide) parts.push('Moontide (odd +2 Atk, even +2 Def)');
  if (combatEffects?.gamblerCoin || combatEffects?.gambler) parts.push('Gambler (+5/-3 Atk)');

  const recoilBuffDef = firstNumericValue(combatEffects?.buffDEF);
  const recoilBuffRes = firstNumericValue(combatEffects?.buffRES);
  const recoilParts = [];
  if (recoilBuffDef !== null) recoilParts.push(`+${recoilBuffDef} Def`);
  if (recoilBuffRes !== null) recoilParts.push(`+${recoilBuffRes} Res`);
  if (combatEffects?.weaponArtDefBuff || combatEffects?.recoilGuard) {
    if (recoilParts.length > 0) {
      parts.push(`Recoil Guard (${recoilParts.join('/')} after art)`);
    } else {
      parts.push('Recoil Guard (art use -> timed buff)');
    }
  } else if (recoilParts.length > 0) {
    parts.push(`Timed buff (${recoilParts.join('/')} after art)`);
  }

  if (combatEffects?.phoenixBrooch) {
    const phoenixHeal = firstNumericValue(combatEffects?.phoenixHeal, combatEffects?.healFlat);
    const phoenixThresholdRaw = firstNumericValue(combatEffects?.phoenixThreshold);
    const phoenixThresholdPercent = phoenixThresholdRaw !== null
      ? (phoenixThresholdRaw <= 1 ? phoenixThresholdRaw * 100 : phoenixThresholdRaw)
      : null;

    if (phoenixHeal !== null || phoenixThresholdPercent !== null) {
      const thresholdText = phoenixThresholdPercent !== null
        ? `${Number(phoenixThresholdPercent.toFixed(2))}% HP`
        : 'low HP';
      const healText = phoenixHeal !== null ? `heal ${phoenixHeal} HP` : 'heal';
      parts.push(`Phoenix (once/map: ${healText} at <=${thresholdText})`);
    } else {
      parts.push('Phoenix (once/map under threshold)');
    }
  }
  if (turnStartText) parts.push(turnStartText);

  const condition = combatConditionLabel(combatEffects?.condition);
  if (parts.length > 0) {
    const base = parts.join('/');
    return condition ? `${base} ${condition}` : base;
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
