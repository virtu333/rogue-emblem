// HeatParams.js - what NG+ Echo (engine/NgPlusEcho.js) and the run's Omens (engine/Omens.js)
// add to a battle's params. Called last in RunManager.getBattleParams, so the scene, the scout
// and the headless harness read the same battle. Keys change only when something applies, so an
// ordinary run's params are exactly as they were.
//
// Pure. No Math.random.
import { echoModsFor, runEcho, withEchoBossStones } from './NgPlusEcho.js';
import { omenEffect } from './Omens.js';
import { hasRevivalStones } from './RevivalStones.js';
import { largerHuntedWave, normalizeHuntedWave } from './Burdens.js';

const EMPTY_ECLIPSE_AFFIX = Object.freeze({
  gatingDifficultyId: null,
  extraMaxAffixes: 0,
  guaranteedCount: 0,
  guaranteedTier: 1,
});

/**
 * @param {object} run - the RunManager
 * @param {object} battleParams - mutated in place
 * @param {{ isBoss?: boolean }} [options]
 */
export function applyHeatParams(run, battleParams, { isBoss = false } = {}) {
  // Echo: the Barracks members' rides scale every enemy, bosses' levels and stones too.
  const echo = echoModsFor(runEcho(run), run?.gameData);
  battleParams.enemyLevelBonus = (battleParams.enemyLevelBonus || 0) + echo.enemyLevelBonus;
  battleParams.bossLevelBonus = (battleParams.bossLevelBonus || 0) + echo.enemyLevelBonus;
  battleParams.enemyStatBonus = (battleParams.enemyStatBonus || 0) + echo.enemyStatBonus;
  battleParams.enemyCountBonus = (battleParams.enemyCountBonus || 0) + echo.enemyCountBonus;
  if (echo.bossStones) {
    const stones = withEchoBossStones(battleParams.revivalStones ?? null, echo.bossStones);
    if (hasRevivalStones(stones)) battleParams.revivalStones = stones;
  }
  // Hunting Party: every non-boss battle is hunted (a Hunted burden's wave, if larger, stands).
  const omenWave = omenEffect(run, 'huntedWave');
  if (omenWave && !isBoss)
    battleParams.huntedWave = battleParams.huntedWave
      ? largerHuntedWave(battleParams.huntedWave, omenWave)
      : normalizeHuntedWave(omenWave);
  // Marked Foes: affixes more often, and more of them on one foe.
  const affixShare = Number(omenEffect(run, 'affixChanceMultiplier', 1));
  if (Number.isFinite(affixShare) && affixShare !== 1)
    battleParams.affixChanceMultiplier = (battleParams.affixChanceMultiplier ?? 1) * affixShare;
  const extraAffixes = Math.max(0, Math.trunc(Number(omenEffect(run, 'affixMaxBonus', 0)) || 0));
  if (extraAffixes) {
    const affix = battleParams.eclipseAffix || EMPTY_ECLIPSE_AFFIX;
    battleParams.eclipseAffix = {
      ...affix,
      extraMaxAffixes: (Number(affix.extraMaxAffixes) || 0) + extraAffixes,
    };
  }
  return battleParams;
}

/** Set `params[key]` to `value` when `when` holds, else remove the key (params keep only what applies). */
export function putParam(params, key, value, when) {
  if (when) params[key] = value;
  else delete params[key];
}
