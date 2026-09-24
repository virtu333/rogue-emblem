// Conservative, RNG-free display estimate. Never used to resolve combat.
export function forecastProjection(forecast) {
  if (!forecast?.display?.simpleExchange) return null;
  const a = forecast.attacker,
    d = forecast.defender;
  let attackerHP = a.hp,
    defenderHP = d.hp;
  const strike = (side) => {
    if (attackerHP <= 0 || defenderHP <= 0) return;
    if (side === 'a' && a.attackCount > 0 && a.hit > 0)
      defenderHP = Math.max(0, defenderHP - a.damage);
    if (side === 'd' && d.canCounter && d.hit > 0) attackerHP = Math.max(0, attackerHP - d.damage);
  };
  strike('a');
  strike('d');
  if (a.doubles) strike('a');
  if (d.doubles) strike('d');
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
      text: 'Swords beat axes, axes beat lances, and lances beat swords. The displayed damage and Hit rating already include this matchup.',
    });
  return hints;
}
