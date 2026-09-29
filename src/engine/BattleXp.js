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
  const survivalXp = survivedAttack && unit.currentHP > 0 ? XP_DEFEND_SURVIVE : 0;
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
 * @returns {{ result: object, statsAfterGain: object, levelUps: { levelUp: object,
 *   learnedIds: string[], blockedIds: string[] }[] }}  one entry per level gained,
 *   oldest first; `statsAfterGain` is the unit's stats before any skill is granted
 *   (what level-up cards count back from)
 */
export function applyXpGain(unit, xp, { classes = [], extendedLevelingEnabled = false } = {}) {
  const result = gainExperience(unit, xp, { extendedLevelingEnabled });
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
  return { result, statsAfterGain, levelUps };
}
