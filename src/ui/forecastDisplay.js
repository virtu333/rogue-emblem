import { traitEffectText } from './traitContent.js';
import { getMasteryPerk } from '../engine/MasterySystem.js';
import { formatPerkMods } from './rosterDisplay.js';
import { hitProbability } from '../engine/HitRoll.js';
import { forecastRawDamage, forecastStrikeGroups } from '../engine/Combat.js';

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
/**
 * A side's Hit cell: its first strike's chance. Keen Eye lifts only that strike
 * (`firstHit`); every later strike rolls at `hit`, which `forecastNotes` names.
 */
export const formatSideHit = (info) => formatHitChance(info?.firstHit ?? info?.hit);
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
  // Revival Stones: a side's blow that would take a stoned bar to 0 breaks it instead and
  // ends the exchange (Combat.rollStrike), so the projection stops there and says so. The
  // Unbroken Banner (`banner`, after the stones) holds its side at 1 HP and ends it too.
  let broke = null;
  let held = null;
  // Each side's strikes as rounds: the first (a brave weapon or multi-hit art strikes
  // more than once), then the follow-up, which for a weapon art is a plain strike.
  const groups = { a: forecastStrikeGroups(a), d: d.canCounter ? forecastStrikeGroups(d) : [] };
  const round = (side, index) => {
    const g = groups[side][index];
    if (!g) return;
    for (let i = 0; i < g.count; i++) {
      if (attackerHP <= 0 || defenderHP <= 0 || broke || held) return;
      // Thorns sends part of each landed hit back, but never takes the last HP.
      // The very first strike of the attacker may roll at a Hit of its own (Keen Eye).
      const landing = index === 0 && i === 0 ? (g.firstHit ?? g.hit) : g.hit;
      if (side === 'a' && landing > 0) {
        defenderHP = Math.max(0, defenderHP - g.damage);
        if (g.thornsReflect > 0) attackerHP = Math.max(1, attackerHP - g.thornsReflect);
        if (defenderHP <= 0 && d.stones > 0) broke = 'defender';
        else if (defenderHP <= 0 && d.banner) {
          defenderHP = 1;
          held = 'defender';
        }
      }
      if (side === 'd' && g.hit > 0) {
        attackerHP = Math.max(0, attackerHP - g.damage);
        if (g.thornsReflect > 0) defenderHP = Math.max(1, defenderHP - g.thornsReflect);
        if (attackerHP <= 0 && a.stones > 0) broke = 'attacker';
        else if (attackerHP <= 0 && a.banner) {
          attackerHP = 1;
          held = 'attacker';
        }
      }
    }
  };
  round('a', 0);
  round('d', 0);
  round('a', 1);
  round('d', 1);
  return {
    attackerHP,
    defenderHP,
    ...(broke ? { breaks: broke } : {}),
    ...(held ? { holds: held } : {}),
  };
}

/** What a projected HP of 0 means for a side: "KO", or "Breaks a bar" for a Revival Stone. */
export function projectedFallText(projection, side) {
  return projection?.breaks === side ? 'Breaks a bar' : 'KO';
}

/** A side the Unbroken Banner would hold, as the forecast says it. */
export const BANNER_HOLD_TEXT = '1 HP (Unbroken Banner)';

/**
 * A side's projected HP as the forecast says it: the banner's hold, "KO" / "Breaks a bar" at
 * 0, else "N HP".
 */
export function projectedHpText(projection, side) {
  if (projection?.holds === side) return BANNER_HOLD_TEXT;
  const hp = side === 'attacker' ? projection?.attackerHP : projection?.defenderHP;
  return hp === 0 ? projectedFallText(projection, side) : `${hp} HP`;
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
  // The kill that spares the counter is the attacker's first strike, so its chance decides
  // (Keen Eye lifts it above the Hit every later strike rolls at).
  if (forecast.display?.simpleExchange && (a.firstHit ?? a.hit) >= 100 && a.damage >= d.hp)
    return '';
  if (forecast.display?.counterHasDamageProc)
    return 'Enemy skills can change counterattack damage.';
  const base = Math.max(forecastRawDamage(d), d.damage);
  const possible = base * (d.crit > 0 ? 3 : 1);
  if (possible < attackerHP) return '';
  const blow = d.crit > 0 && base < attackerHP ? 'A critical counter' : 'The counterattack';
  // The Unbroken Banner would hold the attacker: the counter cannot defeat it, only spend it.
  return a.banner
    ? `${blow} could fell ${a.name}: the Unbroken Banner would hold at 1 HP.`
    : `${blow} could defeat ${a.name}.`;
}

/** True when the side's first strike rolls differently from the ones after it. */
function laterStrikesDiffer(side) {
  return (
    side?.firstHit !== undefined &&
    side.firstHit !== side.hit &&
    forecastStrikeGroups(side).reduce((n, g) => n + g.count, 0) > 1
  );
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
    const side = attacking ? 'attacker' : 'defender';
    notes.push(`If all hits land: ${projectedHpText(projection, side)} (no crits/procs)`);
  }
  // A one-time lesson on this side (the armor note: AttackFlowController.armorLesson).
  const side = attacking ? forecast.attacker : forecast.defender;
  if (typeof side?.lessonNote === 'string' && side.lessonNote) notes.push(side.lessonNote);
  const striker = attacking ? forecast.attacker : forecast.defender;
  if (attacking && laterStrikesDiffer(striker))
    notes.push(`Later strikes: ${formatHitChance(striker.hit)} (Keen Eye lifts the first)`);
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
      'Speed: an Attack Speed lead of 5 grants a second attack. Weapon weight lowers Attack Speed. Planned hits already counts it.',
    );
  points.push('A defeated unit cannot finish its remaining strikes.');
  if (forecast?.attacker?.stones > 0 || forecast?.defender?.stones > 0)
    points.push(
      'A Revival Stone refills its bearer when a blow would fell it. That blow ends the exchange: no more strikes this combat.',
    );
  if (forecast?.attacker?.banner || forecast?.defender?.banner)
    points.push(
      'The Unbroken Banner holds the first ally a blow would fell at 1 HP, once a battle. That blow ends the exchange.',
    );
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
