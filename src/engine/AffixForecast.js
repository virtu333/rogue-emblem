// Read-only consequences of an exchange. No combat rolls, mutations or UI dependencies.
import { CRIT_MULTIPLIER } from '../utils/constants.js';
import { isStatusImmune } from './StatusConditionSystem.js';

const canHit = (info) => info?.attackCount > 0 && info.hit > 0;
const maxStrike = (info) =>
  Math.floor(
    Math.max(0, info?.damage || 0) * (info?.crit > 0 ? info.critMultiplier || CRIT_MULTIPLIER : 1),
  );

export function affixForecastText(affix) {
  const values = {
    ...affix.effects,
    range: affix.range,
    reflectMeleePctPercent: Math.round((affix.effects?.reflectMeleePct || 0) * 100),
  };
  return (affix.forecastText || '').replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

/** Notes belong to their source unit's column, including defensive/on-death effects. */
export function affixForecastNotes(
  attacker,
  defender,
  forecast,
  affixData,
  { visibleUnits = [] } = {},
) {
  const out = { attacker: [], defender: [] };
  const entries = [
    ['attacker', attacker, defender, forecast.attacker, forecast.defender],
    ['defender', defender, attacker, forecast.defender, forecast.attacker],
  ];
  for (const [side, unit, opponent, own, incoming] of entries) {
    const incomingHit = canHit(incoming) && (side === 'defender' || incoming.canCounter);
    const ownHit = canHit(own) && (side === 'attacker' || own.canCounter);
    const shielded = unit.affixes?.includes('shielded') && !unit._hitByPlayerThisPhase;
    const damagingHits = Math.max(0, (incoming.attackCount || 0) - (shielded ? 1 : 0));
    for (const id of new Set(unit.affixes || [])) {
      const affix = affixData?.affixes?.find((a) => a.id === id);
      if (affix?.forecast !== 'exchange') continue;
      const fx = affix.effects || {};
      let applies = false;
      switch (affix.forecastCondition) {
        case 'first-hit':
          applies = incomingHit && !unit._hitByPlayerThisPhase;
          break;
        case 'reflect':
          applies =
            incomingHit &&
            damagingHits > 0 &&
            forecast.display?.distance === 1 &&
            Math.floor(maxStrike(incoming) * (fx.reflectMeleePct || 0)) > 0;
          break;
        case 'damage-taken':
          applies = incomingHit && damagingHits > 0 && maxStrike(incoming) > 0;
          break;
        case 'hit':
          applies =
            ownHit &&
            (opponent.currentHP ?? opponent.stats?.HP) > 0 &&
            !(fx.inflictStatus && isStatusImmune(opponent));
          break;
        case 'lethal':
          applies =
            incomingHit &&
            maxStrike(incoming) * damagingHits >= (unit.currentHP ?? unit.stats?.HP ?? Infinity) &&
            [opponent, ...visibleUnits].some((other) => {
              if (other === unit || (other.currentHP ?? other.stats?.HP ?? 0) <= 0) return false;
              const positioned = [unit.col, unit.row, other.col, other.row].every(Number.isFinite);
              const distance = positioned
                ? Math.abs(unit.col - other.col) + Math.abs(unit.row - other.row)
                : other === opponent
                  ? forecast.display?.distance
                  : Infinity;
              return distance <= (affix.range || 1);
            });
          break;
      }
      if (applies)
        out[side].push({
          affixId: id,
          name: affix.name,
          text: affixForecastText(affix),
          description: affix.description,
          tone: 'warn',
        });
    }
  }
  return out;
}
