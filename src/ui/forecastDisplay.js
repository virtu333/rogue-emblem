import { traitEffectText } from './traitContent.js';
import { getMasteryPerk } from '../engine/MasterySystem.js';
import { formatPerkMods } from './rosterDisplay.js';
import { hitProbability } from '../engine/HitRoll.js';
import { forecastRawDamage, forecastStrikeGroups } from '../engine/Combat.js';
import {
  DOUBLE_ATTACK_SPD_THRESHOLD,
  WEAPON_ART_FOLLOW_UP_SPD_THRESHOLD,
} from '../utils/constants.js';

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

/**
 * A side's strikes with their damage. A weapon art that keeps its follow-up strikes
 * plain the second time, so its follow-up shows its own damage: "12×1 + 7×1".
 */
export function formatDamageStrikes(info) {
  const fu = info?.followUp;
  if (!fu) return `${info?.damage ?? 0}${formatStrikes(info?.attackCount)}`;
  const firstCount = Math.max(1, (Number(info.attackCount) || 0) - fu.attackCount);
  return `${info.damage}${formatStrikes(firstCount)} + ${fu.damage}${formatStrikes(fu.attackCount)}`;
}

/** The planned strike count; an art's plain follow-up shows its damage: "×1 then ×1 (7)". */
export function formatPlannedStrikes(info) {
  const fu = info?.followUp;
  if (!fu) return formatStrikes(info?.attackCount);
  const firstCount = Math.max(1, (Number(info.attackCount) || 0) - fu.attackCount);
  return `${formatStrikes(firstCount)} then ${formatStrikes(fu.attackCount)} (${fu.damage})`;
}

// Conservative, RNG-free display estimate. Never used to resolve combat.
export function forecastProjection(forecast) {
  if (!forecast?.display?.simpleExchange) return null;
  const a = forecast.attacker,
    d = forecast.defender;
  let attackerHP = a.hp,
    defenderHP = d.hp;
  // Each side's strikes as rounds: the first (a brave weapon or multi-hit art strikes
  // more than once), then the follow-up, which for a weapon art is a plain strike.
  const groups = { a: forecastStrikeGroups(a), d: d.canCounter ? forecastStrikeGroups(d) : [] };
  const round = (side, index) => {
    const g = groups[side][index];
    if (!g) return;
    for (let i = 0; i < g.count; i++) {
      if (attackerHP <= 0 || defenderHP <= 0) return;
      // Thorns sends part of each landed hit back, but never takes the last HP.
      if (side === 'a' && g.hit > 0) {
        defenderHP = Math.max(0, defenderHP - g.damage);
        if (g.thornsReflect > 0) attackerHP = Math.max(1, attackerHP - g.thornsReflect);
      }
      if (side === 'd' && g.hit > 0) {
        attackerHP = Math.max(0, attackerHP - g.damage);
        if (g.thornsReflect > 0) defenderHP = Math.max(1, defenderHP - g.thornsReflect);
      }
    }
  };
  round('a', 0);
  round('d', 0);
  round('a', 1);
  round('d', 1);
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
  const base = Math.max(forecastRawDamage(d), d.damage);
  const possible = base * (d.crit > 0 ? 3 : 1);
  return possible >= attackerHP
    ? `${d.crit > 0 && base < attackerHP ? 'A critical counter' : 'The counterattack'} could defeat ${a.name}.`
    : '';
}

// Shared readout for the canvas and DOM forecasts. Keep assumptions beside estimates.
/**
 * Short notes under a forecast side. `weapons` ({ planned, equipped }) lets the
 * attacker side say that confirming switches weapons: the forecast only plans the
 * weapon, and it is equipped on confirm (a staff user's weapon art, or any weapon
 * cycled to in the forecast).
 */
export function forecastNotes(forecast, attacking, attackerHP, weapons = null) {
  const projection = forecastProjection(forecast);
  const notes = [];
  const { planned, equipped } = weapons || {};
  if (attacking && planned && planned !== equipped) notes.push(`Confirming equips ${planned.name}`);
  if (projection) {
    const hp = attacking ? projection.attackerHP : projection.defenderHP;
    notes.push(`If all hits land: ${hp === 0 ? 'KO' : `${hp} HP`} (no crits/procs)`);
  }
  const striker = attacking ? forecast.attacker : forecast.defender;
  if (striker?.thornsReflect > 0)
    notes.push(`Thorns: −${striker.thornsReflect} HP per hit landed (leaves at least 1)`);
  if (attacking) {
    notes.push(triangleText(forecast), counterRisk(forecast, attackerHP));
    // An area art's reach (AreaPreview.areaForecastLines): known units only.
    notes.push(...(forecast.attacker?.areaNotes || []));
  } else if (!forecast.defender.canCounter) {
    notes.push(
      `Cannot counter · ${forecast.display?.counterReason || 'No valid response at this range'}`,
    );
  }
  return notes.filter(Boolean);
}

/**
 * "How to read this forecast": short points, folded away until opened. Doubling is
 * explained here (not as a hint under the forecast) and only when someone doubles.
 */
export function forecastReadingPoints(forecast) {
  const points = [
    'Hit is the real chance a strike lands: two rolls averaged, so 75 Hit lands about 88% and 25 about 13%.',
    'Crit uses one roll. Crits and special effects can change damage.',
  ];
  if (forecast?.attacker?.doubles || forecast?.defender?.doubles)
    points.push(
      `Speed: an Attack Speed lead of ${DOUBLE_ATTACK_SPD_THRESHOLD} grants a second attack (${WEAPON_ART_FOLLOW_UP_SPD_THRESHOLD} while a weapon art is active). Weapon weight lowers Attack Speed. Planned hits already counts it.`,
    );
  points.push('A defeated unit cannot finish its remaining strikes.');
  return points;
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
  if (triangleText(forecast))
    hints.push({
      id: 'battle_triangle',
      text: 'Swords beat axes, axes beat lances, and lances beat swords. The displayed damage and Hit chance already include this matchup.',
    });
  return hints;
}

/** Explain exactly the modifier listed by the combat engine, on either UI. */
export function forecastModifierText(entry, unit, gameData = {}) {
  const id = entry?.id;
  if (!id) return '';
  if (id === 'mastery')
    return formatPerkMods(getMasteryPerk(unit, gameData.classes, gameData.traits)?.mods);
  if (id.startsWith('trait_')) {
    const traits = gameData.traits?.traits || gameData.traits || [];
    return traitEffectText(
      traits.find((t) => t.id === id.slice(6)),
      unit,
      gameData,
    );
  }
  const skill = gameData.skills?.find((s) => s.id === id);
  if (skill) return skill.description || '';
  const affixes = gameData.affixes?.affixes || gameData.affixes || [];
  return affixes.find((a) => a.id === id)?.description || entry.description || '';
}
