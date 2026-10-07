// BattleXp — who earns how much XP in battle, and what a gain does to the unit
// (no Phaser deps, no RNG beyond level-up growth rolls in gainExperience). The one
// implementation behind BattleScene and the headless harness, so balance sims see
// the XP a player sees.
//
// Three steps, each pure:
//   combatXpAwards  the base XP a combat earns: the unit's own (scaled by the damage
//                   it dealt when it did not kill, never below the survival minimum)
//                   and Mentor's Band shares for adjacent lower-level allies
//   scaledXp        a base award after the battle's multipliers (turn par, the
//                   difficulty's XP rate plus blessings, the unit's trait)
//   applyXpGain     the gain itself: levels, stats and the skills those levels teach

import { XP_DEFEND_SURVIVE } from '../utils/constants.js';
import {
  calculateCombatXP,
  checkLevelUpSkills,
  gainExperience,
  skillGateLevels,
} from './UnitManager.js';
import { calculateSharedXp, getXpShareRatio, getXpShareRecipients } from './XpShare.js';
import { xpGainSegments, xpGained, xpSnapshot } from './XpProgress.js';

/**
 * The HP one side of a resolved combat lost, for the XP and the damage-ratio math that
 * read it. A Revival Stone that broke refilled the bar (`result.defenderHP` is the new
 * bar's), so a broken bar counts as the whole bar it held at the start: the striker is
 * paid ordinary damage XP for it (never the kill bonus: the unit did not die).
 *
 * @param {object} result  Combat.resolveCombat's result
 * @param {'attacker'|'defender'} side  the side that took the damage
 * @param {number} hpAtStart  that side's HP before the combat
 */
export function combatHpLost(result, side, hpAtStart) {
  const start = Math.max(0, Math.trunc(Number(hpAtStart) || 0));
  const after = Math.max(
    0,
    Math.trunc(Number(side === 'defender' ? result?.defenderHP : result?.attackerHP) || 0),
  );
  const lost = Math.max(0, start - after);
  return result?.stoneBroken?.[side] ? Math.max(lost, start) : lost;
}

/**
 * Base XP awards for one combat, in the order they are granted: the unit first,
 * then each ally sharing through Mentor's Band.
 *
 * @param {object} p
 * @param {object} p.unit             the player unit earning XP
 * @param {object} p.opponent         the enemy it fought
 * @param {boolean} p.opponentDied
 * @param {number|null} p.damageDealt       damage the unit did (null: not measured)
 * @param {number|null} p.opponentHpAtStart the opponent's HP before the combat
 * @param {boolean} p.survivedAttack  the unit was attacked and lived (enemy phase)
 * @param {number} p.rewardMultiplier the opponent's reward multiplier (reinforcement,
 *                                    boss or elite)
 * @param {number} p.pressureXpMultiplier late-pressure decay past turn par
 * @param {number} p.recruitXpBonus   Training Doctrine (non-lords only)
 * @param {object[]} p.allies         the player army (Mentor's Band recipients)
 * @returns {{ unit: object, baseXp: number, share: boolean }[]}
 */
export function combatXpAwards({
  unit,
  opponent,
  opponentDied,
  damageDealt = null,
  opponentHpAtStart = null,
  survivedAttack = false,
  rewardMultiplier = 1,
  pressureXpMultiplier = 1,
  recruitXpBonus = 0,
  allies = [],
}) {
  if (!unit || opponent?._noXP) return [];
  // Surviving an attacker whose wave pays nothing earns nothing either (no farming a
  // spent reinforcement ladder, docs/specs/dusk-pressure.md).
  const survivalXp =
    survivedAttack && unit.currentHP > 0 && rewardMultiplier > 0 ? XP_DEFEND_SURVIVE : 0;
  let baseXp = calculateCombatXP(unit, opponent, opponentDied);
  let damageRatio = 1;
  if (!opponentDied && Number.isFinite(damageDealt) && Number.isFinite(opponentHpAtStart)) {
    const safeDamage = Math.max(0, Math.trunc(damageDealt));
    const safeStartHp = Math.max(1, Math.trunc(opponentHpAtStart));
    // No damage: only the survival minimum, and nothing to share.
    if (safeDamage <= 0) return survivalXp > 0 ? [{ unit, baseXp: survivalXp, share: false }] : [];
    damageRatio = Math.min(1, safeDamage / safeStartHp);
    baseXp = Math.floor(baseXp * damageRatio);
  }
  const bonus = unit.isLord ? 0 : Number(recruitXpBonus) || 0;
  const ownXp = Math.max(
    survivalXp,
    Math.floor(baseXp * rewardMultiplier * pressureXpMultiplier * (1 + bonus)),
  );
  const awards = ownXp > 0 ? [{ unit, baseXp: ownXp, share: false }] : [];

  // Mentor's Band: recipients are fixed before the holder's own gain (a level-up
  // mid-award must not change who shares). Each share uses the recipient's own
  // formula, so shares count even when the holder's rounded award is 0.
  const ratio = getXpShareRatio(unit);
  if (ratio > 0) {
    for (const ally of getXpShareRecipients(unit, allies || [])) {
      if (ally.currentHP <= 0) continue;
      const sharedXp = calculateSharedXp(
        ally,
        opponent,
        opponentDied,
        ratio,
        damageRatio * rewardMultiplier * pressureXpMultiplier,
      );
      if (sharedXp > 0) awards.push({ unit: ally, baseXp: sharedXp, share: true });
    }
  }
  return awards;
}

/**
 * A base award after the battle's multipliers. Every award is at least 1.
 * @param {number} baseXp
 * @param {{ parXpMultiplier?: number, xpMultiplier?: number, blessingXpDelta?: number,
 *   traitXpMultiplier?: number }} rates
 */
export function scaledXp(
  baseXp,
  { parXpMultiplier = 1, xpMultiplier = 1, blessingXpDelta = 0, traitXpMultiplier = 1 } = {},
) {
  return Math.max(
    1,
    Math.floor(baseXp * parXpMultiplier * (xpMultiplier + blessingXpDelta) * traitXpMultiplier),
  );
}

/**
 * Give a unit XP: levels and stat gains (gainExperience), then the skills each new
 * level teaches, granted before anything is shown. A skill due at a level reached
 * now that finds the unit's slots full is reported once (`blockedIds`, on the
 * level-up that reached it); later level-ups retry it silently.
 *
 * The gain is also recorded as plain values for the EXP bars (XpProgress):
 * `before` / `after` are xpSnapshots either side of it, and `gained` is the XP that
 * actually counted toward levels (0 at the cap; less than `xp` when the gain reaches
 * the cap, whose leftover can never earn a level). Recording it reads the unit only:
 * no state or RNG changes.
 *
 * @returns {{ result: object, statsAfterGain: object, levelUps: { levelUp: object,
 *   learnedIds: string[], blockedIds: string[] }[], before: object, after: object,
 *   gained: number }}  one levelUps entry per level gained, oldest first;
 *   `statsAfterGain` is the unit's stats before any skill is granted (what level-up
 *   cards count back from)
 */
export function applyXpGain(unit, xp, { classes = [], extendedLevelingEnabled = false } = {}) {
  const before = xpSnapshot(unit, { extendedLevelingEnabled });
  const result = gainExperience(unit, xp, { extendedLevelingEnabled });
  const after = xpSnapshot(unit, { extendedLevelingEnabled });
  const statsAfterGain = { ...unit.stats };
  const reachedLevels = new Set((result.levelUps || []).map((lv) => lv.newLevel));
  const gateLevels = skillGateLevels(unit, classes);
  const levelUps = [];
  for (const levelUp of result.levelUps || []) {
    const droppedIds = [];
    const learnedIds = checkLevelUpSkills(unit, classes, droppedIds);
    const blockedIds = droppedIds.filter((id) => reachedLevels.has(gateLevels.get(id)));
    reachedLevels.clear();
    levelUps.push({ levelUp, learnedIds, blockedIds });
  }
  const gained = xpGained(xpGainSegments(before, after, result.levelUps));
  return { result, statsAfterGain, levelUps, before, after, gained };
}

/**
 * Whether area credits pay XP. The battle scene and the harness both read this one
 * switch (docs/specs/aoe-weapon-arts.md slice 4b), so sims never earn XP a player
 * cannot. actionXpAwards itself always counts the credits it is given; this only decides
 * whether callers pass them.
 */
export const AREA_XP_LIVE = true;

/** Area credit rates (owner decision 2026-10-01; data: weaponArts.json `areaXp`). */
export const AREA_XP_DEFAULTS = Object.freeze({ hitRate: 0.35, killRate: 0.6, actionBaseCap: 75 });

function areaXpRates(areaXp) {
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  return {
    hitRate: Math.max(0, num(areaXp?.hitRate, AREA_XP_DEFAULTS.hitRate)),
    killRate: Math.max(0, num(areaXp?.killRate, AREA_XP_DEFAULTS.killRate)),
    actionBaseCap: Math.max(0, num(areaXp?.actionBaseCap, AREA_XP_DEFAULTS.actionBaseCap)),
  };
}

/**
 * The unscaled share of one area credit for `earner`, whose combat formula is used
 * (the holder, or a Mentor's Band recipient). `perCredit` carries the victim's reward
 * multiplier, turn pressure and Training Doctrine.
 */
function creditXp(earner, credit, rates, perCredit) {
  const victim = credit?.victim;
  const damage = Math.max(0, Math.trunc(Number(credit?.damage) || 0));
  if (!victim || victim._noXP || damage <= 0) return 0;
  const killed = credit.killed === true;
  let base = calculateCombatXP(earner, victim, killed);
  if (!killed) base *= Math.min(1, damage / Math.max(1, Math.trunc(Number(credit.hpBefore) || 0)));
  return base * (killed ? rates.killRate : rates.hitRate) * perCredit(victim);
}

/**
 * Base XP for one action that hit several foes (docs/specs/aoe-weapon-arts.md §2.5): the
 * primary exactly as combatXpAwards grants it, plus each area credit
 * ({ victim, damage, hpBefore, killed }) at `areaXp.hitRate` or `areaXp.killRate`, its
 * victim's own reward multiplier, turn pressure and Training Doctrine. Area credits add
 * at most `areaXp.actionBaseCap` and are base XP: the battle's multipliers (scaledXp)
 * apply once to the total. One entry per recipient: the unit first, then Mentor's Band
 * shares (each recipient's own formula, the same rates and cap).
 *
 * With no primary `opponent` (a chosen-center strike), the credit worth the most base XP
 * counts as the primary and the rest as area credits.
 *
 * @param {object} p  combatXpAwards' inputs plus:
 * @param {object[]} p.credits
 * @param {(victim: object) => number} p.rewardMultiplierOf  a victim's reward multiplier
 * @param {object} [p.areaXp]  { hitRate, killRate, actionBaseCap }
 */
export function actionXpAwards({
  credits = [],
  rewardMultiplierOf = () => 1,
  areaXp = null,
  ...primary
}) {
  const unit = primary.unit;
  if (!unit) return [];
  const rates = areaXpRates(areaXp);
  let rest = (credits || []).filter((c) => c?.victim && c.victim !== primary.opponent);
  let primaryInputs = primary;
  // With no credits this is exactly combatXpAwards, whatever the opponent (even none).
  if (!primary.opponent && rest.length > 0) {
    // The credit worth the most at the primary rate becomes the primary (first wins ties).
    const worth = (c) => creditXp(unit, c, { hitRate: 1, killRate: 1 }, rewardMultiplierOf);
    const best = rest.reduce((a, b) => (worth(b) > worth(a) ? b : a));
    rest = rest.filter((c) => c !== best);
    primaryInputs = {
      ...primary,
      opponent: best.victim,
      opponentDied: best.killed === true,
      damageDealt: best.damage,
      opponentHpAtStart: best.hpBefore,
      rewardMultiplier: rewardMultiplierOf(best.victim),
    };
  }
  const awards = combatXpAwards(primaryInputs);
  if (rest.length === 0) return awards;

  const pressure = Number(primary.pressureXpMultiplier ?? 1);
  const doctrine = (earner) => (earner.isLord ? 0 : Number(primary.recruitXpBonus) || 0);
  const perCreditFor = (earner) => (victim) =>
    rewardMultiplierOf(victim) * pressure * (1 + doctrine(earner));
  const capped = (sum) => Math.floor(Math.min(rates.actionBaseCap, sum));
  const add = (earner, share, extra) => {
    if (extra <= 0) return;
    const entry = awards.find((a) => a.unit === earner);
    if (entry) entry.baseXp += extra;
    else if (share) awards.push({ unit: earner, baseXp: extra, share: true });
    else awards.unshift({ unit: earner, baseXp: extra, share: false });
  };

  // Mentor's Band recipients are fixed before anyone's gain, from the holder's tile.
  const ratio = getXpShareRatio(unit);
  const recipients =
    ratio > 0
      ? getXpShareRecipients(unit, primary.allies || []).filter((ally) => ally.currentHP > 0)
      : [];

  const own = rest.reduce((sum, c) => sum + creditXp(unit, c, rates, perCreditFor(unit)), 0);
  add(unit, false, capped(own));
  for (const ally of recipients) {
    // A share uses the recipient's own formula and the holder's context (as Mentor's
    // Band does for the primary: no Training Doctrine of the recipient's own).
    const holderContext = (victim) => rewardMultiplierOf(victim) * pressure;
    const share = rest.reduce((sum, c) => sum + creditXp(ally, c, rates, holderContext), 0);
    add(ally, true, capped(share * ratio));
  }
  return awards;
}
