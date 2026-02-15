const ACCESSORY_STAT_ORDER = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'LCK', 'DEF', 'RES', 'MOV'];

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
  return '';
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
  if (!combatEffects || typeof combatEffects !== 'object') return '';

  if (Number.isFinite(Number(combatEffects.critBonus))) {
    const bonus = Number(combatEffects.critBonus);
    const condition = combatConditionLabel(combatEffects.condition);
    return `+${bonus} Crit${condition ? ` ${condition}` : ''}`;
  }
  if (combatEffects.preventEnemyDouble) return 'Block double attacks';
  if (Number.isFinite(Number(combatEffects.doubleThresholdReduction))) {
    const reduction = Number(combatEffects.doubleThresholdReduction);
    const needed = Math.max(0, 5 - reduction);
    return `Double at +${needed} SPD`;
  }
  if (combatEffects.negateEffectiveness) return 'Negate effectiveness';

  const parts = [];
  if (Number.isFinite(Number(combatEffects.atkBonus))) {
    parts.push(`+${Number(combatEffects.atkBonus)} Atk`);
  }
  if (Number.isFinite(Number(combatEffects.defBonus))) {
    parts.push(`+${Number(combatEffects.defBonus)} Def`);
  }
  if (Number.isFinite(Number(combatEffects.avoidBonus))) {
    parts.push(`+${Number(combatEffects.avoidBonus)} Avo`);
  }

  const condition = combatConditionLabel(combatEffects.condition);
  if (parts.length > 0) {
    const base = parts.join('/');
    return condition ? `${base} ${condition}` : base;
  }

  return 'Combat effect';
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
