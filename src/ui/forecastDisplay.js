import { hitProbability } from '../engine/HitRoll.js';

/**
 * A strike's real chance to land, as a whole percent. Hit is rolled as the
 * average of two numbers (HitRoll.js), so a rating of 72 lands about 84% of
 * the time: the forecast shows that chance, not the raw rating. Only a sure
 * hit reads 100% and only an impossible one 0%.
 */
export function hitChancePercent(hit) {
  const p = hitProbability(hit);
  if (p >= 1) return 100;
  if (p <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(p * 100)));
}

/** Forecast value formats, one shape per kind so the numbers never read alike. */
export const formatHitChance = (hit) => `${hitChancePercent(hit)}%`;
export const formatCritChance = (crit) => `${Math.max(0, Math.min(100, Number(crit) || 0))}%`;
export const formatStrikes = (count) => `×${Math.max(1, Number(count) || 1)}`;

// Conservative, RNG-free display estimate. Never used to resolve combat.
export function forecastProjection(forecast) {
  if (!forecast?.display?.simpleExchange) return null;
  const a = forecast.attacker,
    d = forecast.defender;
  let attackerHP = a.hp,
    defenderHP = d.hp;
  // Strikes per round: a brave weapon or multi-hit art strikes more than once
  // each time it acts (attackCount already includes doubling).
  const perRound = (info) =>
    Math.max(1, Math.round((info.attackCount || 1) / (info.doubles ? 2 : 1)));
  const round = (side) => {
    const info = side === 'a' ? a : d;
    for (let i = 0; i < perRound(info); i++) {
      if (attackerHP <= 0 || defenderHP <= 0) return;
      if (side === 'a' && a.attackCount > 0 && a.hit > 0)
        defenderHP = Math.max(0, defenderHP - a.damage);
      if (side === 'd' && d.canCounter && d.hit > 0)
        attackerHP = Math.max(0, attackerHP - d.damage);
    }
  };
  round('a');
  round('d');
  if (a.doubles) round('a');
  if (d.doubles) round('d');
  return { attackerHP, defenderHP };
}
export function triangleText(forecast) {
  const bonus = forecast?.display?.triangle;
  if (!bonus || (!bonus.damage && !bonus.hit)) return '';
  const sign = (v) => `${v >= 0 ? '+' : ''}${v}`;
  return `Triangle ${bonus.damage > 0 ? 'advantage' : 'disadvantage'} · ${sign(bonus.damage)} damage · ${sign(bonus.hit)} Hit`;
}
export function counterRisk(forecast, attackerHP = forecast?.attacker?.hp) {
  const a = forecast?.attacker,
    d = forecast?.defender;
  if (!d?.canCounter || d.hit <= 0 || !a) return '';
  if (forecast.display?.simpleExchange && a.hit >= 100 && a.damage >= d.hp) return '';
  if (forecast.display?.counterHasDamageProc)
    return 'Enemy skills can change counterattack damage.';
  const base = d.damage * Math.max(1, d.attackCount || 1);
  const possible = base * (d.crit > 0 ? 3 : 1);
  return possible >= attackerHP
    ? `${d.crit > 0 && base < attackerHP ? 'A critical counter' : 'The counterattack'} could defeat ${a.name}.`
    : '';
}

// Shared readout for the canvas and DOM forecasts. Keep assumptions beside estimates.
export function forecastNotes(forecast, attacking, attackerHP) {
  const projection = forecastProjection(forecast);
  const notes = [];
  if (projection) {
    const hp = attacking ? projection.attackerHP : projection.defenderHP;
    notes.push(`If all hits land: ${hp === 0 ? 'KO' : `${hp} HP`} (no crits/procs)`);
  }
  if (attacking) notes.push(triangleText(forecast), counterRisk(forecast, attackerHP));
  else if (!forecast.defender.canCounter)
    notes.push(
      `Cannot counter · ${forecast.display?.counterReason || 'No valid response at this range'}`,
    );
  return notes.filter(Boolean);
}

export function forecastTeachingHints(forecast, attackerHP) {
  const hints = [];
  if (counterRisk(forecast, attackerHP))
    hints.push({
      id: 'battle_counter_risk',
      text: 'Check your HP after any art cost. Enemy hits and critical hits can make this exchange lethal; Cancel lets you choose another plan.',
    });
  if (!forecast.defender.canCounter)
    hints.push({
      id: 'battle_no_counter',
      text: 'A counterattack needs a usable combat weapon that reaches the attacker. Status effects or an attack effect can also prevent it; the reason is shown above.',
    });
  if (forecast.attacker.doubles || forecast.defender.doubles)
    hints.push({
      id: 'battle_doubling',
      text: 'A 5-point Attack Speed lead normally grants a second attack. Weapon weight can reduce Attack Speed. Planned hits includes doubling, but a defeated unit cannot finish its strikes.',
    });
  if (triangleText(forecast))
    hints.push({
      id: 'battle_triangle',
      text: 'Swords beat axes, axes beat lances, and lances beat swords. The displayed damage and Hit chance already include this matchup.',
    });
  return hints;
}
