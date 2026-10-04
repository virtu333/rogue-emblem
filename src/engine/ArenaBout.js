// ArenaBout — an arena fight to the finish (pure; no Phaser).
//
// A bout is a run of rounds. Each round is one ordinary combat exchange
// (resolveCombat), the entrant striking first, with both fighters' HP carried into
// the next. It ends when one falls or after `maxRounds` (colosseum.json
// arena.maxRounds): a draw. The entrant never dies: a lethal blow leaves it at 1 HP
// and the bout is lost. Skill mods are rebuilt every round, so a skill that reads HP
// (Wrath, a below-half accessory) acts on the fighter as it stands now.
//
// estimateArenaOdds plays the same bout many times on copies, on its own seeded
// stream, and puts Math.random back afterwards: showing odds never moves the run's
// dice, and the same matchup always shows the same odds.

import { getArenaDistance, getArenaWeapon } from './ColosseumEngine.js';
import { resolveCombat } from './Combat.js';
import { getSkillCombatMods, rollDefenseSkills, rollStrikeSkills } from './SkillSystem.js';
import { applyCombatSideHP } from './UnitHealth.js';
import { createSeededRng } from './BlessingEngine.js';

export const DEFAULT_ARENA_MAX_ROUNDS = 10;
const ARENA_TERRAIN = Object.freeze({ avoidBonus: 0, defBonus: 0 });

export function arenaMaxRounds(colosseumData) {
  const n = Math.trunc(Number(colosseumData?.arena?.maxRounds));
  return n >= 1 ? n : DEFAULT_ARENA_MAX_ROUNDS;
}

/**
 * Resolve one round: the entrant attacks, the challenger counters. Applies both
 * fighters' HP (the entrant never below 1) and returns the combat result.
 * The entrant must already hold the weapon it fights with (getArenaWeapon).
 */
export function resolveArenaRound(entrant, challenger, gameData) {
  const skillsData = gameData?.skills || [];
  const masteryCtx = { classesData: gameData?.classes, traitsData: gameData?.traits || null };
  const atkMods = getSkillCombatMods(
    entrant,
    challenger,
    [entrant],
    [challenger],
    skillsData,
    ARENA_TERRAIN,
    true,
    null,
    masteryCtx,
  );
  const defMods = getSkillCombatMods(
    challenger,
    entrant,
    [challenger],
    [entrant],
    skillsData,
    ARENA_TERRAIN,
    false,
    null,
    masteryCtx,
  );
  const result = resolveCombat(
    entrant,
    entrant.weapon,
    challenger,
    challenger.weapon,
    getArenaDistance(entrant.weapon, challenger.weapon),
    ARENA_TERRAIN,
    ARENA_TERRAIN,
    {
      atkMods,
      defMods,
      rollStrikeSkills,
      rollDefenseSkills,
      skillsData,
      imbuesData: gameData?.imbues || null,
    },
  );
  // UnitHealth reads every strike, so a drain that topped a fighter up mid-round
  // settles its HP accessory debt as a battle would.
  applyCombatSideHP(entrant, 'attacker', result, { floor: 1 });
  applyCombatSideHP(challenger, 'defender', result);
  return result;
}

/**
 * The bout's outcome after `round` rounds (1-based): 'win', 'lose', 'draw' (the
 * round cap), or null while it goes on.
 */
export function arenaRoundOutcome(result, round, maxRounds) {
  if (result?.defenderDied) return 'win';
  if (result?.attackerDied) return 'lose';
  return round >= maxRounds ? 'draw' : null;
}

function matchupSeed(entrant, challenger) {
  const key = JSON.stringify([
    entrant?.name,
    entrant?.className,
    entrant?.level,
    entrant?.currentHP,
    entrant?.stats,
    entrant?.weapon?.name,
    challenger?.name,
    challenger?.className,
    challenger?.level,
    challenger?.currentHP,
    challenger?.stats,
    challenger?.weapon?.name,
  ]);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The chance of each outcome if the bout is fought to the end (no yield), from
 * `trials` bouts played on copies. Returns fractions { win, lose, draw }, or null when
 * the fighters can't be copied (the forecast then shows no odds rather than failing).
 */
export function estimateArenaOdds(
  entrant,
  challenger,
  gameData,
  { trials = 400, maxRounds = DEFAULT_ARENA_MAX_ROUNDS } = {},
) {
  const counts = { win: 0, lose: 0, draw: 0 };
  if (!entrant || !challenger || !getArenaWeapon(entrant)) return { win: 0, lose: 0, draw: 0 };
  try {
    structuredClone([entrant, challenger]);
  } catch {
    return null;
  }
  const prevRandom = Math.random;
  Math.random = createSeededRng(matchupSeed(entrant, challenger));
  try {
    for (let t = 0; t < trials; t++) {
      const a = structuredClone(entrant);
      const b = structuredClone(challenger);
      // The fight equips the planned weapon; so does the estimate.
      a.weapon = getArenaWeapon(a);
      let outcome = null;
      for (let round = 1; !outcome; round++)
        outcome = arenaRoundOutcome(resolveArenaRound(a, b, gameData), round, maxRounds);
      counts[outcome]++;
    }
  } finally {
    Math.random = prevRandom;
  }
  return {
    win: counts.win / trials,
    lose: counts.lose / trials,
    draw: counts.draw / trials,
  };
}
